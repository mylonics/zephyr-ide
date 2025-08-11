# Zephyr IDE Testing Guide

This document describes the testing setup for the Zephyr IDE VS Code extension.

## Test Structure

The testing infrastructure consists of:

- **Standard Workspace Tests**: `src/test/standard-workspace.test.ts` - Complete standard workspace workflow (dependencies → setup → project → build)
- **Git Workspace Tests**: `src/test/west-git-workspace.test.ts` - Git-based workspace workflow (west git → SDK → project → build)
- **UI Mock Interface**: `src/test/ui-mock-interface.ts` - Clean interface for mocking VS Code UI interactions
- **Test Runner**: `src/test/test-runner.ts` - Test utilities, workspace monitoring, and environment detection
- **CI Configuration**: `.github/workflows/integration-tests.yml` - Automated testing with separate job steps

## Test Workflows

### Standard Workspace Test
The standard workspace test validates the complete Zephyr IDE workflow:

1. **Check Dependencies**: Validates build dependencies
2. **Setup Workspace**: Creates standard workspace with west configuration (minimal manifest, STM32 toolchain, v4.2.0)
3. **Install SDK**: Installs SDK with automatic version and ARM toolchain
4. **Create Project**: Creates blinky project from template
5. **Configure Build**: Sets up build for nucleo_f401 with debug optimization
6. **Execute Build**: Runs the build process

### Git Workspace Test
The git workspace test validates git-based workflow:

1. **Setup from Git**: Sets up workspace from West Git repository (zephyr-example.git)
2. **Install SDK**: Installs SDK with automatic version and ARM toolchain
3. **Add Project**: Adds project from example repository app folder
4. **Configure Build**: Sets up build with custom board (custom_plank) from boards folder
5. **Execute Build**: Runs the build process with custom board

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

# Run individual workspace tests (recommended for development)
node scripts/run-integration-tests.js standard    # Standard workspace workflow
node scripts/run-integration-tests.js git        # Git workspace workflow  
node scripts/run-integration-tests.js all        # Both tests

# Run specific test suites by name
npx vscode-test --grep "Standard Workspace Test Suite"
npx vscode-test --grep "West Git Workspace Test Suite"

# Run specific test files directly
npx vscode-test src/test/standard-workspace.test.ts
npx vscode-test src/test/west-git-workspace.test.ts
```

### Environment Variables

- `SKIP_BUILD_TESTS=true` - Skip actual build execution
- `CI=true` - Automatically detected in CI environments

## CI Testing

The CI pipeline runs on Ubuntu with separate job steps:
- Standard workspace workflow test
- Git workspace workflow test

### CI Behavior

CI runs both test suites independently using:
```bash
xvfb-run -a node scripts/run-integration-tests.js standard
xvfb-run -a node scripts/run-integration-tests.js git
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

Add tests to `src/test/standard-workspace.test.ts` for standard workflow validation:

```typescript
test('New Workflow Feature', async function() {
    this.timeout(420000);
    
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

### Git Workspace Tests

Add tests to `src/test/west-git-workspace.test.ts` for git-based workflows:

```typescript
test('Git Workflow Feature', async function() {
    this.timeout(420000);
    
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

### Standard Workspace Test
- ✅ Build dependencies check
- ✅ Standard workspace setup (minimal manifest, STM32 toolchain, v4.2.0)
- ✅ SDK installation (automatic version, ARM toolchain)
- ✅ Project creation from template (blinky)
- ✅ Build configuration (nucleo_f401, debug optimization)
- ✅ Build execution

### Git Workspace Test
- ✅ Git workspace setup from West repository
- ✅ SDK installation (automatic version, ARM toolchain)
- ✅ Project addition from git repository
- ✅ Custom board build configuration (custom_plank)
- ✅ Build execution with custom board

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
