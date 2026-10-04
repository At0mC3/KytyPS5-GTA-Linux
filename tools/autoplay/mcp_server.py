#!/usr/bin/env python3
"""MCP server that lets an agent (Claude Code) play the game in KytyPS5.

It drives the emulator through the automation hooks (the same interactive session as
`kyty_autoplay.py start/send/shot/stop`) and can ask a local Ollama vision model what is on screen.
Register it with the `.mcp.json` at the repository root, or:

    claude mcp add kyty -- python3 tools/autoplay/mcp_server.py

Over HTTP (for a remote agent, behind a Cloudflare tunnel):

    sh tools/autoplay/mcp_server.sh --http            # listens on 127.0.0.1:8765/mcp
    cloudflared tunnel --url http://127.0.0.1:8765    # in a second terminal

Every start prints a new random key. Clients must send `Authorization: Bearer <key>`; anything else
gets 401. The key is never stored, so restarting the server revokes it.

Environment:
    KYTY_BUILD_DIR       build directory with kyty_emulator (default _Build/linux)
    KYTY_EMULATOR        path to kyty_emulator (default <build>/kyty_emulator)
    KYTY_GAME            game directory, used when start_game gets none (or use kyty_run.sh)
    KYTY_EMULATOR_ARGS   extra kyty_emulator arguments, e.g. "--gpu 0"
    KYTY_BOOT_GRACE      seconds allowed before the first frame (default 300)
    OLLAMA_HOST, KYTY_VISION_MODEL, KYTY_VISION_MAX_WIDTH, KYTY_VISION_TIMEOUT,
    KYTY_VISION_NUM_CTX, KYTY_VISION_NUM_PREDICT: see vision.py

Needs the `mcp` package (pip install -r tools/autoplay/requirements-mcp.txt); 1.x and 2.x work.
"""
from __future__ import annotations

import argparse
import base64
import hmac
import io
import json
import os
import secrets
import re
import shutil
import subprocess
import sys
import tempfile
import time
import zipfile
from pathlib import Path
from typing import Any, Optional

sys.path.insert(0, str(Path(__file__).resolve().parent))

import kyty_autoplay as ka  # noqa: E402
import vision  # noqa: E402

REFS_DIR = Path(__file__).resolve().parent / "scenarios" / "refs"
MAX_WAIT_SECONDS = 120.0
MAX_PRESS_TIMES = 20
MAX_SHADER_ZIP = 16 * 1024 * 1024
CAPTURE_NAME = re.compile(r"^[a-z]+_[0-9a-f]+_[0-9a-f]+$")
RUN_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]*$")
REPLAY_TIMEOUT = 120.0
REPLAY_ALL_TIMEOUT = 900.0
REPLAY_MODES = ("replay", "disasm", "replay_all")
REPLAY_EXIT_MEANING = {
    0: "ok",
    1: "some captures failed (replay_all)",
    64: "usage error: bad arguments or an unreadable capture",
    65: "fatal: the recompiler failed the way the game does",
    66: "a guest read the capture never recorded (the message lists the address)",
    67: "the SPIR-V is invalid",
}
MAX_OUTPUT_CHARS = 1_000_000

INSTRUCTIONS = """Plays a PS5 game (GTA V) inside the KytyPS5 emulator.

Loop: start_game, then look (asks a local vision model to describe the screen) or screenshot (see it
yourself), decide, press/stick, wait, and look again. Always stop_game when done.

Buttons: cross circle square triangle l1 r1 l2 r2 l3 r3 options touchpad up down left right. Xbox
names work too: a=cross b=circle x=square y=triangle lb=l1 rb=r1 lt=l2 rt=r2 start=options.
Sticks: x,y in -1..1, y=+1 is forward/up. If look returns unsure or truncated, call screenshot before
an irreversible press. When the game stops, call summary for the verdict and shader for the capture;
those are files on this machine. shader_replay replays a capture offline there and returns the IR dump
(grep it, or page it with offset); it works while the game runs. checkout and pull update this repo
(pull fast-forwards only); compile rebuilds kyty_emulator after stop_game. When a sequence works, save_reference a crop that identifies the
screen so it can become a replayable step in tools/autoplay/scenarios/gta5_story.toml."""


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except ValueError:
        return default


def grep_context(text: str, pattern: "re.Pattern[str]", context: int) -> tuple[str, int]:
    """Lines of `text` matching `pattern` with `context` lines around them, like grep -n -C.
    Matches are `N:line`, context `N-line`, and gaps between blocks `--`. Returns the text and
    the number of matching lines."""
    lines = text.splitlines()
    hits = [i for i, line in enumerate(lines) if pattern.search(line)]
    matching = set(hits)
    shown: list[str] = []
    last = -1
    for hit in hits:
        start = max(hit - context, last + 1)
        if shown and start > last + 1:
            shown.append("--")
        for i in range(start, min(hit + context + 1, len(lines))):
            shown.append(f"{i + 1}{':' if i in matching else '-'}{lines[i]}")
            last = i
    return "\n".join(shown), len(hits)


class GameTools:
    """The tools, independent of the MCP SDK so they can be tested directly."""

    def __init__(self, cfg: Optional[ka.Config] = None, repo: Optional[Path] = None):
        self.cfg = cfg or ka.make_config(build_dir=os.environ.get("KYTY_BUILD_DIR"),
                                         emulator=os.environ.get("KYTY_EMULATOR"))
        self.repo = Path(repo) if repo else ka.REPO_ROOT
        self.run_dir: Optional[Path] = None
        self.last_shot: Optional[Path] = None
        self.shot_count = 0

    # ---- helpers ------------------------------------------------------------------------------
    def _session(self) -> Path:
        if self.run_dir is not None:
            return self.run_dir
        try:
            self.run_dir = ka.resolve_run_dir(self.cfg, argparse.Namespace(run=None))
        except ka.HarnessError:
            raise ka.HarnessError("no game is running; call start_game first") from None
        return self.run_dir

    def _running(self, run_dir: Path) -> None:
        if (run_dir / "exit.json").exists():
            status = ka.read_session_status(run_dir)
            raise ka.HarnessError(f"the game is no longer running ({status.get('result')}: "
                                  f"{status.get('reason')}); see {run_dir / 'summary.md'}")

    def _send(self, command: str) -> dict:
        run_dir = self._session()
        self._running(run_dir)
        ack = ka.send_command(run_dir, command)
        if not ack.get("ok"):
            raise ka.HarnessError(ack.get("error") or f"`{command}` was rejected")
        return ack

    def _run(self, command: list[str], timeout: float) -> dict:
        try:
            done = subprocess.run(command, cwd=self.repo, capture_output=True, text=True, timeout=timeout)
        except subprocess.TimeoutExpired:
            raise ka.HarnessError(f"{' '.join(command)} timed out after {timeout:.0f}s") from None
        text = (done.stdout + done.stderr).strip()
        if done.returncode != 0:
            raise ka.HarnessError(text[-6000:] or f"exit {done.returncode}")
        return {"ok": True, "output": text[-6000:]}

    def _branch_name(self, branch: str) -> str:
        branch = branch.strip()
        if not branch or branch.startswith("-") or subprocess.run(
                ["git", "check-ref-format", "--branch", branch], cwd=self.repo,
                capture_output=True, text=True).returncode != 0:
            raise ka.HarnessError(f"invalid branch name {branch!r}")
        return branch

    def _head(self) -> str:
        return self._run(["git", "rev-parse", "--abbrev-ref", "HEAD"], 30)["output"]

    # ---- tools --------------------------------------------------------------------------------
    def start_game(self, game: str = "", args: str = "", wait_seconds: float = 90.0) -> dict:
        if self.run_dir is not None and not (self.run_dir / "exit.json").exists():
            return {"error": f"a game is already running in {self.run_dir}; call stop_game first"}
        cfg = ka.make_config(build_dir=str(self.cfg.build_dir), emulator=str(self.cfg.emulator),
                             replay_emulator=str(self.cfg.replay_emulator), root=str(self.cfg.root),
                             game=game or os.environ.get("KYTY_GAME") or None,
                             args=" ".join(filter(None, [os.environ.get("KYTY_EMULATOR_ARGS", ""), args])))
        started = ka.start_session(cfg, boot_grace=_env_float("KYTY_BOOT_GRACE", 300.0),
                                   wait=min(max(wait_seconds, 5.0), 600.0))
        self.run_dir = Path(started["run_dir"])
        self.last_shot = None
        return started

    def stop_game(self) -> dict:
        run_dir = self._session()
        result = ka.stop_session(run_dir)
        self.run_dir = None
        result["summary"] = str(run_dir / "summary.md")
        return result

    def game_status(self) -> dict:
        report = ka.read_session_status(self._session())
        status = report.get("status") or {}
        brief = {"run_dir": report["run_dir"], "running": report["running"],
                 "uptime_s": round(status.get("uptime_ms", 0) / 1000.0, 1),
                 "host_fps": status.get("host_fps"), "guest_fps": status.get("guest_fps"),
                 "host_presents": status.get("host_presents"), "guest_flips": status.get("guest_flips"),
                 "pad_reads": status.get("pad_reads"), "last_shader": status.get("last_shader")}
        if not report["running"]:
            brief.update(result=report.get("result"), reason=report.get("reason"),
                         summary=str(Path(report["run_dir"]) / "summary.md"))
        elif not status:
            brief["note"] = "no heartbeat yet; the game is still starting"
        return brief

    def press(self, button: str, times: int = 1, ms: int = 120, gap_ms: int = 300) -> dict:
        names = ka.normalize_buttons(button)
        times = max(1, min(int(times), MAX_PRESS_TIMES))
        ms = max(16, min(int(ms), 10000))
        for index in range(times):
            self._send(f"press {names} {ms}")
            # Wait until the press is over, plus a gap, so repeated presses register separately.
            time.sleep((ms + (max(0, int(gap_ms)) if index + 1 < times else 50)) / 1000.0)
        return {"pressed": names, "times": times, "ms": ms}

    def hold(self, button: str) -> dict:
        names = ka.normalize_buttons(button)
        self._send(f"hold {names}")
        return {"holding": names}

    def release(self, button: str = "all") -> dict:
        names = "all" if button.strip().lower() == "all" else ka.normalize_buttons(button)
        self._send(f"release {names}")
        return {"released": names}

    def stick(self, side: str, x: float, y: float, ms: int = 1000) -> dict:
        side = side.strip().lower()[:1]
        if side not in ("l", "r"):
            raise ka.HarnessError("side must be 'left' or 'right'")
        x, y = max(-1.0, min(float(x), 1.0)), max(-1.0, min(float(y), 1.0))
        self._send(f"stick {side} {x:g} {y:g} {max(0, int(ms))}")
        return {"stick": side, "x": x, "y": y, "ms": int(ms)}

    def trigger(self, side: str, value: float = 1.0, ms: int = 500) -> dict:
        side = side.strip().lower()[:1]
        if side not in ("l", "r"):
            raise ka.HarnessError("side must be 'left' or 'right'")
        value = max(0.0, min(float(value), 1.0))
        self._send(f"trigger {side} {value:g} {max(0, int(ms))}")
        return {"trigger": side, "value": value, "ms": int(ms)}

    def send_raw(self, command: str) -> dict:
        return self._send(ka.normalize_command(command))

    def wait(self, seconds: float) -> dict:
        run_dir = self._session()
        end = time.monotonic() + max(0.0, min(float(seconds), MAX_WAIT_SECONDS))
        while time.monotonic() < end and not (run_dir / "exit.json").exists():
            time.sleep(min(0.25, max(0.0, end - time.monotonic())))
        return self.game_status()

    def screenshot(self, name: str = "") -> Path:
        run_dir = self._session()
        self._running(run_dir)
        self.shot_count += 1
        path = ka.take_shot(run_dir, name or f"mcp_{self.shot_count:04d}")
        self.last_shot = path
        return path

    def look(self, question: str = "") -> dict:
        shot = self.screenshot(f"look_{self.shot_count + 1:04d}")
        try:
            described = vision.describe(shot, question)
        except vision.VisionError as error:
            return {"error": str(error), "screenshot": str(shot)}
        described["screenshot"] = str(shot)
        return described

    def summary(self) -> dict:
        """summary.md is written just after result.json, so wait out that gap."""
        run_dir = self._session()
        path = run_dir / "summary.md"
        if not path.is_file() and (run_dir / "result.json").is_file():
            deadline = time.monotonic() + 2
            while time.monotonic() < deadline and not path.is_file():
                time.sleep(0.05)
        if not path.is_file():
            return {"error": "no summary.md yet; the game is still running "
                    "(it is written when the game exits)", "path": str(path)}
        return {"markdown": path.read_text(), "path": str(path)}

    def _capture_dir(self, run_dir: Path, name: str) -> Path | dict:
        root = run_dir / "capture"
        name = name.strip()
        if name:
            path = root / name
            if not CAPTURE_NAME.fullmatch(name) or not path.is_dir():
                return {"error": f"no capture {name!r}"}
            return path
        result = ka.read_json(run_dir / "result.json", {})
        listed = (result.get("shader") or {}).get("captures") or []
        if listed:
            path = Path(listed[0])
            if path.is_dir() and CAPTURE_NAME.fullmatch(path.name) and path.resolve().parent == root.resolve():
                return path
        last = ((ka.read_json(run_dir / "status.json", {}) or {}).get("last_shader") or {}).get("hash") or ""
        digest = str(last).lower().removeprefix("0x")
        found = (ka.find_captures(root, digest.rjust(16, "0"))
                 if re.fullmatch(r"[0-9a-f]{1,16}", digest) else [])
        if len(found) == 1:
            return found[0]
        if len(found) > 1:
            return {"error": "several captures match; pass name", "names": [p.name for p in found]}
        return {"error": "no shader capture for this run"}

    def shader(self, name: str = "") -> dict:
        run_dir = self._session()
        capture = self._capture_dir(run_dir, name)
        if isinstance(capture, dict):
            return capture
        blob = io.BytesIO()
        files = []
        with zipfile.ZipFile(blob, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for path in sorted(p for p in capture.iterdir() if p.is_file()):
                files.append(path.name)
                archive.write(path, path.name)
        data = blob.getvalue()
        if len(data) > MAX_SHADER_ZIP:
            return {"error": f"capture {capture.name} is {len(data)} bytes, over the 16 MB limit",
                    "name": capture.name, "bytes": len(data)}
        return {"name": capture.name, "files": files, "path": str(capture),
                "zip_base64": base64.b64encode(data).decode()}

    def _replay_run_dir(self, run: str) -> Path:
        """The run directory shader_replay reads captures from: `run` by name, else the one
        `shader` uses, else (no game was started by this server) the newest run with captures."""
        root = self.cfg.root.resolve()
        run = run.strip()
        if run:
            path = root / run
            if not RUN_NAME.fullmatch(run) or not path.is_dir() or path.resolve().parent != root:
                raise ka.HarnessError(f"no run {run!r}")
            return path
        try:
            return self._session()
        except ka.HarnessError:
            runs = sorted(p for p in root.iterdir() if p.is_dir() and (p / "capture").is_dir()) \
                if root.is_dir() else []
            if not runs:
                raise ka.HarnessError("no run with shader captures; pass run") from None
            return runs[-1]

    def shader_replay(self, name: str = "", run: str = "", mode: str = "replay", pc: str = "",
                      window: int = 20, dump: bool = True, grep: str = "", context: int = 3,
                      offset: int = 0, max_chars: int = 60000) -> dict:
        """Replay a capture with kyty_emulator on this machine and return its output.

        It is a separate process on a copy of the capture (replay writes replay.log and out.spv
        next to its input), so it does not need the game stopped and never changes the run.
        """
        mode = mode.strip().lower()
        if mode not in REPLAY_MODES:
            raise ka.HarnessError(f"mode must be one of {', '.join(REPLAY_MODES)}")
        emulator = self.cfg.emulator
        if not emulator.is_file():
            raise ka.HarnessError(f"{emulator} does not exist; call compile first")
        pattern = None
        if grep:
            try:
                pattern = re.compile(grep)
            except re.error as error:
                raise ka.HarnessError(f"invalid grep pattern: {error}") from None
        context = max(0, min(int(context), 50))
        offset = max(0, int(offset))
        max_chars = max(1, min(int(max_chars), MAX_OUTPUT_CHARS))
        pc_args: list[str] = []
        if mode == "disasm":
            window = max(0, min(int(window), 100000))
            pc = str(pc).strip().lower()
            if pc:
                if not re.fullmatch(r"0x[0-9a-f]+|[0-9]+", pc) or int(pc, 0) > 0xFFFFFFFF:
                    raise ka.HarnessError(f"pc must be a hex (0x86c) or decimal number, not {pc!r}")
                pc_args = ["--pc", hex(int(pc, 0)), "--window", str(window)]

        run_dir = self._replay_run_dir(run)
        if mode == "replay_all":
            source = run_dir / "capture"
            if not source.is_dir():
                raise ka.HarnessError(f"{run_dir.name} has no capture directory")
            capture_name = None
        else:
            capture = self._capture_dir(run_dir, name)
            if isinstance(capture, dict):
                raise ka.HarnessError(capture["error"] + (f": {capture['names']}" if "names" in capture else ""))
            if capture.resolve().parent != (run_dir / "capture").resolve():
                raise ka.HarnessError(f"no capture {name!r}")
            source, capture_name = capture, capture.name

        with tempfile.TemporaryDirectory(prefix="kyty_replay_") as tmp:
            target = Path(tmp) / (capture_name or "capture")
            skip = shutil.ignore_patterns("replay.log", "out.spv", "replay_all.json")
            if mode == "replay_all":
                # Many captures: hard link their files (copy where that is not possible). Replay only
                # creates new files (replay.log, out.spv), which are not linked.
                def link_or_copy(src: str, dst: str) -> Any:
                    try:
                        os.link(src, dst)
                    except OSError:
                        shutil.copy2(src, dst)
                shutil.copytree(source, target, ignore=skip, copy_function=link_or_copy)
                command = [str(emulator), "--shader-replay-all", str(target),
                           "--timeout", str(int(REPLAY_TIMEOUT))]
                timeout = REPLAY_ALL_TIMEOUT
            else:
                shutil.copytree(source, target, ignore=skip)
                if mode == "disasm":
                    command = [str(emulator), "--shader-disasm", str(target), *pc_args]
                else:
                    command = [str(emulator), "--shader-replay", str(target)]
                    if not dump:
                        command.append("--no-dump")
                timeout = REPLAY_TIMEOUT
            shown = [part.replace(str(target), "<capture>") for part in command]
            timed_out = False
            try:
                done = subprocess.run(command, cwd=self.repo, stdout=subprocess.PIPE,
                                      stderr=subprocess.STDOUT, timeout=timeout)
                code, raw = done.returncode, done.stdout
            except subprocess.TimeoutExpired as expired:
                code, raw, timed_out = None, expired.stdout or b"", True
            except OSError as error:
                raise ka.HarnessError(f"could not run {emulator}: {error}") from None
            spv = target / "out.spv"
            out_spv = spv.stat().st_size if spv.is_file() else None
        text = raw.decode("utf-8", errors="replace") if isinstance(raw, bytes) else raw

        summary = [line[:500] for line in text.splitlines() if line.startswith("REPLAY")][:50]
        fatals = ka.find_fatals(text)
        first_error = fatals[0].first_line if fatals else next(
            (line[:500] for line in summary if line.startswith(("REPLAY FAIL", "REPLAY ERROR", "REPLAY-ALL ERROR"))), "")
        meaning = "timed out" if timed_out else REPLAY_EXIT_MEANING.get(
            code, f"killed by signal {-code}" if code < 0 else f"exit status {code}")
        result: dict[str, Any] = {"mode": mode, "run": run_dir.name, "capture": capture_name,
                                  "command": shown, "exit_code": code, "exit_meaning": meaning,
                                  "timed_out": timed_out, "summary_lines": summary,
                                  "first_error": first_error, "out_spv_bytes": out_spv}
        if mode == "replay_all":
            row = re.compile(r"^\S+\s+0x[0-9a-f]{16}\s+[0-9a-f]{8}\s+(\S+)\s")
            result["failures"] = [line[:500] for line in text.splitlines()
                                  if (m := row.match(line)) and m.group(1) != "OK"][:200]
        if pattern is not None:
            text, matches = grep_context(text, pattern, context)
            result.update(grep=grep, context=context, matches=matches)
        end = offset + max_chars
        result.update(total_chars=len(text), offset=offset, truncated=end < len(text),
                      next_offset=end if end < len(text) else None, text=text[offset:end])
        return result

    def save_reference(self, name: str, box: list[float], screenshot: str = "") -> dict:
        source = Path(screenshot) if screenshot else self.last_shot
        if source is None or not source.is_file():
            raise ka.HarnessError("no screenshot yet; call screenshot or look first")
        clean = re.sub(r"[^A-Za-z0-9_.-]", "_", name).strip("._") or "ref"
        made = ka.make_reference(source, REFS_DIR / f"{clean}.png", box=[float(v) for v in box])
        made["scenario_ref"] = f"refs/{clean}.png"
        return made

    def checkout(self, branch: str) -> dict:
        branch = self._branch_name(branch)
        result = self._run(["git", "checkout", branch], 60)
        result["branch"] = self._head()
        return result

    def pull(self, branch: str) -> dict:
        """Fast-forward `branch` from origin. Refuses unless that branch is the one checked out."""
        branch = self._branch_name(branch)
        current = self._head()
        if current != branch:
            raise ka.HarnessError(f"checked out {current}; call checkout first")
        result = self._run(["git", "pull", "--ff-only", "origin", branch], 180)
        result["branch"] = branch
        return result

    def compile(self) -> dict:
        if self.run_dir is not None and not (self.run_dir / "exit.json").exists():
            raise ka.HarnessError("a game is running; call stop_game before compile")
        build = self.cfg.build_dir
        if not (build / "CMakeCache.txt").is_file():
            self._run(["cmake", "-S", str(self.repo), "-B", str(build), "-DKYTY_KEEP_DEBUG_SYMBOLS=ON"], 600)
        result = self._run(["cmake", "--build", str(build), "--target", "kyty_emulator"], 1800)
        result["emulator"] = str(self.cfg.emulator)
        return result


def build_server(tools: Optional[GameTools] = None):
    """The MCP server, with the SDK imported only here."""
    try:
        from mcp.server.mcpserver import Image, MCPServer  # mcp 2.x
    except ImportError:
        from mcp.server.fastmcp import FastMCP as MCPServer, Image  # mcp 1.x

    tools = tools or GameTools()
    server = MCPServer("kyty", instructions=INSTRUCTIONS)

    def guarded(function, *args: Any, **kwargs: Any) -> Any:
        try:
            return function(*args, **kwargs)
        except (ka.HarnessError, vision.VisionError) as error:
            return {"error": str(error)}

    @server.tool()
    def start_game(game: str = "", args: str = "", wait_seconds: float = 90.0) -> dict:
        """Launch the game in the emulator. `game` is the game directory (default: KYTY_GAME or
        kyty_run.sh); `args` adds kyty_emulator options. Returns once it is running."""
        return guarded(tools.start_game, game, args, wait_seconds)

    @server.tool()
    def stop_game() -> dict:
        """Quit the game and return the run's verdict and summary path."""
        return guarded(tools.stop_game)

    @server.tool()
    def game_status() -> dict:
        """Whether the game is running, frame rates, and why it stopped if it did."""
        return guarded(tools.game_status)

    @server.tool()
    def press(button: str, times: int = 1, ms: int = 120, gap_ms: int = 300) -> dict:
        """Press a button `times` times (e.g. button="rb", times=2). Combine with '+': "l1+r1".
        `ms` is how long each press is held, `gap_ms` the pause between presses."""
        return guarded(tools.press, button, times, ms, gap_ms)

    @server.tool()
    def hold(button: str) -> dict:
        """Hold a button down until release is called."""
        return guarded(tools.hold, button)

    @server.tool()
    def release(button: str = "all") -> dict:
        """Release a held button, or "all"."""
        return guarded(tools.release, button)

    @server.tool()
    def stick(side: str, x: float, y: float, ms: int = 1000) -> dict:
        """Push the left or right stick. x,y in -1..1 (y=+1 forward/up) for `ms` milliseconds;
        ms=0 holds it until the next stick call."""
        return guarded(tools.stick, side, x, y, ms)

    @server.tool()
    def trigger(side: str, value: float = 1.0, ms: int = 500) -> dict:
        """Pull the left or right trigger (L2/R2) to `value` (0..1) for `ms` milliseconds."""
        return guarded(tools.trigger, side, value, ms)

    @server.tool()
    def send_raw(command: str) -> dict:
        """Send any automation command, e.g. "stick l 0 1 2000" or "reset"."""
        return guarded(tools.send_raw, command)

    @server.tool()
    def wait(seconds: float) -> dict:
        """Let the game run for up to 120 seconds, then return its status."""
        return guarded(tools.wait, seconds)

    @server.tool()
    def screenshot(name: str = "") -> Any:
        """Screenshot of the next frame the game presents, as an image."""
        try:
            path = tools.screenshot(name)
        except ka.HarnessError as error:
            return {"error": str(error)}
        return [Image(path=path), f"saved to {path}"]

    @server.tool()
    def look(question: str = "") -> dict:
        """Ask the local vision model about the screen. Returns screen, text, selected, prompts,
        state, and answer. Any of those may be "unsure". If truncated is true, or a field is
        unsure, call screenshot before an irreversible press."""
        return guarded(tools.look, question)

    @server.tool()
    def summary() -> dict:
        """Text of this run's summary.md. Written when the game exits."""
        return guarded(tools.summary)

    @server.tool()
    def shader(name: str = "") -> dict:
        """Zip (base64) of one shader capture: code.bin, user_data.bin, reads.bin, manifest.json.
        No name: the capture the abort replayed, or the last shader if the run is not classified.
        name is the capture directory, such as cs_0123abcd_00."""
        return guarded(tools.shader, name)

    @server.tool()
    def shader_replay(name: str = "", run: str = "", mode: str = "replay", pc: str = "", window: int = 20,
                      dump: bool = True, grep: str = "", context: int = 3, offset: int = 0,
                      max_chars: int = 60000) -> dict:
        """Replay a shader capture offline on this machine (kyty_emulator --shader-replay) and return
        its output as JSON: exit_code and exit_meaning (0 ok, 65 fatal, 66 unrecorded guest read, 67
        invalid SPIR-V), summary_lines (the REPLAY ... lines, including key_trace), first_error, and
        text. name is the capture directory (default: the one `shader` returns), run a run directory
        name (default: the current run). mode is replay, disasm (with pc such as "0x86c" and window)
        or replay_all (every capture of the run; slow). With dump the text starts with the
        "native IR before resource tracking" dump. grep is a regex: only matching lines come back,
        each with `context` lines around it. Long text is paged: pass next_offset as offset, or
        raise max_chars. Does not need the game stopped; the capture is copied first."""
        return guarded(tools.shader_replay, name, run, mode, pc, window, dump, grep, context, offset,
                       max_chars)

    @server.tool()
    def save_reference(name: str, box: list[float], screenshot: str = "") -> dict:
        """Crop the last screenshot (or `screenshot`) to `box` = [x0, y0, x1, y1] fractions of the
        frame and save it as scenarios/refs/<name>.png for a scenario `until` step."""
        return guarded(tools.save_reference, name, box, screenshot)

    @server.tool()
    def checkout(branch: str) -> dict:
        """Check out a git branch in this repo by name. Does not discard local changes."""
        return guarded(tools.checkout, branch)

    @server.tool()
    def pull(branch: str) -> dict:
        """Fast-forward `branch` from origin. The branch must already be checked out."""
        return guarded(tools.pull, branch)

    @server.tool()
    def compile() -> dict:
        """Build kyty_emulator. Configures the build directory once, then compiles. Stop the game first."""
        return guarded(tools.compile)

    return server


class BearerAuth:
    """ASGI middleware: every HTTP request must carry `Authorization: Bearer <key>`."""

    def __init__(self, app: Any, key: str):
        self.app = app
        self.expected = f"Bearer {key}".encode()

    async def __call__(self, scope: dict, receive: Any, send: Any) -> None:
        if scope["type"] == "http":
            supplied = dict(scope.get("headers") or []).get(b"authorization", b"")
            if not hmac.compare_digest(supplied, self.expected):
                body = json.dumps({"error": "missing or wrong key: send Authorization: Bearer <key>, "
                                   "as printed when the server started"}).encode()
                await send({"type": "http.response.start", "status": 401,
                            "headers": [(b"content-type", b"application/json"),
                                        (b"www-authenticate", b"Bearer"),
                                        (b"content-length", str(len(body)).encode())]})
                await send({"type": "http.response.body", "body": body})
                return
        await self.app(scope, receive, send)


def build_http_app(server: Any, key: str) -> Any:
    """The streamable-HTTP MCP app behind the key check.

    The SDK's DNS-rebinding protection only accepts localhost Host headers, and a Cloudflare tunnel
    forwards its public hostname, so that check is replaced by the key: a page in someone's browser
    cannot know it.
    """
    from mcp.server.transport_security import TransportSecuritySettings

    security = TransportSecuritySettings(enable_dns_rebinding_protection=False)
    try:
        app = server.streamable_http_app(transport_security=security)        # mcp 2.x
    except TypeError:
        server.settings.transport_security = security                        # mcp 1.x
        app = server.streamable_http_app()
    return BearerAuth(app, key)


def http_banner(host: str, port: int, key: str) -> str:
    local = f"http://{host}:{port}/mcp"
    entry = {"mcpServers": {"kyty": {"type": "http", "url": "https://<your-tunnel-host>/mcp",
                                     "headers": {"Authorization": f"Bearer {key}"}}}}
    return f"""
kyty MCP server listening on {local}

  Key for this run (a new one is made on every start; share it only with the agent):

      {key}

  Expose it:     cloudflared tunnel --url http://{host}:{port}
  Connect a Claude Code session to the tunnel:
      claude mcp add --transport http kyty https://<your-tunnel-host>/mcp --header "Authorization: Bearer {key}"
  or in .mcp.json:
{json.dumps(entry, indent=2)}
"""


def main(argv: Optional[list[str]] = None) -> None:
    parser = argparse.ArgumentParser(description="kyty MCP server")
    parser.add_argument("--http", action="store_true",
                        help="serve streamable HTTP with a per-start key instead of stdio")
    parser.add_argument("--host", default=os.environ.get("KYTY_MCP_HOST", "127.0.0.1"),
                        help="address to listen on (default 127.0.0.1; the tunnel connects locally)")
    parser.add_argument("--port", type=int, default=int(os.environ.get("KYTY_MCP_PORT", "8765")))
    args = parser.parse_args(argv)
    server = build_server()
    if not args.http:
        server.run("stdio")
        return

    import uvicorn

    key = secrets.token_urlsafe(32)
    print(http_banner(args.host, args.port, key), file=sys.stderr, flush=True)
    uvicorn.run(build_http_app(server, key), host=args.host, port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
