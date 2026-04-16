/*
Copyright 2026 mylonics 
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
import { notifyError, outputError } from "../../utilities/output";
import { generateNonce } from "../webview_shared/nonce";
import { onSetupProgress, getActiveSetupProgress } from "../../setup_utilities/setup-progress";
import { parseWestConfigManifestPath } from "../../setup_utilities/west-config-parser";
import { getVenvPath } from "../../setup_utilities/workspace-config";
import { setSetupState, setWorkspaceState } from "../../setup_utilities/state-management";
import type { WorkspacePanelData, ActivationBannerData, WorkspaceInfoData } from "./workspace-panel-data";

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

  private _htmlInitialized = false;

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

    if (!this._htmlInitialized) {
      this._panel.webview.html = this.getHtmlForWebview();
      this._htmlInitialized = true;
    }

    void this._panel.webview.postMessage({
      command: "updateContent",
      data: this.generatePanelData(wsConfig),
    });

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

  private handleWebviewMessage(message: Record<string, any>) {
    const vsCommand = this.commandPassthroughMap[message.command];
    if (vsCommand) {
      this.executeVSCommand(vsCommand, "Workspace Panel");
      return;
    }

    switch (message.command) {
      case "ready":
        if (this.currentWsConfig && this.currentGlobalConfig) {
          void this._panel.webview.postMessage({
            command: "updateContent",
            data: this.generatePanelData(this.currentWsConfig),
          });
          const target = this.getTargetSetupState();
          const workspaceInitialized = (this.currentWsConfig.initialSetupComplete || false) && target !== undefined;
          if (workspaceInitialized) {
            void this.loadWestYmlContent();
          }
          // Replay active progress if any
          const activeProgress = getActiveSetupProgress();
          if (activeProgress) {
            void this._panel.webview.postMessage({
              command: 'workspaceSetupProgress',
              data: activeProgress,
            });
          }
        }
        return;
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
      // Only mark as initialized if the workspace's setup state indicates it
      // has actually been set up (python env or west updated).
      const s = this.currentWsConfig.activeSetupState;
      if (s && (s.pythonEnvironmentSetup || s.westUpdated)) {
        this.currentWsConfig.initialSetupComplete = true;
      }
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
  // Data generation
  // ---------------------------------------------------------------------------

  private generatePanelData(wsConfig: WorkspaceConfig): WorkspacePanelData {
    const folderOpen = wsConfig.rootPath !== "";
    const target = this.getTargetSetupState();
    // For non-active workspaces, check the target's setup flags to determine
    // initialization. For the active workspace, use initialSetupComplete.
    const isViewingNonActive = this._setupPath !== undefined &&
      wsConfig.activeSetupState?.setupPath !== this._setupPath;
    let workspaceInitialized: boolean;
    if (isViewingNonActive && target) {
      const s = target.setupState;
      workspaceInitialized = !!(s.pythonEnvironmentSetup || s.westUpdated);
    } else {
      workspaceInitialized = (wsConfig.initialSetupComplete || false) && target !== undefined;
    }

    const state = (folderOpen && workspaceInitialized) ? "ready" : "setup-required";
    const statusIcon = workspaceInitialized ? '✓' : '⚙';
    const statusLabel = workspaceInitialized ? 'Initialized' : 'Setup Required';
    const statusClass = workspaceInitialized ? 'status-success' : 'status-warning';

    const isNonActive = this._setupPath !== undefined &&
      wsConfig.activeSetupState?.setupPath !== this._setupPath;

    let activationBanner: ActivationBannerData | undefined;
    if (isNonActive && this._setupPath) {
      activationBanner = {
        name: path.basename(this._setupPath),
        path: this._setupPath,
      };
    }

    let workspaceInfo: WorkspaceInfoData | undefined;
    if (folderOpen && workspaceInitialized && target) {
      const westYmlPath = this.getWestYmlPath() || "Not found";
      const venvPathStr = target.setupPath ? getVenvPath(target.setupPath) : "Not found";
      const zephyrVersion = target.setupState?.zephyrVersion
        ? formatZephyrVersion(target.setupState.zephyrVersion)
        : "Not available";

      workspaceInfo = {
        currentFolderPath: wsConfig.rootPath || "Not configured",
        westWorkspacePath: target.setupPath || "Not configured",
        westYmlPath,
        venvPath: venvPathStr,
        zephyrVersion,
      };
    }

    return {
      folderOpen,
      workspaceInitialized,
      state,
      statusIcon,
      statusLabel,
      statusClass,
      activationBanner,
      workspaceInfo,
      isNonActive,
    };
  }

  // ---------------------------------------------------------------------------
  // HTML Shell
  // ---------------------------------------------------------------------------

  private getHtmlForWebview(): string {
    const nonce = generateNonce();
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
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${this._panel.webview.cspSource}; font-src ${this._panel.webview.cspSource}; img-src ${this._panel.webview.cspSource} data:; script-src 'nonce-${nonce}';">
            <title>Workspace Setup</title>
            <link rel="stylesheet" type="text/css" href="${cssUri}">
            <link rel="stylesheet" type="text/css" href="${codiconUri}" id="vscode-codicon-stylesheet">
        </head>
        <body>
            <workspace-app></workspace-app>
            <script nonce="${nonce}" src="${jsUri}"></script>
        </body>
        </html>`;
  }
}
