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
import { installHostTools } from "../../setup_utilities/host_tools";
import * as os from "os";

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
            "Zephyr IDE Setup & Configuration",
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
            case "installHostTools":
                this.installHostTools();
                return;
            case "copyHostToolsCommands":
                this.copyHostToolsCommands(message.platform);
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
            } else if (source === "zephyr-ide-git") {
                vscode.commands.executeCommand("zephyr-ide.workspace-setup-from-git");
                vscode.window.showInformationMessage(
                    "Setting up Zephyr IDE workspace from Git..."
                );
            } else if (source === "west-git") {
                vscode.commands.executeCommand(
                    "zephyr-ide.workspace-setup-from-west-git"
                );
                vscode.window.showInformationMessage(
                    "Setting up West workspace from Git..."
                );
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

    private async copyHostToolsCommands(platform: string) {
        try {
            let commands = "";
            switch (platform) {
                case "windows":
                    commands = "winget install Kitware.CMake Ninja-build.Ninja oss-winget.gperf python Git.Git oss-winget.dtc wget 7zip.7zip; setx path '%path%;C:\\Program Files\\7-Zip'";
                    break;
                case "macos":
                    commands = "brew install cmake ninja gperf python3 python-tk ccache qemu dtc libmagic wget openocd";
                    break;
                case "linux":
                    commands = "sudo apt install --no-install-recommends git cmake ninja-build gperf ccache dfu-util device-tree-compiler wget python3-dev python3-venv python3-tk xz-utils file make gcc gcc-multilib g++-multilib libsdl2-dev libmagic1";
                    break;
            }
            await vscode.env.clipboard.writeText(commands);
            vscode.window.showInformationMessage("Host tools installation commands copied to clipboard");
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to copy commands: ${error}`);
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
            <title>Zephyr IDE Setup & Configuration</title>
            ${this.getStylesheetLinks()}
        </head>
        <body>
            <div class="wizard-container">
                <h1>Zephyr IDE Setup & Configuration</h1>
                ${this.generateHostToolsSection()}
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

    private generateHostToolsSection(): string {
        const actualPlatform = os.platform();
        const platform = actualPlatform; // This will be overridden by selector
        let platformName = "";
        let platformIcon = "";
        let description = "";
        let installCommand = "";
        let stepsContent = "";
        
        // Platform selector for preview
        const platformSelector = `
        <div style="margin-bottom: 15px; padding: 12px; border: 1px solid var(--vscode-panel-border); border-radius: 6px; background-color: var(--vscode-input-background);">
            <h4 style="margin: 0 0 8px 0; font-size: 12px; font-weight: 600;">Preview Platform (Development Only):</h4>
            <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                <button class="button-small ${actualPlatform === 'win32' ? 'active' : ''}" onclick="switchHostToolsPlatform('win32')" id="platform-win32">🪟 Windows</button>
                <button class="button-small ${actualPlatform === 'darwin' ? 'active' : ''}" onclick="switchHostToolsPlatform('darwin')" id="platform-darwin">🍎 macOS</button>
                <button class="button-small ${actualPlatform === 'linux' ? 'active' : ''}" onclick="switchHostToolsPlatform('linux')" id="platform-linux">🐧 Linux</button>
            </div>
            <p style="margin: 8px 0 0 0; font-size: 11px; color: var(--vscode-descriptionForeground);">Current actual platform: ${this.getPlatformDisplayName(actualPlatform)}</p>
        </div>`;

        switch (platform) {
            case "win32":
                platformName = "Windows";
                platformIcon = "🪟";
                description = "Install development tools using the winget package manager. Winget must be available on your system first.";
                installCommand = "winget install Kitware.CMake Ninja-build.Ninja oss-winget.gperf python Git.Git oss-winget.dtc wget 7zip.7zip; setx path '%path%;C:\\Program Files\\7-Zip'";
                stepsContent = `
                    <div class="installation-steps">
                        <h4 style="margin: 15px 0 10px 0; font-size: 13px; font-weight: 600;">Installation Steps:</h4>
                        <div class="step-item">
                            <div class="step-number">1</div>
                            <div class="step-content">
                                <div class="step-title">Verify Winget Installation</div>
                                <div class="step-desc">Ensure the winget package manager is installed. If unavailable, download it from <a href="https://aka.ms/getwinget" style="color: var(--vscode-textLink-foreground);">Microsoft Store</a></div>
                            </div>
                        </div>
                        <div class="step-item">
                            <div class="step-number">2</div>
                            <div class="step-content">
                                <div class="step-title">Install Development Tools</div>
                                <div class="step-desc">Install required development tools including CMake, Ninja, Python, Git, and other essential utilities using winget</div>
                            </div>
                        </div>
                        <div class="step-item">
                            <div class="step-number">3</div>
                            <div class="step-content">
                                <div class="step-title">Configure Environment</div>
                                <div class="step-desc">Update system PATH and environment variables. Restart VS Code to ensure all tools are properly configured</div>
                            </div>
                        </div>
                    </div>`;
                break;
            case "darwin":
                platformName = "macOS";
                platformIcon = "🍎";
                description = "Install development tools using the Homebrew package manager for macOS.";
                installCommand = "brew install cmake ninja gperf python3 python-tk ccache qemu dtc libmagic wget openocd";
                stepsContent = `
                    <div class="installation-steps">
                        <h4 style="margin: 15px 0 10px 0; font-size: 13px; font-weight: 600;">Installation Steps:</h4>
                        <div class="step-item">
                            <div class="step-number">1</div>
                            <div class="step-content">
                                <div class="step-title">Install Homebrew</div>
                                <div class="step-desc">Install the Homebrew package manager if not already available on your system</div>
                            </div>
                        </div>
                        <div class="step-item">
                            <div class="step-number">2</div>
                            <div class="step-content">
                                <div class="step-title">Configure Shell PATH</div>
                                <div class="step-desc">Update your shell profile to include Homebrew in the system PATH</div>
                            </div>
                        </div>
                        <div class="step-item">
                            <div class="step-number">3</div>
                            <div class="step-content">
                                <div class="step-title">Install Development Tools</div>
                                <div class="step-desc">Install essential development tools including CMake, Ninja, Python, and compilation toolchain using brew</div>
                            </div>
                        </div>
                        <div class="step-item">
                            <div class="step-number">4</div>
                            <div class="step-content">
                                <div class="step-title">Finalize Configuration</div>
                                <div class="step-desc">Ensure Python is in your PATH and restart VS Code to apply all environment changes</div>
                            </div>
                        </div>
                    </div>`;
                break;
            case "linux":
                platformName = "Linux";
                platformIcon = "🐧";
                description = "Install development tools using the apt package manager (Ubuntu/Debian).";
                installCommand = "sudo apt install --no-install-recommends git cmake ninja-build gperf ccache dfu-util device-tree-compiler wget python3-dev python3-venv python3-tk xz-utils file make gcc gcc-multilib g++-multilib libsdl2-dev libmagic1";
                stepsContent = `
                    <div class="installation-steps">
                        <h4 style="margin: 15px 0 10px 0; font-size: 13px; font-weight: 600;">Installation Steps:</h4>
                        <div class="step-item">
                            <div class="step-number">1</div>
                            <div class="step-content">
                                <div class="step-title">Install Development Tools</div>
                                <div class="step-desc">Install all required development tools and libraries using the apt package manager</div>
                            </div>
                        </div>
                        <div class="step-item">
                            <div class="step-number">2</div>
                            <div class="step-content">
                                <div class="step-title">Setup Complete</div>
                                <div class="step-desc">Once installation completes, Zephyr IDE will be ready for development</div>
                            </div>
                        </div>
                    </div>`;
                break;
            default:
                platformName = "Unknown";
                platformIcon = "💻";
                description = "Platform-specific host tools installation.";
                installCommand = "";
                stepsContent = "";
        }

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
                ${platformSelector}
                <div id="hostToolsStepsContent">
                    ${stepsContent}
                </div>
                <div style="padding: 15px; border: 1px solid var(--vscode-panel-border); border-radius: 6px; background-color: var(--vscode-input-background); margin: 15px 0;">
                    <h4 style="margin: 0 0 8px 0; font-size: 13px; font-weight: 600; display: flex; align-items: center; gap: 8px;">
                        <span style="font-size: 16px;">${platformIcon}</span>
                        ${platformName} Installation Command
                    </h4>
                    <code style="display: block; padding: 10px; background-color: var(--vscode-editor-background); border: 1px solid var(--vscode-panel-border); border-radius: 4px; font-family: monospace; font-size: 11px; word-wrap: break-word; white-space: pre-wrap;">${installCommand}</code>
                </div>
                <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                    <button class="button" onclick="runHostToolsInstall()">Run Automatic Install</button>
                    <button class="button button-secondary" onclick="copyHostToolsCommands('${platform === 'win32' ? 'windows' : platform === 'darwin' ? 'macos' : 'linux'}')">Copy Commands</button>
                </div>
            </div>
        </div>
        
        <style>
        .installation-steps {
            margin: 15px 0;
        }
        .step-item {
            display: flex;
            align-items: flex-start;
            gap: 12px;
            margin-bottom: 12px;
            padding: 12px;
            border: 1px solid var(--vscode-panel-border);
            border-radius: 6px;
            background-color: var(--vscode-editor-background);
        }
        .step-number {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border-radius: 50%;
            width: 24px;
            height: 24px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 12px;
            font-weight: 600;
            flex-shrink: 0;
        }
        .step-content {
            flex: 1;
        }
        .step-title {
            font-weight: 600;
            font-size: 12px;
            margin-bottom: 4px;
            color: var(--vscode-foreground);
        }
        .step-desc {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            line-height: 1.4;
        }
        .button-small {
            padding: 6px 12px;
            border: 1px solid var(--vscode-button-border);
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border-radius: 4px;
            font-size: 11px;
            cursor: pointer;
            transition: all 0.2s;
        }
        .button-small:hover {
            background-color: var(--vscode-button-secondaryHoverBackground);
        }
        .button-small.active {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border-color: var(--vscode-button-background);
        }
        </style>`;
    }

    private getPlatformDisplayName(platform: string): string {
        switch (platform) {
            case "win32": return "Windows";
            case "darwin": return "macOS";
            case "linux": return "Linux";
            default: return platform;
        }
    }

    private generateSDKSection(globalConfig: GlobalConfig): string {
        const sdkCollapsed = globalConfig.sdkInstalled;
        const statusClass = globalConfig.sdkInstalled ? "status-success" : "status-error";
        const statusText = globalConfig.sdkInstalled ? "✓ SDK Installed" : "✗ SDK Not Installed";
        const expandedClass = sdkCollapsed ? "" : "expanded";

        const description = globalConfig.sdkInstalled
            ? "The Zephyr SDK is installed and ready to use. You can manage additional SDK versions or update to the latest release."
            : "The Zephyr SDK provides cross-compilation toolchains and debugging tools needed to build and debug Zephyr applications for various target architectures. The SDK installation includes version management and integrates with your west installation.";

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
                    The Zephyr SDK provides essential cross-compilation toolchains for building Zephyr applications. Use the Install SDK command to download and configure the latest SDK with your preferred target architectures.
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
                    <div class="collapsible-title">West Environment Setup & Management</div>
                </div>
                <div class="collapsible-icon expanded" id="westOpsIcon">▶</div>
            </div>
            <div class="collapsible-content expanded" id="westOpsContent">
                <div class="step-description">
                    Set up and manage west workspace environments for Zephyr project development and dependency management.
                </div>
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 18px; margin-top: 15px;">
                    ${this.generateWestOperationCard("🌐", "Setup West Environment", "Create a Python virtual environment and install west tools required for Zephyr development.", "setupWestEnvironment()")}
                    ${this.generateWestOperationCard("🔧", "West Init", "Initialize a new west workspace with project manifests and source repositories.", "westInit()")}
                    ${this.generateWestOperationCard("🔄", "West Update", "Update workspace repositories and install Python dependencies for the current Zephyr version.", "westUpdate()")}
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
            return "Open a folder in VS Code to begin setting up your Zephyr development workspace.";
        } else if (workspaceInitialized) {
            return "Your workspace is ready for development. You can reinitialize if configuration changes are needed.";
        } else {
            return "Select how to configure your Zephyr workspace. A workspace organizes projects and manages development dependencies.";
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
            <p style="margin-bottom: 20px; color: var(--vscode-descriptionForeground); font-size: 12px;">Open a folder in VS Code to begin configuring your Zephyr development environment.</p>
            <button class="button" onclick="openFolder()">Open Folder</button>
        </div>`;
    }

    private generateInitializedContent(): string {
        return `
        <div style="text-align: center; padding: 30px;">
            <div style="font-size: 2em; margin-bottom: 15px;">✅</div>
            <p style="margin-bottom: 20px; color: var(--vscode-descriptionForeground); font-size: 12px;">Your Zephyr workspace is configured and ready for development!</p>
            <button class="button button-secondary" onclick="reinitializeWorkspace()">Reinitialize Workspace</button>
        </div>`;
    }

    private generateWorkspaceOptions(): string {
        return `
        <h4>Import Existing Workspace</h4>
        <div class="import-options">
            ${this.generateImportOptionCard("🌐", "Zephyr IDE Workspace from Git", "Clone and import a complete Zephyr IDE workspace from a Git repository with pre-configured project structure and settings.", "Team collaboration, shared development environments, and standardized project templates.", "zephyr-ide-git")}
            ${this.generateImportOptionCard("⚙️", "West Workspace from Git", "Clone a standard west manifest workspace from a Git repository using Zephyr's recommended workspace structure.", "Upstream Zephyr projects, community examples, and official sample applications.", "west-git")}
            ${this.generateImportOptionCard("📁", "Initialize Current Directory", "Configure the current VS Code workspace directory as a Zephyr IDE workspace, detecting existing projects and configurations.", "Local projects, downloaded samples, or existing Zephyr code directories.", "current-directory")}
        </div>
        
        <h4>Create New Workspace</h4>
        <div class="topology-options">
            ${this.generateCreateOptionCard("📦", "Standard Workspace", "Create a self-contained workspace with Zephyr installed locally within the workspace directory. Each workspace maintains its own Zephyr installation.", "Individual projects, isolated development, or when specific Zephyr versions are required per project.", "standard")}
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
                <h3>Workspace Using External Zephyr Installation</h3>
            </div>
            <p class="option-card-description">Create a workspace that references a shared Zephyr installation. Avoids duplicating Zephyr downloads across multiple projects and enables reuse of existing installations.</p>
            <p class="option-card-usage">Best for: Multiple projects, shared development environments, or reusing existing Zephyr installations.</p>
            
            <div class="external-options">
                ${this.generateExternalOption("🌍", "Global Installation", "Use system-wide global Zephyr installation", "global")}
                ${this.generateExternalOption("📁", "Create New Shared Installation", "Create a new shared installation in a custom directory", "create-new")}
                ${this.generateExternalOption("🔍", "Use Existing Installation", "Point to an existing folder containing a .west directory", "existing")}
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
