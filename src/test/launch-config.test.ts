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
import { getLaunchConfigurations } from "../utilities/utils";
import { WorkspaceConfig } from "../setup_utilities/types";

suite("Launch Configuration Test Suite", () => {

    function makeWsConfig(): WorkspaceConfig {
        return {
            rootPath: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || "",
            projects: {},
            projectStates: {},
            initialSetupComplete: false,
            automaticProjectSelction: false,
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

    test("workspace-level configs appear without workspaceFolder and are not duplicated", async () => {
        const wsConfigs = [
            { name: "Workspace Launch X", type: "cppdbg", request: "launch" },
        ];
        const launchCfg = vscode.workspace.getConfiguration("launch");
        await launchCfg.update("configurations", wsConfigs, vscode.ConfigurationTarget.Workspace);

        try {
            const result = await getLaunchConfigurations(makeWsConfig());

            assert.ok(Array.isArray(result), "result must be an array");

            // Workspace-level entry must appear, with no workspaceFolder property.
            const found = result!.find((c: any) => c.name === "Workspace Launch X");
            assert.ok(found, "workspace-level config must appear in results");
            assert.ok(!found.workspaceFolder,
                "workspace-level config must NOT have a workspaceFolder property");

            // Non-folder entries (workspace + global) must not be duplicated by name.
            const nonFolderNames = result!.filter((c: any) => !c.workspaceFolder).map((c: any) => c.name);
            assert.strictEqual(nonFolderNames.length, new Set(nonFolderNames).size,
                "non-folder configurations must not be duplicated");
        } finally {
            await launchCfg.update("configurations", undefined, vscode.ConfigurationTarget.Workspace);
        }
    });

    test("global-level configs appear without workspaceFolder property", async () => {
        const globalConfigs = [
            { name: "Global Launch Y", type: "cppdbg", request: "launch" },
        ];
        const launchCfg = vscode.workspace.getConfiguration("launch");
        await launchCfg.update("configurations", globalConfigs, vscode.ConfigurationTarget.Global);

        try {
            const result = await getLaunchConfigurations(makeWsConfig());

            assert.ok(Array.isArray(result), "result must be an array");
            const found = result!.find((c: any) => c.name === "Global Launch Y");
            assert.ok(found, "global-level config must appear in results");
            assert.ok(!found.workspaceFolder,
                "global-level config must NOT have a workspaceFolder property");
        } finally {
            await launchCfg.update("configurations", undefined, vscode.ConfigurationTarget.Global);
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
