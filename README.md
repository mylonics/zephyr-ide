#  Zephyr IDE for VS Code

<img src="https://raw.githubusercontent.com/mylonics/zephyr-ide/main/docs/media/zephyr-ide_branding.png" alt="Zephyr IDE for Visual Studio Code" width="50%"/>

The Zephyr IDE for VS code extension provides tools to aide in your Zephyr Project work flow. This extension helps you to build Zephyr projects and share them with your team.

Please check out our new [extension pack](https://marketplace.visualstudio.com/items?itemName=mylonics.zephyr-ide-extension-pack) that bundles in additional tools.

You can read a little bit more about the motivation behind the project [here](https://mylonics.com/blog/zephyr-ide-for-vscode/).

## Features
  - Sets up a west environment
  - Downloads the Zephyr SDK
  - Provides west.yml templates to start with or you can provide your own
  - Allows you to add projects from scratch or from templates
  - Create multiple projects
  - For each project, you can create multiple builds
  - Each project may have its own kconfig files and overlay files
  - Each build may have a unique board, kconfig files, and overlay files and runner
  - Each build may be bound to a launch/debug configuration for debug, build and debug and attach.
  - GUI Panels to show the full project tree and active projects
  - Automatically changing active project based on the last viewed file in the editor
  - All commands that are available in the GUI are available in the command palette.
  - Provides useful functions to set up custom launch/debug configurations
  - Provides the user with a terminal to manually run west commands
  - Saves/loads project structure to workspace in a human readable and editable file


## Getting Started
There is a [manual](docs/MANUAL.md) available to help get started along with a couple Youtube tutorials.

[![Getting Started with Zephyr IDE](https://mylonics.com/assets/images/zephyr-ide/getting_started_thumbnail.png)](https://www.youtube.com/watch?v=Asfolnh9kqM&t "Getting Started with Zephyr IDE")

[![STM32 Board Setup And Debugging with Zephyr IDE](https://mylonics.com/assets/images/zephyr-ide/board_setup_thumbnail.png)](https://www.youtube.com/watch?v=TXcTzyswBMQ)

You can have a look at this [sample directory](https://github.com/mylonics/zephyr-ide-sample-project) to also help with getting started and sharing project. 
## Requirements

In order for this application to work correctly the zephyr require build tools need to be installed and available on the path. These include cmake, python3, and Devicetree Compiler. 

See the [Install Dependecies Section of the Zephyr Getting Started Guide](https://docs.zephyrproject.org/latest/develop/getting_started/index.html#install-dependencies)

For ubuntu please also install python3-venv by ```sudo apt install python3-venv```

## Known Issues
* macOS compatibility is untested. Please make an issue on our github page with any incompatibilities found.

## Release Notes
See [CHANGELOG](CHANGELOG.md) for release notes

## Development and Debugging

See the [Zephyr IDE for VS Code Developer's Guide](developer-guide.md) for development and debugging instructions.

---
