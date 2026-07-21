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
    monitorWorkspaceSetup,
    startWorkspaceCommand,
    executeFinalBuild,
    executeWorkspaceCommand,
    assertProjectPersisted,
    assertWorkspaceReopenReDetectsVenv,
    setupWorkspaceScenarioSuite,
    runWorkspaceScenarioTest,
    CommonUIInteractions,
    shouldSkipBuildDependencyCheck,
    addAndBuildSysbuild,
    verifyBuildFsFunctions
} from "./test-runner";
import { logDetail, logWarn, createStepLogger } from "./test-log";

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
 *    - setupWorkspaceScenarioSuite / runWorkspaceScenarioTest (test-runner.ts)
 *      handle the suite lifecycle and the uiMock/error-handling wrapper that
 *      are identical across every workspace-*.test.ts file
 *    - Each file only describes its own scenario-specific steps
 *
 * Benefits:
 * - Reduced code duplication (100+ lines removed)
 * - Maintainable and readable tests
 * - Reusable components across test files
 * - Clear intent with descriptive interactions
 */

suite("Workspace Standard Test Suite", () => {
    const { getTestWorkspaceDir } = setupWorkspaceScenarioSuite("standard workspace", "Standard Workspace Test");

    test("Standard Workspace: Setup → Project → Build", async function () {
        await runWorkspaceScenarioTest("Standard Workspace Test", getTestWorkspaceDir(), async (uiMock) => {
            const ctx = "Standard Workspace";
            const step = createStepLogger(ctx);
            step("Checking host tools");
            const toolsAvailable = await vscode.commands.executeCommand('zephyr-ide.check-host-tools-headless');
            if (!toolsAvailable) {
                logWarn(ctx, "Some host tools are not available - tests may fail");
            }

            const skipDependencyCheck = shouldSkipBuildDependencyCheck();
            const requiresPathPropagation = process.platform === 'darwin' || process.platform === 'win32';

            step("Checking build dependencies");
            // Skip build dependency check on Windows/macOS in CI
            // Reason: winget/brew install packages in previous test steps (separate processes)
            // The registry PATH is updated, but new processes don't automatically inherit it without a system restart
            // Tools ARE installed correctly, but not visible in this new process
            if (skipDependencyCheck && requiresPathPropagation) {
                logDetail("Skipped (Windows/macOS PATH propagation limitation in CI)");
            } else {
                await executeWorkspaceCommand(
                    uiMock,
                    [],
                    "zephyr-ide.check-build-dependencies",
                    "Build dependencies check should succeed"
                );
            }

            step("Setting up workspace");
            const setupPromise = startWorkspaceCommand(
                uiMock,
                CommonUIInteractions.standardWorkspace,
                "zephyr-ide.workspace-setup-standard",
            );

            await monitorWorkspaceSetup(setupPromise, "standard workspace");

            const pythonPathResult = await vscode.commands.executeCommand("zephyr-ide.print-python-path");
            assert.ok(
                pythonPathResult && typeof pythonPathResult === 'object' && 'stdout' in pythonPathResult,
                `zephyr-ide.print-python-path did not return stdout after a successful setup: ${JSON.stringify(pythonPathResult)}`
            );
            const stdout = (pythonPathResult as { stdout: string }).stdout;
            assert.ok(
                stdout.includes('.venv') || stdout.includes('venv'),
                `Python interpreter should be from venv, but got: ${stdout}`
            );
            logDetail("Python interpreter resolved from venv");

            step("Creating project from template");
            await executeWorkspaceCommand(
                uiMock,
                CommonUIInteractions.createBlinkyProject,
                "zephyr-ide.create-project",
                "Project creation should succeed"
            );

            step("Adding build configuration");
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

            step("Executing build");
            await executeFinalBuild("Standard Workspace");

            step("Verifying workspace re-open re-detection");
            await assertWorkspaceReopenReDetectsVenv("Standard Workspace");

            step("Adding a sysbuild build and verifying filesystem/parsing functions");
            const { projectName, regularBuildName, sysbuildBuildName } = await addAndBuildSysbuild();
            await verifyBuildFsFunctions(projectName, [
                { build: regularBuildName, sysbuild: false },
                { build: sysbuildBuildName, sysbuild: true },
            ]);
        });
    });
});
