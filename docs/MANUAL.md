# Zephyr IDE User Manual

<img src="https://raw.githubusercontent.com/mylonics/zephyr-ide/main/docs/media/zephyr-ide_branding.png" alt="Zephyr IDE for Visual Studio Code" width="50%"/>

To get started, install the extension from [Visual Studio Code marketplace](https://marketplace.visualstudio.com/items?itemName=mylonics.zephyr-ide)

## Version 2.0.0 Updates
This major release includes workspace setup capabilities:
- Redesigned setup panel with improved user guidance and interactive setup process
- Automated host tools installation for required build dependencies
- Workspace setup methods with configuration options
- West SDK integration using West tooling for SDK management
- Improved error handling and setup instructions throughout the extension


## Getting Started

### Opening the Zephyr IDE Setup Panel

When you first open a workspace in VS Code with Zephyr IDE installed, you can access the Setup Panel through:
- The Zephyr IDE sidebar activity bar icon
- Command Palette: `Zephyr IDE: Setup Workspace`
- The Extension Setup View panel

The Setup Panel is the central hub for configuring your Zephyr development environment. It provides a card-based interface with three main areas:

### Setup Panel Overview

The Setup Panel presents three configuration cards:

![Setup Panel Overview](https://raw.githubusercontent.com/mylonics/zephyr-ide/main/docs/media/setup_panel.png)

1. Host Tools - Install and verify build tools required for Zephyr development
2. Zephyr SDK Management - Install and manage Zephyr SDK for different architectures
3. Workspace - Configure west workspace and Zephyr project dependencies

### Host Tools Setup

![Host Tools Installation](https://raw.githubusercontent.com/mylonics/zephyr-ide/main/docs/media/host_tool_install.png)


Click the Host Tools card to access the Host Tools sub-page. This page helps you:

- Check installed tools: The extension verifies that required build dependencies are available on your PATH, including:
  - CMake (build system)
  - Python3 (scripting and tools)
  - Devicetree Compiler (DTC)
  - gcc

- Automated installation: On supported platforms, the extension can automatically install missing dependencies using your system's package manager

- Manual installation guide: Links to the [Zephyr Getting Started Guide](https://docs.zephyrproject.org/latest/develop/getting_started/index.html#install-dependencies) for manual installation

### Zephyr SDK Installation

![SDK Management](https://raw.githubusercontent.com/mylonics/zephyr-ide/main/docs/media/sdk_management.png)

Click the Zephyr SDK Management card to access SDK installation. The SDK provides cross-compilation toolchains for various architectures (ARM, x86, RISC-V, etc.).

The extension uses West's SDK integration for version management:
- Select which SDK versions to install
- Install multiple SDKs for different architectures
- Manage SDK updates through the extension

For new users: Select the latest SDK version and install all available architectures. You can add specific architectures later if storage is a concern.

Note: SDK installation is a one-time process per computer and can be shared across multiple projects. SDK installation uses the west SDK command, so a west workspace must be configured before SDK management can occur.

### Workspace Configuration

![Unconfigured Workspace Panel](https://raw.githubusercontent.com/mylonics/zephyr-ide/main/docs/media/unconfigured_workspace_panel.png)

Click the Workspace card to configure your west workspace. You have several options:

1. Import from Git (Zephyr IDE workspace) - Clone a repository that contains a pre-configured Zephyr IDE workspace setup

2. Import from Git (West workspace) - Clone a west-based Zephyr repository from Git

3. New Standard Workspace - Create a fresh workspace in the current folder with:
   - Python virtual environment setup
   - West installation
   - Zephyr repository initialization
   - Optional: Choose between minimal or full Zephyr installation (minimal is recommended for faster setup)

4. Initialize Current Directory - Use the current folder as a west workspace if it already contains a west configuration

Workspace Setup Process:

When setting up a new workspace, the extension will:

1. Setup West Environment: Create a Python virtual environment and install west
2. West Init: Initialize the workspace with a west.yml manifest file
3. West Update: Clone Zephyr and its dependencies into the workspace

The folder structure after setup will typically look like:
```
workspace/
+-- .west/              # West configuration
+-- .venv/              # Python virtual environment
+-- zephyr/             # Zephyr RTOS source
+-- modules/            # Zephyr modules and dependencies
+-- your-app/           # Your application folder (with west.yml)
```

### Workspace Setup Options

During workspace initialization, you can choose:
- Installation type: Minimal (recommended, faster) or Full (all features)
- Board support: Select specific board vendors (e.g., STM32, Nordic, ESP32, Raspberry Pi Pico)
- Path prefix: Where Zephyr and modules will be installed relative to your application

The west.yml file controls what gets installed. A minimal configuration only includes Zephyr and essential HALs, while a full installation includes all available modules.

Once configured, the workspace panel will display your workspace information and allow you to directly update the west.yml file:

![Configured Workspace Panel](https://raw.githubusercontent.com/mylonics/zephyr-ide/main/docs/media/configured_workspace_panel.png)

## Using Externally Managed Environments

Zephyr IDE automatically detects and works with externally managed Zephyr environments.

If you already have Zephyr installed outside of Zephyr IDE (e.g., through Docker, a DevContainer, manual installation, or another workspace manager), the extension will automatically detect and use your existing installation through environment variables.

### How It Works

When Zephyr IDE starts and no workspace is actively configured:

1. Automatic Detection: The extension checks for the `ZEPHYR_BASE` environment variable
2. Environment Warning: If neither `ZEPHYR_BASE` nor `ZEPHYR_SDK_INSTALL_DIR` is set, a warning appears with three options:
   - Continue: Proceed using system environment variables (commands may still work if tools are in PATH)
   - Don't Show Again: Suppress this warning for the current workspace
   - Setup Workspace: Open the Setup Panel to configure a workspace


### Setting Up Environment Variables

To use an externally managed environment:

1. Set the environment variable in your shell profile (`.bashrc`, `.zshrc`, etc.):
   ```bash
   export ZEPHYR_BASE=/path/to/zephyrproject/zephyr
   export ZEPHYR_SDK_INSTALL_DIR=/path/to/zephyr-sdk  # optional
   ```

2. Start VS Code from a terminal that has these variables set:
   ```bash
   code /path/to/your/project
   ```

3. Verify: All Zephyr IDE commands will use your environment-based setup

### Suppressing the Environment Warning

If you prefer to work without setting `ZEPHYR_BASE` (e.g., using west commands directly), you can suppress the warning:

Option 1: Click "Don't Show Again" when the warning appears

Option 2: Manually add to `.vscode/settings.json`:
```json
{
  "zephyr-ide.suppress-workspace-warning": true
}
```

This setting prevents the warning from appearing, allowing you to work with system tools without additional prompts.

### Use Cases

Externally managed environments are suitable for:

- Docker/DevContainer workflows: Environment variables are pre-configured in your container
- CI/CD pipelines: Build with pre-installed Zephyr in automated environments
- Shared development environments: Teams using a common Zephyr installation
- Manual installations: You have installed Zephyr following the official Zephyr Getting Started guide
- Multiple projects: Share one Zephyr installation across multiple project workspaces

### How the Extension Handles Externally Managed Environments

When `ZEPHYR_BASE` is set, the extension:
- Assumes west and required packages are already installed in the environment
- Uses the detected Zephyr installation for all build operations
- Allows all commands (build, flash, debug) to run without workspace-specific configuration
- Shows a warning if environment variables are missing (unless suppressed with the setting above)

This approach provides maximum flexibility for developers who manage their own Zephyr installations while still offering guided setup for those who prefer IDE-managed workspaces.


## Setting Up A Project
To set up a project, the project panel provides the ability to add a preexisting project or to copy a sample project as a starting point. In the following example, the blinky project is added from the Zephyr sample folder. An STM32F4 build is added to the project. 

![Adding Projects and Build](https://raw.githubusercontent.com/mylonics/zephyr-ide/main/docs/media/adding_project_and_build.gif)

Each project can have multiple builds associated with it. Each build may also have multiple runners associated with each specific build. In this case, a Raspberry PI Pico board/build is added to the blinky project. The default runner is added to the original build and the UF2 runner is added to the Pico build.

![Adding More Builds](https://raw.githubusercontent.com/mylonics/zephyr-ide/main/docs/media/adding_additional_build.gif)

The project configuration is stored in a human-readable JSON, which allows users to manually modify the projects or commit them to a repo to share the workspace with team members.

![Project JSON ](https://raw.githubusercontent.com/mylonics/zephyr-ide/main/docs/media/projects_json.png)

## Building/Debugging A Project
The project may now be built. This can be done with the Active Project Panel or Taskbar buttons. There are options to build pristine, build, flash and debug. The taskbar also displays the active project.

![Taskbar Buttons](https://raw.githubusercontent.com/mylonics/zephyr-ide/main/docs/media/taskbar_buttons.gif)

To debug, launch configurations need to be setup. By default, Zephyr IDE provides 4 examples using cortex-debug. The examples use cortex debug and have a blackmagic probe and st-link configuration. There is a Debug and Attach configuration for each. The OpenOCD examples are configured for stlink and nrf52. A fifth example is also available called the Debug Select Configuration.

![Setting Up Launch Configuration](https://raw.githubusercontent.com/mylonics/zephyr-ide/main/docs/media/setting_up_debug.gif)

The IDE provides commands that help a user develop launch configurations. These include the following:
- "zephyr-ide.get-active-project-name"
- "zephyr-ide.get-active-project-path"
- "zephyr-ide.get-active-build-path"
- "zephyr-ide.get-active-build-board-path"
- "zephyr-ide.select-active-build-path"
- "zephyr-ide.get-gdb-path"
- "zephyr-ide.get-toolchain-path"
- "zephyr-ide.get-zephyr-ide-json-variable"
- "zephyr-ide.get-active-project-variable"
- "zephyr-ide.get-active-build-variable"
- "zephyr-ide.get-active-board-name"

The Debug Select Configuration allows a user to select what project/build to debug for and uses "zephyr-ide.select-active-build-path", the other two default configurations use the "zephyr-ide.get-active-build-path" to debug the current active project as shown in the taskbar or active project panel.

![Zephyr IDE Debug Commands](https://raw.githubusercontent.com/mylonics/zephyr-ide/main/docs/media/setting_up_debug2.gif)

If there is a variable you want associated with a project/build that needs to be available for your launch configuration, you can use the `zephyr-ide.get-active-project-variable` or `zephyr-ide.get-active-build-variable`. In you `zephyr-ide.json` file, create a `vars` variable in your project or the buildConfig and define a custom variable. Then in launch.json you can access the variable using the input command. 

zephyr-ide.json
```
{
  "projects": {
    "blinky": {
      "name": "blinky",
      "vars": {
        "custom_var": "custom_var"
      },
      "buildConfigs": {
        "build\\stm32f4_disco": {
          "relBoardDir": "external\\zephyr\\boards",
          "board": "stm32f4_disco",
          "relBoardSubDir": "external\\zephyr\\boards\\st\\stm32f4_disco",
          "vars": {
            "jlink_var": "STM32F401RE",
            "bmp_port": "COM3"
          },
...
```

launch.json
```
"inputs": [
        {
            "id": "getCustomBuildVariable",
            "type": "command",
            "command": "zephyr-ide.get-active-build-variable",
            "args": "bmp_port"
        }
    ],
"configurations": [    
      {
        "name": "Zephyr IDE: Debug",
        "BMPGDBSerialPort": "${input:getCustomBuildVariable}",
      },
    ],
```

## Twister Tests
The extension also supports testing with twister. Look for the beaker icon to get started. Test configurations are handled similarly to build configurations.

![Zephyr IDE Twister Testing](https://raw.githubusercontent.com/mylonics/zephyr-ide/main/docs/media/adding_twister_test.gif)

## Sharing your Code
In general, you should commit everything in your workspace folder except for build directories, .venv, .vscode/compile_commands.json and external. A .gitignore is automatically generated that should exclude the relevant files. Settings.json and launch.json may be committed on a case-by-case basis depending on user discretion.

If you are trying to share a non-local workspace, then committing settings.json is not advisable as some variables may change. Unfortunately, VSCode does not provide a way for having user-specific settings/configurations per workspace. See this [issue](https://github.com/Microsoft/vscode/issues/15909) on the VSCode repo.

You can also use a code-workspace.json file to help manage projects across different machines.

You can have a look at this [sample directory](https://github.com/mylonics/zephyr-ide-sample-project) to also help with getting started with sharing projects.

## Other Features
The Zephyr Menu Config or GUI Config may be run from the active project panel. In the project config panel, by default, a Menu Config option is available. This can be changed to GUI Config by adding `"zephyr-ide.use_gui_config": true` to settings.json. Each debug target may be bound to a custom launch configuration (by default they use "Zephyr IDE: Debug" and "Zephyr IDE: Attach").

![Demonstrating MenuConfig](https://raw.githubusercontent.com/mylonics/zephyr-ide/main/docs/media/demonstrating_menu_config_debug_binding.gif)

The IDE allows modifying the west and cmake arguments per build. It allows the user to provide runner arguments, and specify DTS overlay and KConfig files per project or build.

![Demonstrating KConfig](https://raw.githubusercontent.com/mylonics/zephyr-ide/main/docs/media/kConfig_dtc.gif)

Custom west commands may be run using the inbuilt Zephyr IDE Terminal.  

![West Terminal](https://raw.githubusercontent.com/mylonics/zephyr-ide/main/docs/media/west_terminal.gif)


You can also run the following commands:
 - ROM Report - Zephyr IDE: Run ROM Report
 - RAM Report - Zephyr IDE: Run RAM Report
 - DTSh Shell - Zephyr IDE: Start DTSh Shell

## Extension Pack
The Zephyr IDE Extension also integrates with a handful of extensions and is released as an [extension pack](https://marketplace.visualstudio.com/items?itemName=mylonics.zephyr-ide-extension-pack). With the extension pack, C++ and DeviceTree intellisense is available. A Kconfig GUI is also available.
- Cortex-Debug - ARM Cortex-M GDB Debugger support for VSCode
- C/C++ - C/C++ IntelliSense, debugging, and code browsing.
- Serial Monitor - Send and receive text from serial ports.
- Devicetree LSP - Devicetree Language Server
- CMake - Intellisense for CMake Files

## Known Issues
**Dev containers with WSL and Windows folders**: When using dev containers in a WSL environment, ensure your workspace folder is located within the Ubuntu file system (e.g., `/home/username/project`) rather than in mounted Windows directories (e.g., `/mnt/c/Users/...`).

## Available Commands

Zephyr IDE provides the following commands accessible via the command palette (Ctrl+Shift+P or Cmd+Shift+P):

### Setup and Workspace Management
- `Zephyr IDE: Workspace Setup` - Open workspace setup picker
- `Zephyr IDE: Setup Workspace from Git` - Clone and setup workspace from Git repository
- `Zephyr IDE: Setup West Workspace from Git` - Clone and setup West workspace from Git
- `Zephyr IDE: Setup Workspace from Current Directory` - Initialize current directory as workspace
- `Zephyr IDE: Setup Standard Workspace` - Create new standard workspace
- `Zephyr IDE: Setup West Environment` - Setup West environment
- `Zephyr IDE: West Init` - Initialize West workspace
- `Zephyr IDE: West Update` - Update West workspace
- `Zephyr IDE: West Config` - Configure West settings
- `Zephyr IDE: Reset Workspace` - Reset workspace configuration
- `Zephyr IDE: Open Setup Panel` - Open the setup panel interface
- `Zephyr IDE: Create New West Workspace` - Create new West workspace
- `Zephyr IDE: Refresh West Workspaces` - Refresh workspace list
- `Zephyr IDE: Select Existing West Workspace` - Select from existing workspaces
- `Zephyr IDE: Manage Workspace Installations` - Manage workspace installations
- `Zephyr IDE: Mark West as Ready` - Mark West workspace as ready
- `Zephyr IDE: Set Workspace Settings` - Configure workspace settings
- `Zephyr IDE: Reset Zephyr Install Selection` - Reset Zephyr installation selection
- `Zephyr IDE: Print Workspace Structure` - Print workspace structure to console

### Host Tools and SDK Management
- `Zephyr IDE: Host Tools Installation` - Open host tools installation panel
- `Zephyr IDE: Install Host Tools` - Install required host tools
- `Zephyr IDE: Setup Check Build Dependencies Available` - Check build dependencies
- `Zephyr IDE: Install SDK` - Install Zephyr SDK
- `Zephyr IDE: Reinitialize DTS Language Server` - Reinitialize DTS language server

### Project Management
- `Zephyr IDE: Add Project` - Add existing project
- `Zephyr IDE: Create Project From Template` - Create new project from template
- `Zephyr IDE: Remove Project` - Remove project
- `Zephyr IDE: Set Active Project` - Set active project
- `Zephyr IDE: Clear Projects` - Clear all projects
- `Zephyr IDE: Load Projects From File` - Load projects from zephyr-ide.json
- `Zephyr IDE: Save Projects To File` - Save projects to zephyr-ide.json
- `Zephyr IDE: Add Project KConfig Files` - Add KConfig files to project
- `Zephyr IDE: Remove Project KConfig Files` - Remove KConfig files from project
- `Zephyr IDE: Add Project Overlay Files` - Add overlay files to project
- `Zephyr IDE: Remove Project Overlay Files` - Remove overlay files from project

### Build Configuration Management
- `Zephyr IDE: Add Build Configuration` - Add new build configuration
- `Zephyr IDE: Remove Build` - Remove build configuration
- `Zephyr IDE: Set Active Build` - Set active build configuration
- `Zephyr IDE: Add Build KConfig Files` - Add KConfig files to build
- `Zephyr IDE: Remove Build KConfig Files` - Remove KConfig files from build
- `Zephyr IDE: Add Build Overlay Files` - Add overlay files to build
- `Zephyr IDE: Remove Build Overlay Files` - Remove overlay files from build
- `Zephyr IDE: Modify Build Arguments` - Modify build arguments

### Runner Management
- `Zephyr IDE: Add Runner` - Add runner to build configuration
- `Zephyr IDE: Remove Runner` - Remove runner from build configuration
- `Zephyr IDE: Set Active Runner` - Set active runner

### Build and Flash Operations
- `Zephyr IDE: Build Pristine` - Build with pristine flag (clean build)
- `Zephyr IDE: Build` - Build active project
- `Zephyr IDE: Clean` - Clean build artifacts
- `Zephyr IDE: Flash` - Flash build to target device

### Debug Operations
- `Zephyr IDE: Debug` - Start debugging session
- `Zephyr IDE: Debug Attach` - Attach debugger to running target
- `Zephyr IDE: Build and Debug` - Build and start debugging
- `Zephyr IDE: Change Debug Launch Configuration For Build` - Change debug launch configuration
- `Zephyr IDE: Change Build and Debug Launch Configuration For Build` - Change build and debug launch configuration
- `Zephyr IDE: Change Debug Attach Launch Configuration For Build` - Change debug attach launch configuration

### Configuration and Analysis Tools
- `Zephyr IDE: Start Menu Config` - Start Kconfig menu configuration
- `Zephyr IDE: Start GUI Config` - Start Kconfig GUI configuration
- `Zephyr IDE: Run ROM Report` - Generate ROM usage report
- `Zephyr IDE: Run RAM Report` - Generate RAM usage report
- `Zephyr IDE: Start DTSh Shell` - Start devicetree shell

### Testing with Twister
- `Zephyr IDE: Add Twister Test to Project` - Add Twister test
- `Zephyr IDE: Remove Twister Test from Project` - Remove Twister test
- `Zephyr IDE: Set Active Test` - Set active test
- `Zephyr IDE: Run Test` - Run Twister test
- `Zephyr IDE: Reconfigure Active Test` - Reconfigure active test
- `Zephyr IDE: Delete Test Output Directories` - Delete test output directories

### Automatic Project Targeting
- `Zephyr IDE: Enable Automatic Active Project Targeting` - Enable automatic project targeting based on active file
- `Zephyr IDE: Disable Automatic Active Project Targeting` - Disable automatic project targeting

### Utility Commands
- `Zephyr IDE: Show View Container` - Show Zephyr IDE view container
- `Zephyr IDE: Reload Web Views` - Reload web view panels
- `Zephyr IDE: Debug Internal Shell` - Debug internal shell
- `Zephyr IDE: Shell Test` - Test shell functionality

## Configuration Settings

The following settings are available in VS Code settings (File > Preferences > Settings):

### `zephyr-ide.tools_directory`
- **Type**: String or null
- **Default**: null
- **Description**: Manually specify a tools directory for SDK installation and global Zephyr install location

### `zephyr-ide.use_gui_config`
- **Type**: Boolean
- **Default**: false
- **Description**: Display GUI config instead of menu config in Project Tree View

### `zephyr-ide.westNarrowUpdate`
- **Type**: Boolean
- **Default**: false
- **Description**: If true, uses 'west update --narrow'. If false, uses 'west update' without --narrow.

### `zephyr-ide.suppress-workspace-warning`
- **Type**: Boolean
- **Default**: false
- **Description**: If true, suppresses the warning about missing workspace environment variables (ZEPHYR_BASE, ZEPHYR_SDK_INSTALL_DIR).

### `zephyr-ide.venv-folder`
- **Type**: String or null
- **Default**: null
- **Description**: Manually specify a Python virtual environment folder path. If not specified, defaults to .venv in the workspace setup path.

## Launch Configuration Helper Commands

The following commands can be used in launch.json configurations to dynamically retrieve project and build information:

- `zephyr-ide.get-active-project-name` - Get active project name
- `zephyr-ide.get-active-project-path` - Get active project path
- `zephyr-ide.get-active-build-path` - Get active build path
- `zephyr-ide.get-active-build-board-path` - Get active build board path
- `zephyr-ide.select-active-build-path` - Select active build path (prompts user)
- `zephyr-ide.get-gdb-path` - Get GDB path from toolchain
- `zephyr-ide.get-toolchain-path` - Get toolchain path
- `zephyr-ide.get-zephyr-ide-json-variable` - Get variable from zephyr-ide.json
- `zephyr-ide.get-active-project-variable` - Get custom variable from active project
- `zephyr-ide.get-active-build-variable` - Get custom variable from active build
- `zephyr-ide.get-active-board-name` - Get active board name
