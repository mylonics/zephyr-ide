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

import { WorkspaceConfig, GlobalConfig } from "../../setup_utilities/types";
import { setWorkspaceState } from "../../setup_utilities/state-management";
import { notifyError, outputError } from "../../utilities/output";

import {
  getProjectInfo,
  getBuildDetails,
  getTestDetails,
  getProjectVariables,
  getBuildVariables,
  mergeVariableDefaults,
  setProjectVariable,
  setBuildVariable,
  removeProjectVariable,
  removeBuildVariable,
  getAvailableVariableCommands,
} from "../../project_utilities/project_info";
import {
  addBuildToProject,
  addRunnerToBuild,
  removeBuild,
  removeRunner,
  addConfigFiles,
  removeConfigFile,
  modifyBuildArguments,
  addTest,
  selectDebugLaunchConfiguration,
  selectBuildDebugLaunchConfiguration,
  selectDebugAttachLaunchConfiguration,
  getProjectFolder,
} from "../../project_utilities/project";
import { ConfigFiles } from "../../project_utilities/config_selector";
import { generateNonce } from "../webview_shared/nonce";
import { getLaunchTargetDisplayName } from "../../utilities/utils";
import { normalizeBuildArgs } from "../../project_utilities/build_args";

import type {
  ProjectBuildPanelData,
  WebviewRunnerInfo,
} from "./project-build-data";

export class ProjectBuildPanel {
  private static readonly PROJECT_VARIABLE_DEFAULTS_CONFIG_KEY = "zephyr-ide.projectVariableDefaults";
  private static readonly BUILD_VARIABLE_DEFAULTS_CONFIG_KEY = "zephyr-ide.buildVariableDefaults";

  /** All open panels, keyed by project name (or "__default__" when no project specified) */
  private static _panels: Map<string, ProjectBuildPanel> = new Map();

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionPath: string;
  private readonly _context: vscode.ExtensionContext;
  private _disposables: vscode.Disposable[] = [];

  private _wsConfig: WorkspaceConfig;
  private _globalConfig: GlobalConfig;
  private _selectedProject: string | undefined;
  private _selectedBuildOrTest: string | undefined; // "build:<name>" or "test:<name>"
  private _htmlInitialized = false;

  /** For backward-compat: returns the first open panel, if any */
  public static get currentPanel(): ProjectBuildPanel | undefined {
    if (ProjectBuildPanel._panels.size === 0) { return undefined; }
    return ProjectBuildPanel._panels.values().next().value;
  }

  /** Update all open panels with new workspace config */
  public static updateAllPanels(wsConfig: WorkspaceConfig, globalConfig: GlobalConfig) {
    for (const panel of ProjectBuildPanel._panels.values()) {
      panel.updateContent(wsConfig, globalConfig);
    }
  }

  public static createOrShow(
    extensionPath: string,
    context: vscode.ExtensionContext,
    wsConfig: WorkspaceConfig,
    globalConfig: GlobalConfig,
    projectName?: string,
  ) {
    const key = projectName ?? "__default__";
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    const existing = ProjectBuildPanel._panels.get(key);
    if (existing) {
      existing._panel.reveal(column);
      existing.updateContent(wsConfig, globalConfig, projectName);
      return existing;
    }

    const title = projectName
      ? `Project: ${projectName}`
      : "Zephyr IDE: Project Details";

    const panel = vscode.window.createWebviewPanel(
      "zephyrIDEProjectBuild",
      title,
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.file(extensionPath)],
      },
    );

    const instance = new ProjectBuildPanel(
      panel,
      extensionPath,
      context,
      wsConfig,
      globalConfig,
      projectName,
    );
    ProjectBuildPanel._panels.set(key, instance);
    return instance;
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionPath: string,
    context: vscode.ExtensionContext,
    wsConfig: WorkspaceConfig,
    globalConfig: GlobalConfig,
    projectName?: string,
  ) {
    this._panel = panel;
    this._extensionPath = extensionPath;
    this._context = context;
    this._wsConfig = wsConfig;
    this._globalConfig = globalConfig;
    this._selectedProject = projectName ?? wsConfig.activeProject;

    // Default to the active build config
    this._selectedBuildOrTest = this.getDefaultSelection();

    this.updateHtml();

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      (message) => {
        void this.handleMessage(message);
      },
      null,
      this._disposables,
    );
  }

  private getDefaultSelection(): string | undefined {
    const proj = this._selectedProject;
    if (!proj) { return undefined; }
    const project = this._wsConfig.projects[proj];
    if (!project) { return undefined; }
    const activeBuild = this._wsConfig.projectStates[proj]?.activeBuildConfig;
    if (activeBuild && project.buildConfigs?.[activeBuild]) {
      return `build:${activeBuild}`;
    }
    const firstBuild = Object.keys(project.buildConfigs ?? {})[0];
    if (firstBuild) { return `build:${firstBuild}`; }
    const firstTest = Object.keys(project.twisterConfigs ?? {})[0];
    if (firstTest) { return `test:${firstTest}`; }
    return undefined;
  }

  public updateContent(wsConfig: WorkspaceConfig, globalConfig: GlobalConfig, projectName?: string) {
    this._wsConfig = wsConfig;
    this._globalConfig = globalConfig;
    if (projectName !== undefined) {
      this._selectedProject = projectName;
      this._selectedBuildOrTest = this.getDefaultSelection();
    }
    this.updateHtml();
  }

  public dispose() {
    // Remove from the panels map
    for (const [key, panel] of ProjectBuildPanel._panels.entries()) {
      if (panel === this) {
        ProjectBuildPanel._panels.delete(key);
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
  // Message handling
  // ---------------------------------------------------------------------------

  private async handleMessage(message: any) {
    const cmd = message.command;
    const ws = this._wsConfig;
    const ctx = this._context;

    try {
      switch (cmd) {
        case "switchProject":
          this._selectedProject = message.project;
          this._selectedBuildOrTest = this.getDefaultSelection();
          this._panel.title = message.project
            ? `Project: ${message.project}`
            : "Zephyr IDE: Project Details";
          this.updateHtml();
          return;

        case "switchBuildOrTest":
          this._selectedBuildOrTest = message.selection || undefined;
          this.updateHtml();
          return;

        case "openFile":
          if (message.file) {
            const resolvedPath = this.resolvePathForOpen(message.file);
            const doc = await vscode.workspace.openTextDocument(resolvedPath);
            await vscode.window.showTextDocument(doc);
          }
          return;

        case "openFolder":
          if (message.file) {
            const uri = vscode.Uri.file(message.file);
            await vscode.commands.executeCommand("revealFileInOS", uri);
          }
          return;

        // Project config files
        case "addProjectConfigFile":
          await addConfigFiles(ctx, ws, true, true, this._selectedProject);
          await this.refreshAfterChange();
          return;
        case "removeProjectConfigFile":
          await this.handleRemoveConfigFile(message, true, true);
          return;
        case "addProjectOverlayFile":
          await addConfigFiles(ctx, ws, false, true, this._selectedProject);
          await this.refreshAfterChange();
          return;
        case "removeProjectOverlayFile":
          await this.handleRemoveConfigFile(message, false, true);
          return;

        // Toggle file between override and extra
        case "toggleFileExtra":
          await this.handleToggleFileExtra(message);
          return;

        // Build config files
        case "addBuildConfigFile":
          await addConfigFiles(ctx, ws, true, false, this._selectedProject, message.build);
          await this.refreshAfterChange();
          return;
        case "removeBuildConfigFile":
          await this.handleRemoveConfigFile(message, true, false);
          return;
        case "addBuildOverlayFile":
          await addConfigFiles(ctx, ws, false, false, this._selectedProject, message.build);
          await this.refreshAfterChange();
          return;
        case "removeBuildOverlayFile":
          await this.handleRemoveConfigFile(message, false, false);
          return;

        // Build management
        case "addBuild": {
          const projectName = message.project;
          const existingBuilds = new Set(Object.keys(ws.projects[projectName]?.buildConfigs ?? {}));
          await addBuildToProject(ws, ctx, projectName);
          const newBuild = Object.keys(ws.projects[projectName]?.buildConfigs ?? {}).find(b => !existingBuilds.has(b));
          if (newBuild) {
            this._selectedBuildOrTest = `build:${newBuild}`;
          }
          await this.refreshAfterChange();
          return;
        }
        case "removeBuild":
          await removeBuild(ctx, ws, message.project, message.build);
          await this.refreshAfterChange();
          return;
        case "modifyBuildArgs":
          await modifyBuildArguments(ctx, ws, message.project, message.build);
          await this.refreshAfterChange();
          return;
        case "upsertBuildArg":
          await this.handleUpsertBuildArg(message);
          return;
        case "removeBuildArg":
          await this.handleRemoveBuildArg(message);
          return;

        // Test management
        case "addTest": {
          const projectName = message.project;
          const existingTests = new Set(Object.keys(ws.projects[projectName]?.twisterConfigs ?? {}));
          await addTest(ws, ctx, projectName);
          const newTest = Object.keys(ws.projects[projectName]?.twisterConfigs ?? {}).find(t => !existingTests.has(t));
          if (newTest) {
            this._selectedBuildOrTest = `test:${newTest}`;
          }
          await this.refreshAfterChange();
          return;
        }

        // Runner management
        case "addRunner":
          await addRunnerToBuild(ws, ctx, message.project, message.build);
          await this.refreshAfterChange();
          return;
        case "removeRunner":
          await removeRunner(ctx, ws, message.project, message.build, message.runner);
          await this.refreshAfterChange();
          return;
        case "updateRunner":
          await this.handleUpdateRunner(message);
          return;

        // Build actions
        case "build":
          await vscode.commands.executeCommand("zephyr-ide.build");
          return;
        case "buildPristine":
          await vscode.commands.executeCommand("zephyr-ide.build-pristine");
          return;
        case "flash":
          await vscode.commands.executeCommand("zephyr-ide.flash");
          return;
        case "debug":
          await vscode.commands.executeCommand("zephyr-ide.debug");
          return;
        case "buildDebug":
          await vscode.commands.executeCommand("zephyr-ide.build-debug");
          return;

        // Launch config
        case "changeLaunchTarget":
          if (message.type === "debug") {
            await selectDebugLaunchConfiguration(ctx, ws);
          } else if (message.type === "buildDebug") {
            await selectBuildDebugLaunchConfiguration(ctx, ws);
          } else if (message.type === "attach") {
            await selectDebugAttachLaunchConfiguration(ctx, ws);
          }
          await this.refreshAfterChange();
          return;

        // Variables
        case "upsertVariable":
          await this.handleUpsertVariable(message);
          return;
        case "removeVariable":
          await this.handleRemoveVariable(message);
          return;

        // Refresh calculated
        case "ready":
        case "refreshCalculated":
          this.updateHtml();
          return;
      }
    } catch (error) {
      outputError("Project Build Panel", `Error handling command "${cmd}": ${String(error)}`);
    }
  }

  private async handleRemoveConfigFile(message: any, isKConfig: boolean, isProject: boolean) {
    if (!this._selectedProject || !message.file) {
      return;
    }
    const isPrimary = message.extra !== "true";
    await removeConfigFile(
      this._context,
      this._wsConfig,
      isKConfig,
      isProject,
      this._selectedProject,
      isPrimary,
      [message.file],
      isProject ? undefined : (message.build || this.getSelectedBuildName()),
    );
    await this.refreshAfterChange();
  }

  private async handleToggleFileExtra(message: any) {
    if (!this._selectedProject || !message.file) {
      return;
    }
    const toggleCmd = String(message["toggle-cmd"] ?? "");
    const file = String(message.file);

    // Determine isKConfig, isProject from the toggle command name
    let isKConfig: boolean;
    let isProject: boolean;
    switch (toggleCmd) {
      case "toggleProjectConfigFileExtra":
        isKConfig = true; isProject = true; break;
      case "toggleProjectOverlayFileExtra":
        isKConfig = false; isProject = true; break;
      case "toggleBuildConfigFileExtra":
        isKConfig = true; isProject = false; break;
      case "toggleBuildOverlayFileExtra":
        isKConfig = false; isProject = false; break;
      default:
        return;
    }

    const project = this._wsConfig.projects[this._selectedProject];
    if (!project) { return; }

    let confFiles;
    if (isProject) {
      confFiles = project.confFiles;
    } else {
      const buildName = this.getSelectedBuildName();
      if (!buildName || !project.buildConfigs[buildName]) { return; }
      confFiles = project.buildConfigs[buildName].confFiles;
    }

    // Toggle the extra flag in-place (preserves list order)
    const key: keyof ConfigFiles = isKConfig ? "config" : "overlay";
    const entry = confFiles[key].find(e => e.path === file);
    if (entry) {
      entry.extra = !entry.extra || undefined;  // flip: true→undefined, undefined/false→true
    }

    await setWorkspaceState(this._context, this._wsConfig);
    this.updateHtml();
  }

  private getSelectedBuildName(): string | undefined {
    const sel = this._selectedBuildOrTest;
    if (sel && sel.startsWith("build:")) {
      return sel.slice(6);
    }
    return undefined;
  }

  private async handleUpsertVariable(message: any) {
    const key = String(message.key ?? "").trim();
    const value = String(message.value ?? "");
    const originalKey = String(message.originalKey ?? "").trim();

    if (!key) {
      notifyError("Project Build Panel", "Please enter a variable name to continue.");
      return;
    }

    if (message.level === "project" && this._selectedProject) {
      if (originalKey && originalKey !== key) {
        await removeProjectVariable(this._context, this._wsConfig, this._selectedProject, originalKey);
      }
      await setProjectVariable(this._context, this._wsConfig, this._selectedProject, key, value);
    } else if (message.level === "build" && this._selectedProject && message.build) {
      if (originalKey && originalKey !== key) {
        await removeBuildVariable(this._context, this._wsConfig, this._selectedProject, message.build, originalKey);
      }
      await setBuildVariable(this._context, this._wsConfig, this._selectedProject, message.build, key, value);
    }
    this.updateHtml();
  }

  private async handleRemoveVariable(message: any) {
    if (message.level === "project" && this._selectedProject) {
      await removeProjectVariable(this._context, this._wsConfig, this._selectedProject, message.key);
    } else if (message.level === "build" && this._selectedProject && message.build) {
      await removeBuildVariable(this._context, this._wsConfig, this._selectedProject, message.build, message.key);
    }
    this.updateHtml();
  }

  private getBuildArgList(message: any): { projectName: string; buildName: string; args: string[] } | undefined {
    const projectName = this._selectedProject;
    const buildName = String(message.build ?? "");
    if (!projectName || !buildName) {
      return undefined;
    }
    const build = this._wsConfig.projects[projectName]?.buildConfigs?.[buildName];
    if (!build) {
      return undefined;
    }
    const args = message.kind === "cmake"
      ? normalizeBuildArgs(build.westBuildCMakeArgs)
      : normalizeBuildArgs(build.westBuildArgs);
    return { projectName, buildName, args };
  }

  private async handleUpsertBuildArg(message: any) {
    const buildArgs = this.getBuildArgList(message);
    if (!buildArgs) {
      return;
    }

    const newArgs = normalizeBuildArgs(String(message.value ?? ""));
    const index = Number.parseInt(String(message.index ?? ""), 10);
    if (Number.isFinite(index) && index >= 0 && index < buildArgs.args.length) {
      buildArgs.args.splice(index, 1, ...newArgs);
    } else {
      buildArgs.args.push(...newArgs);
    }

    const build = this._wsConfig.projects[buildArgs.projectName].buildConfigs[buildArgs.buildName];
    if (message.kind === "cmake") {
      build.westBuildCMakeArgs = buildArgs.args;
    } else {
      build.westBuildArgs = buildArgs.args;
    }

    await setWorkspaceState(this._context, this._wsConfig);
    this.updateHtml();
  }

  private async handleRemoveBuildArg(message: any) {
    const buildArgs = this.getBuildArgList(message);
    if (!buildArgs) {
      return;
    }

    const index = Number.parseInt(String(message.index ?? ""), 10);
    if (!Number.isFinite(index) || index < 0 || index >= buildArgs.args.length) {
      return;
    }

    buildArgs.args.splice(index, 1);
    const build = this._wsConfig.projects[buildArgs.projectName].buildConfigs[buildArgs.buildName];
    if (message.kind === "cmake") {
      build.westBuildCMakeArgs = buildArgs.args;
    } else {
      build.westBuildArgs = buildArgs.args;
    }

    await setWorkspaceState(this._context, this._wsConfig);
    this.updateHtml();
  }

  private async handleUpdateRunner(message: any) {
    const projectName = this._selectedProject;
    const buildName = String(message.build ?? "");
    const runnerName = String(message.runner ?? "");
    if (!projectName || !buildName || !runnerName) {
      return;
    }
    const runner = this._wsConfig.projects[projectName]?.buildConfigs?.[buildName]?.runnerConfigs?.[runnerName];
    if (!runner) {
      return;
    }
    if (message["runner-type"] !== undefined) {
      runner.runner = String(message["runner-type"]);
    }
    if (message["runner-args"] !== undefined) {
      runner.args = String(message["runner-args"]);
    }
    await setWorkspaceState(this._context, this._wsConfig);
    await this.refreshAfterChange();
  }

  private async refreshAfterChange() {
    await vscode.commands.executeCommand("zephyr-ide.update-web-view");
  }

  private getDefaultVariableKeys(level: "project" | "build"): string[] {
    const configKey = level === "project"
      ? ProjectBuildPanel.PROJECT_VARIABLE_DEFAULTS_CONFIG_KEY
      : ProjectBuildPanel.BUILD_VARIABLE_DEFAULTS_CONFIG_KEY;
    const defaults = vscode.workspace.getConfiguration().get<string[]>(configKey) ?? [];
    const keys = defaults
      .map((key) => String(key).trim())
      .filter((key) => key.length > 0);
    return Array.from(new Set(keys));
  }

  /**
   * Resolve a file path coming from the webview.
   * Relative paths are resolved against the selected project folder when available,
   * otherwise against the workspace root.
   */
  private resolvePathForOpen(filePath: string): string {
    if (path.isAbsolute(filePath)) {
      return filePath;
    }

    const selectedProject = this._selectedProject
      ? this._wsConfig.projects[this._selectedProject]
      : undefined;

    if (selectedProject) {
      return path.join(getProjectFolder(this._wsConfig, selectedProject), filePath);
    }

    return path.join(this._wsConfig.rootPath, filePath);
  }

  // ---------------------------------------------------------------------------
  // HTML generation
  // ---------------------------------------------------------------------------

  private updateHtml() {
    const data = this.generatePanelData();
    if (!this._htmlInitialized) {
      this._panel.webview.html = this.getHtmlShell();
      this._htmlInitialized = true;
    }
    // Always send data — on first render the Lit app component will receive
    // it as soon as it connects; on subsequent updates it triggers reactive
    // rendering without any innerHTML replacement.
    void this._panel.webview.postMessage({
      command: "updateContent",
      data,
    });
  }

  /** Generate the full data payload for the webview. */
  private generatePanelData(): ProjectBuildPanelData {
    const projectNames = Object.keys(this._wsConfig.projects ?? {});
    const selected = this._selectedProject;

    // Project selector options
    const projectOptions = projectNames.map((name) => ({
      name,
      selected: name === selected,
    }));

    // Build/test selector options
    const buildTestOptions: ProjectBuildPanelData["buildTestOptions"] = [];
    let projectInfo: ProjectBuildPanelData["projectInfo"];
    let projectVars: Record<string, string> = {};
    let buildDetails: ProjectBuildPanelData["buildDetails"];
    let buildVars: Record<string, string> = {};
    let isBuildActive = false;
    let testDetails: ProjectBuildPanelData["testDetails"];

    if (selected && this._wsConfig.projects[selected]) {
      const info = getProjectInfo(this._wsConfig, selected);
      if (info) {
        projectInfo = info;
        projectVars = mergeVariableDefaults(
          getProjectVariables(this._wsConfig, selected),
          this.getDefaultVariableKeys("project"),
        );
      }

      const project = this._wsConfig.projects[selected];
      const buildNames = Object.keys(project.buildConfigs ?? {});
      const testNames = Object.keys(project.twisterConfigs ?? {});
      const currentSelection = this._selectedBuildOrTest ?? "";
      const activeBuild = this._wsConfig.projectStates[selected]?.activeBuildConfig;

      for (const bName of buildNames) {
        const val = `build:${bName}`;
        const activeLabel = bName === activeBuild ? " (active)" : "";
        buildTestOptions.push({
          value: val,
          label: `Build: ${bName}${activeLabel}`,
          selected: val === currentSelection,
        });
      }
      for (const tName of testNames) {
        const val = `test:${tName}`;
        buildTestOptions.push({
          value: val,
          label: `Test: ${tName}`,
          selected: val === currentSelection,
        });
      }

      // Render the selected build or test
      if (currentSelection.startsWith("build:")) {
        const buildName = currentSelection.slice(6);
        const details = getBuildDetails(this._wsConfig, selected, buildName);
        if (details) {
          const runners: WebviewRunnerInfo[] = details.runners.map((r) => ({
            name: r.name,
            runner: r.config.runner,
            args: r.config.args,
          }));

          buildDetails = {
            ...details,
            runners,
            debugDisplay: getLaunchTargetDisplayName(details.launchTarget, details.launchTargetFolder, "Zephyr IDE: Debug"),
            buildDebugDisplay: getLaunchTargetDisplayName(details.buildDebugTarget, details.buildDebugTargetFolder, "Zephyr IDE: Debug"),
            attachDisplay: getLaunchTargetDisplayName(details.attachTarget, details.attachTargetFolder, "Zephyr IDE: Attach"),
          };

          isBuildActive = buildName === activeBuild;

          buildVars = mergeVariableDefaults(
            getBuildVariables(this._wsConfig, selected, buildName),
            this.getDefaultVariableKeys("build"),
          );
        }
      } else if (currentSelection.startsWith("test:")) {
        const testName = currentSelection.slice(5);
        const details = getTestDetails(this._wsConfig, selected, testName);
        if (details) {
          testDetails = details;
        }
      }
    }

    return {
      projectOptions,
      buildTestOptions,
      projectInfo,
      projectVars,
      buildDetails,
      buildVars,
      isBuildActive,
      testDetails,
      variableCommands: getAvailableVariableCommands(),
      selectedProject: selected,
    };
  }

  private getHtmlShell(): string {
    const nonce = generateNonce();

    return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${this._panel.webview.cspSource} 'unsafe-inline'; font-src ${this._panel.webview.cspSource}; img-src ${this._panel.webview.cspSource} data:; script-src 'nonce-${nonce}';">
      <title>Zephyr IDE: Project Details</title>
      ${this.getStylesheetLinks()}
    </head>
    <body>
      <project-build-app></project-build-app>
      ${this.getScriptTags(nonce)}
    </body>
    </html>`;
  }

  private getStylesheetLinks(): string {
    const cssUri = this._panel.webview.asWebviewUri(
      vscode.Uri.joinPath(
        vscode.Uri.file(this._extensionPath),
        "src",
        "panels",
        "project_build_view",
        "project-build-panel.css",
      ),
    );
    const codiconUri = this._panel.webview.asWebviewUri(
      vscode.Uri.joinPath(
        vscode.Uri.file(this._extensionPath),
        "node_modules",
        "@vscode",
        "codicons",
        "dist",
        "codicon.css",
      ),
    );
    return `
      <link rel="stylesheet" type="text/css" href="${cssUri}">
      <link rel="stylesheet" type="text/css" href="${codiconUri}" id="vscode-codicon-stylesheet">
    `;
  }

  private getScriptTags(nonce: string): string {
    const jsUri = this._panel.webview.asWebviewUri(
      vscode.Uri.joinPath(
        vscode.Uri.file(this._extensionPath),
        "dist",
        "webview",
        "project_build_view",
        "project-build-panel.js",
      ),
    );
    return `<script nonce="${nonce}" src="${jsUri}"></script>`;
  }
}
