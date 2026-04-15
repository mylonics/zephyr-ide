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
import { notifyError, outputError } from "../../utilities/output";
import { onSetupProgress, getActiveSetupProgress } from "../../setup_utilities/setup-progress";
import { parseWestConfigManifestPath } from "../../setup_utilities/west-config-parser";
import { getVenvPath } from "../../setup_utilities/workspace-config";
import { setSetupState, setWorkspaceState } from "../../setup_utilities/state-management";

export class WorkspacePanel {
  /** All open panels, keyed by workspace path (or "__default__" when not specified). */
  private static _panels: Map<string, WorkspacePanel> = new Map();

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionPath: string;
  private readonly _context: vscode.ExtensionContext;
  private _disposables: vscode.Disposable[] = [];
  private readonly _setupPath?: string;

  private currentWsConfig?: WorkspaceConfig;
  private currentGlobalConfig?: GlobalConfig;

  /** For backward-compat: returns the first open panel, if any */
  public static get currentPanel(): WorkspacePanel | undefined {
    if (WorkspacePanel._panels.size === 0) { return undefined; }
    return WorkspacePanel._panels.values().next().value;
  }

  /** Update all open panels with new workspace config */
  public static updateAllPanels(wsConfig: WorkspaceConfig, globalConfig: GlobalConfig) {
    for (const panel of WorkspacePanel._panels.values()) {
      panel.updateContent(wsConfig, globalConfig);
    }
  }

  public static createOrShow(
    extensionPath: string,
    context: vscode.ExtensionContext,
    wsConfig: WorkspaceConfig,
    globalConfig: GlobalConfig,
    setupPath?: string,
  ) {
    const key = setupPath || "__default__";
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    const existing = WorkspacePanel._panels.get(key);
    if (existing) {
      existing._panel.reveal(column);
      existing.updateContent(wsConfig, globalConfig);
      return existing;
    }

    const baseName = setupPath ? path.basename(setupPath) : undefined;
    const title = baseName
      ? `Workspace: ${baseName}`
      : "Zephyr IDE: Workspace Config";

    const panel = vscode.window.createWebviewPanel(
      "zephyrIDEWorkspace",
      title,
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.file(extensionPath)],
      },
    );

    const instance = new WorkspacePanel(
      panel,
      extensionPath,
      context,
      wsConfig,
      globalConfig,
      setupPath,
    );
    WorkspacePanel._panels.set(key, instance);
    return instance;
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionPath: string,
    context: vscode.ExtensionContext,
    wsConfig: WorkspaceConfig,
    globalConfig: GlobalConfig,
    setupPath?: string,
  ) {
    this._panel = panel;
    this._extensionPath = extensionPath;
    this._context = context;
    this._setupPath = setupPath;

    this.updateContent(wsConfig, globalConfig);

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      (message) => { this.handleWebviewMessage(message); },
      null,
      this._disposables,
    );

    // Subscribe to workspace setup progress events and forward to webview
    this._disposables.push(
      onSetupProgress((event) => {
        this._panel.webview.postMessage({
          command: 'workspaceSetupProgress',
          data: event,
        });
      }),
    );

    // If a setup operation is already in progress, replay the latest snapshot
    const activeProgress = getActiveSetupProgress();
    if (activeProgress) {
      setTimeout(() => {
        this._panel.webview.postMessage({
          command: 'workspaceSetupProgress',
          data: activeProgress,
        });
      }, 100);
    }
  }

  /** Resolve the setup state this panel should display. */
  private getTargetSetupState(): { setupPath: string; setupState: any } | undefined {
    // If a specific path was requested, look it up in the dictionary
    if (this._setupPath && this.currentGlobalConfig?.setupStateDictionary?.[this._setupPath]) {
      return { setupPath: this._setupPath, setupState: this.currentGlobalConfig.setupStateDictionary[this._setupPath] };
    }
    // Fall back to active workspace
    if (this.currentWsConfig?.activeSetupState) {
      return { setupPath: this.currentWsConfig.activeSetupState.setupPath, setupState: this.currentWsConfig.activeSetupState };
    }
    return undefined;
  }

  public updateContent(wsConfig: WorkspaceConfig, globalConfig: GlobalConfig) {
    this.currentWsConfig = wsConfig;
    this.currentGlobalConfig = globalConfig;

    const target = this.getTargetSetupState();
    const workspaceInitialized = (wsConfig.initialSetupComplete || false) && target !== undefined;

    // Update panel title
    if (target) {
      const version = target.setupState.zephyrVersion
        ? formatZephyrVersion(target.setupState.zephyrVersion)
        : undefined;
      const baseName = path.basename(target.setupPath);
      this._panel.title = version
        ? `Workspace: ${baseName} (${version})`
        : `Workspace: ${baseName}`;
    } else {
      this._panel.title = "Workspace Setup";
    }

    this._panel.webview.html = this.getHtmlForWebview(wsConfig);

    // Load west.yml content asynchronously if workspace is initialized
    if (workspaceInitialized) {
      void this.loadWestYmlContent();
    }
  }

  public dispose() {
    for (const [key, panel] of WorkspacePanel._panels.entries()) {
      if (panel === this) {
        WorkspacePanel._panels.delete(key);
        break;
      }
    }
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
    openFolder: "vscode.openFolder",
    resetWorkspace: "zephyr-ide.reset-workspace",
    setupWestEnvironment: "zephyr-ide.setup-west-environment",
    westInit: "zephyr-ide.west-init",
    westUpdate: "zephyr-ide.west-update",
    westConfig: "zephyr-ide.west-config",
    workspaceSetupFromGit: "zephyr-ide.workspace-setup-from-git",
    workspaceSetupFromWestGit: "zephyr-ide.workspace-setup-from-west-git",
    workspaceSetupStandard: "zephyr-ide.workspace-setup-standard",
    workspaceSetupFromCurrentDirectory: "zephyr-ide.workspace-setup-from-current-directory",
    openSetupPanel: "zephyr-ide.open-setup-panel",
  };

  private handleWebviewMessage(message: any) {
    const vsCommand = this.commandPassthroughMap[message.command];
    if (vsCommand) {
      this.executeVSCommand(vsCommand, "Workspace Panel");
      return;
    }

    switch (message.command) {
      case "openWestYml":
        this.openWestYml();
        return;
      case "saveAndUpdateWestYml":
        this.saveAndUpdateWestYml(message.content);
        return;
      case "activateWorkspace":
        this.activateWorkspace(message.path);
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

  private async activateWorkspace(installPath: string) {
    if (!this.currentWsConfig || !this.currentGlobalConfig) {
      return;
    }
    try {
      await setSetupState(this._context, this.currentWsConfig, this.currentGlobalConfig, installPath);
      this.currentWsConfig.initialSetupComplete = true;
      await setWorkspaceState(this._context, this.currentWsConfig);
      await vscode.commands.executeCommand("zephyr-ide.update-web-view");
    } catch (error) {
      notifyError("Activate Workspace", `Failed: ${error}`);
    }
  }

  // ---------------------------------------------------------------------------
  // West.yml handling
  // ---------------------------------------------------------------------------

  private getWestYmlPath(): string | null {
    const target = this.getTargetSetupState();
    if (!target) {
      return null;
    }
    return parseWestConfigManifestPath(target.setupPath);
  }

  private async openWestYml() {
    try {
      const westYmlFilePath = this.getWestYmlPath();
      if (!westYmlFilePath) {
        const target = this.getTargetSetupState();
        const setupPath = target?.setupPath || "unknown";
        notifyError("West Config",
          `west.yml file not found.\n\n` +
          `Checked location based on .west/config in: ${setupPath}\n\n` +
          `Make sure west is initialized.`
        );
        return;
      }
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(westYmlFilePath));
      await vscode.window.showTextDocument(doc);
    } catch (error) {
      notifyError("West Config", `Failed to open west.yml: ${error}`);
    }
  }

  private async loadWestYmlContent() {
    try {
      const westYmlFilePath = this.getWestYmlPath();
      if (!westYmlFilePath) {
        const target = this.getTargetSetupState();
        const setupPath = target?.setupPath || "unknown";
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

      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(westYmlFilePath));
      this._panel.webview.postMessage({
        command: "westYmlContent",
        content: doc.getText(),
      });
    } catch (error) {
      outputError("Workspace Panel", `Error loading west.yml: ${String(error)}`);
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
      const encoder = new TextEncoder();
      await vscode.workspace.fs.writeFile(vscode.Uri.file(westYmlFilePath), encoder.encode(content));
      void vscode.window.showInformationMessage(`west.yml saved successfully to: ${westYmlFilePath}`);
      await vscode.commands.executeCommand("zephyr-ide.west-update");
    } catch (error) {
      notifyError("West Config", `Failed to save west.yml: ${error}`);
    }
  }

  // ---------------------------------------------------------------------------
  // HTML Generation
  // ---------------------------------------------------------------------------

  private getActivationBanner(): string {
    if (!this._setupPath) {
      return '';
    }
    const baseName = path.basename(this._setupPath);
    const escapedPath = this._setupPath.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    return `
        <div class="activation-banner" role="alert">
            <div class="activation-banner-content">
                <span class="codicon codicon-info"></span>
                <span>This workspace (<strong>${baseName}</strong>) is not currently active.</span>
            </div>
            <vscode-button onclick="activateWorkspace('${escapedPath}')">Activate This Workspace</vscode-button>
        </div>`;
  }

  private getHtmlForWebview(wsConfig: WorkspaceConfig): string {
    const folderOpen = wsConfig.rootPath !== "";
    const target = this.getTargetSetupState();
    const workspaceInitialized = (wsConfig.initialSetupComplete || false) && target !== undefined;

    const state = (folderOpen && workspaceInitialized) ? "ready" : "setup-required";

    const statusIcon = workspaceInitialized ? '✓' : '⚙';
    const statusLabel = workspaceInitialized ? 'Initialized' : 'Setup Required';
    const statusClass = workspaceInitialized ? 'status-success' : 'status-warning';

    // Show activation banner if this panel is showing a workspace that is not
    // currently active. This covers both: (a) another workspace is active, and
    // (b) no workspace is active (deactivated) but this one can be activated.
    const isNonActive = this._setupPath !== undefined &&
      wsConfig.activeSetupState?.setupPath !== this._setupPath;
    const activationBanner = isNonActive
      ? this.getActivationBanner()
      : '';

    const cssUri = this._panel.webview.asWebviewUri(
      vscode.Uri.joinPath(vscode.Uri.file(this._extensionPath), "src", "panels", "workspace_panel", "workspace-panel.css"),
    );
    const codiconUri = this._panel.webview.asWebviewUri(
      vscode.Uri.joinPath(vscode.Uri.file(this._extensionPath), "node_modules", "@vscode", "codicons", "dist", "codicon.css"),
    );
    const jsUri = this._panel.webview.asWebviewUri(
      vscode.Uri.joinPath(vscode.Uri.file(this._extensionPath), "dist", "webview", "workspace_panel", "workspace-panel.js"),
    );

    return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Workspace Setup</title>
            <link rel="stylesheet" type="text/css" href="${cssUri}">
            <link rel="stylesheet" type="text/css" href="${codiconUri}" id="vscode-codicon-stylesheet">
        </head>
        <body>
            <div class="container">
                <a class="breadcrumb-link" onclick="sendCommand('openSetupPanel')">← Overview</a>
                <div class="page-header">
                    <div style="display:flex;align-items:center;gap:12px;">
                        <h1 class="page-title">Workspace Setup</h1>
                        <span class="header-status-badge ${statusClass}">${statusIcon} ${statusLabel}</span>
                    </div>
                </div>

                ${activationBanner}

                <div class="ws-body" data-workspace-state="${state}">
                    ${this.getInitializingContainer()}
                    ${this.getReadyContainer(folderOpen, workspaceInitialized, wsConfig, isNonActive)}
                    ${this.getSetupRequiredContainer(folderOpen)}
                </div>
            </div>
            <script src="${jsUri}"></script>
        </body>
        </html>`;
  }

  private getInitializingContainer(): string {
    return `
            <div class="ws-state ws-state-initializing">
                <div class="status-banner status-info">
                    <vscode-progress-ring></vscode-progress-ring>
                    <span class="status-text">Initializing workspace\u2026</span>
                </div>
                <p class="description">Follow the prompts in the VS Code dialog to configure your workspace.</p>
                <div id="setupProgressContainer"></div>
            </div>`;
  }

  private getReadyContainer(folderOpen: boolean, workspaceInitialized: boolean, wsConfig: WorkspaceConfig, isNonActive: boolean): string {
    const content = (folderOpen && workspaceInitialized)
      ? this.getInitializedContent(wsConfig, isNonActive)
      : '';
    return `
            <div class="ws-state ws-state-ready">
                <div class="status-banner status-success">
                    <span class="codicon codicon-check"></span>
                    <span class="status-text">Workspace Ready</span>
                </div>
                ${content}
            </div>`;
  }

  private getSetupRequiredContainer(folderOpen: boolean): string {
    const content = folderOpen
      ? this.getSetupOptionsContent()
      : this.getNoFolderContent();
    const bannerClass = folderOpen ? 'status-warning' : 'status-info';
    const bannerIcon = folderOpen
      ? '<span class="codicon codicon-gear"></span>'
      : '<span class="codicon codicon-folder"></span>';
    const bannerText = folderOpen ? 'Setup Required' : 'No Folder Opened';

    return `
            <div class="ws-state ws-state-setup-required">
                <div class="status-banner ${bannerClass}">
                    ${bannerIcon}
                    <span class="status-text">${bannerText}</span>
                </div>
                ${content}
            </div>`;
  }

  private getNoFolderContent(): string {
    return `
        <p class="description">Open a folder in VS Code to set up your Zephyr workspace.</p>
        
        <div class="section-container centered">
            <div class="empty-state">
                <div class="empty-state-icon">📁</div>
                <h3>No Folder Open</h3>
                <p>A workspace folder is required for Zephyr development.</p>
            </div>
            
            <div class="button-group">
                <vscode-button onclick="sendCommand('openFolder')">
                    <vscode-icon slot="start-icon" name="folder-opened"></vscode-icon>
                    Open Folder
                </vscode-button>
            </div>
        </div>`;
  }

  private getInitializedContent(wsConfig: WorkspaceConfig, isNonActive: boolean): string {
    const target = this.getTargetSetupState();
    const activeSetupPath = target?.setupPath || "Not configured";
    const currentFolderPath = wsConfig.rootPath || "Not configured";
    const westYmlPath = this.getWestYmlPath() || "Not found";
    const venvPathStr = target?.setupPath
      ? getVenvPath(target.setupPath)
      : "Not found";
    const zephyrVersion = target?.setupState?.zephyrVersion
      ? formatZephyrVersion(target.setupState.zephyrVersion)
      : "Not available";

    const disabledAttr = isNonActive ? 'disabled' : '';
    const disabledNote = isNonActive
      ? '<p class="description muted">Activate this workspace to use these commands.</p>'
      : '';

    return `
        <p class="description">Workspace is configured and ready for development.</p>
        
        <div class="section-container">
            <h3>Workspace Information</h3>
            <div class="info-box">
                <p><strong>Current Folder:</strong> <code>${currentFolderPath}</code></p>
                <p><strong>West Workspace Path:</strong> <code>${activeSetupPath}</code></p>
                <p><strong>West.yml Location:</strong> <code>${westYmlPath}</code></p>
                <p><strong>Python .venv Location:</strong> <code>${venvPathStr}</code></p>
                <p><strong>Zephyr Version:</strong> <code>${zephyrVersion}</code></p>
            </div>
        </div>
        
        <div class="section-container">
            <h3>West Configuration</h3>
            <div class="west-yml-editor">
                <div class="editor-header">
                    <label for="westYmlEditor">west.yml</label>
                    <vscode-button appearance="secondary" onclick="openWestYml()">
                        <vscode-icon slot="start-icon" name="go-to-file"></vscode-icon>
                        Open in Editor
                    </vscode-button>
                </div>
                <textarea id="westYmlEditor" class="west-yml-textarea" rows="15" placeholder="Loading west.yml..."></textarea>
                <div class="editor-actions">
                    <vscode-button onclick="saveAndUpdateWestYml()" ${disabledAttr}>
                        <vscode-icon slot="start-icon" name="save"></vscode-icon>
                        Save and West Update
                    </vscode-button>
                    <vscode-button appearance="secondary" onclick="sendCommand('westUpdate')" ${disabledAttr}>
                        <vscode-icon slot="start-icon" name="sync"></vscode-icon>
                        West Update
                    </vscode-button>
                </div>
            </div>
        </div>
        
        ${!isNonActive ? `<div class="action-section">
            <h3>Workspace Management</h3>
            <div class="button-group">
                <vscode-button appearance="secondary" onclick="sendCommand('resetWorkspace')">
                    <vscode-icon slot="start-icon" name="refresh"></vscode-icon>
                    Reset VS Code Workspace
                </vscode-button>
            </div>
        </div>` : ''}
        
        <div class="action-section">
            <h3>Advanced Commands</h3>
            <p class="description">Low-level commands for advanced workspace management and troubleshooting.</p>
            ${disabledNote}
            <div class="button-group">
                <vscode-button appearance="secondary" onclick="sendCommand('westConfig')" ${disabledAttr}>
                    <vscode-icon slot="start-icon" name="settings"></vscode-icon>
                    West Config
                </vscode-button>
                <vscode-button appearance="secondary" onclick="sendCommand('westInit')" ${disabledAttr}>
                    <vscode-icon slot="start-icon" name="repo-create"></vscode-icon>
                    West Init
                </vscode-button>
            </div>
        </div>`;
  }

  private getSetupOptionsContent(): string {
    return `
        <p class="description">Select how to configure your workspace. Each option organizes projects and manages dependencies differently.</p>
        
        <div class="section-container">
            <h3>Initialize West Workspace</h3>
            <div class="workspace-options-grid">
                ${this.generateOptionCard(
      "🌐",
      "Import Zephyr IDE Workspace from Git",
      "Clone a complete workspace or repo with projects as subdirectories using Git.",
      "Team collaboration and shared environments",
      "sendWorkspaceSetup('workspaceSetupFromGit')"
    )}
                ${this.generateOptionCard(
      "⚙️",
      "Import West Workspace from Git",
      "Clone a west manifest repo (contains west.yml) using West Init.",
      "Upstream Zephyr projects and community examples",
      "sendWorkspaceSetup('workspaceSetupFromWestGit')"
    )}
                ${this.generateOptionCard(
      "📦",
      "New Standard Workspace",
      "Create a self-contained workspace with Zephyr installed locally.",
      "Individual projects or specific Zephyr versions",
      "sendWorkspaceSetup('workspaceSetupStandard')"
    )}
                ${this.generateOptionCard(
      "📁",
      "Initialize Current Directory",
      "Set up the current directory for Zephyr development, preserving existing files.",
      "Existing projects or external Zephyr installations",
      "sendWorkspaceSetup('workspaceSetupFromCurrentDirectory')"
    )}
            </div>
        </div>`;
  }

  private generateOptionCard(
    icon: string,
    title: string,
    description: string,
    usage: string,
    onClick: string,
  ): string {
    return `
        <div class="workspace-option-card" onclick="${onClick}" role="button" tabindex="0" data-keyboard-command="true" aria-label="${title}">
            <div class="option-header">
                <span class="option-icon">${icon}</span>
                <h4>${title}</h4>
            </div>
            <p class="option-description">${description}</p>
            <p class="option-usage"><em>Best for: ${usage}</em></p>
        </div>`;
  }
}
