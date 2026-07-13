# GitHub Workflows for IDE for Zephyr

This directory contains automated workflows for building, testing, and releasing the IDE for Zephyr VS Code extension.

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
   - **Name**: `Auto: Merge to Release Branch`
   - **Trigger**: PR merged to `develop` branch, or manual `workflow_dispatch`
   - **Actions**:
     - Detects release type from PR title tag (`[release]` or `[prerelease]`)
     - Directly rebases `develop` onto `main` (release) or `pre-release` (prerelease)
     - No PRs, no squash, no merge commits — a straight rebase
     - Skips if no release tag is found

3. **`release.yml`** - Automatic workflow for publishing the extension
   - **Name**: `Auto: Release VS Code Extension`
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
│    - Detects [release] or [prerelease] tag in PR title         │
│    - Rebases develop directly onto main/pre-release            │
│    - No PRs, no squash, no merge commits                       │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│ 5. Push to main/pre-release triggers release.yml               │
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

- **`workspace-setup-tests.yml`** - Runs all 5 workspace setup types as parallel jobs across Ubuntu, macOS, and Windows (15 jobs: 3 platforms x 5 types)
  - **Trigger**: PRs to develop (bump PRs or `full_test` label)
  - **Manual Trigger**: Can be triggered manually with optional `branch` input
  - **Actions**: Runs all workspace setup test suites (standard, west-git, zephyr-ide-git, local-west, external-zephyr), each as its own job with its own PR check status
  - **Caching**: Zephyr SDK toolchain download is cached per OS + SDK version (`~/.zephyr_ide/toolchains`); west/git module checkouts are not cached (see comments in the workflow file for why)

- **`basic-tests.yml`** - Fast Ubuntu-only platform integration test for every PR
  - **Trigger**: Pull requests to develop
  - **Manual Trigger**: Can be triggered manually with optional `branch` input
  - **Actions**: Builds VSIX, runs platform integration test on Ubuntu
  - **Purpose**: Fast CI gate for every PR

- **`unit-tests.yml`** - Lightweight unit tests for every PR
  - **Trigger**: Pull requests to develop
  - **Manual Trigger**: Can be triggered manually with optional `branch` input
  - **Actions**: Compiles, lints, and runs unit tests (no Zephyr SDK required)
  - **Purpose**: Fast validation of utility functions, configuration parsing, and logic

- **`multiplatform-tests.yml`** - Multi-platform integration test for releases
  - **Trigger**: PRs to develop (bump PRs or `full_test` label)
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
4. Verify rebase and push behavior
