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
import * as fs from "fs";
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
    assertProjectPersisted,
    CommonUIInteractions,
    addAndBuildSysbuild,
    verifyBuildFsFunctions,
} from "./test-runner";
import { UIMockInterface } from "./ui-mock-interface";

/**
 * Resolve a same-drive directory for the external Zephyr installation.
 * On Windows, $TEMP is on D: (see workspace-setup-tests.yml) but $HOME is on C:.
 * Placing the external install on the same drive as the workspace avoids cross-
 * drive issues when west resolves topdir / BOARD_ROOT relative to setupPath.
 */
function getExternalDirectoryInstallDir(): string {
    return path.join(os.tmpdir(), "zide-external-directory-cmd");
}

/*
 * WORKSPACE SETUP FROM EXTERNAL DIRECTORY INTEGRATION TEST:
 *
 * Tests the zephyr-ide.workspace-setup-from-external-directory command,
 * distinct from workspace-external-zephyr.test.ts's zephyr-ide.workspace-setup-from-git
 * flow (which starts from a git clone and only offers "use external
 * installation" as one option among several after the clone). This command
 * starts DIRECTLY from a folder picker — no git clone involved — for
 * pointing the workspace at an existing (or to-be-created) Zephyr
 * installation directory that lives outside the open workspace folder.
 *
 * Flow (src/setup_utilities/workspace-setup.ts:935-974):
 * 1. showOpenDialog to choose the external install directory
 * 2. westConfig on that directory (showUseExternalInstallation: false, so
 *    the option set is identical to the standard/current-directory flow:
 *    "Create new west.yml" / "Mark workspace as already set up" etc.)
 * 3. westSelector template/HAL/version wizard (same as CommonUIInteractions.standardWorkspace)
 * 4. SDK install
 *
 * Because the Zephyr installation lives outside the workspace root
 * (setupPath !== rootPath, like workspace-external-zephyr.test.ts), a
 * project/build must still be created against the *workspace* root — unlike
 * the git-clone-based external test, there's no pre-existing sample project
 * checked out, so this mirrors workspace-standard.test.ts's create-project +
 * add-build steps.
 */
suite("Workspace Setup From External Directory Test Suite", () => {
    let testWorkspaceDir: string;
    let originalWorkspaceFolders: readonly vscode.WorkspaceFolder[] | undefined;

    suiteSetup(() => {
        logTestEnvironment();
        console.log("🔬 Testing workspace-setup-from-external-directory workflow");
    });

    setup(async () => {
        originalWorkspaceFolders = vscode.workspace.workspaceFolders;
        if (originalWorkspaceFolders) {
            testWorkspaceDir = originalWorkspaceFolders[0].uri.fsPath;
        }
    });

    teardown(async () => {
        await printWorkspaceStructure("Workspace Setup From External Directory Test");
    });

    suiteTeardown(async () => {
        await runWorkspaceSuiteTeardown(originalWorkspaceFolders);
    });

    test("Workspace Setup From External Directory: Folder Picker → West Selector → Project → Build", async function () {
        console.log("🚀 Starting workspace-setup-from-external-directory test...");

        const uiMock = new UIMockInterface();

        await executeTestWithErrorHandling(
            "Workspace Setup From External Directory Test",
            testWorkspaceDir,
            uiMock,
            async () => {
                await activateExtension();
                uiMock.activate();

                const externalInstallDir = getExternalDirectoryInstallDir();
                // The OpenDialog mock skips real folder validation, but the workspace-setup
                // code path requires the chosen directory to already exist
                // (loadExternalSetupState returns undefined otherwise). Create it up front
                // so it mirrors what a real user would pick from the system file picker.
                fs.mkdirSync(externalInstallDir, { recursive: true });
                console.log(`🏗️ Step 1: Setting up workspace from external directory...`);
                console.log(`   External install directory: ${externalInstallDir}`);

                const setupPromise = startWorkspaceCommand(
                    uiMock,
                    [
                        { type: 'opendialog', value: externalInstallDir, description: 'Select external install directory (same drive as workspace)' },
                        ...CommonUIInteractions.standardWorkspace,
                    ],
                    "zephyr-ide.workspace-setup-from-external-directory",
                );

                await monitorWorkspaceSetup(setupPromise, "external directory workspace");

                console.log("📁 Step 2: Creating project from template...");
                await executeWorkspaceCommand(
                    uiMock,
                    CommonUIInteractions.createBlinkyProject,
                    "zephyr-ide.create-project",
                    "Project creation should succeed"
                );

                console.log("🔨 Step 3: Adding build configuration...");
                await executeWorkspaceCommand(
                    uiMock,
                    [
                        { type: 'quickpick', value: 'zephyr directory', description: 'Use Zephyr directory only' },
                        { type: 'quickpick', value: 'nucleo_f401re/stm32f401xe', description: 'Select Nucleo board' },
                        { type: 'input', value: 'test_build_1', description: 'Enter build name' },
                        { type: 'quickpick', value: 'debug', description: 'Select debug optimization' },
                        { type: 'input', value: '', description: 'Additional build args' },
                        { type: 'input', value: '', description: 'CMake args' }
                    ],
                    "zephyr-ide.add-build",
                    "Build configuration should succeed"
                );

                await assertProjectPersisted("Workspace Setup From External Directory", "blinky", "test_build_1");

                console.log("⚡ Step 4: Executing build...");
                await executeFinalBuild("Workspace Setup From External Directory");

                console.log("🧪 Step 5: Adding a sysbuild build and verifying filesystem/parsing functions...");
                const { projectName, regularBuildName, sysbuildBuildName } = await addAndBuildSysbuild();
                await verifyBuildFsFunctions(projectName, [
                    { build: regularBuildName, sysbuild: false },
                    { build: sysbuildBuildName, sysbuild: true },
                ]);
            }
        );
    });
});
