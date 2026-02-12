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
import {
    resolveZephyrCommandsInConfig,
    getLaunchConfigurationByName,
    getLaunchConfigurations,
} from "../utilities/utils";
import { WorkspaceConfig } from "../setup_utilities/types";

suite("Debug Configuration Test Suite", () => {

    // --- resolveZephyrCommandsInConfig tests ---

    test("resolveZephyrCommandsInConfig returns primitives unchanged", async () => {
        assert.strictEqual(await resolveZephyrCommandsInConfig(42), 42);
        assert.strictEqual(await resolveZephyrCommandsInConfig(true), true);
        assert.strictEqual(await resolveZephyrCommandsInConfig(null), null);
        assert.strictEqual(await resolveZephyrCommandsInConfig(undefined), undefined);
    });

    test("resolveZephyrCommandsInConfig returns plain strings unchanged", async () => {
        const plain = "/usr/bin/gdb";
        const result = await resolveZephyrCommandsInConfig(plain);
        assert.strictEqual(result, plain);
    });

    test("resolveZephyrCommandsInConfig leaves non-zephyr-ide command variables unchanged", async () => {
        // Variables for other extensions or VS Code built-ins should be left as-is
        const value = "${workspaceFolder}/build";
        const result = await resolveZephyrCommandsInConfig(value);
        assert.strictEqual(result, value);
    });

    test("resolveZephyrCommandsInConfig handles arrays", async () => {
        const input = ["plain", 42, true];
        const result = await resolveZephyrCommandsInConfig(input);
        assert.deepStrictEqual(result, ["plain", 42, true]);
    });

    test("resolveZephyrCommandsInConfig recurses into nested objects", async () => {
        const input = {
            name: "Zephyr IDE: Debug",
            type: "cortex-debug",
            request: "launch",
            nested: {
                value: "no-command-here",
            },
        };
        const result = await resolveZephyrCommandsInConfig(input);
        assert.strictEqual(result.name, "Zephyr IDE: Debug");
        assert.strictEqual(result.type, "cortex-debug");
        assert.strictEqual(result.nested.value, "no-command-here");
    });

    test("resolveZephyrCommandsInConfig handles empty object", async () => {
        const result = await resolveZephyrCommandsInConfig({});
        assert.deepStrictEqual(result, {});
    });

    test("resolveZephyrCommandsInConfig handles empty array", async () => {
        const result = await resolveZephyrCommandsInConfig([]);
        assert.deepStrictEqual(result, []);
    });

    test("resolveZephyrCommandsInConfig handles nested arrays in objects", async () => {
        const input = {
            args: ["--flag", "value"],
            config: {
                items: [1, 2, 3],
            },
        };
        const result = await resolveZephyrCommandsInConfig(input);
        assert.deepStrictEqual(result.args, ["--flag", "value"]);
        assert.deepStrictEqual(result.config.items, [1, 2, 3]);
    });

    // --- getLaunchConfigurationByName tests ---

    test("getLaunchConfigurationByName returns undefined for empty rootPath", async () => {
        const wsConfig: WorkspaceConfig = {
            rootPath: "",
            projects: {},
            projectStates: {},
            initialSetupComplete: false,
            automaticProjectSelction: false,
        };

        const result = await getLaunchConfigurationByName(wsConfig, "Zephyr IDE: Debug");
        assert.strictEqual(result, undefined);
    });

    test("getLaunchConfigurationByName returns undefined when config not found", async () => {
        const wsConfig: WorkspaceConfig = {
            rootPath: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || "/tmp/test",
            projects: {},
            projectStates: {},
            initialSetupComplete: false,
            automaticProjectSelction: false,
        };

        // In the test workspace there should be no "Zephyr IDE: Debug" config
        const result = await getLaunchConfigurationByName(wsConfig, "Nonexistent Config Name");
        assert.strictEqual(result, undefined);
    });

    // --- getLaunchConfigurations tests ---

    test("getLaunchConfigurations returns undefined for empty rootPath", async () => {
        const wsConfig: WorkspaceConfig = {
            rootPath: "",
            projects: {},
            projectStates: {},
            initialSetupComplete: false,
            automaticProjectSelction: false,
        };

        const result = await getLaunchConfigurations(wsConfig);
        assert.strictEqual(result, undefined);
    });

    test("getLaunchConfigurations returns array or undefined for valid rootPath", async () => {
        const wsConfig: WorkspaceConfig = {
            rootPath: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || "",
            projects: {},
            projectStates: {},
            initialSetupComplete: false,
            automaticProjectSelction: false,
        };

        if (wsConfig.rootPath !== "") {
            const result = await getLaunchConfigurations(wsConfig);
            assert.ok(
                result === undefined || Array.isArray(result),
                "Should return undefined or an array"
            );
        }
    });
});
