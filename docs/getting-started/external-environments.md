---
title: Use External Zephyr Environments - Docker, DevContainer, Manual Installations
description: Integrate Zephyr IDE with externally managed environments. Works with Docker, DevContainer, manual installations, and existing Zephyr setups via ZEPHYR_BASE detection.
keywords: external Zephyr environment, Docker Zephyr, DevContainer, ZEPHYR_BASE, manual installation, environment variables, existing workspace
---

# Using Externally Managed Environments

Zephyr IDE automatically detects and works with externally managed Zephyr environments.

If you already have Zephyr installed outside of Zephyr IDE (e.g., through Docker, a DevContainer, manual installation, or another workspace manager), the extension will automatically detect and use your existing installation through environment variables.

## How It Works

When Zephyr IDE starts and no workspace is actively configured:

1. **Automatic Detection**: The extension checks for the `ZEPHYR_BASE` environment variable
2. **Environment Warning**: If neither `ZEPHYR_BASE` nor `ZEPHYR_SDK_INSTALL_DIR` is set, a warning appears with three options:
   - **Continue**: Proceed using system environment variables (commands may still work if tools are in PATH)
   - **Don't Show Again**: Suppress this warning for the current workspace
   - **Setup Workspace**: Open the Setup Panel to configure a workspace

When `ZEPHYR_BASE` is set, the extension:

- Assumes west and required packages are already installed in the environment
- Uses the detected Zephyr installation for all build operations
- Allows all commands (build, flash, debug) to run without workspace-specific configuration
- Shows a warning if environment variables are missing (unless suppressed with the setting above)

## Setting Up Environment Variables

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

3. Verify: All Zephyr IDE commands will use your environment-based setup

## Suppressing the Environment Warning

If you prefer to work without setting `ZEPHYR_BASE` (e.g., using west commands directly), you can suppress the warning:

**Option 1**: Click "Don't Show Again" when the warning appears

**Option 2**: Manually add to `.vscode/settings.json`:
```json
{
  "zephyr-ide.suppress-workspace-warning": true
}
```

This setting prevents the warning from appearing, allowing you to work with system tools without additional prompts.

## Use Cases

Externally managed environments are suitable for:

- **Docker/DevContainer workflows**: Environment variables are pre-configured in your container
- **CI/CD pipelines**: Build with pre-installed Zephyr in automated environments
- **Shared development environments**: Teams using a common Zephyr installation
- **Manual installations**: You have installed Zephyr following the official Zephyr Getting Started guide
- **Multiple projects**: Share one Zephyr installation across multiple project workspaces

## Next Steps

- [Set up your first project](../user-guide/project-setup.md)
- [Learn about configuration settings](../reference/configuration.md)
