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

import * as vscode from "vscode";
import * as os from "os";
import * as path from "path";
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
    getTestEnvConfig
} from "./test-runner";
import { UIMockInterface } from "./ui-mock-interface";

/*
 * WORKSPACE EXTERNAL ZEPHYR INTEGRATION TEST:
 * 
 * Tests the out-of-tree workspace setup workflow:
 * 1. Setup workspace from git with --branch no_west
 * 2. When prompted, choose "Use Existing Zephyr Installation"
 * 3. Select "New Installation" option and choose ~/.zephyr_ide as the directory
 * 4. Go through west selector process (minimal, stm32)
 * 5. Execute build
 * 
 * This tests the scenario where a git repository does not contain
 * west.yml files and the user chooses to use an external Zephyr
 * installation in the default ~/.zephyr_ide directory.
 * 
 * Git command: --branch no_west -- https://github.com/mylonics/zephyr-ide-sample-project.git
 * UI Flow: "Use Existing Zephyr Installation" → "New Installation" → directory picker → west selector
 */

suite("Workspace External Zephyr Test Suite", () => {
    let testWorkspaceDir: string;
    let originalWorkspaceFolders: readonly vscode.WorkspaceFolder[] | undefined;

    suiteSetup(() => {
        logTestEnvironment();
        console.log("🔬 Testing workspace external zephyr workflow");
    });

    setup(async () => {
        originalWorkspaceFolders = vscode.workspace.workspaceFolders;
        if (originalWorkspaceFolders) {
            testWorkspaceDir = originalWorkspaceFolders[0].uri.fsPath;
        }
    });

    teardown(async () => {
        await printWorkspaceStructure("External Zephyr Workspace Test");
    });

    suiteTeardown(async () => {
        await runWorkspaceSuiteTeardown(originalWorkspaceFolders);
    });

    test("External Zephyr Workspace: Git Clone → Use Existing Install → West Selector → Build", async function () {
        console.log("🚀 Starting external zephyr workspace test...");

        const uiMock = new UIMockInterface();

        await executeTestWithErrorHandling(
            "External Zephyr Workspace Test",
            testWorkspaceDir,
            uiMock,
            async () => {
                await activateExtension();
                uiMock.activate();

                const { sdkVersion, toolchain, toolchainTarget } = getTestEnvConfig();
                console.log("🏗️ Step 1: Setting up workspace from git without west folder...");
                const setupPromise = startWorkspaceCommand(
                    uiMock,
                    [
                        { type: 'input', value: '--branch no_west -- https://github.com/mylonics/zephyr-ide-samples.git', description: 'Enter git clone string for no_west branch' },
                        { type: 'quickpick', value: 'Use external Zephyr installation', description: 'Choose Use Existing Zephyr Installation option' },
                        { type: 'quickpick', value: 'New Installation', description: 'Choose New Installation option' },
                        { type: 'opendialog', value: path.join(os.homedir(), '.zephyr_ide'), description: 'Select ~/.zephyr_ide as installation directory' },
                        { type: 'quickpick', value: 'minimal zephyr', description: 'Select minimal Zephyr manifest (not BLE)' },
                        { type: 'quickpick', value: toolchain, description: `Select ${toolchain} toolchain` },
                        { type: 'quickpick', value: sdkVersion, description: `Select ${sdkVersion} Zephyr version` },
                        { type: 'input', value: '', description: 'Select additional west init args' },
                        { type: 'quickpick', value: 'automatic', description: 'Select SDK Version' },
                        { type: 'quickpick', value: 'select specific', description: 'Select specific toolchains' },
                        { type: 'quickpick', value: toolchainTarget, description: `Select ${toolchainTarget} toolchain`, multiSelect: true }
                    ],
                    "zephyr-ide.workspace-setup-from-git",
                );

                await monitorWorkspaceSetup(setupPromise, "external zephyr workspace");

                console.log("⚡ Step 2: Executing build...");
                await executeFinalBuild("External Zephyr Workspace");
            }
        );
    });
}).timeout(900000);
