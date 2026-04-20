.. _ide_for_zephyr:

IDE for Zephyr
##############

`IDE for Zephyr <https://marketplace.visualstudio.com/items?itemName=mylonics.zephyr-ide>`_
(also available on the `Open VSX Registry <https://open-vsx.org/extension/mylonics/zephyr-ide>`_)
is a Visual Studio Code (VS Code) extension that adds
end-to-end Zephyr development support: host tool installation, Zephyr SDK management,
west workspace setup, project and build creation, flashing, and debugging.

Key features
************

* Install native host tools (CMake, Python 3, Ninja, Devicetree Compiler, gcc) following
  the official :ref:`getting_started` guide.
* Install and manage Zephyr SDK toolchains via ``west sdk``.
* Initialize new west workspaces or import existing ones, including external Zephyr
  installations detected through ``ZEPHYR_BASE``.
* Manage multiple west workspaces and switch between them from a single VS Code window.
* Create new applications from Zephyr samples, or add existing applications to a project.
* Multiple build configurations per project, each with its own board, runner, KConfig
  overlay, devicetree overlay, and west / CMake arguments.
* Build, flash, and debug from a status-bar control or the project panel.
* Full Cortex-Debug integration with ready-made launch templates for ST-Link, J-Link,
  OpenOCD, and Black Magic Probe, plus helper commands that resolve project, build,
  ELF, GDB, and toolchain paths from the active build.
* Twister test integration: add, run, and reconfigure tests alongside builds.
* Human-readable ``zephyr-ide.json`` project file that can be committed and shared
  across a team.
* ROM / RAM usage reports, MenuConfig / GuiConfig, and an integrated DTSh devicetree
  shell.

Compatibility
*************

* Windows 11
* Ubuntu/Debian — Other Linux distributions require manual host tool installation.
* macOS

Getting started
***************

#. **Install the extension**

   Install `IDE for Zephyr <https://marketplace.visualstudio.com/items?itemName=mylonics.zephyr-ide>`_
   from the VS Code Marketplace, or from the
   `Open VSX Registry <https://open-vsx.org/extension/mylonics/zephyr-ide>`_.

#. **Open the Setup Panel**

   In the Activity Bar, click the IDE for Zephyr icon. The Setup Panel presents three
   cards: Host Tools, Zephyr SDK Management, and Workspace.

#. **Install host tools**

   Open the *Host Tools* card and click **Install Host Tools**. The extension uses your
   system package manager (``apt``, Homebrew, or Winget) to install the dependencies
   listed in the Zephyr getting started guide.

   .. note::
      Some host tools require administrator privileges. On Linux this is required when
      installing tools through ``apt``; on Windows it may be required for installer
      packages.

   If you already have the host tools installed (for example in a Docker container or a
   manual setup), you can skip this step.

#. **Configure a west workspace**

   Open the *Workspace* card and choose one of:

   * **Standard Workspace** — create a new west workspace in the current folder, with a
     Python virtual environment and a generated ``west.yml`` manifest.
   * **West Workspace from Git** — clone an existing west manifest repository.
   * **IDE for Zephyr Workspace from Git** — clone a project that already ships with an
     IDE for Zephyr configuration.
   * **Open Current Directory** — adopt an existing ``.west`` folder, an existing
     ``west.yml``, or link to an external Zephyr installation via ``ZEPHYR_BASE``.

#. **Install the Zephyr SDK**

   Open the *Zephyr SDK Management* card and select an SDK version and one or more
   target architectures. The extension drives ``west sdk install`` and tracks installed
   versions for you.

#. **Create a new application**

   In the project panel:

   * Click **Add Project** to register an existing application, or **Create Project From
     Template** to copy a Zephyr sample (for example ``samples/basic/blinky``).
   * Click **Add Build Configuration**, pick a board (for example
     ``nucleo_f401re``), and optionally add KConfig and devicetree overlays.
   * Optionally add one or more runners (default, JLink, pyOCD, OpenOCD, …) per build.

#. **Build and flash**

   Use the IDE for Zephyr buttons in the status bar, or the active project panel, to
   run **Build**, **Build Pristine**, **Flash**, or **Clean** for the active build.

#. **Debug**

   Five default launch configurations are provided (Cortex-Debug with ST-Link and Black
   Magic Probe, OpenOCD with ST-Link and nRF52, plus a "Debug Select" picker). Each
   configuration uses helper commands such as ``${command:zephyr-ide.get-zephyr-elf}``,
   ``${command:zephyr-ide.get-toolchain-path}``, and
   ``${command:zephyr-ide.get-active-board-name}`` to follow the active project and
   build automatically.

#. **Run Twister tests** *(optional)*

   Open the test panel (beaker icon), add a Twister test to a project, and run it from
   the same panel. Test configurations behave the same as build configurations.

Useful links
************

* Marketplace listing: https://marketplace.visualstudio.com/items?itemName=mylonics.zephyr-ide
* Open VSX listing: https://open-vsx.org/extension/mylonics/zephyr-ide
* Source repository: https://github.com/mylonics/zephyr-ide
* Documentation: https://zephyr-ide.mylonics.com/
* Sample project: https://github.com/mylonics/zephyr-ide-sample-project
