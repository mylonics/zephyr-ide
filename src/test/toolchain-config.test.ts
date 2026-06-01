/*
Copyright 2026 mylonics 
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
import * as fs from "fs-extra";
import * as vscode from "vscode";
import { getToolchainDir, getToolsDir, migrateSettingKeys } from "../setup_utilities/workspace-config";
import * as path from "path";
import * as os from "os";
import { normalizePath } from "./test-runner";

suite("Toolchain Configuration Test Suite", () => {
    let originalZephyrSdkInstallDir: string | undefined;

    setup(() => {
        originalZephyrSdkInstallDir = process.env.ZEPHYR_SDK_INSTALL_DIR;
    });

    teardown(() => {
        if (originalZephyrSdkInstallDir === undefined) {
            delete process.env.ZEPHYR_SDK_INSTALL_DIR;
        } else {
            process.env.ZEPHYR_SDK_INSTALL_DIR = originalZephyrSdkInstallDir;
        }
    });

    async function resetAllSettings(config: vscode.WorkspaceConfiguration) {
        await config.update("zephyr-ide.toolchainDirectory", undefined, vscode.ConfigurationTarget.Global);
        await config.update("zephyr-ide.globalDirectory", undefined, vscode.ConfigurationTarget.Global);
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

    test("Returns configured toolchainDirectory when setting is provided", async () => {
        const customToolchainPath = "/opt/zephyr-sdk";
        
        const config = vscode.workspace.getConfiguration();
        await resetAllSettings(config);
        await config.update("zephyr-ide.toolchainDirectory", customToolchainPath, vscode.ConfigurationTarget.Global);
        
        const result = getToolchainDir();
        
        assert.strictEqual(result, customToolchainPath);
        
        await resetAllSettings(config);
    });

    test("Returns toolchains subdirectory when only tools_directory is configured", async () => {
        const customToolsPath = "/opt/custom-tools";
        
        const config = vscode.workspace.getConfiguration();
        await resetAllSettings(config);
        await config.update("zephyr-ide.tools_directory", customToolsPath, vscode.ConfigurationTarget.Global);
        
        // tools_directory is a deprecated key and is no longer read by getToolchainDir()
        // directly. The default ~/.zephyr_ide/toolchains is returned until migration runs.
        const result = getToolchainDir();
        const expectedPath = normalizePath(path.join(os.homedir(), ".zephyr_ide", "toolchains"));
        
        assert.strictEqual(result, expectedPath);
        
        await resetAllSettings(config);
    });

    test("Returns toolchains subdirectory when only globalDirectory is configured", async () => {
        const customGlobalPath = "/opt/zephyr-global";

        const config = vscode.workspace.getConfiguration();
        await resetAllSettings(config);
        await config.update("zephyr-ide.globalDirectory", customGlobalPath, vscode.ConfigurationTarget.Global);

        // globalDirectory is a deprecated key and is no longer read by getToolchainDir()
        // directly. The default ~/.zephyr_ide/toolchains is returned until migration runs.
        const result = getToolchainDir();
        const expectedPath = normalizePath(path.join(os.homedir(), ".zephyr_ide", "toolchains"));

        assert.strictEqual(result, expectedPath);

        await resetAllSettings(config);
    });

    test("getToolsDir always returns the default ~/.zephyr_ide path regardless of config", async () => {
        const customGlobalPath = "/opt/zephyr-global";
        const customToolsPath = "/opt/custom-tools";

        const config = vscode.workspace.getConfiguration();
        await resetAllSettings(config);
        await config.update("zephyr-ide.globalDirectory", customGlobalPath, vscode.ConfigurationTarget.Global);
        await config.update("zephyr-ide.tools_directory", customToolsPath, vscode.ConfigurationTarget.Global);

        // getToolsDir() is now a constant — it always returns ~/.zephyr_ide
        const result = getToolsDir();
        const expectedPath = normalizePath(path.join(os.homedir(), ".zephyr_ide"));

        assert.strictEqual(result, expectedPath);

        await resetAllSettings(config);
    });

    test("Prioritizes toolchainDirectory over tools_directory", async () => {
        const customToolchainPath = "/opt/zephyr-sdk";
        const customToolsPath = "/opt/custom-tools";
        
        const config = vscode.workspace.getConfiguration();
        await resetAllSettings(config);
        await config.update("zephyr-ide.toolchainDirectory", customToolchainPath, vscode.ConfigurationTarget.Global);
        await config.update("zephyr-ide.tools_directory", customToolsPath, vscode.ConfigurationTarget.Global);
        
        const result = getToolchainDir();
        
        // Should return toolchainDirectory, not tools_directory/toolchains
        assert.strictEqual(result, customToolchainPath);
        
        await resetAllSettings(config);
    });

    test("Returns default path when toolchainDirectory is empty string", async () => {
        const config = vscode.workspace.getConfiguration();
        await resetAllSettings(config);
        await config.update("zephyr-ide.toolchainDirectory", "", vscode.ConfigurationTarget.Global);
        
        const result = getToolchainDir();
        const expectedPath = normalizePath(path.join(os.homedir(), ".zephyr_ide", "toolchains"));
        
        // Empty string is falsy, so should return default
        assert.strictEqual(result, expectedPath);
        
        await resetAllSettings(config);
    });

    test("Returns configured toolchainDirectory with spaces", async () => {
        const customToolchainPath = "/path with spaces/zephyr sdk";
        
        const config = vscode.workspace.getConfiguration();
        await resetAllSettings(config);
        await config.update("zephyr-ide.toolchainDirectory", customToolchainPath, vscode.ConfigurationTarget.Global);
        
        const result = getToolchainDir();
        
        assert.strictEqual(result, customToolchainPath);
        
        await resetAllSettings(config);
    });

    test("Uses ZEPHYR_SDK_INSTALL_DIR when setting is not defined", async () => {
        const envToolchainPath = "/opt/zephyr/toolchains";
        const config = vscode.workspace.getConfiguration();
        await resetAllSettings(config);
        process.env.ZEPHYR_SDK_INSTALL_DIR = envToolchainPath;

        const result = getToolchainDir();

        assert.strictEqual(result, envToolchainPath);

        await resetAllSettings(config);
    });

    test("Prioritizes toolchainDirectory over ZEPHYR_SDK_INSTALL_DIR", async () => {
        const customToolchainPath = "/opt/zephyr-sdk";
        process.env.ZEPHYR_SDK_INSTALL_DIR = "/opt/zephyr/from-env";
        const config = vscode.workspace.getConfiguration();
        await resetAllSettings(config);
        await config.update("zephyr-ide.toolchainDirectory", customToolchainPath, vscode.ConfigurationTarget.Global);

        const result = getToolchainDir();

        assert.strictEqual(result, customToolchainPath);

        await resetAllSettings(config);
    });

    test("Uses parent directory when ZEPHYR_SDK_INSTALL_DIR points to a specific SDK", async () => {
        const envSdkPath = "/opt/toolchains/zephyr-sdk-1.0.1";
        const config = vscode.workspace.getConfiguration();
        await resetAllSettings(config);
        process.env.ZEPHYR_SDK_INSTALL_DIR = envSdkPath;

        const result = getToolchainDir();

        assert.strictEqual(result, normalizePath(path.dirname(envSdkPath)));

        await resetAllSettings(config);
    });

    test("Uses parent directory when ZEPHYR_SDK_INSTALL_DIR points to a non-versioned SDK root", async () => {
        // Create a temporary directory that acts as a direct (non-versioned) SDK root.
        const testSdkDir = await fs.mkdtemp(path.join(os.tmpdir(), "zephyr-sdk-test-"));
        try {
            await fs.writeFile(path.join(testSdkDir, "sdk_version"), "0.16.8\n");
            const config = vscode.workspace.getConfiguration();
            await resetAllSettings(config);
            process.env.ZEPHYR_SDK_INSTALL_DIR = testSdkDir;

            const result = getToolchainDir();

            // ZEPHYR_SDK_INSTALL_DIR points at the SDK root itself, so the parent is
            // returned so that the SDK version scanner can find it as a child entry.
            assert.strictEqual(result, normalizePath(path.dirname(testSdkDir)));

            await resetAllSettings(config);
        } finally {
            await fs.remove(testSdkDir);
        }
    });

    test("migrateSettingKeys migrates tools_directory to toolchainDirectory", async () => {
        const customToolsPath = "/opt/custom-tools";

        const config = vscode.workspace.getConfiguration();
        await resetAllSettings(config);
        await config.update("zephyr-ide.tools_directory", customToolsPath, vscode.ConfigurationTarget.Global);

        await migrateSettingKeys();

        // Re-fetch configuration after migration to get updated values
        const updatedConfig = vscode.workspace.getConfiguration();
        const migratedToolchainDir = updatedConfig.get<string>("zephyr-ide.toolchainDirectory");
        const remainingToolsDir = updatedConfig.get<string>("zephyr-ide.tools_directory");

        assert.strictEqual(migratedToolchainDir, normalizePath(path.join(customToolsPath, "toolchains")));
        assert.ok(!remainingToolsDir, "tools_directory should be cleared after migration");

        await resetAllSettings(config);
    });

    test("migrateSettingKeys: globalDirectory wins over tools_directory for toolchainDirectory derivation", async () => {
        const existingGlobalPath = "/opt/existing-global";
        const customToolsPath = "/opt/custom-tools";

        const config = vscode.workspace.getConfiguration();
        await resetAllSettings(config);
        await config.update("zephyr-ide.globalDirectory", existingGlobalPath, vscode.ConfigurationTarget.Global);
        await config.update("zephyr-ide.tools_directory", customToolsPath, vscode.ConfigurationTarget.Global);

        await migrateSettingKeys();

        // Re-fetch configuration after migration to get updated values
        const updatedConfig = vscode.workspace.getConfiguration();
        const toolchainDir = updatedConfig.get<string>("zephyr-ide.toolchainDirectory");
        const remainingGlobalDir = updatedConfig.get<string>("zephyr-ide.globalDirectory");
        const remainingToolsDir = updatedConfig.get<string>("zephyr-ide.tools_directory");

        // globalDirectory takes priority; toolchainDirectory should be derived from it
        assert.strictEqual(toolchainDir, normalizePath(path.join(existingGlobalPath, "toolchains")));
        // Both deprecated keys should be cleared
        assert.ok(!remainingGlobalDir, "globalDirectory should be cleared after migration");
        assert.ok(!remainingToolsDir, "tools_directory should be cleared after migration");

        await resetAllSettings(config);
    });
});
