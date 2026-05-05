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

On the first setup (or when `clangd.arguments` is not yet present in the workspace), the extension writes its required arguments:

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

**The extension never overwrites arguments that are already set.** If `clangd.arguments` already contains an argument (e.g., a user-customized `--completion-style=bundled` or `--query-driver` pointing at a specific path), that value is left as-is. Only arguments whose key is entirely absent are appended. You can freely add extra flags (for example `--clang-tidy`, `--pretty`, `--log=error`) and they will never be removed or overwritten.

To switch back to the C/C++ extension, disable `zephyr-ide.useClangd`. The extension removes only the arguments it originally wrote from `clangd.arguments` (preserving any user-defined or customized ones) and clears the `C_Cpp.intelliSenseEngine` workspace override.

## Next Steps

- [See all available commands](commands.md)
- [Learn about launch configuration helpers](launch-configuration.md)
