# GitHub Workflows for Zephyr IDE

This directory contains automated workflows for building, testing, and releasing the Zephyr IDE VS Code extension.

## Release Workflows

### Simplified Release Process

The release process has been consolidated into a streamlined workflow that requires only one manual action.

#### Workflows Overview

1. **`bump-version.yml`** - Manual workflow to bump version and optionally trigger a release
   - **Trigger**: Manual (workflow_dispatch)
   - **Inputs**:
     - `bump_type`: patch, minor, or major
     - `release_type`: none, release, or prerelease
   - **Actions**:
     - Bumps version in package.json
     - Creates a PR to `develop` branch with auto-merge enabled (SQUASH)
     - Tags the PR title with `[release]` or `[prerelease]` if specified

2. **`auto-create-release-pr.yml`** - Automatic workflow triggered when version is bumped
   - **Trigger**: Push to `develop` branch
   - **Actions**:
     - Detects release type from commit message tag (`[release]` or `[prerelease]`)
     - Creates a PR from `develop` to `main` (release) or `pre-release` (prerelease)
     - Enables auto-merge with REBASE method
     - Skips if PR already exists or no release tag is found

3. **`release.yml`** - Automatic workflow for publishing the extension
   - **Trigger**: Push to `main` or `pre-release` branches
   - **Actions**:
     - Builds the extension
     - Publishes to VS Code Marketplace
     - Publishes to Open VSX Registry
     - Creates GitHub release with release notes

#### Release Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. Developer triggers "Bump Version" workflow                   │
│    - Selects bump type (patch/minor/major)                     │
│    - Selects release type (none/release/prerelease)            │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. bump-version.yml workflow runs                               │
│    - Bumps version in package.json                             │
│    - Creates PR to develop branch                              │
│    - PR title: "feat: Bump version to X.Y.Z [release]"         │
│    - Auto-merge enabled (SQUASH)                               │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. PR auto-merges to develop (after CI passes)                  │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│ 4. auto-create-release-pr.yml workflow triggers                 │
│    - Detects [release] or [prerelease] tag in commit           │
│    - Creates PR from develop to main/pre-release               │
│    - Auto-merge enabled (REBASE)                               │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│ 5. PR auto-merges to main/pre-release (after CI passes)        │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│ 6. release.yml workflow triggers                                │
│    - Builds extension                                           │
│    - Publishes to VS Code Marketplace                          │
│    - Publishes to Open VSX Registry                            │
│    - Creates GitHub release                                    │
└─────────────────────────────────────────────────────────────────┘
```

### Other Workflows

- **`workspace-setup-tests.yml`** - Runs all 5 workspace setup type tests on Ubuntu
  - **Trigger**: PRs to main/pre-release (always), PRs to develop (with `test-all-workspaces` label), push to develop (on version bump)
  - **Manual Trigger**: Can be triggered manually with optional `branch` input
  - **Actions**: Runs all workspace setup test suites (standard, west-git, zephyr-ide-git, local-west, external-zephyr)

- **`basic-tests.yml`** - Fast Ubuntu-only platform integration test for every PR
  - **Trigger**: Pull requests to develop
  - **Manual Trigger**: Can be triggered manually with optional `branch` input
  - **Actions**: Builds VSIX, runs platform integration test on Ubuntu
  - **Purpose**: Fast CI gate for every PR

- **`multiplatform-tests.yml`** - Multi-platform integration test for releases
  - **Trigger**: Pull requests to main/pre-release, pushes to main/pre-release
  - **Manual Trigger**: Can be triggered manually with optional `branch` input
  - **Platforms**: Ubuntu, Windows, macOS 15 (all three)
  - **Actions**: Builds VSIX, runs platform integration test on all platforms
  - **Purpose**: Validates cross-platform compatibility before releases

- **`_shared-platform-test.yml`** - Reusable workflow shared by basic-tests and multiplatform-tests
  - **Trigger**: Called by other workflows (`workflow_call`)
  - **Actions**: Builds VSIX on Ubuntu, then runs platform integration test on the requested platforms
  - **Purpose**: Eliminates code duplication between basic-tests and multiplatform-tests

- **`deploy-docs.yml`** - Deploys documentation to GitHub Pages
- **`package-artifact.yml`** - Packages the extension as a VSIX file (runs on develop branch)
- **`build-vsix.yml`** - Manually triggered workflow to build VSIX from any branch
  - **Trigger**: Manual (workflow_dispatch)
  - **Inputs**:
    - `branch`: The branch name to build the VSIX from (default: 'main')
  - **Actions**:
    - Checks out the specified branch
    - Builds and packages the extension
    - Uploads VSIX as a downloadable artifact
    - Artifact name includes version, branch, and commit hash for easy identification

## Deprecated Workflows

The following workflows have been removed as their functionality is now integrated into the consolidated release process:

- ~~`make-release.yml`~~ - Replaced by `auto-create-release-pr.yml`
- ~~`make-prerelease.yml`~~ - Replaced by `auto-create-release-pr.yml`

## Contributing

When modifying workflows, please ensure:

1. YAML syntax is valid (use `yamllint` or IDE validation)
2. Workflows pass `actionlint` validation
3. Shell commands follow shellcheck best practices
4. Documentation is updated to reflect changes

## Testing Workflows

To test workflow changes without affecting the main release process:

1. Create a test repository with the same branch structure
2. Copy the modified workflows to the test repository
3. Test the complete flow from version bump to release
4. Verify auto-merge behavior and PR creation logic
