---
title: Command Reference
description: Complete list of all IDE for Zephyr VS Code commands — workspace setup, west operations, project management, build, flash, debug, Twister testing, and launch configuration helpers.
---

Zephyr IDE provides the following commands accessible via the command palette (Ctrl+Shift+P or Cmd+Shift+P):

## Setup and Workspace Management

- `Zephyr IDE: Workspace Setup` - Open workspace setup picker
- `Zephyr IDE: Setup Workspace from Git` - Clone and setup workspace from Git repository
- `Zephyr IDE: Setup West Workspace from Git` - Clone and setup West workspace from Git
- `Zephyr IDE: Setup Workspace from Current Directory` - Initialize current directory as workspace
- `Zephyr IDE: Setup Standard Workspace` - Create new standard workspace
- `Zephyr IDE: Setup West Environment` - Setup West environment
- `Zephyr IDE: West Init` - Initialize West workspace
- `Zephyr IDE: West Update` - Update West workspace
- `Zephyr IDE: West List` - List west workspace modules
- `Zephyr IDE: West Config` - Configure West settings
- `Zephyr IDE: Reset Workspace` - Reset workspace configuration
- `Zephyr IDE: Open Setup Panel` - Open the setup panel interface
- `Zephyr IDE: Create New West Workspace` - Create new West workspace
- `Zephyr IDE: Refresh West Workspaces` - Refresh workspace list
- `Zephyr IDE: Select Existing West Workspace` - Select from existing workspaces
- `Zephyr IDE: Manage Workspace Installations` - Manage workspace installations
- `Zephyr IDE: Mark West as Ready` - Mark West workspace as ready
- `Zephyr IDE: Set Workspace Settings` - Configure workspace settings
- `Zephyr IDE: Reset Zephyr Install Selection` - Reset Zephyr installation selection
- `Zephyr IDE: Print Workspace Structure` - Print workspace structure to console

## Host Tools and SDK Management

- `Zephyr IDE: Host Tools Installation` - Open host tools installation panel
- `Zephyr IDE: Install Host Tools` - Install required host tools
- `Zephyr IDE: Setup Check Build Dependencies Available` - Check build dependencies
- `Zephyr IDE: Install SDK` - Install Zephyr SDK
- `Zephyr IDE: Modify zephyr-ide.json Toolchains` - Edit the list of toolchains required by the workspace
- `Zephyr IDE: Install Toolchains from zephyr-ide.json` - Install every toolchain declared in `.vscode/zephyr-ide.json`
- `Zephyr IDE: Modify zephyr-ide.json Blobs` - Edit the list of west modules whose blobs are required by the workspace
- `Zephyr IDE: Install Blobs from zephyr-ide.json` - Fetch every blob module declared in `.vscode/zephyr-ide.json`
- `Zephyr IDE: Reinitialize DTS Language Server` - Reinitialize DTS language server

## Project Management

- `Zephyr IDE: Add Project` - Add existing project
- `Zephyr IDE: Create Project From Template` - Create new project from template
- `Zephyr IDE: Remove Project` - Remove project
- `Zephyr IDE: Set Active Project` - Set active project
- `Zephyr IDE: Clear Projects` - Clear all projects
- `Zephyr IDE: Load Projects From File` - Load projects from zephyr-ide.json
- `Zephyr IDE: Save Projects To File` - Save projects to zephyr-ide.json
- `Zephyr IDE: Add Project KConfig Files` - Add KConfig files to project
- `Zephyr IDE: Remove Project KConfig Files` - Remove KConfig files from project
- `Zephyr IDE: Add Project Overlay Files` - Add overlay files to project
- `Zephyr IDE: Remove Project Overlay Files` - Remove overlay files from project

## Build Configuration Management

- `Zephyr IDE: Manage Build Variables` - Add, edit, or delete custom key-value variables on the active build (`customVars`). Variables are available as `${buildvar:key}` in runner profile args and via the `zephyr-ide.get-active-build-variable` input command in `tasks.json`/`launch.json`.
- `Zephyr IDE: Manage Project Variables` - Add, edit, or delete custom key-value variables on the active project (`customVars`). Variables are available as `${projectvar:key}` in runner profile args and via the `zephyr-ide.get-active-project-variable` input command.
- `Zephyr IDE: Add Build Configuration` - Add new build configuration
- `Zephyr IDE: Remove Build` - Remove build configuration
- `Zephyr IDE: Set Active Build` - Set active build configuration
- `Zephyr IDE: Add Build KConfig Files` - Add KConfig files to build
- `Zephyr IDE: Remove Build KConfig Files` - Remove KConfig files from build
- `Zephyr IDE: Add Build Overlay Files` - Add overlay files to build
- `Zephyr IDE: Remove Build Overlay Files` - Remove overlay files from build
- `Zephyr IDE: Modify Build Arguments` - Modify build arguments

## Runner Profile Management

- `Zephyr IDE: Select Active Runner Profile` - Choose which Runner Profile drives the active build's Flash / Debug / Attach actions, or clear it
- `Zephyr IDE: Open Runner Profile Panel` - Open the dedicated CRUD webview to create, rename, edit, and delete Runner Profiles at workspace or user scope

Runner Profiles live in two places, merged with workspace overriding user on name collision:

- `zephyr-ide.runnerProfiles` user setting — shared across workspaces.
- `.vscode/zephyr-ide.json#runnerProfiles` — committed alongside the project.

Both stores are edited interactively from the Runner Profile Panel; see [Runner Profiles](configuration.md#runner-profiles) for the data model.

## Build and Flash Operations

- `Zephyr IDE: Build Pristine` - Build with pristine flag (clean build)
- `Zephyr IDE: Build` - Build active project
- `Zephyr IDE: Clean` - Clean build artifacts
- `Zephyr IDE: Flash` - Flash build to target device. When the `zephyr-ide.buildBeforeFlash` setting is `true`, the build runs first; when `false` (default) the existing image is flashed as-is. The dedicated `Build and Flash` command always builds first regardless of this setting.
- `Zephyr IDE: Build and Flash` - Build first, then flash
- `Zephyr IDE: Set Active Sysbuild Image` (`zephyr-ide.set-sysbuild-image`) - For sysbuild-enabled builds, pick which sub-image (`--domain`) Flash, Debug and Debug Attach target. The selection is persisted per-build under `projectStates[project].buildStates[build].sysbuildImage` and is forwarded as `west flash --domain <image>` and to `runners.yaml` lookup for debug. When unset, west chooses the default domain itself.

## Debug Operations

- `Zephyr IDE: Debug` - Start a debug session (uses the active Runner Profile's `debug` bind)
- `Zephyr IDE: Debug Attach` - Attach the debugger to a running target (uses the `attach` bind)
- `Zephyr IDE: Build and Debug` - Build first, then debug. By default this shares the `debug` bind with `Zephyr IDE: Debug`; when the `zephyr-ide.separateBuildDebugProfile` setting is enabled, `Build and Debug` uses the profile's separate `buildDebug` bind instead (falling back to `debug` if `buildDebug` is unset).
- `Zephyr IDE: Change Debug Launch Configuration` (`zephyr-ide.change-launch-for-build`) - Select a `launch.json` configuration by name for the active build's debug bind.
- `Zephyr IDE: Open runners.yaml for Active Build` (`zephyr-ide.open-runners-yaml`) - Open the active build's generated `runners.yaml` in the editor. Useful when debugging an unexpected runner choice or when looking up the values cortex-debug receives via `${runners-yaml:...}` substitutions in a `zephyr-ide` debug configuration.

## Configuration and Analysis Tools

- `Zephyr IDE: Open Build Dashboard` - Open the Build Dashboard panel (interactive memory explorer, Kconfig viewer, devicetree viewer, and ELF stats) for the active build
- `Zephyr IDE: Zephyr Dashboard Report` - Generate RAM/ROM reports and symbol-table data for the active build, refreshing any open Build Dashboard
- `Zephyr IDE: Start Menu Config` - Start Kconfig menu configuration
- `Zephyr IDE: Start GUI Config` - Start Kconfig GUI configuration
- `Zephyr IDE: Run ROM Report` - Generate ROM usage report (terminal output)
- `Zephyr IDE: Run RAM Report` - Generate RAM usage report (terminal output)
- `Zephyr IDE: Start DTSh Shell` - Start devicetree shell

## Testing with Twister

- `Zephyr IDE: Add Twister Test to Project` - Add Twister test
- `Zephyr IDE: Remove Twister Test from Project` - Remove Twister test
- `Zephyr IDE: Set Active Test` - Set active test
- `Zephyr IDE: Run Test` - Run Twister test
- `Zephyr IDE: Reconfigure Active Test` - Reconfigure active test
- `Zephyr IDE: Delete Test Output Directories` - Delete test output directories

## Automatic Project Targeting

- `Zephyr IDE: Enable Automatic Active Project Targeting` - Enable automatic project targeting based on active file
- `Zephyr IDE: Disable Automatic Active Project Targeting` - Disable automatic project targeting

## Utility Commands

- `Zephyr IDE: Show View Container` - Show Zephyr IDE view container
- `Zephyr IDE: Reload Web Views` - Reload web view panels
- `Zephyr IDE: Debug Internal Shell` - Debug internal shell
- `Zephyr IDE: Shell Test` - Test shell functionality
- `Zephyr IDE: Print Python Interpreter Path` - Print the Python interpreter path for the active workspace

## Launch Configuration Helpers

The following commands are used in `launch.json` to dynamically retrieve project and build information. See [Launch Configuration Helpers](launch-configuration.md) for detailed usage.

- `Zephyr IDE: Get Active Project Name` - Get the name of the currently active project
- `Zephyr IDE: Get Active Project Path` - Get the file system path to the currently active project
- `Zephyr IDE: Get Active Build Path` - Get the build directory path for the active build configuration
- `Zephyr IDE: Get Active Build Board Path` - Get the board directory path for the active build
- `Zephyr IDE: Get Active Board Name` - Get the board name for the active build configuration
- `Zephyr IDE: Select Active Build Path` - Prompt the user to select a build configuration and return its path
- `Zephyr IDE: Get GDB Path` - Get the GDB path (CMAKE_GDB) for the active build
- `Zephyr IDE: Get ARM GDB Path` - Get the ARM GDB path (without Python support) for the active build
- `Zephyr IDE: Get Toolchain Path` - Get the toolchain directory path for the active build
- `Zephyr IDE: Get Zephyr Directory` - Get the Zephyr source directory path
- `Zephyr IDE: Get Zephyr ELF Path` - Get the full path to the kernel ELF file for the active build
- `Zephyr IDE: Get Zephyr ELF Directory` - Get the directory containing the kernel ELF file for the active build
- `Zephyr IDE: Get Zephyr IDE JSON Variable` - Get a variable value from the zephyr-ide.json file
- `Zephyr IDE: Get Active Project Variable` - Get a custom variable from the active project's `customVars` map
- `Zephyr IDE: Get Active Build Variable` - Get a custom variable from the active build's `customVars` map
