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
} from "./test-runner";

/*
 * WORKSPACE ZEPHYR IDE GIT INTEGRATION TEST:
 *
 * Tests the Zephyr IDE specific git workspace setup workflow:
 * 1. Setup workspace from Zephyr IDE Git repository
 * 2. Install SDK
 * 3. Execute build
 *
 * Uses zephyr-ide.workspace-setup-from-git command with:
 * - Sample project: https://github.com/mylonics/zephyr-ide-samples.git
 * - Automatic SDK installation
 * - Build execution on existing project structure
 *
 * This differs from workspace-west-git.test.ts which uses west manifest
 * repositories and workspace-setup-from-west-git command.
 */

suite("Workspace Zephyr IDE Git Test Suite", () => {
    const { getTestWorkspaceDir } = setupWorkspaceScenarioSuite("Zephyr IDE git workspace", "Zephyr IDE Git Workspace Test");

    test("Zephyr IDE Git Workspace: Git Clone → SDK Install → Build", async function () {
        await runWorkspaceScenarioTest("Zephyr IDE Git Workspace Test", getTestWorkspaceDir(), async (gitUiMock) => {
            console.log("🏗️ Step 1: Setting up workspace from Zephyr IDE Git...");
            // No SDK-version/toolchain quickpicks — SDK install after west
            // update is fully automatic and deterministic
            // (installZephyrIdeRequirements, west-operations.ts), it never
            // shows a picker. See CommonUIInteractions.standardWorkspace's
            // comment in test-runner.ts for the full explanation.
            const setupPromise = startWorkspaceCommand(
                gitUiMock,
                [
                    { type: 'input', value: '--branch main -- https://github.com/mylonics/zephyr-ide-samples.git', description: 'Enter Zephyr IDE git repo URL' },
                    { type: 'quickpick', value: '.west folder', description: 'Use .west folder (Recommended)' },
                ],
                "zephyr-ide.workspace-setup-from-git",
            );

            await monitorWorkspaceSetup(setupPromise, "zephyr ide git workspace");

            console.log("⚡ Step 2: Executing build...");
            await executeFinalBuild("Zephyr IDE Git Workspace");
        });
    });
});
