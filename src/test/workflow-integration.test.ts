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
import { logTestEnvironment } from "./test-runner";

suite("Workflow Integration Test Suite", () => {
    let testWorkspaceDir: string;
    let originalWorkspaceFolders: readonly vscode.WorkspaceFolder[] | undefined;

    suiteSetup(() => {
        logTestEnvironment();
        console.log("🔬 Testing complete Zephyr IDE workflow");
    });

    setup(async () => {
        const existingWorkspace =
            vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        testWorkspaceDir = existingWorkspace
            ? path.join(existingWorkspace, "zephyr-workflow-test")
            : path.join(os.tmpdir(), "zephyr-workflow-test-" + Date.now());

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

    test("Complete Workflow: Dependencies → Setup → Project → Build → Execute", async function () {
        this.timeout(1800000);

        console.log("🚀 Starting workflow test...");

        try {
            const extension = vscode.extensions.getExtension("mylonics.zephyr-ide");
            if (extension && !extension.isActive) {
                await extension.activate();
            }
            await new Promise((resolve) => setTimeout(resolve, 3000));

            const originalCreateQuickPick = vscode.window.createQuickPick;
            const originalCreateInputBox = vscode.window.createInputBox;
            const originalShowQuickPick = vscode.window.showQuickPick;
            const originalShowInputBox = vscode.window.showInputBox;

            let globalQuickPickCallCount = 0;
            let globalInputBoxCallCount = 0;
            let currentStep = "workspace-setup";

            const createQuickPickMock = () => {
                globalQuickPickCallCount++;

                const getSelection = (items: any[]) => {
                    if (currentStep === "workspace-setup") {
                        if (globalQuickPickCallCount === 1) {
                            return (
                                items.find((item: any) =>
                                    item.label?.toLowerCase().includes("minimal")
                                ) || items[0]
                            );
                        }
                        if (globalQuickPickCallCount === 2) {
                            return (
                                items.find((item: any) =>
                                    item.label?.toLowerCase().includes("stm32")
                                ) || items[0]
                            );
                        }
                        return (
                            items.find((item: any) =>
                                item.label?.toLowerCase().includes("default")
                            ) || items[0]
                        );
                    } else if (currentStep === "sdk-installation") {
                        // Use same logic as fallback showQuickPick for consistency
                        const firstItemLabel = (items[0]?.label || items[0] || '').toLowerCase();

                        if (firstItemLabel.includes('automatic') || items.some((item: any) => (item.label || item).toLowerCase().includes('automatic'))) {
                            console.log('   → SDK QuickPick: Selecting Automatic installation');
                            return items.find((item: any) => (item.label || item).toLowerCase().includes('automatic')) || items[0];
                        } else if (firstItemLabel.includes('toolchain') || items.some((item: any) => (item.label || item).toLowerCase().includes('toolchain'))) {
                            // Check if this is the first step (Install All vs Select Specific) or second step (actual toolchain selection)
                            if (items.some((item: any) => (item.label || item).toLowerCase().includes('select specific'))) {
                                // First step: Choose "Select Specific Toolchains"
                                console.log('   → SDK QuickPick: Selecting "Select Specific Toolchains" option');
                                return items.find((item: any) => (item.label || item).toLowerCase().includes('select specific')) || items[1];
                            } else if (items.some((item: any) => (item.label || item).toLowerCase().includes('arm-zephyr-eabi'))) {
                                // Second step: Choose specific toolchain - select only arm-zephyr-eabi
                                console.log('   → SDK QuickPick: Selecting only arm-zephyr-eabi toolchain');
                                return [items.find((item: any) => (item.label || item).toLowerCase().includes('arm-zephyr-eabi'))];
                            } else {
                                // Fallback for toolchain selection
                                console.log('   → SDK QuickPick: Selecting first toolchain option');
                                return items[0];
                            }
                        } else if (items.some((item: any) => (item.label || item).toLowerCase().includes('arm-zephyr-eabi'))) {
                            console.log('   → SDK QuickPick: Selecting only arm-zephyr-eabi toolchain');
                            return [items.find((item: any) => (item.label || item).toLowerCase().includes('arm-zephyr-eabi'))];
                        } else {
                            console.log('   → SDK QuickPick: Selecting first available option');
                            return items[0];
                        }
                    } else if (currentStep === "project-creation") {
                        return (
                            items.find((item: any) =>
                                item.label?.toLowerCase().includes("blinky")
                            ) || items[0]
                        );
                    } else if (currentStep === "build-config") {
                        const firstItemLabel = (items[0]?.label || "").toLowerCase();
                        if (firstItemLabel.includes("zephyr directory")) {
                            return (
                                items.find((item: any) =>
                                    item.label?.toLowerCase().includes("zephyr directory")
                                ) || items[0]
                            );
                        }
                        if (
                            items.some((item: any) =>
                                item.label?.toLowerCase().includes("nucleo")
                            )
                        ) {
                            return (
                                items.find((item: any) =>
                                    item.label?.toLowerCase().includes("nucleo_f401")
                                ) || items[0]
                            );
                        }
                        if (
                            items.some((item: any) =>
                                item.label?.toLowerCase().includes("debug")
                            )
                        ) {
                            return (
                                items.find((item: any) =>
                                    item.label?.toLowerCase().includes("debug")
                                ) || items[0]
                            );
                        }
                        return items[0];
                    }
                    return items[0];
                };

                const mockQuickPick: any = {
                    title: "",
                    step: 0,
                    totalSteps: 0,
                    items: [],
                    activeItems: [],
                    selectedItems: [],
                    canSelectMany: false,
                    ignoreFocusOut: false,
                    placeholder: "",
                    buttons: [],
                    busy: false,
                    enabled: true,
                    value: "",
                    keepScrollPosition: false,
                    matchOnDescription: false,
                    matchOnDetail: false,
                    sortByLabel: true,
                    validationMessage: "",
                    hide: () => { },
                    dispose: () => { },
                    show: () => {
                        setTimeout(() => {
                            const selectedItem = getSelection(mockQuickPick.items);
                            if (selectedItem) {
                                mockQuickPick.selectedItems = [selectedItem];
                                mockQuickPick.activeItems = [selectedItem];
                                if (mockQuickPick._onDidChangeSelectionCallback) {
                                    mockQuickPick._onDidChangeSelectionCallback([selectedItem]);
                                }
                            }
                            if (mockQuickPick._onDidAcceptCallback) {
                                mockQuickPick._onDidAcceptCallback();
                            }
                        }, 8000);
                    },
                    onDidTriggerButton: () => ({ dispose: () => { } }),
                    onDidChangeSelection: (callback: any) => {
                        mockQuickPick._onDidChangeSelectionCallback = callback;
                        return { dispose: () => { } };
                    },
                    onDidAccept: (callback: any) => {
                        mockQuickPick._onDidAcceptCallback = callback;
                        return { dispose: () => { } };
                    },
                    onDidChangeValue: () => ({ dispose: () => { } }),
                    onDidChangeActive: () => ({ dispose: () => { } }),
                    onDidHide: () => ({ dispose: () => { } }),
                };

                return mockQuickPick;
            };

            const createInputBoxMock = () => {
                globalInputBoxCallCount++;

                const getInputValue = () => {
                    if (
                        currentStep === "project-creation" &&
                        globalInputBoxCallCount === 1
                    ) {
                        return "blinky";
                    }
                    if (currentStep === "build-config" && globalInputBoxCallCount === 1) {
                        return "test_build_1";
                    }
                    return "";
                };

                const mockInputBox: any = {
                    title: "",
                    step: 0,
                    totalSteps: 0,
                    value: "",
                    prompt: "",
                    placeholder: "",
                    buttons: [],
                    ignoreFocusOut: false,
                    busy: false,
                    enabled: true,
                    hide: () => { },
                    dispose: () => { },
                    show: () => {
                        setTimeout(() => {
                            const inputValue = getInputValue();
                            mockInputBox.value = inputValue;
                            if (mockInputBox._onDidChangeValueCallback) {
                                mockInputBox._onDidChangeValueCallback(inputValue);
                            }
                            if (mockInputBox._onDidAcceptCallback) {
                                mockInputBox._onDidAcceptCallback();
                            }
                        }, 8000);
                    },
                    onDidAccept: (callback: any) => {
                        mockInputBox._onDidAcceptCallback = callback;
                        return { dispose: () => { } };
                    },
                    onDidChangeValue: (callback: any) => {
                        mockInputBox._onDidChangeValueCallback = callback;
                        return { dispose: () => { } };
                    },
                    onDidTriggerButton: () => ({ dispose: () => { } }),
                    onDidHide: () => ({ dispose: () => { } }),
                };

                return mockInputBox;
            };

            vscode.window.createQuickPick = createQuickPickMock;
            vscode.window.createInputBox = createInputBoxMock;

            vscode.window.showQuickPick = async (items: any) => {
                const itemsArray = Array.isArray(items) ? items : await items;
                if (currentStep === "sdk-installation") {
                    // Check what type of selection this is based on available items
                    const firstItemLabel = (itemsArray[0]?.label || itemsArray[0] || '').toLowerCase();

                    if (firstItemLabel.includes('automatic') || itemsArray.some((item: any) => (item.label || item).toLowerCase().includes('automatic'))) {
                        // SDK installation mode selection - choose Automatic
                        console.log('   → SDK: Selecting Automatic installation');
                        return itemsArray.find((item: any) => (item.label || item).toLowerCase().includes('automatic')) || itemsArray[0];
                    } else if (firstItemLabel.includes('toolchain') || itemsArray.some((item: any) => (item.label || item).toLowerCase().includes('toolchain'))) {
                        // Check if this is the first step (Install All vs Select Specific) or second step (actual toolchain selection)
                        if (itemsArray.some((item: any) => (item.label || item).toLowerCase().includes('select specific'))) {
                            // First step: Choose "Select Specific Toolchains"
                            console.log('   → SDK: Selecting "Select Specific Toolchains" option');
                            return itemsArray.find((item: any) => (item.label || item).toLowerCase().includes('select specific')) || itemsArray[1];
                        } else if (itemsArray.some((item: any) => (item.label || item).toLowerCase().includes('arm-zephyr-eabi'))) {
                            // Second step: Choose specific toolchain - select only arm-zephyr-eabi
                            console.log('   → SDK: Selecting only arm-zephyr-eabi toolchain');
                            return [itemsArray.find((item: any) => (item.label || item).toLowerCase().includes('arm-zephyr-eabi'))];
                        } else {
                            // Fallback for toolchain selection
                            console.log('   → SDK: Selecting first toolchain option');
                            return itemsArray[0];
                        }
                    } else if (itemsArray.some((item: any) => (item.label || item).toLowerCase().includes('arm-zephyr-eabi'))) {
                        // Direct toolchain selection - choose only arm-zephyr-eabi
                        console.log('   → SDK: Selecting only arm-zephyr-eabi toolchain');
                        return [itemsArray.find((item: any) => (item.label || item).toLowerCase().includes('arm-zephyr-eabi'))];
                    } else {
                        // Default: select first item
                        console.log('   → SDK: Selecting first available option');
                        return itemsArray[0];
                    }
                }
                if (currentStep === "project-creation") {
                    return (
                        itemsArray.find((item: any) =>
                            item.label?.toLowerCase().includes("blinky")
                        ) || itemsArray[0]
                    );
                }
                return itemsArray[0];
            };

            vscode.window.showInputBox = async () => {
                if (currentStep === "project-creation") {
                    return "blinky";
                }
                return "";
            };

            console.log("📋 Step 1: Checking build dependencies...");
            let result = await vscode.commands.executeCommand(
                "zephyr-ide.check-build-dependencies"
            );
            assert.ok(result, "Build dependencies check should succeed");

            console.log("🏗️ Step 2: Setting up workspace...");
            result = await vscode.commands.executeCommand(
                "zephyr-ide.workspace-setup-standard"
            );
            assert.ok(result, "Workspace setup should succeed");

            // Monitor workspace setup progress
            console.log("⏳ Monitoring workspace setup progress...");
            let waitTime = 0;
            const checkInterval = 3000;
            let initialSetupComplete = false;
            let pythonEnvironmentSetup = false;
            let westUpdated = false;
            let packagesInstalled = false;

            while (!packagesInstalled) {
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

                    if (wsConfig.activeSetupState?.packagesInstalled) {
                        packagesInstalled = true;
                        console.log("    ✅ Packages installed completed");
                        console.log("🎉 All workspace setup stages completed!");
                        break;
                    }
                }

                // Progress update every 30 seconds
                if (waitTime % 30000 === 0 && waitTime > 0) {
                    const completedStages = [initialSetupComplete, pythonEnvironmentSetup, westUpdated, packagesInstalled].filter(Boolean).length;
                    console.log(`⏳ Setup in progress... (${waitTime / 1000}s elapsed, ${completedStages}/4 stages completed)`);
                }

                await new Promise((resolve) => setTimeout(resolve, checkInterval));
                waitTime += checkInterval;
            }

            console.log("⚙️ Step 3: Installing SDK...");
            globalQuickPickCallCount = 0;
            globalInputBoxCallCount = 0;
            currentStep = "sdk-installation";
            result = await vscode.commands.executeCommand("zephyr-ide.install-sdk");
            assert.ok(result, "SDK installation should succeed");

            console.log("📁 Step 4: Creating project from template...");
            globalQuickPickCallCount = 0;
            globalInputBoxCallCount = 0;
            currentStep = "project-creation";
            result = await vscode.commands.executeCommand("zephyr-ide.create-project");
            assert.ok(result, "Project creation should succeed");

            console.log("🔨 Step 5: Adding build configuration...");
            globalQuickPickCallCount = 0;
            globalInputBoxCallCount = 0;
            currentStep = "build-config";
            result = await vscode.commands.executeCommand("zephyr-ide.add-build");
            assert.ok(result, "Build configuration should succeed");

            console.log("⚡ Step 6: Executing build...");
            currentStep = "build-execution";
            result = await vscode.commands.executeCommand("zephyr-ide.build");
            assert.ok(result, "Build execution should succeed");

            vscode.window.createQuickPick = originalCreateQuickPick;
            vscode.window.createInputBox = originalCreateInputBox;
            vscode.window.showQuickPick = originalShowQuickPick;
            vscode.window.showInputBox = originalShowInputBox;

            const workspaceExists = await fs.pathExists(testWorkspaceDir);
            assert.ok(workspaceExists, "Test workspace should exist");
            await new Promise((resolve) => setTimeout(resolve, 30000));

        } catch (error) {
            console.error("❌ Workflow test failed:", error);
            await new Promise((resolve) => setTimeout(resolve, 30000));

            throw error;
        }
    }).timeout(900000);
});
