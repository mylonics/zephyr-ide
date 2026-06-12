---
title: Launch Configuration Helpers
description: Dynamic launch.json helper commands for Zephyr debugging — get active project paths, GDB paths, toolchain paths, ELF file paths, board names, and custom build variables with IDE for Zephyr.
---

The simplest way to debug a Zephyr build with this extension is to use the `zephyr-ide-cortex` debugger type, which reads `runners.yaml` from the active build and translates it to a `cortex-debug` configuration automatically:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Zephyr IDE: Debug",
      "type": "zephyr-ide-cortex",
      "request": "launch"
    }
  ]
}
```

You can optionally pin a specific runner (when more than one is configured) by adding a `"runner"` field — e.g. `"runner": "openocd"` or `"runner": "jlink"`. When `runner` is omitted the extension uses `debug-runner` from `runners.yaml`, falling back to the first available runner. The `Debug`, `Build and Debug`, and `Debug Attach` commands also use this provider automatically when no launch configuration is bound to the active build.

Use the `ask` field to control build selection at launch time:

| Value | Behaviour |
|---|---|
| `"auto"` (default) | Use the active project and build silently. |
| `"askBuild"` | Use the active project; prompt for which build to debug. |
| `"askProject"` | Prompt for project; use that project's active build. |
| `"askBoth"` | Prompt for both project and build. |

The `zephyr-ide-cortex` and `zephyr-ide-west` debuggers delegate the actual debug session to [`marus25.cortex-debug`](https://marketplace.visualstudio.com/items?itemName=marus25.cortex-debug). If cortex-debug is not installed, the session is aborted with a notification offering install links for the VS Code Marketplace and Open VSX. When the resolved runner is Black Magic Probe (`blackmagicprobe`), a one-time recommendation suggests installing [`mylonics.bmp-debug`](https://marketplace.visualstudio.com/items?itemName=mylonics.bmp-debug) for Zephyr RTOS thread awareness.

For a higher-level alternative that does not require any `launch.json` at all, configure an active [Runner Profile](configuration.md#runner-profiles) on the build — its `debug` and `attach` binds can point at a Zephyr runner, a `launch.json` configuration by name, or be left on `auto` to use `runners.yaml` defaults. The `debug` bind drives both `Zephyr IDE: Debug` and `Zephyr IDE: Build and Debug`; `attach` drives `Zephyr IDE: Debug Attach`.

### Bridged runners and external GDB servers

Some runners (nrfjprog, linkserver, esp32, stm32cubeprogrammer, probe-rs) have no native cortex-debug servertype. Use `zephyr-ide-west` for these flows: it spawns `west debugserver --runner <runner>` in the background, reads the GDB port it announces on stdout, and connects cortex-debug as `servertype: "external"`. If the port is not detected within 10 seconds, Zephyr IDE falls back to the runner's default port and emits a warning.

`zephyr-ide-west` includes curated launch fields for common west arguments. Runner-specific options use unprefixed names (e.g. `device`, `speed`, `config`, `chip`) while older common fields keep the `west` prefix for backward compatibility. `westArgs` is preserved for full passthrough coverage of any flag not yet modeled.

To connect to an **already-running** GDB server (Segger Ozone, a vendor IDE, or a manually started server) instead of having Zephyr IDE spawn one, add `"gdbTarget": "host:port"` to the configuration. This suppresses the bridge auto-spawn for bridged runners and passes the address directly to cortex-debug.

```json
{
  "name": "Zephyr IDE: External GDB (nrfjprog)",
  "type": "zephyr-ide-west",
  "request": "launch",
  "runner": "nrfjprog",
  "gdbTarget": "127.0.0.1:2331"
}
```

If you need finer control you can still write a `cortex-debug` configuration directly using the helper commands listed below.

The following commands can be used in launch.json configurations to dynamically retrieve project and build information:

## Available Commands

### `zephyr-ide.get-active-project-name`

Get the name of the currently active project.

### `zephyr-ide.get-active-project-path`

Get the file system path to the currently active project.

### `zephyr-ide.get-active-build-path`

Get the file system path to the build directory of the currently active build configuration.

### `zephyr-ide.get-active-build-board-path`

Get the file system path to the board directory for the currently active build.

### `zephyr-ide.select-active-build-path`

Prompts the user to select a build configuration and returns its path. Useful for debug configurations that allow selecting which build to debug.

### `zephyr-ide.get-gdb-path`

Get the path to the GDB executable for the active build. The path is read from the `CMAKE_GDB` variable in the CMake cache after a build completes. This typically returns the Python-enabled GDB variant (e.g. `arm-zephyr-eabi-gdb-py`).

### `zephyr-ide.get-arm-gdb-path`

Get the path to the ARM GDB executable (without Python support) for the active build. This takes the `CMAKE_GDB` path and replaces the Python-enabled variant (e.g. `arm-zephyr-eabi-gdb-py`) with the plain variant (`arm-zephyr-eabi-gdb`).

### `zephyr-ide.get-toolchain-path`

Get the path to the toolchain directory for the active build.

### `zephyr-ide.get-zephyr-elf`

Get the full path to the Zephyr kernel ELF file for the active build. The ELF filename is read from the `BYPRODUCT_KERNEL_ELF_NAME` variable in the CMake cache after a build completes. Falls back to `zephyr.elf` if the CMake cache has not been generated yet. This command replaces the previous pattern of `${command:zephyr-ide.get-active-build-path}/${command:zephyr-ide.get-active-project-name}/zephyr/zephyr.elf`.

### `zephyr-ide.get-zephyr-elf-dir`

Get the directory containing the Zephyr kernel ELF file for the active build. This is the `zephyr` subdirectory within the build output directory.

### `zephyr-ide.get-zephyr-ide-json-variable`

Get a variable value from the zephyr-ide.json file.

### `zephyr-ide.get-active-project-variable`

Get a custom variable defined in the active project's `customVars` map.

### `zephyr-ide.get-active-build-variable`

Get a custom variable defined in the active build configuration's `customVars` map.

### `zephyr-ide.get-active-board-name`

Get the board name for the currently active build configuration.

## Legacy / Advanced: Direct cortex-debug Configuration

Example `cortex-debug` configuration (use this when you need full control over GDB server arguments; otherwise prefer the simpler `zephyr-ide-cortex` launch shown above, which reads `runners.yaml` automatically):

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Zephyr IDE: Debug",
      "type": "cortex-debug",
      "request": "launch",
      "cwd": "${workspaceFolder}",
      "executable": "${command:zephyr-ide.get-zephyr-elf}",
      "servertype": "openocd",
      "device": "${command:zephyr-ide.get-active-board-name}",
      "armToolchainPath": "${command:zephyr-ide.get-toolchain-path}/bin"
    }
  ]
}
```

## Custom Variables

You can attach a `customVars` map to any project or build configuration and access those variables from `tasks.json`, `launch.json`, and runner profile args.

Variables are edited interactively with the **`Zephyr IDE: Manage Build Variables`** and **`Zephyr IDE: Manage Project Variables`** commands, or written directly to `.vscode/zephyr-ide.json`.

**Stored in `.vscode/zephyr-ide.json`**:
```json
{
  "projects": {
    "myproject": {
      "name": "myproject",
      "rel_path": "apps/myproject",
      "customVars": {
        "debug_port": "COM3",
        "jlink_device": "STM32F401RE"
      },
      "buildConfigs": {
        "debug": {
          "name": "debug",
          "board": "nucleo_f401re",
          "relBoardDir": "zephyr/boards/st",
          "relBoardSubDir": "nucleo_f401re",
          "compilerOptimization": "debug",
          "westBuildArgs": [],
          "westBuildCMakeArgs": [],
          "confFiles": { "config": [], "overlay": [] },
          "customVars": {
            "bmp_port": "/dev/ttyACM0"
          }
        }
      },
      "confFiles": { "config": [], "overlay": [] },
      "twisterConfigs": {}
    }
  }
}
```

**Using in `launch.json`** (VS Code `input` command):
```json
{
  "inputs": [
    {
      "id": "debugPort",
      "type": "command",
      "command": "zephyr-ide.get-active-project-variable",
      "args": "debug_port"
    },
    {
      "id": "bmpPort",
      "type": "command",
      "command": "zephyr-ide.get-active-build-variable",
      "args": "bmp_port"
    }
  ],
  "configurations": [
    {
      "name": "Debug",
      "serialNumber": "${input:debugPort}"
    }
  ]
}
```

**Using in runner profile `extraArgs`** (resolved at flash/debug time):
```
--gdb-serial=${buildvar:bmp_port}
--device=${projectvar:jlink_device} --speed=4000
```

See [Runner Profile variable substitution](../user-guide/building-debugging.md#runner-args-variable-substitution) for the full variable table including `${cmake:KEY}`, `${kconfig:VAR}`, and `${env:VAR}`.

## Next Steps

- [See all available commands](commands.md)
- [Learn about building and debugging](../user-guide/building-debugging.md)
