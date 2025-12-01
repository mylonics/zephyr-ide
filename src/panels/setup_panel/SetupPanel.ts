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

import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { WorkspaceConfig, GlobalConfig } from "../../setup_utilities/types";
import {
    getWestSDKContext,
    listAvailableSDKs,
    ParsedSDKList,
} from "../../setup_utilities/west_sdk";
import { saveSetupState } from "../../setup_utilities/state-management";
import { parseWestConfigManifestPath } from "../../setup_utilities/west-config-parser";
import { HostToolsSubPage } from "./HostToolsSubPage";
import { SDKSubPage } from "./SDKSubPage";
import { WorkspaceSubPage } from "./WorkspaceSubPage";
import { HostToolsCard, SDKCard, WorkspaceCard } from "./OverviewCards";
import {
    getPackageManagerForPlatformAsync,
    checkPackageManagerAvailable,
    checkAllPackages,
    installPackageManager,
    installPackage,
    installAllMissingPackages,
    getPlatformPackages,
} from "../../setup_utilities/host_tools";

export class SetupPanel {
    public static currentPanel: SetupPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionPath: string;
    private readonly _context: vscode.ExtensionContext;
    private _disposables: vscode.Disposable[] = [];

    // Store configs as instance variables to access them in methods
    private currentWsConfig?: WorkspaceConfig;
    private currentGlobalConfig?: GlobalConfig;

    public static createOrShow(
        extensionPath: string,
        context: vscode.ExtensionContext,
        wsConfig: WorkspaceConfig,
        globalConfig: GlobalConfig
    ) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        if (SetupPanel.currentPanel) {
            SetupPanel.currentPanel._panel.reveal(column);
            SetupPanel.currentPanel.updateContent(wsConfig, globalConfig);
            return SetupPanel.currentPanel;
        }

        const panel = vscode.window.createWebviewPanel(
            "zephyrIDESetup",
            "Zephyr IDE Setup Panel",
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [vscode.Uri.file(extensionPath)],
            }
        );

        SetupPanel.currentPanel = new SetupPanel(
            panel,
            extensionPath,
            context,
            wsConfig,
            globalConfig
        );
        return SetupPanel.currentPanel;
    }

    private constructor(
        panel: vscode.WebviewPanel,
        extensionPath: string,
        context: vscode.ExtensionContext,
        wsConfig: WorkspaceConfig,
        globalConfig: GlobalConfig
    ) {
        this._panel = panel;
        this._extensionPath = extensionPath;
        this._context = context;

        this.updateContent(wsConfig, globalConfig);

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.webview.onDidReceiveMessage(
            (message) => {
                this.handleWebviewMessage(message);
            },
            null,
            this._disposables
        );
    }

    public updateContent(wsConfig: WorkspaceConfig, globalConfig: GlobalConfig) {
        this.currentWsConfig = wsConfig;
        this.currentGlobalConfig = globalConfig;
        this._panel.webview.html = this.getHtmlForWebview(wsConfig, globalConfig);
    }

    /**
     * Check if any valid west workspace has ever been initialized.
     * SDK installation is allowed as long as at least one workspace exists in setupStateDictionary.
     */
    private hasValidSetupState(): boolean {
        return this.currentGlobalConfig?.setupStateDictionary !== undefined && 
            Object.keys(this.currentGlobalConfig.setupStateDictionary).length > 0;
    }

    // Message Handler
    private handleWebviewMessage(message: any) {
        switch (message.command) {
            case "navigateToPage":
                this.navigateToPage(message.page);
                return;
            case "openHostToolsPanel":
                this.openHostToolsPanel();
                return;
            case "markToolsComplete":
                this.markToolsComplete();
                return;
            case "checkHostToolsStatus":
                this.checkHostToolsStatus();
                return;
            case "installPackageManager":
                this.installPackageManager();
                return;
            case "installPackage":
                this.installPackage(message.packageName);
                return;
            case "installAllMissingTools":
                this.installAllMissingTools();
                return;
            case "installAllMissingToolsPackages":
                this.installAllMissingToolsPackages(message.packageNames);
                return;
            case "openWingetLink":
                this.openWingetLink();
                return;
            case "openFolder":
                this.openFolder();
                return;
            case "reinitializeWorkspace":
                this.reinitializeWorkspace();
                return;
            case "installSDK":
                this.installSDK();
                return;
            case "setupWestEnvironment":
                this.setupWestEnvironment();
                return;
            case "westInit":
                this.westInit();
                return;
            case "westUpdate":
                this.westUpdate();
                return;
            case "manageWorkspace":
                this.manageWorkspace();
                return;
            case "selectExistingWestWorkspace":
                this.selectExistingWestWorkspace();
                return;
            case "listSDKs":
                this.listSDKs();
                return;

            case "workspaceSetupFromGit":
                this.workspaceSetupFromGit();
                return;
            case "workspaceSetupFromWestGit":
                this.workspaceSetupFromWestGit();
                return;
            case "workspaceSetupStandard":
                this.workspaceSetupStandard();
                return;
            case "workspaceSetupFromCurrentDirectory":
                this.workspaceSetupFromCurrentDirectory();
                return;
            case "workspaceSetupPicker":
                this.workspaceSetupPicker();
                return;
            case "westConfig":
                this.westConfig();
                return;
            case "openWestYml":
                this.openWestYml();
                return;
            case "saveAndUpdateWestYml":
                this.saveAndUpdateWestYml(message.content);
                return;
        }
    }

    private navigateToPage(page: string) {
        if (!this.currentWsConfig || !this.currentGlobalConfig) {
            return;
        }

        let subPageContent = "";
        switch (page) {
            case "hosttools":
                subPageContent = HostToolsSubPage.getHtml(this.currentGlobalConfig);
                // Send sub-page content first
                this._panel.webview.postMessage({
                    command: "showSubPage",
                    content: subPageContent,
                    page: page
                });
                // Then automatically check host tools status
                setTimeout(() => this.checkHostToolsStatus(), 100);
                return;
            case "sdk":
                subPageContent = SDKSubPage.getHtml(this.currentGlobalConfig, this.hasValidSetupState());
                break;
            case "workspace":
                subPageContent = WorkspaceSubPage.getHtml(this.currentWsConfig);
                // Send sub-page content first
                this._panel.webview.postMessage({
                    command: "showSubPage",
                    content: subPageContent,
                    page: page
                });
                // Then load west.yml content if workspace is initialized
                // Small delay ensures webview has rendered before loading content
                if (this.currentWsConfig.initialSetupComplete) {
                    setTimeout(() => this.loadWestYmlContent(), 100);
                }
                return;
            case "overview":
            default:
                // Navigate back to overview - send message to show it
                this._panel.webview.postMessage({
                    command: "showOverview"
                });
                return;
        }

        // Send sub-page content to webview
        this._panel.webview.postMessage({
            command: "showSubPage",
            content: subPageContent,
            page: page
        });
    }

    // Public methods to navigate to specific pages
    public navigateToHostTools() {
        this.navigateToPage("hosttools");
    }

    public navigateToSDK() {
        this.navigateToPage("sdk");
    }

    public navigateToWorkspace() {
        this.navigateToPage("workspace");
    }

    public dispose() {
        SetupPanel.currentPanel = undefined;

        this._panel.dispose();

        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }

    // Workspace Management Methods

    // Utility Methods
    private async openHostToolsPanel() {
        try {
            vscode.commands.executeCommand("zephyr-ide.install-host-tools");
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to open host tools panel: ${error}`);
        }
    }

    private async markToolsComplete() {
        if (!this.currentWsConfig || !this.currentGlobalConfig) {
            vscode.window.showErrorMessage("Configuration not available");
            return;
        }

        this.currentGlobalConfig.toolsAvailable = true;
        await saveSetupState(
            this._context,
            this.currentWsConfig,
            this.currentGlobalConfig
        );

        vscode.window.showInformationMessage(
            "Host tools marked as available."
        );

        // Update the panel to reflect the change
        this.updateContent(this.currentWsConfig, this.currentGlobalConfig);
    }

    private async checkHostToolsStatus() {
        try {
            const manager = await getPackageManagerForPlatformAsync();
            if (!manager) {
                this._panel.webview.postMessage({
                    command: "updateHostToolsStatus",
                    error: "Unsupported platform",
                });
                return;
            }

            const managerAvailable = await checkPackageManagerAvailable();
            const packageStatuses = await checkAllPackages();

            this._panel.webview.postMessage({
                command: "updateHostToolsStatus",
                data: {
                    managerName: manager.name,
                    managerAvailable,
                    managerInstallUrl: manager.config.install_url,
                    packages: packageStatuses,
                },
            });
        } catch (error) {
            this._panel.webview.postMessage({
                command: "updateHostToolsStatus",
                error: String(error),
            });
        }
    }

    private async installPackageManager() {
        try {
            const success = await installPackageManager();

            if (success) {
                await this.checkHostToolsStatus();

                const managerAvailable = await checkPackageManagerAvailable();

                if (!managerAvailable) {
                    vscode.window.showWarningMessage(
                        "Package manager was installed but is not yet available. Please close and reopen VS Code completely (not just reload) for changes to take effect."
                    );
                } else {
                    vscode.window.showInformationMessage(
                        "Package manager installed successfully."
                    );
                }
            } else {
                vscode.window.showErrorMessage(
                    "Failed to install package manager. Check output for details."
                );
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Error: ${error}`);
        }
    }

    private async installPackage(packageName: string) {
        try {
            const platformPackages = await getPlatformPackages();
            const pkg = platformPackages.find(p => p.name === packageName);

            if (!pkg) {
                vscode.window.showErrorMessage(`Package ${packageName} not found`);
                return;
            }

            // Update status to installing
            this._panel.webview.postMessage({
                command: "hostToolsPackageInstalling",
                packageName: packageName,
                current: 1,
                total: 1,
            });

            const success = await installPackage(pkg);

            // Check if package is now available
            const packageStatuses = await checkAllPackages();
            const installedPkg = packageStatuses.find(p => p.name === packageName);
            const pendingRestart = success && installedPkg && !installedPkg.available;

            // Update status after installation
            this._panel.webview.postMessage({
                command: "hostToolsPackageInstalled",
                packageName: packageName,
                success: success,
                pendingRestart: pendingRestart,
                current: 1,
                total: 1,
            });

            if (success) {
                if (pendingRestart) {
                    vscode.window.showWarningMessage(
                        `${packageName} was installed but is not yet available. Please close and reopen VS Code completely (not just reload) for changes to take effect.`
                    );
                } else {
                    vscode.window.showInformationMessage(
                        `${packageName} installed successfully.`
                    );
                }
            } else {
                vscode.window.showErrorMessage(
                    `Failed to install ${packageName}. Check output for details.`
                );
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Error: ${error}`);
        }
    }

    private async installAllMissingTools() {
        try {
            // Request the webview to start installation
            // The webview will filter out packages that are already pending restart
            this._panel.webview.postMessage({
                command: "hostToolsStartInstallAll",
            });
        } catch (error) {
            vscode.window.showErrorMessage(`Error: ${error}`);
        }
    }

    private async installAllMissingToolsPackages(packageNames: string[]) {
        try {
            if (packageNames.length === 0) {
                vscode.window.showInformationMessage("All packages are already installed");
                return;
            }

            const totalCount = packageNames.length;
            const packages = await getPlatformPackages();
            
            // Start installation progress
            this._panel.webview.postMessage({
                command: "hostToolsInstallAllStarted",
                total: totalCount,
            });

            let installedCount = 0;
            let hasErrors = false;
            
            // Install each package one by one
            for (const packageName of packageNames) {
                const pkg = packages.find(p => p.name === packageName);
                if (pkg) {
                    // Update status to installing
                    this._panel.webview.postMessage({
                        command: "hostToolsPackageInstalling",
                        packageName: pkg.name,
                        current: installedCount + 1,
                        total: totalCount,
                    });

                    const success = await installPackage(pkg);
                    installedCount++;

                    // Check if package is now available
                    const updatedStatus = await checkAllPackages();
                    const installedPkg = updatedStatus.find(p => p.name === packageName);
                    const pendingRestart = success && installedPkg && !installedPkg.available;

                    // Update status after installation
                    this._panel.webview.postMessage({
                        command: "hostToolsPackageInstalled",
                        packageName: pkg.name,
                        success: success,
                        pendingRestart: pendingRestart,
                        current: installedCount,
                        total: totalCount,
                    });

                    if (!success) {
                        hasErrors = true;
                    }
                }
            }
            
            // Check if any packages still aren't available after installation
            const packageStatuses = await checkAllPackages();
            const needsRestart = packageStatuses.some(p => !p.available);
            
            // Complete installation
            this._panel.webview.postMessage({
                command: "hostToolsInstallAllComplete",
                needsRestart: needsRestart,
                hasErrors: hasErrors,
            });

            if (needsRestart) {
                vscode.window.showWarningMessage(
                    "Some packages were installed but are not yet available. Please close and reopen VS Code completely (not just reload) for changes to take effect."
                );
            } else if (!hasErrors) {
                vscode.window.showInformationMessage(
                    "All missing packages installed successfully."
                );
            } else {
                vscode.window.showWarningMessage(
                    "Some host tools failed to install. Check the output for details."
                );
            }

            await this.checkHostToolsStatus();
        } catch (error) {
            vscode.window.showErrorMessage(`Error: ${error}`);
            this._panel.webview.postMessage({
                command: "hostToolsInstallAllComplete",
                needsRestart: false,
                hasErrors: true,
            });
        }
    }

    private async openWingetLink() {
        try {
            vscode.env.openExternal(vscode.Uri.parse("https://aka.ms/getwinget"));
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to open winget link: ${error}`);
        }
    }

    private async openFolder() {
        try {
            vscode.commands.executeCommand("vscode.openFolder");
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to open folder: ${error}`);
        }
    }

    private async reinitializeWorkspace() {
        vscode.commands.executeCommand("zephyr-ide.reset-workspace");
    }

    // SDK and West Management Methods
    private async installSDK() {
        try {
            await vscode.commands.executeCommand("zephyr-ide.install-sdk");
            // Refresh the panel after SDK installation to update status
            if (this.currentWsConfig && this.currentGlobalConfig) {
                try {
                    this.updateContent(this.currentWsConfig, this.currentGlobalConfig);
                } catch (updateError) {
                    console.error("Failed to refresh panel after SDK installation:", updateError);
                    // Don't show error to user as SDK installation was successful
                }
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to install west SDK: ${error}`);
        }
    }

    private async setupWestEnvironment() {
        try {
            vscode.commands.executeCommand("zephyr-ide.setup-west-environment");
        } catch (error) {
            vscode.window.showErrorMessage(
                `Failed to setup west environment: ${error}`
            );
        }
    }

    private async westInit() {
        try {
            vscode.commands.executeCommand("zephyr-ide.west-init");
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to run west init: ${error}`);
        }
    }

    private async westUpdate() {
        try {
            vscode.commands.executeCommand("zephyr-ide.west-update");
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to run west update: ${error}`);
        }
    }

    private async manageWorkspace() {
        try {
            vscode.commands.executeCommand("zephyr-ide.manage-workspaces");
        } catch (error) {
            vscode.window.showErrorMessage(
                `Failed to open workspace manager: ${error}`
            );
        }
    }

    private async selectExistingWestWorkspace() {
        try {
            vscode.commands.executeCommand("zephyr-ide.select-existing-west-workspace");
        } catch (error) {
            vscode.window.showErrorMessage(
                `Failed to select existing west workspace: ${error}`
            );
        }
    }

    private async workspaceSetupFromGit() {
        try {
            vscode.commands.executeCommand("zephyr-ide.workspace-setup-from-git");
            this._panel.dispose();
        } catch (error) {
            vscode.window.showErrorMessage(
                `Failed to setup workspace from Git: ${error}`
            );
        }
    }

    private async workspaceSetupFromWestGit() {
        try {
            vscode.commands.executeCommand(
                "zephyr-ide.workspace-setup-from-west-git"
            );
            this._panel.dispose();
        } catch (error) {
            vscode.window.showErrorMessage(
                `Failed to setup workspace from West Git: ${error}`
            );
        }
    }

    private async workspaceSetupStandard() {
        try {
            vscode.commands.executeCommand("zephyr-ide.workspace-setup-standard");
            this._panel.dispose();
        } catch (error) {
            vscode.window.showErrorMessage(
                `Failed to setup standard workspace: ${error}`
            );
        }
    }

    private async workspaceSetupFromCurrentDirectory() {
        try {
            vscode.commands.executeCommand(
                "zephyr-ide.workspace-setup-from-current-directory"
            );
            this._panel.dispose();
        } catch (error) {
            vscode.window.showErrorMessage(
                `Failed to setup workspace from current directory: ${error}`
            );
        }
    }

    private async workspaceSetupPicker() {
        try {
            vscode.commands.executeCommand("zephyr-ide.workspace-setup-picker");
            this._panel.dispose();
        } catch (error) {
            vscode.window.showErrorMessage(
                `Failed to open workspace setup picker: ${error}`
            );
        }
    }

    private async westConfig() {
        try {
            vscode.commands.executeCommand("zephyr-ide.west-config");
        } catch (error) {
            vscode.window.showErrorMessage(
                `Failed to open west config: ${error}`
            );
        }
    }

    private async listSDKs() {
        try {
            if (!this.currentWsConfig || !this.currentGlobalConfig) {
                vscode.window.showErrorMessage("Configuration not available");
                return;
            }

            const setupState = await getWestSDKContext(
                this.currentWsConfig,
                this.currentGlobalConfig,
                this._context
            );
            if (!setupState) {
                vscode.window.showErrorMessage(
                    "No valid west installation found for SDK management"
                );
                return;
            }

            const sdkList = await listAvailableSDKs(setupState);

            // Send the parsed SDK list back to the webview
            this._panel.webview.postMessage({
                command: "sdkListResult",
                data: sdkList,
            });
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to list SDKs: ${error}`);
            // Send error back to webview
            this._panel.webview.postMessage({
                command: "sdkListResult",
                data: {
                    success: false,
                    versions: [],
                    error: `Failed to list SDKs: ${error}`,
                },
            });
        }
    }

    // HTML Generation Methods
    private getHtmlForWebview(
        wsConfig: WorkspaceConfig,
        globalConfig: GlobalConfig
    ): string {
        const folderOpen = wsConfig.rootPath !== "";
        // Workspace is only considered initialized if both flags are true AND there's an active setup state
        const workspaceInitialized = (wsConfig.initialSetupComplete || false) && (wsConfig.activeSetupState !== undefined);

        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Zephyr IDE Setup & Configuration</title>
            ${this.getStylesheetLinks()}
        </head>
        <body>
            <div class="panel-container">
                <div class="overview-container" id="overviewContainer">
                    ${this.generateOverviewSection(wsConfig, globalConfig, folderOpen, workspaceInitialized, this.hasValidSetupState())}
                </div>
                <div class="sub-page-container" id="subPageContainer">
                    <!-- Sub-page content will be inserted here -->
                </div>
            </div>
            ${this.getScriptTags()}
        </body>
        </html>`;
    }

    private getStylesheetLinks(): string {
        const cssUri = this._panel.webview.asWebviewUri(
            vscode.Uri.joinPath(
                vscode.Uri.file(this._extensionPath),
                "src",
                "panels",
                "setup_panel",
                "setup-panel.css"
            )
        );

        // Use codicons from node_modules - these are bundled with the extension
        const codiconUri = this._panel.webview.asWebviewUri(
            vscode.Uri.joinPath(
                vscode.Uri.file(this._extensionPath),
                "node_modules",
                "@vscode",
                "codicons",
                "dist",
                "codicon.css"
            )
        );

        return `
            <link rel="stylesheet" type="text/css" href="${cssUri}">
            <link rel="stylesheet" type="text/css" href="${codiconUri}">
        `;
    }

    private getScriptTags(): string {
        const jsUri = this._panel.webview.asWebviewUri(
            vscode.Uri.joinPath(
                vscode.Uri.file(this._extensionPath),
                "src",
                "panels",
                "setup_panel",
                "setup-panel.js"
            )
        );
        return `<script src="${jsUri}"></script>`;
    }

    private generateOverviewSection(
        wsConfig: WorkspaceConfig,
        globalConfig: GlobalConfig,
        folderOpen: boolean,
        workspaceInitialized: boolean,
        hasValidSetupState: boolean
    ): string {
        return `
        <div class="overview-section">
            <div class="walkthrough-header">
                <h1 class="walkthrough-title">Zephyr IDE Setup & Configuration</h1>
                <p class="walkthrough-subtitle">Configure your development environment</p>
            </div>
            
            <div class="two-column-layout">
                <div class="overview-cards">
                    ${HostToolsCard.getHtml(globalConfig)}
                    ${WorkspaceCard.getHtml(wsConfig, folderOpen, workspaceInitialized)}
                    ${SDKCard.getHtml(globalConfig, hasValidSetupState)}
                </div>
                
                <div class="walkthrough-description">
                    <h3>Getting Started</h3>
                    <p>Complete these steps to set up your Zephyr development environment:</p>
                    <ul class="setup-requirements">
                        <li><strong>1. Host Tools</strong> - Ensure system has required build dependencies</li>
                        <li><strong>2. Workspace</strong> - Link to Zephyr source code and modules</li>
                        <li><strong>3. Zephyr SDK</strong> - Download toolchains for target architectures</li>
                    </ul>
                    <p class="help-text">Click any card above to configure that component.</p>
                    
                    <h3 style="margin-top: 24px;">Documentation & Help</h3>
                    <p>Learn more about using Zephyr IDE:</p>
                    <ul class="help-links">
                        <li><a href="https://github.com/mylonics/zephyr-ide/blob/main/README.md" class="external-link">📖 Extension Documentation</a></li>
                        <li><a href="https://docs.zephyrproject.org/latest/develop/getting_started/index.html" class="external-link">🚀 Zephyr Getting Started Guide</a></li>
                        <li><a href="https://docs.zephyrproject.org/latest/develop/west/index.html" class="external-link">🔧 West Tool Documentation</a></li>
                        <li><a href="https://github.com/mylonics/zephyr-ide/issues" class="external-link">💬 Report Issues or Get Help</a></li>
                    </ul>
                </div>
            </div>
        </div>`;
    }

    private async openWestYml() {
        try {
            const westYmlFilePath = this.getWestYmlPath();

            if (!westYmlFilePath) {
                const setupPath = this.currentWsConfig?.activeSetupState?.setupPath || "unknown";
                vscode.window.showErrorMessage(
                    `west.yml file not found.\n\n` +
                    `Checked location based on .west/config in: ${setupPath}\n\n` +
                    `Make sure west is initialized. Try running 'West Init' or one of the workspace setup commands.`
                );
                return;
            }

            const westYmlPath = vscode.Uri.file(westYmlFilePath);
            const doc = await vscode.workspace.openTextDocument(westYmlPath);
            await vscode.window.showTextDocument(doc);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to open west.yml: ${error}`);
        }
    }

    private async loadWestYmlContent() {
        try {
            const westYmlFilePath = this.getWestYmlPath();

            if (!westYmlFilePath) {
                const setupPath = this.currentWsConfig?.activeSetupState?.setupPath || "unknown";
                this._panel.webview.postMessage({
                    command: "westYmlContent",
                    content:
                        `# west.yml file not found\n` +
                        `# \n` +
                        `# Location is determined by reading manifest.path from:\n` +
                        `# ${path.join(setupPath, ".west", "config")}\n` +
                        `# \n` +
                        `# The file may not have been created yet.\n` +
                        `# Try running 'West Init' or one of the workspace setup commands.`
                });
                return;
            }

            const westYmlPath = vscode.Uri.file(westYmlFilePath);
            const doc = await vscode.workspace.openTextDocument(westYmlPath);
            const content = doc.getText();

            this._panel.webview.postMessage({
                command: "westYmlContent",
                content: content
            });
        } catch (error) {
            console.error("Error loading west.yml:", error);
            this._panel.webview.postMessage({
                command: "westYmlContent",
                content: `# Error loading west.yml\n# ${error}`
            });
        }
    }

    private async saveAndUpdateWestYml(content: string) {
        try {
            const westYmlFilePath = this.getWestYmlPath();

            if (!westYmlFilePath) {
                vscode.window.showErrorMessage(
                    "west.yml file not found. Cannot save changes.\n\n" +
                    "Make sure west is initialized first."
                );
                return;
            }

            const westYmlPath = vscode.Uri.file(westYmlFilePath);

            // Write the content to the file
            const encoder = new TextEncoder();
            await vscode.workspace.fs.writeFile(westYmlPath, encoder.encode(content));

            vscode.window.showInformationMessage(`west.yml saved successfully to: ${westYmlFilePath}`);

            // Run west update
            await vscode.commands.executeCommand("zephyr-ide.west-update");
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to save west.yml: ${error}`);
        }
    }

    /**
     * Get the west.yml file path by reading the manifest path from .west/config
     * Returns the full path to west.yml or null if not found
     */
    private getWestYmlPath(): string | null {
        if (!this.currentWsConfig?.activeSetupState?.setupPath) {
            return null;
        }

        return parseWestConfigManifestPath(this.currentWsConfig.activeSetupState.setupPath);
    }
}
