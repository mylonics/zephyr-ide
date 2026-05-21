---
title: Advanced Features
description: Use the Build Dashboard (memory, Kconfig, devicetree), MenuConfig, GuiConfig, custom west/CMake build arguments, DTSh devicetree shell, and the integrated West Terminal in IDE for Zephyr.
---

## Menu Config and GUI Config

The Zephyr Menu Config or GUI Config may be run from the active project panel. In the project config panel, by default, a Menu Config option is available. This can be changed to GUI Config by adding `"zephyr-ide.useGuiConfig": true` to settings.json.

![Demonstrating MenuConfig](https://raw.githubusercontent.com/mylonics/zephyr-ide/main/docs/media/demonstrating_menu_config_debug_binding.gif)

## Build Customization

The IDE allows modifying the west and cmake arguments per build. It allows the user to provide runner arguments, and specify DTS overlay and KConfig files per project or build.

![Demonstrating KConfig](https://raw.githubusercontent.com/mylonics/zephyr-ide/main/docs/media/kConfig_dtc.gif)

## Automatic Project Targeting

When you open a file, the extension can automatically switch the active project to the one that owns the file. This is enabled by default and controlled with the `zephyr-ide.automaticProjectSelection` setting, or via:

- `Zephyr IDE: Enable Automatic Active Project Targeting`
- `Zephyr IDE: Disable Automatic Active Project Targeting`

## West Terminal

Custom west commands may be run using the inbuilt Zephyr IDE Terminal.

![West Terminal](https://raw.githubusercontent.com/mylonics/zephyr-ide/main/docs/media/west_terminal.gif)

## Analysis Tools

### Build Dashboard

The Build Dashboard (`Zephyr IDE: Open Build Dashboard`) is the primary analysis tool. It provides an interactive panel with:

- **Memory analysis** — ROM and RAM usage with section-level breakdown and symbol tables
- **Kconfig viewer** — browse and search all Kconfig symbols and their current values
- **Devicetree viewer** — explore the compiled devicetree nodes and properties
- **ELF stats** — binary size information from the linked ELF

After each build, run `Zephyr IDE: Zephyr Dashboard Report` to refresh the dashboard data for the active build. The Kconfig button in the Active Project view opens the dashboard directly by default (`zephyr-ide.activeViewKconfigButton`).

> **Screenshot opportunity**: Build Dashboard — memory, Kconfig, and devicetree panels

### ROM / RAM Reports

Stand-alone text reports generated in the terminal:

- `Zephyr IDE: Run ROM Report`
- `Zephyr IDE: Run RAM Report`

### DTSh Shell

- `Zephyr IDE: Start DTSh Shell` — interactive devicetree shell for querying nodes, bindings, and properties

## Next Steps

- [Learn about the Extension Pack](../reference/extension-pack.md)
- [See all available commands](../reference/commands.md)
- [Configure extension settings](../reference/configuration.md)
