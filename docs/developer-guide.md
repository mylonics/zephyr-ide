---
title: Developer Guide - Contributing to Zephyr IDE VS Code Extension
description: Learn how to contribute to Zephyr IDE. Development setup, build instructions, testing, and guidelines for extending the VS Code extension for Zephyr RTOS.
keywords: developer guide, contributing, VS Code extension development, Zephyr IDE development, build from source, extension testing, open source contribution
hide:
  - navigation
---

# Developer's Guide

This guide covers the development setup for the Zephyr IDE VS Code extension.

## Related Documentation

For more developer documentation, please visit the [GitHub repository](https://github.com/mylonics/zephyr-ide).

## Prerequisites

* Git (https://git-scm.com/)
* Node.js (https://nodejs.org/)
* Visual Studio Code (https://code.visualstudio.com/)

## Getting Started

### 1. Clone git repository

* Clone this git repository in the current directory of your choice using:
```
git clone https://github.com/mylonics/zephyr-ide.git
```

### 2. Install package dependencies

* Change directories to the `zephyr-ide` directory cloned in Step 1:
```
cd zephyr-ide
```

* Install all the required packages locally to `zephyr-ide/node_modules` using:
```
npm install
```

* (Optional) Install all the required packages globally using:
```
npm install -g
```
This eliminates the need to reinstall packages after a `git clean` of this directory, or any future `git clone` of this repository.


It is recommended that you run `npm install [-g]` again after switching git checkouts, as the required packages may have changed between revisions.

### 3. Open the Extension in VS Code

* Run Visual Studio Code, and close any existing workspaces.
* Select 'File'->'Add Folder to Workspace...' from the top menu bar
* Browse and select to the `zephyr-ide` directory that was cloned in Step 1.

### 4. Run and Debug in VS Code

* Use the Explorer view to open the source file `zephyr-ide/src/extension.ts`
* Run the extension and start debugging:
    - Select 'Run'->'Start Debugging (F5)' from the top menu bar, or
    - Use the Run and Debug view, and click the green 'Start Debugging (F5)' button next to the configuration 'Run Extension (zephyr-ide)'
* A separate VS Code instance will launch to allow you to start debugging the Zephyr IDE extension.

---
## Publishing

The release process has been streamlined to require only one GitHub Action to be triggered.

### Release Process

1. **Trigger the Bump Version Workflow**
   - Navigate to Actions → "Bump Version" in the GitHub repository
   - Click "Run workflow"
   - Select the **bump type** (patch, minor, or major)
   - Select the **release type**:
     - `none` - Only bump version (no release)
     - `release` - Create a full release to the main branch
     - `prerelease` - Create a pre-release to the pre-release branch

2. **Automated Steps**
   - A PR is created to merge the version bump into the `develop` branch with auto-merge enabled (SQUASH)
   - After the PR is merged to `develop`, if a release type was specified:
     - The workflow automatically creates a PR from `develop` to `main` (for release) or `pre-release` (for prerelease)
     - Auto-merge is enabled on this PR (REBASE)
   - When the release PR is merged, the extension is automatically published to:
     - VS Code Marketplace
     - Open VSX Registry

### Manual Publishing (Not Recommended)

For emergency releases or testing, you can manually publish using vsce:

#### Pre-release
```bash
vsce publish --pre-release patch
```

#### Full Release
```bash
vsce publish patch
```

**Note:** Manual publishing is not recommended as it bypasses the automated workflow and may lead to inconsistencies.