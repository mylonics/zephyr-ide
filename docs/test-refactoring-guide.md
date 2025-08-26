# Test Refactoring Guide

This document shows how to refactor test files using the new utility functions in `test-runner.ts`.

## New Utility Functions Added

### 1. **Test Workspace Management**
- `setupTestWorkspace(prefix)` - Creates isolated test workspace with VS Code mocking
- `cleanupTestWorkspace(testWorkspaceDir, originalWorkspaceFolders)` - Cleans up test workspace

### 2. **Extension & Build Management**
- `activateExtension(extensionId?, waitTime?)` - Activates extension and waits for initialization
- `executeFinalBuild(testName, retryDelayMs?)` - Executes build with workspace state validation

### 3. **Error Handling & Logging**
- `executeTestWithErrorHandling(testName, testWorkspaceDir, uiMock, testFunction)` - Complete test wrapper
- `executeWorkspaceCommand(uiMock, interactions, commandId, successMessage)` - Execute commands with UI interactions

### 4. **Common UI Interaction Patterns**
- `CommonUIInteractions.standardWorkspace` - Standard workspace setup interactions
- `CommonUIInteractions.createBlinkyProject` - Project creation interactions
- `CommonUIInteractions.addBuildConfig` - Build configuration interactions
- `CommonUIInteractions.sdkAutoInstall` - SDK installation interactions

## Refactoring Examples

### Before (Original Code - 50+ lines per test)

```typescript
suite("Test Suite", () => {
    let testWorkspaceDir: string;
    let originalWorkspaceFolders: readonly vscode.WorkspaceFolder[] | undefined;

    setup(async () => {
        // 25+ lines of workspace setup code
        testWorkspaceDir = path.join(os.tmpdir(), "prefix-" + Date.now());
        await fs.ensureDir(testWorkspaceDir);
        
        const mockWorkspaceFolder: vscode.WorkspaceFolder = {
            uri: vscode.Uri.file(testWorkspaceDir),
            name: path.basename(testWorkspaceDir),
            index: 0,
        };

        originalWorkspaceFolders = vscode.workspace.workspaceFolders;
        Object.defineProperty(vscode.workspace, "workspaceFolders", {
            value: [mockWorkspaceFolder],
            configurable: true,
        });

        vscode.workspace.getConfiguration = () => ({
            get: () => undefined,
            update: () => Promise.resolve(),
            has: () => false,
            inspect: (key: string) => ({ /* ... */ }),
        } as any);

        vscode.window.showInformationMessage = async () => undefined;
        vscode.window.showWarningMessage = async () => undefined;
        vscode.window.showErrorMessage = async () => undefined;
    });

    teardown(async () => {
        // 10+ lines of cleanup code
        if (originalWorkspaceFolders !== undefined) {
            Object.defineProperty(vscode.workspace, "workspaceFolders", {
                value: originalWorkspaceFolders,
                configurable: true,
            });
        }

        if (testWorkspaceDir && (await fs.pathExists(testWorkspaceDir))) {
            await fs.remove(testWorkspaceDir);
        }
    });

    test("Test", async function () {
        try {
            // 15+ lines of extension activation and UI mock setup
            const extension = vscode.extensions.getExtension("mylonics.zephyr-ide");
            if (extension && !extension.isActive) {
                await extension.activate();
            }
            await new Promise((resolve) => setTimeout(resolve, 3000));

            const uiMock = new UIMockInterface();
            uiMock.activate();

            // Test logic...
            
            // 10+ lines of workspace state checking and build execution
            const ext = vscode.extensions.getExtension("mylonics.zephyr-ide");
            const wsConfig = ext?.exports?.getWorkspaceConfig();
            if (!wsConfig?.initialSetupComplete) {
                console.log("⚠️ Setup not complete, retrying in 10 seconds...");
                await new Promise((resolve) => setTimeout(resolve, 10000));
            }

            result = await vscode.commands.executeCommand("zephyr-ide.build");
            assert.ok(result, "Build execution should succeed");

            uiMock.deactivate();
            await printWorkspaceOnSuccess("Test", testWorkspaceDir);

        } catch (error) {
            await printWorkspaceOnFailure("Test", error);
            await new Promise((resolve) => setTimeout(resolve, 30000));
            throw error;
        }
    });
});
```

### After (Refactored Code - 15-20 lines per test)

```typescript
import { 
    setupTestWorkspace, cleanupTestWorkspace, activateExtension, 
    executeFinalBuild, executeTestWithErrorHandling, executeWorkspaceCommand,
    CommonUIInteractions
} from "./test-runner";

suite("Test Suite", () => {
    let testWorkspaceDir: string;
    let originalWorkspaceFolders: readonly vscode.WorkspaceFolder[] | undefined;

    setup(async () => {
        const workspace = await setupTestWorkspace("prefix");
        testWorkspaceDir = workspace.testWorkspaceDir;
        originalWorkspaceFolders = workspace.originalWorkspaceFolders;
    });

    teardown(async () => {
        await cleanupTestWorkspace(testWorkspaceDir, originalWorkspaceFolders);
    });

    test("Test", async function () {
        const uiMock = new UIMockInterface();
        
        await executeTestWithErrorHandling("Test Name", testWorkspaceDir, uiMock, async () => {
            await activateExtension();
            uiMock.activate();

            // Use common interactions or custom ones
            await executeWorkspaceCommand(
                uiMock,
                CommonUIInteractions.standardWorkspace,
                "zephyr-ide.workspace-setup-standard",
                "Workspace setup should succeed"
            );

            await monitorWorkspaceSetup();
            await executeFinalBuild("Test Name");
        });
    });
});
```

## Specific Refactoring Plans

### 1. workspace-standard.test.ts
**Current:** 200+ lines  
**After refactoring:** ~80 lines  
**Key changes:**
- Replace setup/teardown with utility functions (-30 lines)
- Use `executeTestWithErrorHandling` wrapper (-20 lines)
- Use `CommonUIInteractions.standardWorkspace` (-15 lines)
- Use `executeWorkspaceCommand` for commands (-10 lines)

### 2. workspace-west-git.test.ts
**Current:** ~180 lines  
**After refactoring:** ~70 lines  
**Key changes:**
- Same setup/teardown improvements (-30 lines)
- Custom interaction arrays for git commands (-15 lines)
- Standardized error handling (-15 lines)

### 3. workspace-external-zephyr.test.ts
**Current:** ~170 lines  
**After refactoring:** ~65 lines  
**Key changes:**
- Use common external zephyr interactions (-20 lines)
- Standardized workspace setup (-25 lines)

### 4. workspace-zephyr-ide-git.test.ts
**Current:** ~165 lines  
**After refactoring:** ~60 lines  
**Key changes:**
- Git-specific interaction patterns (-15 lines)
- Common build execution patterns (-10 lines)

## Implementation Steps

1. **Immediate Benefits (Already Done):**
   - ✅ New utility functions added to `test-runner.ts`
   - ✅ workspace-local-west.test.ts refactored as example
   - ✅ TypeScript compilation successful

2. **Next Steps (✅ COMPLETED):**
   - ✅ Refactor workspace-standard.test.ts using new utilities
   - ✅ Refactor workspace-west-git.test.ts using new utilities  
   - ✅ Refactor workspace-external-zephyr.test.ts using new utilities
   - ✅ Refactor workspace-zephyr-ide-git.test.ts using new utilities

3. **Validation:**
   - Run `npm run test-compile` after each refactoring
   - Test individual test suites: `node scripts/run-integration-tests.js [test-type]`
   - Verify all tests still pass with reduced code

## Code Reduction Summary

| File | Before (Lines) | After (Lines) | Reduction |
|------|----------------|---------------|-----------|
| workspace-local-west.test.ts | 159 | 92 | -67 lines (42%) |
| workspace-standard.test.ts | 202 | 130 | -72 lines (36%) |
| workspace-west-git.test.ts | 182 | 121 | -61 lines (34%) |
| workspace-external-zephyr.test.ts | 170 | 99 | -71 lines (42%) |
| workspace-zephyr-ide-git.test.ts | 165 | 96 | -69 lines (42%) |
| **Total** | **878** | **538** | **-340 lines (39%)** |

## Benefits

1. **Maintainability:** Common patterns centralized in test-runner.ts
2. **Readability:** Tests focus on business logic, not boilerplate
3. **Consistency:** Standardized error handling and workspace management
4. **Reusability:** Common interaction patterns can be shared
5. **Debugging:** Enhanced workspace structure printing on both success and failure

## Testing the Refactored Code

```bash
# Compile TypeScript
npm run test-compile

# Test individual suites
node scripts/run-integration-tests.js standard
node scripts/run-integration-tests.js west-git
node scripts/run-integration-tests.js local-west
node scripts/run-integration-tests.js external-zephyr
node scripts/run-integration-tests.js zephyr-ide-git

# Run all tests
npm test
```

The refactored tests will provide the same functionality with significantly less code duplication and improved maintainability.
