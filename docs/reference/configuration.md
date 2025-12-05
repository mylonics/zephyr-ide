---
title: Zephyr IDE Configuration Settings - Customize Your Development Environment
description: Complete guide to Zephyr IDE VS Code settings including tools directory, GUI config, west narrow update, and workspace warning suppression.
keywords: Zephyr IDE settings, VS Code configuration, tools directory, GUI config, west settings, workspace configuration, extension settings
---

# Configuration Settings

The following settings are available in VS Code settings (File > Preferences > Settings):

## `zephyr-ide.tools_directory`

- **Type**: String or null
- **Default**: null
- **Description**: Manually specify a tools directory for SDK installation and global Zephyr install location

This setting allows you to override the default location where the SDK and Zephyr tools are installed. Useful for shared environments or when you need to install tools in a specific location.

## `zephyr-ide.use_gui_config`

- **Type**: Boolean
- **Default**: false
- **Description**: Display GUI config instead of menu config in Project Tree View

When enabled, the extension will use the graphical Kconfig interface instead of the text-based menu config when configuring projects.

## `zephyr-ide.westNarrowUpdate`

- **Type**: Boolean
- **Default**: false
- **Description**: If true, uses 'west update --narrow'. If false, uses 'west update' without --narrow.

The `--narrow` flag tells west to only clone the most recent commit history, which can save disk space and download time. This is useful for CI/CD environments or when you don't need the full git history.

## `zephyr-ide.suppress-workspace-warning`

- **Type**: Boolean
- **Default**: false
- **Description**: If true, suppresses the warning about missing workspace environment variables (ZEPHYR_BASE, ZEPHYR_SDK_INSTALL_DIR).

Use this setting when working with externally managed environments to prevent the extension from showing warnings about missing workspace configuration.

## `zephyr-ide.venv-folder`

- **Type**: String or null
- **Default**: null
- **Description**: Manually specify a Python virtual environment folder path. If not specified, defaults to .venv in the workspace setup path.

This allows you to use a custom location for the Python virtual environment instead of the default `.venv` folder in your workspace.

## Next Steps

- [See all available commands](commands.md)
- [Learn about launch configuration helpers](launch-configuration.md)
