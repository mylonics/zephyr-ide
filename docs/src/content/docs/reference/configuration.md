---
title: Configuration Settings
description: All IDE for Zephyr VS Code settings — toolchain directory, Kconfig button behavior, west update options, virtual environment path, clangd support, runner profiles, and project variable defaults.
---

The following settings are available in VS Code settings (File > Preferences > Settings):

| Setting | Type | Default | Description |
|---|---|---|---|
| `zephyr-ide.toolchainDirectory` | string \| null | null | Directory containing Zephyr SDK installations (e.g. subdirectories named `zephyr-sdk-0.17.0`). Defaults to `~/.zephyr_ide/toolchains`. |
| `zephyr-ide.globalDirectory` | string \| null | null | **Deprecated.** Use `zephyr-ide.toolchainDirectory` instead. Migrated automatically on startup. |
| `zephyr-ide.tools_directory` | string \| null | null | **Deprecated.** Use `zephyr-ide.toolchainDirectory` instead. Migrated automatically on startup. |
| `zephyr-ide.useGuiConfig` | boolean | false | Use the graphical Kconfig editor instead of terminal-based menuconfig. |
| `zephyr-ide.activeViewKconfigButton` | enum | `dashboard` | Controls what the Kconfig button in the Active Project view opens: `dashboard` (main summary page), `kconfig-dashboard` (Kconfig page of the dashboard), `gui-config` (`west build -t guiconfig`), or `menu-config` (`west build -t menuconfig`). |
| `zephyr-ide.projectViewKconfigButton` | enum | `kconfig-dashboard` | Controls what the Config button in the Projects view opens for a build: `kconfig-dashboard` (Kconfig page of the dashboard), `gui-config` (`west build -t guiconfig`), or `menu-config` (`west build -t menuconfig`). |
| `zephyr-ide.westNarrowUpdate` | boolean | false | Pass `--narrow` to `west update` to fetch only required Git history, reducing disk usage and download time. |
| `zephyr-ide.westKeepDescendants` | boolean | false | Pass `--keep-descendants` to `west update`. When enabled, west will not reset a project if its current HEAD is a descendant of the manifest revision. |
| `zephyr-ide.suppressWorkspaceWarning` | boolean | false | Suppress the notification about missing `ZEPHYR_BASE` / `ZEPHYR_SDK_INSTALL_DIR` environment variables. |
| `zephyr-ide.venvFolder` | string \| null | null | Custom Python virtual environment path. Defaults to `.venv` in the workspace setup path. |
| `zephyr-ide.automaticProjectSelection` | boolean | true | Automatically switch the active project when editor focus changes to a file belonging to a different project. |
| `zephyr-ide.useClangd` | boolean | false | Use clangd for IntelliSense instead of the C/C++ extension. When enabled, sets `C_Cpp.intelliSenseEngine` to `disabled` and configures `clangd.arguments` with the Zephyr SDK query-driver. Requires the [clangd VS Code extension](https://marketplace.visualstudio.com/items?itemName=llvm-vs-code-extensions.vscode-clangd). |
| `zephyr-ide.buildBeforeFlash` | boolean | false | Automatically build before flashing when using the **Zephyr IDE: Flash** command. The dedicated **Build and Flash** command always builds first regardless of this setting. |
| `zephyr-ide.separateBuildDebugProfile` | boolean | false | Expose a separate **Build & Debug** bind slot (`buildDebug`) in Runner Profiles. When enabled, **Build and Debug** and **Debug** can each have an independent runner or launch configuration binding. When disabled (default), the single **Debug** slot drives both actions. See [Build-and-Debug slot](#the-builddebug-slot) below. |
| `zephyr-ide.projectVariableDefaults` | string[] | `[]` | Default project variable names pre-populated in the Project Details panel. Variables not yet defined on a project are shown as empty. |
| `zephyr-ide.buildVariableDefaults` | string[] | `[]` | Default build variable names pre-populated in the Project Details panel. Variables not yet defined on a build are shown as empty. |
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

- Create, rename, edit, **duplicate** (the copy icon next to each profile creates a new profile with the same binds and an auto-suggested unique name), and delete profiles at workspace or user scope.
- Drop-down pickers for known Zephyr runners and detected `launch.json` configurations.
- "Use for active build" sets the chosen profile as the current build's `activeProfile` without opening a picker.
- Usage badge shows how many builds currently reference each profile; the delete confirmation lists them by name.

The faster **`Zephyr IDE: Select Active Runner Profile`** command (also wired to the **Change…** button in the Project Build panel and the Runner Profile node in the Project Config tree) opens a QuickPick limited to switching the active profile without leaving your editor.

### Per-build Overrides

If you need slightly different arguments on a single build without forking a whole profile, edit the build's entry in `.vscode/zephyr-ide.json` directly. The override `extraArgs` are persisted on the `BuildConfig` (`bindOverrides[slot].extraArgs`) and appended after the profile's own args:

```json
{
  "bindOverrides": {
    "flash": { "extraArgs": ["--erase"] }
  }
}
```

Overrides are silently ignored for `auto` and `launch` slots — they only compose with `runner`-kind binds. There is intentionally no per-build override UI in the Project Build panel; fork a profile (Duplicate) when you find yourself reaching for these overrides routinely.

### The `buildDebug` Slot

By default a Runner Profile has three slots — `flash`, `debug`, `attach` — and **Build and Debug** reuses the `debug` bind. When you need different runner args for a from-source debug session than for an attach-to-running-target session (for example, JLink with `--reset` for `buildDebug` but no reset for plain `debug`), enable the `zephyr-ide.separateBuildDebugProfile` setting. The Runner Profile panel then exposes a fourth **Build & Debug** slot that maps to the optional `buildDebug` field:

```json
{
  "name": "jlink-stm32f4",
  "flash":      { "kind": "runner", "runner": "jlink", "extraArgs": ["--device=STM32F401RE", "--speed=4000"] },
  "buildDebug": { "kind": "runner", "runner": "jlink", "extraArgs": ["--device=STM32F401RE", "--reset"] },
  "debug":      { "kind": "launch", "name": "STM32F4 Debug (attach)" },
  "attach":     { "kind": "auto" }
}
```

When `buildDebug` is omitted (or the setting is left disabled), **Build and Debug** silently falls back to the `debug` bind. To remove a `buildDebug` value once you've set one, delete the field from `.vscode/zephyr-ide.json` directly — there is no in-panel "clear" button for this slot.

### Migration from the Old Single-Runner Model

Legacy per-build `runnerConfigs` and per-project `runnerConfigs` are migrated automatically on workspace load:

- Each legacy `RunnerConfig` becomes a `RunnerProfile`. Pre-bind shape (`{ name, runner, args }`) becomes a profile whose `flash` slot is a `runner` bind and whose `debug` / `attach` slots are seeded from the old `launchTarget` / `buildDebugTarget` / `attachTarget` (mapped to `launch` or `auto` as appropriate).
- The build's old `activeRunner` field becomes its new `activeProfile`.
- Migrated profiles are written to `.vscode/zephyr-ide.json#runnerProfiles`; the legacy fields are then stripped from the workspace state and persisted via `setWorkspaceState`, so the cleanup survives a session close even when the user makes no further edits.
- The migration is gated by a `runnerProfilesMigrationVersion` flag stored in `.vscode/zephyr-ide.json` (currently `1`). Once the file records `runnerProfilesMigrationVersion >= 1`, the migration short-circuits without rescanning — this prevents duplicate `runner-2` / `runner-3` profiles from being appended on every workspace load.

You do not need to take any action — the next time the workspace opens, the migration runs once and the new shape is what subsequent saves persist.

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
