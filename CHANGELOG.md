# Change Log

All notable changes to the "zephyr-ide" extension will be documented in this file.

## 2.0.0
Major update with enhanced workspace setup and user experience improvements:
- **Updated Zephyr IDE and workspace setup panel** - Redesigned interface to match rest of GUI
- **New setup panel** - Interactive guided setup process for new users
- **Host tools installation** - Automated installation and verification of required build dependencies
- **Enhanced workspace setup methods** - Improved workspace configuration and initialization for git repos and folders
- **New West SDK integration** - Updated SDK installation process to use `west sdk` command
- **Improved user guidance** - Better error messages and setup instructions throughout the extension
- Improved finding samples
- Fixed bug in build and update command

## 1.10.18
- CI experimentation

## 1.10.1, 1.10.0, 1.9.0
- Incorrect publish version published 
- Added recommendations for dts language server and cpp intellisense
- Removed configuration dependency on OneTimeWorkSpaceSetup
- dded ability to use gui config in Project Tree view
- Updated README
- Updated build buttons
- Fixed issue with board build command not working
- Fixed issue with debug buttons
- Added additional debug examples for OpenOCD
- Reverted west.yml cmsis6 fix until v4.2.0 comes out

## 1.8.0
- Minor board sub directory fixes
- New macOS fix
- Added Twister Testing. 
- Parsing board revision numbers for build configuration for >4.1.0. 
- Checking if build_info file exists before trying to read it.
- Fixed bug calling west list before a west update has occurred.
- Removed Deprecated .vscode settings 
- Updated nrf connect versions

## 1.7.0
- Added full support dts-lsp contexts 
- Added support for multiroot workspaces 
- Added the ability to load samples from modules 
- Project folders with periods in the name are not imported properly - @Matt-Armstrong-Faro 
- Additional experimental support for dts-lsp contexts  
- Fixed bug when module yaml file not found 
- Added initial support for dts-lsp 
- Improved zsh and mac os support by using environment variable collection 
- Minor typo fix
- Make .vscode directory if it doesn't exist - @rpiper 
- Added SDK 0.17.0
- Added minimal ble template
- Modified default .gitignore to no longer ignore .west folder

## 1.6.0
- Improved support for global workspaces
- Moved Release Notes to CHANGELOG
- Removed filter on .KConfig files
- Fixing board selection command - Removed use of custom python scripts for board list
- Additional fixes to build command
- Fixing build command

## 1.5.0
- Added New Activation Event
- Fixed ENV Path duplication bug
- Added runner Selector to status bar
- Default Zephyr IDE Terminal for all OS
- Renamed application folder to west-manifest
- Reworked build command to not reconfigure cmake each build

## 1.4.0
-Added custom variables to zephyr-ide.json 
-Added RAM/ROM report
-Updated available versions
-Added workspacepath to devicetree and kconfig variables if extension setup is workspace
-Added generation of gitignore file
-Added sample project to help users get started
-Added DTSh shell 
-Added ability to select active project and active build from status bar 
-Added command to get board directory path for debugging purposes 
-Fixed macos xtensa sdk download
-Updated manual

## 1.3.0
- Fixed GUI failing to update on new project/build
- Fixed multiple conf file missing deliminator
- Adding shell vscode config test command
- Force use of bash on macos always
- Detect if python .venv already exists and prompt user to replace

## 1.2.0
- Added marked West as ready command
- Use python for macos instead of python3
- Force use of bash when zsh is the default profile.
- Allow any folder to be the zephyr install folder and allow to manually specificy tools directory.
- Fixed west init issue with by unsetting zephyr base.

## 1.1.0
- Bug fixes in gui rendering. Multiple tasks are now allowed to run at the same time. Integration with NRF device tree and KConfig.

## 1.0.43
- Added compile commands and linking with intellisense
- Added the ability to clone git repo during west init.
- Cleaned up some handling of VS code tasks.
- Added extra west build arguments. (Must be added to .json files)
- Added West Configurator for different HALs.
- Added menuConfig and guiConfig commands.
- Added the ability to select different zephyr versions.
- Added default args for runner

## 1.0.0
 - Initial release.
