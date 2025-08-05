# Zephyr IDE Testing Guide

This document describes the testing setup for the Zephyr IDE VS Code extension.

## Test Structure

The testing infrastructure consists of:

- **Workflow Tests**: `src/test/workflow.test.ts` - Comprehensive workflow validation tests (recommended)
- **Integration Tests**: `src/test/integration.test.ts` - Full end-to-end workflow tests (requires Zephyr tools)
- **Test Runner**: `src/test/test-runner.ts` - Test utilities and environment detection
- **CI Configuration**: `.github/workflows/integration-tests.yml` - Automated testing

## Integration Test Workflow

The main workflow test (`workflow.test.ts`) validates the complete Zephyr IDE workflow structure:

1. **Create Standard Workspace**: Sets up a new Zephyr workspace with west configuration
2. **Create Blinky Project**: Creates a new project from the blinky template
3. **Configure STM32 Build**: Sets up a build configuration for STM32 (nucleo_f103rb)
4. **Execute Build**: Runs the build process (when Zephyr tools are available)

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

# Run all tests (includes failing integration tests)
npm test

# Run workflow tests only (recommended for CI)
node scripts/run-workflow-tests.js

# Run tests with custom script
node scripts/run-tests.js
```

### Environment Variables

- `SKIP_BUILD_TESTS=true` - Skip actual build execution
- `CI=true` - Automatically detected in CI environments

## CI Testing

The CI pipeline runs on:
- Ubuntu (with xvfb for headless VS Code)
- Windows
- macOS

### CI Behavior

In CI environments, the tests automatically:
- Skip actual Zephyr builds (tools not installed)
- Validate configuration and setup logic only
- Test the complete workflow structure

### Build Test Skipping

Build tests are automatically skipped when:
- Running in CI environment (`CI=true`)
- Zephyr tools not available
- `SKIP_BUILD_TESTS=true` is set

## Test Configuration

### VS Code Test Setup

- `.vscode-test.mjs` - VS Code test configuration
- Tests compile to `out/test/**/*.test.js`
- Uses Mocha test framework
- 5-minute timeout for integration tests

### Mock Objects

The integration tests use mocked VS Code APIs:
- `vscode.window.showQuickPick` - For template and board selection
- `vscode.window.showInputBox` - For project and build names
- `vscode.workspace.workspaceFolders` - For workspace directory

## Adding New Tests

### Workflow Tests

Add tests to `src/test/workflow.test.ts` for workflow validation:

```typescript
test('Workflow Name', async () => {
    // Test implementation
    assert.strictEqual(actual, expected);
});
```

### Integration Tests

Add tests to `src/test/integration.test.ts` for full end-to-end workflows:

```typescript
test('Workflow Name', async function() {
    this.timeout(60000); // Set appropriate timeout
    // Test implementation
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

1. **Timeout Errors**: Increase timeout for long-running operations
2. **Path Issues**: Ensure absolute paths are used consistently
3. **Mock Failures**: Verify VS Code API mocking is complete
4. **Tool Dependencies**: Use `shouldSkipBuildTests()` for optional operations

## Test Data

Tests use temporary directories:
- Created in `os.tmpdir()` with unique timestamps
- Automatically cleaned up after test completion
- No persistent test data or configuration

## Coverage

Current test coverage includes:
- ✅ Workspace configuration structure validation
- ✅ Project creation workflow structure
- ✅ Build configuration setup for STM32 boards
- ✅ Complete workflow structure validation
- ✅ Build command construction validation
- ⚠️ Build execution (environment dependent)

Future coverage should include:
- Debug configuration setup
- Flash and monitor operations
- Error handling scenarios
- Performance testing
