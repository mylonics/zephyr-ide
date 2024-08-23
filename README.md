#  Zephyr IDE for VS Code

The Zephyr IDE for VS code extension provides tools to aide in your Zephyr Project work flow. This extension helps you to build Zephyr projects and share them with your team.

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
There are two tutorial available on youtube.

[![Getting Started with Zephyr IDE](https://mylonics.com/assets/images/zephyr-ide/getting_started_thumbnail.png)](https://www.youtube.com/watch?v=Asfolnh9kqM&t "Getting Started with Zephyr IDE")

[![STM32 Board Setup And Debugging with Zephyr IDE](https://mylonics.com/assets/images/zephyr-ide/board_setup_thumbnail.png)](https://www.youtube.com/watch?v=TXcTzyswBMQ)

## Requirements

In order for this application to work correctly the zephyr require build tools need to be installed and available on the path. These include cmake, python3, and Devicetree Compiler. 

See the [Install Dependecies Section of the Zephyr Getting Started Guide](https://docs.zephyrproject.org/latest/develop/getting_started/index.html#install-dependencies)

For ubuntu please also install python3-venv by ```sudo apt install python3-venv```

## Extension Settings

This extension contributes the following settings:

* `zephyr-ide.projects`: Project structure to manually edit or share with other.
* `zephyr-ide.use-zephyr-ide-json`: Allows the use of a separate .json file. Useful if settings.json has unrelated local settings that should not be shared.

## Known Issues

* macOS compatibility is untested. Please make an issue on our github page with any incompatibilities found.

## Release Notes
### 1.0.41
Fix conflict with python environment manager extension 

### 1.0.37
New GUI panel. Maintain GUI tree state on relaunch. Removed updating of project file with active project/build/runner 

### 1.0.36

Added additional debug statements to the debug shell command


### 1.0.32

Improved SDK install
Added Global Zephyr Install Option

### 1.0.31

Added GUI for west build.
Added additional build buttons to status bar
Prevent initialization of workspace without folder open

### 1.0.27

Repackage

### 1.0.25

Added the ability to clone git repo during west init.
Cleaned up some handling of VS code tasks.

### 1.0.24

Fixed bug with setting up west environment

### 1.0.23

Added extra west build arguments. (Must be added to .json files)
Added West Configurator for different HALs.
Added menuConfig and guiConfig commands.
Renamed sample projects.

### 1.0.22

Added the ability to copy from all samples

### 1.0.21

Fix for v3.6.0 and previous board list

### 1.0.20

Parsed board qualifications to be able to handle newer board

### 1.0.19

Removed path from ncs west.yml

### 1.0.18

Fixed introduced bug with west init

### 1.0.15

Allow default runner when board.cmake file does not exist.

### 1.0.14

Added the ability to select different zephyr versions.

### 1.0.13

Added checks for dtc and cmake. Removed showing only arm boards when only arm toolchain is installed.

### 1.0.12

Added default args for runner

### 1.0.11

Fixed default runner

### 1.0.10

Only available runners display and non arm board dts files may be opened from the GUI

### 1.0.9

Fixed incorrect build notification

### 1.0.8

Reverted default project file to use

### 1.0.7

Fixed not able to remove projects or build.

### 1.0.0

Initial release.

## Development and Debugging

See the [Zephyr IDE for VS Code Developer's Guide](developer-guide.md) for development and debugging instructions.

---
