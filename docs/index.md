---
title: Zephyr IDE for VS Code - Professional Zephyr RTOS Development Extension
description: Professional VS Code extension for Zephyr RTOS development. Automated SDK installation, west integration, project management, debugging tools, and build automation for embedded systems development.
keywords: Zephyr RTOS, VS Code extension, embedded development, Zephyr IDE, west tool, IoT development, firmware development, Zephyr SDK, debugging, embedded systems
---

# Zephyr IDE for VS Code

The Zephyr IDE for VS Code extension provides tools to assist in your Zephyr project development workflow. This extension helps you build Zephyr projects and share them with your team.

An [extension pack](https://marketplace.visualstudio.com/items?itemName=mylonics.zephyr-ide-extension-pack) is available that bundles in additional tools.

You can read a little bit more about the motivation behind the project [here](https://mylonics.com/blog/zephyr-ide-for-vscode/).

![Zephyr IDE Setup Panel](https://raw.githubusercontent.com/mylonics/zephyr-ide/main/docs/media/setup_panel.png)

## Features

- Installs host tools required for Zephyr development
- Sets up west environment
- Installs Zephyr SDK using West SDK commands
- Provides west.yml templates or use your own
- Able to use externally managed environments via `ZEPHYR_BASE` environment variable
- Add projects from scratch or from templates
- Multiple projects per workspace
- Multiple builds per project
- Per project KConfig and overlay files
- Per build board, KConfig, overlay files, and runner configuration
- Bind builds to launch/debug configurations
- Project tree GUI panel and active project panel
- Automatic active project selection based on active file in editor
- All GUI commands available in command palette
- Functions to set up custom launch/debug configurations
- West terminal for manual west commands
- Saves/loads project structure to workspace in human readable and editable file
- Cross-platform support for all Zephyr-supported platforms
- Twister testing support

## Quick Links

- [Getting Started](getting-started/installation.md) - Install and set up Zephyr IDE
- [User Guide](user-guide/project-setup.md) - Learn how to use Zephyr IDE
- [Commands Reference](reference/commands.md) - Complete command reference
- [Configuration Settings](reference/configuration.md) - Available settings
- [Developer Guide](developer-guide.md) - Contributing to Zephyr IDE
- [Changelog](changelog.md) - Release notes

## Requirements

This extension can automatically install host tools required for Zephyr development on supported platforms. The automated installation follows the methods described in the [Zephyr Getting Started Guide](https://docs.zephyrproject.org/latest/develop/getting_started/index.html#install-dependencies) and installs tools such as **cmake**, **python3**, and **devicetree compiler**.

For installation on unsupported platforms, install the required packages from the getting started guide using your platform's package manager and consider making an issue or pull request for that specific platform at the zephyr-ide repository.

## Testing

This extension includes integration tests that validate the Zephyr IDE workflow. For more details, see the [GitHub repository](https://github.com/mylonics/zephyr-ide).

## Getting Help

- **Issues**: [GitHub Issues](https://github.com/mylonics/zephyr-ide/issues)
- **Discussions**: [GitHub Discussions](https://github.com/mylonics/zephyr-ide/discussions)
- **Sample Project**: [Zephyr IDE Sample Project](https://github.com/mylonics/zephyr-ide-sample-project)

## Video Tutorials

[![Getting Started with Zephyr IDE](https://mylonics.com/assets/images/zephyr-ide/getting_started_thumbnail.png)](https://www.youtube.com/watch?v=Asfolnh9kqM&t "Getting Started with Zephyr IDE")

[![STM32 Board Setup And Debugging with Zephyr IDE](https://mylonics.com/assets/images/zephyr-ide/board_setup_thumbnail.png)](https://www.youtube.com/watch?v=TXcTzyswBMQ)
