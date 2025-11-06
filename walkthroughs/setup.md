# Zephyr IDE Setup & Configuration

Welcome to Zephyr IDE! Follow these steps to set up your development environment.

## What You'll Configure

Zephyr IDE requires three main components:
1. **Host Tools** - Development tools (CMake, Ninja, Python, Git, etc.)
2. **Zephyr SDK** - Cross-compilation toolchains for ARM, x86, RISC-V, and more
3. **Workspace** - Project organization and dependencies

---

## Step 1: Install Host Tools

Development tools are required for building Zephyr applications.

Click the button below to open the interactive Host Tools setup:

[**Open Host Tools Setup →**](command:zephyr-ide.open-setup-panel-hosttools)

The Host Tools page will help you:
- Check which tools are already installed
- Install missing packages automatically
- Verify your development environment is ready

---

## Step 2: Install Zephyr SDK

The SDK provides cross-compilation toolchains for multiple architectures.

Click the button below to open the interactive SDK management:

[**Open SDK Management →**](command:zephyr-ide.open-setup-panel-sdk)

**Important:** SDK installation uses the `west sdk` command, so west must be installed first.

The SDK page will help you:
- Install the latest Zephyr SDK
- List all available SDK versions
- Manage multiple SDK installations

---

## Step 3: Configure Workspace

Set up your Zephyr workspace for project development.

Click the button below to open the interactive Workspace setup:

[**Open Workspace Setup →**](command:zephyr-ide.open-setup-panel-workspace)

Available workspace options:
- Import Zephyr IDE Workspace from Git
- Import West Workspace from Git
- Create New Standard Workspace
- Initialize Current Directory

---

## You're All Set!

Once configured, you can:
- ✓ Create new Zephyr projects
- ✓ Build and debug applications
- ✓ Flash firmware to devices
- ✓ Run tests with Twister

[**Open Full Setup Panel**](command:zephyr-ide.open-setup-panel) to view all configuration options.
