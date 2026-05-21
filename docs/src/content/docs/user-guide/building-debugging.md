---
title: Building & Debugging Zephyr Projects
description: Build, flash, and debug Zephyr RTOS firmware with Cortex-Debug, ST-Link, J-Link, Black Magic Probe, and OpenOCD integration in VS Code. One-click build and debug workflow.
---

Build, flash, and debug commands are available from the Active Project Panel, the status bar, and the command palette.

## Building

![Taskbar Buttons](https://raw.githubusercontent.com/mylonics/zephyr-ide/main/docs/media/taskbar_buttons.gif)

## Setting Up Debug Configuration

The IDE for Zephyr ships with a built-in `zephyr-ide` debugger type that reads `runners.yaml` from the active build and translates it into a `cortex-debug` session automatically. With this provider in place, the **Debug**, **Build and Debug**, and **Debug Attach** buttons work out of the box on a freshly-created build — no `launch.json` entries are required.

If you do create a `launch.json`, the simplest possible configuration is:

```json
{
  "name": "Zephyr IDE: Debug",
  "type": "zephyr-ide",
  "request": "launch"
}
```

The provider picks the runner from `runners.yaml` (preferring `debug-runner`), looks up the ELF and GDB paths recorded there, sets `"rtos": "Zephyr"`, and passes the result to cortex-debug. To pin a specific runner explicitly, add a `"runner"` field (`"jlink"`, `"openocd"`, `"pyocd"`, `"stlink"`, `"bmp"`, etc.).

For users who need full control, the IDE also ships several `cortex-debug` snippets (their titles include "Cortex Debug" so they are easy to find in the *Add Configuration* picker). These cover Black Magic Probe and OpenOCD (ST-Link / nRF52) examples, including a `Debug Select` variant that prompts you for the build to attach to at launch time.

![Setting Up Launch Configuration](https://raw.githubusercontent.com/mylonics/zephyr-ide/main/docs/media/setting_up_debug.gif)

## Runner Profiles (Flash + Debug)

Each build can optionally reference one **active Runner Profile** that bundles three bind slots: **Flash** (drives both `Flash` and `Build and Flash`), **Debug** (drives both `Debug` and `Build and Debug`), and **Debug Attach**. Each slot is one of:

| Kind | Meaning |
|---|---|
| `auto` | Use `runners.yaml` defaults — `flash-runner` for Flash, `debug-runner` for Debug and Attach. |
| `runner` | A Zephyr runner directly (`openocd`, `jlink`, `pyocd`, `blackmagicprobe`, …) with optional `extraArgs`. |
| `launch` | A `launch.json` configuration by name. Available for the Debug and Attach slots only; ignored for Flash because flash actions never start a debug session. |

When **no** profile is active on a build, all three slots fall back to `auto`. This is the default for newly-created builds — `Flash` / `Debug` / `Build and Debug` / `Debug Attach` just work using whatever Zephyr recorded in `runners.yaml`.

Profiles can be defined once (e.g. a Black Magic Probe wired to `/dev/ttyACM0`, or an OpenOCD ST-Link configuration) and shared across builds. The dedicated **`Zephyr IDE: Open Runner Profile Panel`** command gives you a full CRUD UI for both workspace-scope (`.vscode/zephyr-ide.json#runnerProfiles`) and user-scope (`zephyr-ide.runnerProfiles` setting) profiles, including a "Use for active build" shortcut and a usage badge showing how many builds reference each profile.

The faster **Change…** button (or `Zephyr IDE: Select Active Runner Profile`) in the Project Build panel opens a QuickPick limited to switching the build's active profile. Per-build extra-argument overrides can be added with the pencil icon next to any `runner`-kind slot in the Project Build panel.

See [Runner Profiles in the Configuration reference](../reference/configuration.md#runner-profiles) for the full data model, scope and merge behaviour, per-build overrides, and legacy migration notes.

## Runner Args Variable Substitution

The `extraArgs` of any `runner`-kind bind slot (and per-build overrides) support VS Code–style `${...}` expressions resolved at flash/debug time. Unknown expressions are left intact for VS Code's own resolver.

| Expression | Resolves to |
|---|---|
| `${workspaceFolder}` | Workspace root path |
| `${buildFolder}` | Build output directory |
| `${board}` | Board name (e.g. `nucleo_f401re`) |
| `${boardRevision}` | Board revision, or `""` when not set |
| `${project}` | Project name |
| `${build}` | Build configuration name |
| `${buildvar:key}` | Per-build custom variable (`BuildConfig.customVars`) |
| `${projectvar:key}` | Per-project custom variable (`ProjectConfig.customVars`) |
| `${cmake:VAR}` | Value from `CMakeCache.txt` (case-insensitive; e.g. `${cmake:CMAKE_GDB}`) |
| `${kconfig:VAR}` | Kconfig value from `zephyr/.config` (with or without `CONFIG_` prefix; strings unquoted; unset symbols → `"n"`) |
| `${env:VAR}` | Environment variable, or `""` when unset |
| `${config:some.key}` | VS Code workspace/user configuration value |
| anything else | Left unchanged (VS Code resolves later) |

Custom build and project variables are managed with **`Zephyr IDE: Manage Build Variables`** and **`Zephyr IDE: Manage Project Variables`**, and can also be used in `tasks.json`/`launch.json` via the `zephyr-ide.get-active-build-variable` and `zephyr-ide.get-active-project-variable` input commands. See [Custom Variables](../reference/launch-configuration.md#custom-variables).

**Example** — Black Magic Probe serial port from a per-build variable:
```
--gdb-serial=${buildvar:bmp_port}
```

**Example** — J-Link device name from `CMakeCache.txt`:
```
--device=${cmake:JLINK_DEVICE} --speed=${cmake:JLINK_SPEED}
```

**Example** — board USB serial from Kconfig:
```
--gdb-serial=${kconfig:BOARD_BMP_GDB_PORT}
```

## Debug Prerequisites: Cortex-Debug

The `zephyr-ide` debugger type delegates the actual debug session to [`marus25.cortex-debug`](https://marketplace.visualstudio.com/items?itemName=marus25.cortex-debug). The first time you try to Debug:

- If **cortex-debug is not installed**, the session is aborted and a notification appears with **Open VS Code Marketplace** and **Open Open VSX** buttons that link directly to its install page on each registry.
- If the resolved runner is **Black Magic Probe** (`bmp`), the IDE also shows a one-time recommendation to install [`mylonics.bmp-debug`](https://marketplace.visualstudio.com/items?itemName=mylonics.bmp-debug) for Zephyr RTOS thread awareness. The recommendation only fires once and is silently skipped if `bmp-debug` is already installed.

## Launch Configuration Helper Commands

The IDE provides commands that help a user develop launch configurations. These include the following:

- `zephyr-ide.get-active-project-name`
- `zephyr-ide.get-active-project-path`
- `zephyr-ide.get-active-build-path`
- `zephyr-ide.get-active-build-board-path`
- `zephyr-ide.select-active-build-path`
- `zephyr-ide.get-gdb-path`
- `zephyr-ide.get-arm-gdb-path`
- `zephyr-ide.get-toolchain-path`
- `zephyr-ide.get-zephyr-dir`
- `zephyr-ide.get-zephyr-elf`
- `zephyr-ide.get-zephyr-elf-dir`
- `zephyr-ide.get-zephyr-ide-json-variable`
- `zephyr-ide.get-active-project-variable`
- `zephyr-ide.get-active-build-variable`
- `zephyr-ide.get-active-board-name`

The Debug Select Configuration allows a user to select what project/build to debug for and uses `zephyr-ide.select-active-build-path`, the other two default configurations use the `zephyr-ide.get-active-build-path` to debug the current active project as shown in the taskbar or active project panel.

![IDE for Zephyr Debug Commands](https://raw.githubusercontent.com/mylonics/zephyr-ide/main/docs/media/setting_up_debug2.gif)

## Next Steps

- [Test your project with Twister](testing.md)
- [Learn about other features](other-features.md)
- [See all available commands](../reference/commands.md)
