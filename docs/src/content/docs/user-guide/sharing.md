---
title: Sharing Zephyr Projects
description: Best practices for sharing Zephyr RTOS projects with Git. Commit zephyr-ide.json to version control so teammates reproduce the exact same SDK toolchains, west workspace, builds, runner profiles, and KConfig overlays — no manual setup required.
---

In general, you should commit everything in your workspace folder except for build directories, .venv, .vscode/compile_commands.json and external. A .gitignore is automatically generated that should exclude the relevant files.

## What to Commit

**Recommended to commit**:

- Project source code
- `.vscode/zephyr-ide.json` - Project/build/test configurations, runner profiles, and optional `toolchains` / `sdkVersion` / `blobs` / `pipPackages` / `pipRequirements` workspace requirements (auto-installed during workspace setup)
- `west.yml` / `.west/` - Workspace manifest and west configuration

**Consider case-by-case**:

- `.vscode/settings.json` - May contain user-specific paths
- `.vscode/launch.json` - May contain user-specific debug configurations

**Do NOT commit**:

- Build directories (build/, build-*)
- `.venv/` - Python virtual environment
- `.vscode/compile_commands.json` - Auto-generated
- `external/` - Downloaded dependencies
- `zephyr/` - Downloaded Zephyr source (managed by west)
- `modules/` - Downloaded modules (managed by west)

## Working with Teams

### Local vs Non-Local Workspaces

If you are trying to share a non-local workspace, then committing settings.json is not advisable as some variables may change between machines.

VS Code does not provide per-user workspace settings — see this [issue](https://github.com/Microsoft/vscode/issues/15909) on the VS Code repo.

### Per-developer Runner Profile Overrides

Even when `.vscode/zephyr-ide.json` is committed, each developer may need to use a different probe or runner (e.g. one person has a J-Link, another has an OpenOCD ST-Link). Zephyr IDE supports this with a **local override** layer that is stored only in VS Code's per-workspace state and is never written to any file on disk:

1. Click **Profile…** in the Project Build panel (or run `Zephyr IDE: Select Active Runner Profile`) to choose your own profile without touching the committed JSON. The status bar adds a `*` suffix and tree views show `(local)` so it is always clear when a local override is active.
2. If only a specific slot needs a different runner, click **Local Bind…** next to that slot and pick a runner directly. This takes priority over the active profile's slot bind.
3. When you want to share your configuration with the team, open the **Runner Profile Panel** (**Manage…** button) and choose **Update profile with local changes** or **Create new profile from local changes**.

See [Local Overrides](building-debugging.md#local-overrides-per-developer) for the full workflow.

### Using Code Workspace Files

You can also use a `.code-workspace` file to help manage projects across different machines. The workspace folder containing your project must be added to the workspace via the `.code-workspace` file for the extension to detect it correctly.

Note that `.code-workspace` files should **not** be committed to version control if you are using it for local use settings.

## Sample Project

You can have a look at this [sample directory](https://github.com/mylonics/zephyr-ide-sample-project) to also help with getting started with sharing projects.

## Best Practices

1. **Use .gitignore**: The extension automatically generates one, but review it for your needs
2. **Document setup steps**: Include a README with setup instructions
3. **Use relative paths**: Avoid absolute paths in configuration files when possible
4. **Test on clean checkout**: Verify that your project works on a fresh clone

For the complete field reference (including non-GUI fields like build `relPath`), see [`.vscode/zephyr-ide.json` reference](../reference/configuration.md#vscodezephyr-idejson-reference).

## Next Steps

- [Explore other features](other-features.md)
- [See all available commands](../reference/commands.md)
