# Zephyr IDE VS Code Extension

**ALWAYS follow these instructions first and only fallback to search or bash commands when encountering unexpected information that does not match the info here.**

Zephyr IDE is a VS Code extension that provides comprehensive tools for Zephyr RTOS development. It includes workspace setup, SDK installation, project creation, building, debugging, and testing capabilities.

## Working Effectively

### Bootstrap and Dependencies
**CRITICAL: All build and test commands take significant time. NEVER CANCEL operations.**

```bash
# Install Node.js dependencies (40 seconds)
npm install

# Install Python west tool for Zephyr development
pip3 install west

# Verify required tools are available
which python3 && python3 --version
which cmake && cmake --version
which west && west --version
which ninja && ninja --version
```

### Build Commands
**Set timeouts to 10+ minutes for all build commands. NEVER CANCEL.**

```bash
# Compile TypeScript (3 seconds)
npm run test-compile

# Compile for development (3 seconds) 
npm run compile

# Bundle extension with esbuild (1 second)
npm run esbuild

# Production build with minification (1 second)
npm run vscode:prepublish

# Run ESLint (2 seconds)
npm run lint

# Full pretest pipeline: compile + esbuild + lint (6 seconds)
npm run pretest
```

### Testing Commands
**CRITICAL: Integration tests take 10-15 minutes each. Set timeouts to 20+ minutes. NEVER CANCEL.**

```bash
# Run all tests (requires VS Code download, network-dependent)
# TIMEOUT: 20+ minutes
npm test

# Run specific integration test suites (requires Zephyr SDK)
# TIMEOUT: 15+ minutes each - NEVER CANCEL
xvfb-run -a node scripts/run-integration-tests.js standard
xvfb-run -a node scripts/run-integration-tests.js git
xvfb-run -a node scripts/run-integration-tests.js zephyr-ide-git
xvfb-run -a node scripts/run-integration-tests.js open-current-dir
xvfb-run -a node scripts/run-integration-tests.js out-of-tree

# Skip actual Zephyr builds in tests (faster testing)
SKIP_BUILD_TESTS=true npm test
```

### VS Code Extension Development
```bash
# Open extension for development
# 1. Open VS Code in the repository directory
# 2. Press F5 or Run → Start Debugging
# 3. Select "Run Extension" configuration
# This launches a new VS Code window with the extension loaded for testing
```

## Validation Scenarios

**ALWAYS test these scenarios after making changes to ensure functionality:**

### Manual Extension Validation
1. **Extension Loading**: Press F5 to launch extension host, verify Zephyr IDE appears in activity bar
2. **Workspace Setup**: Test workspace initialization commands work
3. **Project Creation**: Verify project creation from templates functions
4. **Build Configuration**: Test build configuration setup
5. **Command Palette**: Verify all "Zephyr IDE:" commands are available

### Integration Test Coverage
The integration tests validate complete workflows:
- **Standard Workspace**: Dependencies → west setup → SDK install → project creation → build (15 min)
- **Git Workspace**: Git clone → SDK → project → custom board build (15 min)  
- **Zephyr IDE Git**: Zephyr IDE specific git workflow (15 min)
- **Open Directory**: Current directory workspace setup (15 min)
- **Out of Tree**: Out-of-tree project builds (15 min)

## Repository Structure

### Key Directories
```
src/                     - TypeScript source code
├── extension.ts         - Main extension entry point
├── panels/             - Webview panels for UI
├── project_utilities/  - Project management logic
├── setup_utilities/    - Workspace setup logic
├── zephyr_utilities/   - Zephyr-specific tools
├── test/               - Integration test suites
└── utilities/          - Shared utilities

dist/                   - Bundled extension output (esbuild)
out/                    - Compiled TypeScript output (tsc)
scripts/                - Python/JS helper scripts
west_templates/         - West.yml configuration templates
.github/workflows/      - CI/CD integration tests
docs/                   - User documentation
```

### Important Files
```
package.json           - Extension manifest and npm scripts
tsconfig.json         - TypeScript configuration
.eslintrc.json        - ESLint configuration
.vscode-test.mjs      - VS Code test runner configuration
.vscode/launch.json   - Debug configuration for extension development
```

## Common Development Tasks

### Code Changes Workflow
```bash
# 1. Make code changes to src/
# 2. Compile and lint
npm run test-compile
npm run lint

# 3. Test extension
# Press F5 in VS Code to launch extension host

# 4. Run integration tests if needed (NEVER CANCEL - 15+ min each)
SKIP_BUILD_TESTS=true npm test  # Quick test
xvfb-run -a node scripts/run-integration-tests.js standard  # Full test
```

### Before Committing
**ALWAYS run these commands before committing changes:**
```bash
# Required for CI to pass
npm run lint
npm run test-compile
npm run esbuild

# Recommended full validation
npm run pretest
```

### Extension Packaging
```bash
# Build for production
npm run vscode:prepublish

# Package extension (requires vsce tool)
vsce package
```

## Troubleshooting

### Build Issues
- **TypeScript errors**: Run `npm run compile` to see detailed errors
- **Bundling issues**: Check `npm run esbuild` output
- **Lint failures**: Run `npm run lint` and fix ESLint warnings

### Test Issues  
- **VS Code download failures**: Network connectivity issue, retry tests
- **Integration test timeouts**: NEVER CANCEL - tests take 15+ minutes
- **Zephyr build failures**: Install Zephyr SDK and build dependencies
- **Mock UI failures**: Check UI mock interface in test files

### Development Issues
- **Extension not loading**: Check console for errors in extension host
- **Commands not working**: Verify command registration in package.json
- **Webview issues**: Check panel implementations in src/panels/

## CI/CD Integration

The `.github/workflows/integration-tests.yml` runs on:
- Push to main, pre-release, develop branches
- Pull requests to those branches

**CI Requirements:**
- Ubuntu with Zephyr build tools
- 20+ minute timeouts for integration tests
- xvfb for headless VS Code testing
- NEVER CANCEL long-running operations

## Environment Variables

- `SKIP_BUILD_TESTS=true` - Skip actual Zephyr builds in tests
- `NODE_ENV=test` - Test environment configuration
- `ZEPHYR_BASE=/tmp/zephyr` - Zephyr installation base path
- `CI=true` - Automatically detected in CI environments

## Dependencies

### Required for Development
- Node.js 18+ (for npm and extension bundling)
- VS Code (for extension development and testing)
- Git (for version control)

### Required for Full Testing
- Python 3.8+ with pip
- west (`pip3 install west`)
- cmake, ninja-build
- Zephyr SDK (for integration tests)
- xvfb (for headless testing on Linux)

### System Packages (Ubuntu)
```bash
sudo apt-get install python3-pip python3-venv cmake ninja-build gperf \
  ccache dfu-util device-tree-compiler wget file make gcc gcc-multilib \
  g++-multilib libsdl2-dev libmagic1
```

**TIMING EXPECTATIONS:**
- npm install: ~40 seconds
- TypeScript compilation: ~3 seconds  
- ESLint: ~2 seconds
- esbuild bundling: ~1 second
- Integration tests: 15+ minutes each - NEVER CANCEL
- Full CI pipeline: 60+ minutes - NEVER CANCEL