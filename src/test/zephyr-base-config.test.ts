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
import * as path from "path";
import { getEffectiveZephyrBase } from "../utilities/utils";
import { generateSetupState } from "../setup_utilities/types";

async function resetSettings() {
    const config = vscode.workspace.getConfiguration();
    await config.update("zephyr-ide.disableZephyrBaseInjection", undefined, vscode.ConfigurationTarget.Global);
    await config.update("zephyr-ide.zephyrBaseOverride", undefined, vscode.ConfigurationTarget.Global);
}

suite("ZEPHYR_BASE Configuration Test Suite", () => {

    // teardown (not just setup) guarantees cleanup runs even if an assertion
    // in the test body throws, so a failing test can't leak these global
    // settings into unrelated suites that share the same extension host.
    setup(resetSettings);
    teardown(resetSettings);

    test("Returns zephyrDir from setupState when no override settings are configured", () => {
        const setupPath = "/test/setup/path";
        const setupState = generateSetupState(setupPath);
        setupState.zephyrDir = "/test/setup/path/zephyr";

        const result = getEffectiveZephyrBase(setupState);

        assert.strictEqual(result, "/test/setup/path/zephyr");
    });

    test("Returns undefined when zephyrDir is not set in setupState", () => {
        const setupPath = "/test/setup/path";
        const setupState = generateSetupState(setupPath);
        setupState.zephyrDir = "";

        const result = getEffectiveZephyrBase(setupState);

        assert.strictEqual(result, undefined);
    });

    test("Returns undefined when zephyrDir is only whitespace", () => {
        const setupPath = "/test/setup/path";
        const setupState = generateSetupState(setupPath);
        setupState.zephyrDir = "   ";

        const result = getEffectiveZephyrBase(setupState);

        assert.strictEqual(result, undefined);
    });

    test("Returns undefined when disableZephyrBaseInjection is true", async () => {
        const config = vscode.workspace.getConfiguration();
        await config.update("zephyr-ide.disableZephyrBaseInjection", true, vscode.ConfigurationTarget.Global);

        const setupPath = "/test/setup/path";
        const setupState = generateSetupState(setupPath);
        setupState.zephyrDir = "/test/setup/path/zephyr";

        const result = getEffectiveZephyrBase(setupState);

        assert.strictEqual(result, undefined);
    });

    test("disableZephyrBaseInjection=true overrides zephyrBaseOverride", async () => {
        const config = vscode.workspace.getConfiguration();
        await config.update("zephyr-ide.disableZephyrBaseInjection", true, vscode.ConfigurationTarget.Global);
        await config.update("zephyr-ide.zephyrBaseOverride", "/some/custom/zephyr", vscode.ConfigurationTarget.Global);

        const setupState = generateSetupState("/test/setup/path");
        setupState.zephyrDir = "/test/setup/path/zephyr";

        const result = getEffectiveZephyrBase(setupState);

        assert.strictEqual(result, undefined);
    });

    test("Returns absolute override path as-is", async () => {
        const customPath = "/opt/custom/zephyr";
        const config = vscode.workspace.getConfiguration();
        await config.update("zephyr-ide.zephyrBaseOverride", customPath, vscode.ConfigurationTarget.Global);

        const setupState = generateSetupState("/test/setup/path");
        setupState.zephyrDir = "/test/setup/path/zephyr";

        const result = getEffectiveZephyrBase(setupState);

        assert.strictEqual(result, customPath);
    });

    test("Returns absolute override path even when zephyrDir is empty", async () => {
        const customPath = "/opt/custom/zephyr";
        const config = vscode.workspace.getConfiguration();
        await config.update("zephyr-ide.zephyrBaseOverride", customPath, vscode.ConfigurationTarget.Global);

        const setupState = generateSetupState("/test/setup/path");
        setupState.zephyrDir = "";

        const result = getEffectiveZephyrBase(setupState);

        assert.strictEqual(result, customPath);
    });

    test("Relative override path resolves against workspace root", async () => {
        const config = vscode.workspace.getConfiguration();
        await config.update("zephyr-ide.zephyrBaseOverride", "zephyr", vscode.ConfigurationTarget.Global);

        const setupState = generateSetupState("/test/setup/path");
        setupState.zephyrDir = "/test/setup/path/zephyr";

        const result = getEffectiveZephyrBase(setupState);

        // Should resolve relative to workspace folder or process.cwd()
        assert.ok(result !== undefined, "Result should not be undefined for relative override");
        assert.ok(path.isAbsolute(result!), "Resolved path should be absolute");
        assert.strictEqual(path.basename(result!), "zephyr", "Resolved path should end with zephyr directory");
    });

    test("Override with only whitespace is ignored and falls back to setupState.zephyrDir", async () => {
        const config = vscode.workspace.getConfiguration();
        await config.update("zephyr-ide.zephyrBaseOverride", "   ", vscode.ConfigurationTarget.Global);

        const setupState = generateSetupState("/test/setup/path");
        setupState.zephyrDir = "/test/setup/path/zephyr";

        const result = getEffectiveZephyrBase(setupState);

        assert.strictEqual(result, "/test/setup/path/zephyr");
    });

    test("Returns default behavior with all settings at default values", async () => {
        const setupState = generateSetupState("/test/setup");
        setupState.zephyrDir = "/test/setup/zephyr";

        const result = getEffectiveZephyrBase(setupState);

        assert.strictEqual(result, "/test/setup/zephyr");

        // Verify disabling returns undefined
        const config = vscode.workspace.getConfiguration();
        await config.update("zephyr-ide.disableZephyrBaseInjection", true, vscode.ConfigurationTarget.Global);
        const resultDisabled = getEffectiveZephyrBase(setupState);
        assert.strictEqual(resultDisabled, undefined);
    });
});
