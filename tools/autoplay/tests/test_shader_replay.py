"""The shader_replay tool against a fake kyty_emulator that mimics the offline shader commands."""
import asyncio
import contextlib
import io
import json
import os
import re
import socket
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

import kyty_autoplay as ka  # noqa: E402
import mcp_server  # noqa: E402
import remote_client  # noqa: E402

try:
    import mcp  # noqa: F401
    HAVE_MCP = True
except ImportError:
    HAVE_MCP = False

NAME = "cs_10cd966bbcfb2baa_8fef27a2"

# Replay prints the IR dump and REPLAY lines, writes replay.log and out.spv next to the capture and
# exits with $FAKE_REPLAY_EXIT, like the real tool. Disasm prints the arguments it was given.
FAKE = """#!/bin/sh
cmd=$1; dir=$2
case "$cmd" in
--shader-replay)
  echo "native IR before resource tracking"
  i=0
  while [ $i -lt ${FAKE_DUMP_LINES:-40} ]; do echo "  %$i = Op$i"; i=$((i+1)); done
  echo "  %7 = ReadFirstLane %6"
  echo "REPLAY indirect_buffer_writes tables=1 key_source=0 keys=0 key_trace=select_guard" >&2
  case "$*" in *--no-dump*) echo "no dump" ;; esac
  if [ "${FAKE_REPLAY_EXIT:-0}" = 65 ]; then
    printf -- '--- Build ---\\nbuild x\\n--- Error ---\\nshader resource tracking: hash=0x10cd966bbcfb2baa pc=0x10 bad in /tmp/x.cpp:1\\n'
  fi
  echo hello > "$dir/replay.log"; echo spv > "$dir/out.spv"
  exit ${FAKE_REPLAY_EXIT:-0} ;;
--shader-disasm) echo "disasm $*"; exit 0 ;;
--shader-replay-all)
  printf 'STAGE HASH               KEY      RESULT     DETAIL\\n'
  printf 'cs    0x10cd966bbcfb2baa 8fef27a2 FAIL(65)   boom\\n'
  printf 'ps    0x0000000000000001 00000000 OK         \\n'
  echo "REPLAY-ALL 2 captures: 1 ok, 1 failed"; exit 1 ;;
--sleep) sleep 30 ;;
esac
"""


class ShaderReplay(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        self.build = root / "build"
        self.build.mkdir()
        self.emulator = self.build / "kyty_emulator"
        self.emulator.write_text(FAKE)
        self.emulator.chmod(self.emulator.stat().st_mode | stat.S_IXUSR)
        self.runs = root / "runs"
        self.run = self.runs / "20260101-000000"
        self.capture = self.run / "capture" / NAME
        self.capture.mkdir(parents=True)
        (self.capture / "code.bin").write_bytes(b"\0" * 8)
        (self.run / "capture" / "ps_0000000000000001_00000000").mkdir()
        self.saved = dict(os.environ)
        self.addCleanup(lambda: (os.environ.clear(), os.environ.update(self.saved)))
        self.tools = mcp_server.GameTools(ka.make_config(build_dir=str(self.build), root=str(self.runs)))

    def test_replay_returns_the_dump_summary_and_leaves_the_capture_alone(self):
        got = self.tools.shader_replay(NAME, run=self.run.name)
        self.assertEqual(got["exit_code"], 0)
        self.assertEqual(got["exit_meaning"], "ok")
        self.assertIn("native IR before resource tracking", got["text"])
        self.assertEqual(len(got["summary_lines"]), 1)
        self.assertIn("key_trace=select_guard", got["summary_lines"][0])
        self.assertEqual(got["first_error"], "")
        self.assertEqual(got["command"][1:], ["--shader-replay", "<capture>"])
        self.assertEqual(got["out_spv_bytes"], 4)
        self.assertEqual(sorted(p.name for p in self.capture.iterdir()), ["code.bin"])
        self.assertFalse(got["truncated"])
        self.assertEqual(got["total_chars"], len(got["text"]))
        # No run given: the newest run with captures, since this server started no game.
        self.assertEqual(self.tools.shader_replay(NAME)["run"], self.run.name)

    def test_fatal_exit_code_and_first_error(self):
        os.environ["FAKE_REPLAY_EXIT"] = "65"
        got = self.tools.shader_replay(NAME, dump=False)
        self.assertEqual(got["exit_code"], 65)
        self.assertIn("fatal", got["exit_meaning"])
        self.assertIn("bad", got["first_error"])
        self.assertIn("--no-dump", got["command"])
        os.environ["FAKE_REPLAY_EXIT"] = "66"
        self.assertIn("never recorded", self.tools.shader_replay(NAME)["exit_meaning"])

    def test_grep_with_context_and_paging(self):
        got = self.tools.shader_replay(NAME, grep=r"Op3$|ReadFirstLane|key_trace", context=1)
        self.assertEqual(got["matches"], 3)
        lines = got["text"].splitlines()
        self.assertEqual(lines[:3], ["4-  %2 = Op2", "5:  %3 = Op3", "6-  %4 = Op4"])
        self.assertEqual(lines[3], "--")
        self.assertTrue(lines[-1].startswith("43:REPLAY indirect_buffer_writes"), lines[-1])
        self.assertIn("42:  %7 = ReadFirstLane %6", lines)
        self.assertLess(len(lines), 12)
        with self.assertRaises(ka.HarnessError):
            self.tools.shader_replay(NAME, grep="(")

        whole = self.tools.shader_replay(NAME)["text"]
        first = self.tools.shader_replay(NAME, max_chars=100)
        self.assertTrue(first["truncated"])
        self.assertEqual(first["text"], whole[:100])
        second = self.tools.shader_replay(NAME, offset=first["next_offset"], max_chars=100)
        self.assertEqual(second["text"], whole[100:200])
        last = self.tools.shader_replay(NAME, offset=len(whole) - 5)
        self.assertEqual(last["text"], whole[-5:])
        self.assertFalse(last["truncated"])
        self.assertIsNone(last["next_offset"])

    def test_large_output_is_paged_and_survives_json(self):
        os.environ["FAKE_DUMP_LINES"] = "20000"
        got = self.tools.shader_replay(NAME)
        self.assertEqual(len(got["text"]), 60000)
        self.assertTrue(got["truncated"])
        self.assertGreater(got["total_chars"], 60000)
        self.assertEqual(json.loads(json.dumps(got))["next_offset"], 60000)

    def test_disasm_passes_pc_and_window(self):
        got = self.tools.shader_replay(NAME, mode="disasm", pc="0x86c", window=30)
        self.assertEqual(got["exit_code"], 0)
        self.assertIn("--shader-disasm", got["text"])
        self.assertIn("--pc 0x86c --window 30", got["text"])
        with self.assertRaises(ka.HarnessError):
            self.tools.shader_replay(NAME, mode="disasm", pc="$(id)")

    def test_replay_all_lists_failures(self):
        got = self.tools.shader_replay(mode="replay_all")
        self.assertEqual(got["exit_code"], 1)
        self.assertEqual(got["capture"], None)
        self.assertEqual(len(got["failures"]), 1)
        self.assertIn("FAIL(65)", got["failures"][0])
        self.assertIn("REPLAY-ALL 2 captures", got["summary_lines"][-1])
        self.assertEqual(sorted(p.name for p in (self.run / "capture").iterdir()),
                         sorted([NAME, "ps_0000000000000001_00000000"]))

    def test_refuses_bad_names_and_a_missing_emulator(self):
        for bad in ("../x", "cs_1_2/..", "nope", "cs_00_00"):
            with self.assertRaises(ka.HarnessError, msg=bad):
                self.tools.shader_replay(bad)
        for bad in ("..", "../runs", "/etc", "a/b", "missing"):
            with self.assertRaises(ka.HarnessError, msg=bad):
                self.tools.shader_replay(NAME, run=bad)
        with self.assertRaises(ka.HarnessError):
            self.tools.shader_replay(NAME, mode="shell")
        self.emulator.unlink()
        with self.assertRaises(ka.HarnessError) as caught:
            self.tools.shader_replay(NAME)
        self.assertIn("does not exist", str(caught.exception))

    def test_timeout_returns_what_was_printed(self):
        self.emulator.write_text("#!/bin/sh\necho started\nsleep 30\n")
        saved = mcp_server.REPLAY_TIMEOUT
        mcp_server.REPLAY_TIMEOUT = 1
        try:
            got = self.tools.shader_replay(NAME)
        finally:
            mcp_server.REPLAY_TIMEOUT = saved
        self.assertTrue(got["timed_out"])
        self.assertIsNone(got["exit_code"])
        self.assertEqual(got["exit_meaning"], "timed out")

    def test_works_while_a_game_is_running(self):
        self.tools.run_dir = self.run            # no exit.json: the game counts as running
        got = self.tools.shader_replay(NAME)
        self.assertEqual(got["exit_code"], 0)
        self.assertEqual(got["run"], self.run.name)


@unittest.skipUnless(HAVE_MCP, "the mcp package is not installed")
class OverHttp(unittest.TestCase):
    """The tool through the real server and remote_client.py, with a dump bigger than the page."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        build = Path(self.tmp.name) / "build"
        build.mkdir()
        emulator = build / "kyty_emulator"
        emulator.write_text(FAKE)
        emulator.chmod(0o755)
        (build / "_Autoplay" / "20260101-000000" / "capture" / NAME).mkdir(parents=True)
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        env = {**os.environ, "KYTY_BUILD_DIR": str(build), "FAKE_DUMP_LINES": "20000"}
        self.proc = subprocess.Popen([sys.executable, str(HERE.parent / "mcp_server.py"), "--http",
                                      "--port", str(port)], stdout=subprocess.DEVNULL,
                                     stderr=subprocess.PIPE, text=True, env=env)
        self.addCleanup(self.stop)
        banner = ""
        while not banner.endswith("\n}\n"):
            line = self.proc.stderr.readline()
            if not line:
                self.fail(f"server exited before printing its key:\n{banner}")
            banner += line
        self.key = re.search(r"^\s{6}(\S{40,})$", banner, re.M).group(1)
        self.url = f"http://127.0.0.1:{port}/mcp"
        for _ in range(100):
            try:
                socket.create_connection(("127.0.0.1", port), timeout=0.2).close()
                break
            except OSError:
                import time
                time.sleep(0.1)

    def stop(self):
        self.proc.terminate()
        try:
            self.proc.wait(timeout=10)
        except Exception:
            self.proc.kill()

    def test_remote_client_prints_a_60kb_page(self):
        saved = dict(os.environ)
        os.environ.update({"KYTY_REMOTE_URL": self.url, "KYTY_REMOTE_KEY": self.key})
        try:
            out = io.StringIO()
            args = {"name": NAME, "max_chars": 60000}
            with contextlib.redirect_stdout(out):
                asyncio.run(asyncio.wait_for(remote_client.call("shader_replay", args), 60))
        finally:
            os.environ.clear()
            os.environ.update(saved)
        got = json.loads(out.getvalue())
        self.assertEqual(got["exit_code"], 0)
        self.assertEqual(len(got["text"]), 60000)
        self.assertTrue(got["truncated"])
        self.assertIn("key_trace=select_guard", got["summary_lines"][0])


if __name__ == "__main__":
    unittest.main()
