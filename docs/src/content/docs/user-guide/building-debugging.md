---
title: Building & Debugging Zephyr Projects
description: Build, flash, and debug Zephyr RTOS firmware with Cortex-Debug, ST-Link, J-Link, Black Magic Probe, and OpenOCD integration in VS Code. One-click build and debug workflow.
---

The project may now be built. This can be done with the Active Project Panel or Taskbar buttons. There are options to build pristine, build, flash and debug. The taskbar also displays the active project.

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

## Runner Configurations (Flash + Debug)

Each build can optionally have one **active Runner Configuration** that controls four targets: **Flash**, **Build & Debug**, **Debug** (launch), and **Debug Attach**. Each target is one of:

| Kind | Meaning |
|---|---|
| `auto` | Use `runners.yaml` defaults — `flash-runner` for Flash, `debug-runner` for the debug targets. |
| `runner` | A Zephyr runner directly (`openocd`, `jlink`, `pyocd`, `blackmagicprobe`, …) with optional `extraArgs`. |
| `variant` | A reusable variant from `zephyr-ide.runnerVariants` (settings.json) or `runnerVariants` in `.vscode/zephyr-ide.json`. `extraArgs` are **appended** to the variant's `args`. |
| `launch` | A `launch.json` configuration by name. Available for the three debug targets only; ignored for Flash. |

When **no** runner configuration is active on a build, all four targets fall back to `auto`. This is the default for newly-created builds — `Flash` / `Debug` / `Build & Debug` / `Attach` just work using whatever Zephyr recorded in `runners.yaml`.

Reusable runner variants can be defined once (e.g. a Black Magic Probe wired to `/dev/ttyACM0`, or an OpenOCD ST-Link configuration) and referenced across builds. See [Runner Configurations in the Configuration reference](../reference/configuration.md#runner-configurations) for the full data model, defining variants in user vs. workspace scope, and the legacy-config migration notes.

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

## Custom Variables in Launch Configuration

If there is a variable you want associated with a project/build that needs to be available for your launch configuration, you can use the `zephyr-ide.get-active-project-variable` or `zephyr-ide.get-active-build-variable`.

In your `zephyr-ide.json` file, create a `vars` variable in your project or the buildConfig and define a custom variable:

**zephyr-ide.json**:
```json
{
  "projects": {
    "blinky": {
      "name": "blinky",
      "vars": {
        "custom_var": "custom_var"
      },
      "buildConfigs": {
        "build\\stm32f4_disco": {
          "relBoardDir": "external\\zephyr\\boards",
          "board": "stm32f4_disco",
          "relBoardSubDir": "external\\zephyr\\boards\\st\\stm32f4_disco",
          "vars": {
            "jlink_var": "STM32F401RE",
            "bmp_port": "COM3"
          }
        }
      }
    }
  }
}
```

Then in launch.json you can access the variable using the input command:

**launch.json**:
```json
{
  "inputs": [
    {
      "id": "getCustomBuildVariable",
      "type": "command",
      "command": "zephyr-ide.get-active-build-variable",
      "args": "bmp_port"
    }
  ],
  "configurations": [    
    {
      "name": "Zephyr IDE: Debug",
      "BMPGDBSerialPort": "${input:getCustomBuildVariable}"
    }
  ]
}
```

## Next Steps

- [Test your project with Twister](testing.md)
- [Learn about other features](other-features.md)
- [See all available commands](../reference/commands.md)
