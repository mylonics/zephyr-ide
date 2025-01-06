# Change Log

All notable changes to the "zephyr-ide" extension will be documented in this file.

## 1.6.2
Minor typo fix\
Make .vscode directory if it doesn't exist - @rpiper

## 1.6.1
Added SDK 0.17.0\
Added minimal ble template\
Modified default .gitignore to no longer ignore .west folder

## 1.6.0
Improved support for global workspaces\
Moved Release Notes to CHANGELOG\
Removed filter on .KConfig files\
Fixing board selection command - Removed use of custom python scripts for board list\
Additional fixes to build command\
Fixing build command

## 1.5.0
Added New Activation Event\
Fixed ENV Path duplication bug\
Added runner Selector to status bar\
Default Zephyr IDE Terminal for all OS\
Renamed application folder to west-manifest\
Reworked build command to not reconfigure cmake each build

## 1.4.0
Added custom variables to zephyr-ide.json \
Added RAM/ROM report\
Updated available versions\
Added workspacepath to devicetree and kconfig variables if extension setup is workspace\
Added generation of gitignore file\
Added sample project to help users get started\
Added DTSh shell \
Added ability to select active project and active build from status bar \
Added command to get board directory path for debugging purposes \
Fixed macos xtensa sdk download\
Updated manual

## 1.3.0
Fixed GUI failing to update on new project/build\
Fixed multiple conf file missing deliminator\
Adding shell vscode config test command\
Force use of bash on macos always\
Detect if python .venv already exists and prompt user to replace

## 1.2.0
Added marked West as ready command\
Use python for macos instead of python3\
Force use of bash when zsh is the default profile.\
Allow any folder to be the zephyr install folder and allow to manually specificy tools directory.\
Fixed west init issue with by unsetting zephyr base.

## 1.1.0
Bug fixes in gui rendering. Multiple tasks are now allowed to run at the same time. Integration with NRF device tree and KConfig.\

## 1.0.43
Added compile commands and linking with intellisense\
Added the ability to clone git repo during west init.\
Cleaned up some handling of VS code tasks.\
Added extra west build arguments. (Must be added to .json files)\
Added West Configurator for different HALs.\
Added menuConfig and guiConfig commands.\
Added the ability to select different zephyr versions.\
Added default args for runner

## 1.0.0

Initial release.
