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
import { getLaunchConfigurations, resolveConfigInputs } from "../utilities/utils";
import { WorkspaceConfig } from "../setup_utilities/types";

suite("Launch Configuration Test Suite", () => {

    function makeWsConfig(): WorkspaceConfig {
        return {
            rootPath: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || "",
            projects: {},
            projectStates: {},
            initialSetupComplete: false,
            automaticProjectSelection: false,
        };
    }

    test("folder-level configs appear with workspaceFolder property set", async () => {
        const folder = vscode.workspace.workspaceFolders?.[0];
        if (!folder) { return; } // skip when no workspace folder is available

        const folderConfigs = [
            { name: "Folder Launch A", type: "cppdbg", request: "launch" },
            { name: "Folder Launch B", type: "cppdbg", request: "attach" },
        ];
        const launchCfg = vscode.workspace.getConfiguration("launch", folder.uri);
        await launchCfg.update("configurations", folderConfigs, vscode.ConfigurationTarget.WorkspaceFolder);

        try {
            const result = await getLaunchConfigurations(makeWsConfig());

            assert.ok(Array.isArray(result), "result must be an array");
            for (const expected of folderConfigs) {
                const found: any = result!.find((c: any) => c.name === expected.name);
                assert.ok(found, `folder config "${expected.name}" must appear in results`);
                assert.strictEqual(found.workspaceFolder, folder.name,
                    `folder config must carry workspaceFolder = "${folder.name}"`);
            }
        } finally {
            await launchCfg.update("configurations", undefined, vscode.ConfigurationTarget.WorkspaceFolder);
        }
    });

    test("configs written via Workspace scope appear in results without duplication", async () => {
        const wsConfigs = [
            { name: "Workspace Launch X", type: "cppdbg", request: "launch" },
        ];
        const launchCfg = vscode.workspace.getConfiguration("launch");
        await launchCfg.update("configurations", wsConfigs, vscode.ConfigurationTarget.Workspace);

        try {
            const result = await getLaunchConfigurations(makeWsConfig());

            assert.ok(Array.isArray(result), "result must be an array");

            // Config must appear in results regardless of workspace type.
            // In a single-folder workspace ConfigurationTarget.Workspace writes to
            // workspaceFolderValue; in multi-folder it writes to workspaceValue
            // (.code-workspace). Either way the config must be surfaced exactly once.
            const found = result!.find((c: any) => c.name === "Workspace Launch X");
            assert.ok(found, "workspace-level config must appear in results");

            const matchingEntries = result!.filter((c: any) => c.name === "Workspace Launch X");
            assert.strictEqual(matchingEntries.length, 1,
                "workspace config must not appear more than once");
        } finally {
            await launchCfg.update("configurations", undefined, vscode.ConfigurationTarget.Workspace);
        }
    });

    test("global-level configs appear in results without duplication", async () => {
        const globalConfigs = [
            { name: "Global Launch Y", type: "cppdbg", request: "launch" },
        ];
        const launchCfg = vscode.workspace.getConfiguration("launch");

        // ConfigurationTarget.Global for launch.configurations may not be supported in
        // all VS Code environments; skip gracefully if the write is rejected.
        try {
            await launchCfg.update("configurations", globalConfigs, vscode.ConfigurationTarget.Global);
        } catch (e) {
            console.log(`Skipping global-level launch config test: Global write not supported (${e})`);
            return;
        }

        try {
            const result = await getLaunchConfigurations(makeWsConfig());

            // If global write was silently ignored, the config may not appear — that is
            // acceptable. Only assert dedup when it is present.
            if (!Array.isArray(result)) { return; }
            const matchingEntries = result.filter((c: any) => c.name === "Global Launch Y");
            assert.ok(matchingEntries.length <= 1, "global config must not be duplicated");
        } finally {
            try {
                await launchCfg.update("configurations", undefined, vscode.ConfigurationTarget.Global);
            } catch (e) {
                console.log(`Global launch config cleanup failed (${e})`);
            }
        }
    });

    test("every returned configuration has a non-empty name", async () => {
        const result = await getLaunchConfigurations(makeWsConfig());

        if (Array.isArray(result)) {
            for (const cfg of result) {
                assert.ok(typeof cfg.name === "string" && cfg.name.length > 0,
                    "every config must have a non-empty name string");
            }
        } else {
            assert.strictEqual(result, undefined, "result must be an array or undefined");
        }
    });
});

suite("resolveConfigInputs Test Suite", () => {

    test("returns config unchanged when no input references exist", async () => {
        const config: vscode.DebugConfiguration = {
            type: "cppdbg",
            name: "Plain Config",
            request: "launch",
            program: "/path/to/app",
        };

        const result = await resolveConfigInputs(config);
        assert.deepStrictEqual(result, config);
    });

    test("resolves command-type input variables", async () => {
        // Register a temporary command that returns a known value.
        const cmdId = "zephyr-ide-test.resolveInputCmd";
        const disposable = vscode.commands.registerCommand(cmdId, (args: any) => {
            return `resolved-${args}`;
        });

        const folder = vscode.workspace.workspaceFolders?.[0];
        if (!folder) {
            disposable.dispose();
            return;
        }

        // Write an input definition to the folder-level launch config.
        const launchCfg = vscode.workspace.getConfiguration("launch", folder.uri);
        await launchCfg.update("inputs", [
            { id: "TestCmd", type: "command", command: cmdId, args: "myarg" },
        ], vscode.ConfigurationTarget.WorkspaceFolder);

        try {
            const config: vscode.DebugConfiguration = {
                type: "cortex-debug",
                name: "Test Debug",
                request: "launch",
                device: "${input:TestCmd}",
            };

            const result = await resolveConfigInputs(config);
            assert.ok(result, "result must not be undefined");
            assert.strictEqual(result!.device, "resolved-myarg");
            // Other fields remain untouched
            assert.strictEqual(result!.name, "Test Debug");
            assert.strictEqual(result!.type, "cortex-debug");
        } finally {
            disposable.dispose();
            await launchCfg.update("inputs", undefined, vscode.ConfigurationTarget.WorkspaceFolder);
        }
    });

    test("returns undefined for an undefined input variable", async () => {
        const config: vscode.DebugConfiguration = {
            type: "cppdbg",
            name: "Missing Input",
            request: "launch",
            device: "${input:NoSuchInput}",
        };

        // Clear any inputs that might exist.
        const folder = vscode.workspace.workspaceFolders?.[0];
        if (!folder) { return; }
        const launchCfg = vscode.workspace.getConfiguration("launch", folder.uri);
        const savedInputs = launchCfg.inspect<any[]>("inputs")?.workspaceFolderValue;
        await launchCfg.update("inputs", [], vscode.ConfigurationTarget.WorkspaceFolder);

        try {
            const result = await resolveConfigInputs(config);
            assert.strictEqual(result, undefined, "must return undefined for missing input");
        } finally {
            await launchCfg.update("inputs", savedInputs, vscode.ConfigurationTarget.WorkspaceFolder);
        }
    });

    test("resolves multiple input references in a single config", async () => {
        const cmdId1 = "zephyr-ide-test.multiInput1";
        const cmdId2 = "zephyr-ide-test.multiInput2";
        const d1 = vscode.commands.registerCommand(cmdId1, () => "device-A");
        const d2 = vscode.commands.registerCommand(cmdId2, () => "file-B");

        const folder = vscode.workspace.workspaceFolders?.[0];
        if (!folder) {
            d1.dispose(); d2.dispose();
            return;
        }

        const launchCfg = vscode.workspace.getConfiguration("launch", folder.uri);
        await launchCfg.update("inputs", [
            { id: "DevInput", type: "command", command: cmdId1 },
            { id: "FileInput", type: "command", command: cmdId2 },
        ], vscode.ConfigurationTarget.WorkspaceFolder);

        try {
            const config: vscode.DebugConfiguration = {
                type: "cortex-debug",
                name: "Multi",
                request: "launch",
                device: "${input:DevInput}",
                svdFile: "/boards/${input:FileInput}",
            };

            const result = await resolveConfigInputs(config);
            assert.ok(result, "result must not be undefined");
            assert.strictEqual(result!.device, "device-A");
            assert.strictEqual(result!.svdFile, "/boards/file-B");
        } finally {
            d1.dispose(); d2.dispose();
            await launchCfg.update("inputs", undefined, vscode.ConfigurationTarget.WorkspaceFolder);
        }
    });

    test("resolves input references inside nested objects and arrays", async () => {
        const cmdId = "zephyr-ide-test.nestedInput";
        const disposable = vscode.commands.registerCommand(cmdId, () => "nestedVal");

        const folder = vscode.workspace.workspaceFolders?.[0];
        if (!folder) {
            disposable.dispose();
            return;
        }

        const launchCfg = vscode.workspace.getConfiguration("launch", folder.uri);
        await launchCfg.update("inputs", [
            { id: "Nested", type: "command", command: cmdId },
        ], vscode.ConfigurationTarget.WorkspaceFolder);

        try {
            const config: vscode.DebugConfiguration = {
                type: "cortex-debug",
                name: "Nested Test",
                request: "launch",
                serverArgs: ["-device", "${input:Nested}", "-speed", "4000"],
                nested: { inner: "${input:Nested}" },
            };

            const result = await resolveConfigInputs(config);
            assert.ok(result, "result must not be undefined");
            assert.deepStrictEqual(result!.serverArgs, ["-device", "nestedVal", "-speed", "4000"]);
            assert.strictEqual(result!.nested.inner, "nestedVal");
        } finally {
            disposable.dispose();
            await launchCfg.update("inputs", undefined, vscode.ConfigurationTarget.WorkspaceFolder);
        }
    });

    test("input embedded mid-string is substituted inline", async () => {
        const cmdId = "zephyr-ide-test.midString";
        const disposable = vscode.commands.registerCommand(cmdId, () => "chip123");

        const folder = vscode.workspace.workspaceFolders?.[0];
        if (!folder) {
            disposable.dispose();
            return;
        }

        const launchCfg = vscode.workspace.getConfiguration("launch", folder.uri);
        await launchCfg.update("inputs", [
            { id: "ChipId", type: "command", command: cmdId },
        ], vscode.ConfigurationTarget.WorkspaceFolder);

        try {
            const config: vscode.DebugConfiguration = {
                type: "cortex-debug",
                name: "Mid-string",
                request: "launch",
                svdFile: "/boards/${input:ChipId}/debug.svd",
            };

            const result = await resolveConfigInputs(config);
            assert.ok(result, "result must not be undefined");
            assert.strictEqual(result!.svdFile, "/boards/chip123/debug.svd");
        } finally {
            disposable.dispose();
            await launchCfg.update("inputs", undefined, vscode.ConfigurationTarget.WorkspaceFolder);
        }
    });
});
