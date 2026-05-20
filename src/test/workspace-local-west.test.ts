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
import {
    logTestEnvironment,
    monitorWorkspaceSetup,
    startWorkspaceCommand,
    printWorkspaceStructure,
    runWorkspaceSuiteTeardown,
    activateExtension,
    executeFinalBuild,
    executeTestWithErrorHandling,
    getTestEnvConfig
} from "./test-runner";
import { UIMockInterface } from "./ui-mock-interface";

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
        originalWorkspaceFolders = vscode.workspace.workspaceFolders;
        if (originalWorkspaceFolders) {
            testWorkspaceDir = originalWorkspaceFolders[0].uri.fsPath;
        }
    });

    teardown(async () => {
        await printWorkspaceStructure("Local West Workspace Test");
    });

    suiteTeardown(async () => {
        await runWorkspaceSuiteTeardown(originalWorkspaceFolders);
    });

    test("Local West Workspace: Git Clone → Detect West.yml → SDK Install → Build", async function () {
        console.log("🚀 Starting local west workspace test...");

        const uiMock = new UIMockInterface();

        await executeTestWithErrorHandling(
            "Local West Workspace Test",
            testWorkspaceDir,
            uiMock,
            async () => {
                await activateExtension();

                // Initialize UI Mock Interface
                uiMock.activate();

                const { toolchainTarget } = getTestEnvConfig();
                console.log("🏗️ Step 1: Setting up workspace from git with west.yml detection...");
                const setupPromise = startWorkspaceCommand(
                    uiMock,
                    [
                        { type: 'input', value: '--branch no_west_folder -- https://github.com/mylonics/zephyr-ide-samples.git', description: 'Enter git clone string with branch' },
                        { type: 'quickpick', value: 'west.yml file', description: 'Choose Use Local West Workspace option' },
                        { type: 'quickpick', value: 'automatic', description: 'Select SDK Version' },
                        { type: 'quickpick', value: 'select specific', description: 'Select specific toolchains' },
                        { type: 'quickpick', value: toolchainTarget, description: `Select ${toolchainTarget} toolchain`, multiSelect: true }
                    ],
                    "zephyr-ide.workspace-setup-from-git"
                );

                await monitorWorkspaceSetup(setupPromise, "local west workspace");

                console.log("⚡ Step 2: Executing build...");
                await executeFinalBuild("Local West Workspace");
            }
        );
    }).timeout(900000);

});
