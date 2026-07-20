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

import * as vscode from 'vscode';
import * as assert from 'assert';
import * as fs from 'fs-extra';
import * as path from 'path';
import { readZephyrIdeJson } from '../setup_utilities/zephyr_ide_json';
import { configureExistingVenvEnvironment, readCMakeCacheInfo } from '../setup_utilities/workspace-config';
import { getBuildFolder } from '../project_utilities/project';
import { getBuildInfo, getZephyrDtsPath, regenerateCompileCommands } from '../zephyr_utilities/build';
import { resolveEffectiveBuildDir, invalidateRunnersYamlCache, getSysbuildDomains, getRunnersYamlHint } from '../zephyr_utilities/runners-yaml';
import { resolveKconfigBuildDir, resolveDotConfig } from '../build_data/kconfig-session';
import { readMemorySummary, readDashboardData } from '../build_data/build-artifact-reader';
import { listSaveTargets } from '../panels/dashboard_view/kconfig-fragment';
import { UIMockInterface } from './ui-mock-interface';
import type { MockInteraction } from './ui-mock-interface';

/**
 * Check if the build-dependency *check* step should be skipped based on
 * environment variables. This does NOT skip the build itself — it only
 * gates the `check-build-dependencies` command, which is unreliable right
 * after a package-manager install in the same CI job (see the Windows/macOS
 * PATH propagation note at each call site).
 */
export function shouldSkipBuildDependencyCheck(): boolean {
    return process.env.SKIP_BUILD_TESTS === 'true' || process.env.CI === 'true';
}

/** Normalize path separators to forward slashes for cross-platform comparison. */
export function normalizePath(p: string): string {
    return p.replace(/\\/g, "/");
}

/**
 * Check if host tools should be installed via the extension command
 */
export function shouldInstallHostTools(): boolean {
    return process.env.INSTALL_HOST_TOOLS === 'true';
}

/**
 * Log test environment information
 */
export function logTestEnvironment(): void {
    console.log('=== Test Environment ===');
    console.log('CI Environment:', process.env.CI === 'true');
    console.log('Skip Build Dependency Check:', shouldSkipBuildDependencyCheck());
    console.log('Install Host Tools:', shouldInstallHostTools());
    console.log('Node Version:', process.version);
    console.log('Platform:', process.platform);
    console.log('Architecture:', process.arch);
    console.log('========================');
}

/**
 * Retrieve and print the extension's debug output buffer into the test stream.
 *
 * Calls the `zephyr-ide.get-debug-output` command which atomically returns
 * all buffered output lines and clears the buffer.  The output is printed
 * via `console.log` so it appears in the VS Code test console / CI log.
 *
 * @param label  A heading printed before the output block for readability.
 */
export async function dumpExtensionOutput(label: string = "Extension Output"): Promise<void> {
    try {
        const output = await vscode.commands.executeCommand<string>("zephyr-ide.get-debug-output");
        if (output && output.length > 0) {
            console.log(`\n═══ ${label} ════════════════════════════════════════`);
            console.log(output);
            console.log(`═══ End ${label} ════════════════════════════════════\n`);
            await writeExtensionOutputLog(label, output);
        } else {
            console.log(`\n(No extension output captured for: ${label})`);
        }
    } catch (error) {
        console.log(`\n⚠️ Could not retrieve extension output: ${error}`);
    }
}

/**
 * Persist extension debug output to test-results/extension-output/<label>.log
 * so it survives as a downloadable CI artifact instead of only living in
 * console scrollback that's easy to lose in a 10k+ line CI job log.
 */
async function writeExtensionOutputLog(label: string, output: string): Promise<void> {
    try {
        const extensionPath = vscode.extensions.getExtension("mylonics.zephyr-ide")?.extensionPath;
        if (!extensionPath) {
            return;
        }
        const safeName = label.replace(/[^a-zA-Z0-9._-]+/g, '_');
        const logDir = path.join(extensionPath, 'test-results', 'extension-output');
        await fs.ensureDir(logDir);
        await fs.writeFile(path.join(logDir, `${safeName}.log`), output, 'utf8');
    } catch {
        // Best-effort only — never fail a test because the log couldn't be written.
    }
}

/**
 * Monitor workspace setup progress for integration tests
 * @param setupType Type of setup being monitored (e.g., "workspace", "git workspace")
 */
export async function monitorWorkspaceSetup(commandPromise: Thenable<any>, setupType: string = "workspace", timeoutMs: number = 600000): Promise<void> {
    console.log(`⏳ Monitoring ${setupType} setup progress... (timeout: ${timeoutMs / 1000}s)`);
    const startTime = Date.now();
    const elapsedSeconds = () => ((Date.now() - startTime) / 1000).toFixed(1);
    // Records when each stage flag first flips true (seconds since this call
    // started), so a slow platform/step is visible directly in the CI log
    // instead of only as a total elapsed time.
    const stageTimings: Record<string, string> = {};

    let waitTime = 0;
    const checkInterval = 3000;
    let initialSetupComplete = false;
    let pythonEnvironmentSetup = false;
    let westUpdated = false;
    let packagesInstalled = false;
    let sdkInstalled = false;

    // Attach handlers to detect early completion or failure
    // without blocking the polling loop.
    let commandDone = false;
    let commandError: Error | undefined;
    let commandResult: any;
    commandPromise.then(
        (result) => { commandDone = true; commandResult = result; },
        (err) => { commandDone = true; commandError = err; }
    );

    while (!sdkInstalled) {
        // If the command promise rejected, fail immediately with its error
        if (commandError) {
            throw new Error(
                `${setupType} setup command failed: ${commandError.message || commandError}`
            );
        }

        // If the command promise resolved with a falsy result, fail immediately
        if (commandDone && !commandResult) {
            const completedStages = [initialSetupComplete, pythonEnvironmentSetup, westUpdated, packagesInstalled, sdkInstalled].filter(Boolean).length;
            const stageDetails = [
                `initialSetup=${initialSetupComplete}`,
                `pythonEnv=${pythonEnvironmentSetup}`,
                `westUpdated=${westUpdated}`,
                `packagesInstalled=${packagesInstalled}`,
                `sdkInstalled=${sdkInstalled}`
            ].join(', ');
            throw new Error(
                `${setupType} setup command returned false/undefined. ` +
                `Completed ${completedStages}/5 stages (${stageDetails}). ` +
                `The workspace setup failed on this platform.`
            );
        }

        if (waitTime >= timeoutMs) {
            const completedStages = [initialSetupComplete, pythonEnvironmentSetup, westUpdated, packagesInstalled, sdkInstalled].filter(Boolean).length;
            const stageDetails = [
                `initialSetup=${initialSetupComplete}`,
                `pythonEnv=${pythonEnvironmentSetup}`,
                `westUpdated=${westUpdated}`,
                `packagesInstalled=${packagesInstalled}`,
                `sdkInstalled=${sdkInstalled}`
            ].join(', ');
            throw new Error(
                `${setupType} setup timed out after ${timeoutMs / 1000}s. ` +
                `Completed ${completedStages}/5 stages (${stageDetails}). ` +
                `The SDK installation may have failed or hung on this platform.`
            );
        }

        const extension = vscode.extensions.getExtension("mylonics.zephyr-ide");
        let wsConfig = null;

        if (extension?.isActive && extension.exports?.getWorkspaceConfig) {
            wsConfig = extension.exports.getWorkspaceConfig();
        }

        if (wsConfig) {
            if (!initialSetupComplete && wsConfig.activeSetupState?.initialized) {
                stageTimings.initialSetup = elapsedSeconds();
                console.log(`    ✅ Initial setup completed - west.yml created (${stageTimings.initialSetup}s elapsed)`);
                initialSetupComplete = true;
            }

            if (!westUpdated && wsConfig.activeSetupState?.westUpdated) {
                stageTimings.westUpdated = elapsedSeconds();
                console.log(`    ✅ West updated - All repos downloaded (${stageTimings.westUpdated}s elapsed)`);
                westUpdated = true;
            }

            if (!pythonEnvironmentSetup && wsConfig.activeSetupState?.pythonEnvironmentSetup) {
                stageTimings.pythonEnv = elapsedSeconds();
                console.log(`    ✅ Python environment setup completed (${stageTimings.pythonEnv}s elapsed)`);
                pythonEnvironmentSetup = true;
            }

            if (!packagesInstalled && wsConfig.activeSetupState?.packagesInstalled) {
                packagesInstalled = true;
                stageTimings.packagesInstalled = elapsedSeconds();
                console.log(`    ✅ Packages installed completed (${stageTimings.packagesInstalled}s elapsed)`);
            }

            if (packagesInstalled && await vscode.commands.executeCommand("zephyr-ide.is-sdk-installed")) {
                sdkInstalled = true;
                stageTimings.sdkInstalled = elapsedSeconds();
                console.log(`    ✅ SDK installed (${stageTimings.sdkInstalled}s elapsed)`);
                console.log(`🎉 All ${setupType} setup stages completed in ${stageTimings.sdkInstalled}s!`);
                console.log(`📊 Stage timings: ${Object.entries(stageTimings).map(([stage, t]) => `${stage}=${t}s`).join(', ')}`);
                break;
            }
        }

        // Progress update every 30 seconds
        if (waitTime % 30000 === 0 && waitTime > 0) {
            const completedStages = [initialSetupComplete, pythonEnvironmentSetup, westUpdated, packagesInstalled, sdkInstalled].filter(Boolean).length;
            console.log(`⏳ ${setupType} setup in progress... (${waitTime / 1000}s elapsed, ${completedStages}/5 stages completed)`);
        }

        await new Promise((resolve) => setTimeout(resolve, checkInterval));
        waitTime += checkInterval;
    }

    // The loop only exits via the packagesInstalled+sdkInstalled break above,
    // but that doesn't guarantee the earlier stage flags were ever observed
    // true — assert all five explicitly so a stage-tracking regression (e.g.
    // SDK ending up installed through a path that skips updating
    // pythonEnvironmentSetup) fails here instead of surfacing as a
    // hard-to-diagnose failure later in the test.
    const missingStages = [
        !initialSetupComplete && 'initialSetup',
        !westUpdated && 'westUpdated',
        !pythonEnvironmentSetup && 'pythonEnv',
        !packagesInstalled && 'packagesInstalled',
        !sdkInstalled && 'sdkInstalled',
    ].filter((stage): stage is string => Boolean(stage));
    assert.strictEqual(
        missingStages.length,
        0,
        `${setupType} setup reported complete but stage flags are inconsistent: missing [${missingStages.join(', ')}]`
    );
}

/**
 * Cleanup test workspace and restore VS Code workspace folders
 * @param testWorkspaceDir Test workspace directory to remove
 * @param originalWorkspaceFolders Original workspace folders to restore
 */
export async function restoreWorkspaceFolders(
    originalWorkspaceFolders: readonly vscode.WorkspaceFolder[] | undefined
): Promise<void> {
    if (!originalWorkspaceFolders) {
        return;
    }

    const currentFolders = vscode.workspace.workspaceFolders;
    const removeCount = currentFolders ? currentFolders.length : 0;
    const foldersToRestore = originalWorkspaceFolders.map((folder) => ({ uri: folder.uri }));
    vscode.workspace.updateWorkspaceFolders(0, removeCount, ...foldersToRestore);
}

export async function cleanupTestWorkspace(
    workspaceDir: string | undefined,
    shouldCleanup: boolean
): Promise<void> {
    if (!workspaceDir || !shouldCleanup) {
        return;
    }

    if (await fs.pathExists(workspaceDir)) {
        await fs.remove(workspaceDir);
    }
}

export async function runWorkspaceSuiteTeardown(
    originalWorkspaceFolders: readonly vscode.WorkspaceFolder[] | undefined,
    workspaceDir?: string,
    shouldCleanupWorkspace: boolean = false
): Promise<void> {
    await restoreWorkspaceFolders(originalWorkspaceFolders);
    await cleanupTestWorkspace(workspaceDir, shouldCleanupWorkspace);
}

/**
 * Registers the suite-level lifecycle (suiteSetup/setup/teardown/suiteTeardown)
 * shared byte-for-byte across every workspace-setup integration test file.
 * Must be called synchronously from within a `suite(...)` callback, the same
 * way a mocha `setup()`/`teardown()` call would be.
 *
 * This deliberately does NOT register the test() itself or dictate the
 * scenario body — each workspace type's post-setup steps differ too much
 * (different setup commands, different follow-up commands, different error
 * handling) to force through one rigid shape. Only the identical lifecycle
 * plumbing is centralized; see runWorkspaceScenarioTest for the matching
 * test-body wrapper.
 *
 * @param logLabel   Used in the suiteSetup log line: "Testing <logLabel> workflow"
 * @param teardownLabel Passed to printWorkspaceStructure in the teardown hook
 */
export function setupWorkspaceScenarioSuite(
    logLabel: string,
    teardownLabel: string
): { getTestWorkspaceDir: () => string } {
    let testWorkspaceDir: string;
    let originalWorkspaceFolders: readonly vscode.WorkspaceFolder[] | undefined;

    suiteSetup(() => {
        logTestEnvironment();
        console.log(`🔬 Testing ${logLabel} workflow`);
    });

    setup(async () => {
        originalWorkspaceFolders = vscode.workspace.workspaceFolders;
        if (originalWorkspaceFolders) {
            testWorkspaceDir = originalWorkspaceFolders[0].uri.fsPath;
        }
    });

    teardown(async () => {
        await printWorkspaceStructure(teardownLabel);
    });

    suiteTeardown(async () => {
        await runWorkspaceSuiteTeardown(originalWorkspaceFolders);
    });

    return { getTestWorkspaceDir: () => testWorkspaceDir };
}

export async function printWorkspaceStructure(
    testName: string
): Promise<void> {
    // Call the print-workspace command to display directory structure
    try {
        const structure = await vscode.commands.executeCommand("zephyr-ide.print-workspace");
        console.log(`\n📁 ${testName} - Workspace Structure:`);
        console.log(structure);
    } catch (error) {
        console.log(`\n❌ ${testName} - Failed to print workspace structure: ${error}`);
    }
}

/**
 * Activate extension and wait for initialization
 * @param extensionId Extension ID to activate (default: "mylonics.zephyr-ide")
 * @param waitTime Time to wait after activation in milliseconds (default: 3000)
 */
export async function activateExtension(
    extensionId: string = "mylonics.zephyr-ide",
    waitTime: number = 3000
): Promise<void> {
    const extension = vscode.extensions.getExtension(extensionId);
    if (extension && !extension.isActive) {
        await extension.activate();
    }
    await new Promise((resolve) => setTimeout(resolve, waitTime));
}

/**
 * Execute final build command with workspace state validation.
 * Monitors the build command's exit code to determine success.
 * The build command returns `true` when the underlying process exits with code 0.
 * @param testName Name of the test for logging
 * @param retryDelayMs Delay before retry if setup not complete (default: 10000)
 */
export async function assertWorkspaceReady(testName: string): Promise<void> {
    const ext = vscode.extensions.getExtension("mylonics.zephyr-ide");
    assert.ok(ext?.isActive, `Extension must be active before build (${testName})`);

    const wsConfig = ext?.exports?.getWorkspaceConfig();
    assert.ok(
        wsConfig?.activeSetupState?.initialized,
        `Workspace must be initialized before build (${testName}). ` +
        `activeSetupState: ${JSON.stringify(wsConfig?.activeSetupState)}`
    );

    const workspaceFolders = vscode.workspace.workspaceFolders;
    assert.ok(workspaceFolders && workspaceFolders.length > 0, `No workspace folder open (${testName})`);

    // Use wsConfig.rootPath — the same field production code uses to build
    // the .vscode/zephyr-ide.json path (see setup_utilities/zephyr_ide_json.ts)
    // — rather than re-deriving the root from vscode.workspace.workspaceFolders.
    // Those two can diverge: combined-installation.test.ts calls
    // updateWorkspaceFolders() mid-test to point at ZEPHYR_BASE, but the
    // extension already bound wsConfig.rootPath to the original folder at
    // activation and doesn't follow later folder-list changes, so all the
    // actual setup work happens under the original root. Comparing against
    // the stale workspaceFolders[0] path here previously produced a false
    // "external installation" diagnosis and a wrong (non-existent) path
    // for the zephyr-ide.json check.
    assert.ok(wsConfig?.rootPath, `wsConfig.rootPath is unset (${testName})`);
    const workspaceDir: string = wsConfig.rootPath;
    const setupPath = wsConfig?.activeSetupState?.setupPath;
    if (setupPath && setupPath !== workspaceDir) {
        // External installation — the install directory lives outside the workspace root.
        assert.ok(
            await fs.pathExists(setupPath),
            `External Zephyr installation directory not found at ${setupPath} (${testName})`
        );
        console.log(`   ✅ External Zephyr installation present at ${setupPath}`);
    }

    // .vscode/zephyr-ide.json is the actual persisted state file for every
    // setup type (see setup_utilities/zephyr_ide_json.ts); it must exist by
    // the time the workspace reports itself initialized.
    const zephyrIdeJsonPath = path.join(workspaceDir, '.vscode', 'zephyr-ide.json');
    assert.ok(
        await fs.pathExists(zephyrIdeJsonPath),
        `.vscode/zephyr-ide.json not found at ${zephyrIdeJsonPath} — workspace state was never persisted (${testName})`
    );
    console.log(`   ✅ .vscode/zephyr-ide.json present at ${zephyrIdeJsonPath}`);
}

/**
 * Poll until workspace setup state reports SDK installed, then return.
 * This replaces fixed-duration sleeps before executeFinalBuild.
 * @param testName   Name of the test (for logging)
 * @param timeoutMs  Maximum time to wait in ms (default: 60 000)
 * @param intervalMs Poll interval in ms (default: 2 000)
 */
export async function waitForBuildReady(
    testName: string,
    timeoutMs: number = 60000,
    intervalMs: number = 2000
): Promise<void> {
    const start = Date.now();
    console.log(`⏳ Waiting for workspace to be build-ready (${testName})...`);

    while (Date.now() - start < timeoutMs) {
        const ext = vscode.extensions.getExtension("mylonics.zephyr-ide");
        const wsConfig = ext?.isActive && ext.exports?.getWorkspaceConfig
            ? ext.exports.getWorkspaceConfig()
            : null;

        if (wsConfig?.activeSetupState?.initialized) {
            const sdkInstalled = await vscode.commands.executeCommand("zephyr-ide.is-sdk-installed");
            if (sdkInstalled) {
                console.log(`   ✅ Workspace is build-ready (${Math.round((Date.now() - start) / 1000)}s elapsed)`);
                return;
            }
        }

        await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    throw new Error(
        `waitForBuildReady timed out after ${timeoutMs / 1000}s for ${testName}: ` +
        `workspace never reported build-ready (initialized + SDK installed)`
    );
}

export async function executeFinalBuild(
    testName: string,
): Promise<void> {
    console.log("⚡ Executing final build...");

    await waitForBuildReady(testName);
    await assertWorkspaceReady(testName);

    const result = await vscode.commands.executeCommand("zephyr-ide.build");
    console.log(`   Build command returned: ${result} (exit code ${result ? '0 - success' : 'non-zero - failure'})`);
    assert.strictEqual(result, true, `Build command must return true (exit code 0). Got: ${result}`);
    console.log(`   ✅ Build succeeded for ${testName}`);

    // A "successful" build that never produced an ELF is still a bug worth
    // catching here, rather than a downstream flash/debug test discovering it.
    const elfPath = await vscode.commands.executeCommand<string>("zephyr-ide.get-zephyr-elf");
    assert.ok(elfPath, `zephyr-ide.get-zephyr-elf returned no path after a successful build (${testName})`);
    assert.ok(
        await fs.pathExists(elfPath),
        `Build reported success but no ELF file was found at ${elfPath} (${testName})`
    );
    console.log(`   ✅ Verified: ELF artifact present at ${elfPath}`);
}

/**
 * Assert that a project (and optionally one of its builds) was persisted to
 * .vscode/zephyr-ide.json. Catches silent failures where add-project /
 * add-build report success but the workspace state was never written.
 */
export async function assertProjectPersisted(
    testName: string,
    projectName: string,
    buildName?: string
): Promise<void> {
    const ext = vscode.extensions.getExtension("mylonics.zephyr-ide");
    const wsConfig = ext?.isActive && ext.exports?.getWorkspaceConfig
        ? ext.exports.getWorkspaceConfig()
        : undefined;
    assert.ok(wsConfig, `Extension workspace config not available (${testName})`);

    const data = readZephyrIdeJson(wsConfig);
    const project = data.projects?.[projectName];
    assert.ok(
        project,
        `Project "${projectName}" was not persisted to .vscode/zephyr-ide.json (${testName}). ` +
        `Found projects: [${Object.keys(data.projects || {}).join(', ')}]`
    );

    if (buildName) {
        const build = project.buildConfigs?.[buildName];
        assert.ok(
            build,
            `Build "${buildName}" was not persisted for project "${projectName}" (${testName}). ` +
            `Found builds: [${Object.keys(project.buildConfigs || {}).join(', ')}]`
        );
    }

    console.log(`   ✅ Verified: project "${projectName}"${buildName ? ` / build "${buildName}"` : ''} persisted to zephyr-ide.json (${testName})`);
}

/**
 * Simulate re-detecting an already-initialized workspace on VS Code reopen
 * and assert the venv gets correctly re-registered — the class of bug fixed
 * by configureExistingVenvEnvironment (workspace-config.ts). There is no
 * single command that re-runs activation-time detection in isolation (it's
 * inline in extension.ts activate()), so this calls that same function
 * directly against the live activeSetupState.
 *
 * To prove genuine re-detection (not just "the values were never touched"),
 * the VIRTUAL_ENV/PATH env entries are cleared first — simulating a fresh
 * extension host that hasn't re-derived them yet — then asserts
 * configureExistingVenvEnvironment restores the original values by reading
 * the real, already-installed .venv this test created.
 */
export async function assertWorkspaceReopenReDetectsVenv(testName: string): Promise<void> {
    const ext = vscode.extensions.getExtension("mylonics.zephyr-ide");
    const wsConfig = ext?.isActive && ext.exports?.getWorkspaceConfig
        ? ext.exports.getWorkspaceConfig()
        : undefined;
    const activeSetupState = wsConfig?.activeSetupState;
    assert.ok(activeSetupState, `No activeSetupState available to test re-detection (${testName})`);

    const previousVirtualEnv = activeSetupState.env["VIRTUAL_ENV"];
    const previousPath = activeSetupState.env["PATH"];
    assert.ok(previousVirtualEnv, `Expected VIRTUAL_ENV to already be set from the original setup, nothing to re-detect (${testName})`);

    delete activeSetupState.env["VIRTUAL_ENV"];
    delete activeSetupState.env["PATH"];

    const configured = await configureExistingVenvEnvironment(activeSetupState);
    assert.strictEqual(configured, true, `configureExistingVenvEnvironment must find and re-register the existing venv on reopen (${testName})`);
    assert.strictEqual(activeSetupState.env["VIRTUAL_ENV"], previousVirtualEnv, `Re-detected VIRTUAL_ENV must match the original venv path (${testName})`);
    assert.strictEqual(activeSetupState.env["PATH"], previousPath, `Re-detected PATH must match the original venv bin path (${testName})`);

    console.log(`   ✅ Verified: reopening the workspace correctly re-detects and re-registers the existing venv (${testName})`);
}

/**
 * Add a second build configuration with `--sysbuild` enabled, then build it.
 *
 * Rather than re-driving the interactive `add-build` board-picker wizard
 * (whose quickpick values differ per workspace type — several workspace
 * setup tests build against a project auto-detected from a cloned sample
 * repo whose board is not known ahead of time), this clones the config of
 * whichever build is *already* active for the project (every workspace
 * setup test has produced exactly one working build by the time this runs)
 * and adds `--sysbuild` to its `westBuildArgs`. This is both safe (same
 * board/toolchain that is already known to build) and representative of a
 * real user toggling sysbuild on an existing build. The clone is written
 * directly into the live `wsConfig` object — the same direct-state technique
 * used by assertWorkspaceReopenReDetectsVenv — since the (test-only) shortcut
 * of skipping the interactive wizard means there is no `context` available
 * here to persist it to `.vscode/zephyr-ide.json`; that's fine, `zephyr-ide.build`
 * and every function this feeds into verifyBuildFsFunctions operate on the
 * live in-memory wsConfig, not the on-disk JSON.
 *
 * Mirrors executeFinalBuild's build-and-assert-success pattern, but
 * deliberately does NOT assert an ELF was produced via `get-zephyr-elf` —
 * that check (and its expected sysbuild-specific failure) belongs to
 * verifyBuildFsFunctions. This helper only asserts the build itself
 * succeeded and that `domains.yaml` (the sysbuild marker checked by
 * build.ts's pristine detection) was actually produced, so a build that
 * silently ignored `--sysbuild` fails loudly here instead.
 *
 * @param projectName Project to clone a sysbuild build for; defaults to `wsConfig.activeProject`.
 * @param newBuildName Name for the new build config (default `"sysbuild_build"`).
 * @returns The resolved project name, the pre-existing regular build's name
 *   (read back from `activeBuildConfig` before it was switched), and the new
 *   sysbuild build's name — ready to hand to `verifyBuildFsFunctions`.
 */
export async function addAndBuildSysbuild(
    projectName?: string,
    newBuildName: string = "sysbuild_build"
): Promise<{ projectName: string; regularBuildName: string; sysbuildBuildName: string }> {
    const ext = vscode.extensions.getExtension("mylonics.zephyr-ide");
    const wsConfig = ext?.isActive && ext.exports?.getWorkspaceConfig
        ? ext.exports.getWorkspaceConfig()
        : undefined;
    assert.ok(wsConfig, `Extension workspace config not available (addAndBuildSysbuild)`);

    const resolvedProjectName: string | undefined = projectName ?? wsConfig.activeProject;
    assert.ok(resolvedProjectName, `No active project to clone a sysbuild build from (addAndBuildSysbuild)`);
    const project = wsConfig.projects[resolvedProjectName];
    assert.ok(project, `Project "${resolvedProjectName}" not found (addAndBuildSysbuild)`);

    const regularBuildName: string | undefined = wsConfig.projectStates[resolvedProjectName]?.activeBuildConfig;
    assert.ok(regularBuildName, `Project "${resolvedProjectName}" has no active build to clone for sysbuild (addAndBuildSysbuild)`);
    const regularBuild = project.buildConfigs[regularBuildName];
    assert.ok(regularBuild, `Active build "${regularBuildName}" config not found (addAndBuildSysbuild)`);

    console.log(`🔨 Cloning build "${regularBuildName}" as "${newBuildName}" with --sysbuild enabled...`);
    const sysbuildConfig = {
        ...regularBuild,
        name: newBuildName,
        westBuildArgs: [...(regularBuild.westBuildArgs ?? []), '--sysbuild'],
    };
    project.buildConfigs[newBuildName] = sysbuildConfig;
    wsConfig.projectStates[resolvedProjectName].buildStates[newBuildName] = { viewOpen: true };
    wsConfig.activeProject = resolvedProjectName;
    wsConfig.projectStates[resolvedProjectName].activeBuildConfig = newBuildName;
    invalidateRunnersYamlCache();

    console.log(`⚡ Building sysbuild build "${newBuildName}"...`);
    await waitForBuildReady(`Sysbuild build (${resolvedProjectName})`);
    const result = await vscode.commands.executeCommand("zephyr-ide.build");
    assert.strictEqual(result, true, `Sysbuild build command must return true (exit code 0). Got: ${result}`);

    const buildFolder = getBuildFolder(wsConfig, project, sysbuildConfig);
    const domainsYamlPath = path.join(buildFolder, "domains.yaml");
    assert.ok(
        await fs.pathExists(domainsYamlPath),
        `Sysbuild build succeeded but domains.yaml not found at ${domainsYamlPath} — sysbuild may not have actually been enabled for this board/toolchain`
    );
    console.log(`   ✅ Verified: sysbuild build produced domains.yaml at ${domainsYamlPath}`);

    return { projectName: resolvedProjectName, regularBuildName, sysbuildBuildName: newBuildName };
}

interface BuildFsCheckSpec {
    /** Build config name (must already exist on the project). */
    build: string;
    /** Whether this build was configured with `--sysbuild`. */
    sysbuild: boolean;
}

interface BuildFsFailure {
    build: string;
    check: string;
    message: string;
}

/**
 * "Special unit test" covering the filesystem/path-resolution and
 * build-artifact-parsing functions across the codebase. Runs once per entry
 * in `builds` — typically a regular build and a `--sysbuild` build of the
 * same project — against the real, already-built build directory on disk.
 *
 * Functions checked per build:
 *   - Commands: get-zephyr-elf-dir, get-zephyr-elf, get-gdb-path,
 *     get-arm-gdb-path, get-toolchain-path, get-active-build-path,
 *     get-active-build-board-path, get-zephyr-dir.
 *   - getBuildInfo (build.ts), readCMakeCacheInfo (workspace-config.ts),
 *     getZephyrDtsPath (build.ts), resolveKconfigBuildDir + resolveDotConfig
 *     (kconfig-session.ts), listSaveTargets (kconfig-fragment.ts).
 *   - Sysbuild-aware functions, kept as a passing contrast:
 *     resolveEffectiveBuildDir, getSysbuildDomains, getRunnersYamlHint
 *     (runners-yaml.ts), readMemorySummary, readDashboardData
 *     (build-artifact-reader.ts).
 *   - One cross-build check: regenerateCompileCommands (build.ts), which
 *     merges every project/build's compile_commands.json into one file.
 *
 * The functions above were identified (by reviewing every function that
 * touches the filesystem or parses a build artifact) as either already
 * routing sysbuild builds through `resolveEffectiveBuildDir`
 * (runners-yaml.ts) before constructing a path, or NOT doing so —
 * `get-zephyr-elf-dir`, `get-zephyr-elf`, `getBuildInfo`, `getZephyrDtsPath`,
 * `resolveKconfigBuildDir`, `listSaveTargets`, and `regenerateCompileCommands`
 * are all expected to mis-resolve for the sysbuild build; the rest are
 * expected to pass for BOTH builds, which helps confirm those failures are
 * localized rather than the sysbuild build itself being broken.
 *
 * Not covered here: functions that spawn a subprocess to *generate* fresh
 * artifacts (runMemoryReports, runFullMemoryRefresh, buildMenuConfig,
 * buildDashboard/buildDashboardReport) — exercising those would trigger
 * additional west invocations beyond the one build this phase already runs.
 * findSvdFile (board-directory lookup) was also left out: its inputs don't
 * depend on build type, so it has no sysbuild-specific behavior to surface.
 *
 * All checks run to completion (each wrapped in its own try/catch) and every
 * failure is collected into one aggregated assertion at the end, so a single
 * run reports every function that mis-resolves paths for sysbuild instead of
 * stopping at the first one.
 *
 * At this stage some checks are EXPECTED to fail for the sysbuild build —
 * fixing the underlying functions is out of scope here; this test only makes
 * the defects observable.
 */
export async function verifyBuildFsFunctions(
    projectName: string,
    builds: BuildFsCheckSpec[]
): Promise<void> {
    const ext = vscode.extensions.getExtension("mylonics.zephyr-ide");
    const wsConfig = ext?.isActive && ext.exports?.getWorkspaceConfig
        ? ext.exports.getWorkspaceConfig()
        : undefined;
    assert.ok(wsConfig, `Extension workspace config not available (verifyBuildFsFunctions)`);

    const project = wsConfig.projects[projectName];
    assert.ok(project, `Project "${projectName}" not found (verifyBuildFsFunctions)`);

    const failures: BuildFsFailure[] = [];
    const check = async (buildLabel: string, name: string, fn: () => Promise<void> | void): Promise<void> => {
        try {
            await fn();
        } catch (error) {
            failures.push({ build: buildLabel, check: name, message: error instanceof Error ? error.message : String(error) });
        }
    };

    for (const { build: buildName, sysbuild } of builds) {
        console.log(`🔎 Verifying filesystem/parsing functions for build "${buildName}" (sysbuild=${sysbuild})...`);

        const buildConfig = project.buildConfigs[buildName];
        assert.ok(buildConfig, `Build "${buildName}" not found on project "${projectName}" (verifyBuildFsFunctions)`);

        // Select the build deterministically — same direct-state technique as
        // assertWorkspaceReopenReDetectsVenv — rather than driving the
        // set-active-build quickpick through the UI mock.
        wsConfig.projectStates[projectName].activeBuildConfig = buildName;
        invalidateRunnersYamlCache();

        const buildFolder = getBuildFolder(wsConfig, project, buildConfig);

        const commandChecks: Array<[string, string]> = [
            ["zephyr-ide.get-zephyr-elf-dir", "get-zephyr-elf-dir"],
            ["zephyr-ide.get-zephyr-elf", "get-zephyr-elf"],
            ["zephyr-ide.get-gdb-path", "get-gdb-path"],
            ["zephyr-ide.get-arm-gdb-path", "get-arm-gdb-path"],
            ["zephyr-ide.get-toolchain-path", "get-toolchain-path"],
            ["zephyr-ide.get-active-build-path", "get-active-build-path"],
            ["zephyr-ide.get-active-build-board-path", "get-active-build-board-path"],
            ["zephyr-ide.get-zephyr-dir", "get-zephyr-dir"],
        ];
        for (const [commandId, label] of commandChecks) {
            await check(buildName, label, async () => {
                const result = await vscode.commands.executeCommand<string>(commandId);
                assert.ok(result, `${commandId} returned no path`);
                assert.ok(await fs.pathExists(result), `${commandId} returned "${result}" which does not exist on disk`);
            });
        }

        await check(buildName, "getBuildInfo", async () => {
            const info = await getBuildInfo(wsConfig, project, buildConfig);
            assert.ok(info, "getBuildInfo returned undefined");
            assert.ok(info.dtsFile, "getBuildInfo did not resolve a dtsFile");
        });

        await check(buildName, "readCMakeCacheInfo", () => {
            const info = readCMakeCacheInfo(buildFolder);
            assert.ok(info.elfName, "readCMakeCacheInfo did not find BYPRODUCT_KERNEL_ELF_NAME");
            assert.ok(info.gdbPath, "readCMakeCacheInfo did not find CMAKE_GDB");
            assert.ok(info.toolchainPath, "readCMakeCacheInfo did not find toolchain.path");
        });

        await check(buildName, "getZephyrDtsPath", async () => {
            const dtsPath = getZephyrDtsPath(wsConfig);
            assert.ok(dtsPath, "getZephyrDtsPath returned undefined");
            assert.ok(await fs.pathExists(dtsPath as string), `getZephyrDtsPath returned "${dtsPath}" which does not exist on disk`);
        });

        await check(buildName, "resolveKconfigBuildDir + .config", async () => {
            const kconfigBuildDir = resolveKconfigBuildDir(wsConfig);
            assert.ok(kconfigBuildDir, "resolveKconfigBuildDir returned undefined");
            const dotConfigPath = resolveDotConfig(kconfigBuildDir as string);
            assert.ok(await fs.pathExists(dotConfigPath), `resolveDotConfig returned "${dotConfigPath}" which does not exist on disk`);
        });

        await check(buildName, "listSaveTargets (kconfig-fragment.ts)", () => {
            // build_info.yml lives at the top-level buildFolder for a regular
            // build (so its committed prj.conf is auto-detected as a save
            // target), but under the sysbuild domain's subdirectory for a
            // sysbuild build — listSaveTargets uses getBuildFolder directly
            // (no domain resolution), so it should find zero "auto" entries there.
            const targets = listSaveTargets(wsConfig, project, buildConfig);
            assert.ok(
                targets.some((t) => t.kind === "auto"),
                `listSaveTargets found no auto-detected save target (expected at least prj.conf from build_info.yml)`
            );
        });

        // --- Sysbuild-aware functions, expected to pass for BOTH builds ---
        await check(buildName, "resolveEffectiveBuildDir", async () => {
            const effectiveDir = resolveEffectiveBuildDir(buildFolder);
            if (sysbuild) {
                assert.notStrictEqual(effectiveDir, buildFolder, "resolveEffectiveBuildDir did not redirect into a domain build dir for a sysbuild build");
            }
            assert.ok(await fs.pathExists(effectiveDir), `resolveEffectiveBuildDir returned "${effectiveDir}" which does not exist on disk`);
        });

        await check(buildName, "readMemorySummary", () => {
            const summary = readMemorySummary(buildFolder);
            const total = summary.bss + summary.rodata + summary.rwdata + summary.text + summary.other;
            assert.ok(total > 0, `readMemorySummary returned an all-zero summary for "${buildFolder}"`);
        });

        await check(buildName, "getSysbuildDomains", () => {
            const domains = getSysbuildDomains(buildFolder);
            if (sysbuild) {
                assert.ok(domains && domains.length > 0, `getSysbuildDomains found no domains for a sysbuild build at "${buildFolder}"`);
            } else {
                assert.strictEqual(domains, undefined, `getSysbuildDomains unexpectedly found domains.yaml for a non-sysbuild build at "${buildFolder}"`);
            }
        });

        await check(buildName, "getRunnersYamlHint", () => {
            const hint = getRunnersYamlHint(buildFolder);
            assert.ok(hint, "getRunnersYamlHint returned undefined");
            assert.ok(hint.availableRunners.length > 0, "getRunnersYamlHint found no available runners");
        });

        await check(buildName, "readDashboardData", async () => {
            const data = await readDashboardData(buildFolder, projectName, buildName);
            assert.ok(data.summary.board, "readDashboardData did not resolve a board");
            assert.ok(data.dts.source && data.dts.source.length > 0, "readDashboardData did not read zephyr.dts source");
            assert.ok(data.kconfig.length > 0, "readDashboardData did not parse any Kconfig entries from .config");
            assert.ok(data.summary.elfSize, "readDashboardData resolved no ELF size");
        });
    }

    // --- One-time (not per-build) check: regenerateCompileCommands scans
    // ALL builds of ALL projects into a single merged .vscode/compile_commands.json.
    // Its own path resolution (build.ts) checks basepath/compile_commands.json
    // then basepath/<project.name>/compile_commands.json — neither of which is
    // resolveEffectiveBuildDir's domain subdirectory — so entries from a
    // sysbuild build are expected to be silently dropped from the merge.
    const sysbuildEntry = builds.find((b) => b.sysbuild);
    if (sysbuildEntry) {
        await check(sysbuildEntry.build, "regenerateCompileCommands", async () => {
            await regenerateCompileCommands(wsConfig);
            const mergedPath = path.join(wsConfig.rootPath, '.vscode', 'compile_commands.json');
            assert.ok(await fs.pathExists(mergedPath), `regenerateCompileCommands did not produce ${mergedPath}`);
            const merged = JSON.parse(await fs.readFile(mergedPath, 'utf8'));
            assert.ok(Array.isArray(merged) && merged.length > 0, `regenerateCompileCommands produced an empty compile_commands.json`);

            const sysbuildBuildConfig = project.buildConfigs[sysbuildEntry.build];
            const sysbuildEffectiveDir = normalizePath(resolveEffectiveBuildDir(getBuildFolder(wsConfig, project, sysbuildBuildConfig))).toLowerCase();
            const includesSysbuildEntries = merged.some((e: any) =>
                typeof e.directory === 'string' && normalizePath(e.directory).toLowerCase().includes(sysbuildEffectiveDir)
            );
            assert.ok(
                includesSysbuildEntries,
                `regenerateCompileCommands' merged output has no entries from the sysbuild build's directory ("${sysbuildEffectiveDir}")`
            );
        });
    }

    if (failures.length > 0) {
        const report = failures.map((f) => `  [${f.build}] ${f.check}: ${f.message}`).join('\n');
        console.log(`\n❌ verifyBuildFsFunctions found ${failures.length} failing check(s):\n${report}\n`);
        assert.fail(
            `verifyBuildFsFunctions: ${failures.length} filesystem/parsing check(s) failed across ${builds.length} build(s):\n${report}`
        );
    }

    console.log(`✅ verifyBuildFsFunctions: all checks passed for ${builds.length} build(s)`);
}

/**
 * Complete test execution wrapper with error handling and cleanup
 * @param testName Name of the test
 * @param testWorkspaceDir Test workspace directory
 * @param uiMock UI mock interface to deactivate
 * @param testFunction The actual test function to execute
 */
export async function executeTestWithErrorHandling(
    testName: string,
    testWorkspaceDir: string,
    uiMock: any, // UIMockInterface type
    testFunction: () => Promise<void>
): Promise<void> {
    try {
        await testFunction();

        // Surface any async errors (e.g. board not found) that were stored
        // inside scheduled mock callbacks and couldn't propagate directly.
        const asyncError = uiMock.getAndClearAsyncError?.();
        if (asyncError) {
            throw asyncError;
        }

        // Leftover primed interactions mean the command triggered fewer UI
        // prompts than the test expected — the flow diverged silently even
        // though the command itself reported success.
        const remaining = uiMock.getRemainingInteractions?.() ?? [];
        if (remaining.length > 0) {
            const summary = remaining.map((i: MockInteraction) => `${i.type}:${i.description || i.value}`).join(', ');
            throw new Error(`${testName}: ${remaining.length} primed UI interaction(s) were never consumed: ${summary}`);
        }

        // Dump extension output to the test stream
        await dumpExtensionOutput(`${testName} - Extension Output`);
    } catch (error) {
        // Dump extension output so the CI log contains the full trace
        await dumpExtensionOutput(`${testName} - Extension Output (FAILED)`);

        // Handle failure with detailed logging
        await printWorkspaceStructure(testName);
        throw error;
    } finally {
        // Always deactivate mock to prevent listener/timer leaks between tests.
        uiMock.deactivate();
    }
}

/**
 * Test-body wrapper shared byte-for-byte across every workspace-setup
 * integration test file: creates the UIMockInterface, activates the
 * extension, activates the mock, then runs `scenario` inside
 * executeTestWithErrorHandling. Pairs with setupWorkspaceScenarioSuite,
 * which handles the surrounding suite-level lifecycle.
 *
 * @param testName        Name used for logging and error-handling context
 * @param testWorkspaceDir The workspace directory (from setupWorkspaceScenarioSuite's getTestWorkspaceDir())
 * @param scenario        The scenario-specific body; receives the active UIMockInterface
 */
export async function runWorkspaceScenarioTest(
    testName: string,
    testWorkspaceDir: string,
    scenario: (uiMock: UIMockInterface) => Promise<void>
): Promise<void> {
    console.log(`🚀 Starting ${testName}...`);
    const uiMock = new UIMockInterface();

    await executeTestWithErrorHandling(
        testName,
        testWorkspaceDir,
        uiMock,
        async () => {
            await activateExtension();
            uiMock.activate();
            await scenario(uiMock);
        }
    );
}

/**
 * Start a workspace setup command without awaiting it.
 * Returns a promise that resolves once the command completes.
 * 
 * IMPORTANT: Do NOT `await` this function when passing the result to
 * monitorWorkspaceSetup. JavaScript promise assimilation unwraps the inner
 * Thenable, leaving the resolved value (not a Thenable) which breaks
 * monitorWorkspaceSetup's `.then()` call. Pass the un-awaited Promise instead.
 * 
 * @param uiMock UI mock interface
 * @param interactions Array of UI interactions to prime
 * @param commandId VS Code command ID to execute
 */
export async function startWorkspaceCommand(
    uiMock: any,
    interactions: Array<{ type: string, value: string, description: string, multiSelect?: boolean }>,
    commandId: string,
): Promise<Thenable<any>> {
    await vscode.commands.executeCommand("zephyr-ide.update-with-narrow");
    uiMock.primeInteractions(interactions);

    // Start the command but do NOT await it — return the thenable
    return vscode.commands.executeCommand(commandId);
}

/**
 * Execute standard workspace setup command with UI mock interactions.
 * Awaits the command and asserts success. For long-running setup commands,
 * prefer startWorkspaceCommand + monitorWorkspaceSetup instead.
 * @param uiMock UI mock interface
 * @param interactions Array of UI interactions to prime
 * @param commandId VS Code command ID to execute
 * @param successMessage Success assertion message
 */
export async function executeWorkspaceCommand(
    uiMock: any,
    interactions: Array<{ type: string, value: string, description: string, multiSelect?: boolean }>,
    commandId: string,
    successMessage: string
): Promise<void> {
    await vscode.commands.executeCommand("zephyr-ide.update-with-narrow");
    uiMock.primeInteractions(interactions);

    const result = await vscode.commands.executeCommand(commandId);
    assert.ok(result, successMessage);
}

// ---------------------------------------------------------------------------
// CommonUIInteractions
//
// Override any value via environment variables for local/CI flexibility:
//   ZEPHYR_IDE_TEST_SDK_VERSION   — default: "v4.4.0"  (set to "automatic" to
//                                   always pick the latest available)
//   ZEPHYR_IDE_TEST_TOOLCHAIN     — default: "stm32"   (manifest toolchain filter)
//   ZEPHYR_IDE_TEST_TOOLCHAIN_TARGET — default: "arm-zephyr-eabi"
// ---------------------------------------------------------------------------
/** Read test env-var overrides. Exported for tests that build their own interaction arrays. */
export function getTestEnvConfig() {
    return {
        sdkVersion: process.env.ZEPHYR_IDE_TEST_SDK_VERSION ?? 'v4.4.0',
        toolchain: process.env.ZEPHYR_IDE_TEST_TOOLCHAIN ?? 'stm32',
        toolchainTarget: process.env.ZEPHYR_IDE_TEST_TOOLCHAIN_TARGET ?? 'arm-zephyr-eabi',
    };
}

/**
 * Common UI interaction patterns for different workspace setup types.
 * Values are read at call time so environment variable overrides work correctly.
 */
export const CommonUIInteractions = {
    // Standard workspace setup interactions.
    //
    // Deliberately ends after "additional west init args" (the last step of
    // the interactive westSelector wizard). SDK installation that follows
    // west update is handled by installZephyrIdeRequirements
    // (west-operations.ts, called from westUpdateWithRequirements), which is
    // fully automatic — it bootstraps declared-or-all toolchains without ever
    // showing a quickpick, "so workspace setup remains deterministic" per its
    // own comment. A trailing automatic/select-specific/toolchain trio here
    // used to exist for an interactive SDK picker that no longer runs in this
    // flow; leaving it primed left those 3 interactions permanently
    // unconsumed, which the queue-consumed check in executeTestWithErrorHandling
    // now correctly flags as a failure instead of passing silently.
    get standardWorkspace() {
        const { sdkVersion, toolchain } = getTestEnvConfig();
        return [
            { type: 'quickpick', value: 'create new west.yml', description: 'Create new west.yml' },
            { type: 'quickpick', value: 'minimal zephyr', description: 'Select minimal Zephyr manifest (not BLE)' },
            { type: 'quickpick', value: toolchain, description: `Select ${toolchain} toolchain` },
            { type: 'quickpick', value: sdkVersion, description: `Select ${sdkVersion} Zephyr version` },
            { type: 'input', value: '', description: 'Select additional west init args' },
        ];
    },

    // Testing workspace setup interactions (RPi Pico, ARM toolchain).
    // See standardWorkspace's comment above — SDK install is automatic and
    // deterministic after this point, no further quickpicks are shown.
    get testingWorkspace() {
        const { sdkVersion } = getTestEnvConfig();
        return [
            { type: 'quickpick', value: 'create new west.yml', description: 'Create new west.yml' },
            { type: 'quickpick', value: 'testing', description: 'Select testing manifest' },
            { type: 'quickpick', value: sdkVersion, description: `Select ${sdkVersion} Zephyr version` },
            { type: 'input', value: '', description: 'Select additional west init args' },
        ];
    },

    // Project creation interactions
    createBlinkyProject: [
        { type: 'quickpick', value: 'blinky', description: 'Select blinky template' },
        { type: 'input', value: 'blinky', description: 'Enter project name' }
    ],

    // Build configuration interactions
    configureBuild: [
        { type: 'quickpick', value: 'nucleo_f401re/stm32f401xe', description: 'Select board' },
        { type: 'quickpick', value: 'auto', description: 'Select pristine option' }
    ]
};
