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
import * as upath from "upath";
import { setWorkspaceSettings } from "../setup_utilities/workspace-config";

suite("Workspace Settings (clangd/cpptools) Test Suite", () => {

    const wsTarget = vscode.ConfigurationTarget.Workspace;

    const cpptoolsInstalled = !!vscode.extensions.getExtension("ms-vscode.cpptools");
    const clangdInstalled = !!vscode.extensions.getExtension("llvm-vs-code-extensions.vscode-clangd");

    async function resetClangdSettings() {
        const config = vscode.workspace.getConfiguration();
        await config.update("zephyr-ide.useClangd", undefined, wsTarget);
        await config.update("zephyr-ide.toolchainDirectory", undefined, vscode.ConfigurationTarget.Global);
        if (cpptoolsInstalled) {
            await config.update("C_Cpp.intelliSenseEngine", undefined, wsTarget);
            await config.update("C_Cpp.default.compileCommands", undefined, wsTarget);
        }
        if (clangdInstalled) {
            await config.update("clangd.arguments", undefined, wsTarget);
        }
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
        if (cpptoolsInstalled) {
            assert.strictEqual(
                updatedConfig.inspect("C_Cpp.intelliSenseEngine")?.workspaceValue,
                "disabled",
                "C_Cpp.intelliSenseEngine should be 'disabled' in clangd mode"
            );
        }
        if (clangdInstalled) {
            const clangdArgs = updatedConfig.inspect<string[]>("clangd.arguments")?.workspaceValue;
            assert.ok(Array.isArray(clangdArgs) && clangdArgs.length > 0, "clangd.arguments should be set");
            const queryDriverArg = clangdArgs?.find(a => a.startsWith("--query-driver="));
            assert.ok(queryDriverArg, "--query-driver argument should be present");
            assert.ok(queryDriverArg?.includes(upath.toUnix(existingToolchainDir)), "--query-driver should include the configured toolchain dir");
        }

        await resetClangdSettings();
    });

    test("clangd mode: updates C_Cpp.intelliSenseEngine even when pre-existing workspace value is not 'disabled'", async function () {
        if (!cpptoolsInstalled) {
            this.skip();
        }
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

    test("clangd mode: does not overwrite --query-driver when toolchainDirectory changes and args are already set", async function () {
        if (!clangdInstalled) {
            this.skip();
        }
        await resetClangdSettings();
        const config = vscode.workspace.getConfiguration();
        await config.update("zephyr-ide.useClangd", true, wsTarget);
        await config.update("zephyr-ide.toolchainDirectory", existingToolchainDir, vscode.ConfigurationTarget.Global);

        // First apply — establishes initial clangd.arguments (first-time setup)
        await setWorkspaceSettings(false);

        // Change toolchain directory to a different existing path
        const newToolchainDir = os.homedir();
        await config.update("zephyr-ide.toolchainDirectory", newToolchainDir, vscode.ConfigurationTarget.Global);

        // Re-apply — should NOT overwrite existing --query-driver (args already written)
        await setWorkspaceSettings(false);

        const updatedConfig = vscode.workspace.getConfiguration();
        const clangdArgs = updatedConfig.inspect<string[]>("clangd.arguments")?.workspaceValue;
        const queryDriverArg = clangdArgs?.find(a => a.startsWith("--query-driver="));
        assert.ok(queryDriverArg?.includes(upath.toUnix(existingToolchainDir)),
            "--query-driver should NOT be overwritten when clangd.arguments is already set (original path preserved)");
        assert.ok(!queryDriverArg?.includes(upath.toUnix(newToolchainDir)),
            "--query-driver should not be changed to the new toolchain directory");

        await resetClangdSettings();
    });

    test("clangd mode: writes --query-driver with current toolchainDirectory on first-time setup (args not yet present)", async function () {
        if (!clangdInstalled) {
            this.skip();
        }
        await resetClangdSettings();
        const config = vscode.workspace.getConfiguration();
        await config.update("zephyr-ide.useClangd", true, wsTarget);
        // Set a toolchain directory before the first write
        await config.update("zephyr-ide.toolchainDirectory", existingToolchainDir, vscode.ConfigurationTarget.Global);

        // clangd.arguments is not yet set — this is the initial setup
        await setWorkspaceSettings(false);

        const updatedConfig = vscode.workspace.getConfiguration();
        const clangdArgs = updatedConfig.inspect<string[]>("clangd.arguments")?.workspaceValue;
        const queryDriverArg = clangdArgs?.find(a => a.startsWith("--query-driver="));
        assert.ok(queryDriverArg?.includes(upath.toUnix(existingToolchainDir)),
            "--query-driver should be written with the current toolchainDirectory on first-time setup");

        await resetClangdSettings();
    });

    test("clangd mode: appends extension args alongside pre-existing user-defined clangd.arguments", async function () {
        if (!clangdInstalled) {
            this.skip();
        }
        await resetClangdSettings();
        const config = vscode.workspace.getConfiguration();
        await config.update("zephyr-ide.useClangd", true, wsTarget);
        await config.update("zephyr-ide.toolchainDirectory", existingToolchainDir, vscode.ConfigurationTarget.Global);
        // Pre-set user-defined args that the extension should not overwrite
        await config.update("clangd.arguments", ["--clang-tidy", "--pretty"], wsTarget);

        // useClangd just became true — extension appends its missing args
        await setWorkspaceSettings(false);

        const updatedConfig = vscode.workspace.getConfiguration();
        const clangdArgs = updatedConfig.inspect<string[]>("clangd.arguments")?.workspaceValue;
        assert.ok(Array.isArray(clangdArgs) && clangdArgs.length > 0, "clangd.arguments should be set");
        // Extension args must be appended (they were missing)
        assert.ok(clangdArgs?.includes("--background-index"), "--background-index should be appended");
        assert.ok(clangdArgs?.some(a => a.startsWith("--compile-commands-dir=")),
            "--compile-commands-dir should be appended");
        assert.ok(clangdArgs?.some(a => a.startsWith("--query-driver=")),
            "--query-driver should be appended");
        // User args must be preserved
        assert.ok(clangdArgs?.includes("--clang-tidy"),
            "user-defined --clang-tidy should be preserved");
        assert.ok(clangdArgs?.includes("--pretty"),
            "user-defined --pretty should be preserved");

        await resetClangdSettings();
    });

    test("clangd mode: does not overwrite user-customized extension arg values", async function () {
        if (!clangdInstalled) {
            this.skip();
        }
        await resetClangdSettings();
        const config = vscode.workspace.getConfiguration();
        await config.update("zephyr-ide.useClangd", true, wsTarget);
        await config.update("zephyr-ide.toolchainDirectory", existingToolchainDir, vscode.ConfigurationTarget.Global);
        // User has customized the completion-style (an extension-managed arg)
        await config.update("clangd.arguments", ["--completion-style=bundled"], wsTarget);

        await setWorkspaceSettings(false);

        const updatedConfig = vscode.workspace.getConfiguration();
        const clangdArgs = updatedConfig.inspect<string[]>("clangd.arguments")?.workspaceValue;
        // --completion-style=bundled should be preserved (not overwritten with 'detailed')
        assert.ok(clangdArgs?.includes("--completion-style=bundled"),
            "user-customized --completion-style=bundled should not be overwritten");
        assert.ok(!clangdArgs?.includes("--completion-style=detailed"),
            "--completion-style=detailed should not be added when a different value is already set");

        await resetClangdSettings();
    });

    test("cpptools mode: sets C_Cpp.default.compileCommands and clears extension-managed clangd.arguments", async () => {
        await resetClangdSettings();
        const config = vscode.workspace.getConfiguration();
        await config.update("zephyr-ide.useClangd", false, wsTarget);
        // Pre-populate with extension-managed args to simulate switching away from clangd mode
        if (clangdInstalled) {
            await config.update("clangd.arguments", [
                "--compile-commands-dir=${workspaceFolder}/.vscode",
                "--background-index",
                "--completion-style=detailed",
                "--header-insertion=never",
            ], wsTarget);
        }

        await setWorkspaceSettings(true);

        const updatedConfig = vscode.workspace.getConfiguration();
        if (cpptoolsInstalled) {
            const compileCommands = updatedConfig.inspect("C_Cpp.default.compileCommands")?.workspaceValue;
            assert.ok(typeof compileCommands === "string" && compileCommands.includes("compile_commands.json"),
                "C_Cpp.default.compileCommands should be set in cpptools mode");
            assert.strictEqual(
                updatedConfig.inspect("C_Cpp.intelliSenseEngine")?.workspaceValue,
                undefined,
                "C_Cpp.intelliSenseEngine should be cleared when switching to cpptools mode"
            );
        }
        if (clangdInstalled) {
            assert.strictEqual(
                updatedConfig.inspect("clangd.arguments")?.workspaceValue,
                undefined,
                "clangd.arguments should be cleared when all args were extension-managed"
            );
        }

        await resetClangdSettings();
    });

    test("cpptools mode: preserves user-defined clangd.arguments when switching from clangd mode", async function () {
        if (!clangdInstalled) {
            this.skip();
        }
        await resetClangdSettings();
        const config = vscode.workspace.getConfiguration();
        await config.update("zephyr-ide.useClangd", false, wsTarget);
        // Mix of extension-managed and user-defined args
        await config.update("clangd.arguments", [
            "--compile-commands-dir=${workspaceFolder}/.vscode",
            "--background-index",
            "--clang-tidy",
            "--pretty",
        ], wsTarget);

        await setWorkspaceSettings(true);

        const updatedConfig = vscode.workspace.getConfiguration();
        const clangdArgs = updatedConfig.inspect<string[]>("clangd.arguments")?.workspaceValue;
        assert.ok(Array.isArray(clangdArgs), "clangd.arguments should still be set (user args remain)");
        assert.ok(!clangdArgs?.some(a => a.startsWith("--compile-commands-dir=")),
            "extension-managed --compile-commands-dir should be removed in cpptools mode");
        assert.ok(!clangdArgs?.includes("--background-index"),
            "extension-managed --background-index should be removed in cpptools mode");
        assert.ok(clangdArgs?.includes("--clang-tidy"),
            "user-defined --clang-tidy should be preserved");
        assert.ok(clangdArgs?.includes("--pretty"),
            "user-defined --pretty should be preserved");

        await resetClangdSettings();
    });

    test("cpptools mode: clears C_Cpp.intelliSenseEngine left over from clangd mode", async function () {
        if (!cpptoolsInstalled) {
            this.skip();
        }
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
