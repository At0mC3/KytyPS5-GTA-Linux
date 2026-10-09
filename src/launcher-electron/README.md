# KytyPS5 Launcher (Electron)

A console-style launcher for the KytyPS5 emulator that works with a controller, a keyboard or a
mouse. It runs next to the Qt launcher (`src/launcher`) and shares its settings file, so either
launcher can be used with the same games and configs.

![Home](../../docs/screenshots/launcher-home.png)

## Features

- **Dashboard**: a row of game tiles with the selected one enlarged, the game's art full screen
  behind it, a Play button, an options menu, and cards for trophies, compatibility, game settings
  and cheats. A grid **Game Library** with sorting, and search.
- **GPU rendering**: Chromium draws the UI on the GPU, and a WebGL 2 shader draws the background:
  the game art with a slow drift, cross-fades between games, moving light bands and a blur
  behind menus. Without WebGL 2, a CSS version is used. Animations change only `transform` and
  `opacity`, so the compositor runs them.
- **Full screen**: F11, the Create (View) button, *Settings → Launcher → Full screen*, or
  `--fullscreen` on the command line. The choice is remembered.
- **Every Qt launcher setting**: user profile, graphics and display, audio, notifications,
  compatibility, debugging and logs, controller (lightbar color with live preview, vibration,
  speaker volume), keyboard and mouse input mapping, game folders, and game config import/export.
  Per-game settings work like in the Qt launcher: saving creates a full copy of the settings.
- **Also ported**: trophies (per game and overview), cheats (remote collection and local
  selection), compatibility status (editable with `--local`), remove save data, open game
  folder, the GTA V recommended-settings prompt, and update checks in official builds.
- **Emulator log**: the emulator runs without a terminal window; its output appears in the
  log console with colors.

## Controls

| Action | DualSense | Xbox | Keyboard |
|---|---|---|---|
| Move | D-pad, left stick | D-pad, left stick | Arrow keys |
| Select | Cross | A | Enter |
| Back | Circle | B | Esc, Backspace |
| Options (game menu, Save in settings) | Options | Menu | O |
| Search; delete on the keyboard | Square | X | S |
| Game settings; space on the keyboard | Triangle | Y | I |
| Previous / next tab or category | L1 / R1 | LB / RB | Q / E, Shift+Tab / Tab |
| Page up / down | L2 / R2 | LT / RT | Page Up / Page Down |
| Full screen | Create | View | F11 |
| Home | PS | Guide | Home |

Cross and Circle can be swapped in *Settings → Launcher*. Text fields open an on-screen
keyboard, and game folders can be added with a controller-friendly folder browser. The mouse
works everywhere too.

If the controller is not detected (some Bluetooth setups), set *Settings → Launcher →
Controller input* to *Emulator (SDL)*: the launcher then reads the controller through
`kyty_emulator --query controller`.

## Settings file

The launcher reads and writes the Qt launcher's `Kyty.ini` (QSettings INI format), in the same
places: `./Kyty.ini` when it exists, else `Kyty.ini` next to the emulator, else
`~/.config/Kyty/Kyty.ini` on Linux, `%ProgramData%\Kyty\Kyty.ini` on Windows, or Qt's system
settings path on macOS. It keeps keys it does not use, such as the Qt launcher's window
geometry, and stores its own preferences in an `[ElectronLauncher]` section. Avoid saving
settings in both launchers at the same time.

## Command line

| Option | Effect |
|---|---|
| `--fullscreen` | Start in full screen. |
| `--emulator=<path>` | Use this `kyty_emulator` (also `KYTY_EMULATOR`). By default the launcher looks next to itself and in the parent folders. |
| `--local` | Read and edit the compatibility list in `./compatibility_db.json`. |
| `--self-test` | Print what the launcher found (emulator, devices, settings file, games) as JSON and exit. |

## How it talks to the emulator

GPU names, microphones, `.zar` archive contents and trophies come from the emulator itself
(`kyty_emulator --query info|archives|trophies|controller`, see `src/query/launcherQuery.h`), so
the GPU list is in the order `--gpu <index>` uses. With an older emulator without `--query`, the
launcher still runs games but shows only "Auto" for the GPU and no archive art or trophies.

Games start with the same arguments, in the same order, as from the Qt launcher.

## Development

Needs Node.js 22.12 or later.

```sh
cd src/launcher-electron
npm ci
npm run dev          # Start with hot reload; set KYTY_EMULATOR to a built kyty_emulator
npm run typecheck
npm test             # Unit tests (Vitest)
npm run build
xvfb-run -a npx playwright test   # End-to-end tests with a fake emulator (Linux)
```

End-to-end tests start the built app (`npm run build` first) with fixture games and
`test/fake-emulator/kyty_emulator`, drive it with a simulated controller, and save screenshots
to `test-results/screenshots`. Useful variables: `KYTY_E2E_SWIFTSHADER=1` to test the WebGL
background on machines without a GPU, `KYTY_E2E_SIZE=1080` for 1920x1080 screenshots, and
`KYTY_REAL_EMULATOR=<path>` to also test against a built emulator.

## Packaging

```sh
npm run package                                   # dist/<platform>-unpacked
node scripts/copy-to-install.mjs <install-dir>    # next to kyty_emulator
```

This adds `launcher-electron/` and `kyty-launcher.sh` on Linux, `launcher-electron/` and
`KytyPS5 Launcher.cmd` on Windows, and `KytyPS5 Launcher.app` on macOS. CI does this in every
platform job, so release archives contain both launchers.

On Linux, start the launcher with `kyty-launcher.sh`. Chromium's sandbox needs user namespaces;
where the system restricts them (Ubuntu 24.04's AppArmor setting, some Debian kernels) and
`chrome-sandbox` is not setuid root, the script starts the launcher with `--no-sandbox`.

## Code layout

| Folder | Contents |
|---|---|
| `src/main` | Electron main process: `Kyty.ini` (`settings/`), game scanning (`library/`), launching and `--query` (`emulator/`), cheats, compatibility, updates, the `kyty://` protocol and IPC. |
| `src/preload` | The `window.kyty` API bridge. |
| `src/shared` | Settings model, input mapping and IPC types used by both sides. |
| `src/renderer` | The UI (React): screens, controller input and focus (`input/`, `focus/`), the WebGL background (`gfx/`), styles. |
| `test` | Fixtures, the fake emulator and Playwright tests. |

## Not verified on real hardware yet

These need a person with the hardware:

- The GPU list order on a computer with several GPUs.
- DualSense over USB and Bluetooth: navigation and the lightbar preview.
- Controller input in the launcher on Windows over Bluetooth after playing a game.
- The settings file location and permissions on macOS.
- Starting from the Linux release archive on Ubuntu 24.04 (the sandbox fallback).
