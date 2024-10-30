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
* zsh as a shell is not supported, bash should be available on linux and mac os installs
* macOS compatibility is untested. Please make an issue on our github page with any incompatibilities found.

## Release Notes
### 1.3.4
Added RAM/ROM report\
Updated available versions\
Added workspacepath to devicetree and kconfig variables if extension setup is workspace\
Added generation of gitignore file\
Added sample project to help users get started\
Added DTSh shell \
Added ability to select active project and active build from status bar

### 1.3.3
Added command to get board directory path for debugging purposes

### 1.3.2
Fixed macos xtensa sdk download\
Updated manual

### 1.3.0
Fixed GUI failing to update on new project/build\
Fixed multiple conf file missing deliminator\
Adding shell vscode config test command\
Force use of bash on macos always\
Detect if python .venv already exists and prompt user to replace

### 1.2.0
Added marked West as ready command\
Use python for macos instead of python3\
Force use of bash when zsh is the default profile.\
Allow any folder to be the zephyr install folder and allow to manually specificy tools directory.\
Fixed west init issue with by unsetting zephyr base.

### 1.1.0
Bug fixes in gui rendering. Multiple tasks are now allowed to run at the same time. Integration with NRF device tree and KConfig.\

### 1.0.43
Added compile commands and linking with intellisense\
Added the ability to clone git repo during west init.\
Cleaned up some handling of VS code tasks.\
Added extra west build arguments. (Must be added to .json files)\
Added West Configurator for different HALs.\
Added menuConfig and guiConfig commands.\
Added the ability to select different zephyr versions.\
Added default args for runner

### 1.0.0

Initial release.

## Development and Debugging

See the [Zephyr IDE for VS Code Developer's Guide](developer-guide.md) for development and debugging instructions.

---
