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
import * as fs from "fs-extra";
import { WorkspaceConfig, GlobalConfig, formatZephyrVersion, isActiveWorkspaceInitialized, isWorkspaceInitialized } from "../../setup_utilities/types";
import { notifyError, outputError } from "../../utilities/output";
import { generateNonce } from "../webview_shared/nonce";
import { onSetupProgress, getActiveSetupProgress } from "../../setup_utilities/setup-progress";
import { parseWestConfigManifestPath } from "../../setup_utilities/west-config-parser";
import { getVenvPath } from "../../setup_utilities/workspace-config";
import { setSetupState, setWorkspaceState, setExternalSetupState } from "../../setup_utilities/state-management";
import {
  workspaceSetupFromWestGit,
  workspaceSetupStandard,
  workspaceSetupFromCurrentDirectory,
} from "../../setup_utilities/workspace-setup";
import type { WorkspacePanelData, ActivationBannerData, WorkspaceInfoData, WorkspaceReadiness, WorkspacePanelMode } from "./workspace-panel-data";

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

  /**
   * UI mode when no specific workspace is being shown (no `_setupPath`, no
   * active workspace). Drives the choice-screen → tile-screen flow.
   * - undefined → resolved by generatePanelData (workspace-view or choice).
   * - 'new-current' → user chose to create/adopt in the open folder.
   * - 'new-external' → user picked an external directory (_externalDir set).
   */
  private _uiMode?: 'new-current' | 'new-external';
  private _externalDir?: string;

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
    const workspaceInitialized = isActiveWorkspaceInitialized(wsConfig) && target !== undefined;

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
    deactivateWorkspace: "zephyr-ide.deactivate-workspace",
    rerunWestSetup: "zephyr-ide.rerun-west-setup",
    unregisterWorkspace: "zephyr-ide.unregister-workspace",
    setupWestEnvironment: "zephyr-ide.setup-west-environment",
    westInit: "zephyr-ide.west-init",
    westUpdate: "zephyr-ide.west-update",
    westConfig: "zephyr-ide.west-config",
    workspaceSetupFromGit: "zephyr-ide.workspace-setup-from-git",
    workspaceSetupFromWestGit: "zephyr-ide.workspace-setup-from-west-git",
    workspaceSetupStandard: "zephyr-ide.workspace-setup-standard",
    workspaceSetupFromCurrentDirectory: "zephyr-ide.workspace-setup-from-current-directory",
    workspaceSetupFromExternalDirectory: "zephyr-ide.workspace-setup-from-external-directory",
    openSetupPanel: "zephyr-ide.open-setup-panel",
    openProjectPanel: "zephyr-ide.open-project-build-panel",
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
          const workspaceInitialized = isActiveWorkspaceInitialized(this.currentWsConfig) && target !== undefined;
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
      case "chooseNewInCurrent":
        this._uiMode = 'new-current';
        this._externalDir = undefined;
        this._pushContentUpdate();
        return;
      case "chooseNewInExternal":
        void this._promptExternalDirectory();
        return;
      case "backToChoice":
        this._uiMode = undefined;
        this._externalDir = undefined;
        this._pushContentUpdate();
        return;
      case "activatePreexisting":
        void this._activatePreexisting();
        return;
      case "workspaceSetupFromWestGitExternal":
        void this._runExternal(async () => {
          if (!this.currentWsConfig || !this.currentGlobalConfig || !this._externalDir) { return; }
          await workspaceSetupFromWestGit(this._context, this.currentWsConfig, this.currentGlobalConfig, this._externalDir);
        });
        return;
      case "workspaceSetupStandardExternal":
        void this._runExternal(async () => {
          if (!this.currentWsConfig || !this.currentGlobalConfig || !this._externalDir) { return; }
          await workspaceSetupStandard(this._context, this.currentWsConfig, this.currentGlobalConfig, this._externalDir);
        });
        return;
      case "workspaceSetupFromDirectoryExternal":
        void this._runExternal(async () => {
          if (!this.currentWsConfig || !this.currentGlobalConfig || !this._externalDir) { return; }
          await workspaceSetupFromCurrentDirectory(this._context, this.currentWsConfig, this.currentGlobalConfig, false, this._externalDir);
        });
        return;
      case "markWorkspaceComplete": {
        // When an active setup state already exists (workspace-view-setup mode),
        // mark THAT workspace complete — not the VS Code open folder (rootPath).
        // In new-current mode there is no active state yet, so fall back to rootPath.
        const target = this.getTargetSetupState();
        void this._markWorkspaceComplete(target?.setupPath || this.currentWsConfig?.rootPath);
        return;
      }
      case "markWorkspaceCompleteExternal":
        void this._markWorkspaceComplete(this._externalDir);
        return;
    }
  }

  private _pushContentUpdate() {
    if (!this.currentWsConfig) { return; }
    void this._panel.webview.postMessage({
      command: "updateContent",
      data: this.generatePanelData(this.currentWsConfig),
    });
  }

  private async _promptExternalDirectory() {
    const folderUris = await vscode.window.showOpenDialog({
      openLabel: "Select External Workspace Directory",
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
    });
    if (!folderUris || folderUris.length === 0) { return; }
    this._externalDir = folderUris[0].fsPath;
    this._uiMode = 'new-external';
    this._pushContentUpdate();
  }

  private async _activatePreexisting() {
    if (!this.currentWsConfig || !this.currentGlobalConfig) { return; }
    const rootPath = this.currentWsConfig.rootPath;
    if (!rootPath) { return; }
    try {
      await setSetupState(this._context, this.currentWsConfig, this.currentGlobalConfig, rootPath);
      await setWorkspaceState(this._context, this.currentWsConfig);
      this._uiMode = undefined;
      await vscode.commands.executeCommand("zephyr-ide.update-web-view");
    } catch (error) {
      notifyError("Activate Workspace", `Failed: ${error}`);
    }
  }

  /**
   * Register a directory as an already-set-up workspace without running any
   * west/venv operations. Used by the "Mark as complete" tile.
   */
  private async _markWorkspaceComplete(installDir?: string) {
    if (!this.currentWsConfig || !this.currentGlobalConfig) { return; }
    if (!installDir) {
      notifyError("Mark as Complete", "No directory available to mark as complete.");
      return;
    }
    try {
      await setSetupState(this._context, this.currentWsConfig, this.currentGlobalConfig, installDir);
      if (this.currentWsConfig.activeSetupState) {
        this.currentWsConfig.activeSetupState.initialized = true;
        this.currentWsConfig.activeSetupState.pythonEnvironmentSetup = true;
        this.currentWsConfig.activeSetupState.westUpdated = true;
        await setExternalSetupState(
          this._context,
          this.currentGlobalConfig,
          this.currentWsConfig.activeSetupState.setupPath,
          this.currentWsConfig.activeSetupState,
        );
      }
      await setWorkspaceState(this._context, this.currentWsConfig);
      this._uiMode = undefined;
      this._externalDir = undefined;
      void vscode.window.showInformationMessage(`Workspace registered at: ${installDir}`);
      await vscode.commands.executeCommand("zephyr-ide.update-web-view");
    } catch (error) {
      notifyError("Mark as Complete", `Failed: ${error}`);
    }
  }

  /**
   * Run an external-tile action. After it finishes (regardless of success)
   * refresh the webview so the panel reflects any new active workspace /
   * setup state established by the underlying handler.
   */
  private async _runExternal(action: () => Promise<void>) {
    try {
      await action();
    } catch (error) {
      notifyError("Workspace Panel", `External setup failed: ${error}`);
    }
    // After external setup, active workspace should be set → panel switches
    // to workspace-view via generatePanelData.
    this._uiMode = undefined;
    this._externalDir = undefined;
    await vscode.commands.executeCommand("zephyr-ide.update-web-view");
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
    // `initialized` is a per-workspace marker on the SetupState itself; use it
    // uniformly whether we're viewing the active workspace or a registry entry.
    const isViewingNonActive = this._setupPath !== undefined &&
      wsConfig.activeSetupState?.setupPath !== this._setupPath;
    let workspaceInitialized: boolean;
    if (isViewingNonActive && target) {
      workspaceInitialized = isWorkspaceInitialized(target.setupState);
    } else {
      workspaceInitialized = isActiveWorkspaceInitialized(wsConfig) && target !== undefined;
    }

    // Readiness flags derived from the target's SetupState.
    const pythonEnvReady = !!target?.setupState?.pythonEnvironmentSetup;
    const westUpdated = !!target?.setupState?.westUpdated;

    // Tri-state composite surfaced to the header badge.
    let readiness: WorkspaceReadiness;
    if (!workspaceInitialized) {
      readiness = 'not-initialized';
    } else if (pythonEnvReady && westUpdated) {
      readiness = 'ready';
    } else {
      readiness = 'needs-setup';
    }

    const state = (folderOpen && workspaceInitialized) ? "ready" : "setup-required";
    // Header badge presentation follows readiness.
    const badgeMap: Record<WorkspaceReadiness, { icon: string; label: string; cls: string }> = {
      'not-initialized': { icon: '⚙', label: 'Not Initialized', cls: 'status-warning' },
      'needs-setup': { icon: '↻', label: 'Needs West Setup', cls: 'status-info' },
      'ready': { icon: '✓', label: 'Ready', cls: 'status-success' },
    };
    const { icon: statusIcon, label: statusLabel, cls: statusClass } = badgeMap[readiness];

    const isNonActive = isViewingNonActive;

    // Git-clone / "initialize current directory" / "new standard" setup flows
    // all operate on `wsConfig.rootPath` (the open VS Code folder). They only
    // make sense when the panel's target IS that folder.
    let targetIsCurrentFolder = false;
    if (!isNonActive && folderOpen) {
      if (!target) {
        targetIsCurrentFolder = true;
      } else {
        targetIsCurrentFolder = path.normalize(target.setupPath) === path.normalize(wsConfig.rootPath);
      }
    }

    // Detect whether the OPEN folder already has a workspace that should NOT
    // be re-initialized. Three signals:
    //   (a) a registered+initialized SetupState for rootPath in the dictionary;
    //   (b) the active setup is bound to rootPath AND initialized;
    //   (c) a `.west/` directory exists on disk at rootPath.
    // Any one → suppress the "initialize current folder" section.
    let currentFolderInitializedPath: string | undefined;
    if (folderOpen) {
      const rootNorm = path.normalize(wsConfig.rootPath);
      const dict = this.currentGlobalConfig?.setupStateDictionary;
      if (dict) {
        for (const p of Object.keys(dict)) {
          if (path.normalize(p) === rootNorm && dict[p]?.initialized) {
            currentFolderInitializedPath = p;
            break;
          }
        }
      }
      if (!currentFolderInitializedPath &&
        wsConfig.activeSetupState &&
        path.normalize(wsConfig.activeSetupState.setupPath) === rootNorm &&
        wsConfig.activeSetupState.initialized) {
        currentFolderInitializedPath = wsConfig.activeSetupState.setupPath;
      }
      if (!currentFolderInitializedPath) {
        try {
          if (fs.pathExistsSync(path.join(wsConfig.rootPath, ".west"))) {
            currentFolderInitializedPath = wsConfig.rootPath;
          }
        } catch {
          // ignore fs errors; leave flag unset
        }
      }
    }
    const currentFolderCanBeInitialized = folderOpen && !currentFolderInitializedPath;

    // Detect a `.west/` folder in the open folder that isn't yet in our
    // registry — surface as "activate preexisting" on the choice screen.
    let preexistingWorkspaceDetected = false;
    if (folderOpen) {
      try {
        preexistingWorkspaceDetected = fs.pathExistsSync(path.join(wsConfig.rootPath, ".west"));
      } catch {
        preexistingWorkspaceDetected = false;
      }
    }

    // Resolve top-level panel mode.
    // - If a specific setupPath was requested OR an active workspace exists →
    //   show workspace-view (existing behavior).
    // - Else, honor the user's in-panel choice (_uiMode) or fall back to
    //   'choice' screen.
    let panelMode: WorkspacePanelMode;
    if (this._setupPath || wsConfig.activeSetupState) {
      panelMode = 'workspace-view';
    } else if (this._uiMode === 'new-current') {
      panelMode = 'new-current';
    } else if (this._uiMode === 'new-external' && this._externalDir) {
      panelMode = 'new-external';
    } else {
      panelMode = 'choice';
    }

    // Resolve the directory this panel is currently targeting so it can be
    // shown in the header on every screen.
    let targetDirectory: string | undefined;
    if (panelMode === 'workspace-view') {
      // Prefer the resolved target setupPath; fall back to _setupPath (if this
      // panel was opened for a specific path not yet in the registry), then
      // rootPath as a last resort.
      targetDirectory = target?.setupPath || this._setupPath || wsConfig.rootPath || undefined;
    } else if (panelMode === 'new-external') {
      targetDirectory = this._externalDir;
    } else if (folderOpen) {
      // 'new-current' and 'choice' both target the open VS Code folder
      targetDirectory = wsConfig.rootPath || undefined;
    }

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
      panelMode,
      externalDirectoryPath: this._externalDir,
      targetDirectory,
      preexistingWorkspaceDetected,
      readiness,
      state,
      statusIcon,
      statusLabel,
      statusClass,
      activationBanner,
      workspaceInfo,
      isNonActive,
      targetIsCurrentFolder,
      currentFolderCanBeInitialized,
      currentFolderInitializedPath,
      pythonEnvReady,
      westUpdated,
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
