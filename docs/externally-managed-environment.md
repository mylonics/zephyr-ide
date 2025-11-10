# Externally Managed Environment Support

This document describes how Zephyr IDE works with externally managed environments, such as Docker containers, pre-configured development environments, or any scenario where Zephyr and its SDK are already installed.

## Overview

Zephyr IDE now automatically detects and uses externally managed Zephyr environments through environment variables. This is particularly useful for:

- Docker/container-based development workflows
- Pre-configured development environments
- DevContainers
- CI/CD pipelines
- Any scenario where Zephyr tools and SDK are already installed and configured externally

## How It Works

### Automatic Environment Detection

When you start VS Code with Zephyr IDE installed:

1. **If no workspace is configured**, Zephyr IDE checks for the `ZEPHYR_BASE` environment variable
2. **If `ZEPHYR_BASE` is set**, the extension automatically creates an environment-based setup state
3. **All Zephyr IDE features work** without requiring workspace setup through the extension

The detection happens automatically - no configuration is needed!

### What Gets Detected

The extension reads these environment variables:
- `ZEPHYR_BASE` - Path to your Zephyr installation (required)
- `ZEPHYR_SDK_INSTALL_DIR` - Path to your Zephyr SDK installation (optional)

When `ZEPHYR_BASE` is detected:
- The extension assumes `west` is already set up (`westUpdated: true`)
- The extension assumes packages are installed (`packagesInstalled: true`)
- All build, flash, and debug operations work with your existing tools

### Visual Feedback

When using an environment-based setup:

1. Open the **West Workspaces** panel in the Zephyr IDE sidebar
2. You'll see an **"Environment Setup"** entry with:
   - A namespace icon (⊞)
   - Description showing "Using environment variables" or Zephyr version if detected
   - Tooltip displaying your `ZEPHYR_BASE` path
   - Entry is marked as selected/active

![Environment Setup in West Workspaces Panel](media/environment-setup-panel.png)

## Use Cases

### Docker/DevContainer Workflow

```dockerfile
# Dockerfile
FROM zephyrprojectrtos/ci:latest

# Set Zephyr environment variables
ENV ZEPHYR_BASE=/workspaces/zephyrproject/zephyr
ENV ZEPHYR_SDK_INSTALL_DIR=/opt/toolchains/zephyr-sdk
```

When you open VS Code in this container, Zephyr IDE automatically detects and uses these paths. No additional configuration needed!

### Pre-configured Environment

If you have a custom Zephyr installation:

1. Set environment variables in your shell profile (`.bashrc`, `.zshrc`, etc.):
   ```bash
   export ZEPHYR_BASE=/path/to/zephyrproject/zephyr
   export ZEPHYR_SDK_INSTALL_DIR=/path/to/zephyr-sdk
   ```

2. Start VS Code from a terminal that has these variables set:
   ```bash
   code /path/to/your/project
   ```

3. Zephyr IDE automatically detects and uses your environment - no setup needed!

### CI/CD Pipeline

In GitHub Actions or other CI systems:

```yaml
env:
  ZEPHYR_BASE: ${{ github.workspace }}/zephyr
  ZEPHYR_SDK_INSTALL_DIR: /opt/zephyr-sdk
steps:
  - uses: actions/checkout@v3
  - name: Build with Zephyr IDE
    run: |
      # Zephyr IDE commands work automatically
      # with environment variables set
```

## Workspace Setup vs Environment Setup

### Traditional Workspace Setup
- Managed by Zephyr IDE
- West environment created in selected folder
- SDK installed through IDE
- Configuration saved in workspace

### Environment-Based Setup (New)
- **Automatically detected** from `ZEPHYR_BASE`
- Uses your existing Zephyr installation
- No IDE-managed workspace needed
- Works immediately when environment is set

You can still use workspace setup if you prefer IDE-managed environments!

## Suppressing the Environment Warning

If you don't have `ZEPHYR_BASE` set and don't want to see the warning on startup:

1. When the warning appears, click **"Don't Show Again"**
2. Or manually add to `.vscode/settings.json`:
   ```json
   {
     "zephyr-ide.suppress-workspace-warning": true
   }
   ```

## Troubleshooting

### Environment Variables Not Detected

**Problem**: Zephyr IDE doesn't detect your environment variables.

**Solution**:
1. Verify environment variables are set in your current shell:
   ```bash
   echo $ZEPHYR_BASE
   echo $ZEPHYR_SDK_INSTALL_DIR
   ```

2. **Important**: VS Code must be started from a terminal/shell that has these variables set. Environment variables set in your shell config (`.bashrc`, `.zshrc`) are only available to processes started from that shell.

3. Restart VS Code after setting environment variables.

### Zephyr Tools Not Found

**Problem**: Build or flash commands fail with "tool not found" errors.

**Solution**:
1. Verify `ZEPHYR_BASE` points to a valid Zephyr installation:
   ```bash
   ls $ZEPHYR_BASE/VERSION
   ```

2. Ensure west and build tools are available:
   ```bash
   which west
   which cmake
   which ninja
   ```

3. If using a virtual environment, ensure it's activated before starting VS Code.

### Switching Between Environment and Workspace Setup

You can use both:
- **Environment setup** when `ZEPHYR_BASE` is set and no workspace is configured
- **Workspace setup** by selecting a workspace from the West Workspaces panel

To switch from environment to workspace:
1. Open West Workspaces panel
2. Click "Set as Active" on a different workspace
3. The environment setup will no longer be used

To switch back to environment:
1. Open West Workspaces panel  
2. Click "Deselect Workspace" on the active workspace
3. If `ZEPHYR_BASE` is set, environment setup will be used automatically

## Technical Details

### Implementation

- The `getSetupState()` function checks for `activeSetupState` first
- If not found, it calls `checkAndWarnMissingEnvironment()` to notify the user
- Then calls `getEnvironmentSetupState()` which reads `ZEPHYR_BASE`
- Returns a valid `SetupState` that works with all existing code
- No code changes needed in build, flash, or debug functions

### Setup State Properties

When using environment-based setup, the `SetupState` object has:
```typescript
{
  pythonEnvironmentSetup: false,
  westUpdated: true,           // Assumes west is set up
  packagesInstalled: true,     // Assumes packages installed
  zephyrDir: process.env.ZEPHYR_BASE,
  zephyrVersion: undefined,    // Detected if possible
  env: {},
  setupPath: path.dirname(ZEPHYR_BASE)
}
```

## See Also

- [Main Documentation](../README.md)
- [User Manual](MANUAL.md)
- [Developer Guide](developer-guide.md)
- [Issue #221](https://github.com/mylonics/zephyr-ide/issues/221)

