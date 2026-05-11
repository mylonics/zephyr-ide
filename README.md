# IDE for Zephyr

<img src="https://raw.githubusercontent.com/mylonics/zephyr-ide/main/docs/media/zephyr-ide_branding.png" alt="Zephyr IDE — VS Code extension for Zephyr RTOS" width="50%"/>

A Visual Studio Code extension for [Zephyr RTOS](https://zephyrproject.org/) development. Set up host tools and the Zephyr SDK, manage west workspaces, and build, flash, and debug projects from one window.

*Formerly known as Zephyr IDE.*

Install from the [Visual Studio Code Marketplace](https://marketplace.visualstudio.com/items?itemName=mylonics.zephyr-ide) or the [Open VSX Registry](https://open-vsx.org/extension/mylonics/zephyr-ide).

Works either as your full setup or alongside an existing Zephyr install (Docker, devcontainer, manual `west` setup) via `ZEPHYR_BASE` detection. An [extension pack](https://marketplace.visualstudio.com/items?itemName=mylonics.zephyr-ide-extension-pack) bundles Cortex-Debug, C/C++, Serial Monitor, Devicetree LSP, and CMake support.

You can read about the motivation behind the project [here](https://mylonics.com/blog/zephyr-ide/).

![Overview](https://raw.githubusercontent.com/mylonics/zephyr-ide/main/docs/media/overview.png)

## Why IDE for Zephyr

- **Automated host tool install** — follows the [Zephyr Getting Started Guide](https://docs.zephyrproject.org/latest/develop/getting_started/index.html#install-dependencies) on Ubuntu, macOS, and Windows. Skip it if you already have the tools installed.
- **Automated SDK install** — drives `west sdk` to install and manage SDK versions and toolchains.
- **Full Cortex-Debug integration** — built-in launch templates for ST-Link, J-Link, OpenOCD, and Black Magic Probe, plus helper commands that resolve project, build, ELF, GDB, and toolchain paths from your active build.
- **Multiple Zephyr workspaces** — register several west workspaces and switch between them seamlessly without reopening VS Code.
- **Team-shareable projects** — projects, builds, runners, KConfig, devicetree overlays, and per-build west/CMake args live in a human-readable `zephyr-ide.json` you can commit.
- **Guided project + build creation** — add an existing app or copy from a Zephyr sample, then add as many builds and runners per project as you need.
- **Twister test integration** — add, run, and reconfigure Twister tests from the same UI as builds.
- **Cross-platform** — Linux, macOS, and Windows.

## Features

### Workspace setup & SDK management

- Installs host tools (CMake, Python 3, Ninja, DTC, gcc) on supported platforms
- Sets up west via built-in `west.yml` templates or your own manifest
- Clones existing west or IDE for Zephyr workspaces from Git
- Adopts existing `.west` folders or external Zephyr installations via `ZEPHYR_BASE`
- Installs and manages Zephyr SDK versions and per-architecture toolchains through `west sdk`
- Register and switch between multiple west workspaces from one VS Code window

### Projects & builds

- Add existing applications or create new ones from Zephyr samples
- Multiple projects per workspace, multiple builds per project, multiple runners per build
- Per-project and per-build KConfig and devicetree overlay files
- Per-build board selection, runner arguments, and west / CMake argument overrides
- Custom project / build variables surfaced through launch configurations
- Configuration stored in human-readable `zephyr-ide.json` for version control

### Build, flash & debug

- Build, build pristine, clean, and flash from the status bar or project panel
- Concurrent builds with per-target locking
- Built-in `zephyr-ide` debugger that auto-translates `runners.yaml` into a Cortex-Debug session — no per-runner launch.json required
- Per-build Runner Configurations bind Flash / Build & Debug / Debug / Attach to a Zephyr runner, a reusable variant, or a `launch.json` entry — with auto-fallback to `runners.yaml` defaults
- Reusable runner variants defined in `settings.json` or `.vscode/zephyr-ide.json` for sharing across builds and teams
- Cortex-Debug launch templates for ST-Link, J-Link, OpenOCD, and Black Magic Probe
- Launch helper commands that resolve project, build, ELF, GDB, toolchain, and board paths
- Debug Select configuration for picking which build to debug at launch time
- Multi-root and `.code-workspace` aware debug session resolution

### Productivity

- Native VS Code tree view for projects, builds, runners, and tests
- Active project status bar control with automatic targeting based on the open file
- MenuConfig and GuiConfig editors
- ROM and RAM usage reports
- DTSh devicetree shell
- Integrated west terminal for ad-hoc commands
- Twister test panel for adding, running, and reconfiguring tests

## Getting Started

The full documentation is available at [zephyr-ide.mylonics.com](https://zephyr-ide.mylonics.com/).

### Video tutorials

[![Getting Started with IDE for Zephyr](https://mylonics.com/assets/images/zephyr-ide/getting_started_thumbnail.png)](https://www.youtube.com/watch?v=Asfolnh9kqM&t)

[![STM32 Board Setup and Debugging](https://mylonics.com/assets/images/zephyr-ide/board_setup_thumbnail.png)](https://www.youtube.com/watch?v=TXcTzyswBMQ)

A reference [sample project](https://github.com/mylonics/zephyr-ide-sample-project) is also available.

## Requirements

The extension can install host tools (CMake, Python 3, Ninja, Devicetree Compiler, gcc) automatically on Ubuntu/Debian, macOS, and Windows. On other platforms, install them via your package manager — see the [host tools documentation](https://zephyr-ide.mylonics.com/getting-started/host-tools/) and consider opening an issue or PR to have the IDE do it automatically for you in the future.

If Zephyr is already installed on your machine, set `ZEPHYR_BASE` and the extension will use it directly. See [External Environments](https://zephyr-ide.mylonics.com/getting-started/external-environments/).

## Known Issues

- **Dev containers in WSL with Windows folders**: keep your workspace inside the Linux file system (e.g. `/home/user/project`) rather than `/mnt/c/...`. This is a `west boards` limitation.

## Release Notes

See [CHANGELOG.md](CHANGELOG.md) for the full release history. Highlights for the 3.0 series are summarized in [What's New in 3.0](https://zephyr-ide.mylonics.com/whats-new-3-0/).

## Development

See the [Developer Guide](https://zephyr-ide.mylonics.com/developer-guide/) for instructions on building, debugging, and contributing.
