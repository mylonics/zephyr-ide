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
| `zephyr-ide.runnerVariants` | array | `[]` | Reusable runner variants (`{ "name", "runner", "args" }`) that can be referenced by `RunnerConfig` binds across builds. Workspace `.vscode/zephyr-ide.json` `runnerVariants` overrides this setting on name collision. See [Runner Configurations](#runner-configurations) below. |

## Runner Configurations

Each build has an optional active **Runner Configuration** that controls what happens for **Flash**, **Build & Debug**, **Debug** (launch), and **Debug Attach**. Each of those four targets is one of:

- `auto` — use `runners.yaml` defaults (the `debug-runner` / `flash-runner` Zephyr recorded at CMake time).
- `runner` — a Zephyr runner by name (e.g. `openocd`, `jlink`, `pyocd`, `blackmagicprobe`) with optional extra `args`.
- `variant` — a reference to a reusable variant defined in `zephyr-ide.runnerVariants` or `.vscode/zephyr-ide.json` `runnerVariants`; `extraArgs` are **appended** to the variant's `args`.
- `launch` — a `launch.json` configuration by name (Debug / Build & Debug / Attach binds only; ignored for Flash).

When **no** runner configuration is active on a build, all four targets fall back to `auto`. This is the default for newly-created builds.

### Defining Reusable Variants

Runner variants are read from **both** locations and merged, with workspace overriding user on name collision:

**User settings (`settings.json`)** — shared across all your workspaces:

```json
{
  "zephyr-ide.runnerVariants": [
    { "name": "bmp-via-acm0", "runner": "blackmagicprobe", "args": "--gdb-serial /dev/ttyACM0" },
    { "name": "openocd-stlink", "runner": "openocd", "args": "--config interface/stlink.cfg" }
  ]
}
```

**Workspace (`.vscode/zephyr-ide.json`)** — committed alongside the project:

```json
{
  "runnerVariants": [
    { "name": "jlink-stm32f4", "runner": "jlink", "args": "--device=STM32F401RE --speed=4000" }
  ]
}
```

### Migration from the Old Single-Runner Model

Legacy `RunnerConfig` entries (`{ "name", "runner", "args" }`) are migrated automatically on workspace load:

- `flash` becomes `{ "kind": "runner", "runner": <old runner>, "extraArgs": <old args> }`.
- `build` / `buildDebug` / `attach` are seeded from the build's existing `launchTarget` / `buildDebugTarget` / `attachTarget` as `{ "kind": "launch", "name": ... }`, or `{ "kind": "auto" }` when the target is unset, `"Auto:…"`, or `"Zephyr IDE: Debug"`.

You do not need to take any action — the next time the workspace opens, the migrated configs are persisted in `zephyr-ide.json`.

## clangd Configuration

When `zephyr-ide.useClangd` is enabled, the workspace `.vscode/settings.json` is **automatically configured** with the appropriate settings — no manual command is needed.

The extension manages up to five `clangd.arguments` entries (the `--query-driver` entry is only written when a valid toolchain directory is configured):

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

**User-defined arguments are preserved on enable.** If `clangd.arguments` already contains an argument whose key matches one of the extension's entries (e.g., a user-customized `--completion-style=bundled`), the extension leaves that value as-is and does not append its own. You can freely add extra flags (for example `--clang-tidy`, `--pretty`, `--log=error`) — they are kept alongside the extension's args.

**`--query-driver` is always extension-managed.** The extension overwrites any existing `--query-driver` value to keep it in sync with `zephyr-ide.toolchainDirectory`. If you want to use a custom toolchain query driver, point `zephyr-ide.toolchainDirectory` at it instead of editing `clangd.arguments` directly.

To switch back to the C/C++ extension, disable `zephyr-ide.useClangd`. If `clangd.arguments` is exactly the value the extension would write, it is removed entirely; otherwise (you added or modified anything) the array is left alone — assumed to be user-managed. The `C_Cpp.intelliSenseEngine` workspace override is also cleared.

## Next Steps

- [See all available commands](commands.md)
- [Learn about launch configuration helpers](launch-configuration.md)
