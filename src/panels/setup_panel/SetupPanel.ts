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
import * as path from "upath";
import * as fs from "fs";
import { WorkspaceConfig, GlobalConfig, formatZephyrVersion } from "../../setup_utilities/types";
import {
    getWestSDKContext,
    listAvailableSDKs,
    ParsedSDKList,
    onSDKProgress,
} from "../../setup_utilities/west_sdk";
import { saveSetupState, setGlobalState } from "../../setup_utilities/state-management";
import { getToolsDir } from "../../setup_utilities/workspace-config";
import { handleReconfigureInstallation } from "../../setup_utilities/workspace-setup";
import { parseWestConfigManifestPath } from "../../setup_utilities/west-config-parser";
import { notifyError, notifyWarning, outputError } from "../../utilities/output";
import { onSetupProgress, getActiveSetupProgress } from "../../setup_utilities/setup-progress";
import { HostToolsSubPage } from "./HostToolsSubPage";
import { SDKSubPage } from "./SDKSubPage";
import { WorkspaceSubPage } from "./WorkspaceSubPage";
import { HostToolsCard, SDKCard, WorkspaceCard } from "./OverviewCards";
import { HostToolsService, SETUP_PANEL_CONFIG } from "../hostToolsService";

export class SetupPanel {
    public static currentPanel: SetupPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionPath: string;
    private readonly _context: vscode.ExtensionContext;
    private _disposables: vscode.Disposable[] = [];
    private _hostToolsService: HostToolsService;

    // Store configs as instance variables to access them in methods
    private currentWsConfig?: WorkspaceConfig;
    private currentGlobalConfig?: GlobalConfig;

    /** Cached SDK list fetched in the background. */
    private _cachedSDKList?: ParsedSDKList;
    /** True while a background SDK list fetch is in flight. */
    private _sdkListFetching = false;

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
                retainContextWhenHidden: true,
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

        const config = { ...SETUP_PANEL_CONFIG };
        config.onMarkComplete = () => {
            if (this.currentWsConfig && this.currentGlobalConfig) {
                this.updateContent(this.currentWsConfig, this.currentGlobalConfig);
            }
        };
        this._hostToolsService = new HostToolsService(panel.webview, config);

        this.updateContent(wsConfig, globalConfig);

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.webview.onDidReceiveMessage(
            (message) => {
                this.handleWebviewMessage(message);
            },
            null,
            this._disposables
        );

        // Subscribe to workspace setup progress events and forward to webview
        this._disposables.push(
            onSetupProgress((event) => {
                this._panel.webview.postMessage({
                    command: 'workspaceSetupProgress',
                    data: event,
                });
            })
        );

        // Subscribe to SDK install progress events and forward to webview
        this._disposables.push(
            onSDKProgress((event) => {
                this._panel.webview.postMessage({
                    command: 'sdkInstallProgress',
                    data: event,
                });
            })
        );

        // If a setup operation is already in progress (panel opened mid-setup),
        // replay the latest snapshot so the webview updates internal state.
        // The webview will NOT force-navigate; it will apply the state when the
        // user navigates to the workspace page.
        const activeProgress = getActiveSetupProgress();
        if (activeProgress) {
            // Delay slightly so the webview script has loaded and is listening.
            setTimeout(() => {
                this._panel.webview.postMessage({
                    command: 'workspaceSetupProgress',
                    data: activeProgress,
                });
            }, 100);
        }

        // Pre-fetch SDK list in the background so it's ready when the user opens the SDK page.
        void this.fetchSDKListInBackground();
    }

    public updateContent(wsConfig: WorkspaceConfig, globalConfig: GlobalConfig, autoNavigateTo?: string) {
        this.currentWsConfig = wsConfig;
        this.currentGlobalConfig = globalConfig;
        this._panel.webview.html = this.getHtmlForWebview(wsConfig, globalConfig, autoNavigateTo);

        // Refresh SDK cache when config changes (e.g. workspace just set up)
        void this.fetchSDKListInBackground();
    }

    /**
     * Check if any valid west workspace has ever been initialized.
     * SDK installation is allowed as long as at least one workspace exists in setupStateDictionary.
     */
    private hasValidSetupState(): boolean {
        return this.currentGlobalConfig?.setupStateDictionary !== undefined &&
            Object.keys(this.currentGlobalConfig.setupStateDictionary).length > 0;
    }

    // Command passthrough map: webview message command → VS Code command ID
    private readonly commandPassthroughMap: Record<string, string> = {
        openHostToolsPanel: "zephyr-ide.install-host-tools",
        openFolder: "vscode.openFolder",
        reinitializeWorkspace: "zephyr-ide.reset-workspace",
        setupWestEnvironment: "zephyr-ide.setup-west-environment",
        westInit: "zephyr-ide.west-init",
        westUpdate: "zephyr-ide.west-update",
        manageWorkspace: "zephyr-ide.manage-workspaces",
        selectExistingWestWorkspace: "zephyr-ide.select-existing-west-workspace",
        workspaceSetupFromGit: "zephyr-ide.workspace-setup-from-git",
        workspaceSetupFromWestGit: "zephyr-ide.workspace-setup-from-west-git",
        workspaceSetupStandard: "zephyr-ide.workspace-setup-standard",
        workspaceSetupFromCurrentDirectory: "zephyr-ide.workspace-setup-from-current-directory",
        workspaceSetupPicker: "zephyr-ide.workspace-setup-picker",
        westConfig: "zephyr-ide.west-config",
        openSettingsPanel: "zephyr-ide.open-settings-panel",
        openProjectBuildPanel: "zephyr-ide.open-project-build-panel",
    };

    // Message Handler
    private handleWebviewMessage(message: any) {
        // VS Code command passthroughs
        const vsCommand = this.commandPassthroughMap[message.command];
        if (vsCommand) {
            this.executeVSCommand(vsCommand, "Setup Panel");
            return;
        }

        // Host tools commands (unified names)
        switch (message.command) {
            case "navigateToPage":
                this.navigateToPage(message.page);
                return;
            case "markToolsComplete":
                this._hostToolsService.markComplete(this._context, this.currentWsConfig, this.currentGlobalConfig);
                return;
            case "hostToolsCheckStatus":
                this._hostToolsService.checkStatus();
                return;
            case "hostToolsInstallPackageManager":
                this._hostToolsService.installPackageManager();
                return;
            case "hostToolsInstallPackage":
                this._hostToolsService.installSinglePackage(message.packageName);
                return;
            case "hostToolsInstallAllMissing":
                this._hostToolsService.installAllMissing();
                return;
            case "hostToolsInstallAllMissingPackages":
                this._hostToolsService.installAllMissingPackages(message.packageNames);
                return;
            case "hostToolsOpenManagerInstallUrl":
                this._hostToolsService.openManagerInstallUrl();
                return;
            case "installSDK":
                this.installSDK();
                return;
            case "listSDKs":
                this.listSDKs();
                return;
            case "openWestYml":
                this.openWestYml();
                return;
            case "saveAndUpdateWestYml":
                this.saveAndUpdateWestYml(message.content);
                return;
            case "deleteWorkspace":
                this.deleteWorkspace(message.path, message.name);
                return;
            case "reconfigureWorkspace":
                this.reconfigureWorkspace(message.path);
                return;
            case "updateWorkspace":
                this.updateWorkspace(message.path);
                return;
            case "setActiveProject":
                this.executeVSCommand("zephyr-ide.set-active-project", "Set Active Project");
                return;
            case "removeProject":
                this.executeVSCommand("zephyr-ide.remove-project", "Remove Project");
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
                // Send sub-page content first, then trigger async status check.
                // checkStatus involves real async I/O and will always post its result
                // after the webview has had time to render the sub-page HTML.
                this._panel.webview.postMessage({
                    command: "showSubPage",
                    content: subPageContent,
                    page: page
                });
                void this._hostToolsService.checkStatus();
                return;
            case "sdk":
                subPageContent = SDKSubPage.getHtml(this.currentGlobalConfig, this.hasValidSetupState());
                // Send sub-page content first, then push cached SDK list if available,
                // otherwise trigger a fresh fetch.
                this._panel.webview.postMessage({
                    command: "showSubPage",
                    content: subPageContent,
                    page: page
                });
                if (this._cachedSDKList) {
                    this._panel.webview.postMessage({
                        command: "sdkListResult",
                        data: this._cachedSDKList,
                    });
                } else if (this.hasValidSetupState()) {
                    // Show loading indicator and fetch
                    this._panel.webview.postMessage({
                        command: "sdkListLoading",
                    });
                    void this.listSDKs();
                }
                return;
            case "workspace":
                subPageContent = WorkspaceSubPage.getHtml(this.currentWsConfig);
                // Send sub-page content first, then load west.yml asynchronously.
                // The async file read will always complete after the webview has rendered.
                this._panel.webview.postMessage({
                    command: "showSubPage",
                    content: subPageContent,
                    page: page
                });
                if (this.currentWsConfig.initialSetupComplete) {
                    void this.loadWestYmlContent();
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

    /**
     * Execute a VS Code command with proper error handling.
     * @param command The command ID to execute
     * @param label Label for error notifications
     * @param disposeAfter If true, dispose the panel after the command completes
     */
    private async executeVSCommand(command: string, label: string, disposeAfter = false) {
        try {
            await vscode.commands.executeCommand(command);
            if (disposeAfter) {
                this._panel.dispose();
            }
        } catch (error) {
            notifyError(label, `Failed: ${error}`);
        }
    }

    // Workspace List Management Methods

    private async deleteWorkspace(installPath: string, installName: string) {
        if (!this.currentGlobalConfig || !this._context) {
            return;
        }

        const confirm = await vscode.window.showWarningMessage(
            `Are you sure you want to remove "${installName}" from the installation registry?\n\nPath: ${installPath}\n\nNote: This will only remove it from the registry, not delete the files.`,
            "Remove from Registry",
            "Cancel"
        );

        if (confirm !== "Remove from Registry") {
            return;
        }

        if (this.currentGlobalConfig.setupStateDictionary) {
            delete this.currentGlobalConfig.setupStateDictionary[installPath];
            await setGlobalState(this._context, this.currentGlobalConfig);

            // Refresh the panel to update the workspace list
            if (this.currentWsConfig) {
                this.updateContent(this.currentWsConfig, this.currentGlobalConfig);
            }
        }
    }

    private async reconfigureWorkspace(installPath: string) {
        try {
            if (!this.currentWsConfig || !this.currentGlobalConfig) {
                return;
            }
            await handleReconfigureInstallation(this._context, this.currentWsConfig, this.currentGlobalConfig, installPath);
            this.updateContent(this.currentWsConfig, this.currentGlobalConfig);
        } catch (error) {
            notifyError("Reconfigure", `Failed: ${error}`);
        }
    }

    private async updateWorkspace(installPath: string) {
        try {
            await vscode.commands.executeCommand("zephyr-ide.west-update");
        } catch (error) {
            notifyError("West Update", `Failed: ${error}`);
        }
    }

    // SDK and West Management Methods
    private async installSDK() {
        try {
            await vscode.commands.executeCommand("zephyr-ide.install-sdk");
            // Refresh the panel after SDK installation to update status
            if (this.currentWsConfig && this.currentGlobalConfig) {
                try {
                    // Invalidate cache so the next list fetch picks up new toolchains
                    this._cachedSDKList = undefined;
                    this.updateContent(this.currentWsConfig, this.currentGlobalConfig);
                    // Auto-refresh SDK list so the user sees newly installed toolchains
                    await this.listSDKs();
                } catch (updateError) {
                    outputError("Setup Panel", `Failed to refresh panel after SDK installation: ${String(updateError)}`);
                    // Don't show error to user as SDK installation was successful
                }
            }
        } catch (error) {
            notifyError("SDK Install", `Failed to install west SDK: ${error}`);
        }
    }

    /**
     * Fetch the SDK list in the background and cache it.
     * Does nothing if no valid setup state exists or a fetch is already in flight.
     */
    private async fetchSDKListInBackground() {
        if (this._sdkListFetching || !this.hasValidSetupState()) {
            return;
        }
        if (!this.currentWsConfig || !this.currentGlobalConfig) {
            return;
        }

        this._sdkListFetching = true;
        try {
            const setupState = await getWestSDKContext(
                this.currentWsConfig,
                this.currentGlobalConfig,
                this._context
            );
            if (!setupState) {
                return;
            }
            const sdkList = await listAvailableSDKs(setupState);
            this._cachedSDKList = sdkList;
        } catch {
            // Silently ignore background fetch failures — user can still manually refresh
        } finally {
            this._sdkListFetching = false;
        }
    }

    private async listSDKs() {
        try {
            if (!this.currentWsConfig || !this.currentGlobalConfig) {
                notifyError("SDK List", "Configuration not available");
                return;
            }

            const setupState = await getWestSDKContext(
                this.currentWsConfig,
                this.currentGlobalConfig,
                this._context
            );
            if (!setupState) {
                notifyError("SDK List",
                    "No valid west installation found for SDK management"
                );
                return;
            }

            const sdkList = await listAvailableSDKs(setupState);

            // Update the cache
            this._cachedSDKList = sdkList;

            // Send the parsed SDK list back to the webview
            this._panel.webview.postMessage({
                command: "sdkListResult",
                data: sdkList,
            });
        } catch (error) {
            notifyError("SDK List", `Failed to list SDKs: ${error}`);
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
        globalConfig: GlobalConfig,
        autoNavigateTo?: string
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
        <body${autoNavigateTo ? ` data-auto-navigate="${autoNavigateTo}"` : ''}>
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
            <link rel="stylesheet" type="text/css" href="${codiconUri}" id="vscode-codicon-stylesheet">
        `;
    }

    private getScriptTags(): string {
        const jsUri = this._panel.webview.asWebviewUri(
            vscode.Uri.joinPath(
                vscode.Uri.file(this._extensionPath),
                "dist",
                "webview",
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
        const westUpdated = wsConfig.activeSetupState?.westUpdated ?? false;

        return `
        <div class="overview-section">
            <div class="walkthrough-header page-header">
                <div>
                    <h1 class="walkthrough-title page-title">Zephyr IDE Setup & Configuration</h1>
                    <p class="walkthrough-subtitle page-subtitle">Configure your development environment</p>
                </div>
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
                    
                    <h3 class="walkthrough-docs-heading">Documentation & Help</h3>
                    <p>Learn more about using Zephyr IDE:</p>
                    <ul class="help-links">
                        <li><a href="https://github.com/mylonics/zephyr-ide/blob/main/README.md" class="external-link">📖 Extension Documentation</a></li>
                        <li><a href="https://docs.zephyrproject.org/latest/develop/getting_started/index.html" class="external-link">🚀 Zephyr Getting Started Guide</a></li>
                        <li><a href="https://docs.zephyrproject.org/latest/develop/west/index.html" class="external-link">🔧 West Tool Documentation</a></li>
                        <li><a href="https://github.com/mylonics/zephyr-ide/issues" class="external-link">💬 Report Issues or Get Help</a></li>
                    </ul>
                </div>
            </div>

            <div class="overview-lists-row">
                ${this.generateWorkspaceListSection(wsConfig, globalConfig)}
                ${this.generateProjectListSection(wsConfig)}
            </div>

            <div class="quick-actions-section">
                <h3>Quick Actions</h3>
                <div class="quick-actions-grid">
                    <div class="quick-action-item" onclick="sendCommand('westUpdate')" role="button" tabindex="0">
                        <span class="codicon codicon-sync"></span>
                        <div class="quick-action-content">
                            <strong>West Update</strong>
                            <span class="quick-action-status ${westUpdated ? 'status-success' : 'status-warning'}">${westUpdated ? 'Updated' : 'Not Updated'}</span>
                            <p>Fetch and update Zephyr modules and dependencies defined in the west manifest.</p>
                        </div>
                    </div>
                    <div class="quick-action-item" onclick="sendCommand('openSettingsPanel')" role="button" tabindex="0">
                        <span class="codicon codicon-gear"></span>
                        <div class="quick-action-content">
                            <strong>Settings</strong>
                            <p>Configure global directory, toolchain paths, virtual environment, and extension behavior.</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>`;
    }

    private generateWorkspaceListSection(wsConfig: WorkspaceConfig, globalConfig: GlobalConfig): string {
        const dict = globalConfig.setupStateDictionary;
        if (!dict || Object.keys(dict).length === 0) {
            return `
            <div class="workspace-list-section">
                <h3>West Workspaces</h3>
                <p class="workspace-list-empty">No west workspaces registered. Use the Workspace card above to set one up.</p>
            </div>`;
        }

        const toolsDir = getToolsDir();
        const activeSetupPath = wsConfig.activeSetupState?.setupPath;

        let rows = '';
        for (const installPath of Object.keys(dict)) {
            const setupState = dict[installPath];
            const isActive = installPath === activeSetupPath;
            const baseName = path.basename(installPath);

            let description = 'West installation';
            const versionStr = setupState.zephyrVersion
                ? formatZephyrVersion(setupState.zephyrVersion)
                : 'installation';
            if (installPath === toolsDir) {
                description = `Global Zephyr ${versionStr}`;
            } else if (installPath === wsConfig.rootPath) {
                description = `Current Zephyr ${versionStr}`;
            } else if (setupState.zephyrVersion) {
                description = `Zephyr ${versionStr}`;
            }

            const activeIndicator = isActive
                ? '<span class="workspace-active-badge">Active</span>'
                : '';

            const statusIcons: string[] = [];
            if (setupState.pythonEnvironmentSetup) {
                statusIcons.push('<span class="workspace-status-icon status-success" title="Python environment ready">venv</span>');
            }
            if (setupState.westUpdated) {
                statusIcons.push('<span class="workspace-status-icon status-success" title="West updated">west</span>');
            }

            // Escape the install path for use in onclick attributes
            const escapedPath = installPath.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

            rows += `
            <div class="workspace-list-row${isActive ? ' active' : ''}">
                <div class="workspace-list-info">
                    <div class="workspace-list-name">
                        <span class="codicon codicon-root-folder"></span>
                        <strong>${baseName}</strong>
                        ${activeIndicator}
                    </div>
                    <div class="workspace-list-detail">
                        <span class="workspace-list-description">${description}</span>
                        <span class="workspace-list-path">${installPath}</span>
                        ${statusIcons.length > 0 ? `<span class="workspace-list-statuses">${statusIcons.join(' ')}</span>` : ''}
                    </div>
                </div>
                <div class="workspace-list-actions">
                    <vscode-button appearance="icon" title="Reconfigure" onclick="reconfigureWorkspace('${escapedPath}')">
                        <vscode-icon name="settings-gear"></vscode-icon>
                    </vscode-button>
                    <vscode-button appearance="icon" title="West Update" onclick="updateWorkspace('${escapedPath}')">
                        <vscode-icon name="sync"></vscode-icon>
                    </vscode-button>
                    <vscode-button appearance="icon" title="Remove from registry" onclick="deleteWorkspace('${escapedPath}', '${baseName}')">
                        <vscode-icon name="trash"></vscode-icon>
                    </vscode-button>
                </div>
            </div>`;
        }

        return `
        <div class="workspace-list-section">
            <h3>West Workspaces</h3>
            <div class="overview-scroll-container">
                <div class="workspace-list-container">
                    ${rows}
                </div>
            </div>
        </div>`;
    }

    private generateProjectListSection(wsConfig: WorkspaceConfig): string {
        const projects = wsConfig.projects;
        const projectNames = Object.keys(projects);

        if (projectNames.length === 0) {
            return `
            <div class="project-list-section">
                <h3>Projects</h3>
                <p class="workspace-list-empty">No projects configured. Use the Project Build panel to create one.</p>
            </div>`;
        }

        const activeProject = wsConfig.activeProject;

        let rows = '';
        for (const name of projectNames) {
            const project = projects[name];
            const isActive = name === activeProject;
            const buildCount = Object.keys(project.buildConfigs).length;

            const activeIndicator = isActive
                ? '<span class="workspace-active-badge">Active</span>'
                : '';

            const buildLabel = buildCount > 0 ? `${buildCount} build${buildCount > 1 ? 's' : ''}` : '';

            const escapedName = name.replace(/'/g, "\\'");

            rows += `
            <div class="project-list-row${isActive ? ' active' : ''}" onclick="openProjectBuildPanel()" role="button" tabindex="0" style="cursor:pointer">
                <div class="workspace-list-info">
                    <div class="workspace-list-name">
                        <span class="codicon codicon-symbol-folder"></span>
                        <strong>${name}</strong>
                        ${activeIndicator}
                        ${buildLabel ? `<span class="project-build-count">${buildLabel}</span>` : ''}
                    </div>
                </div>
                <div class="workspace-list-actions">
                    <vscode-button appearance="icon" title="Set as active project" onclick="event.stopPropagation(); setActiveProject('${escapedName}')">
                        <vscode-icon name="check"></vscode-icon>
                    </vscode-button>
                    <vscode-button appearance="icon" title="Remove project" onclick="event.stopPropagation(); removeProject('${escapedName}')">
                        <vscode-icon name="trash"></vscode-icon>
                    </vscode-button>
                </div>
            </div>`;
        }

        return `
        <div class="project-list-section">
            <h3>Projects</h3>
            <div class="overview-scroll-container">
                <div class="workspace-list-container">
                    ${rows}
                </div>
            </div>
        </div>`;
    }

    private async openWestYml() {
        try {
            const westYmlFilePath = this.getWestYmlPath();

            if (!westYmlFilePath) {
                const setupPath = this.currentWsConfig?.activeSetupState?.setupPath || "unknown";
                notifyError("West Config",
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
            notifyError("West Config", `Failed to open west.yml: ${error}`);
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
            outputError("Setup Panel", `Error loading west.yml: ${String(error)}`);
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
                notifyError("West Config",
                    "west.yml file not found. Cannot save changes.\n\n" +
                    "Make sure west is initialized first."
                );
                return;
            }

            const westYmlPath = vscode.Uri.file(westYmlFilePath);

            // Write the content to the file
            const encoder = new TextEncoder();
            await vscode.workspace.fs.writeFile(westYmlPath, encoder.encode(content));

            void vscode.window.showInformationMessage(`west.yml saved successfully to: ${westYmlFilePath}`);

            // Run west update
            await vscode.commands.executeCommand("zephyr-ide.west-update");
        } catch (error) {
            notifyError("West Config", `Failed to save west.yml: ${error}`);
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
