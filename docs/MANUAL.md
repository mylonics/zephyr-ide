# IDE for Zephyr User Manual

<img src="https://raw.githubusercontent.com/mylonics/zephyr-ide/main/docs/media/zephyr-ide_branding.png" alt="IDE for Zephyr - Visual Studio Code Extension" width="50%"/>

To get started, install the extension from [Visual Studio Code marketplace](https://marketplace.visualstudio.com/items?itemName=mylonics.zephyr-ide) or [Open VSX Registry](https://open-vsx.org/extension/mylonics/zephyr-ide)

> **Note:** The full online documentation is available at https://zephyr-ide.mylonics.com/. This file is provided as an offline/local reference.

## Getting Started

### Opening the IDE for Zephyr Setup Panel

When you first open a workspace in VS Code with IDE for Zephyr installed, you can access the Setup Panel through:
- The IDE for Zephyr sidebar activity bar icon
- Command Palette: `IDE for Zephyr: Setup Workspace`
- The Extension Setup View panel

The Setup Panel is the central hub for configuring your Zephyr development environment. It provides a card-based interface with three main areas:

### Setup Panel Overview

The Setup Panel presents three configuration cards:

![Setup Panel Overview](https://raw.githubusercontent.com/mylonics/zephyr-ide/main/docs/media/setup_panel.png)

1. Host Tools - Install and verify build tools required for Zephyr development
2. Zephyr SDK Management - Install and manage Zephyr SDK for different architectures
3. Workspace - Configure west workspace and Zephyr project dependencies

### Host Tools

![Host Tools Installation](https://raw.githubusercontent.com/mylonics/zephyr-ide/main/docs/media/host_tool_install.png)


Click the Host Tools card to access the Host Tools sub-page. This page helps you:

- Check installed tools: The extension verifies that required build dependencies are available on your PATH, including:
  - CMake (build system)
  - Python3 (scripting and tools)
  - Devicetree Compiler (DTC)
  - gcc

- Automated installation: On supported platforms, the extension can automatically install missing dependencies using your system's package manager

- Manual installation guide: Links to the [Zephyr Getting Started Guide](https://docs.zephyrproject.org/latest/develop/getting_started/index.html#install-dependencies) for manual installation

### Workspace Configuration

![Unconfigured Workspace Panel](https://raw.githubusercontent.com/mylonics/zephyr-ide/main/docs/media/unconfigured_workspace_panel.png)

Click the Workspace card to configure your west workspace. You have several options:

1. IDE for Zephyr Workspace from Git - Clone a repository that contains a pre-configured IDE for Zephyr workspace setup

2. West Workspace from Git - Clone a west-based Zephyr repository from Git

3. Standard Workspace - Create a fresh workspace in the current folder with:
   - Python virtual environment setup
   - West installation
   - Zephyr repository initialization
   - Optional: Choose between minimal or full Zephyr installation (minimal is recommended for faster setup)

4. Open Current Directory - Use the current folder as a west workspace. Sub-options:
   - Use .west folder (Recommended) - Use an existing `.west` configuration
   - Use west.yml file - Use an existing `west.yml` manifest
   - Create new west.yml - Create a new manifest for a fresh workspace
   - Use external Zephyr installation - Link to an externally managed Zephyr installation

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

### Zephyr SDK Installation

![SDK Management](https://raw.githubusercontent.com/mylonics/zephyr-ide/main/docs/media/sdk_management.png)

Click the Zephyr SDK Management card to access SDK installation. The SDK provides cross-compilation toolchains for various architectures (ARM, x86, RISC-V, etc.).

The extension uses West's SDK integration for version management:
- Select which SDK versions to install
- Install multiple SDKs for different architectures
- Manage SDK updates through the extension

For new users: Select the latest SDK version and install all available architectures. You can add specific architectures later if storage is a concern.

Note: SDK installation is a one-time process per computer and can be shared across multiple projects. SDK installation uses the west SDK command, so a west workspace must be configured before SDK management can occur.

## Using Externally Managed Environments

IDE for Zephyr automatically detects and works with externally managed Zephyr environments.

If you already have Zephyr installed outside of IDE for Zephyr (e.g., through Docker, a DevContainer, manual installation, or another workspace manager), the extension will automatically detect and use your existing installation through environment variables.

### How It Works

When IDE for Zephyr starts and no workspace is actively configured:

1. Automatic Detection: The extension checks for the `ZEPHYR_BASE` environment variable
2. Environment Warning: If neither `ZEPHYR_BASE` nor `ZEPHYR_SDK_INSTALL_DIR` is set, a warning appears with three options:
   - Continue: Proceed using system environment variables (commands may still work if tools are in PATH)
   - Don't Show Again: Suppress this warning for the current workspace
   - Setup Workspace: Open the Setup Panel to configure a workspace

When `ZEPHYR_BASE` is set, the extension:
- Assumes west and required packages are already installed in the environment
- Uses the detected Zephyr installation for all build operations
- Allows all commands (build, flash, debug) to run without workspace-specific configuration
- Shows a warning if environment variables are missing (unless suppressed with the setting above)


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

3. Verify: All IDE for Zephyr commands will use your environment-based setup

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

To debug, launch configurations need to be setup. By default, IDE for Zephyr provides 4 examples using cortex-debug. The examples use cortex debug and have a blackmagic probe and st-link configuration. There is a Debug and Attach configuration for each. The OpenOCD examples are configured for stlink and nrf52. A fifth example is also available called the Debug Select Configuration.

![Setting Up Launch Configuration](https://raw.githubusercontent.com/mylonics/zephyr-ide/main/docs/media/setting_up_debug.gif)

The IDE provides commands that help a user develop launch configurations. These include the following:
- `zephyr-ide.get-active-project-name`
- `zephyr-ide.get-active-project-path`
- `zephyr-ide.get-active-build-path`
- `zephyr-ide.get-active-build-board-path`
- `zephyr-ide.select-active-build-path`
- `zephyr-ide.get-gdb-path`
- `zephyr-ide.get-arm-gdb-path`
- `zephyr-ide.get-toolchain-path`
- `zephyr-ide.get-zephyr-dir`
- `zephyr-ide.get-zephyr-elf`
- `zephyr-ide.get-zephyr-elf-dir`
- `zephyr-ide.get-zephyr-ide-json-variable`
- `zephyr-ide.get-active-project-variable`
- `zephyr-ide.get-active-build-variable`
- `zephyr-ide.get-active-board-name`

The Debug Select Configuration allows a user to select what project/build to debug for and uses `zephyr-ide.select-active-build-path`, the other two default configurations use `zephyr-ide.get-active-build-path` to debug the current active project as shown in the taskbar or active project panel.

![IDE for Zephyr Debug Commands](https://raw.githubusercontent.com/mylonics/zephyr-ide/main/docs/media/setting_up_debug2.gif)

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
        "name": "IDE for Zephyr: Debug",
        "BMPGDBSerialPort": "${input:getCustomBuildVariable}",
      },
    ],
```

## Twister Tests
The extension also supports testing with twister. Look for the beaker icon to get started. Test configurations are handled similarly to build configurations.

![IDE for Zephyr Twister Testing](https://raw.githubusercontent.com/mylonics/zephyr-ide/main/docs/media/adding_twister_test.gif)

## Sharing your Code
In general, you should commit everything in your workspace folder except for build directories, .venv, .vscode/compile_commands.json and external. A .gitignore is automatically generated that should exclude the relevant files. Settings.json and launch.json may be committed on a case-by-case basis depending on user discretion.

If you are trying to share a non-local workspace, then committing settings.json is not advisable as some variables may change. Unfortunately, VSCode does not provide a way for having user-specific settings/configurations per workspace. See this [issue](https://github.com/Microsoft/vscode/issues/15909) on the VSCode repo.

You can also use a code-workspace.json file to help manage projects across different machines.

You can have a look at this [sample directory](https://github.com/mylonics/zephyr-ide-sample-project) to also help with getting started with sharing projects.

## Advanced Features
The Zephyr Menu Config or GUI Config may be run from the active project panel. In the project config panel, by default, a Menu Config option is available. This can be changed to GUI Config by adding `"zephyr-ide.use_gui_config": true` to settings.json. Each debug target may be bound to a custom launch configuration (by default they use "IDE for Zephyr: Debug" and "IDE for Zephyr: Attach").

![Demonstrating MenuConfig](https://raw.githubusercontent.com/mylonics/zephyr-ide/main/docs/media/demonstrating_menu_config_debug_binding.gif)

The IDE allows modifying the west and cmake arguments per build. It allows the user to provide runner arguments, and specify DTS overlay and KConfig files per project or build.

![Demonstrating KConfig](https://raw.githubusercontent.com/mylonics/zephyr-ide/main/docs/media/kConfig_dtc.gif)

Custom west commands may be run using the inbuilt IDE for Zephyr Terminal.  

![West Terminal](https://raw.githubusercontent.com/mylonics/zephyr-ide/main/docs/media/west_terminal.gif)


You can also run the following commands:
 - ROM Report - IDE for Zephyr: Run ROM Report
 - RAM Report - IDE for Zephyr: Run RAM Report
 - DTSh Shell - IDE for Zephyr: Start DTSh Shell

## Extension Pack
The IDE for Zephyr Extension also integrates with a handful of extensions and is released as an [extension pack](https://marketplace.visualstudio.com/items?itemName=mylonics.zephyr-ide-extension-pack). With the extension pack, C++ and DeviceTree intellisense is available. A Kconfig GUI is also available.
- Cortex-Debug - ARM Cortex-M GDB Debugger support for VSCode
- C/C++ - C/C++ IntelliSense, debugging, and code browsing.
- Serial Monitor - Send and receive text from serial ports.
- Devicetree LSP - Devicetree Language Server
- CMake - Intellisense for CMake Files

## Known Issues
**Dev containers with WSL and Windows folders**: When using dev containers in a WSL environment, ensure your workspace folder is located within the Ubuntu file system (e.g., `/home/username/project`) rather than in mounted Windows directories (e.g., `/mnt/c/Users/...`).

## Available Commands

IDE for Zephyr provides the following commands accessible via the command palette (Ctrl+Shift+P or Cmd+Shift+P):

### Setup and Workspace Management
- `IDE for Zephyr: Workspace Setup` - Open workspace setup picker
- `IDE for Zephyr: Setup Workspace from Git` - Clone and setup workspace from Git repository
- `IDE for Zephyr: Setup West Workspace from Git` - Clone and setup West workspace from Git
- `IDE for Zephyr: Setup Workspace from Current Directory` - Initialize current directory as workspace
- `IDE for Zephyr: Setup Standard Workspace` - Create new standard workspace
- `IDE for Zephyr: Setup West Environment` - Setup West environment
- `IDE for Zephyr: West Init` - Initialize West workspace
- `IDE for Zephyr: West Update` - Update West workspace
- `IDE for Zephyr: West List` - List west workspace modules
- `IDE for Zephyr: West Config` - Configure West settings
- `IDE for Zephyr: Reset Workspace` - Reset workspace configuration
- `IDE for Zephyr: Open Setup Panel` - Open the setup panel interface
- `IDE for Zephyr: Create New West Workspace` - Create new West workspace
- `IDE for Zephyr: Refresh West Workspaces` - Refresh workspace list
- `IDE for Zephyr: Select Existing West Workspace` - Select from existing workspaces
- `IDE for Zephyr: Manage Workspace Installations` - Manage workspace installations
- `IDE for Zephyr: Mark West as Ready` - Mark West workspace as ready
- `IDE for Zephyr: Set Workspace Settings` - Configure workspace settings
- `IDE for Zephyr: Reset Zephyr Install Selection` - Reset Zephyr installation selection
- `IDE for Zephyr: Print Workspace Structure` - Print workspace structure to console

### Host Tools and SDK Management
- `IDE for Zephyr: Host Tools Installation` - Open host tools installation panel
- `IDE for Zephyr: Install Host Tools` - Install required host tools
- `IDE for Zephyr: Setup Check Build Dependencies Available` - Check build dependencies
- `IDE for Zephyr: Install SDK` - Install Zephyr SDK
- `IDE for Zephyr: Reinitialize DTS Language Server` - Reinitialize DTS language server

### Project Management
- `IDE for Zephyr: Add Project` - Add existing project
- `IDE for Zephyr: Create Project From Template` - Create new project from template
- `IDE for Zephyr: Remove Project` - Remove project
- `IDE for Zephyr: Set Active Project` - Set active project
- `IDE for Zephyr: Clear Projects` - Clear all projects
- `IDE for Zephyr: Load Projects From File` - Load projects from zephyr-ide.json
- `IDE for Zephyr: Save Projects To File` - Save projects to zephyr-ide.json
- `IDE for Zephyr: Add Project KConfig Files` - Add KConfig files to project
- `IDE for Zephyr: Remove Project KConfig Files` - Remove KConfig files from project
- `IDE for Zephyr: Add Project Overlay Files` - Add overlay files to project
- `IDE for Zephyr: Remove Project Overlay Files` - Remove overlay files from project

### Build Configuration Management
- `IDE for Zephyr: Add Build Configuration` - Add new build configuration
- `IDE for Zephyr: Remove Build` - Remove build configuration
- `IDE for Zephyr: Set Active Build` - Set active build configuration
- `IDE for Zephyr: Add Build KConfig Files` - Add KConfig files to build
- `IDE for Zephyr: Remove Build KConfig Files` - Remove KConfig files from build
- `IDE for Zephyr: Add Build Overlay Files` - Add overlay files to build
- `IDE for Zephyr: Remove Build Overlay Files` - Remove overlay files from build
- `IDE for Zephyr: Modify Build Arguments` - Modify build arguments

### Runner Management
- `IDE for Zephyr: Add Runner` - Add runner to build configuration
- `IDE for Zephyr: Remove Runner` - Remove runner from build configuration
- `IDE for Zephyr: Set Active Runner` - Set active runner

### Build and Flash Operations
- `IDE for Zephyr: Build Pristine` - Build with pristine flag (clean build)
- `IDE for Zephyr: Build` - Build active project
- `IDE for Zephyr: Clean` - Clean build artifacts
- `IDE for Zephyr: Flash` - Flash build to target device

### Debug Operations
- `IDE for Zephyr: Debug` - Start debugging session
- `IDE for Zephyr: Debug Attach` - Attach debugger to running target
- `IDE for Zephyr: Build and Debug` - Build and start debugging
- `IDE for Zephyr: Change Debug Launch Configuration For Build` - Change debug launch configuration
- `IDE for Zephyr: Change Build and Debug Launch Configuration For Build` - Change build and debug launch configuration
- `IDE for Zephyr: Change Debug Attach Launch Configuration For Build` - Change debug attach launch configuration

### Configuration and Analysis Tools
- `IDE for Zephyr: Start Menu Config` - Start Kconfig menu configuration
- `IDE for Zephyr: Start GUI Config` - Start Kconfig GUI configuration
- `IDE for Zephyr: Run ROM Report` - Generate ROM usage report
- `IDE for Zephyr: Run RAM Report` - Generate RAM usage report
- `IDE for Zephyr: Start DTSh Shell` - Start devicetree shell

### Testing with Twister
- `IDE for Zephyr: Add Twister Test to Project` - Add Twister test
- `IDE for Zephyr: Remove Twister Test from Project` - Remove Twister test
- `IDE for Zephyr: Set Active Test` - Set active test
- `IDE for Zephyr: Run Test` - Run Twister test
- `IDE for Zephyr: Reconfigure Active Test` - Reconfigure active test
- `IDE for Zephyr: Delete Test Output Directories` - Delete test output directories

### Automatic Project Targeting
- `IDE for Zephyr: Enable Automatic Active Project Targeting` - Enable automatic project targeting based on active file
- `IDE for Zephyr: Disable Automatic Active Project Targeting` - Disable automatic project targeting

### Utility Commands
- `IDE for Zephyr: Show View Container` - Show IDE for Zephyr view container
- `IDE for Zephyr: Reload Web Views` - Reload web view panels
- `IDE for Zephyr: Debug Internal Shell` - Debug internal shell
- `IDE for Zephyr: Shell Test` - Test shell functionality
- `IDE for Zephyr: Print Python Interpreter Path` - Print the Python interpreter path for the active workspace

## Configuration Settings

The following settings are available in VS Code settings (File > Preferences > Settings):

### `zephyr-ide.global_directory`
- **Type**: String or null
- **Default**: null
- **Description**: Manually specify a global directory for west workspace installation and Zephyr tools. Replaces the deprecated `zephyr-ide.tools_directory`.

### `zephyr-ide.tools_directory`
- **Type**: String or null
- **Default**: null
- **Deprecated**: Use `zephyr-ide.global_directory` instead. The extension automatically migrates this setting on startup.

### `zephyr-ide.toolchain_directory`
- **Type**: String or null
- **Default**: null
- **Description**: Manually specify the directory containing Zephyr SDK installations. If not specified, defaults to the `toolchains` subdirectory within the global directory.

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
- `zephyr-ide.get-gdb-path` - Get GDB path (CMAKE_GDB) for the active build
- `zephyr-ide.get-arm-gdb-path` - Get ARM GDB path (without Python support) for the active build
- `zephyr-ide.get-toolchain-path` - Get toolchain path
- `zephyr-ide.get-zephyr-dir` - Get the Zephyr source directory path
- `zephyr-ide.get-zephyr-elf` - Get the full path to the Zephyr kernel ELF file for the active build
- `zephyr-ide.get-zephyr-elf-dir` - Get the directory containing the Zephyr kernel ELF file
- `zephyr-ide.get-zephyr-ide-json-variable` - Get variable from zephyr-ide.json
- `zephyr-ide.get-active-project-variable` - Get custom variable from active project
- `zephyr-ide.get-active-build-variable` - Get custom variable from active build
- `zephyr-ide.get-active-board-name` - Get active board name
