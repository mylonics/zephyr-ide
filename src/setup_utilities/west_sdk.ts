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

import * as vscode from "vscode";
import * as path from "upath";
import * as fs from "fs-extra";

import { WorkspaceConfig, GlobalConfig, SetupState } from "./types";
import { getToolchainDir } from "./workspace-config";
import { setGlobalState } from "./state-management";
import { executeShellCommandInPythonEnv, executeTaskHelperInPythonEnv } from "../utilities/utils";
import { outputInfo, outputWarning, outputError, notifyError, outputCommandFailure } from "../utilities/output";
import { sdkVersions, toolchainTargets } from "../defines";
import { SetupProgressTracker } from "./setup-progress";
import { MultiStepInput } from "../utilities/multistepQuickPick";

/** Event emitter for SDK install progress, mirroring the workspace setup progress pattern. */
const _onSDKProgress = new vscode.EventEmitter<import("./setup-progress").SetupProgressEvent>();
export const onSDKProgress: vscode.Event<import("./setup-progress").SetupProgressEvent> = _onSDKProgress.event;

export interface WestSDKResult {
    success: boolean;
    output?: string;
    error?: string;
}

export interface SDKInfo {
    version?: string;
    path?: string;
    status: "installed" | "not-installed" | "error";
    isDefault?: boolean;
}

export interface ParsedSDKVersion {
    version: string;
    path: string;
    installedToolchains: string[];
    availableToolchains: string[];
}

export interface ParsedSDKList {
    success: boolean;
    versions: ParsedSDKVersion[];
    error?: string;
}

/**
 * Determines the best west installation to use for SDK management.
 * Uses the current workspace install.
 * If no installation has the SDK command, manually inject it into the installation.
 */
export async function getWestSDKContext(wsConfig: WorkspaceConfig, globalConfig: GlobalConfig, context?: vscode.ExtensionContext): Promise<SetupState | undefined> {
    const candidateStates: SetupState[] = [];

    // Collect candidate states
    // Current workspace install
    if (wsConfig.activeSetupState) {
        candidateStates.push(wsConfig.activeSetupState);
    }

    // Try to find existing installation with SDK command
    for (const setupState of candidateStates) {
        if (await hasWestSDKCommand(setupState)) {
            return setupState;
        }
    }

    // If no valid SDK installs found, try to inject SDK command manually
    // Only consider candidates with a working Python venv so west is actually runnable
    for (const setupState of candidateStates) {
        if (!setupState.pythonEnvironmentSetup || !setupState.env["PATH"]) {
            continue;
        }
        if (setupState.setupPath && await fs.pathExists(path.join(setupState.setupPath, ".west"))) {
            if (await injectWestSDKCommand(setupState, context)) {
                return setupState;
            }
        }
    }

    return undefined;
}

/**
 * Checks if a setup state has the west SDK command available
 */
async function hasWestSDKCommand(setupState: SetupState): Promise<boolean> {
    if (!setupState.setupPath) {
        return false;
    }

    // A working venv with west installed is required to run west commands
    if (!setupState.pythonEnvironmentSetup || !setupState.env["PATH"]) {
        return false;
    }

    const westConfigPath = path.join(setupState.setupPath, ".west");
    if (!(await fs.pathExists(westConfigPath))) {
        return false;
    }

    // Check if sdk.py exists in west_commands directory
    const sdkPyPath = path.join(setupState.zephyrDir, "scripts", "west_commands", "sdk.py");
    return await fs.pathExists(sdkPyPath);
}

/**
 * Manually injects the west SDK command into a Zephyr installation
 * Copies sdk.py and listsdk.cmake to scripts/west_commands, FindZephyr-sdk.cmake to cmake/modules, and registers it in west-commands.yml
 */
async function injectWestSDKCommand(setupState: SetupState, context?: vscode.ExtensionContext): Promise<boolean> {
    if (!setupState.setupPath || !context) {
        return false;
    }

    try {
        const extensionPath = context.extensionPath;
        const sourceSdkPyPath = path.join(extensionPath, "resources", "sdk.py");

        // Check if source sdk.py exists
        if (!(await fs.pathExists(sourceSdkPyPath))) {
            outputError("SDK Inject", `Source sdk.py not found at: ${sourceSdkPyPath}. The extension may not be installed correctly (extensionPath: ${extensionPath}).`);
            return false;
        }

        // Create west_commands directory if it doesn't exist
        const westCommandsDir = path.join(setupState.zephyrDir, "scripts", "west_commands");
        await fs.ensureDir(westCommandsDir);

        // Copy sdk.py to west_commands directory
        const targetSdkPyPath = path.join(westCommandsDir, "sdk.py");
        await fs.copy(sourceSdkPyPath, targetSdkPyPath);

        // Create sdk subfolder and copy listsdk.cmake
        const sourceCmakePath = path.join(extensionPath, "resources", "listsdk.cmake");
        if (await fs.pathExists(sourceCmakePath)) {
            const sdkSubDir = path.join(westCommandsDir, "sdk");
            await fs.ensureDir(sdkSubDir);
            const targetCmakePath = path.join(sdkSubDir, "listsdk.cmake");
            await fs.copy(sourceCmakePath, targetCmakePath);
        } else {
            outputWarning("SDK Inject", `listsdk.cmake not found at: ${sourceCmakePath}. The extension package may be incomplete (extensionPath: ${extensionPath}).`);
        }

        // Copy FindZephyr-sdk.cmake to cmake/modules directory
        const sourceFindZephyrCmakePath = path.join(extensionPath, "resources", "FindZephyr-sdk.cmake");
        if (await fs.pathExists(sourceFindZephyrCmakePath)) {
            const cmakeModulesDir = path.join(setupState.zephyrDir, "cmake", "modules");
            await fs.ensureDir(cmakeModulesDir);
            const targetFindZephyrCmakePath = path.join(cmakeModulesDir, "FindZephyr-sdk.cmake");
            await fs.copy(sourceFindZephyrCmakePath, targetFindZephyrCmakePath);
        } else {
            outputWarning("SDK Inject", `FindZephyr-sdk.cmake not found at: ${sourceFindZephyrCmakePath}. The extension package may be incomplete (extensionPath: ${extensionPath}).`);
        }

        // Update west-commands.yml
        const westCommandsYmlPath = path.join(setupState.zephyrDir, "scripts", "west-commands.yml");
        const sdkCommandConfigPath = path.join(extensionPath, "resources", "west-sdk-command.yml");
        const sdkCommandConfig = await fs.readFile(sdkCommandConfigPath, 'utf-8');

        if (await fs.pathExists(westCommandsYmlPath)) {
            // Append to existing file
            await fs.appendFile(westCommandsYmlPath, "\n" + sdkCommandConfig);
        } else {
            outputError("SDK Inject", `Failed to inject SDK command: west-commands.yml not found at ${westCommandsYmlPath}. Ensure west update has been run and zephyrDir is correct (zephyrDir: ${setupState.zephyrDir}).`);
            return false;
        }

        outputInfo("SDK Inject", `Successfully injected west SDK command into: ${setupState.zephyrDir}`);
        return true;
    } catch (error) {
        outputError("SDK Inject", `Failed to inject west SDK command: ${error}`);
        return false;
    }
}

/**
 * Parses west sdk list output into structured format
 */
export function parseSDKListOutput(output: string): ParsedSDKVersion[] {
    const versions: ParsedSDKVersion[] = [];
    const lines = output.split('\n').map(line => line.trimEnd());

    let currentVersion: Partial<ParsedSDKVersion> | null = null;
    let currentSection: 'installed' | 'available' | null = null;

    for (const line of lines) {
        // Skip empty lines
        if (!line.trim()) {
            continue;
        }

        // Check for version line (starts with version number and colon)
        const versionMatch = line.match(/^(\d+\.\d+\.\d+):\s*$/);
        if (versionMatch) {
            // Save previous version if exists
            if (currentVersion && currentVersion.version && currentVersion.path) {
                versions.push({
                    version: currentVersion.version,
                    path: currentVersion.path,
                    installedToolchains: currentVersion.installedToolchains || [],
                    availableToolchains: currentVersion.availableToolchains || []
                });
            }

            // Start new version
            currentVersion = {
                version: versionMatch[1],
                installedToolchains: [],
                availableToolchains: []
            };
            currentSection = null;
            continue;
        }

        // Check for path line
        const pathMatch = line.match(/^\s+path:\s*(.+)$/);
        if (pathMatch && currentVersion) {
            currentVersion.path = pathMatch[1].trim();
            continue;
        }

        // Check for installed-toolchains section
        if (line.match(/^\s+installed-toolchains:\s*$/)) {
            currentSection = 'installed';
            continue;
        }

        // Check for available-toolchains section
        if (line.match(/^\s+available-toolchains:\s*$/)) {
            currentSection = 'available';
            continue;
        }

        // Check for toolchain list item
        const toolchainMatch = line.match(/^\s+-\s+(.+)$/);
        if (toolchainMatch && currentVersion && currentSection) {
            const toolchain = toolchainMatch[1].trim();
            if (currentSection === 'installed') {
                currentVersion.installedToolchains = currentVersion.installedToolchains || [];
                currentVersion.installedToolchains.push(toolchain);
            } else if (currentSection === 'available') {
                currentVersion.availableToolchains = currentVersion.availableToolchains || [];
                currentVersion.availableToolchains.push(toolchain);
            }
        }
    }

    // Don't forget the last version
    if (currentVersion && currentVersion.version && currentVersion.path) {
        versions.push({
            version: currentVersion.version,
            path: currentVersion.path,
            installedToolchains: currentVersion.installedToolchains || [],
            availableToolchains: currentVersion.availableToolchains || []
        });
    }

    return versions;
}

/**
 * Lists available SDKs using west sdk list and parses into structured format
 */
export async function listAvailableSDKs(
    setupState: SetupState
): Promise<ParsedSDKList> {
    try {
        const result = await executeShellCommandInPythonEnv(
            `west sdk list`,
            setupState.setupPath,
            setupState
        );

        if (result.stdout) {
            const versions = parseSDKListOutput(result.stdout);
            return {
                success: true,
                versions: versions,
            };
        } else {
            outputCommandFailure("SDK List", result);
            return {
                success: false,
                versions: [],
                error: result.stderr || "Failed to list SDKs",
            };
        }
    } catch (error) {
        return {
            success: false,
            versions: [],
            error: `Error listing SDKs: ${error}`,
        };
    }
}

/**
 * Automatically detects SDK version from workspace Zephyr directory
 */
async function detectSDKVersionFromWorkspace(setupState: SetupState): Promise<string | undefined> {
    try {
        const zephyrDir = setupState.zephyrDir;
        if (!zephyrDir) {
            return undefined;
        }

        const sdkVersionFile = path.join(zephyrDir, "SDK_VERSION");
        if (await fs.pathExists(sdkVersionFile)) {
            const content = await fs.readFile(sdkVersionFile, 'utf-8');
            return content.trim();
        }
    } catch (error) {
        outputError("SDK Install", `Error detecting SDK version from workspace: ${error}`);
    }
    return undefined;
}

/**
 * Detects the newest installed SDK version from the toolchains directory
 * by scanning for zephyr-sdk-* folders and reading their sdk_version files.
 */
async function detectInstalledSDKVersion(): Promise<string | undefined> {
    try {
        const toolchainsDir = getToolchainDir();
        if (!await fs.pathExists(toolchainsDir)) {
            return undefined;
        }
        const entries = await fs.readdir(toolchainsDir);
        const sdkDirs = entries.filter(e => e.startsWith("zephyr-sdk-"));
        if (sdkDirs.length === 0) {
            return undefined;
        }
        // Extract versions and sort descending to find the newest
        const versions = sdkDirs
            .map(d => d.replace("zephyr-sdk-", ""))
            .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
        return versions[0];
    } catch (error) {
        outputError("SDK Install", `Error detecting installed SDK version: ${error}`);
    }
    return undefined;
}

/**
 * Prompts user to select SDK version and toolchains as a single MultiStep
 * wizard so the user can navigate back between steps.
 *
 * Returns null if the user cancelled, or an object with:
 *   - sdkVersion: string for a specific version, undefined for "latest"
 *   - toolchains: string[] (["all"] for all toolchains)
 */
async function selectSDKVersionAndToolchains(setupState: SetupState): Promise<{ sdkVersion: string | undefined; toolchains: string[] } | null> {
    const title = "Install Zephyr SDK";

    type State = {
        sdkVersion?: string | undefined; // undefined means "latest", not-yet-set is indicated by sdkVersionChosen
        sdkVersionChosen?: boolean;
        toolchains?: string[];
    };
    const state: State = {};

    async function pickSDKVersion(input: MultiStepInput) {
        const selected = await input.showQuickPick({
            title,
            step: 1,
            totalSteps: 2,
            placeholder: "Select SDK version to install",
            ignoreFocusOut: true,
            items: sdkVersions,
        });

        if (selected.label === "automatic") {
            const detectedVersion = await detectSDKVersionFromWorkspace(setupState);
            if (!detectedVersion) {
                notifyError("SDK Install",
                    "Could not auto-detect SDK version from workspace. Please select a specific version."
                );
                // Signal abort to the caller by leaving sdkVersionChosen false.
                return;
            }
            void vscode.window.showInformationMessage(
                `Auto-detected SDK version: ${detectedVersion}`
            );
            state.sdkVersion = detectedVersion;
        } else if (selected.label === "latest") {
            state.sdkVersion = undefined; // undefined means latest
        } else {
            state.sdkVersion = selected.label;
        }
        state.sdkVersionChosen = true;

        return (input: MultiStepInput) => pickInstallChoice(input);
    }

    async function pickInstallChoice(input: MultiStepInput) {
        const installAllOption = { label: "Install All Toolchains", description: "Install all available toolchains" };
        const selectSpecificOption = { label: "Select Specific Toolchains", description: "Choose which toolchains to install" };

        const selected = await input.showQuickPick({
            title,
            step: 2,
            totalSteps: 2,
            placeholder: "Choose toolchain installation option",
            ignoreFocusOut: true,
            items: [installAllOption, selectSpecificOption],
        });

        if (selected.label === "Install All Toolchains") {
            state.toolchains = ["all"];
            return; // Done
        }

        return (input: MultiStepInput) => pickSpecificToolchains(input);
    }

    async function pickSpecificToolchains(input: MultiStepInput) {
        const selected = await input.showQuickPickMany({
            title,
            step: 2,
            totalSteps: 2,
            placeholder: "Select toolchains to install (toggle then press Enter)",
            ignoreFocusOut: true,
            items: toolchainTargets.filter(item => item.kind !== vscode.QuickPickItemKind.Separator),
        });

        if (!selected || !Array.isArray(selected) || selected.length === 0) {
            // Leave state.toolchains unset so caller treats as cancel
            return;
        }
        state.toolchains = (selected as readonly vscode.QuickPickItem[]).map(item => item.label);
    }

    // MultiStepInput.run consumes user cancel internally. We rely on the
    // state flags (sdkVersionChosen + toolchains) to detect successful
    // completion.
    await MultiStepInput.run(input => pickSDKVersion(input));

    if (!state.sdkVersionChosen || !state.toolchains || state.toolchains.length === 0) {
        return null;
    }

    return { sdkVersion: state.sdkVersion, toolchains: state.toolchains };
}

/**
 * Installs SDK with specific toolchains
 */
export async function installSDK(
    setupState: SetupState,
    sdkVersion?: string,
    toolchains?: string[]
): Promise<boolean> {
    try {
        const toolchainsDir = getToolchainDir();

        // Check if SDK is already installed in the toolchains directory.
        // The upstream `west sdk install` uses CMake find_package to detect
        // installed SDKs, but it only searches standard OS paths (e.g. /opt,
        // ~/), not the custom toolchains directory used by Zephyr IDE.
        // Without this check, repeated installs to the same base directory
        // fail with "Destination path already exists".
        if (sdkVersion) {
            const sdkDir = path.join(toolchainsDir, `zephyr-sdk-${sdkVersion}`);
            const sdkVersionFile = path.join(sdkDir, "sdk_version");
            if (await fs.pathExists(sdkVersionFile)) {
                outputInfo("SDK Install", `SDK version ${sdkVersion} already installed at: ${sdkDir}, skipping download`);
                return true;
            }
        }

        let command = sdkVersion
            ? `west sdk install --version ${sdkVersion} -H `
            : `west sdk install -H`;

        command += ` -b "${toolchainsDir}"`;

        // Pass GitHub token to avoid API rate limits (especially in CI).
        // The token is read from GITHUB_TOKEN which is automatically
        // available in GitHub Actions runners.
        const ghToken = process.env.GITHUB_TOKEN;
        if (ghToken) {
            command += ` --personal-access-token ${ghToken}`;
            outputInfo("SDK Install", "Using GITHUB_TOKEN for authenticated GitHub API access");
        }

        // Add toolchain selection if specified
        if (toolchains && toolchains.length > 0 && !toolchains.includes("all")) {
            const toolchainArgs = toolchains.map(tc => `-t ${tc}`).join(" ");
            command += ` ${toolchainArgs}`;
        }

        // Redact the personal access token before logging to prevent credential leaks
        const logCommand = ghToken ? command.replace(ghToken, '***') : command;
        outputInfo("SDK Install", `Installing SDK using: ${logCommand}`);
        outputInfo("SDK Install", `  cwd: ${setupState.setupPath}`);
        outputInfo("SDK Install", `  toolchains dir: ${toolchainsDir}`);

        // In CI environments, use shell command execution since VS Code task
        // infrastructure is not reliable in headless CI environments.
        // The venv PATH must be explicitly set so that west and its extension
        // dependencies (patoolib, semver, etc.) are found correctly.
        let success: boolean;
        if (process.env.CI) {
            const result = await executeShellCommandInPythonEnv(
                command,
                setupState.setupPath,
                setupState
            );
            success = result.stdout !== undefined;
            if (!success && result.stderr) {
                outputError("SDK Install", `Command stderr: ${result.stderr}`);
            }
        } else {
            success = await executeTaskHelperInPythonEnv(
                setupState,
                "Zephyr IDE: SDK Install",
                command,
                setupState.setupPath
            );
        }

        if (success) {
            outputInfo("SDK Install", "SDK install command completed successfully");
            return true;
        } else {
            outputError("SDK Install", "SDK install command failed");
            return false;
        }
    } catch (error) {
        const errorMsg = `Error installing SDK: ${error}`;
        outputError("SDK Install", errorMsg);
        return false;
    }
}

/**
 * Main SDK installation function that handles the complete user workflow
 */
export async function installSDKInteractive(wsConfig: WorkspaceConfig, globalConfig: GlobalConfig, context?: vscode.ExtensionContext) {
    const tracker = new SetupProgressTracker("SDK Installation", [
        { id: 'resolve', label: 'Resolving west workspace' },
        { id: 'version', label: 'Selecting SDK version' },
        { id: 'toolchains', label: 'Selecting toolchains' },
        { id: 'install', label: 'Downloading and installing SDK' },
        { id: 'verify', label: 'Verifying installation' },
    ], _onSDKProgress);

    try {
        outputInfo("SDK Install", "Starting interactive SDK installation...");

        tracker.startStep('resolve');
        const setupState = await getWestSDKContext(wsConfig, globalConfig, context);

        if (!setupState) {
            tracker.failStep('resolve', 'No valid west installation found');
            notifyError("SDK Install",
                "No valid west installation found. Please set up a Zephyr workspace first."
            );
            return;
        }
        outputInfo("SDK Install", `Found west SDK context (setupPath: ${setupState.setupPath})`);
        tracker.completeStep('resolve', `Using: ${setupState.setupPath}`);

        // Step 1+2 combined: select SDK version and toolchains as a single
        // MultiStep wizard so the user can navigate back between them.
        tracker.startStep('version');
        const selection = await selectSDKVersionAndToolchains(setupState);
        if (!selection) {
            outputInfo("SDK Install", "SDK version/toolchain selection was cancelled or failed, aborting SDK install");
            tracker.failStep('version', 'Selection cancelled');
            return;
        }
        const sdkVersion = selection.sdkVersion;
        const toolchains = selection.toolchains;
        outputInfo("SDK Install", `SDK version selection result: ${sdkVersion === undefined ? 'latest' : sdkVersion}`);
        tracker.completeStep('version', sdkVersion ?? 'latest');

        outputInfo("SDK Install", `Toolchain selection result: ${toolchains.join(', ')}`);
        tracker.startStep('toolchains');
        tracker.completeStep('toolchains', toolchains.includes('all') ? 'All toolchains' : toolchains.join(', '));

        // Step 3: Install with progress
        tracker.startStep('install', 'Running west sdk install...');
        return await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: "Installing Zephyr SDK",
                cancellable: false,
            },
            async (progress) => {
                progress.report({
                    message: "Installing SDK using west sdk command...",
                });

                outputInfo("SDK Install", `Starting SDK install task (version: ${sdkVersion}, toolchains: ${toolchains.join(', ')})...`);
                const result = await installSDK(setupState, sdkVersion, toolchains);
                outputInfo("SDK Install", `SDK install task completed with result: ${result}`);
                if (result) {
                    tracker.completeStep('install');
                    tracker.startStep('verify', 'Updating global state...');

                    globalConfig.sdkInstalled = true;
                    if (sdkVersion) {
                        globalConfig.sdkVersion = sdkVersion;
                    } else {
                        // "latest" was selected — detect version from installed SDK directory
                        const detected = await detectInstalledSDKVersion();
                        if (detected) {
                            globalConfig.sdkVersion = detected;
                        }
                    }
                    if (context) {
                        await setGlobalState(context, globalConfig);
                    }

                    tracker.completeStep('verify', `SDK ${globalConfig.sdkVersion || ''} ready`);
                    tracker.complete('Zephyr SDK installed successfully!');
                    void vscode.window.showInformationMessage(
                        "Zephyr SDK installed successfully!"
                    );
                } else {
                    tracker.failStep('install', 'west sdk install command failed');
                    tracker.fail('SDK installation failed. Check the Output panel for details.');
                    notifyError("SDK Install",
                        `Failed to install SDK`
                    );
                }
                return result;
            }
        );
    } catch (error) {
        outputError("SDK Install", `SDK installation threw an error: ${error}`);
        tracker.fail(`Error: ${error}`);
        notifyError("SDK Install", `Failed to install SDK: ${error}`);
    }
}
