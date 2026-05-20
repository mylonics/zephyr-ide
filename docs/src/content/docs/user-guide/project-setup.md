---
title: Project Setup
description: Create and manage Zephyr RTOS projects in VS Code — add existing projects, create from templates, configure multiple builds per project, and manage board selections with IDE for Zephyr.
---

To set up a project, the project panel provides the ability to add a preexisting project or to copy a sample project as a starting point.

## Adding a Project

In the following example, the blinky project is added from the Zephyr sample folder. An STM32F4 build is added to the project.

![Adding Projects and Build](https://raw.githubusercontent.com/mylonics/zephyr-ide/main/docs/media/adding_project_and_build.gif)

## Multiple Builds

Each project can have multiple builds associated with it. Each build may also have multiple runners associated with each specific build.

In this example, a Raspberry PI Pico board/build is added to the blinky project. The default runner is added to the original build and the UF2 runner is added to the Pico build.

![Adding More Builds](https://raw.githubusercontent.com/mylonics/zephyr-ide/main/docs/media/adding_additional_build.gif)

## Project Configuration File

The project configuration is stored in a human-readable JSON file, which allows users to manually modify the projects or commit them to a repo to share the workspace with team members.

![Project JSON](https://raw.githubusercontent.com/mylonics/zephyr-ide/main/docs/media/projects_json.png)

## Custom Build Folder

By default, the build output for each build configuration is placed inside the project folder at `<project_dir>/<build_config_name>`. The build config name can contain slashes (e.g. `build/nrf52840dk/nrf52840`), so the default output path in that case would be `apps/sensors/accel_polling/build/nrf52840dk/nrf52840`.

If you need to place build artifacts elsewhere — for example outside the project folder or in a shared directory — you can manually add a `rel_path` field to the build configuration in `.vscode/zephyr-ide.json`. The value must be a path relative to the workspace root; absolute paths are not supported, and parent-directory references (`../`) are only permitted when the fully resolved path still lies within the workspace root.

```json
{
  "projects": {
    "accel_polling": {
      "rel_path": "apps/sensors/accel_polling",
      "name": "accel_polling",
      "buildConfigs": {
        "build/nrf52840dk/nrf52840": {
          "name": "build/nrf52840dk/nrf52840",
          "rel_path": "shared_builds/accel_polling/nrf52840",
          "board": "nrf52840dk/nrf52840"
        }
      }
    }
  }
}
```

In this example the build output will be placed at `<workspace_root>/shared_builds/accel_polling/nrf52840` instead of the default location inside the project folder. This field is not exposed in the UI and must be set manually.

## Next Steps

- [Build and debug your project](building-debugging.md)
- [Add tests with Twister](testing.md)
- [Share your code with your team](sharing.md)
