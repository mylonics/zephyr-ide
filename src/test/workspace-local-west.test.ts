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
import {
    logTestEnvironment,
    monitorWorkspaceSetup,
    printWorkspaceOnFailure,
    printWorkspaceOnSuccess,
    setupTestWorkspace,
    cleanupTestWorkspace,
    activateExtension,
    executeFinalBuild,
    executeTestWithErrorHandling
} from "./test-runner";
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
        const workspace = await setupTestWorkspace("curr-dir");
        testWorkspaceDir = workspace.testWorkspaceDir;
        originalWorkspaceFolders = workspace.originalWorkspaceFolders;
    });

    teardown(async () => {
        await cleanupTestWorkspace(testWorkspaceDir, originalWorkspaceFolders);
    });

    test("Open Current Directory: Git Setup → Detect West.yml → Build", async function () {
        this.timeout(620000);

        console.log("🚀 Starting open current directory test...");

        const uiMock = new UIMockInterface();

        await executeTestWithErrorHandling(
            "Local West Workspace Test",
            testWorkspaceDir,
            uiMock,
            async () => {
                await activateExtension();

                // Initialize UI Mock Interface
                uiMock.activate();

                console.log("🏗️ Step 1: Setting up workspace from git with west.yml detection...");
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
                await executeFinalBuild("Local West Workspace");
            }
        );
    }).timeout(900000);

});
