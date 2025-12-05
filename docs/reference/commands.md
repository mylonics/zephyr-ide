---
title: Zephyr IDE Commands Reference - Complete Command Palette Guide
description: Complete reference of all Zephyr IDE VS Code commands for workspace setup, project management, building, debugging, and testing. Access via command palette (Ctrl+Shift+P).
keywords: Zephyr IDE commands, command palette, VS Code commands, workspace commands, build commands, debug commands, west commands
---

# Available Commands

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

- `Zephyr IDE: Add Build Configuration` - Add new build configuration
- `Zephyr IDE: Remove Build` - Remove build configuration
- `Zephyr IDE: Set Active Build` - Set active build configuration
- `Zephyr IDE: Add Build KConfig Files` - Add KConfig files to build
- `Zephyr IDE: Remove Build KConfig Files` - Remove KConfig files from build
- `Zephyr IDE: Add Build Overlay Files` - Add overlay files to build
- `Zephyr IDE: Remove Build Overlay Files` - Remove overlay files from build
- `Zephyr IDE: Modify Build Arguments` - Modify build arguments

## Runner Management

- `Zephyr IDE: Add Runner` - Add runner to build configuration
- `Zephyr IDE: Remove Runner` - Remove runner from build configuration
- `Zephyr IDE: Set Active Runner` - Set active runner

## Build and Flash Operations

- `Zephyr IDE: Build Pristine` - Build with pristine flag (clean build)
- `Zephyr IDE: Build` - Build active project
- `Zephyr IDE: Clean` - Clean build artifacts
- `Zephyr IDE: Flash` - Flash build to target device

## Debug Operations

- `Zephyr IDE: Debug` - Start debugging session
- `Zephyr IDE: Debug Attach` - Attach debugger to running target
- `Zephyr IDE: Build and Debug` - Build and start debugging
- `Zephyr IDE: Change Debug Launch Configuration For Build` - Change debug launch configuration
- `Zephyr IDE: Change Build and Debug Launch Configuration For Build` - Change build and debug launch configuration
- `Zephyr IDE: Change Debug Attach Launch Configuration For Build` - Change debug attach launch configuration

## Configuration and Analysis Tools

- `Zephyr IDE: Start Menu Config` - Start Kconfig menu configuration
- `Zephyr IDE: Start GUI Config` - Start Kconfig GUI configuration
- `Zephyr IDE: Run ROM Report` - Generate ROM usage report
- `Zephyr IDE: Run RAM Report` - Generate RAM usage report
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
