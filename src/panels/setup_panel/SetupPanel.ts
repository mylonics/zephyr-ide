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
import { WorkspaceConfig, GlobalConfig } from "../../setup_utilities/types";
import {
    getWestSDKContext,
    listAvailableSDKs,
    ParsedSDKList,
} from "../../setup_utilities/west_sdk";
import { saveSetupState } from "../../setup_utilities/state-management";
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
                subPageContent = SDKSubPage.getHtml(this.currentGlobalConfig);
                break;
            case "workspace":
                subPageContent = WorkspaceSubPage.getHtml(this.currentWsConfig);
                break;
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

    // Public method to navigate to host tools page
    public navigateToHostTools() {
        this.navigateToPage("hosttools");
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
            this._panel.webview.postMessage({
                command: "hostToolsInstallProgress",
                message: "Installing package manager...",
            });

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

            this._panel.webview.postMessage({
                command: "hostToolsInstallComplete",
            });
        } catch (error) {
            vscode.window.showErrorMessage(`Error: ${error}`);
            this._panel.webview.postMessage({
                command: "hostToolsInstallComplete",
            });
        }
    }

    private async installPackage(packageName: string) {
        try {
            this._panel.webview.postMessage({
                command: "hostToolsInstallProgress",
                message: `Installing ${packageName}...`,
            });

            const platformPackages = await getPlatformPackages();
            const pkg = platformPackages.find(p => p.name === packageName);
            
            if (!pkg) {
                vscode.window.showErrorMessage(`Package ${packageName} not found`);
                this._panel.webview.postMessage({
                    command: "hostToolsInstallComplete",
                });
                return;
            }

            await installPackage(pkg);
            await this.checkHostToolsStatus();

            this._panel.webview.postMessage({
                command: "hostToolsInstallComplete",
            });
        } catch (error) {
            vscode.window.showErrorMessage(`Error: ${error}`);
            this._panel.webview.postMessage({
                command: "hostToolsInstallComplete",
            });
        }
    }

    private async installAllMissingTools() {
        try {
            this._panel.webview.postMessage({
                command: "hostToolsInstallProgress",
                message: "Installing all missing packages...",
            });

            await installAllMissingPackages();
            await this.checkHostToolsStatus();
            
            const packageStatuses = await checkAllPackages();
            const needsRestart = packageStatuses.some(p => !p.available);
            
            if (needsRestart) {
                vscode.window.showWarningMessage(
                    "Some packages were installed but are not yet available. Please close and reopen VS Code completely (not just reload) for changes to take effect."
                );
            }

            this._panel.webview.postMessage({
                command: "hostToolsInstallComplete",
            });
        } catch (error) {
            vscode.window.showErrorMessage(`Error: ${error}`);
            this._panel.webview.postMessage({
                command: "hostToolsInstallComplete",
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
            vscode.commands.executeCommand("zephyr-ide.install-sdk");
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
        const workspaceInitialized = wsConfig.initialSetupComplete || false;

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
                    <h1>Zephyr IDE Setup & Configuration</h1>
                    ${this.generateOverviewSection(wsConfig, globalConfig, folderOpen, workspaceInitialized)}
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
        workspaceInitialized: boolean
    ): string {
        return `
        <div class="overview-section">
            <h2 style="margin: 0 0 15px 0; font-size: 16px; font-weight: 600;">Setup Overview</h2>
            <p class="section-description">Click on any card to view details and perform setup tasks.</p>
            <div class="overview-cards">
                ${HostToolsCard.getHtml(globalConfig)}
                ${SDKCard.getHtml(globalConfig)}
                ${WorkspaceCard.getHtml(wsConfig, folderOpen, workspaceInitialized)}
            </div>
        </div>`;
    }
}
