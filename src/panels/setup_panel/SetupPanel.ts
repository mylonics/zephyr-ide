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
import { installHostTools } from "../../setup_utilities/host_tools";
import * as os from "os";

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
            case "installHostTools":
                this.installHostTools();
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

    // Host Tools Management Methods
    private async installHostTools() {
        try {
            if (!this.currentWsConfig) {
                vscode.window.showErrorMessage("Configuration not available");
                return;
            }
            await installHostTools(this._context, this.currentWsConfig);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to install host tools: ${error}`);
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
            <div class="wizard-container">
                <h1>Zephyr IDE Setup & Configuration</h1>
                ${this.generateHostToolsSection()}
                ${this.generateSDKSection(globalConfig)}
                ${this.generateWestOperationsSection()}
                ${this.generateWorkspaceSetupSection(
            folderOpen,
            workspaceInitialized
        )}
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
                "SetupPanel.css"
            )
        );
        return `<link rel="stylesheet" type="text/css" href="${cssUri}">`;
    }

    private getScriptTags(): string {
        const jsUri = this._panel.webview.asWebviewUri(
            vscode.Uri.joinPath(
                vscode.Uri.file(this._extensionPath),
                "src",
                "panels",
                "setup_panel",
                "SetupPanelHandler.js"
            )
        );
        return `<script src="${jsUri}"></script>`;
    }

    private getPlatformDisplayName(platform: string): string {
        switch (platform) {
            case "win32":
                return "Windows";
            case "darwin":
                return "macOS";
            case "linux":
                return "Linux";
            default:
                return platform;
        }
    }

    private getPlatformIcon(platform: string): string {
        switch (platform) {
            case "win32":
                return "🪟";
            case "darwin":
                return "🍎";
            case "linux":
                return "🐧";
            default:
                return "💻";
        }
    }

    private getPlatformDescription(platform: string): string {
        switch (platform) {
            case "win32":
                return "Install development tools using the winget package manager. Winget must be available on your system first.";
            case "darwin":
                return "Install development tools using the Homebrew package manager for macOS.";
            case "linux":
                return "Install development tools using the apt package manager (Ubuntu/Debian).";
            default:
                return "Platform-specific host tools installation.";
        }
    }

    private generateHostToolsSection(): string {
        const actualPlatform = os.platform();
        const platformName = this.getPlatformDisplayName(actualPlatform);
        const platformIcon = this.getPlatformIcon(actualPlatform);
        const description = this.getPlatformDescription(actualPlatform);

        // Platform selector for preview - HIDDEN
        // const platformSelector = `
        // <div style="margin-bottom: 15px; padding: 12px; border: 1px solid var(--vscode-panel-border); border-radius: 6px; background-color: var(--vscode-input-background);">
        //     <h4 style="margin: 0 0 8px 0; font-size: 12px; font-weight: 600;">Preview Platform (Development Only):</h4>
        //     <div style="display: flex; gap: 8px; flex-wrap: wrap;">
        //         <button class="button-small ${actualPlatform === "win32" ? "active" : ""
        //     }" onclick="switchHostToolsPlatform('win32')" id="platform-win32">🪟 Windows</button>
        //         <button class="button-small ${actualPlatform === "darwin" ? "active" : ""
        //     }" onclick="switchHostToolsPlatform('darwin')" id="platform-darwin">🍎 macOS</button>
        //         <button class="button-small ${actualPlatform === "linux" ? "active" : ""
        //     }" onclick="switchHostToolsPlatform('linux')" id="platform-linux">🐧 Linux</button>
        //     </div>
        //     <p style="margin: 8px 0 0 0; font-size: 11px; color: var(--vscode-descriptionForeground);">Current actual platform: ${platformName}</p>
        // </div>`;

        return `
        <div class="collapsible-section">
            <div class="collapsible-header" onclick="toggleSection('hostTools')">
                <div class="collapsible-header-left">
                    <div class="status status-warning">🔧 Host Tools</div>
                    <div class="collapsible-title">Development Tools Installation (${platformName})</div>
                </div>
                <div class="collapsible-icon expanded" id="hostToolsIcon">▶</div>
            </div>
            <div class="collapsible-content expanded" id="hostToolsContent">
                <div class="step-description">
                    Install essential development tools and dependencies required for building Zephyr applications on ${platformName}.
                </div>
                <p style="margin-bottom: 15px; color: var(--vscode-descriptionForeground); font-size: 12px;">
                    ${description}
                </p>
                <div id="hostToolsStepsContent">
                    <!-- Steps will be populated by JavaScript -->
                </div>
                <div style="display: flex; gap: 10px; flex-wrap: wrap; margin-top: 15px;">
                    <button class="button" onclick="runHostToolsInstall()">Run Automatic Install (Experimental)</button>
                </div>
                <p style="margin-top: 8px; font-size: 11px; color: var(--vscode-descriptionForeground); font-style: italic;">
                    Note: Automatic installation is experimental. Please report any issues to <a href="https://github.com/mylonics/zephyr-ide/issues" style="color: var(--vscode-textLink-foreground);">GitHub</a>.
                </p>
            </div>
        </div>`;
    }

    private generateSDKSection(globalConfig: GlobalConfig): string {
        const sdkCollapsed = globalConfig.sdkInstalled;
        const statusClass = globalConfig.sdkInstalled
            ? "status-success"
            : "status-error";
        const statusText = globalConfig.sdkInstalled
            ? "✓ SDK Installed"
            : "✗ SDK Not Installed";
        const expandedClass = sdkCollapsed ? "" : "expanded";

        const description = globalConfig.sdkInstalled
            ? "The Zephyr SDK is installed and ready to use. You can manage additional SDK versions or update to the latest release."
            : "The Zephyr SDK is required for building Zephyr applications. Install it to enable cross-compilation for supported architectures.";

        return `
        <div class="collapsible-section">
            <div class="collapsible-header" onclick="toggleSection('sdk')">
                <div class="collapsible-header-left">
                    <div class="status ${statusClass}">${statusText}</div>
                    <div class="collapsible-title">Zephyr SDK Management</div>
                </div>
                <div class="collapsible-icon ${expandedClass}" id="sdkIcon">▶</div>
            </div>
            <div class="collapsible-content ${expandedClass}" id="sdkContent">
                <div class="step-description">${description}</div>
                <div style="display: flex; gap: 15px; margin: 20px 0; flex-wrap: wrap;">
                    <button class="button" onclick="installSDK()">Install/Update SDK</button>
                    <button class="button button-secondary" onclick="listSDKs()">List Available SDKs</button>
                </div>
                <div id="sdkListContainer" style="margin-top: 20px;"></div>
            </div>
        </div>`;
    }

    private generateWestOperationsSection(): string {
        return `
        <div class="collapsible-section">
            <div class="collapsible-header" onclick="toggleSection('west')">
                <div class="collapsible-header-left">
                    <div class="status status-info">⚙️ West Operations</div>
                    <div class="collapsible-title">West Workspace Management</div>
                </div>
                <div class="collapsible-icon expanded" id="westIcon">▶</div>
            </div>
            <div class="collapsible-content expanded" id="westContent">
                <div class="step-description">
                    Set up and manage west workspace environments for Zephyr project development and dependency management.
                </div>
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 18px; margin-top: 15px;">
                    ${this.generateWestOperationCard(
            "🌐",
            "Setup West Environment",
            "Create a Python virtual environment and install west tools required for Zephyr development.",
            "setupWestEnvironment()"
        )}
                    ${this.generateWestOperationCard(
            "🔧",
            "West Init",
            "Initialize a new west workspace with project manifests and source repositories.",
            "westInit()"
        )}
                    ${this.generateWestOperationCard(
            "🔄",
            "West Update",
            "Update workspace repositories and install Python dependencies for the current Zephyr version.",
            "westUpdate()"
        )}
                    ${this.generateWestOperationCard(
            "🗂️",
            "Manage Workspace",
            "Manage and configure existing workspaces, switch between different workspace configurations.",
            "manageWorkspace()"
        )}
                    ${this.generateWestOperationCard(
            "⚙️",
            "West Configuration",
            "Configure west by detecting existing .west folders or west.yml files, or create a new west.yml from templates.",
            "westConfig()"
        )}
                </div>
            </div>
        </div>`;
    }

    private generateWestOperationCard(
        icon: string,
        title: string,
        description: string,
        onClick: string
    ): string {
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

    private generateWorkspaceSetupSection(
        folderOpen: boolean,
        workspaceInitialized: boolean
    ): string {
        if (!folderOpen) {
            // Keep as regular step when no folder is open
            const description = this.getWorkspaceDescription(
                folderOpen,
                workspaceInitialized
            );
            const content = this.getWorkspaceContent(
                folderOpen,
                workspaceInitialized
            );
            return `
            <div class="step">
                <div class="step-title">Workspace Setup</div>
                <div class="step-description">${description}</div>
                ${content}
            </div>`;
        }

        // Make it collapsible when folder is open
        const workspaceCollapsed = workspaceInitialized; // Collapse when initialized
        const statusClass = workspaceInitialized
            ? "status-success"
            : "status-warning";
        const statusText = workspaceInitialized
            ? "✅ Workspace Ready"
            : "⚙️ Workspace Setup";
        const expandedClass = workspaceCollapsed ? "" : "expanded";
        const description = this.getWorkspaceDescription(
            folderOpen,
            workspaceInitialized
        );
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

    private getWorkspaceDescription(
        folderOpen: boolean,
        workspaceInitialized: boolean
    ): string {
        if (!folderOpen) {
            return "Open a folder in VS Code to begin setting up your Zephyr development workspace.";
        } else if (workspaceInitialized) {
            return "Your workspace is ready for development. You can reinitialize if configuration changes are needed.";
        } else {
            return "Select how to configure your Zephyr workspace. A workspace organizes projects and manages development dependencies.";
        }
    }

    private getWorkspaceContent(
        folderOpen: boolean,
        workspaceInitialized: boolean
    ): string {
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
            <p style="margin-bottom: 20px; color: var(--vscode-descriptionForeground); font-size: 12px;">Open a folder in VS Code to begin configuring your Zephyr development environment.</p>
            <div style="display: flex; gap: 10px; justify-content: center; flex-wrap: wrap;">
                <button class="button" onclick="workspaceSetupPicker()">Workspace Setup</button>
                <button class="button button-secondary" onclick="westConfig()">West Config</button>
                <button class="button button-secondary" onclick="openFolder()">Open Folder</button>
            </div>
        </div>`;
    }

    private generateInitializedContent(): string {
        return `
        <div style="text-align: center; padding: 30px;">
            <div style="font-size: 2em; margin-bottom: 15px;">✅</div>
            <p style="margin-bottom: 20px; color: var(--vscode-descriptionForeground); font-size: 12px;">Your Zephyr workspace is configured and ready for development!</p>
            <div style="display: flex; gap: 10px; justify-content: center; flex-wrap: wrap;">
                <button class="button" onclick="manageWorkspace()">Manage Workspaces</button>
                <button class="button button-secondary" onclick="reinitializeWorkspace()">Reinitialize Workspace</button>
            </div>
        </div>`;
    }

    private generateWorkspaceOptionCard(
        icon: string,
        title: string,
        description: string,
        usage: string,
        action: string
    ): string {
        let clickHandler = "";
        if (action === "zephyr-ide-git") {
            clickHandler = "workspaceSetupFromGit()";
        } else if (action === "west-git") {
            clickHandler = "workspaceSetupFromWestGit()";
        } else if (action === "standard") {
            clickHandler = "workspaceSetupStandard()";
        } else if (action === "current-directory") {
            clickHandler = "workspaceSetupFromCurrentDirectory()";
        } else if (action === "west-config") {
            clickHandler = "westConfig()";
        }

        return `
        <div class="option-card" onclick="${clickHandler}">
            <div class="option-card-header">
                <div class="topology-icon">${icon}</div>
                <h3>${title}</h3>
            </div>
            <p class="option-card-description">${description}</p>
            <p class="option-card-usage">Best for: ${usage}</p>
        </div>`;
    }

    private generateWorkspaceOptions(): string {
        return `
        <h4>Workspace Setup Options</h4>
        <div class="workspace-options">
            ${this.generateWorkspaceOptionCard(
            "🌐",
            "Import Zephyr IDE Workspace from Git",
            "Clone and import a complete Zephyr IDE workspace or any repo with projects as subdirectories using Git.",
            "Team collaboration, and shared development environments.",
            "zephyr-ide-git"
        )}
            ${this.generateWorkspaceOptionCard(
            "⚙️",
            "Import West Workspace from Git",
            "Clone a standard west manifest repo (contains west.yml) from a Git repository using West Init.",
            "Upstream Zephyr projects, community examples, and official sample applications.",
            "west-git"
        )}
            ${this.generateWorkspaceOptionCard(
            "📦",
            "New Standard Workspace",
            "Create a self-contained workspace with Zephyr installed locally within the workspace directory. Each workspace maintains its own Zephyr installation.",
            "Team collaboration, individual projects, isolated development, or when specific Zephyr versions are required per project.",
            "standard"
        )}
            ${this.generateWorkspaceOptionCard(
            "📁",
            "Initialize Current Directory",
            "Set up the current VS Code workspace directory for Zephyr development, preserving any existing files and configurations. Process goes through aiding a user choose a zephyr install.",
            "Existing projects, downloaded samples, or when you want to add quickly run projects with an external install.",
            "current-directory"
        )}
        </div>`;
    }
}
