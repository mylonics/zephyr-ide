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

import * as path from "path";
import {
    monitorWorkspaceSetup,
    startWorkspaceCommand,
    executeFinalBuild,
    executeWorkspaceCommand,
    setupWorkspaceScenarioSuite,
    runWorkspaceScenarioTest,
} from "./test-runner";

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

suite("Workspace West Git Test Suite", () => {
    const { getTestWorkspaceDir } = setupWorkspaceScenarioSuite("west git workspace", "West Git Workspace Test");

    test("West Git Workspace: West Manifest → SDK Install → Add Project → Custom Board Build", async function () {
        const testWorkspaceDir = getTestWorkspaceDir();
        console.log("📁 Test workspace folder:", testWorkspaceDir);

        await runWorkspaceScenarioTest("West Git Workspace Test", testWorkspaceDir, async (gitUiMock) => {
            console.log("🏗️ Step 1: Setting up workspace from West Git...");
            // No SDK-version/toolchain quickpicks — SDK install after west
            // update is fully automatic and deterministic
            // (installZephyrIdeRequirements, west-operations.ts), it never
            // shows a picker. See CommonUIInteractions.standardWorkspace's
            // comment in test-runner.ts for the full explanation.
            const setupPromise = startWorkspaceCommand(
                gitUiMock,
                [
                    { type: 'input', value: 'https://github.com/mylonics/zephyr-ide-samples', description: 'Enter git repo URL' },
                    { type: 'input', value: '--mr west_repo', description: 'Enter additional arguments for west' },
                ],
                "zephyr-ide.workspace-setup-from-west-git",
            );

            await monitorWorkspaceSetup(setupPromise, "west git workspace");

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
        });
    });
});
