/*
Copyright 2025-2026 mylonics
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

import * as cp from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
    monitorWorkspaceSetup,
    startWorkspaceCommand,
    executeFinalBuild,
    getTestEnvConfig,
    setupWorkspaceScenarioSuite,
    runWorkspaceScenarioTest,
} from "./test-runner";

/**
 * Resolve a same-drive directory for the external Zephyr installation.
 * On Windows, $TEMP is on D: (see workspace-setup-tests.yml) but $HOME is on C:.
 * Placing the external install on the same drive as the workspace avoids cross-
 * drive issues when west resolves topdir / BOARD_ROOT relative to setupPath.
 */
function getExternalInstallDir(): string {
    return path.join(os.tmpdir(), "zide-external");
}

/**
 * Diagnostic: when the build fails, surface environment / tool details that
 * the VS Code task helper hides (ShellExecution stdout/stderr goes to the
 * integrated terminal, not the test log).
 */
function dumpBuildDiagnostics(installDir: string): void {
    console.log("═══ Build failure diagnostics ════════════════════════════════════");
    const venvBin = process.platform === "win32"
        ? path.join(installDir, ".venv", "Scripts")
        : path.join(installDir, ".venv", "bin");
    const pathSep = process.platform === "win32" ? ";" : ":";
    const env = {
        ...process.env,
        PATH: venvBin + pathSep + (process.env.PATH || process.env.Path || ""),
        VIRTUAL_ENV: path.join(installDir, ".venv"),
    };
    const probes: { label: string; cmd: string }[] = [
        { label: "venv exists", cmd: `node -e "console.log(require('fs').existsSync('${venvBin.replace(/\\/g, "\\\\")}'))"` },
        { label: "west --version", cmd: "west --version" },
        { label: "python -V", cmd: process.platform === "win32" ? "python -V" : "python3 -V" },
        { label: "python sys.executable", cmd: `${process.platform === "win32" ? "python" : "python3"} -c "import sys; print(sys.executable)"` },
    ];
    for (const p of probes) {
        try {
            const out = cp.execSync(p.cmd, { env, cwd: installDir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 15000 });
            console.log(`  [${p.label}] ${out.trim()}`);
        } catch (e: any) {
            console.log(`  [${p.label}] FAILED: ${e?.stderr?.toString?.().trim() || e?.message || e}`);
        }
    }
    // Dump any CMake error log west may have left behind.
    try {
        const entries = fs.existsSync(installDir) ? fs.readdirSync(installDir) : [];
        console.log(`  [installDir contents] ${entries.join(", ") || "(empty/missing)"}`);
    } catch (e: any) {
        console.log(`  [installDir contents] FAILED: ${e?.message || e}`);
    }
    console.log("═══ End build failure diagnostics ════════════════════════════════");
}

/*
 * WORKSPACE EXTERNAL ZEPHYR INTEGRATION TEST:
 *
 * Tests the out-of-tree workspace setup workflow:
 * 1. Setup workspace from git with --branch no_west
 * 2. When prompted, choose "Use Existing Zephyr Installation"
 * 3. Select "New Installation" option and choose ~/.zephyr_ide as the directory
 * 4. Go through west selector process (minimal, stm32)
 * 5. Execute build
 *
 * This tests the scenario where a git repository does not contain
 * west.yml files and the user chooses to use an external Zephyr
 * installation in the default ~/.zephyr_ide directory.
 *
 * Git command: --branch no_west -- https://github.com/mylonics/zephyr-ide-samples.git
 * UI Flow: "Use Existing Zephyr Installation" → "New Installation" → directory picker → west selector
 */

suite("Workspace External Zephyr Test Suite", () => {
    const { getTestWorkspaceDir } = setupWorkspaceScenarioSuite("workspace external zephyr", "External Zephyr Workspace Test");

    test("External Zephyr Workspace: Git Clone → Use Existing Install → West Selector → Build", async function () {
        await runWorkspaceScenarioTest("External Zephyr Workspace Test", getTestWorkspaceDir(), async (uiMock) => {
            const { sdkVersion, toolchain, toolchainTarget } = getTestEnvConfig();
            const externalInstallDir = getExternalInstallDir();
            // The OpenDialog mock skips real folder validation, but the workspace-setup
            // code path requires the chosen external install dir to already exist
            // (loadExternalSetupState returns undefined otherwise). Create it up front
            // so it mirrors what a real user would pick from the system file picker.
            fs.mkdirSync(externalInstallDir, { recursive: true });
            console.log(`🏗️ Step 1: Setting up workspace from git without west folder...`);
            console.log(`   External install directory: ${externalInstallDir}`);
            const setupPromise = startWorkspaceCommand(
                uiMock,
                [
                    { type: 'input', value: '--branch no_west -- https://github.com/mylonics/zephyr-ide-samples.git', description: 'Enter git clone string for no_west branch' },
                    { type: 'quickpick', value: 'Use external Zephyr installation', description: 'Choose Use Existing Zephyr Installation option' },
                    { type: 'quickpick', value: 'New Installation', description: 'Choose New Installation option' },
                    { type: 'opendialog', value: externalInstallDir, description: 'Select external install dir (same drive as workspace)' },
                    { type: 'quickpick', value: 'minimal zephyr', description: 'Select minimal Zephyr manifest (not BLE)' },
                    { type: 'quickpick', value: toolchain, description: `Select ${toolchain} toolchain` },
                    { type: 'quickpick', value: sdkVersion, description: `Select ${sdkVersion} Zephyr version` },
                    { type: 'input', value: '', description: 'Select additional west init args' },
                    { type: 'quickpick', value: 'automatic', description: 'Select SDK Version' },
                    { type: 'quickpick', value: 'select specific', description: 'Select specific toolchains' },
                    { type: 'quickpick', value: toolchainTarget, description: `Select ${toolchainTarget} toolchain`, multiSelect: true }
                ],
                "zephyr-ide.workspace-setup-from-git",
            );

            await monitorWorkspaceSetup(setupPromise, "external zephyr workspace");

            console.log("⚡ Step 2: Executing build...");
            try {
                await executeFinalBuild("External Zephyr Workspace");
            } catch (e) {
                dumpBuildDiagnostics(externalInstallDir);
                throw e;
            }
        });
    });
});
