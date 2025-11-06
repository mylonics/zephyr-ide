# Zephyr IDE Setup & Configuration

Welcome to the Zephyr IDE Setup & Configuration walkthrough! This guide will help you set up your development environment step by step.

## Overview

Zephyr IDE requires three main components to be configured:
1. **Host Tools** - Development tools and package manager
2. **Zephyr SDK** - Cross-compilation toolchains
3. **Workspace** - Project organization and dependencies

## Step 1: Install Host Tools

Host development tools (CMake, Ninja, Python, Git, etc.) are required for building Zephyr applications.

### What's Included
- CMake - Build system generator
- Ninja - Build tool for fast compilation
- Python 3.8+ - Scripting and build dependencies
- Git - Version control system
- DTC - Device Tree Compiler
- GPerf - Perfect hash function generator

[Open Host Tools Setup](command:zephyr-ide.open-setup-panel-hosttools)

## Step 2: Install Zephyr SDK

The Zephyr SDK contains cross-compilation toolchains for multiple architectures including ARM, x86, RISC-V, and more.

### Important Note
SDK installation uses the `west sdk` command. A west installation is required before installing the SDK.

[Open SDK Management](command:zephyr-ide.open-setup-panel-sdk)

## Step 3: Configure Workspace

Set up your Zephyr workspace to organize projects and manage development dependencies.

### Workspace Options
- Import Zephyr IDE Workspace from Git
- Import West Workspace from Git
- Create New Standard Workspace
- Initialize Current Directory

[Open Workspace Setup](command:zephyr-ide.open-setup-panel-workspace)

## Next Steps

Once all three components are configured, you'll be ready to:
- Create new Zephyr projects
- Build and debug applications
- Flash firmware to devices
- Run tests with Twister

[Open Full Setup Panel](command:zephyr-ide.open-setup-panel)
