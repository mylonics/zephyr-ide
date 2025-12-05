---
title: Known Issues and Troubleshooting - Zephyr IDE Common Problems
description: Known issues with Zephyr IDE including dev container WSL issues and workarounds. Learn how to report bugs and get help with Zephyr RTOS development.
keywords: known issues, troubleshooting, WSL issues, dev containers, bug reporting, Zephyr IDE problems, issue resolution
---

# Known Issues

## Dev containers with WSL and Windows folders

When using dev containers in a WSL environment, ensure your workspace folder is located within the Ubuntu file system (e.g., `/home/username/project`) rather than in mounted Windows directories (e.g., `/mnt/c/Users/...`).

This is an issue inherent with the west boards command and affects workspace initialization and board detection.

### Workaround

Move your project to a location within the WSL file system:

```bash
# Instead of /mnt/c/Users/yourname/projects
# Use /home/yourname/projects
```

## Reporting Issues

If you encounter other issues:

1. Check the [GitHub Issues](https://github.com/mylonics/zephyr-ide/issues) to see if it's already reported
2. Create a new issue with:
   - Steps to reproduce
   - Expected behavior
   - Actual behavior
   - VS Code version
   - Zephyr IDE version
   - Operating system

## Next Steps

- [Report an issue on GitHub](https://github.com/mylonics/zephyr-ide/issues)
- [Join discussions](https://github.com/mylonics/zephyr-ide/discussions)
