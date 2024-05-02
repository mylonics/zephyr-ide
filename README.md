#  Zephyr IDE for VS Code

The Zephyr IDE for VS code extension provides tools to aide in your Zephyr Project work flow. This extension helps you to build Zephyr projects and share them with your team.

## Features
- Installs toolchains/sdks
- Sets up west environment
- Sets up projects with custom board files and multiple builds
- Add conf file and overlay files
- Build, Flash, and Debug projects


## Getting Started
There are two tutorial available on youtube.

[Getting Started with Zephyr IDE for VSCode](https://youtu.be/Asfolnh9kqM)

[Creating a New Board, Building, Flashing, and Debugging](https://youtu.be/TXcTzyswBMQ)

## Requirements

In order for this application to work correctly the zephyr require build tools need to be installed and available on the path. These include cmake, python3, and Devicetree Compiler. 

See the [Install Dependecies Section of the Zephyr Getting Started Guide](https://docs.zephyrproject.org/latest/develop/getting_started/index.html#install-dependencies)

For ubuntu please also install python3-venv by ```sudo apt install python3-venv```

## Extension Settings

This extension contributes the following settings:

* `zephyr-ide.projects`: Project structure to manually edit or share with other.
* `zephyr-ide.use-zephyr-ide-json`: Allows the use of a separate .json file. Useful if settings.json has unrelated local settings that should not be shared.

## Known Issues

* macOS compatibility is untested. Please make an issue on our gihub page with any incompatibilities found.

## Release Notes

### 1.0.0

Initial release.

---
