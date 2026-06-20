---
title: Command Reference
description: Complete list of user-facing IDE for Zephyr VS Code commands — setup, workspace lifecycle, host tools, SDK management, project/build workflows, debugging, testing, and launch helpers.
---

Most IDE for Zephyr actions are available from the command palette (`Ctrl+Shift+P` / `Cmd+Shift+P`). Many of the same actions also appear as buttons in the Setup Panel, Project Details panel, tree views, and status bar.

## Setup Panel, Views, and Navigation

- `Zephyr IDE: Overview` - Open the top-level setup overview panel
- `Zephyr IDE: Workspace Setup` - Open the workspace setup picker
- `Zephyr IDE: Open Workspace Config` - Jump from the overview to the workspace configuration panel
- `Zephyr IDE: Open SDK Management` - Jump from the overview to the SDK management panel
- `Zephyr IDE: Workspace Config` - Open the workspace configuration panel directly
- `Zephyr IDE: Host Tools` - Open the host tools panel directly
- `Zephyr IDE: SDK Management` - Open the SDK management panel directly
- `Zephyr IDE: Project Details` - Open the active build's project details panel
- `Zephyr IDE: Zephyr IDE Manager` - Open the manager panel for shared `zephyr-ide.json` requirements such as toolchains, blobs, pip packages, sample projects, and post-setup commands
- `Zephyr IDE: Open Settings` - Open the extension settings panel
- `Zephyr IDE: Show View Container` - Focus the IDE for Zephyr activity bar container
- `Zephyr IDE: Reload Panels` - Reload IDE for Zephyr webview panels

## Workspace Setup and Registration

- `Zephyr IDE: Setup Workspace from Git` - Clone and set up a workspace from a repository that already contains IDE for Zephyr configuration
- `Zephyr IDE: Setup West Workspace from Git` - Clone and set up an existing west-based workspace from Git
- `Zephyr IDE: Setup Workspace from Current Directory` - Use the current VS Code folder as the workspace root
- `Zephyr IDE: Setup Standard Workspace` - Create a fresh workspace with west and Zephyr initialized for you
- `Zephyr IDE: Setup Workspace from External Directory` - Register and configure a workspace that lives outside the currently open folder
- `Zephyr IDE: Setup West Environment` - Create the workspace Python environment and install west
- `Zephyr IDE: West Init` - Initialize a workspace from a `west.yml`
- `Zephyr IDE: West Update` - Fetch Zephyr and module sources for the active workspace
- `Zephyr IDE: West List` - List modules in the active west workspace
- `Zephyr IDE: West Config` - Edit west configuration for the active workspace
- `Zephyr IDE: Create New West Workspace` - Create and register another west workspace
- `Zephyr IDE: Refresh West Workspaces` - Refresh the registered workspace list
- `Zephyr IDE: Select Existing West Workspace` - Switch to another registered workspace
- `Zephyr IDE: Manage Workspace Installations` - Open the multi-workspace manager
- `Zephyr IDE: Set Workspace Settings` - Write recommended VS Code workspace settings for the active workspace

## Workspace Lifecycle and Recovery

- `Zephyr IDE: Deactivate Workspace` - Stop using the current registered workspace without deleting its registration
- `Zephyr IDE: Unregister Workspace` - Remove a workspace from the extension's registry
- `Zephyr IDE: Re-run West Setup` - Re-run the west setup/update flow for the active workspace
- `Zephyr IDE: Reset Workspace` - Clear workspace configuration so setup can be started again
- `Zephyr IDE: Reset Active Installation` - Clear the currently selected Zephyr installation
- `Zephyr IDE: Skip West Setup` - Mark the current workspace as ready when west is already prepared externally
- `Zephyr IDE: Show Workspace Structure` - Print the active workspace layout for inspection/troubleshooting

## Host Tools, SDK, and Shared Workspace Requirements

- `Zephyr IDE: Install Host Tools` - Install missing build dependencies using the supported package manager for your platform
- `Zephyr IDE: Check Build Dependencies` - Re-scan PATH and verify host tools required for building
- `Zephyr IDE: Install SDK` - Install or manage Zephyr SDK versions and architectures
- `Zephyr IDE: Modify zephyr-ide.json Toolchains` - Edit the workspace's required SDK toolchain list
- `Zephyr IDE: Install Toolchains from zephyr-ide.json` - Install the toolchains declared in `.vscode/zephyr-ide.json`
- `Zephyr IDE: Modify zephyr-ide.json Blobs` - Edit the workspace's required west blob modules
- `Zephyr IDE: Install Blobs from zephyr-ide.json` - Fetch blobs declared in `.vscode/zephyr-ide.json`
- `Zephyr IDE: Modify zephyr-ide.json Pip Packages` - Edit extra Python packages to install into the workspace virtual environment
- `Zephyr IDE: Install Pip Packages from zephyr-ide.json` - Install only the extra pip packages declared in `.vscode/zephyr-ide.json`
- `Zephyr IDE: Modify zephyr-ide.json Pip Requirements` - Edit additional `requirements.txt` paths for the workspace virtual environment
- `Zephyr IDE: Install Pip Requirements from zephyr-ide.json` - Install only the additional requirements files declared in `.vscode/zephyr-ide.json`
- `Zephyr IDE: Install Pip Packages and Requirements from zephyr-ide.json` - Install the workspace's extra pip packages and requirements together
- `Zephyr IDE: Modify Sample Projects (zephyr-ide.json)` - Edit the optional sample project library stored in `.vscode/zephyr-ide.json`
- `Zephyr IDE: Add Sample Projects From File` - Load selected sample project entries from `.vscode/zephyr-ide.json` into the current workspace
- `Zephyr IDE: Modify Commands (zephyr-ide.json)` - Edit platform-specific post-setup commands stored in `.vscode/zephyr-ide.json`
- `Zephyr IDE: Run Commands from zephyr-ide.json` - Prompt for and run selected post-setup commands from `.vscode/zephyr-ide.json`
- `Zephyr IDE: Reinitialize DTS Language Server` - Reinitialize the Devicetree language server integration

## Project Management

- `Zephyr IDE: Add Project` - Add an existing application to the workspace
- `Zephyr IDE: Create Project From Template` - Copy a Zephyr sample or template into the workspace as a new project
- `Zephyr IDE: Remove Project` - Remove a project from IDE for Zephyr
- `Zephyr IDE: Set Active Project` - Switch the active project
- `Zephyr IDE: Clear Projects` - Remove all project registrations from the current workspace
- `Zephyr IDE: Load Projects From File` - Load project configuration from `.vscode/zephyr-ide.json`
- `Zephyr IDE: Save Projects To File` - Save the current project/build/test state to `.vscode/zephyr-ide.json`
- `Zephyr IDE: Add Project Kconfig Files` - Add project-level Kconfig fragments
- `Zephyr IDE: Remove Project Kconfig Files` - Remove project-level Kconfig fragments
- `Zephyr IDE: Add Project Overlay Files` - Add project-level devicetree overlays
- `Zephyr IDE: Remove Project Overlay Files` - Remove project-level devicetree overlays

## Build Configuration Management

- `Zephyr IDE: Manage Build Variables` - Add, edit, or remove active-build `customVars` values for use in runner args, tasks, and launch configs
- `Zephyr IDE: Manage Project Variables` - Add, edit, or remove active-project `customVars` values
- `Zephyr IDE: Add Build Configuration` - Add another build for the active project
- `Zephyr IDE: Remove Build` - Remove a build configuration
- `Zephyr IDE: Set Active Build` - Switch the active build
- `Zephyr IDE: Add Build Kconfig Files` - Add build-specific Kconfig fragments
- `Zephyr IDE: Remove Build Kconfig Files` - Remove build-specific Kconfig fragments
- `Zephyr IDE: Add Build Overlay Files` - Add build-specific devicetree overlays
- `Zephyr IDE: Remove Build Overlay Files` - Remove build-specific devicetree overlays
- `Zephyr IDE: Modify Build Arguments` - Edit the active build's `west build` and CMake arguments

## Runner Profiles and Debug Configuration

- `Zephyr IDE: Select Active Runner Profile (Local)` (`zephyr-ide.set-active-profile`) - Set a local runner-profile override for the active build without changing committed JSON
- `Zephyr IDE: Set Local Slot Runner Bind` (`zephyr-ide.set-local-bind`) - Override just one slot (Flash, Debug, or Attach) locally
- `Zephyr IDE: Open Runner Profile Panel` - Create, edit, rename, and delete runner profiles at workspace or user scope
- `Zephyr IDE: Change Debug Launch Configuration` (`zephyr-ide.change-launch-for-build`) - Bind a named `launch.json` configuration to the active build's debug slot
- `Zephyr IDE: Open runners.yaml for Active Build` (`zephyr-ide.open-runners-yaml`) - Open the generated `runners.yaml` for the active build

Runner profiles are documented in more detail in [Configuration Settings](configuration.md#runner-profiles) and [Building & Debugging](../user-guide/building-debugging.md#runner-profiles-flash--debug).

## Build, Flash, and Debug Operations

- `Zephyr IDE: Build Pristine` - Reconfigure and rebuild with `--pristine`
- `Zephyr IDE: Build` - Build the active project/build
- `Zephyr IDE: Clean` - Delete build artifacts for the active build
- `Zephyr IDE: Flash` - Flash the existing build output, or build first if `zephyr-ide.buildBeforeFlash` is enabled
- `Zephyr IDE: Build and Flash` - Build first, then flash
- `Zephyr IDE: Debug` - Start a debug session
- `Zephyr IDE: Debug Attach` - Attach to a running debug-capable target
- `Zephyr IDE: Build and Debug` - Build first, then debug
- `Zephyr IDE: Set Active Sysbuild Image` (`zephyr-ide.set-sysbuild-image`) - Choose which sysbuild image/domain Flash, Debug, and Debug Attach target

## Analysis, Reports, and Configuration Tools

- `Zephyr IDE: Open Build Dashboard` - Open the interactive Build Dashboard
- `Zephyr IDE: Zephyr Dashboard Report` - Refresh RAM/ROM usage and symbol data consumed by the Build Dashboard
- `Zephyr IDE: Start Menu Config` - Run `west build -t menuconfig`
- `Zephyr IDE: Start GUI Config` - Run `west build -t guiconfig`
- `Zephyr IDE: Zephyr ROM Report` - Print the ROM usage report in the terminal
- `Zephyr IDE: Zephyr RAM Report` - Print the RAM usage report in the terminal
- `Zephyr IDE: Start DTSh Shell` - Open the Devicetree shell

## Testing with Twister

- `Zephyr IDE: Add Twister Test to Project` - Add a Twister test configuration to the active project
- `Zephyr IDE: Remove Twister Test from Project` - Remove a Twister test configuration
- `Zephyr IDE: Set Active Test` - Switch the active Twister configuration
- `Zephyr IDE: Run Test` - Run the active Twister configuration
- `Zephyr IDE: Reconfigure Active Test` - Edit the active Twister configuration
- `Zephyr IDE: Delete Test Output Directories` - Delete Twister output folders for a clean re-run

## Automatic Project Targeting

- `Zephyr IDE: Enable Automatic Active Project Targeting` - Switch the active project automatically when editor focus moves into another registered project
- `Zephyr IDE: Disable Automatic Active Project Targeting` - Turn that behavior off

## Utilities and Advanced Diagnostics

- `Zephyr IDE: Show Python Interpreter Path` - Print the Python interpreter path the extension resolved for the active workspace
- `Zephyr IDE: Shell Test` - Run an internal shell integration check
- `Zephyr IDE: Extension Debug — Dump State` - Print extension state for debugging
- `Zephyr IDE: Extension Debug — Mark Host Tools Not Ready` - Force the host-tools state back to "not ready"
- `Zephyr IDE: Extension Debug — Mark SDK Not Installed` - Force the SDK state back to "not installed"

## Launch Configuration Helpers

These commands are primarily used inside `launch.json` and `tasks.json`. See [Launch Configuration Helpers](launch-configuration.md) for examples and argument details.

- `Zephyr IDE: Get Active Project Name`
- `Zephyr IDE: Get Active Project Path`
- `Zephyr IDE: Get Active Build Path`
- `Zephyr IDE: Get Active Build Board Path`
- `Zephyr IDE: Get Active Board Name`
- `Zephyr IDE: Select Active Build Path`
- `Zephyr IDE: Get GDB Path`
- `Zephyr IDE: Get ARM GDB Path`
- `Zephyr IDE: Get Toolchain Path`
- `Zephyr IDE: Get Zephyr Directory`
- `Zephyr IDE: Get Zephyr ELF Path`
- `Zephyr IDE: Get Zephyr ELF Directory`
- `Zephyr IDE: Get Zephyr IDE JSON Variable`
- `Zephyr IDE: Get Active Project Variable`
- `Zephyr IDE: Get Active Build Variable`
