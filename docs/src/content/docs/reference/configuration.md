---
title: Configuration Settings
description: All IDE for Zephyr VS Code settings — global directory, toolchain directory, GUI config, west narrow update, virtual environment path, workspace warning suppression, and clangd support.
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
| `zephyr-ide.useClangd` | boolean | false | Use clangd for IntelliSense instead of the C/C++ extension. When enabled, sets `C_Cpp.intelliSenseEngine` to `disabled` and configures `clangd.arguments` with the Zephyr SDK query-driver. Requires the [clangd VS Code extension](https://marketplace.visualstudio.com/items?itemName=llvm-vs-code-extensions.vscode-clangd). |

## clangd Configuration

When `zephyr-ide.useClangd` is enabled, the workspace `.vscode/settings.json` is **automatically configured** with the appropriate settings — no manual command is needed.

The extension manages five `clangd.arguments` entries:

```json
{
  "C_Cpp.intelliSenseEngine": "disabled",
  "clangd.arguments": [
    "--compile-commands-dir=${workspaceFolder}/.vscode",
    "--background-index",
    "--completion-style=detailed",
    "--header-insertion=never",
    "--query-driver=/path/to/toolchains/**/*"
  ]
}
```

The `--query-driver` glob is derived from your configured toolchain directory (see `zephyr-ide.toolchainDirectory`), which points to the Zephyr SDK containing the cross-compilers.

**User-defined arguments are always preserved.** If `clangd.arguments` already contains an argument whose key matches one of the extension's entries (e.g., a user-customized `--completion-style=bundled` or a hand-written `--query-driver=/opt/toolchains/**/*`), the extension leaves that value as-is and does not append its own. You can freely add extra flags (for example `--clang-tidy`, `--pretty`, `--log=error`) — they will never be removed or overwritten.

**Extension-managed arguments are kept in sync.** If you change `zephyr-ide.toolchainDirectory` after the initial write, the extension updates the `--query-driver` it originally set to point at the new location on the next workspace-settings refresh. Arguments that you defined yourself are not affected.

To switch back to the C/C++ extension, disable `zephyr-ide.useClangd`. The extension removes only the arguments it originally wrote (identified by the values it tracked when writing them), preserving any user-defined or customized entries. The `C_Cpp.intelliSenseEngine` workspace override is also cleared.

## Next Steps

- [See all available commands](commands.md)
- [Learn about launch configuration helpers](launch-configuration.md)
