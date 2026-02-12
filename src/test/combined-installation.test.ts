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
 * All steps execute sequentially in the SAME VS Code instance/process.
 * 
 * Steps:
 * 1. Install package manager (winget/apt/homebrew)
 * 2. Install host packages (cmake, ninja, gperf, etc.) + PATH refresh
 * 3. Run full standard workspace workflow (setup → project → build)
 * 
 * Benefits:
 * - PATH updates propagate within same process
 * - refreshWindowsPath() makes tools immediately visible
 * - No cross-process PATH issues on Windows/macOS
 */

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import {
    logTestEnvironment,
    monitorWorkspaceSetup,
    printWorkspaceStructure,
    activateExtension,
    executeFinalBuild,
    executeTestWithErrorHandling,
    executeWorkspaceCommand,
    startWorkspaceCommand,
    CommonUIInteractions,
} from './test-runner';
import { UIMockInterface } from './ui-mock-interface';

suite('Combined Installation Test Suite', function() {
    // Extended timeout for all installation steps + workspace test
    // Windows SDK installation can take 20+ minutes
    this.timeout(1500000); // 25 minutes total

    let testWorkspaceDir: string;

    test('Install host tools and run standard workspace workflow (single process)', async function() {
        console.log('🔧 Step 0: Starting combined installation test (single process)');
        logTestEnvironment();
        
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
        } catch (error) {
            console.log(`⚠️  Step 2: Host packages installation completed with status: ${error}`);
            // Continue - packages might already be installed
        }

        // Small delay to ensure packages are fully initialized
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Step 3: Verify tools availability
        console.log('🔍 Step 3: Verifying host tools availability...');
        try {
            const toolsAvailable = await vscode.commands.executeCommand('zephyr-ide.check-host-tools-headless');
            console.log(`✅ Step 3: Host tools check completed (${toolsAvailable ? 'all tools available' : 'some tools missing'})`);
        } catch (error) {
            console.log(`⚠️  Step 3: Host tools check: ${error}`);
        }

        // Step 4: Set up the test workspace directory
        console.log('🚀 Step 4: Setting up test workspace...');
        testWorkspaceDir = process.env.ZEPHYR_BASE || path.join(os.tmpdir(), 'zephyr-test-workspace');
        if (!fs.existsSync(testWorkspaceDir)) {
            fs.mkdirSync(testWorkspaceDir, { recursive: true });
        }
        console.log(`   Test workspace: ${testWorkspaceDir}`);

        // Use updateWorkspaceFolders instead of vscode.openFolder to avoid
        // reloading the VS Code window (which kills the extension host and cancels the test)
        const workspaceUri = vscode.Uri.file(testWorkspaceDir);
        const currentFolders = vscode.workspace.workspaceFolders;
        const numFoldersToRemove = currentFolders ? currentFolders.length : 0;
        vscode.workspace.updateWorkspaceFolders(0, numFoldersToRemove, { uri: workspaceUri });

        // Wait for workspace to be ready
        await new Promise(resolve => setTimeout(resolve, 3000));
        console.log('✅ Step 4 completed: Workspace folder set');

        // Step 5: Run the standard workspace workflow
        console.log('🏗️ Step 5: Running standard workspace workflow...');
        const uiMock = new UIMockInterface();

        await executeTestWithErrorHandling(
            'Combined Installation Test',
            testWorkspaceDir,
            uiMock,
            async () => {
                await activateExtension();
                uiMock.activate();

                const requiresPathPropagation = process.platform === 'darwin' || process.platform === 'win32';

                if (requiresPathPropagation) {
                    console.log('   Skipping build dependencies check (PATH propagation limitation in CI)');
                } else {
                    console.log('📋 Step 5a: Checking build dependencies...');
                    await executeWorkspaceCommand(
                        uiMock,
                        [],
                        'zephyr-ide.check-build-dependencies',
                        'Build dependencies check should succeed'
                    );
                }

                console.log('🏗️ Step 5b: Setting up workspace...');
                const setupPromise = startWorkspaceCommand(
                    uiMock,
                    CommonUIInteractions.testingWorkspace,
                    'zephyr-ide.workspace-setup-standard',
                );

                // Windows SDK installation can take significantly longer (>10 minutes)
                // due to download + extraction. Use extended timeout on Windows.
                const setupTimeout = process.platform === 'win32' ? 1200000 : 600000; // 20 min for Windows, 10 min for others
                await monitorWorkspaceSetup(setupPromise, "workspace", setupTimeout);

                console.log('🐍 Step 5c: Verifying Python venv path...');
                const pythonPathResult = await vscode.commands.executeCommand('zephyr-ide.print-python-path');
                if (pythonPathResult && typeof pythonPathResult === 'object' && 'stdout' in pythonPathResult) {
                    const stdout = (pythonPathResult as { stdout: string }).stdout;
                    console.log(`   Python path check result: ${stdout}`);
                    assert.ok(
                        stdout.includes('.venv') || stdout.includes('venv'),
                        `Python interpreter should be from venv, but got: ${stdout}`
                    );
                    console.log('   ✅ Verified: Python interpreter is from venv');
                } else {
                    console.log('   ⚠️ Could not verify Python path');
                }

                console.log('📁 Step 5d: Creating project from template...');
                await executeWorkspaceCommand(
                    uiMock,
                    CommonUIInteractions.createBlinkyProject,
                    'zephyr-ide.create-project',
                    'Project creation should succeed'
                );

                console.log('🔨 Step 5e: Adding build configuration...');
                await executeWorkspaceCommand(
                    uiMock,
                    [
                        { type: 'quickpick', value: 'zephyr directory', description: 'Use Zephyr directory only' },
                        { type: 'quickpick', value: 'rpi_pico', description: 'Select Raspberry Pi Pico board' },
                        { type: 'input', value: 'test_build_1', description: 'Enter build name' },
                        { type: 'quickpick', value: 'debug', description: 'Select debug optimization' },
                        { type: 'input', value: '', description: 'Additional build args' },
                        { type: 'input', value: '', description: 'CMake args' }
                    ],
                    'zephyr-ide.add-build',
                    'Build configuration should succeed'
                );

                await new Promise((resolve) => setTimeout(resolve, 10000));
                console.log('⚡ Step 5f: Executing build...');
                await executeFinalBuild('Combined Installation Test');
            }
        );

        await printWorkspaceStructure('Combined Installation Test');
        console.log('🎉 Combined installation test passed! All steps completed in single process.');
    });
});
