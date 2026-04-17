# Migration Code Tracker

This document tracks all migration/compatibility code in the codebase. Each entry should be reviewed periodically and removed once the old format is no longer expected in the user base (typically 2–3 major versions after introduction).

## Active Migrations

### 1. Global state deprecated fields cleanup

| Field | Value |
|---|---|
| **Location** | `src/setup_utilities/state-management.ts` — `loadGlobalState()` |
| **Introduced** | v2.2.0 (commit `45e82f3`) |
| **Migrates from** | `armGdbPath`, `toolchains`, `setupState` fields in global state |
| **Migrates to** | Fields are deleted; data is discarded |
| **Trigger** | Field exists in raw global state object |
| **Persisted** | Yes — rewrites VS Code global state |
| **Test coverage** | None |
| **Notes** | These fields were from very early versions (pre-1.0). |

### 2. `automaticProjectSelction` typo → `automaticProjectSelection`

| Field | Value |
|---|---|
| **Location** | `src/setup_utilities/state-management.ts` — `loadWorkspaceState()` |
| **Introduced** | v2.3.8-prerelease (commit `e4aaae2`) |
| **Migrates from** | `automaticProjectSelction` (typo in workspace state) |
| **Migrates to** | `automaticProjectSelection` (corrected key) |
| **Trigger** | Typo key exists and corrected key is undefined |
| **Persisted** | Yes — corrects in-memory state, then flows to next migration |
| **Test coverage** | None |
| **Notes** | Chained with migration #4 below. |

### 3. `automaticProjectSelection` workspace state → VS Code setting

| Field | Value |
|---|---|
| **Location** | `src/setup_utilities/state-management.ts` — `loadWorkspaceState()` |
| **Introduced** | v2.3.8-prerelease (commit `e4aaae2`) |
| **Migrates from** | `automaticProjectSelection` field in workspace state |
| **Migrates to** | `zephyr-ide.automaticProjectSelection` VS Code setting |
| **Trigger** | Field exists in workspace state |
| **Persisted** | Yes — writes VS Code workspace setting, deletes field from state |
| **Test coverage** | Tested in `automatic-project-selection.test.ts` |
| **Notes** | Only migrates to VS Code setting if workspace-level setting has never been explicitly set. |

### 4. `westBuildArgs` / `westBuildCMakeArgs` string → string array

| Field | Value |
|---|---|
| **Location** | `src/setup_utilities/workspace-config.ts` — `projectLoader()` |
| **Introduced** | v2.4.2-prerelease (commit `0d51ace`) |
| **Migrates from** | `westBuildArgs: string` and `westBuildCMakeArgs: string` |
| **Migrates to** | `westBuildArgs: string[]` and `westBuildCMakeArgs: string[]` |
| **Trigger** | `normalizeBuildArgs()` detects string input; `argsMatchNormalized()` returns false |
| **Persisted** | Yes — rewrites `zephyr-ide.json` |
| **Test coverage** | `build-args-migration.test.ts` — "loadProjectsFromFile migrates legacy build arg strings to arrays" |
| **Notes** | Uses shell-like parsing (`splitBuildArgs`) to split quoted strings into individual arguments. |

### 5. `confFiles` 4-array format → 2-array-of-entries format

| Field | Value |
|---|---|
| **Location** | `src/setup_utilities/workspace-config.ts` — `migrateConfigFiles()`, called from `projectLoader()` |
| **Introduced** | v2.4.2-prerelease (commit `994fbea`) |
| **Migrates from** | `{ config: string[], extraConfig: string[], overlay: string[], extraOverlay: string[] }` |
| **Migrates to** | `{ config: ConfigFileEntry[], overlay: ConfigFileEntry[] }` where entries have `{ path, extra? }` |
| **Trigger** | `extraConfig` or `extraOverlay` arrays exist, or `config`/`overlay` contain string entries |
| **Persisted** | Yes — rewrites `zephyr-ide.json`, deletes `extraConfig`/`extraOverlay` keys |
| **Test coverage** | `build-args-migration.test.ts` — "loadProjectsFromFile migration preserves existing config entry objects when extra arrays exist" |
| **Notes** | Applied at both project-level and build-level `confFiles`. |

### 6. VS Code setting keys: snake_case/kebab-case → camelCase

| Field | Value |
|---|---|
| **Location** | `src/setup_utilities/workspace-config.ts` — `migrateSettingKeys()` |
| **Introduced** | v2.4.2-prerelease (commit `19ff750`) |
| **Migrates from** | Old setting keys (see table below) |
| **Migrates to** | camelCase equivalents |
| **Trigger** | Old key has a value and new key does not |
| **Persisted** | Yes — writes new VS Code setting, clears old key |
| **Test coverage** | `toolchain-config.test.ts` — "migrateSettingKeys migrates tools_directory to globalDirectory" |
| **Notes** | Migrates both global and workspace scopes independently. |

**Setting key mappings:**

| Old Key | New Key |
|---|---|
| `zephyr-ide.tools_directory` | `zephyr-ide.globalDirectory` |
| `zephyr-ide.global_directory` | `zephyr-ide.globalDirectory` |
| `zephyr-ide.toolchain_directory` | `zephyr-ide.toolchainDirectory` |
| `zephyr-ide.use_gui_config` | `zephyr-ide.useGuiConfig` |
| `zephyr-ide.suppress-workspace-warning` | `zephyr-ide.suppressWorkspaceWarning` |
| `zephyr-ide.venv-folder` | `zephyr-ide.venvFolder` |
| `zephyr-ide.project_variable_defaults` | `zephyr-ide.projectVariableDefaults` |
| `zephyr-ide.build_variable_defaults` | `zephyr-ide.buildVariableDefaults` |

## Removal Guidelines

- **Safe to remove when:** All users have reasonably upgraded past the version that introduced the migration. A good rule of thumb is 2–3 major versions after introduction.
- **Before removing:** Ensure no integration test relies on the migration path being present.
- **When removing:** Delete the migration code, its tests, and update this document.

| Migration | Introduced | Suggested earliest removal |
|---|---|---|
| #1 Global state deprecated fields | v2.2.0 | v3.0+ |
| #2 `automaticProjectSelction` typo | v2.3.8-pre | v3.0+ |
| #3 `automaticProjectSelection` → setting | v2.3.8-pre | v3.0+ |
| #4 Build args string → array | v2.4.2-pre | v3.0+ |
| #5 confFiles 4-array → entries | v2.4.2-pre | v3.0+ |
| #6 Setting keys → camelCase | v2.4.2-pre | v3.0+ |

## Removed Migrations

| Migration | Introduced | Removed |
|---|---|---|
| `runners` → `runnerConfigs` | v1.10.4 | v2.4.1 |
