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
import * as vscode from "vscode";
import * as os from "os";
import { setWorkspaceSettings } from "../setup_utilities/workspace-config";

suite("Workspace Settings (clangd/cpptools) Test Suite", () => {

    const wsTarget = vscode.ConfigurationTarget.Workspace;

    async function resetClangdSettings() {
        const config = vscode.workspace.getConfiguration();
        await config.update("zephyr-ide.useClangd", undefined, wsTarget);
        await config.update("zephyr-ide.toolchainDirectory", undefined, vscode.ConfigurationTarget.Global);
        await config.update("C_Cpp.intelliSenseEngine", undefined, wsTarget);
        await config.update("C_Cpp.default.compileCommands", undefined, wsTarget);
        await config.update("clangd.arguments", undefined, wsTarget);
    }

    // Use the OS temp dir as a guaranteed-existing toolchain path for tests
    const existingToolchainDir = os.tmpdir();

    test("clangd mode: sets C_Cpp.intelliSenseEngine=disabled and clangd.arguments", async () => {
        await resetClangdSettings();
        const config = vscode.workspace.getConfiguration();
        await config.update("zephyr-ide.useClangd", true, wsTarget);
        await config.update("zephyr-ide.toolchainDirectory", existingToolchainDir, vscode.ConfigurationTarget.Global);

        await setWorkspaceSettings(true);

        const updatedConfig = vscode.workspace.getConfiguration();
        assert.strictEqual(
            updatedConfig.inspect("C_Cpp.intelliSenseEngine")?.workspaceValue,
            "disabled",
            "C_Cpp.intelliSenseEngine should be 'disabled' in clangd mode"
        );
        const clangdArgs = updatedConfig.inspect<string[]>("clangd.arguments")?.workspaceValue;
        assert.ok(Array.isArray(clangdArgs) && clangdArgs.length > 0, "clangd.arguments should be set");
        const queryDriverArg = clangdArgs?.find(a => a.startsWith("--query-driver="));
        assert.ok(queryDriverArg, "--query-driver argument should be present");
        assert.ok(queryDriverArg?.includes(existingToolchainDir), "--query-driver should include the configured toolchain dir");

        await resetClangdSettings();
    });

    test("clangd mode: updates C_Cpp.intelliSenseEngine even when pre-existing workspace value is not 'disabled'", async () => {
        await resetClangdSettings();
        const config = vscode.workspace.getConfiguration();
        await config.update("zephyr-ide.useClangd", true, wsTarget);
        await config.update("zephyr-ide.toolchainDirectory", existingToolchainDir, vscode.ConfigurationTarget.Global);
        // Simulate an existing non-disabled value
        await config.update("C_Cpp.intelliSenseEngine", "default", wsTarget);

        await setWorkspaceSettings(false);

        const updatedConfig = vscode.workspace.getConfiguration();
        assert.strictEqual(
            updatedConfig.inspect("C_Cpp.intelliSenseEngine")?.workspaceValue,
            "disabled",
            "C_Cpp.intelliSenseEngine should be overwritten to 'disabled' even when prior value was 'default'"
        );

        await resetClangdSettings();
    });

    test("clangd mode: refreshes --query-driver when toolchainDirectory changes (force=false)", async () => {
        await resetClangdSettings();
        const config = vscode.workspace.getConfiguration();
        await config.update("zephyr-ide.useClangd", true, wsTarget);
        await config.update("zephyr-ide.toolchainDirectory", existingToolchainDir, vscode.ConfigurationTarget.Global);

        // First apply — establishes initial clangd.arguments
        await setWorkspaceSettings(false);

        // Change toolchain directory to a different existing path
        const newToolchainDir = os.homedir();
        await config.update("zephyr-ide.toolchainDirectory", newToolchainDir, vscode.ConfigurationTarget.Global);

        // Re-apply without force — should still refresh because args are stale
        await setWorkspaceSettings(false);

        const updatedConfig = vscode.workspace.getConfiguration();
        const clangdArgs = updatedConfig.inspect<string[]>("clangd.arguments")?.workspaceValue;
        const queryDriverArg = clangdArgs?.find(a => a.startsWith("--query-driver="));
        assert.ok(queryDriverArg?.includes(newToolchainDir),
            "--query-driver should be updated to new toolchain directory even with force=false");

        await resetClangdSettings();
    });

    test("cpptools mode: sets C_Cpp.default.compileCommands and clears clangd.arguments", async () => {
        await resetClangdSettings();
        const config = vscode.workspace.getConfiguration();
        await config.update("zephyr-ide.useClangd", false, wsTarget);
        // Pre-populate clangd.arguments to simulate switching away from clangd mode
        await config.update("clangd.arguments", ["--some-arg"], wsTarget);

        await setWorkspaceSettings(true);

        const updatedConfig = vscode.workspace.getConfiguration();
        const compileCommands = updatedConfig.inspect("C_Cpp.default.compileCommands")?.workspaceValue;
        assert.ok(typeof compileCommands === "string" && compileCommands.includes("compile_commands.json"),
            "C_Cpp.default.compileCommands should be set in cpptools mode");
        assert.strictEqual(
            updatedConfig.inspect("clangd.arguments")?.workspaceValue,
            undefined,
            "clangd.arguments should be cleared when switching to cpptools mode"
        );
        assert.strictEqual(
            updatedConfig.inspect("C_Cpp.intelliSenseEngine")?.workspaceValue,
            undefined,
            "C_Cpp.intelliSenseEngine should be cleared when switching to cpptools mode"
        );

        await resetClangdSettings();
    });

    test("cpptools mode: clears C_Cpp.intelliSenseEngine left over from clangd mode", async () => {
        await resetClangdSettings();
        const config = vscode.workspace.getConfiguration();
        await config.update("zephyr-ide.useClangd", false, wsTarget);
        // Simulate leftover value from a prior clangd session
        await config.update("C_Cpp.intelliSenseEngine", "disabled", wsTarget);

        await setWorkspaceSettings(false);

        const updatedConfig = vscode.workspace.getConfiguration();
        assert.strictEqual(
            updatedConfig.inspect("C_Cpp.intelliSenseEngine")?.workspaceValue,
            undefined,
            "C_Cpp.intelliSenseEngine workspace override should be removed in cpptools mode"
        );

        await resetClangdSettings();
    });
});
