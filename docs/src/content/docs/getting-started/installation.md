---
title: Installation
description: Install IDE for Zephyr in VS Code and choose the right onboarding path for a new workspace, an existing west checkout, Docker/devcontainer workflows, or a pre-installed Zephyr environment.
---

Install IDE for Zephyr from the [Visual Studio Code Marketplace](https://marketplace.visualstudio.com/items?itemName=mylonics.zephyr-ide) or the [Open VSX Registry](https://open-vsx.org/extension/mylonics/zephyr-ide).

If you want the recommended companion tools in one step, also install the [IDE for Zephyr Extension Pack](https://marketplace.visualstudio.com/items?itemName=mylonics.zephyr-ide-extension-pack), which bundles Cortex-Debug, C/C++, Serial Monitor, Devicetree LSP, and CMake support.

## What You Need

- **VS Code** or a compatible Open VSX-based editor
- **Git** for normal west-based workflows
- **Host build tools** such as CMake, Python 3, Ninja, DTC, and a compiler toolchain

IDE for Zephyr can install host tools automatically on:

- **Ubuntu/Debian**
- **Fedora/RHEL/CentOS** and derivatives
- **Arch Linux** and derivatives
- **Clear Linux**
- **macOS**
- **Windows**

On other platforms, install the dependencies manually and then continue with the workspace setup flow.

## Choose Your Onboarding Path

### I am new to Zephyr and want the extension to set everything up

1. Install the extension.
2. Open the **IDE for Zephyr** view container.
3. Run **`Zephyr IDE: Workspace Setup`** or open **`Zephyr IDE: Overview`**.
4. Follow the Setup Panel to install host tools, create a workspace, and install the SDK.

### I already have a west workspace or repository checkout

Use one of these commands:

- **`Zephyr IDE: Setup Workspace from Current Directory`** for the folder already open in VS Code
- **`Zephyr IDE: Setup Workspace from External Directory`** for a workspace located elsewhere on disk
- **`Zephyr IDE: Setup West Workspace from Git`** to clone and register an existing west repository directly

### I already use Docker, devcontainers, NCS, or a manually managed Zephyr install

Set `ZEPHYR_BASE` before starting VS Code and IDE for Zephyr will use that environment directly. See [External Environments](external-environments.md).

## Recommended First Steps

1. [Open the Setup Panel](setup-panel.md)
2. [Install Host Tools](host-tools.md)
3. [Configure a Workspace](workspace-configuration.md)
4. [Install the Zephyr SDK](sdk-installation.md)

## Video Tutorial

[![Getting Started with IDE for Zephyr](https://mylonics.com/assets/images/zephyr-ide/getting_started_thumbnail.png)](https://www.youtube.com/watch?v=Asfolnh9kqM&t "Getting Started with IDE for Zephyr")
