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
import { getToolchainDir, getToolsDir, migrateToolsDirectory } from "../setup_utilities/workspace-config";
import * as path from "path";
import * as os from "os";

/** Normalize path separators to forward slashes (VS Code convention) */
function normalizePath(p: string): string {
  return p.replace(/\\/g, "/");
}

suite("Toolchain Configuration Test Suite", () => {

    async function resetAllSettings(config: vscode.WorkspaceConfiguration) {
        await config.update("zephyr-ide.toolchain_directory", undefined, vscode.ConfigurationTarget.Global);
        await config.update("zephyr-ide.tools_directory", undefined, vscode.ConfigurationTarget.Global);
        await config.update("zephyr-ide.global_directory", undefined, vscode.ConfigurationTarget.Global);
    }

    test("Returns default toolchains path when no configuration is set", async () => {
        const config = vscode.workspace.getConfiguration();
        await resetAllSettings(config);
        
        const result = getToolchainDir();
        const expectedPath = normalizePath(path.join(os.homedir(), ".zephyr_ide", "toolchains"));
        
        assert.strictEqual(result, expectedPath);
    });

    test("Returns configured toolchain_directory when setting is provided", async () => {
        const customToolchainPath = "/opt/zephyr-sdk";
        
        const config = vscode.workspace.getConfiguration();
        await resetAllSettings(config);
        await config.update("zephyr-ide.toolchain_directory", customToolchainPath, vscode.ConfigurationTarget.Global);
        
        const result = getToolchainDir();
        
        assert.strictEqual(result, customToolchainPath);
        
        await resetAllSettings(config);
    });

    test("Returns toolchains subdirectory when only tools_directory is configured", async () => {
        const customToolsPath = "/opt/custom-tools";
        
        const config = vscode.workspace.getConfiguration();
        await resetAllSettings(config);
        await config.update("zephyr-ide.tools_directory", customToolsPath, vscode.ConfigurationTarget.Global);
        
        const result = getToolchainDir();
        const expectedPath = normalizePath(path.join(customToolsPath, "toolchains"));
        
        assert.strictEqual(result, expectedPath);
        
        await resetAllSettings(config);
    });

    test("Returns toolchains subdirectory when only global_directory is configured", async () => {
        const customGlobalPath = "/opt/zephyr-global";

        const config = vscode.workspace.getConfiguration();
        await resetAllSettings(config);
        await config.update("zephyr-ide.global_directory", customGlobalPath, vscode.ConfigurationTarget.Global);

        const result = getToolchainDir();
        const expectedPath = normalizePath(path.join(customGlobalPath, "toolchains"));

        assert.strictEqual(result, expectedPath);

        await resetAllSettings(config);
    });

    test("global_directory takes precedence over tools_directory", async () => {
        const customGlobalPath = "/opt/zephyr-global";
        const customToolsPath = "/opt/custom-tools";

        const config = vscode.workspace.getConfiguration();
        await resetAllSettings(config);
        await config.update("zephyr-ide.global_directory", customGlobalPath, vscode.ConfigurationTarget.Global);
        await config.update("zephyr-ide.tools_directory", customToolsPath, vscode.ConfigurationTarget.Global);

        const result = getToolsDir();

        assert.strictEqual(result, customGlobalPath);

        await resetAllSettings(config);
    });

    test("Prioritizes toolchain_directory over tools_directory", async () => {
        const customToolchainPath = "/opt/zephyr-sdk";
        const customToolsPath = "/opt/custom-tools";
        
        const config = vscode.workspace.getConfiguration();
        await resetAllSettings(config);
        await config.update("zephyr-ide.toolchain_directory", customToolchainPath, vscode.ConfigurationTarget.Global);
        await config.update("zephyr-ide.tools_directory", customToolsPath, vscode.ConfigurationTarget.Global);
        
        const result = getToolchainDir();
        
        // Should return toolchain_directory, not tools_directory/toolchains
        assert.strictEqual(result, customToolchainPath);
        
        await resetAllSettings(config);
    });

    test("Returns default path when toolchain_directory is empty string", async () => {
        const config = vscode.workspace.getConfiguration();
        await resetAllSettings(config);
        await config.update("zephyr-ide.toolchain_directory", "", vscode.ConfigurationTarget.Global);
        
        const result = getToolchainDir();
        const expectedPath = normalizePath(path.join(os.homedir(), ".zephyr_ide", "toolchains"));
        
        // Empty string is falsy, so should return default
        assert.strictEqual(result, expectedPath);
        
        await resetAllSettings(config);
    });

    test("Returns configured toolchain_directory with spaces", async () => {
        const customToolchainPath = "/path with spaces/zephyr sdk";
        
        const config = vscode.workspace.getConfiguration();
        await resetAllSettings(config);
        await config.update("zephyr-ide.toolchain_directory", customToolchainPath, vscode.ConfigurationTarget.Global);
        
        const result = getToolchainDir();
        
        assert.strictEqual(result, customToolchainPath);
        
        await resetAllSettings(config);
    });

    test("migrateToolsDirectory migrates tools_directory to global_directory", async () => {
        const customToolsPath = "/opt/custom-tools";

        const config = vscode.workspace.getConfiguration();
        await resetAllSettings(config);
        await config.update("zephyr-ide.tools_directory", customToolsPath, vscode.ConfigurationTarget.Global);

        await migrateToolsDirectory();

        // Re-fetch configuration after migration to get updated values
        const updatedConfig = vscode.workspace.getConfiguration();
        const migratedGlobalDir = updatedConfig.get<string>("zephyr-ide.global_directory");
        const remainingToolsDir = updatedConfig.get<string>("zephyr-ide.tools_directory");

        assert.strictEqual(migratedGlobalDir, customToolsPath);
        assert.ok(!remainingToolsDir, "tools_directory should be cleared after migration");

        await resetAllSettings(config);
    });

    test("migrateToolsDirectory does not overwrite existing global_directory", async () => {
        const existingGlobalPath = "/opt/existing-global";
        const customToolsPath = "/opt/custom-tools";

        const config = vscode.workspace.getConfiguration();
        await resetAllSettings(config);
        await config.update("zephyr-ide.global_directory", existingGlobalPath, vscode.ConfigurationTarget.Global);
        await config.update("zephyr-ide.tools_directory", customToolsPath, vscode.ConfigurationTarget.Global);

        await migrateToolsDirectory();

        // Re-fetch configuration after migration to get updated values
        const updatedConfig = vscode.workspace.getConfiguration();
        const globalDir = updatedConfig.get<string>("zephyr-ide.global_directory");
        // Should NOT overwrite if global_directory was already set
        assert.strictEqual(globalDir, existingGlobalPath);

        await resetAllSettings(config);
    });
});
