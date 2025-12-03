# Zephyr IDE for VS Code

<img src="https://raw.githubusercontent.com/mylonics/zephyr-ide/main/docs/media/zephyr-ide_branding.png" alt="Zephyr IDE for Visual Studio Code" width="50%"/>

The Zephyr IDE for VS Code extension provides tools to assist in your Zephyr project development workflow. This extension helps you build Zephyr projects and share them with your team.

An [extension pack](https://marketplace.visualstudio.com/items?itemName=mylonics.zephyr-ide-extension-pack) is available that bundles in additional tools.

You can read a little bit more about the motivation behind the project [here](https://mylonics.com/blog/zephyr-ide-for-vscode/).

## Features
  - Installs host tools required for Zephyr development
  - Sets up west environment
  - Installs Zephyr SDK using West SDK commands
  - Provides west.yml templates or use your own
  - Able to use externally managed environments via `ZEPHYR_BASE` environment variable
  - Add projects from scratch or from templates
  - Multiple projects per workspace
  - Multiple builds per project
  - Per project KConfig and overlay files
  - Per build board, KConfig, overlay files, and runner configuration
  - Bind builds to launch/debug configurations
  - Project tree GUI panel and active project panel
  - Automatic active project selection based on active file in editor
  - All GUI commands available in command palette
  - Functions to set up custom launch/debug configurations
  - West terminal for manual west commands
  - Saves/loads project structure to workspace in human readable and editable file
  - Cross-platform support for all Zephyr-supported platforms
  - Twister testing support

## Externally Managed Environments

Zephyr IDE automatically detects and works with externally managed Zephyr environments:

- Automatic detection via `ZEPHYR_BASE` environment variable
- No setup required when using Docker, DevContainers, or pre-configured environments
- Feature support including build, flash, and debug operations
- Configurable warning: Option to suppress environment variable warnings via `zephyr-ide.suppress-workspace-warning` setting

Suitable for:
- Docker/container workflows
- CI/CD pipelines
- Shared development environments
- Pre-installed Zephyr setups

See the externally managed environments section in the [User Manual](docs/MANUAL.md#using-externally-managed-environments) for detailed information.


## Getting Started
The [User Manual](docs/MANUAL.md) is available to help get started along with a couple Youtube tutorials.

[![Getting Started with Zephyr IDE](https://mylonics.com/assets/images/zephyr-ide/getting_started_thumbnail.png)](https://www.youtube.com/watch?v=Asfolnh9kqM&t "Getting Started with Zephyr IDE")

[![STM32 Board Setup And Debugging with Zephyr IDE](https://mylonics.com/assets/images/zephyr-ide/board_setup_thumbnail.png)](https://www.youtube.com/watch?v=TXcTzyswBMQ)

You can have a look at this [sample directory](https://github.com/mylonics/zephyr-ide-sample-project) to also help with getting started and sharing project. 
## Requirements

This extension can automatically install host tools required for Zephyr development on supported platforms. The automated installation follows the methods described in the Zephyr Getting Started Guide and installs tools such as cmake, python3, devicetree compiler, and other build dependencies.

For manual installation or unsupported platforms, see the [Install Dependencies Section of the Zephyr Getting Started Guide](https://docs.zephyrproject.org/latest/develop/getting_started/index.html#install-dependencies)


## Testing

This extension includes integration tests that validate the complete Zephyr IDE workflow. For more details, see [docs/TESTING.md](docs/TESTING.md).

## Known Issues
- **Dev containers with WSL and Windows folders**: When using dev containers in a WSL environment, ensure your workspace folder is located within the Ubuntu file system (e.g., `/home/username/project`) rather than in mounted Windows directories (e.g., `/mnt/c/Users/...`). This is an issue inherent with the west boards command.

## Release Notes
See [CHANGELOG](CHANGELOG.md) for release notes

## Development and Debugging

See the [Zephyr IDE for VS Code Developer's Guide](docs/developer-guide.md) for development and debugging instructions.

---
