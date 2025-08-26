/*
Copyright 2024 mylonics 
Author Rijesh Augustisuite("Workspace Standard Test Suite", () => {
    let testWorkspaceDir: string;
    let originalWorkspaceFolders: readonly vscode.WorkspaceFolder[] | undefined;

    suiteSetup(() => {
        logTestEnvironment();
        console.log("🔬 Testing standard workspace workflow");icensed under the Apache License, Version 2.0 (the "License");
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
import * as fs from "fs-extra";
import * as path from "path";
import * as os from "os";
import {
    logTestEnvironment,
    monitorWorkspaceSetup,
    printWorkspaceOnFailure,
    printWorkspaceOnSuccess,
    setupTestWorkspace,
    cleanupTestWorkspace,
    activateExtension,
    executeFinalBuild,
    executeTestWithErrorHandling,
    executeWorkspaceCommand,
    CommonUIInteractions
} from "./test-runner";
import { UIMockInterface, MockInteraction } from "./ui-mock-interface";

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

suite("Standard Workspace Test Suite", () => {
    let testWorkspaceDir: string;
    let originalWorkspaceFolders: readonly vscode.WorkspaceFolder[] | undefined;

    suiteSetup(() => {
        logTestEnvironment();
        console.log("🔬 Testing standard Zephyr IDE workflow");
    });

    setup(async () => {
        const workspace = await setupTestWorkspace("std");
        testWorkspaceDir = workspace.testWorkspaceDir;
        originalWorkspaceFolders = workspace.originalWorkspaceFolders;
    });

    teardown(async () => {
        await cleanupTestWorkspace(testWorkspaceDir, originalWorkspaceFolders);
    });

    test("Complete Workflow: Dependencies → Setup → Project → Build → Execute", async function () {
        this.timeout(900000);

        console.log("🚀 Starting workflow test...");

        const uiMock = new UIMockInterface();

        await executeTestWithErrorHandling(
            "Standard Workspace Test",
            testWorkspaceDir,
            uiMock,
            async () => {
                await activateExtension();
                uiMock.activate();

                console.log("📋 Step 1: Checking build dependencies...");
                await executeWorkspaceCommand(
                    uiMock,
                    [],
                    "zephyr-ide.check-build-dependencies",
                    "Build dependencies check should succeed"
                );

                console.log("🏗️ Step 2: Setting up workspace...");
                await executeWorkspaceCommand(
                    uiMock,
                    CommonUIInteractions.standardWorkspace,
                    "zephyr-ide.workspace-setup-standard",
                    "Workspace setup should succeed"
                );

                await monitorWorkspaceSetup();

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
                        { type: 'quickpick', value: 'nucleo_f401', description: 'Select Nucleo board' },
                        { type: 'input', value: 'test_build_1', description: 'Enter build name' },
                        { type: 'quickpick', value: 'debug', description: 'Select debug optimization' },
                        { type: 'input', value: '', description: 'Additional build args' },
                        { type: 'input', value: '-DCONFIG_DEBUG_OPTIMIZATIONS=y -DCONFIG_DEBUG_THREAD_INFO=y ', description: 'CMake args' }
                    ],
                    "zephyr-ide.add-build",
                    "Build configuration should succeed"
                );

                await new Promise((resolve) => setTimeout(resolve, 10000));
                console.log("⚡ Step 5: Executing build...");
                await executeFinalBuild("Standard Workspace");
            }
        );
    }).timeout(900000);




});
