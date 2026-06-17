---
title: Configuration Settings
description: All IDE for Zephyr VS Code settings — toolchain directory, Kconfig button behavior, west update options, virtual environment path, clangd support, runner profiles, and full `.vscode/zephyr-ide.json` schema reference.
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
| `zephyr-ide.westZephyrExport` | boolean | false | Run `west zephyr-export` after a successful `west update`. This registers the Zephyr CMake package so that out-of-tree applications can find Zephyr with `find_package(Zephyr)`. |
| `zephyr-ide.suppressWorkspaceWarning` | boolean | false | Suppress the notification about missing `ZEPHYR_BASE` / `ZEPHYR_SDK_INSTALL_DIR` environment variables. |
| `zephyr-ide.venvFolder` | string \| null | null | Custom Python virtual environment path. Defaults to `.venv` in the workspace setup path. |
| `zephyr-ide.automaticProjectSelection` | boolean | true | Automatically switch the active project when editor focus changes to a file belonging to a different project. |
| `zephyr-ide.useClangd` | boolean | false | Use clangd for IntelliSense instead of the C/C++ extension. When enabled, sets `C_Cpp.intelliSenseEngine` to `disabled` and configures `clangd.arguments` with the Zephyr SDK query-driver. Requires the [clangd VS Code extension](https://marketplace.visualstudio.com/items?itemName=llvm-vs-code-extensions.vscode-clangd). |
| `zephyr-ide.scaVariant` | string (enum) | `"none"` | Static Code Analysis tool enabled on pristine builds via `-DZEPHYR_SCA_VARIANT`. See [Static Code Analysis](#static-code-analysis-sca) below. |
| `zephyr-ide.scaCustomVariant` | string \| null | null | Custom SCA variant name used when `zephyr-ide.scaVariant` is `"custom"`. Must match a `cmake/sca/<name>/sca.cmake` entry in your Zephyr tree (e.g. `sparse`, `codechecker`). |
| `zephyr-ide.buildBeforeFlash` | boolean | false | Automatically build before flashing when using the **Zephyr IDE: Flash** command. The dedicated **Build and Flash** command always builds first regardless of this setting. |
| `zephyr-ide.separateBuildDebugProfile` | boolean | false | Expose a separate **Build & Debug** bind slot (`buildDebug`) in Runner Profiles. When enabled, **Build and Debug** and **Debug** can each have an independent runner or launch configuration binding. When disabled (default), the single **Debug** slot drives both actions. See [Build-and-Debug slot](#the-builddebug-slot) below. |
| `zephyr-ide.projectVariableDefaults` | string[] | `[]` | Default project variable names pre-populated in the Project Details panel. Variables not yet defined on a project are shown as empty. |
| `zephyr-ide.buildVariableDefaults` | string[] | `[]` | Default build variable names pre-populated in the Project Details panel. Variables not yet defined on a build are shown as empty. |
| `zephyr-ide.runnerProfiles` | array | `[]` | User-scope Runner Profiles (`{ "name", "flash", "debug", "attach" }`) available across all your workspaces. Workspace `.vscode/zephyr-ide.json#runnerProfiles` overrides this on name collision. Edit interactively from the **Zephyr IDE: Open Runner Profile Panel** command. See [Runner Profiles](#runner-profiles) below. |

## `.vscode/zephyr-ide.json` Reference

This is the workspace file used for projects/builds/tests, runner profiles, and SDK/blob requirements. The extension preserves unknown top-level keys, so you can also keep your own custom top-level metadata in the file.

### Full Example

```json
{
  "projects": {
    "blinky": {
      "name": "blinky",
      "rel_path": "apps/blinky",
      "customVars": {
        "jlink_device": "STM32F401RE"
      },
      "confFiles": {
        "config": [
          { "path": "apps/blinky/prj.conf" },
          { "path": "apps/blinky/debug.conf", "extra": true }
        ],
        "overlay": [
          { "path": "apps/blinky/boards/nucleo_f401re.overlay" }
        ]
      },
      "buildConfigs": {
        "build/nucleo_f401re": {
          "name": "build/nucleo_f401re",
          "rel_path": "out/blinky/nucleo_f401re",
          "board": "nucleo_f401re",
          "relBoardDir": "zephyr/boards/st",
          "relBoardSubDir": "nucleo_f401re",
          "revision": "",
          "compilerOptimization": "debug",
          "westBuildArgs": ["--pristine"],
          "westBuildCMakeArgs": ["-DCONFIG_DEBUG_OPTIMIZATIONS=y"],
          "activeProfile": "jlink-stm32f4",
          "bindOverrides": {
            "flash": { "extraArgs": ["--erase"] }
          },
          "customVars": {
            "bmp_port": "/dev/ttyACM0"
          },
          "confFiles": {
            "config": [],
            "overlay": []
          }
        }
      },
      "twisterConfigs": {
        "smoke_hardware": {
          "name": "smoke_hardware",
          "platform": "hardware",
          "tests": ["sample.basic.blinky"],
          "args": "--inline-logs",
          "serialPort": "COM3",
          "serialBaud": "115200",
          "boardConfig": {
            "board": "nucleo_f401re",
            "relBoardDir": "zephyr/boards/st",
            "relBoardSubDir": "nucleo_f401re"
          }
        }
      }
    }
  },
  "runnerProfiles": [
    {
      "name": "jlink-stm32f4",
      "flash": {
        "kind": "runner",
        "runner": "jlink",
        "extraArgs": ["--device", "STM32F401RE", "--speed", "4000"]
      },
      "debug": {
        "kind": "launch",
        "name": "STM32F4 Debug"
      },
      "attach": {
        "kind": "auto"
      }
    }
  ],
  "toolchains": ["arm-zephyr-eabi"],
  "sdkVersion": "0.17.0",
  "blobs": ["hal_nordic"],
  "pipPackages": ["dtsh", "pyocd"],
  "sampleProjects": [
    {
      "name": "hello_world",
      "rel_path": "zephyr/samples/hello_world",
      "buildConfigs": {},
      "confFiles": { "config": [], "overlay": [] },
      "twisterConfigs": {}
    }
  ],
  "runnerProfilesMigrationVersion": 1,
  "my-team-metadata": {
    "owner": "firmware-team"
  }
}
```

### Top-level Fields

| Field | Type | Required | Notes |
|---|---|---|---|
| `projects` | `Record<string, ProjectConfig>` | Yes | Primary workspace project/build/test data. |
| `runnerProfiles` | `RunnerProfile[]` | No | Workspace-scope profiles. Edited from Runner Profile panel. |
| `toolchains` | `string[]` | No | Required Zephyr SDK toolchain names (e.g. `arm-zephyr-eabi`). |
| `sdkVersion` | `string` | No | Preferred SDK version used when SDK auto-install is needed. |
| `blobs` | `string[]` | No | West modules requiring `west blobs fetch <module>`. |
| `pipPackages` | `string[]` | No | Additional Python packages installed into the workspace virtual environment during setup (e.g. `dtsh`, `pyocd`). The extension always installs `dtsh` and `pyocd`; packages listed here are added on top. |
| `sampleProjects` | `ProjectConfig[]` | No | Optional project snapshots used by **Zephyr IDE: Add Sample Projects from File**. |
| `runnerProfilesMigrationVersion` | `number` | No | Internal migration marker written by the extension. Keep as-is. |
| any other key | any JSON | No | Preserved by the extension; can be read with `Zephyr IDE: Get Zephyr IDE JSON Variable`. |

### `ProjectConfig`

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | `string` | Yes | Project display name/key. |
| `rel_path` | `string` | Yes | Project path relative to workspace root. |
| `buildConfigs` | `Record<string, BuildConfig>` | Yes | Build configurations keyed by build name. |
| `confFiles` | `ConfigFiles` | Yes | Project-level Kconfig/devicetree file entries. |
| `twisterConfigs` | `Record<string, TwisterConfig>` | Yes | Twister test configurations. |
| `customVars` | `Record<string, string>` | No | Per-project custom variables. |

### `BuildConfig`

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | `string` | Yes | Build config name. |
| `board` | `string` | Yes | Zephyr board identifier. |
| `relBoardDir` | `string` | No | Relative path to a `boards` directory (e.g. `boards` or `custom/boards`). Its parent directory is passed as `BOARD_ROOT` to CMake — e.g. `boards` → workspace root becomes `BOARD_ROOT`; `custom/boards` → `<workspace>/custom` becomes `BOARD_ROOT`. Must point at a `boards` directory, not at a vendor subfolder inside it. Leave unset to use Zephyr's built-in boards. |
| `relBoardSubDir` | `string` | No | Board subdirectory name/path. Used to construct the full board path for IDE navigation. |
| `compilerOptimization` | `string` | No | Compiler optimization preset. One of `debug`, `speed`, `size`, `none`. When omitted, no optimization flag is passed (configured via KConfig). |
| `westBuildArgs` | `string[]` | Yes | Additional non-CMake `west build` args. |
| `westBuildCMakeArgs` | `string[]` | Yes | Additional CMake args passed to `west build`. |
| `confFiles` | `ConfigFiles` | Yes | Build-level Kconfig/devicetree file entries. |
| `revision` | `string` | No | Board revision (if used). |
| `activeProfile` | `string` | No | Active runner profile name for this build. |
| `bindOverrides` | `BuildBindOverrides` | No | Per-slot extra-arg overrides appended after profile args. |
| `customVars` | `Record<string, string>` | No | Per-build custom variables. |
| `rel_path` | `string` | No | **Manual field (no GUI)**: build output path relative to workspace root. Absolute paths are ignored; paths escaping workspace root are rejected; empty/invalid values fall back to the path composed as `project.rel_path/build.name`. |

### `ConfigFiles`

| Field | Type | Required | Notes |
|---|---|---|---|
| `config` | `ConfigFileEntry[]` | Yes | Kconfig file entries. |
| `overlay` | `ConfigFileEntry[]` | Yes | Devicetree overlay entries. |

`ConfigFileEntry` shape:

| Field | Type | Required | Notes |
|---|---|---|---|
| `path` | `string` | Yes | Relative file path. |
| `extra` | `boolean` | No | `true` = `EXTRA_CONF_FILE` or `EXTRA_DTC_OVERLAY_FILE`; omitted/`false` = primary override file (`CONF_FILE` or `DTC_OVERLAY_FILE`). |

### `TwisterConfig`

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | `string` | Yes | Twister config name. |
| `platform` | `string` | Yes | `native_sim`, `qemu`, or `hardware`. |
| `tests` | `string[]` | Yes | Test IDs or `"All"`. |
| `args` | `string` | Yes | Extra Twister arguments. |
| `serialPort` | `string` | No | Hardware serial port for `platform: "hardware"`. |
| `serialBaud` | `string` | No | Hardware serial baud for `platform: "hardware"`. |
| `boardConfig` | `BoardConfig` | No | Required for hardware platform flows. |

`BoardConfig` shape:

| Field | Type | Required | Notes |
|---|---|---|---|
| `board` | `string` | Yes | Board identifier. |
| `relBoardDir` | `string` | No | Additional board dir, relative to workspace root. |
| `relBoardSubDir` | `string` | No | Board subdirectory path. |
| `revision` | `string` | No | Board revision. |

### `RunnerProfile`

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | `string` | Yes | Profile name. |
| `flash` | `RunnerBind` | Yes | Used by Flash/Build-and-Flash. |
| `debug` | `RunnerBind` | Yes | Used by Debug and (default) Build-and-Debug. |
| `attach` | `RunnerBind` | Yes | Used by Debug Attach. |
| `buildDebug` | `RunnerBind` | No | Optional dedicated Build-and-Debug bind when `zephyr-ide.separateBuildDebugProfile` is enabled. |

`RunnerBind` variants:

- `{ "kind": "auto" }`
- `{ "kind": "runner", "runner": "openocd", "extraArgs": ["--foo", "bar"] }`
- `{ "kind": "launch", "name": "My Launch Config" }` (debug/attach slots only)

`BuildBindOverrides` shape:

| Field | Type | Required | Notes |
|---|---|---|---|
| `flash` | `{ extraArgs?: string[] }` | No | Appended only if slot resolves to `runner` kind. |
| `buildDebug` | `{ extraArgs?: string[] }` | No | Same rule. |
| `debug` | `{ extraArgs?: string[] }` | No | Same rule. |
| `attach` | `{ extraArgs?: string[] }` | No | Same rule. |

## Runner Profiles

A **Runner Profile** is a named bundle of three bind slots — **flash**, **debug**, and **attach** — that a build can attach to.

### Profile Scope

Profiles are stored in two places, merged on load (workspace overrides user on name collision):

**User settings (`settings.json`)** — shared across all your workspaces:

```json
{
  "zephyr-ide.runnerProfiles": [
    {
      "name": "BMP via ttyACM0",
      "flash": {
        "kind": "runner",
        "runner": "blackmagicprobe",
        "extraArgs": ["--gdb-serial", "/dev/ttyACM0"]
      },
      "debug": {
        "kind": "runner",
        "runner": "blackmagicprobe",
        "extraArgs": ["--gdb-serial", "/dev/ttyACM0"]
      },
      "attach": {
        "kind": "runner",
        "runner": "blackmagicprobe",
        "extraArgs": ["--gdb-serial", "/dev/ttyACM0"]
      }
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
      "flash": {
        "kind": "runner",
        "runner": "jlink",
        "extraArgs": ["--device", "STM32F401RE", "--speed", "4000"]
      },
      "debug": { "kind": "launch", "name": "STM32F4 Debug" },
      "attach": { "kind": "auto" }
    }
  ]
}
```

### Editing Profiles

Run **`Zephyr IDE: Open Runner Profile Panel`** (or click **Manage…** next to the Runner Profile section in the Project Build panel) for a full CRUD UI.

The **Profile…** button in the Project Build panel opens a QuickPick that sets a **local override** for the active build — stored in VS Code workspace state only, never in `.vscode/zephyr-ide.json`.

### Active Profile Scope (Local Override)

The active profile for a build is resolved from these layers (highest priority first):

| Priority | Layer | Storage | Committed? |
|---|---|---|---|
| 1 | **Local slot bind** — `localBinds[slot]` in `BuildState` (per-slot runner) | VS Code `workspaceState` | No |
| 2 | **Local profile override** — `localActiveProfile` in `BuildState` | VS Code `workspaceState` | No |
| 3 | **Workspace JSON** — `buildConfigs[build].activeProfile` | `.vscode/zephyr-ide.json` | Yes |
| 4 | **None** — all bind slots fall back to `runners.yaml` defaults | — | — |

When a local override is active, the status bar chip shows a `*` suffix (e.g. `$(chip) openocd *`) and tree views label the profile as `(local)`. Slot-level local binds show an amber `(local)` badge in the Project Build panel.

The typical per-developer workflow:

1. Click **Profile…** in the Project Build panel to choose a named profile locally (no JSON changes).
2. Click **Local Bind…** next to any slot to override just that slot's runner locally.
3. Open the **Runner Profile Panel** to publish: **Update profile with local changes** or **Create new profile from local changes**.

### Per-build Overrides

If you need slightly different arguments on a single build without forking a whole profile, edit the build's entry in `.vscode/zephyr-ide.json` directly:

```json
{
  "bindOverrides": {
    "flash": { "extraArgs": ["--erase"] }
  }
}
```

### The `buildDebug` Slot

By default a Runner Profile has three slots — `flash`, `debug`, `attach` — and **Build and Debug** reuses `debug`.

```json
{
  "name": "jlink-stm32f4",
  "flash": { "kind": "runner", "runner": "jlink", "extraArgs": ["--device", "STM32F401RE", "--speed", "4000"] },
  "buildDebug": { "kind": "runner", "runner": "jlink", "extraArgs": ["--device", "STM32F401RE", "--reset"] },
  "debug": { "kind": "launch", "name": "STM32F4 Debug (attach)" },
  "attach": { "kind": "auto" }
}
```

When `buildDebug` is omitted (or the setting is left disabled), **Build and Debug** falls back to `debug`.

## Custom Variables

Both `BuildConfig` and `ProjectConfig` support a `customVars` map for user-defined key-value data that needs to flow into runner profile args, `tasks.json`, or `launch.json`.

```json
{
  "projects": {
    "myproject": {
      "name": "myproject",
      "rel_path": "apps/myproject",
      "buildConfigs": {
        "debug": {
          "name": "debug",
          "board": "nucleo_f401re",
          "relBoardDir": "zephyr/boards/st",
          "relBoardSubDir": "nucleo_f401re",
          "compilerOptimization": "debug",
          "westBuildArgs": [],
          "westBuildCMakeArgs": [],
          "confFiles": { "config": [], "overlay": [] },
          "customVars": {
            "bmp_port": "/dev/ttyACM0"
          }
        }
      },
      "confFiles": { "config": [], "overlay": [] },
      "twisterConfigs": {},
      "customVars": {
        "jlink_device": "STM32F401RE"
      }
    }
  }
}
```

Variables are edited interactively with the **`Zephyr IDE: Manage Build Variables`** and **`Zephyr IDE: Manage Project Variables`** commands.

## Static Code Analysis (SCA)

Zephyr's SCA framework lets a static analysis tool wrap every C compiler invocation during a build. The tool is selected per-build via `-DZEPHYR_SCA_VARIANT=<name>` at CMake configure time.

Zephyr IDE passes this flag automatically on every **pristine** build based on the `zephyr-ide.scaVariant` setting. Incremental (non-pristine) builds reuse the `build.ninja` that was generated during the last pristine configure, so the selected variant stays active without needing to be re-passed.

If the SCA variant setting changes between builds, the extension detects the difference in the cached pristine command and automatically triggers a pristine rebuild.

### Available Variants

| Variant | Setting value | Install required |
|---|---|---|
| **dtdoctor** | `"dtdoctor"` | None — bundled in the Zephyr repo at `scripts/dts/dtdoctor_sca_wrapper.py`. Requires Zephyr 3.7+. |
| **GCC `-fanalyzer`** | `"gcc"` | None — GCC 12+ is already in the Zephyr SDK. |
| **Custom** | `"custom"` | Whatever the variant needs. Set the name in `zephyr-ide.scaCustomVariant`. |
| **None (disabled)** | `"none"` | — |

The default is `"none"` (disabled).

### dtdoctor

dtdoctor is Zephyr's built-in Devicetree diagnostic tool. It wraps the C compiler as `CMAKE_C_COMPILER_LAUNCHER` and, when a build fails with `__device_dts_ord_*` or `DT_N_NODELABEL_*` undeclared symbol errors, runs `dtdoctor_analyzer.py` and appends human-readable devicetree diagnostics to the build output.

### GCC `-fanalyzer`

Enables GCC's built-in inter-procedural static analyzer. Output is standard GCC diagnostic format and appears inline in build output.

### Custom Variant

Set `zephyr-ide.scaVariant` to `"custom"` and `zephyr-ide.scaCustomVariant` to the variant name (e.g. `"sparse"`, `"codechecker"`).

## clangd Configuration

When `zephyr-ide.useClangd` is enabled, the workspace `.vscode/settings.json` is automatically configured with the appropriate settings.

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

The `--query-driver` glob is derived from your configured toolchain directory (`zephyr-ide.toolchainDirectory`).

## Next Steps

- [See all available commands](commands.md)
- [Learn about launch configuration helpers](launch-configuration.md)
