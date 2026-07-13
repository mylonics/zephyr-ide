/*
Copyright 2025-2026 mylonics
Author Rijesh Augustine

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import * as assert from "assert";
import * as vscode from "vscode";
import {
    logTestEnvironment,
    monitorWorkspaceSetup,
    startWorkspaceCommand,
    printWorkspaceStructure,
    runWorkspaceSuiteTeardown,
    activateExtension,
    executeFinalBuild,
    executeTestWithErrorHandling,
    executeWorkspaceCommand,
    assertProjectPersisted,
    assertWorkspaceReopenReDetectsVenv,
    CommonUIInteractions,
    shouldSkipBuildDependencyCheck
} from "./test-runner";
import { UIMockInterface } from "./ui-mock-interface";

/*
 * CLEAN INTEGRATION TEST ARCHITECTURE:
 * 
 * 1. UI Mock Interface (ui-mock-interface.ts):
 *    - Handles all VSCode UI interactions (quickpick, input, opendialog)
 *    - Step-by-step priming: uiMock.primeInteractions([...])
 *    - Clean lifecycle: activate() → prime → execute → deactivate()
 * 
 * 2. Workspace Monitoring (test-runner.ts):
 *    - Centralized monitoring logic: await monitorWorkspaceSetup("type")
 *    - Reusable across different test scenarios
 *    - Progress tracking and timeout handling
 * 
 * 3. Test Structure:
 *    - Initialize UI mock once
 *    - Prime interactions before each step
 *    - Use shared monitoring utilities
 *    - Clean separation of concerns
 * 
 * Benefits:
 * - Reduced code duplication (100+ lines removed)
 * - Maintainable and readable tests
 * - Reusable components across test files
 * - Clear intent with descriptive interactions
 */

suite("Workspace Standard Test Suite", () => {
    let testWorkspaceDir: string;
    let originalWorkspaceFolders: readonly vscode.WorkspaceFolder[] | undefined;

    suiteSetup(() => {
        logTestEnvironment();
        console.log("🔬 Testing standard workspace workflow");
    });

    setup(async () => {
        originalWorkspaceFolders = vscode.workspace.workspaceFolders;
        if (originalWorkspaceFolders) {
            testWorkspaceDir = originalWorkspaceFolders[0].uri.fsPath;
        }
    });

    teardown(async () => {
        await printWorkspaceStructure("Standard Workspace Test");
    });

    suiteTeardown(async () => {
        await runWorkspaceSuiteTeardown(originalWorkspaceFolders);
    });

    test("Standard Workspace: Setup → Project → Build", async function () {
        console.log("🚀 Starting standard workspace test...");

        const uiMock = new UIMockInterface();

        await executeTestWithErrorHandling(
            "Standard Workspace Test",
            testWorkspaceDir,
            uiMock,
            async () => {
                await activateExtension();
                uiMock.activate();

                console.log("🔍 Step 0: Checking host tools...");
                const toolsAvailable = await vscode.commands.executeCommand('zephyr-ide.check-host-tools-headless');
                if (!toolsAvailable) {
                    console.log("⚠️  Some host tools are not available - tests may fail");
                }

                const skipDependencyCheck = shouldSkipBuildDependencyCheck();
                const requiresPathPropagation = process.platform === 'darwin' || process.platform === 'win32';

                // Skip build dependency check on Windows/macOS in CI
                // Reason: winget/brew install packages in previous test steps (separate processes)
                // The registry PATH is updated, but new processes don't automatically inherit it without a system restart
                // Tools ARE installed correctly, but not visible in this new process
                if (skipDependencyCheck && requiresPathPropagation) {
                    console.log("📋 Step 1: Skipping build dependencies check (Windows/macOS PATH propagation limitation in CI)...");
                    console.log("   Tools were installed in previous steps but require system-level PATH propagation");
                    console.log("   On Windows: winget updates registry PATH, but new processes don't auto-inherit without restart");
                    console.log("   On macOS: brew updates PATH, but new processes don't auto-inherit without restart");
                } else {
                    console.log("📋 Step 1: Checking build dependencies...");
                    await executeWorkspaceCommand(
                        uiMock,
                        [],
                        "zephyr-ide.check-build-dependencies",
                        "Build dependencies check should succeed"
                    );
                }

                console.log("🏗️ Step 2: Setting up workspace...");
                const setupPromise = startWorkspaceCommand(
                    uiMock,
                    CommonUIInteractions.standardWorkspace,
                    "zephyr-ide.workspace-setup-standard",
                );

                await monitorWorkspaceSetup(setupPromise, "standard workspace");

                console.log("🐍 Verifying Python venv path...");
                const pythonPathResult = await vscode.commands.executeCommand("zephyr-ide.print-python-path");
                assert.ok(
                    pythonPathResult && typeof pythonPathResult === 'object' && 'stdout' in pythonPathResult,
                    `zephyr-ide.print-python-path did not return stdout after a successful setup: ${JSON.stringify(pythonPathResult)}`
                );
                const stdout = (pythonPathResult as { stdout: string }).stdout;
                console.log(`Python path check result: ${stdout}`);
                assert.ok(
                    stdout.includes('.venv') || stdout.includes('venv'),
                    `Python interpreter should be from venv, but got: ${stdout}`
                );
                console.log("    ✅ Verified: Python interpreter is from venv");

                console.log("📁 Step 3: Creating project from template...");
                await executeWorkspaceCommand(
                    uiMock,
                    CommonUIInteractions.createBlinkyProject,
                    "zephyr-ide.create-project",
                    "Project creation should succeed"
                );

                console.log("🔨 Step 4: Adding build configuration...");
                await executeWorkspaceCommand(
                    uiMock,
                    [
                        { type: 'quickpick', value: 'zephyr directory', description: 'Use Zephyr directory only' },
                        { type: 'quickpick', value: 'nucleo_f401re/stm32f401xe', description: 'Select Nucleo board' },
                        { type: 'input', value: 'test_build_1', description: 'Enter build name' },
                        { type: 'quickpick', value: 'debug', description: 'Select debug optimization' },
                        { type: 'input', value: '', description: 'Additional build args' },
                        { type: 'input', value: '-DCONFIG_DEBUG_OPTIMIZATIONS=y -DCONFIG_DEBUG_THREAD_INFO=y ', description: 'CMake args' }
                    ],
                    "zephyr-ide.add-build",
                    "Build configuration should succeed"
                );

                await assertProjectPersisted("Standard Workspace", "blinky", "test_build_1");

                console.log("⚡ Step 5: Executing build...");
                await executeFinalBuild("Standard Workspace");

                console.log("🔄 Step 6: Verifying workspace re-open re-detection...");
                await assertWorkspaceReopenReDetectsVenv("Standard Workspace");
            }
        );
    });
});
