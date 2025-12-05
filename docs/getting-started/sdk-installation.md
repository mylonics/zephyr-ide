---
title: Install Zephyr SDK - Cross-Compilation Toolchains for Embedded Development
description: Install and manage Zephyr SDK with support for ARM, x86, RISC-V architectures. West SDK integration for easy version management and multi-architecture support.
keywords: Zephyr SDK, cross-compilation, ARM toolchain, RISC-V toolchain, x86 toolchain, SDK installation, west SDK, embedded toolchains
---

# Zephyr SDK Installation

![SDK Management](https://raw.githubusercontent.com/mylonics/zephyr-ide/main/docs/media/sdk_management.png)

Click the Zephyr SDK Management card to access SDK installation. The SDK provides cross-compilation toolchains for various architectures (ARM, x86, RISC-V, etc.).

## SDK Management

The extension uses West's SDK integration for version management:

- Select which SDK versions to install
- Install multiple SDKs for different architectures
- Manage SDK updates through the extension

## Installation

For new users:

1. Click the **Zephyr SDK Management** card
2. Select the latest SDK version
3. Choose architectures to install (or select all for convenience)
4. Click **Install SDK**

You can add specific architectures later if storage is a concern.

## Important Notes

- SDK installation is a one-time process per computer
- SDKs can be shared across multiple projects
- SDK installation uses the west SDK command
- A west workspace must be configured before SDK management can occur

## Next Steps

After installing the SDK, you're ready to:

- [Set up your first project](../user-guide/project-setup.md)
- [Start building and debugging](../user-guide/building-debugging.md)
