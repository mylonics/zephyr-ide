---
title: What's New in 3.0
description: Highlights of the IDE for Zephyr 3.0 release — refreshed project and settings panels, improved workspace handling, and across-the-board UI performance improvements.
---

The 3.0 series of IDE for Zephyr focuses on UI clarity, workspace ergonomics, and the day-to-day feel of working with multiple projects and builds.

## Refreshed project and settings panels

The project build view and the settings panel have been rebuilt on top of [vscode-elements](https://vscode-elements.github.io/) v2 web components and a shared design system aligned with VS Code walkthroughs.

- A new project & build settings page with inline editing for west args, CMake args, KConfig overlays, and devicetree overlays.
- Per-build args are stored as string arrays (with automatic migration from legacy strings) so they round-trip cleanly through git and can be edited one entry at a time.
- Project-level and build-level custom variables can be added, renamed, and edited inline, with configurable defaults via the `zephyr-ide.projectVariableDefaults` and `zephyr-ide.buildVariableDefaults` settings.

## Improved workspace handling

- **Multiple west workspaces** — register several west workspaces and switch between them from the workspace panel without reopening VS Code.
- **Native VS Code tree view** for the project explorer, replacing the previous webview tree for better integration with VS Code's keyboard, drag-and-drop, and theming.
- **Multi-root debug** — debug launches now resolve the correct workspace folder when working in `.code-workspace` setups.
- **Workspace progress page** that surfaces what the extension is doing during long-running setup and update operations.

## General UI performance

- A unified webview design language with shared CSS primitives across every panel — fewer custom styles, faster load, and a consistent look.
- Webview initialization race conditions on startup have been eliminated.
- The setup panel now uses a card-based interaction model that is consistent across host tools, SDK, and workspace flows.

## Other notable changes

- Setting keys have moved to camelCase (`zephyr-ide.toolchainDirectory`, `zephyr-ide.useGuiConfig`, `zephyr-ide.venvFolder`, …) with automatic migration from the older snake_case / kebab-case names.
- Launch configuration helpers gained `zephyr-ide.get-zephyr-elf`, `zephyr-ide.get-zephyr-elf-dir`, `zephyr-ide.get-arm-gdb-path`, and `zephyr-ide.get-active-board-name`.
- The extension was renamed from **Zephyr IDE** to **IDE for Zephyr**. The marketplace identifier (`mylonics.zephyr-ide`) and all `zephyr-ide.*` commands and settings remain unchanged.

For the full per-PR list of changes, see the [CHANGELOG](https://github.com/mylonics/zephyr-ide/blob/main/CHANGELOG.md).

## Upgrading from v2.4

v3.0 is designed to be a clean in-place upgrade — existing workspaces, projects, and settings continue to work. A few things to be aware of:

- **`.vscode/zephyr-ide.json` is rewritten on first open.** The project file format has been updated (config-file entries are now objects instead of plain strings, and build args are stored as arrays). The extension migrates the file automatically on first activation. If you may need to roll back to v2.4, commit or back up `.vscode/zephyr-ide.json` before upgrading.

- **"Global Install" no longer appears as a special entry.** The dedicated "Global Zephyr installation" option has been removed. Any workspace that was previously registered as the global install is now shown as a normal entry in the multi-workspace list (using its folder name). No action is needed — the workspace continues to work as before.

- **Windows users should re-run Host Tools after upgrading.** 7-Zip is no longer bundled with the extension; it is now installed via `winget` through the Host Tools panel. If your existing install was relying on the previously bundled copy, open **Host Tools** and install the 7-Zip package to restore extraction support.

- **The first build of each project after upgrading may be a full (pristine) rebuild.** v3.0 introduces cache-invalidation logic that detects when CMake-affecting inputs (board, conf files, overlay files, CMake args) have changed since the last successful build and automatically forces `--pristine` in that case. On first launch the cache is empty, so each project will rebuild from scratch once, then incremental builds resume as normal.

