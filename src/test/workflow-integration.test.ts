/*
Copyright 2024 mylonics 
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
import * as fs from "fs-extra";
import * as path from "path";
import * as os from "os";
import { logTestEnvironment, monitorWorkspaceSetup } from "./test-runner";
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

suite("Workflow Integration Test Suite", () => {
    let testWorkspaceDir: string;
    let originalWorkspaceFolders: readonly vscode.WorkspaceFolder[] | undefined;

    suiteSetup(() => {
        logTestEnvironment();
        console.log("🔬 Testing complete Zephyr IDE workflow");
    });

    setup(async () => {
        const existingWorkspace =
            vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        testWorkspaceDir = existingWorkspace
            ? path.join(existingWorkspace, "zephyr-workflow-test")
            : path.join(os.tmpdir(), "zephyr-workflow-test-" + Date.now());

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

        vscode.workspace.getConfiguration = () =>
        ({
            get: () => undefined,
            update: () => Promise.resolve(),
            has: () => false,
            inspect: (key: string) => ({
                key,
                defaultValue: undefined,
                globalValue: undefined,
                workspaceValue: undefined,
                workspaceFolderValue: undefined,
            }),
        } as any);

        vscode.window.showInformationMessage = async () => undefined;
        vscode.window.showWarningMessage = async () => undefined;
        vscode.window.showErrorMessage = async () => undefined;
    });

    teardown(async () => {
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

    test("Complete Workflow: Dependencies → Setup → Project → Build → Execute", async function () {
        this.timeout(1800000);

        console.log("🚀 Starting workflow test...");

        try {
            const extension = vscode.extensions.getExtension("mylonics.zephyr-ide");
            if (extension && !extension.isActive) {
                await extension.activate();
            }
            await new Promise((resolve) => setTimeout(resolve, 3000));

            // Initialize UI Mock Interface
            const uiMock = new UIMockInterface();
            uiMock.activate();


            console.log("📋 Step 1: Checking build dependencies...");
            let result = await vscode.commands.executeCommand(
                "zephyr-ide.check-build-dependencies"
            );
            assert.ok(result, "Build dependencies check should succeed");

            console.log("🏗️ Step 2: Setting up workspace...");
            // Prime the mock interface for workspace setup interactions
            uiMock.primeInteractions([
                { type: 'quickpick', value: 'minimal', description: 'Select minimal manifest' },
                { type: 'quickpick', value: 'stm32', description: 'Select STM32 toolchain' },
                { type: 'quickpick', value: 'v4.2.0', description: 'Select default configuration' },
                { type: 'input', value: '', description: 'Select additional west init args' }
            ]);

            result = await vscode.commands.executeCommand(
                "zephyr-ide.workspace-setup-standard"
            );
            assert.ok(result, "Workspace setup should succeed");

            await monitorWorkspaceSetup();

            console.log("⚙️ Step 3: Installing SDK...");
            // Prime the mock interface for SDK installation interactions
            uiMock.primeInteractions([
                { type: 'quickpick', value: 'automatic', description: 'Select SDK Version' },
                { type: 'quickpick', value: 'select specific', description: 'Select specific toolchains' },
                { type: 'quickpick', value: 'arm-zephyr-eabi', description: 'Select ARM toolchain', multiSelect: true }
            ]);

            result = await vscode.commands.executeCommand("zephyr-ide.install-sdk");
            assert.ok(result, "SDK installation should succeed");

            console.log("📁 Step 4: Creating project from template...");
            // Prime the mock interface for project creation interactions
            uiMock.primeInteractions([
                { type: 'quickpick', value: 'blinky', description: 'Select blinky template' },
                { type: 'input', value: 'blinky', description: 'Enter project name' }
            ]);

            result = await vscode.commands.executeCommand("zephyr-ide.create-project");
            assert.ok(result, "Project creation should succeed");

            console.log("🔨 Step 5: Adding build configuration...");
            // Prime the mock interface for build configuration interactions
            uiMock.primeInteractions([
                { type: 'quickpick', value: 'zephyr directory', description: 'Use Zephyr directory only' },
                { type: 'quickpick', value: 'nucleo_f401', description: 'Select Nucleo board' },
                { type: 'input', value: 'test_build_1', description: 'Enter build name' },
                { type: 'quickpick', value: 'debug', description: 'Select debug optimization' },
                { type: 'input', value: '', description: 'Additional build args' },
                { type: 'input', value: '-DCONFIG_DEBUG_OPTIMIZATIONS=y -DCONFIG_DEBUG_THREAD_INFO=y ', description: 'CMake args' }
            ]);

            result = await vscode.commands.executeCommand("zephyr-ide.add-build");
            assert.ok(result, "Build configuration should succeed");

            console.log("⚡ Step 6: Executing build...");
            result = await vscode.commands.executeCommand("zephyr-ide.build");
            assert.ok(result, "Build execution should succeed");

            // Deactivate the UI Mock Interface
            uiMock.deactivate();

        } catch (error) {
            console.error("❌ Workflow test failed:", error);
            await new Promise((resolve) => setTimeout(resolve, 30000));

            throw error;
        }
    }).timeout(900000);


    test("Git Workspace Setup: West Git → Add Project → Custom Board Build", async function () {
        this.timeout(1800000);

        console.log("🚀 Starting git workspace test...");

        try {
            const extension = vscode.extensions.getExtension("mylonics.zephyr-ide");
            if (extension && !extension.isActive) {
                await extension.activate();
            }
            await new Promise((resolve) => setTimeout(resolve, 3000));

            // Initialize UI Mock Interface for git workflow
            const gitUiMock = new UIMockInterface();
            gitUiMock.activate();


            console.log("🏗️ Step 1: Setting up workspace from West Git...");
            // Prime the mock interface for git workspace setup interactions
            gitUiMock.primeInteractions([
                { type: 'input', value: 'https://github.com/mylonics/zephyr-example.git', description: 'Enter git repo URL' }
            ]);

            let result = await vscode.commands.executeCommand(
                "zephyr-ide.workspace-setup-from-west-git"
            );
            assert.ok(result, "Git workspace setup should succeed");

            await monitorWorkspaceSetup("git workspace");

            console.log("📁 Step 2: Adding project from example repo...");
            // Prime the mock interface for project addition interactions  
            gitUiMock.primeInteractions([
                { type: 'opendialog', value: path.join(testWorkspaceDir, "zephyr-example.git", "app"), description: 'Select app folder' }
            ]);

            result = await vscode.commands.executeCommand("zephyr-ide.add-project");
            assert.ok(result, "Project addition should succeed");

            console.log("🔨 Step 3: Adding build configuration with custom board...");
            // Prime the mock interface for build configuration interactions
            gitUiMock.primeInteractions([
                { type: 'quickpick', value: 'select other folder', description: 'Select other folder for boards' },
                { type: 'opendialog', value: path.join(testWorkspaceDir, "zephyr-example.git", "boards"), description: 'Select boards folder' },
                { type: 'quickpick', value: 'custom_plank', description: 'Select custom_plank board' },
                { type: 'input', value: 'test_build_2', description: 'Enter build name' },
                { type: 'quickpick', value: 'debug', description: 'Select debug optimization' },
                { type: 'input', value: '', description: 'Additional build args' },
                { type: 'input', value: '-DCONFIG_DEBUG_OPTIMIZATIONS=y -DCONFIG_DEBUG_THREAD_INFO=y ', description: 'CMake args' }
            ]);

            const ext = vscode.extensions.getExtension("mylonics.zephyr-ide");
            const wsConfig = ext?.exports?.getWorkspaceConfig();
            if (!wsConfig?.initialSetupComplete) {
                console.log("⚠️ Setup not complete, retrying in 10 seconds...");
                await new Promise((resolve) => setTimeout(resolve, 10000));
            }

            result = await vscode.commands.executeCommand("zephyr-ide.add-build");
            assert.ok(result, "Build configuration should succeed");

            console.log("⚡ Step 4: Executing build with custom board...");
            result = await vscode.commands.executeCommand("zephyr-ide.build");
            assert.ok(result, "Build execution should succeed");

            // Deactivate the UI Mock Interface
            gitUiMock.deactivate();

        } catch (error) {
            console.error("❌ Git workflow test failed:", error);
            await new Promise((resolve) => setTimeout(resolve, 30000));
            throw error;
        }
    }).timeout(900000);

});
