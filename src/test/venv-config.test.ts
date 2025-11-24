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
import { getVenvPath } from "../setup_utilities/workspace-config";
import * as path from "path";

suite("Venv Configuration Test Suite", () => {
    
    test("Returns default .venv path when no configuration is set", async () => {
        // Reset configuration to default (null)
        const config = vscode.workspace.getConfiguration();
        await config.update("zephyr-ide.venv-folder", undefined, vscode.ConfigurationTarget.Global);
        
        const setupPath = "/test/setup/path";
        const result = getVenvPath(setupPath);
        
        assert.strictEqual(result, path.join(setupPath, ".venv"));
    });

    test("Returns configured venv path when setting is provided", async () => {
        const customVenvPath = "/opt/venv";
        
        // Set custom venv path
        const config = vscode.workspace.getConfiguration();
        await config.update("zephyr-ide.venv-folder", customVenvPath, vscode.ConfigurationTarget.Global);
        
        const setupPath = "/test/setup/path";
        const result = getVenvPath(setupPath);
        
        assert.strictEqual(result, customVenvPath);
        
        // Clean up - reset to default
        await config.update("zephyr-ide.venv-folder", undefined, vscode.ConfigurationTarget.Global);
    });

    test("Returns configured venv path with spaces", async () => {
        const customVenvPath = "/path with spaces/my venv";
        
        // Set custom venv path with spaces
        const config = vscode.workspace.getConfiguration();
        await config.update("zephyr-ide.venv-folder", customVenvPath, vscode.ConfigurationTarget.Global);
        
        const setupPath = "/test/setup/path";
        const result = getVenvPath(setupPath);
        
        assert.strictEqual(result, customVenvPath);
        
        // Clean up - reset to default
        await config.update("zephyr-ide.venv-folder", undefined, vscode.ConfigurationTarget.Global);
    });

    test("Returns default .venv path when configuration is empty string", async () => {
        // Set empty string
        const config = vscode.workspace.getConfiguration();
        await config.update("zephyr-ide.venv-folder", "", vscode.ConfigurationTarget.Global);
        
        const setupPath = "/test/setup/path";
        const result = getVenvPath(setupPath);
        
        // Empty string is falsy, so should return default
        assert.strictEqual(result, path.join(setupPath, ".venv"));
        
        // Clean up - reset to default
        await config.update("zephyr-ide.venv-folder", undefined, vscode.ConfigurationTarget.Global);
    });
});
