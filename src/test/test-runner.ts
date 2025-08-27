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
    try {
        // Use the extension's own build dependency checker
        const result = await checkIfToolsAvailable(context, wsConfig, globalConfig, false);

        if (result) {
            console.log('✓ Build dependencies are available');
            return true;
        } else {
            console.log('⚠ Build dependencies are not available');
            return false;
        }
    } catch (error) {
        console.log('⚠ Error checking build dependencies:', error);
        return false;
    }
}

/**
 * Legacy function for backward compatibility - use checkBuildDependencies instead
 * @deprecated Use checkBuildDependencies instead
 */
export async function checkZephyrToolsAvailable(): Promise<boolean> {
    try {
        // Just check for basic tools as a fallback
        await execAsync('python --version');
        await execAsync('cmake --version');

        console.log('✓ Basic development tools are available');
        return true;
    } catch (error) {
        console.log('⚠ Basic development tools not available:', error);
        return false;
    }
}

/**
 * Check if we're running in a CI environment
 */
export function isCI(): boolean {
    return !!(
        process.env.CI ||
        process.env.GITHUB_ACTIONS ||
        process.env.GITLAB_CI ||
        process.env.JENKINS_URL ||
        process.env.BUILDKITE ||
        process.env.CIRCLECI
    );
}

/**
 * Check if we should skip build tests
 */
export function shouldSkipBuildTests(): boolean {
    return process.env.SKIP_BUILD_TESTS === 'true';
}

/**
 * Log test environment information
 */
export function logTestEnvironment(): void {
    console.log('=== Test Environment ===');
    console.log('CI Environment:', isCI());
    console.log('Skip Build Tests:', shouldSkipBuildTests());
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

    // Debug: Check workspace directory periodically
    const workspaceDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    console.log(`🔧 Debug: Monitoring workspace directory: ${workspaceDir}`);

    while (!sdkInstalled) {
        const extension = vscode.extensions.getExtension("mylonics.zephyr-ide");
        let wsConfig = null;

        if (extension?.isActive && extension.exports?.getWorkspaceConfig) {
            wsConfig = extension.exports.getWorkspaceConfig();
        }

        // Debug: Check workspace contents periodically
        if (workspaceDir && await fs.pathExists(workspaceDir)) {
            try {
                const items = await fs.readdir(workspaceDir);
                if (items.length > 0 && waitTime % 30000 === 0) {
                    console.log(`🔧 Debug: Workspace contents: ${items.join(', ')}`);
                }
            } catch (err) {
                console.log(`🔧 Debug: Error reading workspace: ${err}`);
            }
        }

        if (wsConfig) {
            if (!initialSetupComplete && wsConfig.initialSetupComplete) {
                console.log("    ✅ Initial setup completed - west.yml created");
                initialSetupComplete = true;

                // Debug: Check if files actually exist
                if (workspaceDir) {
                    const westYml = path.join(workspaceDir, 'west.yml');
                    const exists = await fs.pathExists(westYml);
                    console.log(`🔧 Debug: west.yml exists: ${exists}`);
                }
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

                // Debug: Final workspace check
                if (workspaceDir && await fs.pathExists(workspaceDir)) {
                    const items = await fs.readdir(workspaceDir);
                    console.log(`🔧 Debug: Final workspace contents: ${items.join(', ')}`);
                }
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
 * Print directory structure for debugging test failures
 * @param dirPath Path to the directory to print
 * @param maxDepth Maximum depth to traverse (default: 3)
 * @param currentDepth Current depth level (used internally)
 */
export async function printDirectoryStructure(dirPath: string, maxDepth: number = 3, currentDepth: number = 0): Promise<void> {
    if (currentDepth >= maxDepth || !await fs.pathExists(dirPath)) {
        return;
    }

    try {
        const items = await fs.readdir(dirPath);
        const indent = "  ".repeat(currentDepth);

        for (const item of items.sort()) {
            const itemPath = path.join(dirPath, item);
            const stats = await fs.stat(itemPath);

            if (stats.isDirectory()) {
                console.log(`${indent}📁 ${item}/`);
                await printDirectoryStructure(itemPath, maxDepth, currentDepth + 1);
            } else {
                console.log(`${indent}📄 ${item}`);
            }
        }
    } catch (error) {
        const indent = "  ".repeat(currentDepth);
        console.log(`${indent}❌ Error reading directory: ${error}`);
    }
}

/**
 * Print workspace directory structure for test completion (success or failure)
 * @param testName Name of the test
 * @param error Optional error object if test failed
 */
export async function printWorkspaceStructure(testName: string, error?: any): Promise<void> {
    if (error) {
        console.log(`\n❌ Test "${testName}" failed:`);
        console.log(`Error: ${error.message || error}`);
    } else {
        console.log(`\n🎉 ${testName} SUCCEEDED! Final workspace structure:`);
    }

    // Get workspace directory from VS Code workspace folders
    let testWorkspaceDir: string | undefined;

    if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
        testWorkspaceDir = vscode.workspace.workspaceFolders[0].uri.fsPath;
        console.log(`📁 Test workspace directory: ${testWorkspaceDir}`);
    } else {
        console.log(`❌ No VS Code workspace folders available`);
        console.log(`� Current working directory: ${process.cwd()}`);
        if (error) {
            console.log(`\n`);
        } else {
            console.log(`✅ ${testName} completed successfully!\n`);
        }
        return;
    }

    if (testWorkspaceDir && await fs.pathExists(testWorkspaceDir)) {
        console.log(`📂 Final workspace directory structure:`);
        console.log(`🔍 Debug: Scanning directory: ${testWorkspaceDir}`);

        try {
            const items = await fs.readdir(testWorkspaceDir);
            console.log(`🔍 Debug: Found ${items.length} items: ${items.join(', ')}`);
        } catch (err) {
            console.log(`🔍 Debug: Error reading directory: ${err}`);
        }

        await printDirectoryStructure(testWorkspaceDir, 3);

        // Print key configuration files
        const westYml = path.join(testWorkspaceDir, 'west.yml');
        if (await fs.pathExists(westYml)) {
            console.log(`📄 west.yml configuration:`);
            try {
                const content = await fs.readFile(westYml, 'utf8');
                console.log(content.split('\n').slice(0, 20).join('\n')); // Show first 20 lines
                if (content.split('\n').length > 20) {
                    console.log('... (truncated)');
                }
            } catch (err) {
                console.log(`❌ Error reading west.yml: ${err}`);
            }
        }

        // Print project count summary
        try {
            const items = await fs.readdir(testWorkspaceDir);
            console.log(`🔍 Debug: Directory contents for summary: ${items.join(', ')}`);
            const directories = [];
            for (const item of items) {
                const itemPath = path.join(testWorkspaceDir, item);
                try {
                    const stat = await fs.stat(itemPath);
                    if (stat.isDirectory() && !item.startsWith('.')) {
                        directories.push(item);
                        console.log(`🔍 Debug: Found directory: ${item}`);
                    } else {
                        console.log(`🔍 Debug: Skipping ${item} (${stat.isDirectory() ? 'hidden' : 'file'})`);
                    }
                } catch (statErr) {
                    console.log(`🔍 Debug: Error stating ${item}: ${statErr}`);
                }
            }
            console.log(`📊 Workspace summary: ${directories.length} main directories`);
            if (directories.length > 0) {
                console.log(`   Directories: ${directories.slice(0, 10).join(', ')}${directories.length > 10 ? ', ...' : ''}`);
            }
        } catch (err) {
            console.log(`⚠ Could not analyze workspace summary: ${err}`);
        }

        // For failures, also print additional debug files
        if (error) {
            // Print .vscode directory if it exists (often relevant for failures)
            const vscodeDir = path.join(testWorkspaceDir, '.vscode');
            if (await fs.pathExists(vscodeDir)) {
                console.log(`📂 .vscode directory contents:`);
                await printDirectoryStructure(vscodeDir, 2);
            }

            // Print zephyr-ide.json if it exists
            const zephyrIdeJson = path.join(testWorkspaceDir, '.vscode', 'zephyr-ide.json');
            if (await fs.pathExists(zephyrIdeJson)) {
                console.log(`📄 zephyr-ide.json contents:`);
                try {
                    const content = await fs.readFile(zephyrIdeJson, 'utf8');
                    console.log(content);
                } catch (err) {
                    console.log(`❌ Error reading zephyr-ide.json: ${err}`);
                }
            }
        }
    } else {
        console.log(`❌ Test workspace directory does not exist: ${testWorkspaceDir}`);
    }

    if (error) {
        console.log(`\n`);
    } else {
        console.log(`✅ ${testName} completed successfully!\n`);
    }
}

/**
 * Setup test workspace with VS Code mocking
 * @param prefix Directory prefix for test workspace (e.g., "std", "west-git")
 * @returns Object containing testWorkspaceDir and originalWorkspaceFolders
 */
export async function setupTestWorkspace(prefix: string): Promise<{
    testWorkspaceDir: string;
    originalWorkspaceFolders: readonly vscode.WorkspaceFolder[] | undefined;
}> {
    // Create isolated temporary directory
    const testWorkspaceDir = path.join(os.tmpdir(), `${prefix}-${Date.now()}`);
    await fs.ensureDir(testWorkspaceDir);
    console.log(`🔧 Debug: Created test workspace directory: ${testWorkspaceDir}`);

    // Mock VS Code workspace folder
    const mockWorkspaceFolder: vscode.WorkspaceFolder = {
        uri: vscode.Uri.file(testWorkspaceDir),
        name: path.basename(testWorkspaceDir),
        index: 0,
    };

    // Store original workspace folders for restoration
    const originalWorkspaceFolders = vscode.workspace.workspaceFolders;
    Object.defineProperty(vscode.workspace, "workspaceFolders", {
        value: [mockWorkspaceFolder],
        configurable: true,
    });

    console.log(`🔧 Debug: Set VS Code workspace folder to: ${testWorkspaceDir}`);

    // Check if directory actually exists and is accessible
    const exists = await fs.pathExists(testWorkspaceDir);
    console.log(`🔧 Debug: Directory exists: ${exists}`);
    if (exists) {
        const items = await fs.readdir(testWorkspaceDir);
        console.log(`🔧 Debug: Initial directory contents: ${items.length} items`);
    }

    // Mock VS Code configuration and UI methods
    vscode.workspace.getConfiguration = () =>
    ({
        get: () => undefined,
        update: () => Promise.resolve(),
        has: () => false,
        inspect: (key: string) => ({
            key,
            defaultValue: undefined,
            globalValue: undefined,
            workspaceValue: undefined,
            workspaceFolderValue: undefined,
        }),
    } as any);

    vscode.window.showInformationMessage = async () => undefined;
    vscode.window.showWarningMessage = async () => undefined;
    vscode.window.showErrorMessage = async () => undefined;

    return { testWorkspaceDir, originalWorkspaceFolders };
}

/**
 * Cleanup test workspace and restore VS Code state
 * @param testWorkspaceDir Directory to cleanup
 * @param originalWorkspaceFolders Original workspace folders to restore
 */
export async function cleanupTestWorkspace(
    testWorkspaceDir: string,
    originalWorkspaceFolders: readonly vscode.WorkspaceFolder[] | undefined
): Promise<void> {
    // Print workspace structure before cleanup (works for both success and failure)
    if (testWorkspaceDir && await fs.pathExists(testWorkspaceDir)) {
        // Extract test name from directory path for logging
        const dirName = path.basename(testWorkspaceDir);
        const testName = dirName.includes('basic-') ? 'Basic Workspace Test' :
            dirName.includes('std-') ? 'Standard Workspace Test' :
                dirName.includes('west-git-') ? 'West Git Workspace Test' :
                    dirName.includes('curr-dir-') ? 'Local West Workspace Test' :
                        dirName.includes('out-tree-') ? 'External Zephyr Workspace Test' :
                            dirName.includes('ide-spc-') ? 'Zephyr IDE Git Workspace Test' :
                                'Workspace Test';

        await printWorkspaceStructure(testName);
    }

    // Restore original workspace folders
    if (originalWorkspaceFolders !== undefined) {
        Object.defineProperty(vscode.workspace, "workspaceFolders", {
            value: originalWorkspaceFolders,
            configurable: true,
        });
    }

    // Remove test directory
    if (testWorkspaceDir && (await fs.pathExists(testWorkspaceDir))) {
        await fs.remove(testWorkspaceDir);
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

    // Debug workspace state before build
    const workspaceDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    console.log(`🔧 Debug: Build workspace directory: ${workspaceDir}`);
    if (workspaceDir && await fs.pathExists(workspaceDir)) {
        const items = await fs.readdir(workspaceDir);
        console.log(`🔧 Debug: Workspace contents before build: ${items.length} items - ${items.join(', ')}`);
    }

    // Check if workspace setup is complete
    const ext = vscode.extensions.getExtension("mylonics.zephyr-ide");
    const wsConfig = ext?.exports?.getWorkspaceConfig();
    console.log(`🔧 Debug: Extension active: ${ext?.isActive}, wsConfig: ${!!wsConfig}`);
    if (wsConfig) {
        console.log(`🔧 Debug: initialSetupComplete: ${wsConfig.initialSetupComplete}`);
    }

    if (!wsConfig?.initialSetupComplete) {
        console.log(`⚠️ Setup not complete for ${testName}, retrying in ${retryDelayMs / 1000} seconds...`);
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }

    const result = await vscode.commands.executeCommand("zephyr-ide.build");
    console.log(`🔧 Debug: Build command result: ${result}`);
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
        await printWorkspaceStructure(testName, error);
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
    console.log(`🔧 Debug: Executing VS Code command: ${commandId}`);
    console.log(`🔧 Debug: Current workspace folder: ${vscode.workspace.workspaceFolders?.[0]?.uri.fsPath}`);

    // Check workspace directory before command
    const workspaceDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (workspaceDir && await fs.pathExists(workspaceDir)) {
        const itemsBefore = await fs.readdir(workspaceDir);
        console.log(`🔧 Debug: Workspace contents BEFORE command: ${itemsBefore.length} items - ${itemsBefore.join(', ')}`);
    }

    uiMock.primeInteractions(interactions);

    const result = await vscode.commands.executeCommand(commandId);
    console.log(`🔧 Debug: Command result: ${result}`);

    // Check workspace directory after command
    if (workspaceDir && await fs.pathExists(workspaceDir)) {
        const itemsAfter = await fs.readdir(workspaceDir);
        console.log(`🔧 Debug: Workspace contents AFTER command: ${itemsAfter.length} items - ${itemsAfter.join(', ')}`);
    }

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
    addBuildConfig: [
        { type: 'quickpick', value: 'qemu_x86', description: 'Select QEMU x86 board' }
    ],

    // SDK installation interactions
    sdkAutoInstall: [
        { type: 'quickpick', value: 'automatic', description: 'Select SDK Version' },
        { type: 'quickpick', value: 'select specific', description: 'Select specific toolchains' },
        { type: 'quickpick', value: 'arm-zephyr-eabi', description: 'Select ARM toolchain', multiSelect: true }
    ]
};
