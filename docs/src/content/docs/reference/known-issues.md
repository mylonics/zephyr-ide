---
title: Troubleshooting & Known Issues
description: Common IDE for Zephyr setup, SDK, workspace, and debug issues — plus workarounds for WSL/devcontainer path problems and guidance on when to reset, deactivate, or unregister a workspace.
---

Use this page when the extension is installed but a workspace is not building, debugging, or registering the way you expect.

## No Active Workspace / Setup Warning Appears

If IDE for Zephyr starts without an active managed workspace and without `ZEPHYR_BASE`, it shows a warning and some actions may stay unavailable.

### What to do

Choose the path that matches your setup:

- Run **`Zephyr IDE: Workspace Setup`** or open **`Zephyr IDE: Overview`** if you want the extension to manage your workspace.
- Run **`Zephyr IDE: Setup Workspace from Current Directory`** or **`Zephyr IDE: Setup Workspace from External Directory`** if the workspace already exists.
- Set `ZEPHYR_BASE` before launching VS Code if you want to use an external Zephyr environment. See [External Environments](../getting-started/external-environments.md).
- If you intentionally work without either flow, set `zephyr-ide.suppressWorkspaceWarning` to `true`.

## Host Tools Missing or Build Dependencies Not Found

Typical symptoms:

- build commands fail before CMake or Ninja starts
- the Setup Panel reports missing Python, CMake, DTC, Ninja, or compiler tools
- the extension cannot create the workspace virtual environment

### What to do

1. Run **`Zephyr IDE: Check Build Dependencies`** to re-scan your PATH.
2. Open **`Zephyr IDE: Host Tools`** and install any missing tools on supported platforms.
3. If your platform is not supported for automatic installation, follow the [Host Tools Installation](../getting-started/host-tools.md) guide and reopen VS Code.

## SDK or Toolchain Not Available

Typical symptoms:

- west setup completes, but builds fail because no SDK/toolchain is found
- a shared workspace expects architectures that are not installed locally

### What to do

1. Open **`Zephyr IDE: SDK Management`**.
2. If your project declares required toolchains in `.vscode/zephyr-ide.json`, run **`Zephyr IDE: Install Toolchains from zephyr-ide.json`**.
3. If the toolchain list is wrong or incomplete, adjust it with **`Zephyr IDE: Modify zephyr-ide.json Toolchains`**.
4. If your workspace depends on extra Python packages, blobs, or requirements files, open **`Zephyr IDE: Zephyr IDE Manager`** and install the missing items there.

## Debug Session Fails Immediately

Typical symptoms:

- clicking **Debug** opens a notification instead of starting a session
- the debug adapter launches, but the target runner is wrong
- an attach/debug action works for one probe but not another

### What to do

1. Make sure [`marus25.cortex-debug`](https://marketplace.visualstudio.com/items?itemName=marus25.cortex-debug) is installed.
2. If you use Black Magic Probe, consider installing [`mylonics.bmp-debug`](https://marketplace.visualstudio.com/items?itemName=mylonics.bmp-debug) for Zephyr thread awareness.
3. Run **`Zephyr IDE: Open runners.yaml for Active Build`** to inspect the actual runner information produced by west.
4. If the board defaults are fine but your local probe is different, use **`Zephyr IDE: Select Active Runner Profile (Local)`** or **`Zephyr IDE: Set Local Slot Runner Bind`**.
5. If the build is a sysbuild build, use **`Zephyr IDE: Set Active Sysbuild Image`** to pick the correct image/domain before flashing or debugging.

## Workspace Registration Feels Stuck or Out of Sync

Use the recovery command that matches the problem:

| Command | When to use it |
|---|---|
| **`Zephyr IDE: Deactivate Workspace`** | Stop using the current workspace for this VS Code window, but keep it registered for later. |
| **`Zephyr IDE: Unregister Workspace`** | Remove a workspace from the extension's registry entirely. |
| **`Zephyr IDE: Re-run West Setup`** | Re-run workspace initialization/update after a partial clone, manifest change, or failed setup step. |
| **`Zephyr IDE: Reset Workspace`** | Clear workspace setup state and start the managed setup flow from scratch. |
| **`Zephyr IDE: Reset Active Installation`** | Clear the currently selected Zephyr installation when switching between managed and external environments. |
| **`Zephyr IDE: Skip West Setup`** | Mark the workspace as ready when west has already been prepared outside the extension. |

## Dev Containers with WSL and Windows Folders

When using dev containers in WSL, keep your workspace inside the Linux filesystem (for example `/home/username/project`) rather than inside mounted Windows paths such as `/mnt/c/Users/...`.

This is a limitation of the `west boards` flow and affects workspace initialization and board detection.

### Workaround

Move the workspace to a Linux-native path:

```bash
# Instead of /mnt/c/Users/yourname/projects
# Use /home/yourname/projects
```

## Reporting Issues

If the problem is still unresolved:

1. Check [GitHub Issues](https://github.com/mylonics/zephyr-ide/issues) for an existing report.
2. Include:
   - steps to reproduce
   - expected behavior
   - actual behavior
   - VS Code version
   - IDE for Zephyr version
   - operating system
   - whether the workspace is managed by the extension or provided via `ZEPHYR_BASE`

## Next Steps

- [Report an issue on GitHub](https://github.com/mylonics/zephyr-ide/issues)
- [Join discussions](https://github.com/mylonics/zephyr-ide/discussions)
- [See all commands](commands.md)
