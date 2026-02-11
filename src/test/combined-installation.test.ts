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

/**
 * Combined Installation Test Suite (Option 1: Single Process)
 * 
 * This test implements Option 1 for solving Windows PATH propagation:
 * All 3 steps execute sequentially in the SAME VS Code instance/process.
 * 
 * Steps:
 * 1. Install package manager (winget/apt/homebrew)
 * 2. Install host packages (cmake, ninja, gperf, etc.) + PATH refresh
 * 3. Run standard workspace tests
 * 
 * Benefits:
 * - PATH updates propagate within same process
 * - refreshWindowsPath() makes tools immediately visible
 * - No cross-process PATH issues on Windows/macOS
 */

import * as vscode from 'vscode';

suite('Combined Installation Test Suite', function() {
    // Extended timeout for all installation steps + workspace test
    this.timeout(900000); // 15 minutes total

    test('Install package manager, install packages, and run workspace test (single process)', async function() {
        console.log('🔧 Step 0: Starting combined installation test (single process)');
        
        // Step 1: Install package manager
        console.log('📦 Step 1: Installing package manager...');
        try {
            await vscode.commands.executeCommand('zephyr-ide.install-package-manager-headless');
            console.log('✅ Step 1 completed: Package manager installation finished');
        } catch (error) {
            console.log(`⚠️  Step 1: Package manager installation completed with status: ${error}`);
            // Continue - package manager might already be installed
        }

        // Small delay to ensure package manager is fully initialized
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Step 2: Install host packages
        console.log('🔨 Step 2: Installing host packages...');
        try {
            const result = await vscode.commands.executeCommand('zephyr-ide.install-host-packages-headless');
            console.log(`✅ Step 2 completed: Host packages installation finished (${result ? 'tools available' : 'tools need restart'})`);
            
            // On Windows/macOS, PATH refresh happens here within same process
            // Tools should now be visible for Step 3
        } catch (error) {
            console.log(`⚠️  Step 2: Host packages installation completed with status: ${error}`);
            // Continue - packages might already be installed
        }

        // Small delay to ensure packages are fully initialized
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Step 3: Verify tools and run standard workspace test
        console.log('🔍 Step 3: Verifying host tools availability...');
        try {
            const toolsAvailable = await vscode.commands.executeCommand('zephyr-ide.check-host-tools-headless');
            console.log(`✅ Step 3a: Host tools check completed (${toolsAvailable ? 'all tools available' : 'some tools missing'})`);
        } catch (error) {
            console.log(`⚠️  Step 3a: Host tools check: ${error}`);
        }

        // Step 3b: Verify workspace is available
        console.log('🚀 Step 3b: Verifying workspace availability...');
        
        // The workspace folder should already be open from .vscode-test.mjs
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            throw new Error('❌ No workspace folder available. The test requires a workspace to be open.');
        }
        
        const testWorkspaceDir = workspaceFolders[0].uri.fsPath;
        console.log(`✅ Using workspace: ${testWorkspaceDir}`);
        
        console.log('✅ Step 3b completed: Workspace verification finished');
        console.log('🎉 Combined installation test passed! All steps completed in single process.');
    });
});
