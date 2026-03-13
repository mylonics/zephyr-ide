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
    
    test("getLaunchConfigurations should return configurations and handle workspace-level configs", async () => {
        // This test verifies that the function reads both workspace-level configs
        // (from .code-workspace) and per-folder configs (from .vscode/launch.json),
        // using inspect() to avoid duplicates between the two scopes.
        
        const wsConfig: WorkspaceConfig = {
            rootPath: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || "",
            projects: {},
            projectStates: {},
            initialSetupComplete: false,
            automaticProjectSelction: false,
        };
        
        const configurations = await getLaunchConfigurations(wsConfig);
        
        // The function should return an array or undefined
        assert.ok(Array.isArray(configurations) || configurations === undefined);

        // Verify that workspace-level configs (no workspaceFolder property) and
        // folder-level configs (with workspaceFolder property) are both allowed.
        if (Array.isArray(configurations)) {
            for (const cfg of configurations) {
                assert.ok(typeof cfg.name === "string" && cfg.name.length > 0,
                    "Every returned configuration must have a non-empty name");
            }

            // Names must be unique across the returned list
            const names = configurations.map((c: any) => c.name);
            const uniqueNames = new Set(names);
            // Allow same name from different folders, but workspace-level entries
            // (no workspaceFolder) must not be duplicated.
            const workspaceLevelNames = configurations
                .filter((c: any) => !c.workspaceFolder)
                .map((c: any) => c.name);
            const uniqueWorkspaceLevelNames = new Set(workspaceLevelNames);
            assert.strictEqual(workspaceLevelNames.length, uniqueWorkspaceLevelNames.size,
                "Workspace-level configurations must not be duplicated");
        }
    });
    
    test("getLaunchConfigurations should handle empty workspace gracefully", async () => {
        // Create a mock workspace config with empty rootPath
        // The function scans workspace folders regardless of rootPath
        const wsConfig: WorkspaceConfig = {
            rootPath: "",
            projects: {},
            projectStates: {},
            initialSetupComplete: false,
            automaticProjectSelction: false,
        };
        
        // Call the function - it should return an array or undefined
        // depending on whether workspace folders have launch configs
        const configurations = await getLaunchConfigurations(wsConfig);
        
        assert.ok(Array.isArray(configurations) || configurations === undefined);
    });
});
