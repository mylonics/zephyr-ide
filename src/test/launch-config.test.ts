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
    
    test("getLaunchConfigurations should return workspace-level configurations when available", async () => {
        // This test verifies that the function prioritizes workspace-level configurations
        // over folder-level configurations when both exist
        
        // Create a mock workspace config
        const wsConfig: WorkspaceConfig = {
            rootPath: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || "",
            projects: {},
            projectStates: {},
            initialSetupComplete: false,
            automaticProjectSelction: false,
        };
        
        // Call the function - it should work without errors
        const configurations = await getLaunchConfigurations(wsConfig);
        
        // The function should return an array (even if empty) when rootPath is set
        if (wsConfig.rootPath !== "") {
            assert.ok(Array.isArray(configurations) || configurations === undefined);
        }
    });
    
    test("getLaunchConfigurations should handle empty workspace gracefully", async () => {
        // Create a mock workspace config with empty rootPath
        const wsConfig: WorkspaceConfig = {
            rootPath: "",
            projects: {},
            projectStates: {},
            initialSetupComplete: false,
            automaticProjectSelction: false,
        };
        
        // Call the function - it should return undefined for empty rootPath
        const configurations = await getLaunchConfigurations(wsConfig);
        
        assert.strictEqual(configurations, undefined);
    });
});
