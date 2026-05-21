---
title: Developer Guide
description: Contribute to IDE for Zephyr — development setup, build instructions, testing, debugging, and the release process for the Zephyr RTOS VS Code extension.
---

This guide covers the development setup for the IDE for Zephyr VS Code extension.

## Prerequisites

* Git (https://git-scm.com/)
* Node.js (https://nodejs.org/)
* Visual Studio Code (https://code.visualstudio.com/)

## Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/mylonics/zephyr-ide.git
cd zephyr-ide
```

### 2. Install dependencies

```bash
npm install
```

Run `npm install` again after switching branches, as dependencies may change between revisions.

### 3. Open in VS Code

Open the `zephyr-ide` folder in VS Code.

### 4. Run and debug

Press **F5** (or select **Run → Start Debugging**) with the `Run Extension (zephyr-ide)` configuration. A second VS Code instance opens with the extension loaded.

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
