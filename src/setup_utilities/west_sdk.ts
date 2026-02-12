/*
Copyright 2025 mylonics 
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
import * as path from "path";
import * as fs from "fs-extra";

import { WorkspaceConfig, GlobalConfig, SetupState } from "./types";
import { getToolsDir } from "./workspace-config";
import { executeShellCommandInPythonEnv, executeTaskHelperInPythonEnv } from "../utilities/utils";
import { outputInfo, outputWarning, outputError, notifyError, outputCommandFailure } from "../utilities/output";
import { sdkVersions, toolchainTargets } from "../defines";

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
 * Determines the best west installation to use for SDK management
 * Priority: 1. Global zephyr install, 2. Current workspace install
 * If no installation has the SDK command, manually inject it into the prioritized installation
 */
export async function getWestSDKContext(wsConfig: WorkspaceConfig, globalConfig: GlobalConfig, context?: vscode.ExtensionContext): Promise<SetupState | undefined> {
    const candidateStates: SetupState[] = [];

    // Collect candidate states in priority order
    // 1. Global install from setupStateDictionary
    if (globalConfig.setupStateDictionary) {
        const globalToolsDir = await getToolsDir();
        const globalSetupState = globalConfig.setupStateDictionary[globalToolsDir];
        if (globalSetupState) {
            candidateStates.push(globalSetupState);
        }
    }

    // 2. Current workspace install
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
    for (const setupState of candidateStates) {
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
 * Prompts user to select SDK version
 */
async function selectSDKVersion(setupState: SetupState): Promise<string | null | undefined> {
    const selectedVersion = await vscode.window.showQuickPick(sdkVersions, {
        placeHolder: "Select SDK version to install",
        ignoreFocusOut: true,
    });

    if (!selectedVersion) {
        return null; // user cancelled
    }

    if (selectedVersion.label === "automatic") {
        const detectedVersion = await detectSDKVersionFromWorkspace(setupState);
        if (!detectedVersion) {
            notifyError("SDK Install",
                "Could not auto-detect SDK version from workspace. Please select a specific version."
            );
            return null; // auto-detect failed
        }
        vscode.window.showInformationMessage(
            `Auto-detected SDK version: ${detectedVersion}`
        );
        return detectedVersion;
    }

    if (selectedVersion.label === "latest") {
        return undefined; // undefined means latest
    }

    return selectedVersion.label;
}

/**
 * Prompts user to select toolchains to install
 */
async function selectToolchains(): Promise<string[] | undefined> {
    const installAllOption = { label: "Install All Toolchains", description: "Install all available toolchains" };
    const selectSpecificOption = { label: "Select Specific Toolchains", description: "Choose which toolchains to install" };

    const installChoice = await vscode.window.showQuickPick(
        [installAllOption, selectSpecificOption],
        {
            placeHolder: "Choose toolchain installation option",
            ignoreFocusOut: true,
        }
    );

    if (!installChoice) {
        return undefined;
    }

    if (installChoice.label === "Install All Toolchains") {
        return ["all"];
    }

    // Let user select specific toolchains
    const selectedToolchains = await vscode.window.showQuickPick(
        toolchainTargets.filter(item => item.kind !== vscode.QuickPickItemKind.Separator),
        {
            placeHolder: "Select toolchains to install",
            canPickMany: true,
            ignoreFocusOut: true,
        }
    );

    if (!selectedToolchains || selectedToolchains.length === 0) {
        return undefined;
    }

    return selectedToolchains.map(item => item.label);
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
        const toolchainsDir = path.join(await getToolsDir(), "toolchains");

        let command = sdkVersion
            ? `west sdk install --version ${sdkVersion} -H `
            : `west sdk install -H`;

        command += ` -b "${toolchainsDir}"`;

        // Add toolchain selection if specified
        if (toolchains && toolchains.length > 0 && !toolchains.includes("all")) {
            const toolchainArgs = toolchains.map(tc => `-t ${tc}`).join(" ");
            command += ` ${toolchainArgs}`;
        }

        outputInfo("SDK Install", `Installing SDK using: ${command}`);
        outputInfo("SDK Install", `  cwd: ${setupState.setupPath}`);
        outputInfo("SDK Install", `  toolchains dir: ${toolchainsDir}`);

        // In CI or on Windows, use shell command execution since VS Code tasks
        // may not be available or reliable in those environments
        let success: boolean;
        if (process.env.CI || process.platform === 'win32') {
            const result = await executeShellCommandInPythonEnv(
                command,
                setupState.setupPath,
                setupState
            );
            success = result.stdout !== undefined;
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
    try {
        outputInfo("SDK Install", "Starting interactive SDK installation...");
        const setupState = await getWestSDKContext(wsConfig, globalConfig, context);

        if (!setupState) {
            notifyError("SDK Install",
                "No valid west installation found. Please set up a Zephyr workspace first."
            );
            return;
        }
        outputInfo("SDK Install", `Found west SDK context (setupPath: ${setupState.setupPath})`);

        // Step 1: Select SDK version
        const sdkVersion = await selectSDKVersion(setupState);
        outputInfo("SDK Install", `SDK version selection result: ${sdkVersion === null ? 'cancelled' : sdkVersion === undefined ? 'latest' : sdkVersion}`);
        if (sdkVersion === null) { // user cancelled or auto-detect failed
            outputInfo("SDK Install", "SDK version selection was cancelled or failed, aborting SDK install");
            return;
        }

        // Step 2: Select toolchains
        const toolchains = await selectToolchains();
        outputInfo("SDK Install", `Toolchain selection result: ${toolchains ? toolchains.join(', ') : 'cancelled'}`);
        if (!toolchains) { // user cancelled
            return;
        }

        // Step 3: Install with progress
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
                    globalConfig.sdkInstalled = true;
                    vscode.window.showInformationMessage(
                        "Zephyr SDK installed successfully!"
                    );
                } else {
                    notifyError("SDK Install",
                        `Failed to install SDK: ${result}`
                    );
                }
                return result;
            }
        );
    } catch (error) {
        outputError("SDK Install", `SDK installation threw an error: ${error}`);
        notifyError("SDK Install", `Failed to install SDK: ${error}`);
    }
}
