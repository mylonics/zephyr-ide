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
import { getToolchainDir } from "../setup_utilities/workspace-config";
import * as path from "path";
import * as os from "os";

suite("Toolchain Configuration Test Suite", () => {
    
    test("Returns default toolchains path when no configuration is set", async () => {
        // Reset configuration to default (null)
        const config = vscode.workspace.getConfiguration();
        await config.update("zephyr-ide.toolchain_directory", undefined, vscode.ConfigurationTarget.Global);
        await config.update("zephyr-ide.tools_directory", undefined, vscode.ConfigurationTarget.Global);
        
        const result = getToolchainDir();
        const expectedPath = path.join(os.homedir(), ".zephyr_ide", "toolchains");
        
        assert.strictEqual(result, expectedPath);
    });

    test("Returns configured toolchain_directory when setting is provided", async () => {
        const customToolchainPath = "/opt/zephyr-sdk";
        
        // Set custom toolchain path
        const config = vscode.workspace.getConfiguration();
        await config.update("zephyr-ide.toolchain_directory", customToolchainPath, vscode.ConfigurationTarget.Global);
        
        const result = getToolchainDir();
        
        assert.strictEqual(result, customToolchainPath);
        
        // Clean up - reset to default
        await config.update("zephyr-ide.toolchain_directory", undefined, vscode.ConfigurationTarget.Global);
    });

    test("Returns toolchains subdirectory when only tools_directory is configured", async () => {
        const customToolsPath = "/opt/custom-tools";
        
        // Set custom tools path
        const config = vscode.workspace.getConfiguration();
        await config.update("zephyr-ide.toolchain_directory", undefined, vscode.ConfigurationTarget.Global);
        await config.update("zephyr-ide.tools_directory", customToolsPath, vscode.ConfigurationTarget.Global);
        
        const result = getToolchainDir();
        const expectedPath = path.join(customToolsPath, "toolchains");
        
        assert.strictEqual(result, expectedPath);
        
        // Clean up - reset to default
        await config.update("zephyr-ide.tools_directory", undefined, vscode.ConfigurationTarget.Global);
    });

    test("Prioritizes toolchain_directory over tools_directory", async () => {
        const customToolchainPath = "/opt/zephyr-sdk";
        const customToolsPath = "/opt/custom-tools";
        
        // Set both configurations
        const config = vscode.workspace.getConfiguration();
        await config.update("zephyr-ide.toolchain_directory", customToolchainPath, vscode.ConfigurationTarget.Global);
        await config.update("zephyr-ide.tools_directory", customToolsPath, vscode.ConfigurationTarget.Global);
        
        const result = getToolchainDir();
        
        // Should return toolchain_directory, not tools_directory/toolchains
        assert.strictEqual(result, customToolchainPath);
        
        // Clean up - reset to default
        await config.update("zephyr-ide.toolchain_directory", undefined, vscode.ConfigurationTarget.Global);
        await config.update("zephyr-ide.tools_directory", undefined, vscode.ConfigurationTarget.Global);
    });

    test("Returns default path when toolchain_directory is empty string", async () => {
        // Set empty string
        const config = vscode.workspace.getConfiguration();
        await config.update("zephyr-ide.toolchain_directory", "", vscode.ConfigurationTarget.Global);
        
        const result = getToolchainDir();
        const expectedPath = path.join(os.homedir(), ".zephyr_ide", "toolchains");
        
        // Empty string is falsy, so should return default
        assert.strictEqual(result, expectedPath);
        
        // Clean up - reset to default
        await config.update("zephyr-ide.toolchain_directory", undefined, vscode.ConfigurationTarget.Global);
    });

    test("Returns configured toolchain_directory with spaces", async () => {
        const customToolchainPath = "/path with spaces/zephyr sdk";
        
        // Set custom toolchain path with spaces
        const config = vscode.workspace.getConfiguration();
        await config.update("zephyr-ide.toolchain_directory", customToolchainPath, vscode.ConfigurationTarget.Global);
        
        const result = getToolchainDir();
        
        assert.strictEqual(result, customToolchainPath);
        
        // Clean up - reset to default
        await config.update("zephyr-ide.toolchain_directory", undefined, vscode.ConfigurationTarget.Global);
    });
});
