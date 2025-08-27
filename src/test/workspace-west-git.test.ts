/*
Copyright 2024 mylonics 
Author Rijesh Augustine

Licensed usuite("Workspace West Git Test Suite", () => {
    let testWorkspaceDir: string;
    let originalWorkspaceFolders: readonly vscode.WorkspaceFolder[] | undefined;

    suiteSetup(() => {
        logTestEnvironment();
        console.log("🔬 Testing west git workspace workflow");e Apache License, Version 2.0 (the "License");
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
 * GIT WORKFLOW INTEGRATION TEST:
 * 
 * Tests the git-based workspace setup workflow:
 * 1. Setup workspace from West Git repository
 * 2. Add project from example repository
 * 3. Configure build with custom board
 * 4. Execute build
 * 
 * Uses the same architecture as standard workflow test:
 * - UI Mock Interface for all VSCode interactions
 * - Centralized workspace monitoring
 * - Clean separation of concerns
 */

suite("West Git Workspace Test Suite", () => {
    let testWorkspaceDir: string;
    let originalWorkspaceFolders: readonly vscode.WorkspaceFolder[] | undefined;

    suiteSetup(() => {
        logTestEnvironment();
        console.log("🔬 Testing Zephyr IDE git workflow");
    });

    setup(async () => {
        const workspace = await setupTestWorkspace("west-git");
        testWorkspaceDir = workspace.testWorkspaceDir;
        originalWorkspaceFolders = workspace.originalWorkspaceFolders;
    });

    teardown(async () => {
        await cleanupTestWorkspace(testWorkspaceDir, originalWorkspaceFolders);
    });

    test("Git Workspace Setup: West Git → SDK Install → Add Project → Custom Board Build", async function () {
        this.timeout(620000);

        console.log("🚀 Starting git workspace test...");
        console.log("📁 Test workspace folder:", testWorkspaceDir);

        const gitUiMock = new UIMockInterface();

        await executeTestWithErrorHandling(
            "West Git Workspace Test",
            testWorkspaceDir,
            gitUiMock,
            async () => {
                await activateExtension();
                gitUiMock.activate();

                console.log("🏗️ Step 1: Setting up workspace from West Git...");
                await executeWorkspaceCommand(
                    gitUiMock,
                    [
                        { type: 'input', value: 'https://github.com/mylonics/zephyr-ide-samples', description: 'Enter git repo URL' },
                        { type: 'input', value: '--mr west_repo', description: 'Enter additional arguments for west' },
                        { type: 'quickpick', value: 'automatic', description: 'Select SDK Version' },
                        { type: 'quickpick', value: 'select specific', description: 'Select specific toolchains' },
                        { type: 'quickpick', value: 'arm-zephyr-eabi', description: 'Select ARM toolchain', multiSelect: true }
                    ],
                    "zephyr-ide.workspace-setup-from-west-git",
                    "Git workspace setup should succeed"
                );

                await monitorWorkspaceSetup("git workspace");

                console.log("📁 Step 2: Adding project from example repo...");
                await executeWorkspaceCommand(
                    gitUiMock,
                    [
                        { type: 'opendialog', value: path.join(testWorkspaceDir, "zephyr-ide-samples", "app"), description: 'Select app folder' }
                    ],
                    "zephyr-ide.add-project",
                    "Project addition should succeed"
                );

                console.log("🔨 Step 3: Adding build configuration with custom board...");
                await executeWorkspaceCommand(
                    gitUiMock,
                    [
                        { type: 'quickpick', value: 'select other folder', description: 'Select other folder for boards' },
                        { type: 'opendialog', value: path.join(testWorkspaceDir, "zephyr-ide-samples", "boards"), description: 'Select boards folder' },
                        { type: 'quickpick', value: 'custom_plank', description: 'Select custom_plank board' },
                        { type: 'input', value: 'test_build_2', description: 'Enter build name' },
                        { type: 'quickpick', value: 'debug', description: 'Select debug optimization' },
                        { type: 'input', value: '', description: 'Additional build args' },
                        { type: 'input', value: '-DCONFIG_DEBUG_OPTIMIZATIONS=y -DCONFIG_DEBUG_THREAD_INFO=y ', description: 'CMake args' }
                    ],
                    "zephyr-ide.add-build",
                    "Build configuration should succeed"
                );

                console.log("⚡ Step 4: Executing build with custom board...");
                await executeFinalBuild("West Git Workspace");
            }
        );
    }).timeout(900000);

});
