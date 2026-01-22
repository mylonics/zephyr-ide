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

import * as cp from 'child_process';
import * as util from 'util';
import * as vscode from 'vscode';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import * as assert from 'assert';
import { WorkspaceConfig, GlobalConfig } from '../setup_utilities/types';
import { checkIfToolsAvailable } from '../setup_utilities/tools-validation';

const execAsync = util.promisify(cp.exec);

/**
 * Check if build dependencies are available using the extension's built-in check
 */
export async function checkBuildDependencies(
    context: vscode.ExtensionContext,
    wsConfig: WorkspaceConfig,
    globalConfig: GlobalConfig
): Promise<boolean> {
    const available = await checkIfToolsAvailable(context, wsConfig, globalConfig);
    if (!available) {
        console.log(`⚠️ Build dependencies not available`);
        return false;
    }
    return true;
}

/**
 * Check if build tests should be skipped based on environment variables
 */
export function shouldSkipBuildTests(): boolean {
    return process.env.SKIP_BUILD_TESTS === 'true' || process.env.CI === 'true';
}

/**
 * Check if host tools should be installed via the extension command
 */
export function shouldInstallHostTools(): boolean {
    return process.env.INSTALL_HOST_TOOLS === 'true';
}

/**
 * Install host tools using the zephyr-ide extension command
 * This is called when INSTALL_HOST_TOOLS=true environment variable is set
 * 
 * Note: The workflow YAML runs this 3 times in separate steps:
 * 1. First run: Installs the package manager
 * 2. Second run: With package manager in PATH, installs all other tools
 * 3. Third run: Verifies all tools are available and runs tests
 * 
 * Each workflow step runs in a fresh shell context which picks up PATH changes.
 */
export async function installHostToolsIfNeeded(): Promise<void> {
    if (!shouldInstallHostTools()) {
        console.log('🔧 INSTALL_HOST_TOOLS not set, skipping host tools installation');
        return;
    }

    console.log('🔧 INSTALL_HOST_TOOLS=true detected, installing host tools via extension...');
    
    try {
        const result = await vscode.commands.executeCommand('zephyr-ide.install-host-tools-headless');
        if (result) {
            console.log('✅ Host tools installation completed successfully');
        } else {
            console.log('⚠️  Host tools installation returned false - some tools may not have installed yet');
            console.log('    This is expected on first runs. The workflow will retry in the next step.');
        }
    } catch (error) {
        console.log(`❌ Host tools installation failed: ${error}`);
        throw error;
    }
}

/**
 * Log test environment information
 */
export function logTestEnvironment(): void {
    console.log('=== Test Environment ===');
    console.log('CI Environment:', process.env.CI === 'true');
    console.log('Skip Build Tests:', shouldSkipBuildTests());
    console.log('Install Host Tools:', shouldInstallHostTools());
    console.log('Node Version:', process.version);
    console.log('Platform:', process.platform);
    console.log('Architecture:', process.arch);
    console.log('========================');
}

/**
 * Monitor workspace setup progress for integration tests
 * @param setupType Type of setup being monitored (e.g., "workspace", "git workspace")
 */
export async function monitorWorkspaceSetup(setupType: string = "workspace"): Promise<void> {
    console.log(`⏳ Monitoring ${setupType} setup progress...`);
    let waitTime = 0;
    const checkInterval = 3000;
    let initialSetupComplete = false;
    let pythonEnvironmentSetup = false;
    let westUpdated = false;
    let packagesInstalled = false;
    let sdkInstalled = false;

    while (!sdkInstalled) {
        const extension = vscode.extensions.getExtension("mylonics.zephyr-ide");
        let wsConfig = null;

        if (extension?.isActive && extension.exports?.getWorkspaceConfig) {
            wsConfig = extension.exports.getWorkspaceConfig();
        }

        if (wsConfig) {
            if (!initialSetupComplete && wsConfig.initialSetupComplete) {
                console.log("    ✅ Initial setup completed - west.yml created");
                initialSetupComplete = true;
            }

            if (!westUpdated && wsConfig.activeSetupState?.westUpdated) {
                console.log("    ✅ West updated - All repos downloaded");
                westUpdated = true;
            }

            if (!pythonEnvironmentSetup && wsConfig.activeSetupState?.pythonEnvironmentSetup) {
                console.log("    ✅ Python environment setup completed");
                pythonEnvironmentSetup = true;
            }

            if (!packagesInstalled && wsConfig.activeSetupState?.packagesInstalled) {
                packagesInstalled = true;
                console.log("    ✅ Packages installed completed");
            }

            if (packagesInstalled && await vscode.commands.executeCommand("zephyr-ide.is-sdk-installed")) {
                sdkInstalled = true;
                console.log("    ✅ SDK installed");
                console.log(`🎉 All ${setupType} setup stages completed!`);
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
}

/**
 * Cleanup test workspace and restore VS Code workspace folders
 * @param testWorkspaceDir Test workspace directory to remove
 * @param originalWorkspaceFolders Original workspace folders to restore
 */

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
 * Execute final build command with workspace state validation
 * @param testName Name of the test for logging
 * @param retryDelayMs Delay before retry if setup not complete (default: 10000)
 */
export async function executeFinalBuild(
    testName: string,
    retryDelayMs: number = 10000
): Promise<void> {
    console.log("⚡ Executing final build...");

    // Check if workspace setup is complete
    const ext = vscode.extensions.getExtension("mylonics.zephyr-ide");
    const wsConfig = ext?.exports?.getWorkspaceConfig();

    if (!wsConfig?.initialSetupComplete) {
        console.log(`⚠️ Setup not complete for ${testName}, retrying in ${retryDelayMs / 1000} seconds...`);
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }

    const result = await vscode.commands.executeCommand("zephyr-ide.build");
    assert.ok(result, "Build execution should succeed");
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

        // Deactivate UI mock on success
        uiMock.deactivate();

        // Note: printWorkspaceOnSuccess should be called by the test itself
        // before the test completes to avoid race conditions with teardown

    } catch (error) {
        // Handle failure with detailed logging
        await printWorkspaceStructure(testName);
        await new Promise((resolve) => setTimeout(resolve, 30000));
        throw error;
    }
}

/**
 * Execute standard workspace setup command with UI mock interactions
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

/**
 * Common UI interaction patterns for different workspace setup types
 */
export const CommonUIInteractions = {
    // Standard workspace setup interactions
    standardWorkspace: [
        { type: 'quickpick', value: 'create new west.yml', description: 'Create new west.yml' },
        { type: 'quickpick', value: 'minimal', description: 'Select minimal manifest' },
        { type: 'quickpick', value: 'stm32', description: 'Select STM32 toolchain' },
        { type: 'quickpick', value: 'v4.2.0', description: 'Select default configuration' },
        { type: 'input', value: '', description: 'Select additional west init args' },
        { type: 'quickpick', value: 'automatic', description: 'Select SDK Version' },
        { type: 'quickpick', value: 'select specific', description: 'Select specific toolchains' },
        { type: 'quickpick', value: 'arm-zephyr-eabi', description: 'Select ARM toolchain', multiSelect: true }
    ],

    // Project creation interactions
    createBlinkyProject: [
        { type: 'quickpick', value: 'blinky', description: 'Select blinky template' },
        { type: 'input', value: 'blinky', description: 'Enter project name' }
    ],

    // Build configuration interactions
    configureBuild: [
        { type: 'quickpick', value: 'nucleo_f401re', description: 'Select board' },
        { type: 'quickpick', value: 'auto', description: 'Select pristine option' }
    ]
};
