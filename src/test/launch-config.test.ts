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
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { getLaunchConfigurations, readLaunchConfigsFromWorkspaceFile } from "../utilities/utils";
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

    // ── readLaunchConfigsFromWorkspaceFile unit tests ────────────────────────

    suite("readLaunchConfigsFromWorkspaceFile", () => {

        test("returns launch configurations from a valid .code-workspace file", () => {
            const tmpFile = path.join(os.tmpdir(), `test-${Date.now()}.code-workspace`);
            const configs = [
                { name: "Debug FW", type: "cortex-debug", request: "launch" },
                { name: "Attach FW", type: "cortex-debug", request: "attach" },
            ];
            const workspaceData = {
                folders: [{ path: "." }],
                launch: { configurations: configs },
            };
            fs.writeFileSync(tmpFile, JSON.stringify(workspaceData), "utf8");

            try {
                const result = readLaunchConfigsFromWorkspaceFile(tmpFile);
                assert.strictEqual(result.length, 2, "must return both configurations");
                assert.strictEqual(result[0].name, "Debug FW");
                assert.strictEqual(result[1].name, "Attach FW");
            } finally {
                fs.unlinkSync(tmpFile);
            }
        });

        test("returns empty array when file has no launch section", () => {
            const tmpFile = path.join(os.tmpdir(), `test-${Date.now()}.code-workspace`);
            const workspaceData = { folders: [{ path: "." }] };
            fs.writeFileSync(tmpFile, JSON.stringify(workspaceData), "utf8");

            try {
                const result = readLaunchConfigsFromWorkspaceFile(tmpFile);
                assert.deepStrictEqual(result, [], "must return empty array");
            } finally {
                fs.unlinkSync(tmpFile);
            }
        });

        test("returns empty array when launch.configurations is absent", () => {
            const tmpFile = path.join(os.tmpdir(), `test-${Date.now()}.code-workspace`);
            const workspaceData = { folders: [{ path: "." }], launch: {} };
            fs.writeFileSync(tmpFile, JSON.stringify(workspaceData), "utf8");

            try {
                const result = readLaunchConfigsFromWorkspaceFile(tmpFile);
                assert.deepStrictEqual(result, [], "must return empty array");
            } finally {
                fs.unlinkSync(tmpFile);
            }
        });

        test("returns empty array for a non-existent file path", () => {
            const result = readLaunchConfigsFromWorkspaceFile("/nonexistent/path/file.code-workspace");
            assert.deepStrictEqual(result, [], "must return empty array for missing file");
        });

        test("returns empty array for a file with invalid JSON", () => {
            const tmpFile = path.join(os.tmpdir(), `test-${Date.now()}.code-workspace`);
            fs.writeFileSync(tmpFile, "{ not valid json }", "utf8");

            try {
                const result = readLaunchConfigsFromWorkspaceFile(tmpFile);
                assert.deepStrictEqual(result, [], "must return empty array for invalid JSON");
            } finally {
                fs.unlinkSync(tmpFile);
            }
        });

        test("preserves all configuration properties", () => {
            const tmpFile = path.join(os.tmpdir(), `test-${Date.now()}.code-workspace`);
            const configs = [{
                name: "Debug Nemo FW",
                type: "cortex-debug",
                request: "launch",
                servertype: "jlink",
                device: "${input:GetJlinkDevice}",
            }];
            fs.writeFileSync(tmpFile, JSON.stringify({ folders: [], launch: { configurations: configs } }), "utf8");

            try {
                const result = readLaunchConfigsFromWorkspaceFile(tmpFile);
                assert.strictEqual(result.length, 1);
                assert.strictEqual(result[0].name, "Debug Nemo FW");
                assert.strictEqual(result[0].servertype, "jlink");
                assert.strictEqual(result[0].device, "${input:GetJlinkDevice}");
            } finally {
                fs.unlinkSync(tmpFile);
            }
        });
    });
});
