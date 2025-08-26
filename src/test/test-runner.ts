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
 * Print workspace structure on test failure for debugging
 * @param testWorkspaceDir Path to the test workspace directory
 * @param testName Name of the test that failed
 * @param error The error that occurred
 */
export async function printWorkspaceOnFailure(testWorkspaceDir: string, testName: string, error: any): Promise<void> {
    console.log(`\n❌ Test "${testName}" failed:`);
    console.log(`Error: ${error.message || error}`);
    console.log(`📁 Test workspace directory: ${testWorkspaceDir}`);
    
    if (await fs.pathExists(testWorkspaceDir)) {
        console.log(`📂 Workspace directory structure:`);
        await printDirectoryStructure(testWorkspaceDir, 3);
        
        // Also print .vscode directory if it exists (often relevant for failures)
        const vscodeDir = path.join(testWorkspaceDir, '.vscode');
        if (await fs.pathExists(vscodeDir)) {
            console.log(`📂 .vscode directory contents:`);
            await printDirectoryStructure(vscodeDir, 2);
        }
        
        // Print west.yml if it exists
        const westYml = path.join(testWorkspaceDir, 'west.yml');
        if (await fs.pathExists(westYml)) {
            console.log(`📄 west.yml contents:`);
            try {
                const content = await fs.readFile(westYml, 'utf8');
                console.log(content);
            } catch (err) {
                console.log(`❌ Error reading west.yml: ${err}`);
            }
        }
    } else {
        console.log(`❌ Test workspace directory does not exist: ${testWorkspaceDir}`);
    }
    
    console.log(`\n`);
}
