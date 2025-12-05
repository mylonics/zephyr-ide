# Sharing Your Code

In general, you should commit everything in your workspace folder except for build directories, .venv, .vscode/compile_commands.json and external. A .gitignore is automatically generated that should exclude the relevant files.

## What to Commit

**Recommended to commit**:

- Project source code
- `zephyr-ide.json` - Project and build configurations
- `.vscode/zephyr-ide.json` - Extension-specific settings
- west.yml - Workspace manifest

**Consider case-by-case**:

- `settings.json` - May contain user-specific paths
- `launch.json` - May contain user-specific debug configurations

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

Unfortunately, VSCode does not provide a way for having user-specific settings/configurations per workspace. See this [issue](https://github.com/Microsoft/vscode/issues/15909) on the VSCode repo.

### Using Code Workspace Files

You can also use a `code-workspace.json` file to help manage projects across different machines. This allows for better separation of user-specific and project-wide settings.

## Sample Project

You can have a look at this [sample directory](https://github.com/mylonics/zephyr-ide-sample-project) to also help with getting started with sharing projects.

## Best Practices

1. **Use .gitignore**: The extension automatically generates one, but review it for your needs
2. **Document setup steps**: Include a README with setup instructions
3. **Use relative paths**: Avoid absolute paths in configuration files when possible
4. **Test on clean checkout**: Verify that your project works on a fresh clone

## Next Steps

- [Explore other features](other-features.md)
- [See all available commands](../reference/commands.md)
