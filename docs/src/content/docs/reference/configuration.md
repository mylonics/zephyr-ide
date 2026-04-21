---
title: Configuration Settings
description: All IDE for Zephyr VS Code settings — global directory, toolchain directory, GUI config, west narrow update, virtual environment path, and workspace warning suppression.
---

The following settings are available in VS Code settings (File > Preferences > Settings):

| Setting | Type | Default | Description |
|---|---|---|---|
| `zephyr-ide.globalDirectory` | string \| null | null | Root directory for west workspace setup, Python venvs, and SDK installations. Replaces the deprecated `zephyr-ide.tools_directory`. |
| `zephyr-ide.tools_directory` | string \| null | null | **Deprecated.** Use `zephyr-ide.globalDirectory` instead. Migrated automatically on startup. |
| `zephyr-ide.toolchainDirectory` | string \| null | null | Directory containing Zephyr SDK installations (e.g. `zephyr-sdk-0.17.0` subdirectories). Defaults to `toolchains/` inside the global directory. |
| `zephyr-ide.useGuiConfig` | boolean | false | Use the graphical Kconfig editor instead of terminal-based menuconfig. |
| `zephyr-ide.westNarrowUpdate` | boolean | false | Pass `--narrow` to `west update` to fetch only required Git history, reducing disk usage and download time. |
| `zephyr-ide.suppressWorkspaceWarning` | boolean | false | Suppress the notification about missing `ZEPHYR_BASE` / `ZEPHYR_SDK_INSTALL_DIR` environment variables. |
| `zephyr-ide.venvFolder` | string \| null | null | Custom Python virtual environment path. Defaults to `.venv` in the workspace setup path. |

## Next Steps

- [See all available commands](commands.md)
- [Learn about launch configuration helpers](launch-configuration.md)
