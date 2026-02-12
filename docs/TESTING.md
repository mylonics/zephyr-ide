# Zephyr IDE Testing Guide

This document describes the testing setup for the Zephyr IDE VS Code extension.

## Test Overview

| Test Name | File | Description | Scenario |
|-----------|------|-------------|----------|
| **Standard Workspace** | `workspace-standard.test.ts` | Complete standard workspace workflow | Fresh workspace setup → SDK install → project creation → build |
| **West Git Workspace** | `workspace-west-git.test.ts` | Git-based workspace using west manifest | West manifest repo → SDK install → project from git → custom board build |
| **Zephyr IDE Git Workspace** | `workspace-zephyr-ide-git.test.ts` | Zephyr IDE specific git workflow | Zephyr IDE sample project → SDK install → build existing project |
| **Local West Workspace** | `workspace-local-west.test.ts` | Git repo with detected west.yml files | Git repo with west.yml → choose local west → build |
| **External Zephyr Workspace** | `workspace-external-zephyr.test.ts` | Out-of-tree with existing Zephyr | Git repo without west.yml → use existing Zephyr → global install → build |

## Test Structure

The testing infrastructure consists of:

- **Standard Workspace Tests**: `src/test/workspace-standard.test.ts` - Complete standard workspace workflow (dependencies → setup → project → build)
- **West Git Workspace Tests**: `src/test/workspace-west-git.test.ts` - Git-based workspace workflow using west manifest repositories
- **Zephyr IDE Git Workspace Tests**: `src/test/workspace-zephyr-ide-git.test.ts` - Zephyr IDE specific git workspace setup workflow
- **Local West Workspace Tests**: `src/test/workspace-local-west.test.ts` - Workspace setup from git with detected west.yml files
- **External Zephyr Workspace Tests**: `src/test/workspace-external-zephyr.test.ts` - Out-of-tree workspace setup with existing Zephyr installation
- **UI Mock Interface**: `src/test/ui-mock-interface.ts` - Clean interface for mocking VS Code UI interactions
- **Test Runner**: `src/test/test-runner.ts` - Test utilities, workspace monitoring, and environment detection
- **CI Configuration**: `.github/workflows/integration-tests.yml` - Automated testing with separate job steps

## Test Workflows

### Standard Workspace Test (`workspace-standard.test.ts`)
The standard workspace test validates the complete Zephyr IDE workflow:

1. **Check Dependencies**: Validates build dependencies
2. **Setup Workspace**: Creates standard workspace with west configuration (minimal manifest, STM32 toolchain, v4.3.0)
3. **Install SDK**: Installs SDK with automatic version and ARM toolchain
4. **Create Project**: Creates blinky project from template
5. **Configure Build**: Sets up build for nucleo_f401 with debug optimization
6. **Execute Build**: Runs the build process

### West Git Workspace Test (`workspace-west-git.test.ts`)
The west git workspace test validates git-based workflow using west manifest repositories:

1. **Setup from Git**: Sets up workspace from West Git repository (zephyr-example.git)
2. **Install SDK**: Installs SDK with automatic version and ARM toolchain
3. **Add Project**: Adds project from example repository app folder
4. **Configure Build**: Sets up build with custom board (custom_plank) from boards folder
5. **Execute Build**: Runs the build process with custom board

### Zephyr IDE Git Workspace Test (`workspace-zephyr-ide-git.test.ts`)
The Zephyr IDE git workspace test validates Zephyr IDE specific git workflow:

1. **Setup Workspace**: Setup workspace from Zephyr IDE Git repository
2. **Install SDK**: Installs SDK automatically
3. **Execute Build**: Runs build on existing project structure

### Local West Workspace Test (`workspace-local-west.test.ts`)
The local west workspace test validates workspace setup from git with detected west.yml files:

1. **Setup from Git**: Setup workspace from git with branch containing west.yml
2. **Choose Local West**: When prompted, choose detected west.yml file (not external install)
3. **Execute Build**: Runs the build process

### External Zephyr Workspace Test (`workspace-external-zephyr.test.ts`)
The external zephyr workspace test validates out-of-tree workspace setup:

1. **Setup from Git**: Setup workspace from git without west.yml files
2. **Choose External**: When prompted, choose "Use Existing Zephyr Installation"
3. **Select Global**: Choose "Global Installation" option
4. **West Selector**: Go through west selector process (minimal, stm32)
5. **Execute Build**: Runs the build process

## Running Tests Locally

### Prerequisites

For full integration testing (including build execution):
- Zephyr SDK installed
- West tool available in PATH
- CMake installed
- Python environment set up

### Commands

```bash
# Install dependencies
npm install

# Compile TypeScript
npm run test-compile

# Run all tests
npm test

# Get help on available test types
node scripts/run-integration-tests.js help

# Run individual workspace tests (recommended for development)
node scripts/run-integration-tests.js standard           # Standard workspace workflow
node scripts/run-integration-tests.js west-git          # West git workspace workflow
node scripts/run-integration-tests.js zephyr-ide-git    # Zephyr IDE git workspace workflow  
node scripts/run-integration-tests.js local-west        # Local west workspace workflow
node scripts/run-integration-tests.js external-zephyr   # External zephyr workspace workflow
node scripts/run-integration-tests.js all               # All tests

# Run specific test suites by name (alternative approach)
npx vscode-test --grep "Workspace Standard Test Suite"
npx vscode-test --grep "Workspace West Git Test Suite"
npx vscode-test --grep "Workspace Zephyr IDE Git Test Suite"
npx vscode-test --grep "Workspace Local West Test Suite"
npx vscode-test --grep "Workspace External Zephyr Test Suite"

# Run specific test files directly (for debugging)
npx vscode-test src/test/workspace-standard.test.ts
npx vscode-test src/test/workspace-west-git.test.ts
npx vscode-test src/test/workspace-zephyr-ide-git.test.ts
npx vscode-test src/test/workspace-local-west.test.ts
npx vscode-test src/test/workspace-external-zephyr.test.ts
```

### Environment Variables

- `SKIP_BUILD_TESTS=true` - Skip actual build execution
- `CI=true` - Automatically detected in CI environments

## CI Testing

The CI pipeline runs on Ubuntu with separate job steps:
- Standard workspace workflow test
- West git workspace workflow test
- Zephyr IDE git workspace workflow test
- Local west workspace workflow test
- External zephyr workspace workflow test

### CI Behavior

CI runs test suites independently using:
```bash
xvfb-run -a node scripts/run-integration-tests.js standard
xvfb-run -a node scripts/run-integration-tests.js west-git
xvfb-run -a node scripts/run-integration-tests.js zephyr-ide-git
xvfb-run -a node scripts/run-integration-tests.js local-west
xvfb-run -a node scripts/run-integration-tests.js external-zephyr
```

This allows for:
- Independent test failure analysis
- Parallel execution potential
- Clear separation of test concerns

## Test Configuration

### VS Code Test Setup

- `.vscode-test.mjs` - VS Code test configuration
- Tests compile to `out/test/**/*.test.js`
- Uses Mocha test framework
- 5-minute timeout for integration tests

### UI Mock Interface

The tests use a clean UI mocking system (`UIMockInterface`):
- **Step-by-step priming**: `uiMock.primeInteractions([{type: 'quickpick', value: 'minimal', description: 'Select minimal manifest'}])`
- **Clean lifecycle**: `activate()` → `primeInteractions()` → execute → `deactivate()`
- **Multiple interaction types**: quickpick, input, opendialog with proper typing
- **Reusable across tests**: Centralized mock logic reduces code duplication

## Adding New Tests

### Standard Workspace Tests

Add tests to `src/test/workspace-standard.test.ts` for standard workflow validation:

```typescript
test('New Workflow Feature', async function() {
    this.timeout(620000);
    
    const uiMock = new UIMockInterface();
    uiMock.activate();
    
    // Prime interactions for your workflow
    uiMock.primeInteractions([
        { type: 'quickpick', value: 'option', description: 'Select option' }
    ]);
    
    // Execute commands and assertions
    const result = await vscode.commands.executeCommand("your-command");
    assert.ok(result, "Command should succeed");
    
    uiMock.deactivate();
});
```

### West Git Workspace Tests

Add tests to `src/test/workspace-west-git.test.ts` for west git-based workflows:

```typescript
test('West Git Workflow Feature', async function() {
    this.timeout(620000);
    
    const gitUiMock = new UIMockInterface();
    gitUiMock.activate();
    
    // Prime git-specific interactions
    gitUiMock.primeInteractions([
        { type: 'input', value: 'https://github.com/example/repo.git', description: 'Enter repo URL' }
    ]);
    
    // Execute and validate
    await vscode.commands.executeCommand("git-command");
    
    gitUiMock.deactivate();
});
```

### Other Workspace Tests

- **Zephyr IDE Git Tests**: Add to `src/test/workspace-zephyr-ide-git.test.ts` for Zephyr IDE specific git workflows
- **Local West Tests**: Add to `src/test/workspace-local-west.test.ts` for local west.yml detection workflows  
- **External Zephyr Tests**: Add to `src/test/workspace-external-zephyr.test.ts` for existing Zephyr installation workflows

## Debugging Tests

### VS Code Debug Configuration

Use the "Run Extension Tests" configuration in `.vscode/launch.json` to debug tests in VS Code.

### Console Output

Tests include detailed console logging:
- Step-by-step workflow progress
- Environment information
- Error details with tool availability

### Common Issues

1. **Timeout Errors**: Increase timeout for long-running operations (use 1800000ms for full workflows)
2. **Path Issues**: Ensure absolute paths are used consistently
3. **Mock Failures**: Ensure `uiMock.primeInteractions()` is called before each command that requires UI
4. **Mock Order**: Prime interactions in the exact order they will be consumed
5. **Mock Cleanup**: Always call `uiMock.deactivate()` in try/finally blocks

## Test Data

Tests use temporary directories:
- Created in `os.tmpdir()` with unique timestamps
- Automatically cleaned up after test completion
- No persistent test data or configuration

## Coverage

Current test coverage includes:

### Standard Workspace Test (`workspace-standard.test.ts`)
- ✅ Build dependencies check
- ✅ Standard workspace setup (minimal manifest, STM32 toolchain, v4.3.0)
- ✅ SDK installation (automatic version, ARM toolchain)
- ✅ Project creation from template (blinky)
- ✅ Build configuration (nucleo_f401, debug optimization)
- ✅ Build execution

### West Git Workspace Test (`workspace-west-git.test.ts`)
- ✅ Git workspace setup from West repository
- ✅ SDK installation (automatic version, ARM toolchain)
- ✅ Project addition from git repository
- ✅ Custom board build configuration (custom_plank)
- ✅ Build execution with custom board

### Zephyr IDE Git Workspace Test (`workspace-zephyr-ide-git.test.ts`)
- ✅ Zephyr IDE git workspace setup
- ✅ SDK installation (automatic version, ARM toolchain)
- ✅ Build execution on existing project

### Local West Workspace Test (`workspace-local-west.test.ts`)
- ✅ Git workspace setup with west.yml detection
- ✅ Local west workspace selection
- ✅ Build execution with detected west configuration

### External Zephyr Workspace Test (`workspace-external-zephyr.test.ts`)
- ✅ Git workspace setup without west.yml
- ✅ External Zephyr installation selection
- ✅ Global installation configuration
- ✅ West selector workflow (minimal, stm32)
- ✅ Build execution

### Test Infrastructure
- ✅ UI mocking system with step-by-step priming
- ✅ Workspace monitoring and setup detection
- ✅ Centralized test utilities
- ✅ Independent CI test execution

Future coverage should include:
- Debug configuration setup
- Flash and monitor operations
- Error handling scenarios
- Multi-project workspace testing

## Quick Command Reference

### Run Individual Tests
```bash
# Standard workspace (recommended first test)
node scripts/run-integration-tests.js standard

# West git workspace (requires git connectivity)
node scripts/run-integration-tests.js west-git

# Zephyr IDE git workspace (Zephyr IDE specific workflow)
node scripts/run-integration-tests.js zephyr-ide-git

# Local west workspace (git repo with west.yml detection)
node scripts/run-integration-tests.js local-west

# External zephyr workspace (out-of-tree with existing Zephyr)
node scripts/run-integration-tests.js external-zephyr
```

### Development Workflow
```bash
# 1. Compile tests after making changes
npm run test-compile

# 2. Run specific test for your changes
node scripts/run-integration-tests.js <test-type>

# 3. Debug failing tests using VS Code
# Use "Run Extension Tests" launch configuration
```

### Test File Mapping
- `workspace-standard.test.ts` → `node scripts/run-integration-tests.js standard`
- `workspace-west-git.test.ts` → `node scripts/run-integration-tests.js west-git`
- `workspace-zephyr-ide-git.test.ts` → `node scripts/run-integration-tests.js zephyr-ide-git`
- `workspace-local-west.test.ts` → `node scripts/run-integration-tests.js local-west`
- `workspace-external-zephyr.test.ts` → `node scripts/run-integration-tests.js external-zephyr`
