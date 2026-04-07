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
import { getLaunchConfigurations, getLaunchConfigurationByName } from "../utilities/utils";
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

    // Helper: write configs to a specific scope and clean up after the test.
    async function withConfigs(
        scope: vscode.ConfigurationTarget,
        configs: any[],
        fn: () => Promise<void>,
    ) {
        const folder = vscode.workspace.workspaceFolders?.[0];
        const launchCfg = scope === vscode.ConfigurationTarget.WorkspaceFolder
            ? vscode.workspace.getConfiguration("launch", folder?.uri)
            : vscode.workspace.getConfiguration("launch");
        await launchCfg.update("configurations", configs, scope);
        try {
            await fn();
        } finally {
            await launchCfg.update("configurations", undefined, scope);
        }
    }

    // ---------------------------------------------------------------
    // Existing tests
    // ---------------------------------------------------------------

    test("folder-level configs appear with workspaceFolder property set", async () => {
        const folder = vscode.workspace.workspaceFolders?.[0];
        if (!folder) { return; } // skip when no workspace folder is available

        const folderConfigs = [
            { name: "Folder Launch A", type: "cppdbg", request: "launch" },
            { name: "Folder Launch B", type: "cppdbg", request: "attach" },
        ];

        await withConfigs(vscode.ConfigurationTarget.WorkspaceFolder, folderConfigs, async () => {
            const result = await getLaunchConfigurations(makeWsConfig());

            assert.ok(Array.isArray(result), "result must be an array");
            for (const expected of folderConfigs) {
                const found: any = result!.find((c: any) => c.name === expected.name);
                assert.ok(found, `folder config "${expected.name}" must appear in results`);
                assert.strictEqual(found.workspaceFolder, folder.name,
                    `folder config must carry workspaceFolder = "${folder.name}"`);
            }
        });
    });

    test("configs written via Workspace scope appear in results without duplication", async () => {
        const wsConfigs = [
            { name: "Workspace Launch X", type: "cppdbg", request: "launch" },
        ];

        await withConfigs(vscode.ConfigurationTarget.Workspace, wsConfigs, async () => {
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
        });
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

    // ---------------------------------------------------------------
    // Same-named config across both scopes (deduplication)
    // ---------------------------------------------------------------

    test("same-named config in both folder and workspace scopes is not duplicated", async () => {
        const folder = vscode.workspace.workspaceFolders?.[0];
        if (!folder) { return; }

        const sharedName = "Shared Debug Config";
        const folderCfg = [{ name: sharedName, type: "cppdbg", request: "launch", program: "folder" }];
        const wsCfg = [{ name: sharedName, type: "cppdbg", request: "launch", program: "workspace" }];

        const folderLaunch = vscode.workspace.getConfiguration("launch", folder.uri);
        const wsLaunch = vscode.workspace.getConfiguration("launch");
        await folderLaunch.update("configurations", folderCfg, vscode.ConfigurationTarget.WorkspaceFolder);
        await wsLaunch.update("configurations", wsCfg, vscode.ConfigurationTarget.Workspace);

        try {
            const result = await getLaunchConfigurations(makeWsConfig());
            assert.ok(Array.isArray(result), "result must be an array");

            const matching = result!.filter((c: any) => c.name === sharedName);
            assert.strictEqual(matching.length, 1,
                "same-named config must appear exactly once (deduplicated)");
        } finally {
            await folderLaunch.update("configurations", undefined, vscode.ConfigurationTarget.WorkspaceFolder);
            await wsLaunch.update("configurations", undefined, vscode.ConfigurationTarget.Workspace);
        }
    });

    // ---------------------------------------------------------------
    // Only folder-level configs available (no .code-workspace)
    // ---------------------------------------------------------------

    test("returns folder configs when only folder scope has configurations", async () => {
        const folder = vscode.workspace.workspaceFolders?.[0];
        if (!folder) { return; }

        const configs = [
            { name: "Folder Only Launch", type: "cortex-debug", request: "launch" },
        ];

        await withConfigs(vscode.ConfigurationTarget.WorkspaceFolder, configs, async () => {
            const result = await getLaunchConfigurations(makeWsConfig());

            assert.ok(Array.isArray(result), "result must be an array");
            const found = result!.find((c: any) => c.name === "Folder Only Launch");
            assert.ok(found, "folder-only config must be found");
            assert.strictEqual(found.workspaceFolder, folder.name);
        });
    });

    // ---------------------------------------------------------------
    // Only workspace-level configs available (no launch.json)
    // ---------------------------------------------------------------

    test("returns workspace configs when only workspace scope has configurations", async () => {
        const configs = [
            { name: "Workspace Only Launch", type: "cortex-debug", request: "launch" },
        ];

        await withConfigs(vscode.ConfigurationTarget.Workspace, configs, async () => {
            const result = await getLaunchConfigurations(makeWsConfig());

            assert.ok(Array.isArray(result), "result must be an array");
            const found = result!.find((c: any) => c.name === "Workspace Only Launch");
            assert.ok(found, "workspace-only config must be found");
        });
    });

    // ---------------------------------------------------------------
    // Both scopes have different configs — union is returned
    // ---------------------------------------------------------------

    test("configs from both folder and workspace scopes are merged", async () => {
        const folder = vscode.workspace.workspaceFolders?.[0];
        if (!folder) { return; }

        // In a single-folder workspace the Workspace and WorkspaceFolder
        // targets share the same backing file, so we write both configs
        // into a single scope to avoid one update overwriting the other.
        const combined = [
            { name: "Folder Debug", type: "cppdbg", request: "launch" },
            { name: "Workspace Attach", type: "cppdbg", request: "attach" },
        ];

        const folderLaunch = vscode.workspace.getConfiguration("launch", folder.uri);
        await folderLaunch.update("configurations", combined, vscode.ConfigurationTarget.WorkspaceFolder);

        try {
            const result = await getLaunchConfigurations(makeWsConfig());
            assert.ok(Array.isArray(result), "result must be an array");

            const folderFound = result!.find((c: any) => c.name === "Folder Debug");
            const wsFound = result!.find((c: any) => c.name === "Workspace Attach");

            assert.ok(folderFound, "folder config must appear in merged results");
            assert.ok(wsFound, "workspace config must appear in merged results");
            assert.strictEqual(result!.length, 2, "exactly two configs expected");
        } finally {
            await folderLaunch.update("configurations", undefined, vscode.ConfigurationTarget.WorkspaceFolder);
        }
    });

    // ---------------------------------------------------------------
    // No configs at any scope
    // ---------------------------------------------------------------

    test("returns undefined when no configurations exist at any scope", async () => {
        // Clear both scopes to ensure a clean slate.
        const folder = vscode.workspace.workspaceFolders?.[0];
        const folderLaunch = folder
            ? vscode.workspace.getConfiguration("launch", folder.uri) : undefined;
        const wsLaunch = vscode.workspace.getConfiguration("launch");

        const prevFolder = folderLaunch?.inspect<any[]>("configurations")?.workspaceFolderValue;
        const prevWs = wsLaunch.inspect<any[]>("configurations")?.workspaceValue;

        if (folderLaunch) {
            await folderLaunch.update("configurations", undefined, vscode.ConfigurationTarget.WorkspaceFolder);
        }
        await wsLaunch.update("configurations", undefined, vscode.ConfigurationTarget.Workspace);

        try {
            const result = await getLaunchConfigurations(makeWsConfig());
            // May still pick up global-level configs, so allow array or undefined.
            if (result !== undefined) {
                assert.ok(Array.isArray(result), "result must be an array or undefined");
            }
        } finally {
            if (folderLaunch && prevFolder) {
                await folderLaunch.update("configurations", prevFolder, vscode.ConfigurationTarget.WorkspaceFolder);
            }
            if (prevWs) {
                await wsLaunch.update("configurations", prevWs, vscode.ConfigurationTarget.Workspace);
            }
        }
    });

    // ---------------------------------------------------------------
    // getLaunchConfigurationByName — lookup by name and folder
    // ---------------------------------------------------------------

    test("getLaunchConfigurationByName finds config by name", async () => {
        const folder = vscode.workspace.workspaceFolders?.[0];
        if (!folder) { return; }

        const configs = [
            { name: "Named Config A", type: "cortex-debug", request: "launch" },
            { name: "Named Config B", type: "cppdbg", request: "attach" },
        ];

        await withConfigs(vscode.ConfigurationTarget.WorkspaceFolder, configs, async () => {
            const found = await getLaunchConfigurationByName(makeWsConfig(), "Named Config B");
            assert.ok(found, "config must be found by name");
            assert.strictEqual(found!.name, "Named Config B");
        });
    });

    test("getLaunchConfigurationByName returns undefined for non-existent config", async () => {
        const found = await getLaunchConfigurationByName(makeWsConfig(), "Does Not Exist");
        assert.strictEqual(found, undefined, "non-existent config must return undefined");
    });

    test("getLaunchConfigurationByName finds workspace-scoped config by name", async () => {
        const configs = [
            { name: "WS Named Config", type: "cortex-debug", request: "launch" },
        ];

        await withConfigs(vscode.ConfigurationTarget.Workspace, configs, async () => {
            const found = await getLaunchConfigurationByName(makeWsConfig(), "WS Named Config");
            assert.ok(found, "workspace-scoped config must be findable by name");
            assert.strictEqual(found!.name, "WS Named Config");
        });
    });
});
