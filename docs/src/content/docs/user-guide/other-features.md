---
title: Build Dashboard, Memory Analysis & Advanced Tools
description: Explore ROM and RAM usage, browse Kconfig symbols, and inspect the compiled devicetree in the IDE for Zephyr Build Dashboard. Also covers custom west and CMake build arguments, the DTSh devicetree shell, and the integrated west terminal.
---

## Build Dashboard

The Build Dashboard (`Zephyr IDE: Open Build Dashboard`) is the central analysis panel for a build. It provides:

- **Memory analysis** — ROM and RAM usage with section-level breakdown and symbol tables
- **Kconfig editor** — browse, search, and inspect all Kconfig symbols and their current values
- **Devicetree viewer** — explore the compiled devicetree nodes and properties
- **ELF stats** — binary size information from the linked ELF

After each build, run `Zephyr IDE: Zephyr Dashboard Report` to refresh the dashboard data for the active build. The Kconfig button in the Active Project view opens the dashboard directly by default (`zephyr-ide.activeViewKconfigButton`).

**Build Summary** — key build attributes (Zephyr version, board, toolchain, `west build` command), a Memory Summary table, and a colour-coded Memory Breakdown bar chart:

![Build Dashboard — Build Summary](https://raw.githubusercontent.com/mylonics/zephyr-ide/develop/docs/media/build_summary.png)

**Memory Report** — interactive sunburst chart that drills down into RAM and ROM usage by source-tree path. Switch between Total, RAM, ROM, and region-specific tabs; hover or click any segment to inspect the symbol hierarchy and exact byte counts:

![Build Dashboard — Memory Report](https://raw.githubusercontent.com/mylonics/zephyr-ide/develop/docs/media/memory_report.png)

**Kconfig** — interactive browser for the build's resolved Kconfig tree. Filter by symbol name, toggle between Tree and Changes modes, and click any symbol to see its type, value, help text, and defining file. Use **Save fragment** to export a `.conf` snippet of your changes:

![Build Dashboard — Kconfig](https://raw.githubusercontent.com/mylonics/zephyr-ide/develop/docs/media/kconfig_editor.png)

### ROM / RAM Reports

Stand-alone text reports generated in the terminal:

- `Zephyr IDE: Zephyr ROM Report`
- `Zephyr IDE: Zephyr RAM Report`

### DTSh Shell

- `Zephyr IDE: Start DTSh Shell` — interactive devicetree shell for querying nodes, bindings, and properties

## Build Customization

The IDE allows modifying the west and cmake arguments per build. It allows the user to provide runner arguments, and specify DTS overlay and KConfig files per project or build.

![Demonstrating KConfig](https://raw.githubusercontent.com/mylonics/zephyr-ide/develop/docs/media/kConfig_dtc.gif)

### Menu Config and GUI Config

The Zephyr Menu Config or GUI Config may be run from the active project panel. In the project config panel, by default, a Menu Config option is available. This can be changed to GUI Config by adding `"zephyr-ide.useGuiConfig": true` to settings.json.

![Demonstrating MenuConfig](https://raw.githubusercontent.com/mylonics/zephyr-ide/develop/docs/media/demonstrating_menu_config_debug_binding.gif)

## Automatic Project Targeting

When you open a file, the extension can automatically switch the active project to the one that owns the file. This is enabled by default and controlled with the `zephyr-ide.automaticProjectSelection` setting, or via:

- `Zephyr IDE: Enable Automatic Active Project Targeting`
- `Zephyr IDE: Disable Automatic Active Project Targeting`

## West Terminal

Custom west commands may be run using the inbuilt Zephyr IDE Terminal.

![West Terminal](https://raw.githubusercontent.com/mylonics/zephyr-ide/develop/docs/media/west_terminal.gif)

## Next Steps

- [Learn about the Extension Pack](../reference/extension-pack.md)
- [See all available commands](../reference/commands.md)
- [Configure extension settings](../reference/configuration.md)
