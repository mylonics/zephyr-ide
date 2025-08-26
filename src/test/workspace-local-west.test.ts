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
import { logTestEnvironment, monitorWorkspaceSetup, printWorkspaceOnFailure } from "./test-runner";
import { UIMockInterface, MockInteraction } from "./ui-mock-interface";

/*
 * WORKSPACE LOCAL WEST INTEGRATION TEST:
 * 
 * Tests the workspace setup from git with detected west.yml files:
 * 1. Setup workspace from git with --branch no_west_folder
 * 2. When prompted, choose detected west.yml file (not external install)
 * 3. Execute build
 * 
 * This tests the scenario where a git repository contains west.yml files
 * and the user chooses to use the local west workspace rather than
 * an existing Zephyr installation.
 * 
 * Git command: --branch no_west_folder -- https://github.com/mylonics/zephyr-ide-sample-project.git
 * UI Flow: "Use Local West Workspace" option when west.yml is detected
 */

suite("Workspace Local West Test Suite", () => {
    let testWorkspaceDir: string;
    let originalWorkspaceFolders: readonly vscode.WorkspaceFolder[] | undefined;

    suiteSetup(() => {
        logTestEnvironment();
        console.log("🔬 Testing workspace local west workflow");
    });

    setup(async () => {
        // Always use isolated temporary directory to ensure empty folder
        testWorkspaceDir = path.join(os.tmpdir(), "curr-dir-" + Date.now());

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

    test("Open Current Directory: Git Setup → Detect West.yml → Build", async function () {
        this.timeout(620000);

        console.log("🚀 Starting open current directory test...");

        try {
            const extension = vscode.extensions.getExtension("mylonics.zephyr-ide");
            if (extension && !extension.isActive) {
                await extension.activate();
            }
            await new Promise((resolve) => setTimeout(resolve, 3000));

            // Initialize UI Mock Interface
            const uiMock = new UIMockInterface();
            uiMock.activate();

            console.log("🏗️ Step 1: Setting up workspace from git with west.yml detection...");
            // Prime the mock interface for git setup with branch argument
            uiMock.primeInteractions([
                { type: 'input', value: '--branch no_west_folder -- https://github.com/mylonics/zephyr-ide-samples.git', description: 'Enter git clone string with branch' },
                { type: 'quickpick', value: 'local-west', description: 'Choose Use Local West Workspace option' },
                { type: 'quickpick', value: 'automatic', description: 'Select SDK Version' },
                { type: 'quickpick', value: 'select specific', description: 'Select specific toolchains' },
                { type: 'quickpick', value: 'arm-zephyr-eabi', description: 'Select ARM toolchain', multiSelect: true }
            ]);

            let result = await vscode.commands.executeCommand(
                "zephyr-ide.workspace-setup-from-git"
            );
            assert.ok(result, "Git workspace setup should succeed");

            console.log("🔍 Step 2: Choosing detected west.yml file...");

            await monitorWorkspaceSetup("open current directory");

            console.log("⚡ Step 3: Executing build...");
            // Wait for workspace setup to complete
            const ext = vscode.extensions.getExtension("mylonics.zephyr-ide");
            const wsConfig = ext?.exports?.getWorkspaceConfig();
            if (!wsConfig?.initialSetupComplete) {
                console.log("⚠️ Setup not complete, retrying in 10 seconds...");
                await new Promise((resolve) => setTimeout(resolve, 10000));
            }

            result = await vscode.commands.executeCommand("zephyr-ide.build");
            assert.ok(result, "Build execution should succeed");

            // Deactivate the UI Mock Interface
            uiMock.deactivate();

        } catch (error) {
            await printWorkspaceOnFailure(testWorkspaceDir, "Local West Workspace", error);
            await new Promise((resolve) => setTimeout(resolve, 30000));
            throw error;
        }
    }).timeout(900000);

});
