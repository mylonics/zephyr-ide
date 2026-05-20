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
| `zephyr-ide.runnerProfiles` | array | `[]` | User-scope Runner Profiles (`{ "name", "flash", "debug", "attach" }`) available across all your workspaces. Workspace `.vscode/zephyr-ide.json#runnerProfiles` overrides this on name collision. Edit interactively from the **Zephyr IDE: Open Runner Profile Panel** command. See [Runner Profiles](#runner-profiles) below. |

## Runner Profiles

A **Runner Profile** is a named bundle of three bind slots — **flash**, **debug**, and **attach** — that a build can attach to. Each slot independently chooses one of:

- `auto` — use `runners.yaml` defaults (the `debug-runner` / `flash-runner` Zephyr recorded at CMake time).
- `runner` — a Zephyr runner by name (e.g. `openocd`, `jlink`, `pyocd`, `blackmagicprobe`) with optional extra `args`.
- `launch` — a `launch.json` configuration by name (debug and attach binds only; not valid for flash because flashing never starts a debug session).

When **no** profile is assigned to a build, all three slots default to `auto`. This is the default for newly-created builds — `Flash` / `Debug` / `Build and Debug` / `Debug Attach` just work using whatever Zephyr recorded in `runners.yaml`.

Each build references a profile by name (`activeProfile`) and may add per-slot **extra-argument overrides** (`bindOverrides`). Overrides only have effect on `runner`-kind slots: they are appended after the profile's own `args`.

### Profile Scope

Profiles are stored in two places, merged on load (workspace overrides user on name collision):

**User settings (`settings.json`)** — shared across all your workspaces:

```json
{
  "zephyr-ide.runnerProfiles": [
    {
      "name": "BMP via ttyACM0",
      "flash":  { "kind": "runner", "runner": "blackmagicprobe", "extraArgs": "--gdb-serial /dev/ttyACM0" },
      "debug":  { "kind": "runner", "runner": "blackmagicprobe", "extraArgs": "--gdb-serial /dev/ttyACM0" },
      "attach": { "kind": "runner", "runner": "blackmagicprobe", "extraArgs": "--gdb-serial /dev/ttyACM0" }
    }
  ]
}
```

**Workspace (`.vscode/zephyr-ide.json`)** — committed alongside the project:

```json
{
  "runnerProfiles": [
    {
      "name": "jlink-stm32f4",
      "flash":  { "kind": "runner", "runner": "jlink", "extraArgs": "--device=STM32F401RE --speed=4000" },
      "debug":  { "kind": "launch", "name": "STM32F4 Debug" },
      "attach": { "kind": "auto" }
    }
  ]
}
```

### Editing Profiles

Run **`Zephyr IDE: Open Runner Profile Panel`** (or click **Manage…** next to the Runner Profile section in the Project Build panel) for a full CRUD UI:

- Create, rename, edit, and delete profiles at workspace or user scope.
- Drop-down pickers for known Zephyr runners and detected `launch.json` configurations.
- "Use for active build" sets the chosen profile as the current build's `activeProfile` without opening a picker.
- Usage badge shows how many builds currently reference each profile; the delete confirmation lists them by name.

The faster **`Zephyr IDE: Select Active Runner Profile`** command (also wired to the **Change…** button in the Project Build panel and the Runner Profile node in the Project Config tree) opens a QuickPick limited to switching the active profile without leaving your editor.

### Per-build Overrides

If you need slightly different arguments on a single build without forking a whole profile, click the pencil icon next to the slot label in the Project Build panel. The override `extraArgs` are persisted on the `BuildConfig` (`bindOverrides[slot].extraArgs`) and appended after the profile's own args:

```json
{
  "bindOverrides": {
    "flash": { "extraArgs": "--erase" }
  }
}
```

Overrides are silently ignored for `auto` and `launch` slots — they only compose with `runner`-kind binds.

### Migration from the Old Single-Runner Model

Legacy per-build `runnerConfigs` and per-project `runnerConfigs` (with the deprecated `RunnerVariant` settings) are migrated automatically on workspace load:

- Each legacy `RunnerConfig` becomes a `RunnerProfile`. Pre-bind shape (`{ name, runner, args }`) becomes a profile whose `flash` slot is a `runner` bind and whose `debug` / `attach` slots are seeded from the old `launchTarget` / `buildDebugTarget` / `attachTarget` (mapped to `launch` or `auto` as appropriate).
- The build's old `activeRunner` field becomes its new `activeProfile`.
- Migrated profiles are written to `.vscode/zephyr-ide.json#runnerProfiles`; the legacy fields are then stripped from the workspace state.

You do not need to take any action — the next time the workspace opens, the migration runs once and the new shape is what subsequent saves persist. The deprecated `zephyr-ide.runnerVariants` user setting is no longer read.

## Custom Variables

Both `BuildConfig` and `ProjectConfig` support a `customVars` map for user-defined key-value data that needs to flow into runner profile args, `tasks.json`, or `launch.json`.

```json
{
  "projects": {
    "myproject": {
      "customVars": {
        "jlink_device": "STM32F401RE"
      },
      "buildConfigs": {
        "debug": {
          "customVars": {
            "bmp_port": "/dev/ttyACM0"
          }
        }
      }
    }
  }
}
```

Variables are edited interactively with the **`Zephyr IDE: Manage Build Variables`** and **`Zephyr IDE: Manage Project Variables`** commands. They are available in two contexts:

- **Runner profile `extraArgs`** — use `${buildvar:key}` or `${projectvar:key}` (see [Runner Args Variable Substitution](../user-guide/building-debugging.md#runner-args-variable-substitution) for the full substitution table including `${cmake:VAR}`, `${kconfig:VAR}`, `${env:VAR}`, etc.)
- **`tasks.json` / `launch.json` inputs** — use the `zephyr-ide.get-active-build-variable` / `zephyr-ide.get-active-project-variable` input commands (see [Custom Variables](launch-configuration.md#custom-variables) for usage examples)

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
