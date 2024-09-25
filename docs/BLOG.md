#  Zephyr IDE - A Visual Studio Code Extension for Zephyr Projects

Developing applications for the Zephyr Project can be daunting, especially for beginners. The Zephyr build system utilizes the command line to perform tasks and has no stand-alone IDE. This makes it a bit tedious to quickly perform tasks especially when dealing with multiple projects and keeping track of all the specific commands for each project. Some IDEs, like visual studio code, provide a generic task interface to aide the user, but still, these need to be manually set up. Mylonics Zephyr IDE for Visual Studio Code is an open-source visual studio code extension that removes most of the headache when dealing with the Zephyr build system.

<img src="https://raw.githubusercontent.com/mylonics/zephyr-ide/main/docs/media/zephyr-ide_branding.png" alt="Zephyr IDE for Visual Studio Code" width="50%"/>


# Getting Started
## Install Zephyr IDE
To get started install the extension from the [visual studio code marketplace](https://marketplace.visualstudio.com/items?itemName=mylonics.zephyr-ide)

## Install Zephyr Project Build Dependencies
For the extension to work correctly, the Zephyr required build tools must be installed and available on the path. These include cmake, python3, and Devicetree Compiler. 

See the [Install Dependencies Section of the Zephyr Getting Started Guide](https://docs.zephyrproject.org/latest/develop/getting_started/index.html#install-dependencies)

For ubuntu please also install python3-venv by ```sudo apt install python3-venv```

## Setting Up the Extension
Open the extension in a workspace folder and press initialize workspace. This will guide you through the full process of creating a python environment, installing west, installing python dependencies, installing the Zephyr SDK, creating a west workspace and cloning in the Zephyr repository.


![Extension Setup](https://raw.githubusercontent.com/mylonics/zephyr-ide/main/docs/media/extension_setup.png)

# Creating A Project
Now that the extension has been installed you can go ahead and create a project. 
To set up a project the project panel provides the ability to add a preexisting project or to copy a sample project as a starting point. In the following example, the blinky project is added from the Zephyr sample folder. To that newly created project, an STM32F4 board/build is added.

![Adding Projects and Build](https://raw.githubusercontent.com/mylonics/zephyr-ide/main/docs/media/adding_project_and_build.gif)

Each project can have multiple builds associated with it. Each build may also have multiple runners associated with each specific build. 

# Building/Debugging/Flashing A Project
The project may now be built. This can be done with the Active Project Panel or Taskbar buttons. There are options to build pristine, build, flash and debug. The taskbar also displays the active project.

![Taskbar Buttons](https://raw.githubusercontent.com/mylonics/zephyr-ide/main/docs/media/taskbar_buttons.gif)


# Additional Features
The Zephyr IDE Extension also integrates with a handful of extensions and is released as an [extension pack](https://marketplace.visualstudio.com/items?itemName=mylonics.zephyr-ide-extension-pack). With the extension pack, C++ and DeviceTree intellisense is available. A Kconfig GUI is also available.
- Cortex-Debug - ARM Cortex-M GDB Debugger support for VSCode
- C/C++ - C/C++ IntelliSense, debugging, and code browsing.
- Serial Monitor - Send and receive text from serial ports.
- nRF DeviceTree - Full DeviceTree language support for the Zephyr project
- nRF Kconfig - Kconfig language support for the Zephyr Project 
- CMake - Intellisense for CMake Files

# Wrap Up

So far in all these steps, no custom commands have been issued by the user to the command line. The Zephyr IDE extension handles everything you need from basic project setup to debugging. Have a look at the full [user manual](https://github.com/mylonics/zephyr-ide/blob/HEAD/docs/MANUAL.md) for more details. 
