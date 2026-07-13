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

import * as assert from "assert";
import * as vscode from "vscode";
import { activateExtension } from "./test-runner";

/*
 * Negative-path coverage for commands that require an initialized ("west
 * updated") workspace. These run in the `unit` label (fast, no SDK/network)
 * because the guard in each command handler bails out — cleanly, with no
 * side effects — before doing any west/SDK work:
 *
 *   zephyr-ide.add-build (src/extension.ts ~1410-1421) and
 *   zephyr-ide.add-test  (src/extension.ts ~1427-1436)
 *
 * both check `setupState && setupState.westUpdated` before calling into
 * project.addBuild/addTest, and log+return early otherwise. This suite
 * asserts that early-return contract holds on a workspace that was never
 * set up, which is exactly the state of the shared test workspace when the
 * `unit` label runs (none of the other unit test files invoke a real
 * workspace-setup-* command — those live only in the `integration` label).
 *
 * Both guards call getSetupState(), which — when activeSetupState is unset
 * AND neither ZEPHYR_BASE nor ZEPHYR_SDK_INSTALL_DIR is in the environment —
 * awaits a REAL vscode.window.showWarningMessage(...) via
 * checkAndWarnMissingEnvironment (workspace-config.ts:1036-1064). That
 * dialog is not intercepted by UIMockInterface (which only mocks
 * quickpick/input/opendialog) and never resolves with no user present,
 * hanging the test indefinitely. Setting the
 * "zephyr-ide.suppressWorkspaceWarning" workspace setting short-circuits
 * checkAndWarnMissingEnvironment before it shows the dialog — the same
 * setting a real user gets by clicking "Don't Show Again" on that warning.
 */
suite("Workspace Setup Negative Paths Test Suite", () => {

    const suppressWarningKey = "zephyr-ide.suppressWorkspaceWarning";

    suiteSetup(async () => {
        await activateExtension();
        await vscode.workspace.getConfiguration().update(suppressWarningKey, true, vscode.ConfigurationTarget.Workspace);
    });

    suiteTeardown(async () => {
        await vscode.workspace.getConfiguration().update(suppressWarningKey, undefined, vscode.ConfigurationTarget.Workspace);
    });

    test("zephyr-ide.add-build on an uninitialized workspace resolves false without throwing", async () => {
        const result = await vscode.commands.executeCommand("zephyr-ide.add-build");
        assert.strictEqual(result, false, "add-build must return false (not throw, not hang) when west was never updated");
    });

    test("zephyr-ide.add-test on an uninitialized workspace resolves without throwing", async () => {
        const result = await vscode.commands.executeCommand("zephyr-ide.add-test");
        assert.strictEqual(result, undefined, "add-test must resolve (not throw, not hang) when west was never updated");
    });
});
