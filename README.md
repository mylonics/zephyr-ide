# zephyr-ide README

The Zephyr IDE for VS code extension provides tools to aide in your zephyr work flow. This extension helps you to build Zephyr projects and share them with your team.

## Features
- Installs toolchains/sdks
- Sets up west environment
- Sets up projects with custom board files and multiple builds
- Add conf file and overlay files
- Build, Flash, and Debug projects

## Requirements

In order for this application to work correctly the zephyr require build tools need to be installed and available on the path. These include cmake, python3, and Devicetree Compiler. 

See the [Install Dependecies Section of the Zephyr Getting Started Guide](https://docs.zephyrproject.org/latest/develop/getting_started/index.html#install-dependencies)

For ubuntu please also install python3-venv by ```sudo apt install python3-venv```

## Extension Settings

This extension contributes the following settings:

* `zephyr-ide.projects`: Project structure to manually edit or share with other.
* `zephyr-ide.use-zephyr-ide-json`: Allows the use of a separate .json file. Useful if settings.json has unrelated local settings that should not be shared.

## Known Issues

* macOS compatibility is untested. Please make an issue on our gihub page with an problems

## Release Notes

See [CHANGELOG.md](CHANGELOG.md)

### 1.0.0

Initial release of ...

### 1.0.1

Fixed issue #.

### 1.1.0

Added features X, Y, and Z.

---

## Following extension guidelines

Ensure that you've read through the extensions guidelines and follow the best practices for creating your extension.

* [Extension Guidelines](https://code.visualstudio.com/api/references/extension-guidelines)

## Working with Markdown

You can author your README using Visual Studio Code. Here are some useful editor keyboard shortcuts:

* Split the editor (`Cmd+\` on macOS or `Ctrl+\` on Windows and Linux).
* Toggle preview (`Shift+Cmd+V` on macOS or `Shift+Ctrl+V` on Windows and Linux).
* Press `Ctrl+Space` (Windows, Linux, macOS) to see a list of Markdown snippets.

## For more information

* [Visual Studio Code's Markdown Support](http://code.visualstudio.com/docs/languages/markdown)
* [Markdown Syntax Reference](https://help.github.com/articles/markdown-basics/)

**Enjoy!**
