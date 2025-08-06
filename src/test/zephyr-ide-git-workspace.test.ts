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
 * ZEPHYR IDE GIT WORKSPACE INTEGRATION TEST:
 * 
 * Tests the Zephyr IDE specific git workspace setup workflow:
 * 1. Setup workspace from Zephyr IDE Git repository
 * 2. Install SDK
 * 3. Execute build
 * 
 * Uses zephyr-ide.workspace-setup-from-git command with:
 * - Sample project: https://github.com/mylonics/zephyr-ide-sample-project.git
 * - Automatic SDK installation
 * - Build execution on existing project structure
 * 
 * This differs from west-git-workspace.test.ts which uses west manifest
 * repositories and workspace-setup-from-west-git command.
 */

suite("Zephyr IDE Git Workspace Test Suite", () => {
    let testWorkspaceDir: string;
    let originalWorkspaceFolders: readonly vscode.WorkspaceFolder[] | undefined;

    suiteSetup(() => {
        logTestEnvironment();
        console.log("🔬 Testing Zephyr IDE git workspace workflow");
    });

    setup(async () => {
        const existingWorkspace =
            vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        testWorkspaceDir = existingWorkspace
            ? path.join(existingWorkspace, "zephyr-ide-git-workspace-test")
            : path.join(os.tmpdir(), "zephyr-ide-git-workspace-test-" + Date.now());

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

    test("Zephyr IDE Git Workspace: Git Setup → SDK Install → Build", async function () {
        this.timeout(1800000);

        console.log("🚀 Starting Zephyr IDE git workspace test...");

        try {
            const extension = vscode.extensions.getExtension("mylonics.zephyr-ide");
            if (extension && !extension.isActive) {
                await extension.activate();
            }
            await new Promise((resolve) => setTimeout(resolve, 3000));

            // Initialize UI Mock Interface for Zephyr IDE git workflow
            const gitUiMock = new UIMockInterface();
            gitUiMock.activate();

            console.log("🏗️ Step 1: Setting up workspace from Zephyr IDE Git...");
            // Prime the mock interface for Zephyr IDE git workspace setup
            gitUiMock.primeInteractions([
                { type: 'input', value: 'https://github.com/mylonics/zephyr-ide-sample-project.git', description: 'Enter Zephyr IDE git repo URL' }
            ]);

            let result = await vscode.commands.executeCommand(
                "zephyr-ide.workspace-setup-from-git"
            );
            assert.ok(result, "Zephyr IDE git workspace setup should succeed");

            await monitorWorkspaceSetup("Zephyr IDE git workspace");

            console.log("⚙️ Step 2: Installing SDK...");
            // Prime the mock interface for SDK installation interactions
            gitUiMock.primeInteractions([
                { type: 'quickpick', value: 'automatic', description: 'Select SDK Version' },
                { type: 'quickpick', value: 'select specific', description: 'Select specific toolchains' },
                { type: 'quickpick', value: 'arm-zephyr-eabi', description: 'Select ARM toolchain', multiSelect: true }
            ]);

            result = await vscode.commands.executeCommand("zephyr-ide.install-sdk");
            assert.ok(result, "SDK installation should succeed");

            console.log("⚡ Step 3: Executing build...");
            // Wait a moment for workspace setup to complete
            const ext = vscode.extensions.getExtension("mylonics.zephyr-ide");
            const wsConfig = ext?.exports?.getWorkspaceConfig();
            if (!wsConfig?.initialSetupComplete) {
                console.log("⚠️ Setup not complete, retrying in 10 seconds...");
                await new Promise((resolve) => setTimeout(resolve, 10000));
            }

            result = await vscode.commands.executeCommand("zephyr-ide.build");
            assert.ok(result, "Build execution should succeed");

            // Deactivate the UI Mock Interface
            gitUiMock.deactivate();
            await new Promise((resolve) => setTimeout(resolve, 30000));

        } catch (error) {
            console.error("❌ Zephyr IDE git workflow test failed:", error);
            await new Promise((resolve) => setTimeout(resolve, 30000));
            throw error;
        }
    }).timeout(900000);

});
