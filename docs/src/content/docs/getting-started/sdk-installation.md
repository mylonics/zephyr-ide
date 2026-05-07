---
title: Zephyr SDK Installation
description: Install and manage the Zephyr SDK for ARM Cortex-M, RISC-V, x86, and Xtensa architectures using west SDK commands. Multi-version support with IDE for Zephyr in VS Code.
---

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

## Declaring Required Toolchains in `zephyr-ide.json`

To make a project reproducible across machines and contributors, you can
declare the toolchains your workspace requires directly in
`.vscode/zephyr-ide.json`:

```json
{
  "toolchains": ["arm-zephyr-eabi", "riscv64-zephyr-elf"],
  "sdkVersion": "0.17.0",
  "projects": { ... }
}
```

`sdkVersion` is optional. When the workspace setup flow needs to install a
Zephyr SDK to satisfy the declared toolchains, it picks the version to install
in this priority order:

1. The `sdkVersion` declared in `zephyr-ide.json`.
2. The version recorded in the Zephyr source tree's `SDK_VERSION` file.
3. The latest released SDK if neither of the above is available.

The SDK panel always exposes two buttons for managing the workspace's
declared toolchain list:

- **Install from zephyr-ide.json** — install every declared toolchain that
  isn't already available locally.
- **Modify zephyr-ide.json** — open a quick-pick that lets you check or
  uncheck toolchains. Toolchains already installed locally are listed first;
  items currently declared in `zephyr-ide.json` are pre-checked. Saving with
  no items selected clears the `toolchains` field.

When the `toolchains` list is non-empty, the workspace setup flow installs
any missing toolchains automatically once the Zephyr SDK is in place.

The same operations are available from the command palette:

- `Zephyr IDE: Modify zephyr-ide.json Toolchains`
- `Zephyr IDE: Install Toolchains from zephyr-ide.json`

## Declaring Required Blobs in `zephyr-ide.json`

Some Zephyr modules ship binary blobs (e.g. wireless firmware) that must be
fetched separately with `west blobs fetch`. Modules whose blobs your workspace
requires can be listed under the `blobs` key:

```json
{
  "blobs": ["hal_nordic", "hal_st"],
  "toolchains": ["arm-zephyr-eabi"]
}
```

When the workspace is set up the extension runs `west blobs fetch <module>` for
each declared module. You can also manage blobs interactively via:

- `Zephyr IDE: Modify zephyr-ide.json Blobs` — opens a quick-pick listing
  modules that declare blobs (discovered via `west blobs list`); already
  declared modules are pre-checked.
- `Zephyr IDE: Install Blobs from zephyr-ide.json` — fetches any blobs declared
  in `zephyr-ide.json`.

## Next Steps

After installing the SDK, you're ready to:

- [Set up your first project](../user-guide/project-setup.md)
- [Start building and debugging](../user-guide/building-debugging.md)
