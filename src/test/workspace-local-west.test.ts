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

import {
    monitorWorkspaceSetup,
    startWorkspaceCommand,
    executeFinalBuild,
    setupWorkspaceScenarioSuite,
    runWorkspaceScenarioTest,
    addAndBuildSysbuild,
    verifyBuildFsFunctions,
} from "./test-runner";
import { logStep } from "./test-log";

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
 * Git command: --branch no_west_folder -- https://github.com/mylonics/zephyr-ide-samples.git
 * UI Flow: "Use Local West Workspace" option when west.yml is detected
 */

suite("Workspace Local West Test Suite", () => {
    const { getTestWorkspaceDir } = setupWorkspaceScenarioSuite("workspace local west", "Local West Workspace Test");

    test("Local West Workspace: Git Clone → Detect West.yml → SDK Install → Build", async function () {
        await runWorkspaceScenarioTest("Local West Workspace Test", getTestWorkspaceDir(), async (uiMock) => {
            const ctx = "Local West Workspace";
            logStep(ctx, "Setting up workspace from git with west.yml detection");
            // No SDK-version/toolchain quickpicks — SDK install after west
            // update is fully automatic and deterministic
            // (installZephyrIdeRequirements, west-operations.ts), it never
            // shows a picker. See CommonUIInteractions.standardWorkspace's
            // comment in test-runner.ts for the full explanation.
            const setupPromise = startWorkspaceCommand(
                uiMock,
                [
                    { type: 'input', value: '--branch no_west_folder -- https://github.com/mylonics/zephyr-ide-samples.git', description: 'Enter git clone string with branch' },
                    { type: 'quickpick', value: 'west.yml file', description: 'Choose Use Local West Workspace option' },
                ],
                "zephyr-ide.workspace-setup-from-git"
            );

            await monitorWorkspaceSetup(setupPromise, "local west workspace");

            await executeFinalBuild("Local West Workspace");

            logStep(ctx, "Adding a sysbuild build and verifying filesystem/parsing functions");
            const { projectName, regularBuildName, sysbuildBuildName } = await addAndBuildSysbuild();
            await verifyBuildFsFunctions(projectName, [
                { build: regularBuildName, sysbuild: false },
                { build: sysbuildBuildName, sysbuild: true },
            ]);
        });
    });
});
