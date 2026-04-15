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
import { WorkspaceConfig, GlobalConfig, formatZephyrVersion } from "../../setup_utilities/types";
import { setGlobalState, clearSetupState } from "../../setup_utilities/state-management";
import { getToolsDir } from "../../setup_utilities/workspace-config";
import { handleReconfigureInstallation } from "../../setup_utilities/workspace-setup";
import { notifyError, outputError } from "../../utilities/output";
import { HostToolsCard, SDKCard, WorkspaceCard, WorkspaceSetupCard } from "./OverviewCards";
import { WorkspacePanel } from "../workspace_panel/WorkspacePanel";

export class SetupPanel {
  public static currentPanel: SetupPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionPath: string;
  private readonly _context: vscode.ExtensionContext;
  private _disposables: vscode.Disposable[] = [];

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
      "Zephyr IDE: Overview",
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

    this.updateContent(wsConfig, globalConfig);

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      (message) => { this.handleWebviewMessage(message); },
      null,
      this._disposables
    );
  }

  public updateContent(wsConfig: WorkspaceConfig, globalConfig: GlobalConfig) {
    this.currentWsConfig = wsConfig;
    this.currentGlobalConfig = globalConfig;
    this._panel.webview.html = this.getHtmlForWebview(wsConfig, globalConfig);
  }

  public dispose() {
    SetupPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) { x.dispose(); }
    }
  }

  // ---------------------------------------------------------------------------
  // Command passthrough map
  // ---------------------------------------------------------------------------

  private readonly commandPassthroughMap: Record<string, string> = {
    openHostToolsPanel: "zephyr-ide.open-host-tools-panel",
    openSDKPanel: "zephyr-ide.open-sdk-panel",
    openWorkspacePanel: "zephyr-ide.open-workspace-panel",
    openFolder: "vscode.openFolder",
    westUpdate: "zephyr-ide.west-update",
    manageWorkspace: "zephyr-ide.manage-workspaces",
    selectExistingWestWorkspace: "zephyr-ide.select-existing-west-workspace",
    openSettingsPanel: "zephyr-ide.open-settings-panel",
    openProjectBuildPanel: "zephyr-ide.open-project-build-panel",
  };

  private handleWebviewMessage(message: any) {
    const vsCommand = this.commandPassthroughMap[message.command];
    if (vsCommand) {
      this.executeVSCommand(vsCommand, "Setup Panel");
      return;
    }

    switch (message.command) {
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
        this.removeProject(message.name);
        return;
      case "openWorkspacePanelForPath":
        this.openWorkspacePanelForPath(message.path);
        return;
      case "deactivateWorkspace":
        this.deactivateWorkspace();
        return;
    }
  }

  private async executeVSCommand(command: string, label: string) {
    try {
      await vscode.commands.executeCommand(command);
    } catch (error) {
      notifyError(label, `Failed: ${error}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Workspace List Management
  // ---------------------------------------------------------------------------

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

  private async removeProject(projectName: string) {
    if (!this.currentWsConfig) {
      return;
    }
    try {
      const { removeProject } = await import("../../project_utilities/project.js");
      const result = await removeProject(this._context, this.currentWsConfig, projectName);
      if (result) {
        await vscode.commands.executeCommand("zephyr-ide.update-web-view");
      }
    } catch (error) {
      notifyError("Remove Project", `Failed: ${error}`);
    }
  }

  private async deactivateWorkspace() {
    if (!this.currentWsConfig || !this.currentGlobalConfig) {
      return;
    }
    try {
      await clearSetupState(this._context, this.currentWsConfig);
      void vscode.window.showInformationMessage('Active workspace deactivated');
      void vscode.commands.executeCommand('zephyr-ide.update-web-view');
    } catch (error) {
      notifyError('Deactivate Workspace', `Failed: ${error}`);
    }
  }

  private openWorkspacePanelForPath(installPath: string) {
    if (!this.currentWsConfig || !this.currentGlobalConfig) {
      return;
    }
    WorkspacePanel.createOrShow(
      this._extensionPath,
      this._context,
      this.currentWsConfig,
      this.currentGlobalConfig,
      installPath,
    );
  }

  // ---------------------------------------------------------------------------
  // HTML Generation
  // ---------------------------------------------------------------------------

  private hasValidSetupState(): boolean {
    return this.currentGlobalConfig?.setupStateDictionary !== undefined &&
      Object.keys(this.currentGlobalConfig.setupStateDictionary).length > 0;
  }

  private getHtmlForWebview(wsConfig: WorkspaceConfig, globalConfig: GlobalConfig): string {
    const folderOpen = wsConfig.rootPath !== "";
    const workspaceInitialized = (wsConfig.initialSetupComplete || false) &&
      (wsConfig.activeSetupState !== undefined);

    const cssUri = this._panel.webview.asWebviewUri(
      vscode.Uri.joinPath(vscode.Uri.file(this._extensionPath), "src", "panels", "setup_panel", "setup-panel.css")
    );
    const codiconUri = this._panel.webview.asWebviewUri(
      vscode.Uri.joinPath(vscode.Uri.file(this._extensionPath), "node_modules", "@vscode", "codicons", "dist", "codicon.css")
    );
    const jsUri = this._panel.webview.asWebviewUri(
      vscode.Uri.joinPath(vscode.Uri.file(this._extensionPath), "dist", "webview", "setup_panel", "setup-panel.js")
    );

    return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Zephyr IDE Setup & Configuration</title>
            <link rel="stylesheet" type="text/css" href="${cssUri}">
            <link rel="stylesheet" type="text/css" href="${codiconUri}" id="vscode-codicon-stylesheet">
        </head>
        <body>
            <div class="panel-container">
                ${this.generateOverviewSection(wsConfig, globalConfig, folderOpen, workspaceInitialized, this.hasValidSetupState())}
            </div>
            <script src="${jsUri}"></script>
        </body>
        </html>`;
  }

  private generateReadinessBanner(
    globalConfig: GlobalConfig,
    workspaceInitialized: boolean,
    hasValidSetupState: boolean
  ): string {
    const toolsReady = globalConfig.toolsAvailable ?? false;
    const sdkReady = globalConfig.sdkInstalled ?? false;

    const completedCount = [toolsReady, workspaceInitialized, sdkReady].filter(Boolean).length;

    if (completedCount === 3) {
      return `<div class="status-banner status-success">
                <span class="codicon codicon-check"></span>
                <span>Environment Ready — Host tools, workspace, and SDK are configured.</span>
              </div>`;
    }

    const remaining = 3 - completedCount;
    const parts: string[] = [];
    if (!toolsReady) { parts.push("set up Host Tools"); }
    if (!workspaceInitialized) { parts.push("select a Workspace"); }
    if (!sdkReady) { parts.push("install SDK"); }
    if (parts.length > 0) {
      parts[0] = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
    }

    return `<div class="status-banner status-warning">
              <span class="codicon codicon-warning"></span>
              <span>${remaining} of 3 step${remaining > 1 ? 's' : ''} remaining — ${parts.join(', ')} to start building.</span>
            </div>`;
  }

  private generateOverviewSection(
    wsConfig: WorkspaceConfig,
    globalConfig: GlobalConfig,
    folderOpen: boolean,
    workspaceInitialized: boolean,
    hasValidSetupState: boolean
  ): string {
    const toolsReady = globalConfig.toolsAvailable ?? false;
    const sdkReady = globalConfig.sdkInstalled ?? false;
    const westUpdated = wsConfig.activeSetupState?.westUpdated ?? false;
    const environmentReady = toolsReady && sdkReady && workspaceInitialized;

    const dict = globalConfig.setupStateDictionary;
    const hasWorkspaces = dict !== undefined && Object.keys(dict).length > 0;
    // When deactivated (initialSetupComplete still true) and workspaces exist,
    // promote the full list so the user can pick one to activate.
    // When reset (initialSetupComplete false), show just the single workspace at
    // the top since it needs to be set up, not just activated.
    const promoteWorkspaceList = !workspaceInitialized && hasWorkspaces && wsConfig.initialSetupComplete;

    // When any setup step is NOT ready, show setup cards prominently at top.
    const setupCardsAtTop = !environmentReady
      ? `<div class="setup-main-layout">${this.generateSetupSteps(globalConfig, hasValidSetupState, folderOpen, workspaceInitialized, promoteWorkspaceList)}</div>`
      : '';

    return `
        <div class="overview-section">
            <div class="walkthrough-header page-header">
                <div>
                    <h1 class="walkthrough-title page-title">Zephyr IDE Overview</h1>
                    <p class="walkthrough-subtitle page-subtitle">Your development environment at a glance</p>
                </div>
            </div>

            ${this.generateReadinessBanner(globalConfig, workspaceInitialized, hasValidSetupState)}

            ${setupCardsAtTop}

            ${this.generateActiveWorkspaceHero(wsConfig, globalConfig)}

            ${promoteWorkspaceList ? this.generateWorkspaceListSection(wsConfig, globalConfig, folderOpen, workspaceInitialized) : ''}

            ${this.generateProjectListSection(wsConfig)}

            <div class="quick-actions-section">
                <h3>Quick Actions</h3>
                <div class="quick-actions-grid">
                    <div class="quick-action-item" onclick="sendCommand('openHostToolsPanel')" role="button" tabindex="0" data-keyboard-command="true">
                        <span class="codicon codicon-tools"></span>
                        <div class="quick-action-content">
                            <strong>Host Tools</strong>
                            <span class="quick-action-status ${toolsReady ? 'status-success' : 'status-warning'}">${toolsReady ? 'Ready' : 'Setup Required'}</span>
                            <p>Install and verify build tools, compilers, and utilities for Zephyr development.</p>
                        </div>
                    </div>
                    ${sdkReady
        ? `<div class="quick-action-item" onclick="sendCommand('openSDKPanel')" role="button" tabindex="0" data-keyboard-command="true">
                            <span class="codicon codicon-package"></span>
                            <div class="quick-action-content">
                                <strong>Manage SDK &amp; Toolchains</strong>
                                <span class="quick-action-status status-success">Installed</span>
                                <p>View installed SDK toolchains and install additional target architectures.</p>
                            </div>
                        </div>`
        : `<div class="quick-action-item" onclick="sendCommand('openSDKPanel')" role="button" tabindex="0" data-keyboard-command="true">
                            <span class="codicon codicon-cloud-download"></span>
                            <div class="quick-action-content">
                                <strong>Install SDK</strong>
                                <span class="quick-action-status status-warning">Setup Required</span>
                                <p>Download and install Zephyr SDK toolchains for target architectures.</p>
                            </div>
                        </div>`}
                    <div class="quick-action-item" onclick="sendCommand('westUpdate')" role="button" tabindex="0" data-keyboard-command="true">
                        <span class="codicon codicon-sync"></span>
                        <div class="quick-action-content">
                            <strong>West Update</strong>
                            <span class="quick-action-status ${westUpdated ? 'status-success' : 'status-warning'}">${westUpdated ? 'Updated' : 'Not Updated'}</span>
                            <p>Fetch and update Zephyr modules and dependencies defined in the west manifest.</p>
                        </div>
                    </div>
                    <div class="quick-action-item" onclick="sendCommand('openSettingsPanel')" role="button" tabindex="0" data-keyboard-command="true">
                        <span class="codicon codicon-gear"></span>
                        <div class="quick-action-content">
                            <strong>Settings</strong>
                            <p>Configure global directory, toolchain paths, virtual environment, and extension behavior.</p>
                        </div>
                    </div>
                    <div class="quick-action-item" onclick="sendCommand('openProjectBuildPanel')" role="button" tabindex="0" data-keyboard-command="true">
                        <span class="codicon codicon-add"></span>
                        <div class="quick-action-content">
                            <strong>Add Project</strong>
                            <p>Create or configure a Zephyr project with build targets and settings.</p>
                        </div>
                    </div>
                </div>
            </div>

            ${promoteWorkspaceList ? '' : this.generateWorkspaceListSection(wsConfig, globalConfig, folderOpen, workspaceInitialized)}

            <div class="docs-links-row">
                <a href="https://zephyr-ide.mylonics.com" class="external-link">📖 Documentation</a>
                <a href="https://docs.zephyrproject.org/latest/develop/getting_started/index.html" class="external-link">🚀 Getting Started</a>
                <a href="https://docs.zephyrproject.org/latest/develop/west/index.html" class="external-link">🔧 West Docs</a>
                <a href="https://github.com/mylonics/zephyr-ide/issues" class="external-link">💬 Get Help</a>
            </div>
        </div>`;
  }

  private generateSetupSteps(
    globalConfig: GlobalConfig,
    hasValidSetupState: boolean,
    folderOpen: boolean,
    workspaceInitialized: boolean,
    skipWorkspaceCard: boolean
  ): string {
    const toolsReady = globalConfig.toolsAvailable ?? false;
    const sdkReady = globalConfig.sdkInstalled ?? false;

    // Assign step numbers dynamically to remaining (not-ready) items
    let stepNumber = 1;
    const hostToolsStep = toolsReady ? 0 : stepNumber++;
    const workspaceStep = (workspaceInitialized || skipWorkspaceCard) ? 0 : stepNumber++;
    const sdkStep = sdkReady ? 0 : stepNumber++;

    const hostToolsHtml = HostToolsCard.getHtml(globalConfig, hostToolsStep);
    const workspaceHtml = (workspaceInitialized || skipWorkspaceCard) ? '' : WorkspaceSetupCard.getHtml(folderOpen, workspaceStep);
    const sdkHtml = SDKCard.getHtml(globalConfig, hasValidSetupState, sdkStep);

    // If all are ready, render as inline pills only
    if (toolsReady && workspaceInitialized && sdkReady) {
      return `<div class="setup-status-pills">${hostToolsHtml}${sdkHtml}</div>`;
    }

    // Separate pills (ready items) from cards (items needing setup)
    const pills: string[] = [];
    const cards: string[] = [];

    if (toolsReady) { pills.push(hostToolsHtml); } else { cards.push(hostToolsHtml); }
    if (!workspaceInitialized && !skipWorkspaceCard) { cards.push(workspaceHtml); }
    if (sdkReady) { pills.push(sdkHtml); } else { cards.push(sdkHtml); }

    let html = '';
    if (pills.length > 0) {
      html += `<div class="setup-status-pills">${pills.join('')}</div>`;
    }
    if (cards.length > 0) {
      html += `<div class="overview-cards">${cards.join('')}</div>`;
    }
    return html;
  }

  private generateActiveWorkspaceHero(wsConfig: WorkspaceConfig, globalConfig: GlobalConfig): string {
    const activeState = wsConfig.activeSetupState;
    if (!activeState) {
      return '';
    }

    const baseName = path.basename(activeState.setupPath);
    const versionStr = activeState.zephyrVersion
      ? formatZephyrVersion(activeState.zephyrVersion)
      : '';

    const statusBadges: string[] = [];
    if (activeState.pythonEnvironmentSetup) {
      statusBadges.push('<span class="hero-status-badge status-success">venv</span>');
    }
    if (activeState.westUpdated) {
      statusBadges.push('<span class="hero-status-badge status-success">west</span>');
    }
    if (globalConfig.sdkInstalled) {
      statusBadges.push('<span class="hero-status-badge status-success">SDK</span>');
    }

    const escapedPath = activeState.setupPath.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

    return `
        <div class="active-workspace-hero" onclick="openWorkspacePanelForPath('${escapedPath}')" role="button" tabindex="0" aria-label="Active workspace" style="cursor:pointer">
            <div class="hero-info">
                <div class="hero-title-row">
                    <span class="codicon codicon-root-folder-opened"></span>
                    <h2 class="hero-workspace-name">${baseName}</h2>
                    <span class="workspace-active-badge">Active</span>
                </div>
                ${versionStr ? `<span class="hero-version">Zephyr ${versionStr}</span>` : ''}
                <span class="hero-path">${activeState.setupPath}</span>
                ${statusBadges.length > 0 ? `<div class="hero-status-badges">${statusBadges.join(' ')}</div>` : ''}
            </div>
            <div class="hero-actions">
                <vscode-button appearance="secondary" onclick="event.stopPropagation(); deactivateWorkspace()">Deactivate Workspace</vscode-button>
            </div>
        </div>`;
  }

  private generateWorkspaceListSection(
    wsConfig: WorkspaceConfig,
    globalConfig: GlobalConfig,
    folderOpen: boolean,
    workspaceInitialized: boolean
  ): string {
    const dict = globalConfig.setupStateDictionary;
    const hasWorkspaces = dict !== undefined && Object.keys(dict).length > 0;
    const sectionHeader = WorkspaceCard.getSectionHeaderHtml(wsConfig, folderOpen, workspaceInitialized, hasWorkspaces);

    if (!hasWorkspaces) {
      // Only show the setup empty state when the folder has no west workspace
      // (i.e. initialSetupComplete is false, meaning fresh or after Reset VS Code Workspace)
      if (!wsConfig.initialSetupComplete) {
        return `
            <div class="workspace-list-section">
                ${sectionHeader}
                <div class="empty-state">
                    <div class="empty-state-icon">📁</div>
                    <h3>No Workspaces Yet</h3>
                    <p>Set up a west workspace to get started with Zephyr development.</p>
                    <vscode-button onclick="sendCommand('openWorkspacePanel')">Set Up Workspace</vscode-button>
                </div>
            </div>`;
      }
      return '';
    }

    const toolsDir = getToolsDir();
    const activeSetupPath = wsConfig.activeSetupState?.setupPath;

    // Deduplicate paths that differ only by normalization (e.g. slash direction)
    const allPaths = Object.keys(dict);
    const seen = new Set<string>();
    const uniquePaths: string[] = [];
    for (const p of allPaths) {
      const normalized = path.normalize(p);
      if (!seen.has(normalized)) {
        seen.add(normalized);
        uniquePaths.push(p);
      }
    }

    let rows = '';
    for (const installPath of uniquePaths) {
      const setupState = dict[installPath];
      const isActive = installPath === activeSetupPath;
      const isGlobal = path.normalize(installPath) === path.normalize(toolsDir);

      // Use "Global" for the global tools directory, otherwise basename
      const baseName = isGlobal ? 'Global' : path.basename(installPath);

      let description = 'West installation';
      const versionStr = setupState.zephyrVersion
        ? formatZephyrVersion(setupState.zephyrVersion)
        : 'installation';
      if (isGlobal) {
        description = `Zephyr ${versionStr}`;
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

      const escapedPath = installPath.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

      rows += `
            <div class="workspace-list-row${isActive ? ' active' : ''}" onclick="openWorkspacePanelForPath('${escapedPath}')" role="button" tabindex="0" style="cursor:pointer">
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
                    <vscode-button appearance="icon" title="Remove from registry" onclick="event.stopPropagation(); deleteWorkspace('${escapedPath}', '${baseName}')">
                        <vscode-icon name="trash"></vscode-icon>
                    </vscode-button>
                </div>
            </div>`;
    }

    return `
        <div class="workspace-list-section">
            ${sectionHeader}
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
                <div class="empty-state">
                    <div class="empty-state-icon">🔨</div>
                    <h3>No Projects Yet</h3>
                    <p>Create a project to configure builds, flash targets, and debug settings.</p>
                    <vscode-button onclick="sendCommand('openProjectBuildPanel')">Create Project</vscode-button>
                </div>
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
}
