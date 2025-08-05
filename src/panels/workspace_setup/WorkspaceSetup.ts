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
import { getWestSDKContext, listAvailableSDKs, ParsedSDKList } from "../../setup_utilities/west_sdk";

export class WorkspaceSetup {
    public static currentPanel: WorkspaceSetup | undefined;
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

        if (WorkspaceSetup.currentPanel) {
            WorkspaceSetup.currentPanel._panel.reveal(column);
            WorkspaceSetup.currentPanel.updateWebView(wsConfig, globalConfig);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            "zephyrWorkspaceSetup",
            "Zephyr IDE and Workspace Setup",
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [vscode.Uri.file(extensionPath)],
            }
        );

        WorkspaceSetup.currentPanel = new WorkspaceSetup(
            panel,
            extensionPath,
            context
        );
        WorkspaceSetup.currentPanel.updateWebView(wsConfig, globalConfig);
    }

    private constructor(
        panel: vscode.WebviewPanel,
        extensionPath: string,
        context: vscode.ExtensionContext
    ) {
        this._panel = panel;
        this._extensionPath = extensionPath;
        this._context = context;

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        this._panel.webview.onDidReceiveMessage(
            (message) => this.handleWebviewMessage(message),
            null,
            this._disposables
        );
    }

    public dispose() {
        WorkspaceSetup.currentPanel = undefined;
        this._panel.dispose();

        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }

    public updateWebView(wsConfig: WorkspaceConfig, globalConfig: GlobalConfig) {
        // Store configs for use in methods
        this.currentWsConfig = wsConfig;
        this.currentGlobalConfig = globalConfig;
        this._panel.webview.html = this.getHtmlForWebview(wsConfig, globalConfig);
    }

    // Message Handler
    private handleWebviewMessage(message: any) {
        switch (message.command) {
            case "createWorkspace":
                this.createWorkspace(message.type, message.zephyrInstall);
                return;
            case "importWorkspace":
                this.importWorkspace(message.source);
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
            case "listSDKs":
                this.listSDKs();
                return;
        }
    }

    // Workspace Management Methods
    private async createWorkspace(type: string, zephyrInstall?: string) {
        try {
            if (type === "standard") {
                // Use new standard workspace setup command
                vscode.commands.executeCommand("zephyr-ide.workspace-setup-standard");
                vscode.window.showInformationMessage(
                    "Creating new standard workspace..."
                );
            } else if (type === "external") {
                // Handle external Zephyr install workspace
                if (zephyrInstall === "global") {
                    vscode.commands.executeCommand(
                        "zephyr-ide.workspace-setup-global-zephyr"
                    );
                    vscode.window.showInformationMessage(
                        "Setting up workspace with global Zephyr install..."
                    );
                } else if (zephyrInstall === "create-new") {
                    vscode.commands.executeCommand(
                        "zephyr-ide.workspace-setup-create-new-shared"
                    );
                    vscode.window.showInformationMessage(
                        "Creating new shared Zephyr installation..."
                    );
                } else if (zephyrInstall === "existing") {
                    vscode.commands.executeCommand(
                        "zephyr-ide.workspace-setup-use-existing"
                    );
                    vscode.window.showInformationMessage(
                        "Setting up workspace with existing Zephyr install..."
                    );
                } else {
                    vscode.window.showErrorMessage(
                        "Invalid Zephyr install type selected"
                    );
                    return;
                }
            } else {
                vscode.window.showErrorMessage("Invalid workspace type selected");
                return;
            }

            this._panel.dispose(); // Close wizard after starting workspace creation
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to create workspace: ${error}`);
        }
    }

    private async importWorkspace(source: string) {
        try {
            if (source === "current-directory") {
                vscode.commands.executeCommand(
                    "zephyr-ide.workspace-setup-from-current-directory"
                );
                vscode.window.showInformationMessage(
                    "Setting up current directory as Zephyr IDE workspace..."
                );
                this._panel.dispose(); // Close wizard after starting setup
            } else if (source === "zephyr-ide-git") {
                vscode.commands.executeCommand("zephyr-ide.workspace-setup-from-git");
                vscode.window.showInformationMessage(
                    "Setting up Zephyr IDE workspace from Git..."
                );
                this._panel.dispose(); // Close wizard after starting setup
            } else if (source === "west-git") {
                vscode.commands.executeCommand(
                    "zephyr-ide.workspace-setup-from-west-git"
                );
                vscode.window.showInformationMessage(
                    "Setting up West workspace from Git..."
                );
                this._panel.dispose(); // Close wizard after starting setup
            } else {
                vscode.window.showInformationMessage(
                    `Import from ${source} is coming soon!`
                );
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to import workspace: ${error}`);
        }
    }

    // Utility Methods
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
        vscode.commands.executeCommand("zephyr-ide.reset-extension");
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
            vscode.window.showErrorMessage(`Failed to setup west environment: ${error}`);
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

    private async listSDKs() {
        try {
            if (!this.currentWsConfig || !this.currentGlobalConfig) {
                vscode.window.showErrorMessage("Configuration not available");
                return;
            }

            const setupState = await getWestSDKContext(this.currentWsConfig, this.currentGlobalConfig, this._context);
            if (!setupState) {
                vscode.window.showErrorMessage("No valid west installation found for SDK management");
                return;
            }

            const sdkList = await listAvailableSDKs(setupState);

            // Send the parsed SDK list back to the webview
            this._panel.webview.postMessage({
                command: 'sdkListResult',
                data: sdkList
            });

        } catch (error) {
            vscode.window.showErrorMessage(`Failed to list SDKs: ${error}`);
            // Send error back to webview
            this._panel.webview.postMessage({
                command: 'sdkListResult',
                data: {
                    success: false,
                    versions: [],
                    error: `Failed to list SDKs: ${error}`
                }
            });
        }
    }

    // Helper methods to get current configs
    private getCurrentWorkspaceConfig(): WorkspaceConfig {
        if (!this.currentWsConfig) {
            throw new Error("Workspace config not available");
        }
        return this.currentWsConfig;
    }

    private getCurrentGlobalConfig(): GlobalConfig {
        if (!this.currentGlobalConfig) {
            throw new Error("Global config not available");
        }
        return this.currentGlobalConfig;
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
            <title>Zephyr IDE and Workspace Setup</title>
            ${this.getStylesheetLinks()}
        </head>
        <body>
            <div class="wizard-container">
                <h1>Zephyr IDE and Workspace Setup</h1>
                ${this.generateSDKSection(globalConfig)}
                ${this.generateWestOperationsSection()}
                ${this.generateWorkspaceSetupSection(folderOpen, workspaceInitialized)}
            </div>
            ${this.getScriptTags()}
        </body>
        </html>`;
    }

    private getStylesheetLinks(): string {
        const cssUri = this._panel.webview.asWebviewUri(
            vscode.Uri.joinPath(vscode.Uri.file(this._extensionPath), 'src', 'panels', 'workspace_setup', 'workspace-setup.css')
        );
        return `<link rel="stylesheet" type="text/css" href="${cssUri}">`;
    }

    private getScriptTags(): string {
        const jsUri = this._panel.webview.asWebviewUri(
            vscode.Uri.joinPath(vscode.Uri.file(this._extensionPath), 'src', 'panels', 'workspace_setup', 'workspace-setup.js')
        );
        return `<script src="${jsUri}"></script>`;
    }

    private generateSDKSection(globalConfig: GlobalConfig): string {
        const sdkCollapsed = globalConfig.sdkInstalled;
        const statusClass = globalConfig.sdkInstalled ? "status-success" : "status-error";
        const statusText = globalConfig.sdkInstalled ? "✓ SDK Installed" : "✗ SDK Not Installed";
        const expandedClass = sdkCollapsed ? "" : "expanded";
        
        const description = globalConfig.sdkInstalled 
            ? "The Zephyr SDK is installed and ready to use. You can install additional SDK versions or update to the latest."
            : "The Zephyr SDK contains the cross-compilation toolchain and debugger needed to build and debug Zephyr applications for different target architectures. The SDK installation provides version management and uses your existing west installation.";

        return `
        <div class="collapsible-section">
            <div class="collapsible-header" onclick="toggleSection('sdk')">
                <div class="collapsible-header-left">
                    <div class="status ${statusClass}">${statusText}</div>
                    <div class="collapsible-title">Zephyr SDK</div>
                </div>
                <div class="collapsible-icon ${expandedClass}" id="sdkIcon">▶</div>
            </div>
            <div class="collapsible-content ${expandedClass}" id="sdkContent">
                <div class="step-description">
                    The Zephyr SDK provides the necessary toolchain for building Zephyr applications. Use the Install SDK command to download and install the latest SDK with your preferred toolchains.
                </div>
                <p style="margin-bottom: 15px; color: var(--vscode-descriptionForeground); font-size: 12px;">
                    ${description}
                </p>
                <div style="display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 15px;">
                    <button class="button" onclick="installSDK()">Install SDK</button>
                    <button class="button button-secondary" onclick="listSDKs()">List Installed SDKs</button>
                </div>
                <div id="sdkListResults" style="display: none; margin-top: 15px;">
                    <h4 style="margin: 0 0 10px 0; font-size: 13px; font-weight: 600;">Installed SDK Versions:</h4>
                    <div id="sdkListContent"></div>
                </div>
            </div>
        </div>`;
    }

    private generateWestOperationsSection(): string {
        return `
        <div class="collapsible-section">
            <div class="collapsible-header" onclick="toggleSection('westOps')">
                <div class="collapsible-header-left">
                    <div class="status status-warning">⚙️ West Operations</div>
                    <div class="collapsible-title">West Environment & Initialization</div>
                </div>
                <div class="collapsible-icon expanded" id="westOpsIcon">▶</div>
            </div>
            <div class="collapsible-content expanded" id="westOpsContent">
                <div class="step-description">
                    Initialize west workspace environments and run west init commands for project management.
                </div>
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 18px; margin-top: 15px;">
                    ${this.generateWestOperationCard("🌐", "Setup West Environment", "Initialize a Python virtual environment and install west tools required for Zephyr development.", "setupWestEnvironment()")}
                    ${this.generateWestOperationCard("🔧", "West Init", "Initialize a new west workspace with manifests and repositories for Zephyr project development.", "westInit()")}
                    ${this.generateWestOperationCard("🔄", "West Update", "Update west workspace repositories and install Python requirements for the current Zephyr version.", "westUpdate()")}
                </div>
            </div>
        </div>`;
    }

    private generateWestOperationCard(icon: string, title: string, description: string, onClick: string): string {
        return `
        <div style="padding: 20px; border: 1px solid var(--vscode-panel-border); border-radius: 6px; background-color: var(--vscode-input-background);">
            <h4 style="margin: 0 0 8px 0; font-size: 14px; font-weight: 600; display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 16px;">${icon}</span>
                ${title}
            </h4>
            <p style="margin: 0 0 12px 0; font-size: 12px; color: var(--vscode-descriptionForeground);">${description}</p>
            <button class="button" onclick="${onClick}">${title}</button>
        </div>`;
    }

    private generateWorkspaceSetupSection(folderOpen: boolean, workspaceInitialized: boolean): string {
        if (!folderOpen) {
            // Keep as regular step when no folder is open
            const description = this.getWorkspaceDescription(folderOpen, workspaceInitialized);
            const content = this.getWorkspaceContent(folderOpen, workspaceInitialized);
            return `
            <div class="step">
                <div class="step-title">Workspace Setup</div>
                <div class="step-description">${description}</div>
                ${content}
            </div>`;
        }

        // Make it collapsible when folder is open
        const workspaceCollapsed = workspaceInitialized; // Collapse when initialized
        const statusClass = workspaceInitialized ? "status-success" : "status-warning";
        const statusText = workspaceInitialized ? "✅ Workspace Ready" : "⚙️ Workspace Setup";
        const expandedClass = workspaceCollapsed ? "" : "expanded";
        const description = this.getWorkspaceDescription(folderOpen, workspaceInitialized);
        const content = this.getWorkspaceContent(folderOpen, workspaceInitialized);

        return `
        <div class="collapsible-section">
            <div class="collapsible-header" onclick="toggleSection('workspace')">
                <div class="collapsible-header-left">
                    <div class="status ${statusClass}">${statusText}</div>
                    <div class="collapsible-title">Workspace Setup</div>
                </div>
                <div class="collapsible-icon ${expandedClass}" id="workspaceIcon">▶</div>
            </div>
            <div class="collapsible-content ${expandedClass}" id="workspaceContent">
                <div class="step-description">${description}</div>
                ${content}
            </div>
        </div>`;
    }

    private getWorkspaceDescription(folderOpen: boolean, workspaceInitialized: boolean): string {
        if (!folderOpen) {
            return "Open a folder in VS Code to set up your Zephyr workspace.";
        } else if (workspaceInitialized) {
            return "Your workspace is already initialized. You can reinitialize if needed.";
        } else {
            return "Choose how you want to set up your Zephyr workspace. A workspace can contain multiple projects and manages dependencies.";
        }
    }

    private getWorkspaceContent(folderOpen: boolean, workspaceInitialized: boolean): string {
        if (!folderOpen) {
            return this.generateNoFolderContent();
        } else if (workspaceInitialized) {
            return this.generateInitializedContent();
        } else {
            return this.generateWorkspaceOptions();
        }
    }

    private generateNoFolderContent(): string {
        return `
        <div style="text-align: center; padding: 30px;">
            <div style="font-size: 2em; margin-bottom: 15px;">📁</div>
            <p style="margin-bottom: 20px; color: var(--vscode-descriptionForeground); font-size: 12px;">Please open a folder in VS Code to continue with workspace setup.</p>
            <button class="button" onclick="openFolder()">Open Folder</button>
        </div>`;
    }

    private generateInitializedContent(): string {
        return `
        <div style="text-align: center; padding: 30px;">
            <div style="font-size: 2em; margin-bottom: 15px;">✅</div>
            <p style="margin-bottom: 20px; color: var(--vscode-descriptionForeground); font-size: 12px;">Your Zephyr workspace is already set up and ready to use!</p>
            <button class="button button-secondary" onclick="reinitializeWorkspace()">Reinitialize Workspace</button>
        </div>`;
    }

    private generateWorkspaceOptions(): string {
        return `
        <h4>Import Existing Workspace</h4>
        <div class="import-options">
            ${this.generateImportOptionCard("🌐", "Zephyr IDE Workspace from Git", "Clone and import a Zephyr IDE workspace from a Git repository with predefined project structure and configuration.", "Team projects, shared workspaces, and standardized development environments.", "zephyr-ide-git")}
            ${this.generateImportOptionCard("⚙️", "West Workspace from Git", "Clone a standard west manifest workspace from a Git repository following Zephyr's workspace structure.", "Upstream projects, community samples, and standard Zephyr workflows.", "west-git")}
            ${this.generateImportOptionCard("📁", "Open Current Directory", "Initialize the current VS Code workspace directory as a Zephyr IDE workspace, detecting existing projects and configurations.", "Existing local projects, downloaded samples, or when you already have Zephyr code locally.", "current-directory")}
        </div>
        
        <h4>Create New Workspace</h4>
        <div class="topology-options">
            ${this.generateCreateOptionCard("📦", "Standard Workspace", "Create a workspace with Zephyr downloaded locally within the workspace directory. Each workspace has its own Zephyr installation.", "Single projects, isolated development, when you need specific Zephyr versions per project.", "standard")}
            ${this.generateExternalZephyrCard()}
        </div>
        
        <div class="flex-buttons">
            <button class="button hidden" id="createWorkspaceButton" onclick="createWorkspace()">Create Workspace</button>
            <button class="button hidden" id="createExternalWorkspaceButton" onclick="createExternalWorkspace()">Create Workspace</button>
            <button class="button hidden" id="importWorkspaceButton" onclick="importWorkspace()">Import Workspace</button>
        </div>`;
    }

    private generateImportOptionCard(icon: string, title: string, description: string, usage: string, source: string): string {
        return `
        <div class="option-card" onclick="selectImportSource('${source}')">
            <div class="option-card-header">
                <div class="topology-icon">${icon}</div>
                <h3>${title}</h3>
            </div>
            <p class="option-card-description">${description}</p>
            <p class="option-card-usage">Best for: ${usage}</p>
        </div>`;
    }

    private generateCreateOptionCard(icon: string, title: string, description: string, usage: string, type: string): string {
        return `
        <div class="option-card" onclick="selectWorkspaceType('${type}')">
            <div class="option-card-header">
                <div class="topology-icon">${icon}</div>
                <h3>${title}</h3>
            </div>
            <p class="option-card-description">${description}</p>
            <p class="option-card-usage">Best for: ${usage}</p>
        </div>`;
    }

    private generateExternalZephyrCard(): string {
        return `
        <div class="option-card external-zephyr-card">
            <div class="option-card-header">
                <div class="topology-icon">🔗</div>
                <h3>Workspace Using External Zephyr Install</h3>
            </div>
            <p class="option-card-description">Create a workspace that uses a shared Zephyr installation. Prevents re-downloading Zephyr for multiple projects and enables sharing across workspaces.</p>
            <p class="option-card-usage">Best for: Multiple projects, shared development environments, when you want to reuse Zephyr installations.</p>
            
            <div class="external-options">
                ${this.generateExternalOption("🌍", "Global Install", "Use system-wide global Zephyr installation", "global")}
                ${this.generateExternalOption("📁", "Create New Shared", "Create new shared installation in custom directory", "create-new")}
                ${this.generateExternalOption("🔍", "Use Existing Install", "Point to existing folder with .west directory", "existing")}
            </div>
        </div>`;
    }

    private generateExternalOption(icon: string, title: string, description: string, type: string): string {
        return `
        <div class="external-option" onclick="selectZephyrInstall('${type}')">
            <div class="external-option-radio"></div>
            <div style="flex: 1;">
                <div style="font-weight: 600; margin-bottom: 2px; font-size: 12px;">${icon} ${title}</div>
                <div style="font-size: 11px; color: var(--vscode-descriptionForeground);">${description}</div>
            </div>
        </div>`;
    }
}
