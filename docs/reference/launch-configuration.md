---
title: Launch Configuration Helpers - Dynamic Debug Configuration Commands
description: Use Zephyr IDE helper commands in launch.json for dynamic project and build information. Get active project paths, GDB paths, toolchain paths, and custom variables.
keywords: launch configuration, debug configuration, GDB path, toolchain path, launch.json helpers, dynamic configuration, debug commands
---

# Launch Configuration Helper Commands

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

Get a custom variable defined in the active project's `vars` section.

### `zephyr-ide.get-active-build-variable`

Get a custom variable defined in the active build configuration's `vars` section.

### `zephyr-ide.get-active-board-name`

Get the board name for the currently active build configuration.

## Usage Example

Here's an example of using these commands in a launch.json file:

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

You can define custom variables in your zephyr-ide.json file and access them in your launch configurations:

**zephyr-ide.json**:
```json
{
  "projects": {
    "myproject": {
      "vars": {
        "debug_port": "COM3",
        "jlink_device": "STM32F401RE"
      }
    }
  }
}
```

**launch.json**:
```json
{
  "inputs": [
    {
      "id": "debugPort",
      "type": "command",
      "command": "zephyr-ide.get-active-project-variable",
      "args": "debug_port"
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

## Next Steps

- [See all available commands](commands.md)
- [Learn about building and debugging](../user-guide/building-debugging.md)
