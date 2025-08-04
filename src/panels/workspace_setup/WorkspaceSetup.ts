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
import { WorkspaceConfig, GlobalConfig } from "../../setup_utilities/setup";
import { installHostTools } from "../../setup_utilities/host_tools";


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
            "Zephyr IDE Workspace Setup",
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
            (message) => {
                switch (message.command) {
                    case "installHostTools":
                        this.installHostTools();
                        return;
                    case "createWorkspace":
                        this.createWorkspace(message.type, message.zephyrInstall);
                        return;
                    case "importWorkspace":
                        this.importWorkspace(message.source);
                        return;
                    case "refreshHostToolsStatus":
                        this.refreshHostToolsStatus();
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
                    case "openHostToolsWalkthrough":
                        this.openHostToolsWalkthrough();
                        return;
                }
            },
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

    private async installHostTools() {
        try {
            const result = await installHostTools();
            if (result) {
                vscode.commands.executeCommand(
                    "setContext",
                    "hostToolsInstalled",
                    true
                );
                vscode.window.showInformationMessage(
                    "Host tools installed successfully!"
                );
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to install host tools: ${error}`);
        }
    }

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

    private async refreshHostToolsStatus() {
        try {
            // We'll need to get fresh configs - for now use the current ones and trigger a refresh
            vscode.commands.executeCommand("zephyr-ide.check-build-dependencies");
            vscode.window.showInformationMessage("Host tools status refreshed");
        } catch (error) {
            vscode.window.showErrorMessage(
                `Failed to check host tools status: ${error}`
            );
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
        vscode.commands.executeCommand("zephyr-ide.reset-extension");
    }



    private async openHostToolsWalkthrough() {
        try {
            vscode.commands.executeCommand("zephyr-ide.open-host-tools-walkthrough");
        } catch (error) {
            vscode.window.showErrorMessage(
                `Failed to open host tools walkthrough: ${error}`
            );
        }
    }

    private async installSDK() {
        try {
            vscode.commands.executeCommand("zephyr-ide.install-sdk");
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to install west SDK: ${error}`);
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

    private getHtmlForWebview(
        wsConfig: WorkspaceConfig,
        globalConfig: GlobalConfig
    ): string {
        // Check host tools status
        const hostToolsInstalled = globalConfig.toolsAvailable || false;

        // Check workspace status
        const folderOpen = wsConfig.rootPath !== "";
        const workspaceInitialized = wsConfig.initialSetupComplete || false;

        // Determine if sections should be collapsed by default
        const hostToolsCollapsed = hostToolsInstalled;
        const sdkCollapsed = globalConfig.sdkInstalled;

        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Zephyr IDE Workspace Setup</title>
            <style>
                body {
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe WPC", "Segoe UI", system-ui, "Ubuntu", "Droid Sans", sans-serif;
                    font-size: 13px;
                    line-height: 1.4;
                    color: var(--vscode-foreground);
                    background-color: var(--vscode-editor-background);
                    padding: 20px;
                    margin: 0;
                }
                
                .wizard-container {
                    max-width: 100%;
                }
                
                h1 {
                    font-size: 20px;
                    font-weight: 300;
                    margin: 0 0 30px 0;
                    color: var(--vscode-foreground);
                    border-bottom: 1px solid var(--vscode-panel-border);
                    padding-bottom: 15px;
                }
                
                .collapsible-section {
                    margin-bottom: 20px;
                    border: 1px solid var(--vscode-panel-border);
                    border-radius: 6px;
                    background-color: var(--vscode-input-background);
                }
                
                .collapsible-header {
                    padding: 15px 20px;
                    cursor: pointer;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    background-color: var(--vscode-input-background);
                    border-radius: 6px 6px 0 0;
                    user-select: none;
                }
                
                .collapsible-header:hover {
                    background-color: var(--vscode-list-hoverBackground);
                }
                
                .collapsible-header-left {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                }
                
                .collapsible-title {
                    font-size: 14px;
                    font-weight: 600;
                    margin: 0;
                    color: var(--vscode-foreground);
                }
                
                .collapsible-icon {
                    font-size: 0.8em;
                    transition: transform 0.2s;
                }
                
                .collapsible-icon.expanded {
                    transform: rotate(90deg);
                }
                
                .collapsible-content {
                    padding: 0 20px 20px 20px;
                    display: none;
                }
                
                .collapsible-content.expanded {
                    display: block;
                }
                
                .step {
                    margin-bottom: 25px;
                    padding: 20px;
                    border: 1px solid var(--vscode-panel-border);
                    border-radius: 6px;
                    background-color: var(--vscode-input-background);
                }
                
                .step-title {
                    font-size: 16px;
                    font-weight: 600;
                    margin: 0 0 15px 0;
                    color: var(--vscode-foreground);
                }
                
                .step-description {
                    margin-bottom: 15px;
                    line-height: 1.5;
                    color: var(--vscode-descriptionForeground);
                    font-size: 13px;
                }
                
                .status {
                    display: inline-flex;
                    align-items: center;
                    padding: 6px 12px;
                    border-radius: 4px;
                    font-size: 11px;
                    font-weight: 500;
                    margin-bottom: 15px;
                }
                
                .status-success {
                    background-color: var(--vscode-terminal-ansiGreen);
                    color: var(--vscode-editor-background);
                }
                
                .status-warning {
                    background-color: var(--vscode-terminal-ansiYellow);
                    color: var(--vscode-editor-background);
                }
                
                .status-error {
                    background-color: var(--vscode-terminal-ansiRed);
                    color: var(--vscode-editor-background);
                }
                
                .button {
                    font-family: inherit;
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    padding: 6px 14px;
                    margin: 5px 10px 5px 0;
                    cursor: pointer;
                    border-radius: 2px;
                    font-size: 13px;
                    font-weight: 400;
                    transition: background-color 0.1s;
                }
                
                .button:hover {
                    background-color: var(--vscode-button-hoverBackground);
                }
                
                .button-secondary {
                    background-color: var(--vscode-button-secondaryBackground);
                    color: var(--vscode-button-secondaryForeground);
                }
                
                .button-secondary:hover {
                    background-color: var(--vscode-button-secondaryHoverBackground);
                }
                
                .button:disabled {
                    opacity: 0.4;
                    cursor: not-allowed;
                }
                
                .button:disabled:hover {
                    background-color: var(--vscode-button-background);
                }
                
                .button-small {
                    padding: 4px 12px;
                    font-size: 12px;
                }
                
                .hidden {
                    display: none;
                }
                
                .topology-options, .import-options {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
                    gap: 18px;
                    margin-top: 15px;
                }
                
                .option-card {
                    border: 1px solid var(--vscode-panel-border);
                    border-radius: 6px;
                    padding: 18px;
                    cursor: pointer;
                    transition: all 0.2s;
                    background-color: var(--vscode-editor-background);
                    position: relative;
                }
                
                .option-card:hover {
                    border-color: var(--vscode-inputOption-hoverBackground);
                    background-color: var(--vscode-list-hoverBackground);
                }
                
                .option-card.selected {
                    border-color: var(--vscode-inputOption-activeBackground);
                    background-color: var(--vscode-inputOption-activeBackground);
                    color: var(--vscode-inputOption-activeForeground);
                }
                
                .option-card-header {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    margin-bottom: 10px;
                }
                
                .topology-icon {
                    font-size: 24px;
                    width: 32px;
                    height: 32px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                
                .option-card h3 {
                    margin: 0;
                    font-size: 14px;
                    font-weight: 600;
                    color: inherit;
                }
                
                .option-card-description {
                    margin: 0 0 8px 0;
                    font-size: 12px;
                    line-height: 1.4;
                    color: var(--vscode-descriptionForeground);
                }
                
                .option-card.selected .option-card-description {
                    color: var(--vscode-inputOption-activeForeground);
                    opacity: 0.9;
                }
                
                .option-card-usage {
                    margin: 0;
                    font-size: 11px;
                    font-style: italic;
                    color: var(--vscode-descriptionForeground);
                    opacity: 0.8;
                }
                
                .option-card.selected .option-card-usage {
                    color: var(--vscode-inputOption-activeForeground);
                    opacity: 0.7;
                }
                
                .inline-code {
                    background-color: var(--vscode-textCodeBlock-background);
                    color: var(--vscode-textPreformat-foreground);
                    padding: 2px 4px;
                    border-radius: 3px;
                    font-family: var(--vscode-editor-font-family);
                    font-size: 0.9em;
                }
                
                .info-text {
                    color: var(--vscode-descriptionForeground);
                    font-style: italic;
                    font-size: 12px;
                    margin-top: 10px;
                }
                
                .flex-buttons {
                    display: flex;
                    gap: 15px;
                    margin-top: 20px;
                    flex-wrap: wrap;
                }
                
                .external-options {
                    display: flex;
                    flex-direction: column;
                    gap: 4px;
                }
                
                .external-option {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    padding: 6px 8px;
                    border-radius: 4px;
                    cursor: pointer;
                    transition: background-color 0.2s;
                    font-size: 12px;
                }
                
                .external-option:hover {
                    background-color: var(--vscode-list-hoverBackground);
                }
                
                .external-option.selected {
                    background-color: var(--vscode-inputOption-activeBackground);
                    color: var(--vscode-inputOption-activeForeground);
                }
                
                .external-option-radio {
                    width: 12px;
                    height: 12px;
                    border: 2px solid var(--vscode-descriptionForeground);
                    border-radius: 50%;
                    position: relative;
                    flex-shrink: 0;
                }
                
                .external-option.selected .external-option-radio {
                    border-color: var(--vscode-inputOption-activeForeground);
                }
                
                .external-option.selected .external-option-radio::after {
                    content: '';
                    position: absolute;
                    top: 2px;
                    left: 2px;
                    width: 6px;
                    height: 6px;
                    background-color: var(--vscode-inputOption-activeForeground);
                    border-radius: 50%;
                }
                
                h4 {
                    font-size: 14px;
                    font-weight: 600;
                    margin: 20px 0 15px 0;
                    color: var(--vscode-foreground);
                }
            </style>
        </head>
        <body>
            <div class="wizard-container">
                <h1>Zephyr IDE Workspace Setup</h1>
                
                <!-- Host Tools -->
                <div class="collapsible-section">
                    <div class="collapsible-header" onclick="toggleSection('hostTools')">
                        <div class="collapsible-header-left">
                            <div class="status ${hostToolsInstalled
                ? "status-success"
                : "status-error"
            }">
                                ${hostToolsInstalled
                ? "✓ Host Tools Installed"
                : "✗ Host Tools Not Installed"
            }
                            </div>
                            <div class="collapsible-title">Host Tools</div>
                        </div>
                        <div class="collapsible-icon ${hostToolsCollapsed ? "" : "expanded"
            }" id="hostToolsIcon">▶</div>
                    </div>
                    <div class="collapsible-content ${hostToolsCollapsed ? "" : "expanded"
            }" id="hostToolsContent">
                        <div class="step-description">
                            Before creating or importing projects, ensure that all required host tools are installed. Follow the instructions at <a href="https://docs.zephyrproject.org/latest/develop/getting_started/index.html#host-tools" target="_blank">Zephyr Project Getting Started</a> if you run into any issues.
                        </div>
                        
                        <div style="display: flex; align-items: center; gap: 15px; margin-bottom: 15px;">
                            <button class="button button-secondary button-small" onclick="refreshHostToolsStatus()">
                                Refresh Status
                            </button>
                        </div>
                        
                        ${!hostToolsInstalled
                ? `
                        <div style="margin-bottom: 20px;">
                            ${process.platform === "win32"
                    ? `
                            <div style="margin-bottom: 15px; padding: 12px; border: 1px solid var(--vscode-panel-border); border-radius: 4px; background-color: var(--vscode-editor-background);">
                                <h4 style="margin: 0 0 8px 0; font-size: 14px; font-weight: 600;">1. Install winget (Windows only)</h4>
                                <p style="margin: 0 0 10px 0; font-size: 12px; color: var(--vscode-descriptionForeground);">Install winget if not already installed. Modern versions of Windows have winget preinstalled.</p>
                                <button class="button button-secondary button-small" onclick="openWingetInstall()">Download winget</button>
                            </div>
                            `
                    : ""
                }
                            
                            <div style="margin-bottom: 15px; padding: 12px; border: 1px solid var(--vscode-panel-border); border-radius: 4px; background-color: var(--vscode-editor-background);">
                                <h4 style="margin: 0 0 8px 0; font-size: 14px; font-weight: 600;">${process.platform === "win32" ? "2" : "1"
                }. Install Host Tools</h4>
                                <p style="margin: 0 0 10px 0; font-size: 12px; color: var(--vscode-descriptionForeground);">Install required tools: <span class="inline-code">git</span>, <span class="inline-code">python</span>, <span class="inline-code">cmake</span>, and <span class="inline-code">dtc</span>.</p>
                                <button class="button" onclick="installHostTools()">Install Host Tools</button>
                                <p style="margin: 8px 0 0 0; font-size: 11px; color: var(--vscode-descriptionForeground); font-style: italic;">You may need to restart VS Code after this step.</p>
                            </div>
                        </div>
                        `
                : `
                        <p style="margin-bottom: 15px; color: var(--vscode-descriptionForeground); font-size: 12px;">
                            All required host tools are installed and ready to use. These include git, python, cmake, and device tree compiler (dtc).
                        </p>
                        
                        <div style="display: flex; gap: 10px;">
                            <button class="button button-secondary" onclick="installHostTools()">Reinstall Host Tools</button>
                            <button class="button button-secondary" onclick="openHostToolsWalkthrough()">Open Install Guide</button>
                        </div>
                        `
            }
                    </div>
                </div>
                
                <!-- Zephyr SDK Status -->
                <div class="collapsible-section">
                    <div class="collapsible-header" onclick="toggleSection('sdk')">
                        <div class="collapsible-header-left">
                            <div class="status ${globalConfig.sdkInstalled
                ? "status-success"
                : "status-error"
            }">
                                ${globalConfig.sdkInstalled
                ? "✓ SDK Installed"
                : "✗ SDK Not Installed"
            }
                            </div>
                            <div class="collapsible-title">Zephyr SDK</div>
                            ${globalConfig.sdkInstalled &&
                wsConfig.activeSetupState?.zephyrVersion
                ? `<div style="font-size: 11px; color: var(--vscode-descriptionForeground);">v${wsConfig.activeSetupState.zephyrVersion}</div>`
                : ""
            }
                        </div>
                        <div class="collapsible-icon ${sdkCollapsed ? "" : "expanded"
            }" id="sdkIcon">▶</div>
                    </div>
                    <div class="collapsible-content ${sdkCollapsed ? "" : "expanded"
            }" id="sdkContent">
                        <div class="step-description">
                            The Zephyr SDK provides the necessary toolchain for building Zephyr applications. Use the Install SDK command to download and install the latest SDK with your preferred toolchains.
                        </div>
                        
                        ${!globalConfig.sdkInstalled
                ? `
                        <p style="margin-bottom: 15px; color: var(--vscode-descriptionForeground); font-size: 12px;">
                            The Zephyr SDK contains the cross-compilation toolchain and debugger needed to build and debug Zephyr applications for different target architectures. The SDK installation provides version management and uses your existing west installation.
                        </p>
                        `
                : `
                        <p style="margin-bottom: 15px; color: var(--vscode-descriptionForeground); font-size: 12px;">
                            The Zephyr SDK is installed and ready to use. You can install additional SDK versions or update to the latest.
                        </p>
                        `
            }
                        
                        <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                            <button class="button" onclick="installSDK()" ${!hostToolsInstalled ? "disabled" : ""}>
                                Install SDK
                            </button>
                        </div>
                        
                        ${!hostToolsInstalled ? `<p class="info-text">Complete the host tools setup above to enable SDK installation.</p>` : ""}
                    </div>
                </div>
                
                <!-- Workspace Setup Options -->
                <div class="step">
                    <div class="step-title">Workspace Setup</div>
                    <div class="step-description">
                        ${!folderOpen ? "Open a folder in VS Code to set up your Zephyr workspace." :
                workspaceInitialized ? "Your workspace is already initialized. You can reinitialize if needed." : "Choose how you want to set up your Zephyr workspace. A workspace can contain multiple projects and manages dependencies."}
                    </div>
                    
                    ${!folderOpen ? `
                    <div style="text-align: center; padding: 30px;">
                        <div style="font-size: 2em; margin-bottom: 15px;">📁</div>
                        <p style="margin-bottom: 20px; color: var(--vscode-descriptionForeground); font-size: 12px;">Please open a folder in VS Code to continue with workspace setup.</p>
                        <button class="button" onclick="openFolder()">Open Folder</button>
                    </div>
                    `
                : workspaceInitialized ? `
                    <div style="text-align: center; padding: 30px;">
                        <div style="font-size: 2em; margin-bottom: 15px;">✅</div>
                        <p style="margin-bottom: 20px; color: var(--vscode-descriptionForeground); font-size: 12px;">Your Zephyr workspace is already set up and ready to use!</p>
                        <button class="button button-secondary" onclick="reinitializeWorkspace()">Reinitialize Workspace</button>
                    </div>
                    `
                    : !hostToolsInstalled
                        ? `
                    <p class="info-text">Complete the host tools setup above to enable workspace setup options.</p>
                    `
                        : `
                    
                    <h4>Import Existing Workspace</h4>
                    <div class="import-options">
                        <div class="option-card" onclick="selectImportSource('zephyr-ide-git')" ${!hostToolsInstalled
                            ? "style='pointer-events: none; opacity: 0.4;'"
                            : ""
                        }>
                            <div class="option-card-header">
                                <div class="topology-icon">🌐</div>
                                <h3>Zephyr IDE Workspace from Git</h3>
                            </div>
                            <p class="option-card-description">Clone and import a Zephyr IDE workspace from a Git repository with predefined project structure and configuration.</p>
                            <p class="option-card-usage">Best for: Team projects, shared workspaces, and standardized development environments.</p>
                        </div>
                        <div class="option-card" onclick="selectImportSource('west-git')" ${!hostToolsInstalled
                            ? "style='pointer-events: none; opacity: 0.4;'"
                            : ""
                        }>
                            <div class="option-card-header">
                                <div class="topology-icon">⚙️</div>
                                <h3>West Workspace from Git</h3>
                            </div>
                            <p class="option-card-description">Clone a standard west manifest workspace from a Git repository following Zephyr's workspace structure.</p>
                            <p class="option-card-usage">Best for: Upstream projects, community samples, and standard Zephyr workflows.</p>
                        </div>
                        <div class="option-card" onclick="selectImportSource('current-directory')" ${!hostToolsInstalled
                            ? "style='pointer-events: none; opacity: 0.4;'"
                            : ""
                        }>
                            <div class="option-card-header">
                                <div class="topology-icon">📁</div>
                                <h3>Open Current Directory</h3>
                            </div>
                            <p class="option-card-description">Initialize the current VS Code workspace directory as a Zephyr IDE workspace, detecting existing projects and configurations.</p>
                            <p class="option-card-usage">Best for: Existing local projects, downloaded samples, or when you already have Zephyr code locally.</p>
                        </div>
                    </div>
                    
                    <h4>Create New Workspace</h4>
                    <div class="topology-options">
                        <div class="option-card" onclick="selectWorkspaceType('standard')" ${!hostToolsInstalled
                            ? "style='pointer-events: none; opacity: 0.4;'"
                            : ""
                        }>
                            <div class="option-card-header">
                                <div class="topology-icon">📦</div>
                                <h3>Standard Workspace</h3>
                            </div>
                            <p class="option-card-description">Create a workspace with Zephyr downloaded locally within the workspace directory. Each workspace has its own Zephyr installation.</p>
                            <p class="option-card-usage">Best for: Single projects, isolated development, when you need specific Zephyr versions per project.</p>
                        </div>
                        <div class="option-card external-zephyr-card" ${!hostToolsInstalled
                            ? "style='pointer-events: none; opacity: 0.4;'"
                            : ""
                        }>
                            <div class="option-card-header">
                                <div class="topology-icon">🔗</div>
                                <h3>Workspace Using External Zephyr Install</h3>
                            </div>
                            <p class="option-card-description">Create a workspace that uses a shared Zephyr installation. Prevents re-downloading Zephyr for multiple projects and enables sharing across workspaces.</p>
                            <p class="option-card-usage">Best for: Multiple projects, shared development environments, when you want to reuse Zephyr installations.</p>
                            
                            <div class="external-options" style="margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--vscode-panel-border);">
                                <div class="external-option" onclick="selectZephyrInstall('global')">
                                    <div class="external-option-radio"></div>
                                    <div style="flex: 1;">
                                        <div style="font-weight: 600; margin-bottom: 2px; font-size: 12px;">🌍 Global Install</div>
                                        <div style="font-size: 11px; color: var(--vscode-descriptionForeground);">Use system-wide global Zephyr installation</div>
                                    </div>
                                </div>
                                <div class="external-option" onclick="selectZephyrInstall('create-new')">
                                    <div class="external-option-radio"></div>
                                    <div style="flex: 1;">
                                        <div style="font-weight: 600; margin-bottom: 2px; font-size: 12px;">📁 Create New Shared</div>
                                        <div style="font-size: 11px; color: var(--vscode-descriptionForeground);">Create new shared installation in custom directory</div>
                                    </div>
                                </div>
                                <div class="external-option" onclick="selectZephyrInstall('existing')">
                                    <div class="external-option-radio"></div>
                                    <div style="flex: 1;">
                                        <div style="font-weight: 600; margin-bottom: 2px; font-size: 12px;">🔍 Use Existing Install</div>
                                        <div style="font-size: 11px; color: var(--vscode-descriptionForeground);">Point to existing folder with .west directory</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <div class="flex-buttons">
                        <button class="button hidden" id="createWorkspaceButton" onclick="createWorkspace()">Create Workspace</button>
                        <button class="button hidden" id="createExternalWorkspaceButton" onclick="createExternalWorkspace()">Create Workspace</button>
                        <button class="button hidden" id="importWorkspaceButton" onclick="importWorkspace()">Import Workspace</button>
                    </div>
                    `
            }
                </div>
            </div>
            
            <script>
                const vscode = acquireVsCodeApi();
                let selectedWorkspaceType = null;
                let selectedZephyrInstall = null;
                let selectedImportSource = null;
                
                function toggleSection(sectionId) {
                    const content = document.getElementById(sectionId + 'Content');
                    const icon = document.getElementById(sectionId + 'Icon');
                    
                    if (content.classList.contains('expanded')) {
                        content.classList.remove('expanded');
                        icon.classList.remove('expanded');
                    } else {
                        content.classList.add('expanded');
                        icon.classList.add('expanded');
                    }
                }
                
                function openWingetInstall() {
                    vscode.postMessage({
                        command: 'openWingetLink'
                    });
                }
                
                function refreshHostToolsStatus() {
                    vscode.postMessage({
                        command: 'refreshHostToolsStatus'
                    });
                }
                
                function installHostTools() {
                    vscode.postMessage({
                        command: 'installHostTools'
                    });
                }
                
                function openFolder() {
                    vscode.postMessage({
                        command: 'openFolder'
                    });
                }
                
                function reinitializeWorkspace() {
                    vscode.postMessage({
                        command: 'reinitializeWorkspace'
                    });
                }
                
                function installSDK() {
                    vscode.postMessage({
                        command: 'installSDK'
                    });
                }
                
                function openHostToolsWalkthrough() {
                    vscode.postMessage({
                        command: 'openHostToolsWalkthrough'
                    });
                }
                
                function hideWorkspaceOptions() {
                    selectedWorkspaceType = null;
                    selectedZephyrInstall = null;
                    selectedImportSource = null;
                    updateButtonStates();
                }
                
                function selectWorkspaceType(type) {
                    selectedWorkspaceType = type;
                    selectedImportSource = null; // Clear import selection
                    selectedZephyrInstall = null; // Clear external selection
                    
                    // Update UI - clear all selections first
                    document.querySelectorAll('.option-card').forEach(card => {
                        card.classList.remove('selected');
                    });
                    document.querySelectorAll('.external-option').forEach(option => {
                        option.classList.remove('selected');
                    });
                    event.target.closest('.option-card').classList.add('selected');
                    
                    updateButtonStates();
                }
                
                function selectZephyrInstall(installType) {
                    selectedZephyrInstall = installType;
                    selectedWorkspaceType = 'external'; // Set workspace type to external
                    selectedImportSource = null; // Clear import selection
                    
                    // Stop event propagation to prevent card selection
                    event.stopPropagation();
                    
                    // Update UI - clear all selections first
                    document.querySelectorAll('.option-card').forEach(card => {
                        card.classList.remove('selected');
                    });
                    document.querySelectorAll('.external-option').forEach(option => {
                        option.classList.remove('selected');
                    });
                    
                    // Select the external workspace card and the clicked external option
                    document.querySelector('.external-zephyr-card').classList.add('selected');
                    event.target.closest('.external-option').classList.add('selected');
                    
                    updateButtonStates();
                }
                
                function selectImportSource(source) {
                    selectedImportSource = source;
                    selectedWorkspaceType = null; // Clear workspace type selection
                    
                    // Update UI - clear all selections first
                    document.querySelectorAll('.option-card').forEach(card => {
                        card.classList.remove('selected');
                    });
                    event.target.closest('.option-card').classList.add('selected');
                    
                    updateButtonStates();
                }
                
                function updateButtonStates() {
                    const createButton = document.getElementById('createWorkspaceButton');
                    const createExternalButton = document.getElementById('createExternalWorkspaceButton');
                    const importButton = document.getElementById('importWorkspaceButton');
                    
                    // Hide all buttons first
                    createButton.classList.add('hidden');
                    createExternalButton.classList.add('hidden');
                    importButton.classList.add('hidden');
                    
                    // Show appropriate button based on selection
                    if (selectedWorkspaceType === 'standard') {
                        createButton.classList.remove('hidden');
                    } else if (selectedWorkspaceType === 'external' && selectedZephyrInstall) {
                        createExternalButton.classList.remove('hidden');
                    } else if (selectedImportSource) {
                        importButton.classList.remove('hidden');
                    }
                }
                
                function createWorkspace() {
                    if (selectedWorkspaceType === 'standard') {
                        vscode.postMessage({
                            command: 'createWorkspace',
                            type: 'standard'
                        });
                    }
                }
                
                function createExternalWorkspace() {
                    if (selectedWorkspaceType === 'external' && selectedZephyrInstall) {
                        vscode.postMessage({
                            command: 'createWorkspace',
                            type: 'external',
                            zephyrInstall: selectedZephyrInstall
                        });
                    }
                }
                
                function importWorkspace() {
                    if (selectedImportSource) {
                        vscode.postMessage({
                            command: 'importWorkspace',
                            source: selectedImportSource
                        });
                    }
                }
            </script>
        </body>
        </html>`;
    }
}
