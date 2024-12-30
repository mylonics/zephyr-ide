#  Zephyr IDE User Manual

<img src="https://raw.githubusercontent.com/mylonics/zephyr-ide/main/docs/media/zephyr-ide_branding.png" alt="Zephyr IDE for Visual Studio Code" width="50%"/>

To get started install the extension from [visual studio code marketplace](https://marketplace.visualstudio.com/items?itemName=mylonics.zephyr-ide)

Open the extension in a workspace folder. \
Under the extension setup panel you will be presented with a few options on which folder to setup Zephyr/West in:

![New Workspace](https://raw.githubusercontent.com/mylonics/zephyr-ide/main/docs/media/new_workspace.png)

- **Workspace** - Use this option to setup west and install Zephyr into the current workspace directory.\
- **Global** - Use this option if you want to use a global Zephyr setup located in the Zephyr IDE folder \
- **External** - Use this option if you have Zephyr setup in another directory and want to use that  

The folder selected will house the west.yml, .west folder, zephyr folder and python environment.

Once the setup location is selected, the IDE will then provide a series of commands to run.

![Extension Setup](https://raw.githubusercontent.com/mylonics/zephyr-ide/main/docs/media/extension_setup.png)

Each command may be run individually or triggered all at once with the Initialize Workspace button.

### Check Build Dependencies
This command checks if the appropriate build dependencies are installed.

For this application to work correctly the Zephyr required build tools must be installed and available on the path. These include cmake, python3, and Devicetree Compiler. 

See the [Install Dependencies Section of the Zephyr Getting Started Guide](https://docs.zephyrproject.org/latest/develop/getting_started/index.html#install-dependencies)

For ubuntu please also install python3-venv by ```sudo apt install python3-venv```

For macos there have been some reports of the python virtual environment not being enabled with zsh. It may be necessary to install the "Python Environment Manager" extension. That extension automatically automatically enables the python venv if the ".venv folder exist.

### Setup West Environment
This creates the python environment and installs west.
### Install SDK
This command allows the user to specify which SDK to install. If you are new and unsure which one you need you should select the latest and you can select all available SDKs.
This command only needs to be done once per computer.
### West Init
This command creates/uses a west.yml file or clones a git repository to setup the folder. 
This command provides a menu to help you choose what you to install with Zephyr. A full install will have all the features but will take longer to download, so a minimal install is recommended.

![West Init](https://raw.githubusercontent.com/mylonics/zephyr-ide/main/docs/media/west_init.png)

The folder structure now will look like this:

![West Structure](https://raw.githubusercontent.com/mylonics/zephyr-ide/main/docs/media/west_structure.png)

The command has created a west.yml file in the application folder. In this example, it is a minimal file that supports STM32 and RPI Pico. In addition, the Zephyr install will be in the external folder as seen by path-prefix. The west init command has also been run as seen by the .west folder and .west/config file being present.
### West Update
This command will install the remaining python requirements and clones the remote repository into the location.


## Setting Up A Project
To setup a project the project panel provides the ability to add a preexisting project or to copy a sample project as a starting point. In the following example, the blinky project is added from the Zephyr sample folder. To the project, an STM32F4 build is added. 

![Adding Projects and Build](https://raw.githubusercontent.com/mylonics/zephyr-ide/main/docs/media/adding_project_and_build.gif)

Each project can have multiple builds associated with it. Each build may also have multiple runners associated with each specific build. In this case, a Raspberry PI Pico board/build is added to the blinky project. The default runner is added to the original build and the UF2 runner is added to the Pico build.

![Adding More Builds](https://raw.githubusercontent.com/mylonics/zephyr-ide/main/docs/media/adding_additional_build.gif)

The project configuration is stored in a human-readable JSON, which allows users to manually modify the projects or commit them to a repo to share the workspace with team members.

![Project JSON ](https://raw.githubusercontent.com/mylonics/zephyr-ide/main/docs/media/projects_json.png)

## Building/Debugging A Project
The project may now be built. This can be done with the Active Project Panel or Taskbar buttons. There are options to build pristine, build, flash and debug. The taskbar also displays the active project.

![Taskbar Buttons](https://raw.githubusercontent.com/mylonics/zephyr-ide/main/docs/media/taskbar_buttons.gif)

To debug, launch configurations need to be setup. By default, Zephyr IDE provides two examples using cortex-debug and a blackmagic probe. These are the Debug and Attach configurations. A third example is also available called the Debug Select Configuration.

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

## Sharing your Code
In general you should commit everything in your workspace folder, except for build directories, .venv, .vscode/compile_commands.json and external. A .gitignore is automatically generated that should exclude the relevant files. Settings.json and launch.json may be committed on a case by case basis depending on user descretion.
If you are trying to share a non-local workspace then committing settings.json, is not advisable as some variables may change. Unfortunately, VSCode does not provide a way for having user specific settings/configurations per workspace. See this [issue](https://github.com/Microsoft/vscode/issues/15909) on the VSCode repo.
You can also try to use a code-workspace.json file to help manage projects across different machines.

You can have a look at this [sample directory](https://github.com/mylonics/zephyr-ide-sample-project) to also help with getting started with sharing projects.

## Other Features
The Zephyr Menu Config may be run from the active project panel. Each debug target may be bound to a custom launch configuration (by default they use "Zephyr IDE: Debug" and "Zephyr IDE: Attach")

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
- nRF DeviceTree - Full DeviceTree language support for the Zephyr project
- nRF Kconfig - Kconfig language support for the Zephyr Project 
- CMake - Intellisense for CMake Files
