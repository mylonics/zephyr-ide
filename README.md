# IDE for Zephyr — Zephyr RTOS Development in VS Code

<img src="https://raw.githubusercontent.com/mylonics/zephyr-ide/main/docs/media/zephyr-ide_branding.png" alt="IDE for Zephyr — VS Code extension for Zephyr RTOS embedded development with west, SDK, build, flash, and debug" width="50%"/>

IDE for Zephyr is a Visual Studio Code extension that provides a complete embedded development environment for [Zephyr RTOS](https://zephyrproject.org/) projects. It automates SDK installation, west workspace management, building, flashing, and debugging — supporting ARM Cortex-M, RISC-V, ESP32, STM32, Nordic nRF, Raspberry Pi Pico, and all Zephyr-supported platforms.

An [extension pack](https://marketplace.visualstudio.com/items?itemName=mylonics.zephyr-ide-extension-pack) is available that bundles Cortex-Debug, C/C++ IntelliSense, Serial Monitor, Devicetree LSP, and CMake support.

You can read about the motivation behind the project [here](https://mylonics.com/blog/zephyr-ide-for-vscode/).

![IDE for Zephyr Setup Panel](https://raw.githubusercontent.com/mylonics/zephyr-ide/main/docs/media/setup_panel.png)

## Features

### Workspace Setup & SDK Management
  - Installs host tools required for Zephyr development (CMake, Python, DTC, gcc)
  - Sets up west environment with built-in west.yml templates or your own manifest
  - Installs and manages Zephyr SDK versions via west SDK commands
  - Supports multiple architectures: ARM, RISC-V, x86, Xtensa, and more

### Project Management & Build System
  - Add projects from scratch or from Zephyr sample templates
  - Multiple projects per workspace with multiple builds per project
  - Per-project and per-build KConfig overlay and Devicetree overlay files
  - Per-build board selection, runner configuration, and west/CMake argument customization
  - Human-readable JSON project configuration for easy version control

### Debugging & Flashing
  - Bind builds to launch/debug configurations for one-click debugging
  - Cortex-Debug integration with ST-Link, Black Magic Probe, J-Link, and OpenOCD
  - Launch configuration helper commands for dynamic project/build path resolution
  - Flash to target hardware with configurable runners

### Developer Productivity
  - Project tree GUI panel and active project status bar
  - Automatic active project selection based on the file open in the editor
  - West terminal for manual west commands
  - MenuConfig and GuiConfig for Kconfig editing
  - ROM/RAM usage reports and DTSh devicetree shell
  - Twister test framework integration
  - Cross-platform: Linux, macOS, and Windows

## Externally Managed Environments

IDE for Zephyr automatically detects and works with externally managed Zephyr environments:

- Automatic detection via `ZEPHYR_BASE` environment variable
- No setup required when using Docker, DevContainers, or pre-configured environments
- Full support for build, flash, and debug operations
- Configurable warning suppression via `zephyr-ide.suppress-workspace-warning`

Ideal for Docker/container workflows, CI/CD pipelines, shared development environments, and pre-installed Zephyr setups.

See the [External Environments](https://zephyr-ide.mylonics.com/getting-started/external-environments/) documentation for details.

## Getting Started

The [User Manual](https://zephyr-ide.mylonics.com/) is available online, or you can read it locally at [docs/MANUAL.md](docs/MANUAL.md).

### Video Tutorials

[![Getting Started with IDE for Zephyr](https://mylonics.com/assets/images/zephyr-ide/getting_started_thumbnail.png)](https://www.youtube.com/watch?v=Asfolnh9kqM&t "Getting Started with IDE for Zephyr")

[![STM32 Board Setup And Debugging with IDE for Zephyr](https://mylonics.com/assets/images/zephyr-ide/board_setup_thumbnail.png)](https://www.youtube.com/watch?v=TXcTzyswBMQ)

You can also check out the [sample project](https://github.com/mylonics/zephyr-ide-sample-project) for a quick-start example.

## Requirements

This extension can automatically install host tools required for Zephyr development on supported platforms (Ubuntu/Debian, macOS, Windows). The automated installation follows the [Zephyr Getting Started Guide](https://docs.zephyrproject.org/latest/develop/getting_started/index.html#install-dependencies) and installs tools such as **CMake**, **Python 3**, **Ninja**, and **Devicetree Compiler**.

For unsupported platforms, install the required packages using your platform's package manager and consider opening an issue or pull request at the [zephyr-ide repository](https://github.com/mylonics/zephyr-ide).

## Testing

This extension includes integration tests that validate the full IDE for Zephyr workflow. For details, see [docs/TESTING.md](docs/TESTING.md).

## Known Issues

- **Dev containers with WSL and Windows folders**: When using dev containers in a WSL environment, ensure your workspace folder is within the Ubuntu file system (e.g., `/home/username/project`) rather than mounted Windows directories (e.g., `/mnt/c/Users/...`). This is inherent to the west boards command.

## Release Notes

See [CHANGELOG](CHANGELOG.md) for release notes.

## Development and Debugging

See the [IDE for Zephyr Developer's Guide](https://zephyr-ide.mylonics.com/developer-guide/) for development and debugging instructions.

---
