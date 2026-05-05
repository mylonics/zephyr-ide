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
import { setWorkspaceSettings, clearExtensionClangdState } from "../setup_utilities/workspace-config";

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
        // Clear the persisted record of extension-written clangd args so each test
        // starts from a clean slate regardless of what previous tests wrote.
        await clearExtensionClangdState();
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

    test("clangd mode: updates extension-managed --query-driver when toolchainDirectory changes", async function () {
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

        // Re-apply — because the extension wrote the original --query-driver and now the
        // toolchain has changed, the extension-managed arg should be updated to the new path.
        await setWorkspaceSettings(false);

        const updatedConfig = vscode.workspace.getConfiguration();
        const clangdArgs = updatedConfig.inspect<string[]>("clangd.arguments")?.workspaceValue;
        const queryDriverArg = clangdArgs?.find(a => a.startsWith("--query-driver="));
        assert.ok(queryDriverArg?.includes(upath.toUnix(newToolchainDir)),
            "--query-driver should be updated to the new toolchain directory when the extension originally wrote it");
        assert.ok(!queryDriverArg?.includes(upath.toUnix(existingToolchainDir)),
            "--query-driver should not still point to the old toolchain directory");

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
        await config.update("zephyr-ide.toolchainDirectory", existingToolchainDir, vscode.ConfigurationTarget.Global);

        if (clangdInstalled) {
            // First: enable clangd mode so the extension writes and stores its args.
            await config.update("zephyr-ide.useClangd", true, wsTarget);
            await setWorkspaceSettings(false);
            const afterEnable = vscode.workspace.getConfiguration().inspect<string[]>("clangd.arguments")?.workspaceValue;
            assert.ok(Array.isArray(afterEnable) && afterEnable.length > 0,
                "clangd.arguments should be set after enabling clangd mode");
        }

        // Now disable — extension should clean up what it wrote.
        await config.update("zephyr-ide.useClangd", false, wsTarget);
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
        await config.update("zephyr-ide.toolchainDirectory", existingToolchainDir, vscode.ConfigurationTarget.Global);
        // Pre-set user-defined args before enabling clangd mode.
        await config.update("clangd.arguments", ["--clang-tidy", "--pretty"], wsTarget);

        // Enable clangd mode — extension appends its args alongside the user's.
        await config.update("zephyr-ide.useClangd", true, wsTarget);
        await setWorkspaceSettings(false);

        // Verify extension args were appended.
        const afterEnable = vscode.workspace.getConfiguration().inspect<string[]>("clangd.arguments")?.workspaceValue;
        assert.ok(afterEnable?.includes("--background-index"), "extension should have written --background-index");

        // Now switch to cpptools mode.
        await config.update("zephyr-ide.useClangd", false, wsTarget);
        await setWorkspaceSettings(false);

        const updatedConfig = vscode.workspace.getConfiguration();
        const clangdArgs = updatedConfig.inspect<string[]>("clangd.arguments")?.workspaceValue;
        assert.ok(Array.isArray(clangdArgs), "clangd.arguments should still be set (user args remain)");
        assert.ok(!clangdArgs?.some(a => a === "--compile-commands-dir=${workspaceFolder}/.vscode"),
            "extension-managed --compile-commands-dir should be removed in cpptools mode");
        assert.ok(!clangdArgs?.includes("--background-index"),
            "extension-managed --background-index should be removed in cpptools mode");
        assert.ok(clangdArgs?.includes("--clang-tidy"),
            "user-defined --clang-tidy should be preserved");
        assert.ok(clangdArgs?.includes("--pretty"),
            "user-defined --pretty should be preserved");

        await resetClangdSettings();
    });

    test("cpptools mode: preserves user-customized extension arg values (e.g. --completion-style=bundled) when disabling useClangd", async function () {
        if (!clangdInstalled) {
            this.skip();
        }
        await resetClangdSettings();
        const config = vscode.workspace.getConfiguration();
        await config.update("zephyr-ide.toolchainDirectory", existingToolchainDir, vscode.ConfigurationTarget.Global);
        // User pre-set --completion-style=bundled and a custom --query-driver before enabling.
        await config.update("clangd.arguments", [
            "--completion-style=bundled",
            "--query-driver=/opt/cross/**/*",
        ], wsTarget);

        // Enable clangd mode — extension appends its args but leaves the user's keys alone.
        await config.update("zephyr-ide.useClangd", true, wsTarget);
        await setWorkspaceSettings(false);

        // Verify extension did NOT overwrite user's values.
        const afterEnable = vscode.workspace.getConfiguration().inspect<string[]>("clangd.arguments")?.workspaceValue;
        assert.ok(afterEnable?.includes("--completion-style=bundled"), "user's --completion-style=bundled should survive enable");
        assert.ok(!afterEnable?.includes("--completion-style=detailed"), "extension should not overwrite user's completion-style");

        // Disable clangd mode.
        await config.update("zephyr-ide.useClangd", false, wsTarget);
        await setWorkspaceSettings(false);

        const updatedConfig = vscode.workspace.getConfiguration();
        const clangdArgs = updatedConfig.inspect<string[]>("clangd.arguments")?.workspaceValue;
        // User-customized values of extension-managed keys must survive the full round-trip.
        assert.ok(clangdArgs?.includes("--completion-style=bundled"),
            "user-customized --completion-style=bundled should survive disabling useClangd");
        assert.ok(clangdArgs?.includes("--query-driver=/opt/cross/**/*"),
            "user-customized --query-driver should survive disabling useClangd");
        // Extension default values must be removed.
        assert.ok(!clangdArgs?.includes("--background-index"),
            "extension-managed --background-index should be removed");
        assert.ok(!clangdArgs?.includes("--compile-commands-dir=${workspaceFolder}/.vscode"),
            "extension-managed --compile-commands-dir should be removed");

        await resetClangdSettings();
    });

    test("cpptools mode: removes stale extension-managed --query-driver after toolchain directory changes", async function () {
        if (!clangdInstalled) {
            this.skip();
        }
        await resetClangdSettings();
        const config = vscode.workspace.getConfiguration();
        await config.update("zephyr-ide.useClangd", true, wsTarget);
        await config.update("zephyr-ide.toolchainDirectory", existingToolchainDir, vscode.ConfigurationTarget.Global);

        // First setup with toolchain A → extension writes --query-driver=A/**/*.
        await setWorkspaceSettings(false);
        const afterFirstWrite = vscode.workspace.getConfiguration().inspect<string[]>("clangd.arguments")?.workspaceValue;
        assert.ok(afterFirstWrite?.some(a => a.includes(upath.toUnix(existingToolchainDir))),
            "--query-driver should include the first toolchain dir after initial setup");

        // Change toolchain directory to B → extension updates --query-driver to B.
        const newToolchainDir = os.homedir();
        await config.update("zephyr-ide.toolchainDirectory", newToolchainDir, vscode.ConfigurationTarget.Global);
        await setWorkspaceSettings(false);
        const afterUpdate = vscode.workspace.getConfiguration().inspect<string[]>("clangd.arguments")?.workspaceValue;
        assert.ok(afterUpdate?.some(a => a.startsWith("--query-driver=") && a.includes(upath.toUnix(newToolchainDir))),
            "--query-driver should have been updated to the new toolchain dir");
        assert.ok(!afterUpdate?.some(a => a.startsWith("--query-driver=") && a.includes(upath.toUnix(existingToolchainDir))),
            "old --query-driver should not remain after toolchain change");

        // Disable useClangd — extension must remove the (now-current) extension-managed args.
        await config.update("zephyr-ide.useClangd", false, wsTarget);
        await setWorkspaceSettings(false);

        const updatedConfig = vscode.workspace.getConfiguration();
        assert.strictEqual(
            updatedConfig.inspect("clangd.arguments")?.workspaceValue,
            undefined,
            "clangd.arguments should be fully cleared after disabling useClangd when only extension args were present"
        );

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

    test("upgrade path: cleans up old extension-written args when no stored state exists (upgrade from pre-tracking version)", async function () {
        if (!clangdInstalled) {
            this.skip();
        }
        // Simulate upgrading from a pre-tracking version of the extension:
        // clangd.arguments is already set with extension-written args, but workspaceState
        // has no CLANGD_ARGS_STATE_KEY entry (clearExtensionClangdState() was called in
        // resetClangdSettings(), which models this upgrade scenario).
        await resetClangdSettings();
        const config = vscode.workspace.getConfiguration();
        await config.update("zephyr-ide.useClangd", false, wsTarget);
        await config.update("zephyr-ide.toolchainDirectory", existingToolchainDir, vscode.ConfigurationTarget.Global);
        // Manually write args that the old extension would have written (no stored state).
        if (clangdInstalled) {
            await config.update("clangd.arguments", [
                "--compile-commands-dir=${workspaceFolder}/.vscode",
                "--background-index",
                "--completion-style=detailed",
                "--header-insertion=never",
                `--query-driver=${existingToolchainDir}/**/*`,
            ], wsTarget);
        }
        // Stored state is empty (simulates upgrade — clearExtensionClangdState() was already called).

        // Disabling useClangd should still remove the old extension-written args via migration.
        await setWorkspaceSettings(false);

        const updatedConfig = vscode.workspace.getConfiguration();
        if (clangdInstalled) {
            assert.strictEqual(
                updatedConfig.inspect("clangd.arguments")?.workspaceValue,
                undefined,
                "clangd.arguments should be cleared even without a stored state (upgrade migration)"
            );
        }

        await resetClangdSettings();
    });

    test("upgrade path: re-enables --query-driver sync on toolchain change when no stored state exists", async function () {
        if (!clangdInstalled) {
            this.skip();
        }
        // Simulate upgrading from a pre-tracking version: existing extension args but no stored state.
        await resetClangdSettings();
        const config = vscode.workspace.getConfiguration();
        await config.update("zephyr-ide.useClangd", true, wsTarget);
        await config.update("zephyr-ide.toolchainDirectory", existingToolchainDir, vscode.ConfigurationTarget.Global);
        // Manually write old extension args (as a pre-tracking release would have).
        await config.update("clangd.arguments", [
            "--compile-commands-dir=${workspaceFolder}/.vscode",
            "--background-index",
            "--completion-style=detailed",
            "--header-insertion=never",
            `--query-driver=${existingToolchainDir}/**/*`,
        ], wsTarget);
        // Stored state is empty (simulates upgrade).

        // Change toolchain directory — migration should recognise the old query-driver as
        // extension-managed and update it to the new toolchain path.
        const newToolchainDir = os.homedir();
        await config.update("zephyr-ide.toolchainDirectory", newToolchainDir, vscode.ConfigurationTarget.Global);
        await setWorkspaceSettings(false);

        const updatedConfig = vscode.workspace.getConfiguration();
        const clangdArgs = updatedConfig.inspect<string[]>("clangd.arguments")?.workspaceValue;
        const queryDriverArg = clangdArgs?.find(a => a.startsWith("--query-driver="));
        assert.ok(queryDriverArg?.includes(upath.toUnix(newToolchainDir)),
            "--query-driver should be updated to the new toolchain directory after upgrade migration");
        assert.ok(!queryDriverArg?.includes(upath.toUnix(existingToolchainDir)),
            "old --query-driver should not remain after upgrade migration + toolchain change");

        await resetClangdSettings();
    });
});
