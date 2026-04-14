---
title: Configuration Settings
description: All IDE for Zephyr VS Code settings — global directory, toolchain directory, GUI config, west narrow update, virtual environment path, and workspace warning suppression.
---

The following settings are available in VS Code settings (File > Preferences > Settings):

## `zephyr-ide.globalDirectory`

- **Type**: String or null
- **Default**: null
- **Description**: Manually specify a global directory for west workspace installation and Zephyr tools

This setting replaces the deprecated `zephyr-ide.tools_directory`. It controls the root location used for west workspace setup, Python virtual environments, and (by default) SDK toolchain installations. Useful for shared environments or when you need to install tools in a specific location.

## `zephyr-ide.tools_directory`

- **Type**: String or null
- **Default**: null
- **Deprecated**: Use `zephyr-ide.globalDirectory` instead. The extension automatically migrates this setting on startup.

## `zephyr-ide.toolchainDirectory`

- **Type**: String or null
- **Default**: null
- **Description**: Manually specify the directory containing Zephyr SDK installations (e.g., containing zephyr-sdk-0.17.0, zephyr-sdk-0.17.3 subdirectories). If not specified, defaults to toolchains subdirectory within the tools directory.

This setting allows you to use a custom location for SDK installations. The directory should contain one or more Zephyr SDK installations with names like `zephyr-sdk-0.17.0`, `zephyr-sdk-0.17.3`, etc. The extension will automatically detect and use the latest version.

**Example:**
```json
{
  "zephyr-ide.toolchainDirectory": "/opt/zephyr-sdks"
}
```

With this configuration, the extension will look for SDKs in `/opt/zephyr-sdks/zephyr-sdk-0.17.0`, `/opt/zephyr-sdks/zephyr-sdk-0.17.3`, etc.

## `zephyr-ide.useGuiConfig`

- **Type**: Boolean
- **Default**: false
- **Description**: Use GUI configuration editor instead of terminal-based menuconfig in the Project Tree View.

When enabled, the extension will use the graphical Kconfig interface instead of the text-based menu config when configuring projects.

## `zephyr-ide.westNarrowUpdate`

- **Type**: Boolean
- **Default**: false
- **Description**: Use 'west update --narrow' to reduce disk usage and download time by fetching only required Git history.

The `--narrow` flag tells west to only clone the most recent commit history, which can save disk space and download time. This is useful for CI/CD environments or when you don't need the full git history.

## `zephyr-ide.suppressWorkspaceWarning`

- **Type**: Boolean
- **Default**: false
- **Description**: Hide the notification about missing ZEPHYR_BASE and ZEPHYR_SDK_INSTALL_DIR environment variables. Enable this if you manage these variables externally.

Use this setting when working with externally managed environments to prevent the extension from showing warnings about missing workspace configuration.

## `zephyr-ide.venvFolder`

- **Type**: String or null
- **Default**: null
- **Description**: Manually specify a Python virtual environment folder path. If not specified, defaults to .venv in the workspace setup path.

This allows you to use a custom location for the Python virtual environment instead of the default `.venv` folder in your workspace.

## Next Steps

- [See all available commands](commands.md)
- [Learn about launch configuration helpers](launch-configuration.md)
