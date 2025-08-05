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
