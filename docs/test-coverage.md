# Test Coverage Report

This document maps every registered `zephyr-ide.*` command to its test coverage status
and clarifies which tests actually execute in each CI pipeline.

---

## Test Files Inventory

### Unit Tests

Unit tests validate individual utility functions in isolation.
They do **not** require a Zephyr SDK, network access, or long build times.

| # | File | Suite Name | Functions Under Test |
|---|------|------------|----------------------|
| 1 | `git-url-validation.test.ts` | `Git URL Validation Test Suite` | `validateGitUrl()` from `utilities/utils.ts` |
| 2 | `launch-config.test.ts` | `Launch Configuration Test Suite` | `getLaunchConfigurations()` from `utilities/utils.ts` |
| 3 | `platform-detection.test.ts` | `Platform Detection Test Suite` | `getPlatformName()`, `getPlatformNameAsync()` from `utilities/utils.ts` |
| 4 | `python-command.test.ts` | `Python Command Test Suite` | `getPythonCommand()`, `resetPythonCommand()` from `setup_utilities/west-operations.ts` |
| 5 | `toolchain-config.test.ts` | `Toolchain Configuration Test Suite` | `getToolchainDir()` from `setup_utilities/workspace-config.ts` |
| 6 | `venv-config.test.ts` | `Venv Configuration Test Suite` | `getVenvPath()` from `setup_utilities/workspace-config.ts` |
| 7 | `env-detection.test.ts` | `Environment Variable Detection Test Suite` | `getEnvironmentSetupState()` from `setup_utilities/workspace-config.ts` |

### Integration Tests

Integration tests execute full VS Code extension workflows end-to-end.
They require network access, Zephyr SDK downloads, and take 15+ minutes each.

| # | File | Suite Name | Workflow |
|---|------|------------|----------|
| 1 | `workspace-standard.test.ts` | `Standard Workspace Test Suite` | Dependencies → West setup → SDK install → Create project → Add build → Build |
| 2 | `workspace-west-git.test.ts` | `West Git Workspace Test Suite` | West git clone → SDK install → Add project → Custom board build |
| 3 | `workspace-zephyr-ide-git.test.ts` | `Workspace Zephyr IDE Git Test Suite` | IDE for Zephyr git clone → SDK install → Build existing project |
| 4 | `workspace-local-west.test.ts` | `Workspace Local West Test Suite` | Git clone → Detect west.yml → Local west workspace → Build |
| 5 | `workspace-external-zephyr.test.ts` | `Workspace External Zephyr Test Suite` | Git clone (no west) → External Zephyr install → Global install → Build |
| 6 | `combined-installation.test.ts` | `Combined Installation Test Suite` | Install package manager → Install host packages → Standard workspace workflow (single process) |

### Test Infrastructure

| File | Purpose |
|------|---------|
| `test-runner.ts` | Shared utilities: `monitorWorkspaceSetup()`, `executeFinalBuild()`, `executeWorkspaceCommand()`, `CommonUIInteractions`, etc. |
| `ui-mock-interface.ts` | Mocks `vscode.window` methods (`createQuickPick`, `createInputBox`, `showOpenDialog`, etc.) for headless test execution |

---

## Command Coverage

### ✅ Commands Exercised in Integration Tests

These commands are directly invoked via `vscode.commands.executeCommand()` during integration test workflows.

| Command | Test File(s) | How Invoked |
|---------|-------------|-------------|
| `zephyr-ide.check-host-tools-headless` | `workspace-standard`, `combined-installation` | Called directly |
| `zephyr-ide.check-build-dependencies` | `workspace-standard`, `combined-installation` | Via `executeWorkspaceCommand()` |
| `zephyr-ide.workspace-setup-standard` | `workspace-standard`, `combined-installation` | Via `startWorkspaceCommand()` |
| `zephyr-ide.workspace-setup-from-west-git` | `workspace-west-git` | Via `startWorkspaceCommand()` |
| `zephyr-ide.workspace-setup-from-git` | `workspace-zephyr-ide-git`, `workspace-local-west`, `workspace-external-zephyr` | Via `startWorkspaceCommand()` / `executeCommand()` |
| `zephyr-ide.create-project` | `workspace-standard`, `combined-installation` | Via `executeWorkspaceCommand()` |
| `zephyr-ide.add-project` | `workspace-west-git` | Via `executeWorkspaceCommand()` |
| `zephyr-ide.add-build` | `workspace-standard`, `workspace-west-git`, `combined-installation` | Via `executeWorkspaceCommand()` |
| `zephyr-ide.build` | All integration tests | Via `executeFinalBuild()` |
| `zephyr-ide.print-workspace` | All integration tests | Via `printWorkspaceStructure()` in teardown |
| `zephyr-ide.print-python-path` | `workspace-standard`, `combined-installation` | Called directly to verify venv |
| `zephyr-ide.is-sdk-installed` | All integration tests | Polled in `monitorWorkspaceSetup()` |
| `zephyr-ide.get-debug-output` | All integration tests | Via `dumpExtensionOutput()` |
| `zephyr-ide.update-with-narrow` | All integration tests | Via `startWorkspaceCommand()` / `executeWorkspaceCommand()` (test-only command) |
| `zephyr-ide.install-package-manager-headless` | `combined-installation` | Called directly |
| `zephyr-ide.install-host-packages-headless` | `combined-installation` | Called directly |

### ✅ Underlying Functions Tested in Unit Tests

These are not command-level tests but validate the core logic behind commands or configuration.

| Underlying Function | Test File | Related Command(s) |
|---------------------|-----------|---------------------|
| `validateGitUrl()` | `git-url-validation.test.ts` | Used by `workspace-setup-from-git`, `workspace-setup-from-west-git` |
| `getLaunchConfigurations()` | `launch-config.test.ts` | Used by `change-debug-launch-for-build` and related debug commands |
| `getPlatformName()` / `getPlatformNameAsync()` | `platform-detection.test.ts` | Used throughout extension for platform-specific logic |
| `getPythonCommand()` / `resetPythonCommand()` | `python-command.test.ts` | Used by `setup-west-environment` and all west operations |
| `getToolchainDir()` | `toolchain-config.test.ts` | `zephyr-ide.get-toolchain-path` |
| `getVenvPath()` | `venv-config.test.ts` | Used by workspace setup for Python venv creation |
| `getEnvironmentSetupState()` | `env-detection.test.ts` | Used by workspace activation to detect external Zephyr environments |

### ❌ Commands with No Test Coverage

The **Recommended Test Type** column indicates the minimum test infrastructure required to cover each command:

| Icon | Meaning |
|------|---------|
| 🧪 **Unit** | Core logic can be tested by calling the underlying function directly, without a running VS Code extension host or hardware. A mock `WorkspaceConfig` object is sufficient. |
| 🔌 **VS Code Integration** | Requires a live VS Code extension host (i.e., the full `activate()` function must have run and VS Code APIs must be available). No physical hardware needed. |
| 🔧 **Hardware** | Requires a connected physical target device (for flashing, debugging, or attaching to a running program). |

#### Workspace Setup & West Operations

| Command | Category | Recommended Test Type |
|---------|----------|-----------------------|
| `zephyr-ide.setup-west-environment` | Workspace Setup | 🔌 VS Code Integration |
| `zephyr-ide.west-init` | West Operations | 🔌 VS Code Integration |
| `zephyr-ide.west-update` | West Operations | 🔌 VS Code Integration |
| `zephyr-ide.west-list` | West Operations | 🔌 VS Code Integration |
| `zephyr-ide.west-config` | West Config | 🔌 VS Code Integration |
| `zephyr-ide.create-new-west-workspace` | West Operations | 🔌 VS Code Integration |
| `zephyr-ide.refresh-west-workspaces` | West Operations | 🔌 VS Code Integration |
| `zephyr-ide.mark-west-as-ready` | West Operations | 🔌 VS Code Integration |
| `zephyr-ide.reset-workspace` | Workspace Management | 🔌 VS Code Integration |
| `zephyr-ide.manage-workspaces` | Workspace Management | 🔌 VS Code Integration |
| `zephyr-ide.install-sdk` | SDK Management | 🔌 VS Code Integration |
| `zephyr-ide.reset-zephyr-install-selection` | SDK Management | 🔌 VS Code Integration |
| `zephyr-ide.workspace-setup-picker` | Workspace Setup | 🔌 VS Code Integration |
| `zephyr-ide.workspace-setup-from-current-directory` | Workspace Setup | 🔌 VS Code Integration |
| `zephyr-ide.select-existing-west-workspace` | Workspace Setup | 🔌 VS Code Integration |
| `zephyr-ide.set-workspace-settings` | Settings | 🔌 VS Code Integration |
| `zephyr-ide.install-host-tools` | Host Tools (interactive variant) | 🔌 VS Code Integration |

#### Project Management

| Command | Category | Recommended Test Type |
|---------|----------|-----------------------|
| `zephyr-ide.remove-project` | Project Management | 🔌 VS Code Integration |
| `zephyr-ide.clear-projects` | Project Management | 🔌 VS Code Integration |
| `zephyr-ide.load-projects-from-file` | Project Management | 🔌 VS Code Integration |
| `zephyr-ide.save-projects-to-file` | Project Management | 🔌 VS Code Integration |
| `zephyr-ide.set-active-project` | Project Selection | 🔌 VS Code Integration |
| `zephyr-ide.disable-automatic-project-target` | Project Management | 🧪 Unit (sets a boolean flag on `WorkspaceConfig`) |
| `zephyr-ide.enable-automatic-project-target` | Project Management | 🧪 Unit (sets a boolean flag on `WorkspaceConfig`) |
| `zephyr-ide.add-project-config-files` | Project Config | 🔌 VS Code Integration |
| `zephyr-ide.remove-project-config-files` | Project Config | 🔌 VS Code Integration |
| `zephyr-ide.add-project-overlay-files` | Project Config | 🔌 VS Code Integration |
| `zephyr-ide.remove-project-overlay-files` | Project Config | 🔌 VS Code Integration |

#### Build Management

| Command | Category | Recommended Test Type |
|---------|----------|-----------------------|
| `zephyr-ide.remove-build` | Build Management | 🔌 VS Code Integration |
| `zephyr-ide.set-active-build` | Build Selection | 🔌 VS Code Integration |
| `zephyr-ide.add-build-config-files` | Build Config | 🔌 VS Code Integration |
| `zephyr-ide.remove-build-config-files` | Build Config | 🔌 VS Code Integration |
| `zephyr-ide.add-build-overlay-files` | Build Config | 🔌 VS Code Integration |
| `zephyr-ide.remove-build-overlay-files` | Build Config | 🔌 VS Code Integration |
| `zephyr-ide.modify-build-arguments` | Build Config | 🔌 VS Code Integration |
| `zephyr-ide.build-pristine` | Build Operations | 🔌 VS Code Integration |
| `zephyr-ide.clean` | Build Operations | 🔌 VS Code Integration |

#### Device Operations

| Command | Category | Recommended Test Type |
|---------|----------|-----------------------|
| `zephyr-ide.flash` | Device Operations | 🔧 Hardware |
| `zephyr-ide.debug` | Device Operations | 🔧 Hardware |
| `zephyr-ide.debug-attach` | Device Operations | 🔧 Hardware |
| `zephyr-ide.build-debug` | Device Operations | 🔧 Hardware (debug launch requires target; build step alone is 🔌 VS Code Integration) |

#### Runner Management

| Command | Category | Recommended Test Type |
|---------|----------|-----------------------|
| `zephyr-ide.add-runner` | Runner Management | 🔌 VS Code Integration |
| `zephyr-ide.remove-runner` | Runner Management | 🔌 VS Code Integration |
| `zephyr-ide.set-active-runner` | Runner Selection | 🔌 VS Code Integration |

#### Debug Configuration

| Command | Category | Recommended Test Type |
|---------|----------|-----------------------|
| `zephyr-ide.change-debug-launch-for-build` | Debug Config | 🔌 VS Code Integration |
| `zephyr-ide.change-build-debug-launch-for-build` | Debug Config | 🔌 VS Code Integration |
| `zephyr-ide.change-debug-attach-launch-for-build` | Debug Config | 🔌 VS Code Integration |

#### Debugger Helper Commands

| Command | Category | Recommended Test Type |
|---------|----------|-----------------------|
| `zephyr-ide.get-active-project-name` | Debugger Helpers | 🧪 Unit (returns `wsConfig.activeProject`) |
| `zephyr-ide.get-active-project-path` | Debugger Helpers | 🧪 Unit (path computed from `wsConfig`) |
| `zephyr-ide.get-active-build-path` | Debugger Helpers | 🧪 Unit (path computed from `wsConfig`) |
| `zephyr-ide.get-active-build-board-path` | Debugger Helpers | 🧪 Unit (path computed from `wsConfig`) |
| `zephyr-ide.get-active-board-name` | Debugger Helpers | 🧪 Unit (reads board name from `wsConfig`) |
| `zephyr-ide.select-active-build-path` | Debugger Helpers | 🔌 VS Code Integration (triggers `setActiveProject`/`setActiveBuild` UI flow) |
| `zephyr-ide.get-arm-gdb-path` | Debugger Helpers | 🧪 Unit (delegates to `getArmGdbPath(wsConfig)`) |
| `zephyr-ide.get-gdb-path` | Debugger Helpers | 🧪 Unit (delegates to `getGdbPath(wsConfig)`) |
| `zephyr-ide.get-zephyr-dir` | Debugger Helpers | 🔌 VS Code Integration (calls `getSetupState(context, wsConfig)` which needs VS Code context) |
| `zephyr-ide.get-zephyr-elf` | Debugger Helpers | 🧪 Unit (delegates to `getZephyrElfPath(wsConfig)`) |
| `zephyr-ide.get-zephyr-elf-dir` | Debugger Helpers | 🧪 Unit (delegates to `getZephyrElfDir(wsConfig)`) |
| `zephyr-ide.get-toolchain-path` | Debugger Helpers | 🧪 Unit (underlying `getToolchainDir()` is already unit tested) |
| `zephyr-ide.get-zephyr-ide-json-variable` | Variable Resolution | 🧪 Unit (JSON variable resolution from `wsConfig`) |
| `zephyr-ide.get-active-project-variable` | Variable Resolution | 🧪 Unit (variable resolution from project config in `wsConfig`) |
| `zephyr-ide.get-active-build-variable` | Variable Resolution | 🧪 Unit (variable resolution from build config in `wsConfig`) |

#### Test/Twister Commands

| Command | Category | Recommended Test Type |
|---------|----------|-----------------------|
| `zephyr-ide.add-test` | Twister | 🔌 VS Code Integration |
| `zephyr-ide.remove-test` | Twister | 🔌 VS Code Integration |
| `zephyr-ide.set-active-test` | Twister | 🔌 VS Code Integration |
| `zephyr-ide.run-test` | Twister | 🔌 VS Code Integration (Twister can run via QEMU without hardware) |
| `zephyr-ide.remove-test-dirs` | Twister | 🔌 VS Code Integration |
| `zephyr-ide.reconfigure-active-test` | Twister | 🔌 VS Code Integration |

#### Kconfig, DTS & Reports

| Command | Category | Recommended Test Type |
|---------|----------|-----------------------|
| `zephyr-ide.start-menu-config` | Kconfig | 🔌 VS Code Integration |
| `zephyr-ide.start-gui-config` | Kconfig | 🔌 VS Code Integration |
| `zephyr-ide.run-ram-report` | Reports | 🔌 VS Code Integration |
| `zephyr-ide.run-rom-report` | Reports | 🔌 VS Code Integration |
| `zephyr-ide.start-dtsh-shell` | Device Tree | 🔌 VS Code Integration |
| `zephyr-ide.reint-dts` | Device Tree | 🔌 VS Code Integration |

#### UI & Miscellaneous

| Command | Category | Recommended Test Type |
|---------|----------|-----------------------|
| `zephyr-ide.show-container` | UI / Webview | 🔌 VS Code Integration |
| `zephyr-ide.update-web-view` | UI Refresh | 🔌 VS Code Integration |
| `zephyr-ide.open-setup-panel` | UI Panels | 🔌 VS Code Integration |
| `zephyr-ide.open-host-tools-panel` | UI Panels | 🔌 VS Code Integration |
| `zephyr-ide.debug-internal-shell` | Debug | 🔌 VS Code Integration |
| `zephyr-ide.shell_test` | Debug / Testing | 🔌 VS Code Integration |

---

## CI Pipeline Availability

### How test selection works

All CI pipelines invoke tests via `node scripts/run-integration-tests.js <type>`, which
runs `npx vscode-test --grep '<pattern>'`. Mocha's `--grep` flag performs a **regex match**
against suite and test names. Only suites whose names match the pattern will execute.

### `unit-tests.yml` — Ubuntu Only, Unit Tests

Runs on every PR to `develop` and on manual dispatch.

| Step | `--grep` Pattern | Suites Matched |
|------|------------------|----------------|
| `unit-tests` | `^(?!.*(Workspace|Combined))` | All 7 unit test suites (negative lookahead excludes any suite containing "Workspace" or "Combined") |

The 7 unit suites matched are:

- `Environment Variable Detection Test Suite`
- `Git URL Validation Test Suite`
- `Launch Configuration Test Suite`
- `Platform Detection Test Suite`
- `Python Command Test Suite`
- `Toolchain Configuration Test Suite`
- `Venv Configuration Test Suite`

### `workspace-setup-tests.yml` — Ubuntu Only, All Workspace Types

| Step | `--grep` Pattern | Suites Matched | Unit tests included? |
|------|------------------|----------------|----------------------|
| `external-zephyr` | `Workspace External Zephyr Test Suite` | `workspace-external-zephyr.test.ts` only | ❌ No |
| `standard` | `Standard Workspace Test Suite` | `workspace-standard.test.ts` only | ❌ No |
| `west-git` | `West Git Workspace Test Suite` | `workspace-west-git.test.ts` only | ❌ No |
| `zephyr-ide-git` | `Workspace Zephyr IDE Git Test Suite` | `workspace-zephyr-ide-git.test.ts` only | ❌ No |
| `local-west` | `Workspace Local West Test Suite` | `workspace-local-west.test.ts` only | ❌ No |

**Triggers:** PRs to `main`/`pre-release`/`develop` (conditional), pushes to `develop` (on version bump), manual dispatch.

### `basic-tests.yml` — Ubuntu Only

| Step | `--grep` Pattern | Suites Matched | Unit tests included? |
|------|------------------|----------------|----------------------|
| `combined` | `Combined Installation Test Suite` | `combined-installation.test.ts` only | ❌ No |

**Triggers:** PRs to `develop`, manual dispatch. Always Ubuntu-only.

### `multiplatform-tests.yml` — Ubuntu / Windows / macOS

| Step | `--grep` Pattern | Suites Matched | Unit tests included? |
|------|------------------|----------------|----------------------|
| `combined` | `Combined Installation Test Suite` | `combined-installation.test.ts` only | ❌ No |

**Triggers:** PRs to `main`/`pre-release`, pushes to `main`/`pre-release`, manual dispatch.
Runs on all three platforms (Ubuntu, Windows, macOS).

Both `basic-tests.yml` and `multiplatform-tests.yml` call the shared reusable workflow
`_shared-platform-test.yml` which contains the VSIX build and test execution logic.

### Summary: Which tests run in which pipeline?

| Pipeline | Trigger | Unit Tests | Integration Tests |
|----------|---------|------------|-------------------|
| `unit-tests.yml` | PRs to `develop` | ✅ All 7 unit suites | ❌ No |
| `basic-tests.yml` | PRs to `develop` | ❌ No | ✅ `combined-installation` only (Ubuntu) |
| `multiplatform-tests.yml` | PRs to `develop` (`bump-version-*` or `full_test` label), manual dispatch | ❌ No | ✅ `combined-installation` (Ubuntu + Windows + macOS) |
| `workspace-setup-tests.yml` | PRs to `develop` (`bump-version-*` or `full_test` label), manual dispatch | ❌ No | ✅ All 5 workspace setup suites (Ubuntu) |

To run all tests locally:

```bash
# Run unit tests only (fast, no SDK needed)
xvfb-run -a npx vscode-test --grep '^(?!.*(Workspace|Combined))'

# Run all tests (unit + integration) — matches all *Test Suite names
node scripts/run-integration-tests.js all

# Or run directly via vscode-test
npx vscode-test
```

---

## Coverage Summary

| Metric | Count |
|--------|-------|
| Commands in `package.json` (user-facing, contributed to VS Code UI) | 90 |
| Commands registered via `registerCommand` in `extension.ts` (includes headless/test-only variants not in `package.json`) | 101 |
| Commands exercised in integration tests | ~16 |
| Utility functions covered by unit tests | ~7 |
| Commands with **no test coverage** | ~74 |
| **Approximate command-level coverage** | **~18%** |

### Coverage by Category

| Category | Total Commands | Tested | Coverage |
|----------|---------------|--------|----------|
| Workspace Setup | 10 | 4 | 40% |
| West Operations | 7 | 0 | 0% |
| Project Management | 7 | 2 | 29% |
| Project Config (files/overlays) | 4 | 0 | 0% |
| Build Management | 7 | 2 | 29% |
| Build Operations | 3 | 1 | 33% |
| Device Operations (flash/debug) | 4 | 0 | 0% |
| Runner Management | 3 | 0 | 0% |
| Debug Config | 3 | 0 | 0% |
| Debugger Helpers | 12 | 0 | 0% |
| Variable Resolution | 3 | 0 | 0% |
| Twister / Testing | 6 | 0 | 0% |
| Kconfig / DTS / Reports | 6 | 0 | 0% |
| UI / Panels | 5 | 2 | 40% |
| Host Tools / SDK | 6 | 3 | 50% |
| Misc / Internal | 3 | 2 | 67% |

### Untested Commands by Required Test Infrastructure

The following breakdown shows how many untested commands fall into each recommended test type:

| Recommended Test Type | Count | Description |
|-----------------------|-------|-------------|
| 🧪 Unit | ~13 | Path getters, variable resolvers, flag toggles — no VS Code host needed |
| 🔌 VS Code Integration | ~57 | Require a live extension host; no hardware needed |
| 🔧 Hardware | 4 | `flash`, `debug`, `debug-attach`, `build-debug` — require a connected target device |
