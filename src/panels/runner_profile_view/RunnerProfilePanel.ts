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

import { WorkspaceConfig, GlobalConfig } from "../../setup_utilities/types";
import { generateNonce } from "../webview_shared/nonce";
import { notifyError } from "../../utilities/output";
import { getLaunchConfigurations } from "../../utilities/utils";
import { KNOWN_RUNNERS } from "../../project_utilities/runner_selector";
import {
  RunnerProfile,
  RunnerProfileScope,
  listRunnerProfilesByScope,
  saveRunnerProfile,
  deleteRunnerProfile,
  suggestProfileName,
  splitArgs,
} from "../../project_utilities/runner_profiles";
import { resolveActiveProjectBuild, setActiveProfile } from "../../project_utilities/project";

/**
 * Webview panel for managing Runner Profiles (the post-rework replacement for
 * per-build runner cards and standalone variants).
 *
 * The panel lists profiles grouped by scope (workspace and user) and lets
 * users create, rename, edit, and delete profiles. Edits are written through
 * the {@link saveRunnerProfile} / {@link deleteRunnerProfile} helpers, which
 * persist to either VS Code user settings (`zephyr-ide.runnerProfiles`) or
 * `.vscode/zephyr-ide.json#runnerProfiles`.
 */
export class RunnerProfilePanel {
  public static currentPanel: RunnerProfilePanel | undefined;

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionPath: string;
  private readonly _context: vscode.ExtensionContext;
  private _disposables: vscode.Disposable[] = [];
  private _wsConfig: WorkspaceConfig;
  private _globalConfig: GlobalConfig;
  private _htmlInitialized = false;

  /** Refresh the open panel after external state changes. */
  public static updateAllPanels(wsConfig: WorkspaceConfig, globalConfig: GlobalConfig) {
    if (RunnerProfilePanel.currentPanel) {
      RunnerProfilePanel.currentPanel.updateContent(wsConfig, globalConfig);
    }
  }

  public static createOrShow(
    extensionPath: string,
    context: vscode.ExtensionContext,
    wsConfig: WorkspaceConfig,
    globalConfig: GlobalConfig,
  ) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (RunnerProfilePanel.currentPanel) {
      RunnerProfilePanel.currentPanel._panel.reveal(column);
      RunnerProfilePanel.currentPanel.updateContent(wsConfig, globalConfig);
      return RunnerProfilePanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      "zephyrIDERunnerProfiles",
      "Zephyr IDE: Runner Profiles",
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.file(extensionPath)],
      },
    );

    RunnerProfilePanel.currentPanel = new RunnerProfilePanel(
      panel,
      extensionPath,
      context,
      wsConfig,
      globalConfig,
    );
    return RunnerProfilePanel.currentPanel;
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionPath: string,
    context: vscode.ExtensionContext,
    wsConfig: WorkspaceConfig,
    globalConfig: GlobalConfig,
  ) {
    this._panel = panel;
    this._extensionPath = extensionPath;
    this._context = context;
    this._wsConfig = wsConfig;
    this._globalConfig = globalConfig;

    // Register message handler BEFORE first updateContent / setting HTML so any
    // early `ready` message from the webview is not lost (see "webview init"
    // convention used by HostToolInstallView, WorkspacePanel, SetupPanel, SDKPanel).
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    this._panel.webview.onDidReceiveMessage(
      (message) => { void this.handleWebviewMessage(message); },
      null,
      this._disposables,
    );

    this.updateContent(wsConfig, globalConfig);
  }

  public updateContent(wsConfig: WorkspaceConfig, globalConfig: GlobalConfig) {
    this._wsConfig = wsConfig;
    this._globalConfig = globalConfig;

    if (!this._htmlInitialized) {
      this._panel.webview.html = this.getHtmlForWebview();
      this._htmlInitialized = true;
    }
    void this.pushState();
  }

  public dispose() {
    RunnerProfilePanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) { x.dispose(); }
    }
  }

  // ---------------------------------------------------------------------------
  // Message handling
  // ---------------------------------------------------------------------------

  private async handleWebviewMessage(message: Record<string, any>) {
    switch (message.command) {
      case "ready":
        await this.pushState();
        return;

      case "createProfile":
        await this.handleCreateProfile(message);
        return;

      case "saveProfile":
        await this.handleSaveProfile(message);
        return;

      case "deleteProfile":
        await this.handleDeleteProfile(message);
        return;

      case "duplicateProfile":
        await this.handleDuplicateProfile(message);
        return;

      case "setActiveProfile":
        await this.handleSetActiveProfile(message);
        return;
    }
  }

  private async handleSetActiveProfile(message: Record<string, any>) {
    // `name` may be a profile name (set), null (clear), or omitted (open picker).
    const hasName = Object.prototype.hasOwnProperty.call(message, "name");
    if (!hasName) {
      await vscode.commands.executeCommand("zephyr-ide.set-active-profile");
      await this.pushState();
      return;
    }
    const raw = message.name;
    const presetName: string | null = raw === null ? null : (typeof raw === "string" ? raw : null);
    await setActiveProfile(this._context, this._wsConfig, presetName);
    await this.pushState();
  }

  private async handleCreateProfile(message: Record<string, any>) {
    const scope = parseScope(message.scope);
    if (!scope) { return; }
    if (scope === "workspace" && !this._wsConfig.rootPath) {
      notifyError("Runner Profile", "Open a workspace folder to add workspace-scoped profiles.");
      return;
    }
    const baseName = typeof message.baseName === "string" && message.baseName.trim()
      ? message.baseName.trim()
      : "Profile";
    const name = suggestProfileName(this._wsConfig, baseName);
    const profile: RunnerProfile = {
      name,
      flash: { kind: "auto" },
      debug: { kind: "auto" },
      attach: { kind: "auto" },
    };
    try {
      await saveRunnerProfile(this._wsConfig, scope, profile);
    } catch (e) {
      notifyError("Runner Profile", `Failed to create profile: ${String(e)}`);
    }
    await this.pushState();
  }

  private async handleSaveProfile(message: Record<string, any>) {
    const scope = parseScope(message.scope);
    if (!scope) { return; }
    const profile = sanitizeIncomingProfile(message.profile);
    if (!profile) {
      notifyError("Runner Profile", "Profile payload missing or invalid.");
      return;
    }
    const originalName = typeof message.originalName === "string" ? message.originalName.trim() : profile.name;
    if (!profile.name.trim()) {
      notifyError("Runner Profile", "Profile name cannot be empty.");
      await this.pushState();
      return;
    }
    // Reject name collisions (other scope is ok — workspace overrides user
    // on merge — but within the same scope two entries collide).
    const existing = listRunnerProfilesByScope(this._wsConfig);
    const list = scope === "user" ? existing.user : existing.workspace;
    if (profile.name !== originalName && list.some(p => p.name === profile.name)) {
      notifyError("Runner Profile", `A profile named "${profile.name}" already exists in this scope.`);
      await this.pushState();
      return;
    }
    try {
      await saveRunnerProfile(this._wsConfig, scope, profile, originalName);
    } catch (e) {
      notifyError("Runner Profile", `Failed to save profile: ${String(e)}`);
    }
    await this.pushState();
  }

  private async handleDeleteProfile(message: Record<string, any>) {
    const scope = parseScope(message.scope);
    if (!scope) { return; }
    const name = typeof message.name === "string" ? message.name : "";
    if (!name) { return; }

    // Find builds that currently reference this profile name so the user
    // sees the consequence of deleting it.
    const affected: string[] = [];
    for (const projectName in this._wsConfig.projects ?? {}) {
      const project = this._wsConfig.projects[projectName];
      for (const buildName in project.buildConfigs ?? {}) {
        if (project.buildConfigs[buildName].activeProfile === name) {
          affected.push(`${projectName} / ${buildName}`);
        }
      }
    }
    const detail = affected.length > 0
      ? `These builds will fall back to runners.yaml defaults:\n  - ${affected.join("\n  - ")}`
      : undefined;
    const answer = await vscode.window.showWarningMessage(
      `Delete Runner Profile "${name}" from ${scope} scope?`,
      { modal: true, detail },
      "Delete",
    );
    if (answer !== "Delete") { return; }
    try {
      await deleteRunnerProfile(this._wsConfig, scope, name);
    } catch (e) {
      notifyError("Runner Profile", `Failed to delete profile: ${String(e)}`);
    }
    await this.pushState();
  }

  /**
   * Duplicate an existing profile in-place. Copies the source profile's bind
   * slots into a new profile with an auto-suggested unique name. Useful when
   * the user wants to fork a slight variant (e.g. different `extraArgs`)
   * without re-entering every bind by hand.
   */
  private async handleDuplicateProfile(message: Record<string, any>) {
    const scope = parseScope(message.scope);
    if (!scope) { return; }
    if (scope === "workspace" && !this._wsConfig.rootPath) {
      notifyError("Runner Profile", "Open a workspace folder to duplicate workspace-scoped profiles.");
      return;
    }
    const sourceName = typeof message.name === "string" ? message.name.trim() : "";
    if (!sourceName) { return; }
    const existing = listRunnerProfilesByScope(this._wsConfig);
    const list = scope === "user" ? existing.user : existing.workspace;
    const source = list.find(p => p.name === sourceName);
    if (!source) {
      notifyError("Runner Profile", `Source profile not found in ${scope} scope: "${sourceName}"`);
      return;
    }
    const newName = suggestProfileName(this._wsConfig, `${source.name} copy`);
    const profile: RunnerProfile = {
      name: newName,
      flash: cloneBind(source.flash),
      debug: cloneBind(source.debug),
      attach: cloneBind(source.attach),
    };
    if (source.buildDebug) {
      profile.buildDebug = cloneBind(source.buildDebug);
    }
    try {
      await saveRunnerProfile(this._wsConfig, scope, profile);
    } catch (e) {
      notifyError("Runner Profile", `Failed to duplicate profile: ${String(e)}`);
    }
    await this.pushState();
  }

  // ---------------------------------------------------------------------------
  // State pushing
  // ---------------------------------------------------------------------------

  private async pushState() {
    const { user, workspace } = listRunnerProfilesByScope(this._wsConfig);
    const launchConfigs = await getLaunchConfigurations(this._wsConfig);
    const launchConfigNames = (launchConfigs ?? [])
      .map(c => c?.name)
      .filter((n): n is string => typeof n === "string" && n.length > 0);

    const resolved = resolveActiveProjectBuild(this._wsConfig);
    const activeProfileName = resolved?.build.activeProfile;
    const activeBuildLabel = resolved
      ? `${resolved.project.name} / ${resolved.build.name}`
      : undefined;

    // Count builds that reference each profile name (workspace-wide).
    // Useful for showing usage and warning users before deleting a profile.
    const usageByName: Record<string, string[]> = {};
    for (const projectName in this._wsConfig.projects ?? {}) {
      const project = this._wsConfig.projects[projectName];
      for (const buildName in project.buildConfigs ?? {}) {
        const name = project.buildConfigs[buildName].activeProfile;
        if (!name) { continue; }
        const label = `${projectName} / ${buildName}`;
        (usageByName[name] ??= []).push(label);
      }
    }

    const separateBuildDebugProfile = !!vscode.workspace.getConfiguration().get<boolean>("zephyr-ide.separateBuildDebugProfile");

    this._panel.webview.postMessage({
      command: "updateContent",
      data: {
        userProfiles: user,
        workspaceProfiles: workspace,
        hasWorkspace: !!this._wsConfig.rootPath,
        knownRunners: KNOWN_RUNNERS.slice(),
        launchConfigNames,
        activeProfileName,
        activeBuildLabel,
        usageByName,
        separateBuildDebugProfile,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // HTML
  // ---------------------------------------------------------------------------

  private getHtmlForWebview(): string {
    const nonce = generateNonce();
    const cssUri = this._panel.webview.asWebviewUri(
      vscode.Uri.joinPath(vscode.Uri.file(this._extensionPath), "src", "panels", "runner_profile_view", "runner-profile-panel.css"),
    );
    const codiconUri = this._panel.webview.asWebviewUri(
      vscode.Uri.joinPath(vscode.Uri.file(this._extensionPath), "node_modules", "@vscode", "codicons", "dist", "codicon.css"),
    );
    const jsUri = this._panel.webview.asWebviewUri(
      vscode.Uri.joinPath(vscode.Uri.file(this._extensionPath), "dist", "webview", "runner_profile_view", "runner-profile-panel.js"),
    );

    return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${this._panel.webview.cspSource}; font-src ${this._panel.webview.cspSource}; img-src ${this._panel.webview.cspSource} data:; script-src 'nonce-${nonce}';">
            <title>Zephyr IDE: Runner Profiles</title>
            <link rel="stylesheet" type="text/css" href="${cssUri}">
            <link rel="stylesheet" type="text/css" href="${codiconUri}" id="vscode-codicon-stylesheet">
        </head>
        <body>
            <runner-profile-app></runner-profile-app>
            <script nonce="${nonce}" src="${jsUri}"></script>
        </body>
        </html>`;
  }
}

// ---------------------------------------------------------------------------
// Inbound payload sanitisation
// ---------------------------------------------------------------------------

function parseScope(value: unknown): RunnerProfileScope | undefined {
  if (value === "user" || value === "workspace") { return value; }
  return undefined;
}

function sanitizeIncomingBind(value: unknown, slot: "flash" | "buildDebug" | "debug" | "attach"):
  RunnerProfile["flash"] {
  if (!value || typeof value !== "object") { return { kind: "auto" }; }
  const v = value as Record<string, unknown>;
  if (v.kind === "auto") { return { kind: "auto" }; }
  if (v.kind === "runner" && typeof v.runner === "string" && v.runner.trim()) {
    const out: RunnerProfile["flash"] = { kind: "runner", runner: v.runner.trim() };
    const extra: string[] = Array.isArray(v.extraArgs)
      ? (v.extraArgs as unknown[]).filter((s): s is string => typeof s === "string" && s.trim().length > 0).map(s => s.trim())
      : typeof v.extraArgs === "string" && v.extraArgs.trim()
        ? splitArgs(v.extraArgs)
        : [];
    if (extra.length > 0) { out.extraArgs = extra; }
    return out;
  }
  if (v.kind === "launch" && typeof v.name === "string" && v.name.trim()) {
    // launch is invalid for flash; coerce to auto in that case
    if (slot === "flash") { return { kind: "auto" }; }
    return { kind: "launch", name: v.name.trim() };
  }
  return { kind: "auto" };
}

function sanitizeIncomingProfile(value: unknown): RunnerProfile | undefined {
  if (!value || typeof value !== "object") { return undefined; }
  const v = value as Record<string, unknown>;
  const name = typeof v.name === "string" ? v.name.trim() : "";
  if (!name) { return undefined; }
  const profile: RunnerProfile = {
    name,
    flash: sanitizeIncomingBind(v.flash, "flash"),
    debug: sanitizeIncomingBind(v.debug, "debug"),
    attach: sanitizeIncomingBind(v.attach, "attach"),
  };
  // Only preserve buildDebug when it was explicitly sent from the webview.
  if (v.buildDebug !== undefined && v.buildDebug !== null) {
    profile.buildDebug = sanitizeIncomingBind(v.buildDebug, "buildDebug");
  }
  return profile;
}

/**
 * Clone a `RunnerBind`. The bind object itself is shallow-copied (kind +
 * primitive fields), but the `extraArgs` array — the only field a profile
 * can mutate post-clone — is deep-copied so two profiles can independently
 * edit their args after a Duplicate.
 */
function cloneBind(bind: RunnerProfile["flash"]): RunnerProfile["flash"] {
  if (bind.kind === "runner") {
    const copy: RunnerProfile["flash"] = { kind: "runner", runner: bind.runner };
    if (bind.extraArgs && bind.extraArgs.length > 0) {
      copy.extraArgs = [...bind.extraArgs];
    }
    return copy;
  }
  if (bind.kind === "launch") {
    return { kind: "launch", name: bind.name };
  }
  return { kind: "auto" };
}
