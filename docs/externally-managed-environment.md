# Externally Managed Environment Support

This document describes the new feature that allows Zephyr IDE to work with externally managed environments, such as Docker containers or pre-configured development environments.

## Overview

Zephyr IDE now supports using system environment variables instead of managing them automatically. This is particularly useful for:

- Docker/container-based development workflows
- Pre-configured development environments
- DevContainers
- CI/CD pipelines
- Any scenario where Zephyr tools and SDK are already installed and configured

## Features

### 1. Configuration Setting: `use-system-environment`

You can enable externally managed environment mode by adding this to your `.vscode/settings.json`:

```json
{
  "zephyr-ide.use-system-environment": true
}
```

When enabled, Zephyr IDE will not override the following environment variables:
- `ZEPHYR_BASE`
- `ZEPHYR_SDK_INSTALL_DIR`
- `VIRTUAL_ENV`
- `PATH`

### 2. Externally Managed Workspace Mode

You can also explicitly select "Externally Managed" mode from the West Workspace panel:

1. Open the Zephyr IDE sidebar
2. Navigate to the "West Workspaces" panel
3. Click the target icon next to "Externally Managed"
4. Confirm the switch

Or use the command palette:
- Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on macOS)
- Type "Zephyr IDE: Use Externally Managed West Workspace"
- Press Enter

## How It Works

### Configuration Setting Method

When `use-system-environment` is set to `true`:
- Zephyr IDE clears its environment variable collection
- The extension description shows "Using system environment variables"
- All environment variables (`ZEPHYR_BASE`, `ZEPHYR_SDK_INSTALL_DIR`, etc.) come from the system

### Externally Managed Workspace Method

When you select "Externally Managed" workspace:
- A special setup state is created with `externallyManaged: true`
- The `ZEPHYR_BASE` is read from your system's `ZEPHYR_BASE` environment variable
- All west operations use the system's configured environment
- Build and flash operations work with your existing tools

## Use Cases

### Docker/DevContainer Workflow

```dockerfile
# Dockerfile
FROM zephyrprojectrtos/ci:v0.26.6

ENV ZEPHYR_BASE=/workspaces/zephyrproject/zephyr
ENV ZEPHYR_SDK_INSTALL_DIR=/opt/toolchains/zephyr-sdk-0.16.8
```

`.vscode/settings.json`:
```json
{
  "zephyr-ide.use-system-environment": true
}
```

### Pre-configured Environment

If you have a custom Zephyr installation:

1. Set environment variables in your shell profile:
   ```bash
   export ZEPHYR_BASE=/path/to/zephyrproject/zephyr
   export ZEPHYR_SDK_INSTALL_DIR=/path/to/zephyr-sdk-0.16.8
   ```

2. Choose one of:
   - Enable `use-system-environment` in settings
   - Select "Externally Managed" from West Workspaces panel

### CI/CD Pipeline

In GitHub Actions or other CI systems:

```yaml
env:
  ZEPHYR_BASE: ${{ github.workspace }}/zephyr
  ZEPHYR_SDK_INSTALL_DIR: /opt/zephyr-sdk
```

Then enable `use-system-environment` in your settings.

## Migration from Managed to Externally Managed

If you're currently using Zephyr IDE's managed environment and want to switch:

1. Note your current `ZEPHYR_BASE` and `ZEPHYR_SDK_INSTALL_DIR` paths
2. Set these as system environment variables
3. Enable `use-system-environment` setting or select "Externally Managed"
4. Restart VS Code to apply changes

## Troubleshooting

### Environment Variables Not Found

If you see errors about missing Zephyr tools:

1. Verify environment variables are set:
   ```bash
   echo $ZEPHYR_BASE
   echo $ZEPHYR_SDK_INSTALL_DIR
   ```

2. Ensure the paths exist and contain valid Zephyr installations

3. Restart VS Code after setting environment variables

### Switching Back to Managed Mode

To return to Zephyr IDE's managed environment:

1. Disable `use-system-environment` in settings, or
2. Select a different workspace from the West Workspaces panel
3. Restart VS Code

## Technical Details

- The `ZEPHYR_SDK_INSTALL_DIR` update is now only performed when a managed setup state exists
- A new `externallyManaged` flag in `SetupState` interface identifies external environments
- The `generateExternallyManagedSetupState()` function creates a valid setup state that works with existing code
- All existing checks for `activeSetupState` remain compatible

## See Also

- [Main Documentation](../README.md)
- [Manual](MANUAL.md)
- [Issue #86](https://github.com/mylonics/zephyr-ide/issues/86)
