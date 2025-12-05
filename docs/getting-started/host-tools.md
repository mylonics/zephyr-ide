# Host Tools Setup

![Host Tools Installation](https://raw.githubusercontent.com/mylonics/zephyr-ide/main/docs/media/host_tool_install.png)

Click the Host Tools card to access the Host Tools sub-page. This page helps you install and verify the build dependencies required for Zephyr development.

## Checking Installed Tools

The extension verifies that required build dependencies are available on your PATH, including:

- **CMake** - Build system
- **Python3** - Scripting and tools
- **Devicetree Compiler (DTC)** - Device tree compilation
- **gcc** - Compiler

## Automated Installation

On supported platforms, the extension can automatically install missing dependencies using your system's package manager.

To install missing tools:

1. Click the **Host Tools** card in the Setup Panel
2. Review the list of detected and missing tools
3. Click **Install Host Tools** button
4. The extension will use your system's package manager to install missing tools

## Manual Installation

For unsupported platforms or if you prefer manual installation, follow the [Zephyr Getting Started Guide](https://docs.zephyrproject.org/latest/develop/getting_started/index.html#install-dependencies) to install the required dependencies.

## Supported Platforms

Automated installation is supported on:

- **Ubuntu/Debian** - Uses apt package manager
- **macOS** - Uses Homebrew
- **Windows** - Uses Chocolatey or manual downloads

## Next Steps

After installing host tools:

- [Configure your Workspace](workspace-configuration.md)
- [Install the Zephyr SDK](sdk-installation.md)
