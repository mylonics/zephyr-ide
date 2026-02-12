---
title: Build and Debug Zephyr Projects - Complete Guide to Development Workflow
description: Build, flash, and debug Zephyr RTOS projects with cortex-debug integration. Set up launch configurations, use helper commands, and debug with ST-Link, Black Magic Probe, and OpenOCD.
keywords: Zephyr debugging, build Zephyr, flash firmware, cortex-debug, launch configuration, ST-Link, Black Magic Probe, OpenOCD, GDB debugging
---

# Building and Debugging A Project

The project may now be built. This can be done with the Active Project Panel or Taskbar buttons. There are options to build pristine, build, flash and debug. The taskbar also displays the active project.

## Building

![Taskbar Buttons](https://raw.githubusercontent.com/mylonics/zephyr-ide/main/docs/media/taskbar_buttons.gif)

## Setting Up Debug Configuration

To debug, launch configurations need to be setup. By default, Zephyr IDE provides 4 examples using cortex-debug. The examples use cortex debug and have a blackmagic probe and st-link configuration. There is a Debug and Attach configuration for each. The OpenOCD examples are configured for stlink and nrf52. A fifth example is also available called the Debug Select Configuration.

![Setting Up Launch Configuration](https://raw.githubusercontent.com/mylonics/zephyr-ide/main/docs/media/setting_up_debug.gif)

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
- `zephyr-ide.get-zephyr-elf`
- `zephyr-ide.get-zephyr-elf-dir`
- `zephyr-ide.get-zephyr-ide-json-variable`
- `zephyr-ide.get-active-project-variable`
- `zephyr-ide.get-active-build-variable`
- `zephyr-ide.get-active-board-name`

The Debug Select Configuration allows a user to select what project/build to debug for and uses `zephyr-ide.select-active-build-path`, the other two default configurations use the `zephyr-ide.get-active-build-path` to debug the current active project as shown in the taskbar or active project panel.

![Zephyr IDE Debug Commands](https://raw.githubusercontent.com/mylonics/zephyr-ide/main/docs/media/setting_up_debug2.gif)

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
