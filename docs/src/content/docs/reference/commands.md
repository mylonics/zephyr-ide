---
title: Commands
description: Complete reference of all IDE for Zephyr VS Code commands for workspace setup, project management, building, debugging, and testing. Access via command palette (Ctrl+Shift+P).
---

IDE for Zephyr provides the following commands accessible via the command palette (Ctrl+Shift+P or Cmd+Shift+P):

## Setup and Workspace Management

- `IDE for Zephyr: Workspace Setup` - Open workspace setup picker
- `IDE for Zephyr: Setup Workspace from Git` - Clone and setup workspace from Git repository
- `IDE for Zephyr: Setup West Workspace from Git` - Clone and setup West workspace from Git
- `IDE for Zephyr: Setup Workspace from Current Directory` - Initialize current directory as workspace
- `IDE for Zephyr: Setup Standard Workspace` - Create new standard workspace
- `IDE for Zephyr: Setup West Environment` - Setup West environment
- `IDE for Zephyr: West Init` - Initialize West workspace
- `IDE for Zephyr: West Update` - Update West workspace
- `IDE for Zephyr: West List` - List west workspace modules
- `IDE for Zephyr: West Config` - Configure West settings
- `IDE for Zephyr: Reset Workspace` - Reset workspace configuration
- `IDE for Zephyr: Open Setup Panel` - Open the setup panel interface
- `IDE for Zephyr: Create New West Workspace` - Create new West workspace
- `IDE for Zephyr: Refresh West Workspaces` - Refresh workspace list
- `IDE for Zephyr: Select Existing West Workspace` - Select from existing workspaces
- `IDE for Zephyr: Manage Workspace Installations` - Manage workspace installations
- `IDE for Zephyr: Mark West as Ready` - Mark West workspace as ready
- `IDE for Zephyr: Set Workspace Settings` - Configure workspace settings
- `IDE for Zephyr: Reset Zephyr Install Selection` - Reset Zephyr installation selection
- `IDE for Zephyr: Print Workspace Structure` - Print workspace structure to console

## Host Tools and SDK Management

- `IDE for Zephyr: Host Tools Installation` - Open host tools installation panel
- `IDE for Zephyr: Install Host Tools` - Install required host tools
- `IDE for Zephyr: Setup Check Build Dependencies Available` - Check build dependencies
- `IDE for Zephyr: Install SDK` - Install Zephyr SDK
- `IDE for Zephyr: Reinitialize DTS Language Server` - Reinitialize DTS language server

## Project Management

- `IDE for Zephyr: Add Project` - Add existing project
- `IDE for Zephyr: Create Project From Template` - Create new project from template
- `IDE for Zephyr: Remove Project` - Remove project
- `IDE for Zephyr: Set Active Project` - Set active project
- `IDE for Zephyr: Clear Projects` - Clear all projects
- `IDE for Zephyr: Load Projects From File` - Load projects from zephyr-ide.json
- `IDE for Zephyr: Save Projects To File` - Save projects to zephyr-ide.json
- `IDE for Zephyr: Add Project KConfig Files` - Add KConfig files to project
- `IDE for Zephyr: Remove Project KConfig Files` - Remove KConfig files from project
- `IDE for Zephyr: Add Project Overlay Files` - Add overlay files to project
- `IDE for Zephyr: Remove Project Overlay Files` - Remove overlay files from project

## Build Configuration Management

- `IDE for Zephyr: Add Build Configuration` - Add new build configuration
- `IDE for Zephyr: Remove Build` - Remove build configuration
- `IDE for Zephyr: Set Active Build` - Set active build configuration
- `IDE for Zephyr: Add Build KConfig Files` - Add KConfig files to build
- `IDE for Zephyr: Remove Build KConfig Files` - Remove KConfig files from build
- `IDE for Zephyr: Add Build Overlay Files` - Add overlay files to build
- `IDE for Zephyr: Remove Build Overlay Files` - Remove overlay files from build
- `IDE for Zephyr: Modify Build Arguments` - Modify build arguments

## Runner Management

- `IDE for Zephyr: Add Runner` - Add runner to build configuration
- `IDE for Zephyr: Remove Runner` - Remove runner from build configuration
- `IDE for Zephyr: Set Active Runner` - Set active runner

## Build and Flash Operations

- `IDE for Zephyr: Build Pristine` - Build with pristine flag (clean build)
- `IDE for Zephyr: Build` - Build active project
- `IDE for Zephyr: Clean` - Clean build artifacts
- `IDE for Zephyr: Flash` - Flash build to target device

## Debug Operations

- `IDE for Zephyr: Debug` - Start debugging session
- `IDE for Zephyr: Debug Attach` - Attach debugger to running target
- `IDE for Zephyr: Build and Debug` - Build and start debugging
- `IDE for Zephyr: Change Debug Launch Configuration For Build` - Change debug launch configuration
- `IDE for Zephyr: Change Build and Debug Launch Configuration For Build` - Change build and debug launch configuration
- `IDE for Zephyr: Change Debug Attach Launch Configuration For Build` - Change debug attach launch configuration

## Configuration and Analysis Tools

- `IDE for Zephyr: Start Menu Config` - Start Kconfig menu configuration
- `IDE for Zephyr: Start GUI Config` - Start Kconfig GUI configuration
- `IDE for Zephyr: Run ROM Report` - Generate ROM usage report
- `IDE for Zephyr: Run RAM Report` - Generate RAM usage report
- `IDE for Zephyr: Start DTSh Shell` - Start devicetree shell

## Testing with Twister

- `IDE for Zephyr: Add Twister Test to Project` - Add Twister test
- `IDE for Zephyr: Remove Twister Test from Project` - Remove Twister test
- `IDE for Zephyr: Set Active Test` - Set active test
- `IDE for Zephyr: Run Test` - Run Twister test
- `IDE for Zephyr: Reconfigure Active Test` - Reconfigure active test
- `IDE for Zephyr: Delete Test Output Directories` - Delete test output directories

## Automatic Project Targeting

- `IDE for Zephyr: Enable Automatic Active Project Targeting` - Enable automatic project targeting based on active file
- `IDE for Zephyr: Disable Automatic Active Project Targeting` - Disable automatic project targeting

## Utility Commands

- `IDE for Zephyr: Show View Container` - Show IDE for Zephyr view container
- `IDE for Zephyr: Reload Web Views` - Reload web view panels
- `IDE for Zephyr: Debug Internal Shell` - Debug internal shell
- `IDE for Zephyr: Shell Test` - Test shell functionality
- `IDE for Zephyr: Print Python Interpreter Path` - Print the Python interpreter path for the active workspace

## Launch Configuration Helpers

The following commands are used in `launch.json` to dynamically retrieve project and build information. See [Launch Configuration Helpers](launch-configuration.md) for detailed usage.

- `IDE for Zephyr: Get Active Project Name` - Get the name of the currently active project
- `IDE for Zephyr: Get Active Project Path` - Get the file system path to the currently active project
- `IDE for Zephyr: Get Active Build Path` - Get the build directory path for the active build configuration
- `IDE for Zephyr: Get Active Build Board Path` - Get the board directory path for the active build
- `IDE for Zephyr: Get Active Board Name` - Get the board name for the active build configuration
- `IDE for Zephyr: Select Active Build Path` - Prompt the user to select a build configuration and return its path
- `IDE for Zephyr: Get GDB Path` - Get the GDB path (CMAKE_GDB) for the active build
- `IDE for Zephyr: Get ARM GDB Path` - Get the ARM GDB path (without Python support) for the active build
- `IDE for Zephyr: Get Toolchain Path` - Get the toolchain directory path for the active build
- `IDE for Zephyr: Get Zephyr Directory` - Get the Zephyr source directory path
- `IDE for Zephyr: Get Zephyr ELF Path` - Get the full path to the kernel ELF file for the active build
- `IDE for Zephyr: Get Zephyr ELF Directory` - Get the directory containing the kernel ELF file for the active build
- `IDE for Zephyr: Get Zephyr IDE JSON Variable` - Get a variable value from the zephyr-ide.json file
- `IDE for Zephyr: Get Active Project Variable` - Get a custom variable from the active project's `vars` section
- `IDE for Zephyr: Get Active Build Variable` - Get a custom variable from the active build's `vars` section
