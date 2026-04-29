/*
Copyright 2025-2026 mylonics 
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
import { WorkspaceConfig, GlobalConfig, formatZephyrVersion, isActiveWorkspaceInitialized } from "../../setup_utilities/types";
import { setGlobalState, clearSetupState } from "../../setup_utilities/state-management";
import { handleReconfigureInstallation } from "../../setup_utilities/workspace-setup";
import { notifyError, outputError } from "../../utilities/output";
import { compareWorkspacePathsByLocality, isWorkspaceLocal, canonicalizePath } from "../../utilities/utils";
import { generateNonce } from "../webview_shared/nonce";
import { WorkspacePanel } from "../workspace_panel/WorkspacePanel";
import type { SetupPanelData, ActiveWorkspaceData, WorkspaceListItem, ProjectListItem } from "./setup-panel-data";

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

  private _htmlInitialized = false;
  private _lastPostedJson = "";

  public updateContent(wsConfig: WorkspaceConfig, globalConfig: GlobalConfig) {
    this.currentWsConfig = wsConfig;
    this.currentGlobalConfig = globalConfig;

    if (!this._htmlInitialized) {
      this._panel.webview.html = this.getHtmlForWebview();
      this._htmlInitialized = true;
    }

    const data = this.generatePanelData(wsConfig, globalConfig);
    const json = JSON.stringify(data);
    if (json === this._lastPostedJson) {
      return;
    }
    this._lastPostedJson = json;

    void this._panel.webview.postMessage({
      command: "updateContent",
      data,
    });
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
    // "New Workspace" on the overview should land on the Workspace Setup
    // page with its option grid, not dive straight into a west.yml picker.
    // That gives the user a chance to choose current-folder vs external,
    // git-clone vs standard, etc.
    createNewWestWorkspace: "zephyr-ide.open-workspace-panel",
  };

  private handleWebviewMessage(message: Record<string, any>) {
    const vsCommand = this.commandPassthroughMap[message.command];
    if (vsCommand) {
      this.executeVSCommand(vsCommand, "Setup Panel");
      return;
    }

    switch (message.command) {
      case "ready":
        if (this.currentWsConfig && this.currentGlobalConfig) {
          void this._panel.webview.postMessage({
            command: "updateContent",
            data: this.generatePanelData(this.currentWsConfig, this.currentGlobalConfig),
          });
        }
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
  // Data generation
  // ---------------------------------------------------------------------------

  private hasValidSetupState(): boolean {
    return this.currentGlobalConfig?.setupStateDictionary !== undefined &&
      Object.keys(this.currentGlobalConfig.setupStateDictionary).length > 0;
  }

  private generatePanelData(wsConfig: WorkspaceConfig, globalConfig: GlobalConfig): SetupPanelData {
    const folderOpen = wsConfig.rootPath !== "";
    const workspaceInitialized = isActiveWorkspaceInitialized(wsConfig);
    const hasValidSetupState = this.hasValidSetupState();

    const dict = globalConfig.setupStateDictionary;
    const hasWorkspaces = dict !== undefined && Object.keys(dict).length > 0;

    // Active workspace hero data
    let activeWorkspace: ActiveWorkspaceData | undefined;
    const activeState = wsConfig.activeSetupState;
    if (activeState) {
      activeWorkspace = {
        name: path.basename(activeState.setupPath),
        path: activeState.setupPath,
        version: activeState.zephyrVersion ? formatZephyrVersion(activeState.zephyrVersion) : "",
        hasPythonEnv: !!activeState.pythonEnvironmentSetup,
        hasWestUpdated: !!activeState.westUpdated,
        hasSdk: !!globalConfig.sdkInstalled,
        isInitialized: workspaceInitialized,
      };
    }

    // Workspace list
    const workspaces: WorkspaceListItem[] = [];
    if (dict && hasWorkspaces) {
      const activeSetupPath = wsConfig.activeSetupState?.setupPath;

      const allPaths = Object.keys(dict);
      const seen = new Set<string>();
      for (const p of allPaths) {
        const canonical = canonicalizePath(p);
        if (seen.has(canonical)) { continue; }
        seen.add(canonical);

        const setupState = dict[p];
        const isActive = p === activeSetupPath;

        const versionStr = setupState.zephyrVersion ? formatZephyrVersion(setupState.zephyrVersion) : "installation";
        let description = "West installation";
        if (wsConfig.rootPath && isWorkspaceLocal(wsConfig.rootPath, p)) {
          description = `Current Zephyr ${versionStr}`;
        } else if (setupState.zephyrVersion) {
          description = `Zephyr ${versionStr}`;
        }

        workspaces.push({
          path: p,
          name: path.basename(p),
          description,
          isActive,
          hasPythonEnv: !!setupState.pythonEnvironmentSetup,
          hasWestUpdated: !!setupState.westUpdated,
        });
      }

      // Sort so the workspace matching the currently open folder appears first
      const rootPath = wsConfig.rootPath;
      if (rootPath) {
        workspaces.sort((a, b) =>
          compareWorkspacePathsByLocality(rootPath, a.path, b.path)
        );
      }
    }

    // Project list
    const projects: ProjectListItem[] = [];
    const projectNames = Object.keys(wsConfig.projects);
    for (const name of projectNames) {
      const project = wsConfig.projects[name];
      projects.push({
        name,
        isActive: name === wsConfig.activeProject,
        buildCount: Object.keys(project.buildConfigs).length,
      });
    }

    return {
      folderOpen,
      workspaceInitialized,
      hasValidSetupState,
      toolsReady: globalConfig.toolsAvailable ?? false,
      sdkReady: globalConfig.sdkInstalled ?? false,
      westUpdated: wsConfig.activeSetupState?.westUpdated ?? false,
      initialSetupComplete: workspaceInitialized,
      hasWorkspaces,
      activeWorkspace,
      workspaces,
      projects,
      activeProject: wsConfig.activeProject,
    };
  }

  // ---------------------------------------------------------------------------
  // HTML Shell
  // ---------------------------------------------------------------------------

  private getHtmlForWebview(): string {
    const nonce = generateNonce();
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
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${this._panel.webview.cspSource}; font-src ${this._panel.webview.cspSource}; img-src ${this._panel.webview.cspSource} data:; script-src 'nonce-${nonce}';">
            <title>Zephyr IDE Setup & Configuration</title>
            <link rel="stylesheet" type="text/css" href="${cssUri}">
            <link rel="stylesheet" type="text/css" href="${codiconUri}" id="vscode-codicon-stylesheet">
        </head>
        <body>
            <setup-app></setup-app>
            <script nonce="${nonce}" src="${jsUri}"></script>
        </body>
        </html>`;
  }
}
