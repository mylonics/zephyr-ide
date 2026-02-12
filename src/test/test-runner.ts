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

import * as vscode from 'vscode';
import * as assert from 'assert';

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
        } else {
            console.log(`\n(No extension output captured for: ${label})`);
        }
    } catch (error) {
        console.log(`\n⚠️ Could not retrieve extension output: ${error}`);
    }
}

/**
 * Monitor workspace setup progress for integration tests
 * @param setupType Type of setup being monitored (e.g., "workspace", "git workspace")
 */
export async function monitorWorkspaceSetup(commandPromise: Thenable<any>, setupType: string = "workspace", timeoutMs: number = 600000): Promise<void> {
    console.log(`⏳ Monitoring ${setupType} setup progress... (timeout: ${timeoutMs / 1000}s)`);
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
 * Execute final build command with workspace state validation.
 * Monitors the build command's exit code to determine success.
 * The build command returns `true` when the underlying process exits with code 0.
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
    console.log(`   Build command returned: ${result} (exit code ${result ? '0 - success' : 'non-zero - failure'})`);
    assert.strictEqual(result, true, `Build command must return true (exit code 0). Got: ${result}`);
    console.log(`   ✅ Build succeeded for ${testName}`);
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

        // Dump extension output to the test stream
        await dumpExtensionOutput(`${testName} - Extension Output`);

    } catch (error) {
        // Dump extension output so the CI log contains the full trace
        await dumpExtensionOutput(`${testName} - Extension Output (FAILED)`);

        // Handle failure with detailed logging
        await printWorkspaceStructure(testName);
        await new Promise((resolve) => setTimeout(resolve, 30000));
        throw error;
    }
}

/**
 * Start a workspace setup command without awaiting it.
 * Returns the command promise so it can be passed to monitorWorkspaceSetup
 * for concurrent progress monitoring and early failure detection.
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

    // Simulated workspace setup interactions (native_sim, no HALs)
    simWorkspace: [
        { type: 'quickpick', value: 'create new west.yml', description: 'Create new west.yml' },
        { type: 'quickpick', value: 'sim only', description: 'Select simulated manifest' },
        { type: 'quickpick', value: 'v4.2.0', description: 'Select default configuration' },
        { type: 'input', value: '', description: 'Select additional west init args' },
        { type: 'quickpick', value: 'automatic', description: 'Select SDK Version' },
        { type: 'quickpick', value: 'select specific', description: 'Select specific toolchains' },
        { type: 'quickpick', value: 'x86_64-zephyr-elf', description: 'Select x86_64 toolchain', multiSelect: true }
    ],

    // Testing workspace setup interactions (RPi Pico, ARM toolchain)
    testingWorkspace: [
        { type: 'quickpick', value: 'create new west.yml', description: 'Create new west.yml' },
        { type: 'quickpick', value: 'testing', description: 'Select testing manifest' },
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
