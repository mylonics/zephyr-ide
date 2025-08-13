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
 * WORKSPACE OUT OF TREE INTEGRATION TEST:
 * 
 * Tests the out-of-tree workspace setup workflow:
 * 1. Setup workspace from git with --branch no_west
 * 2. When prompted, choose "Use Existing Zephyr Installation"
 * 3. Select "Global Installation" option
 * 4. Go through west selector process (minimal, stm32)
 * 5. Execute build
 * 
 * This tests the scenario where a git repository does not contain
 * west.yml files and the user chooses to use an existing Zephyr
 * installation with global installation type.
 * 
 * Git command: --branch no_west -- https://github.com/mylonics/zephyr-ide-sample-project.git
 * UI Flow: "Use Existing Zephyr Installation" → "Global Installation" → west selector
 */

suite("Workspace Out Of Tree Test Suite", () => {
    let testWorkspaceDir: string;
    let originalWorkspaceFolders: readonly vscode.WorkspaceFolder[] | undefined;

    suiteSetup(() => {
        logTestEnvironment();
        console.log("🔬 Testing workspace out of tree workflow");
    });

    setup(async () => {
        const existingWorkspace =
            vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        testWorkspaceDir = existingWorkspace
            ? path.join(existingWorkspace, "out-tree")
            : path.join(os.tmpdir(), "out-tree-" + Date.now());

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

    test("Workspace Out Of Tree: Git Setup → Use Existing → Global → West Selector → Build", async function () {
        this.timeout(620000);

        console.log("🚀 Starting workspace out of tree test...");

        try {
            const extension = vscode.extensions.getExtension("mylonics.zephyr-ide");
            if (extension && !extension.isActive) {
                await extension.activate();
            }
            await new Promise((resolve) => setTimeout(resolve, 3000));

            // Initialize UI Mock Interface
            const uiMock = new UIMockInterface();
            uiMock.activate();

            console.log("🏗️ Step 1: Setting up workspace from git without west folder...");
            // Prime the mock interface for git setup with no_west branch
            uiMock.primeInteractions([
                { type: 'input', value: '--branch no_west -- https://github.com/mylonics/zephyr-ide-samples.git', description: 'Enter git clone string for no_west branch' },
                { type: 'quickpick', value: '$(link) Use external Zephyr installation', description: 'Choose Use Existing Zephyr Installation option' },
                { type: 'quickpick', value: '$(link) Global Installation', description: 'Choose Global Installation option' },
                { type: 'quickpick', value: 'minimal', description: 'Select minimal manifest' },
                { type: 'quickpick', value: 'stm32', description: 'Select STM32 toolchain' },
                { type: 'quickpick', value: 'v4.2.0', description: 'Select default configuration' },
                { type: 'input', value: '', description: 'Select additional west init args' },
                { type: 'quickpick', value: 'automatic', description: 'Select SDK Version' },
                { type: 'quickpick', value: 'select specific', description: 'Select specific toolchains' },
                { type: 'quickpick', value: 'arm-zephyr-eabi', description: 'Select ARM toolchain', multiSelect: true }


            ]);


            let result = await vscode.commands.executeCommand(
                "zephyr-ide.workspace-setup-from-git"
            );
            assert.ok(result, "Git workspace setup should succeed");

            await monitorWorkspaceSetup("workspace out of tree");

            console.log("⚡ Step 2: Executing build...");
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
            console.error("❌ Workspace out of tree test failed:", error);
            await new Promise((resolve) => setTimeout(resolve, 30000));
            throw error;
        }
    }).timeout(900000);

});
