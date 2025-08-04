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

import {
    WorkspaceConfig,
    GlobalConfig,
    SetupState,
    getToolsDir,
} from "./setup";
import { executeTaskHelperInPythonEnv, executeShellCommandInPythonEnv, output } from "../utilities/utils";
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

/**
 * Determines the best west installation to use for SDK management
 * Priority: 1. Global zephyr install, 2. Current workspace install, 3. First available install
 */
export async function getWestSDKContext(
    wsConfig: WorkspaceConfig,
    globalConfig: GlobalConfig
): Promise<SetupState | undefined> {
    // Try global zephyr install first
    if (globalConfig.setupState && (await isValidWestInstall(globalConfig.setupState))) {
        return globalConfig.setupState;
    }

    // Try current workspace install
    if (wsConfig.activeSetupState && (await isValidWestInstall(wsConfig.activeSetupState))) {
        return wsConfig.activeSetupState;
    }

    // Try first available install
    if (globalConfig.setupStateDictionary) {
        for (const setupPath in globalConfig.setupStateDictionary) {
            const setupState = globalConfig.setupStateDictionary[setupPath];
            if (await isValidWestInstall(setupState)) {
                return setupState;
            }
        }
    }

    return undefined;
}

/**
 * Validates if a setup state has a valid west installation
 */
async function isValidWestInstall(setupState: SetupState): Promise<boolean> {
    if (!setupState.setupPath) {
        return false;
    }

    const westConfigPath = path.join(setupState.setupPath, ".west");
    return await fs.pathExists(westConfigPath);
}

/**
 * Lists available SDKs using west sdk list
 */
export async function listAvailableSDKs(
    setupState: SetupState
): Promise<WestSDKResult> {
    try {
        const result = await executeShellCommandInPythonEnv(
            `west sdk list`,
            setupState.setupPath,
            setupState
        );

        if (result.stdout) {
            return {
                success: true,
                output: result.stdout,
            };
        } else {
            return {
                success: false,
                error: result.stderr || "Failed to list SDKs",
            };
        }
    } catch (error) {
        return {
            success: false,
            error: `Error listing SDKs: ${error}`,
        };
    }
}

/**
 * Gets current SDK information using west sdk info
 */
export async function getCurrentSDKInfo(
    setupState: SetupState
): Promise<SDKInfo> {
    try {
        const result = await executeShellCommandInPythonEnv(
            `west sdk info`,
            setupState.setupPath,
            setupState
        );

        if (result.stdout) {
            // Parse the output to extract SDK information
            const lines = result.stdout.split("\n");
            let version: string | undefined;
            let sdkPath: string | undefined;
            let isDefault = false;

            for (const line of lines) {
                if (line.includes("Version:")) {
                    version = line.split(":")[1]?.trim();
                } else if (line.includes("Path:")) {
                    sdkPath = line.split(":")[1]?.trim();
                } else if (line.includes("Default:") && line.includes("yes")) {
                    isDefault = true;
                }
            }

            return {
                version,
                path: sdkPath,
                status: version ? "installed" : "not-installed",
                isDefault,
            };
        } else {
            // Check if the error indicates no SDK is installed
            if (
                result.stderr?.includes("No SDK") ||
                result.stderr?.includes("not found")
            ) {
                return {
                    status: "not-installed",
                };
            }
            return {
                status: "error",
            };
        }
    } catch (error) {
        return {
            status: "error",
        };
    }
}

/**
 * Installs the latest SDK using west sdk install
 */
export async function installLatestSDK(
    setupState: SetupState,
    version?: string
): Promise<WestSDKResult> {
    try {
        // Get the toolchains directory in .zephyr-ide
        const toolchainsDir = path.join(await getToolsDir(), "toolchains");

        const command = version
            ? `west sdk install --version ${version} -b "${toolchainsDir}" -H`
            : `west sdk install -b "${toolchainsDir}" -H`;

        output.appendLine(`Installing SDK using: ${command}`);

        const result = await executeTaskHelperInPythonEnv(
            setupState,
            "Install Zephyr SDK",
            command,
            setupState.setupPath
        );

        if (result) {
            output.appendLine("SDK installation completed successfully");
            return {
                success: true,
                output: "SDK installation completed successfully",
            };
        } else {
            output.appendLine("SDK installation failed");
            return {
                success: false,
                error: "Failed to install SDK",
            };
        }
    } catch (error) {
        const errorMsg = `Error installing SDK: ${error}`;
        output.appendLine(errorMsg);
        return {
            success: false,
            error: errorMsg,
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
        output.appendLine(`Error detecting SDK version from workspace: ${error}`);
    }
    return undefined;
}

/**
 * Prompts user to select SDK version
 */
async function selectSDKVersion(setupState: SetupState): Promise<string | undefined> {
    const selectedVersion = await vscode.window.showQuickPick(sdkVersions, {
        placeHolder: "Select SDK version to install",
        ignoreFocusOut: true,
    });

    if (!selectedVersion) {
        return undefined;
    }

    if (selectedVersion.label === "automatic") {
        const detectedVersion = await detectSDKVersionFromWorkspace(setupState);
        if (!detectedVersion) {
            vscode.window.showErrorMessage(
                "Could not auto-detect SDK version from workspace. Please select a specific version."
            );
            return undefined;
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
export async function installSDKWithToolchains(
    setupState: SetupState,
    sdkVersion?: string,
    toolchains?: string[]
): Promise<WestSDKResult> {
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

        output.appendLine(`Installing SDK using: ${command}`);

        const result = await executeTaskHelperInPythonEnv(
            setupState,
            "Install Zephyr SDK",
            command,
            setupState.setupPath
        );

        if (result) {
            output.appendLine("SDK installation completed successfully");
            return {
                success: true,
                output: "SDK installation completed successfully",
            };
        } else {
            output.appendLine("SDK installation failed");
            return {
                success: false,
                error: "Failed to install SDK",
            };
        }
    } catch (error) {
        const errorMsg = `Error installing SDK: ${error}`;
        output.appendLine(errorMsg);
        return {
            success: false,
            error: errorMsg,
        };
    }
}

/**
 * Main SDK installation function that handles the complete user workflow
 */
export async function installSDKInteractive(
    wsConfig: WorkspaceConfig,
    globalConfig: GlobalConfig
): Promise<void> {
    try {
        const setupState = await getWestSDKContext(wsConfig, globalConfig);

        if (!setupState) {
            vscode.window.showErrorMessage(
                "No valid west installation found. Please set up a Zephyr workspace first."
            );
            return;
        }

        // Step 1: Select SDK version
        const sdkVersion = await selectSDKVersion(setupState);
        if (sdkVersion === null) { // user cancelled
            return;
        }

        // Step 2: Select toolchains
        const toolchains = await selectToolchains();
        if (!toolchains) { // user cancelled
            return;
        }

        // Step 3: Install with progress
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: "Installing Zephyr SDK",
                cancellable: false,
            },
            async (progress) => {
                progress.report({
                    message: "Installing SDK using west sdk command...",
                });

                const result = await installSDKWithToolchains(setupState, sdkVersion, toolchains);

                if (result.success) {
                    globalConfig.sdkInstalled = true;
                    vscode.window.showInformationMessage(
                        "Zephyr SDK installed successfully!"
                    );
                } else {
                    vscode.window.showErrorMessage(
                        `Failed to install SDK: ${result.error}`
                    );
                }
            }
        );
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to install SDK: ${error}`);
    }
}
