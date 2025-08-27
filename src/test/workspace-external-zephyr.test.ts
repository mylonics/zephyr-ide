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
    printWorkspaceStructure,
    setupTestWorkspace,
    cleanupTestWorkspace,
    activateExtension,
    executeFinalBuild,
    executeTestWithErrorHandling,
    executeWorkspaceCommand
} from "./test-runner";
import { UIMockInterface, MockInteraction } from "./ui-mock-interface";

/*
 * WORKSPACE EXTERNAL ZEPHYR INTEGRATION TEST:
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

suite("Workspace External Zephyr Test Suite", () => {
    let testWorkspaceDir: string;
    let originalWorkspaceFolders: readonly vscode.WorkspaceFolder[] | undefined;

    suiteSetup(() => {
        logTestEnvironment();
        console.log("🔬 Testing workspace external zephyr workflow");
    });

    setup(async () => {
        const workspace = await setupTestWorkspace("out-tree");
        testWorkspaceDir = workspace.testWorkspaceDir;
        originalWorkspaceFolders = workspace.originalWorkspaceFolders;
    });

    teardown(async () => {
        await cleanupTestWorkspace(testWorkspaceDir, originalWorkspaceFolders);
    });

    test("Workspace Out Of Tree: Git Setup → Use Existing → Global → West Selector → Build", async function () {
        this.timeout(620000);

        console.log("🚀 Starting workspace out of tree test...");

        const uiMock = new UIMockInterface();

        await executeTestWithErrorHandling(
            "External Zephyr Workspace Test",
            testWorkspaceDir,
            uiMock,
            async () => {
                await activateExtension();
                uiMock.activate();

                console.log("🏗️ Step 1: Setting up workspace from git without west folder...");
                await executeWorkspaceCommand(
                    uiMock,
                    [
                        { type: 'input', value: '--branch no_west -- https://github.com/mylonics/zephyr-ide-samples.git', description: 'Enter git clone string for no_west branch' },
                        { type: 'quickpick', value: 'Use external Zephyr installation', description: 'Choose Use Existing Zephyr Installation option' },
                        { type: 'quickpick', value: 'Global Installation', description: 'Choose Global Installation option' },
                        { type: 'quickpick', value: 'minimal', description: 'Select minimal manifest' },
                        { type: 'quickpick', value: 'stm32', description: 'Select STM32 toolchain' },
                        { type: 'quickpick', value: 'v4.2.0', description: 'Select default configuration' },
                        { type: 'input', value: '', description: 'Select additional west init args' },
                        { type: 'quickpick', value: 'automatic', description: 'Select SDK Version' },
                        { type: 'quickpick', value: 'select specific', description: 'Select specific toolchains' },
                        { type: 'quickpick', value: 'arm-zephyr-eabi', description: 'Select ARM toolchain', multiSelect: true }
                    ],
                    "zephyr-ide.workspace-setup-from-git",
                    "Git workspace setup should succeed"
                );

                await monitorWorkspaceSetup("workspace out of tree");

                console.log("⚡ Step 2: Executing build...");
                await executeFinalBuild("External Zephyr Workspace");
            }
        );
    }).timeout(900000);

});
