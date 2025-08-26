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

import * as assert from "assert";
import * as vscode from "vscode";
import * as fs from "fs-extra";
import * as path from "path";
import * as os from "os";
import { logTestEnvironment, monitorWorkspaceSetup } from "./test-runner";
import { UIMockInterface, MockInteraction } from "./ui-mock-interface";

// Helper function to print directory structure
async function printDirectoryStructure(dirPath: string, maxDepth: number = 2, currentDepth: number = 0): Promise<void> {
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

/*
 * GIT WORKFLOW INTEGRATION TEST:
 * 
 * Tests the git-based workspace setup workflow:
 * 1. Setup workspace from West Git repository
 * 2. Add project from example repository
 * 3. Configure build with custom board
 * 4. Execute build
 * 
 * Uses the same architecture as standard workflow test:
 * - UI Mock Interface for all VSCode interactions
 * - Centralized workspace monitoring
 * - Clean separation of concerns
 */

suite("West Git Workspace Test Suite", () => {
    let testWorkspaceDir: string;
    let originalWorkspaceFolders: readonly vscode.WorkspaceFolder[] | undefined;

    suiteSetup(() => {
        logTestEnvironment();
        console.log("🔬 Testing Zephyr IDE git workflow");
    });

    setup(async () => {
        // Always use isolated temporary directory to ensure empty folder
        testWorkspaceDir = path.join(os.tmpdir(), "west-git-" + Date.now());

        await fs.ensureDir(testWorkspaceDir);

        const mockWorkspaceFolder: vscode.WorkspaceFolder = {
            uri: vscode.Uri.file(testWorkspaceDir),
            name: path.basename(testWorkspaceDir),
            index: 0,
        };

        originalWorkspaceFolders = vscode.workspace.workspaceFolders;
        Object.defineProperty(vscode.workspace, "workspaceFolders", {
            value: [mockWorkspaceFolder],
            configurable: true,
        });

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
    });

    teardown(async () => {
        if (originalWorkspaceFolders !== undefined) {
            Object.defineProperty(vscode.workspace, "workspaceFolders", {
                value: originalWorkspaceFolders,
                configurable: true,
            });
        }

        if (testWorkspaceDir && (await fs.pathExists(testWorkspaceDir))) {
            await fs.remove(testWorkspaceDir);
        }
    });

    test("Git Workspace Setup: West Git → SDK Install → Add Project → Custom Board Build", async function () {
        this.timeout(620000);

        console.log("🚀 Starting git workspace test...");
        console.log("📁 Test workspace folder:", testWorkspaceDir);

        try {
            const extension = vscode.extensions.getExtension("mylonics.zephyr-ide");
            if (extension && !extension.isActive) {
                await extension.activate();
            }
            await new Promise((resolve) => setTimeout(resolve, 3000));

            // Initialize UI Mock Interface for git workflow
            const gitUiMock = new UIMockInterface();
            gitUiMock.activate();


            console.log("🏗️ Step 1: Setting up workspace from West Git...");
            // Prime the mock interface for git workspace setup interactions
            gitUiMock.primeInteractions([
                { type: 'input', value: 'https://github.com/mylonics/zephyr-ide-samples', description: 'Enter git repo URL' },
                { type: 'input', value: '--mr west_repo', description: 'Enter Additionaladditional arguments for west' },
                { type: 'quickpick', value: 'automatic', description: 'Select SDK Version' },
                { type: 'quickpick', value: 'select specific', description: 'Select specific toolchains' },
                { type: 'quickpick', value: 'arm-zephyr-eabi', description: 'Select ARM toolchain', multiSelect: true }
            ]);

            let result = await vscode.commands.executeCommand(
                "zephyr-ide.workspace-setup-from-west-git"
            );
            assert.ok(result, "Git workspace setup should succeed");

            await monitorWorkspaceSetup("git workspace");

            console.log("⚙️ Step 2: Installing SDK...");
            // Prime the mock interface for SDK installation interactions

            console.log("📁 Step 3: Adding project from example repo...");
            // Prime the mock interface for project addition interactions  
            gitUiMock.primeInteractions([
                { type: 'opendialog', value: path.join(testWorkspaceDir, "zephyr-ide-samples", "blinky"), description: 'Select app folder' }
            ]);

            result = await vscode.commands.executeCommand("zephyr-ide.add-project");
            assert.ok(result, "Project addition should succeed");

            console.log("🔨 Step 4: Adding build configuration with custom board...");
            // Prime the mock interface for build configuration interactions
            gitUiMock.primeInteractions([
                { type: 'quickpick', value: 'select other folder', description: 'Select other folder for boards' },
                { type: 'opendialog', value: path.join(testWorkspaceDir, "zephyr", "boards"), description: 'Select boards folder' },
                { type: 'quickpick', value: 'custom_plank', description: 'Select custom_plank board' },
                { type: 'input', value: 'test_build_2', description: 'Enter build name' },
                { type: 'quickpick', value: 'debug', description: 'Select debug optimization' },
                { type: 'input', value: '', description: 'Additional build args' },
                { type: 'input', value: '-DCONFIG_DEBUG_OPTIMIZATIONS=y -DCONFIG_DEBUG_THREAD_INFO=y ', description: 'CMake args' }
            ]);

            const ext = vscode.extensions.getExtension("mylonics.zephyr-ide");
            const wsConfig = ext?.exports?.getWorkspaceConfig();
            if (!wsConfig?.initialSetupComplete) {
                console.log("⚠️ Setup not complete, retrying in 10 seconds...");
                await new Promise((resolve) => setTimeout(resolve, 10000));
            }

            result = await vscode.commands.executeCommand("zephyr-ide.add-build");
            assert.ok(result, "Build configuration should succeed");

            console.log("⚡ Step 5: Executing build with custom board...");
            result = await vscode.commands.executeCommand("zephyr-ide.build");
            assert.ok(result, "Build execution should succeed");

            // Deactivate the UI Mock Interface
            gitUiMock.deactivate();

        } catch (error) {
            console.error("❌ Git workflow test failed:", error);
            console.log("📁 Test workspace folder on failure:", testWorkspaceDir);
            console.log("📂 Directory structure:");
            await printDirectoryStructure(testWorkspaceDir, 2);
            await new Promise((resolve) => setTimeout(resolve, 30000));
            throw error;
        }
    }).timeout(900000);

});
