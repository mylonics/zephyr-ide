/*
Copyright 2026 mylonics 
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
import { WEST_RUNNERS, getExtraRunners, getAllWestRunners } from "../project_utilities/runner_selector";

suite("Extra Runners Configuration Test Suite", () => {
    async function resetSetting(config: vscode.WorkspaceConfiguration) {
        await config.update("zephyr-ide.extraRunners", undefined, vscode.ConfigurationTarget.Global);
    }

    test("getExtraRunners returns an empty array by default", async () => {
        const config = vscode.workspace.getConfiguration();
        await resetSetting(config);

        assert.deepStrictEqual(getExtraRunners(), []);

        await resetSetting(config);
    });

    test("getExtraRunners returns configured runner names", async () => {
        const config = vscode.workspace.getConfiguration();
        await resetSetting(config);
        await config.update("zephyr-ide.extraRunners", ["bonfi-bl", "my-custom-runner"], vscode.ConfigurationTarget.Global);

        assert.deepStrictEqual(getExtraRunners(), ["bonfi-bl", "my-custom-runner"]);

        await resetSetting(config);
    });

    test("getExtraRunners filters out blank/non-string entries", async () => {
        const config = vscode.workspace.getConfiguration();
        await resetSetting(config);
        await config.update("zephyr-ide.extraRunners", ["bonfi-bl", "", "   "], vscode.ConfigurationTarget.Global);

        assert.deepStrictEqual(getExtraRunners(), ["bonfi-bl"]);

        await resetSetting(config);
    });

    test("getAllWestRunners appends configured extra runners after the built-ins", async () => {
        const config = vscode.workspace.getConfiguration();
        await resetSetting(config);
        await config.update("zephyr-ide.extraRunners", ["bonfi-bl"], vscode.ConfigurationTarget.Global);

        const all = getAllWestRunners();

        assert.deepStrictEqual(all.slice(0, WEST_RUNNERS.length), WEST_RUNNERS);
        assert.ok(all.includes("bonfi-bl"), "extra runner should be present in the merged list");

        await resetSetting(config);
    });

    test("getAllWestRunners does not duplicate a runner already in the built-in list", async () => {
        const config = vscode.workspace.getConfiguration();
        await resetSetting(config);
        await config.update("zephyr-ide.extraRunners", ["openocd", "bonfi-bl"], vscode.ConfigurationTarget.Global);

        const all = getAllWestRunners();
        const occurrences = all.filter(r => r === "openocd").length;

        assert.strictEqual(occurrences, 1, "openocd should not be duplicated");
        assert.ok(all.includes("bonfi-bl"));

        await resetSetting(config);
    });

    test("getAllWestRunners equals WEST_RUNNERS when no extras are configured", async () => {
        const config = vscode.workspace.getConfiguration();
        await resetSetting(config);

        assert.deepStrictEqual(getAllWestRunners(), WEST_RUNNERS);
    });
});
