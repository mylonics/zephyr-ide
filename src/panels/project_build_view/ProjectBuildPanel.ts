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

import { WorkspaceConfig, GlobalConfig } from "../../setup_utilities/types";
import { setWorkspaceState } from "../../setup_utilities/state-management";
import { notifyError, outputError } from "../../utilities/output";

import {
  getProjectInfo,
  getBuildDetails,
  getTestDetails,
  getCalculatedConfigFiles,
  getResolvedBuildOutputFiles,
  getProjectVariables,
  getBuildVariables,
  setProjectVariable,
  setBuildVariable,
  removeProjectVariable,
  removeBuildVariable,
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
import { escapeHtml, generateNonce } from "../webview_shared/webviewTypes";
import { getProjectSectionHtml } from "./ProjectSection";
import { getBuildSectionHtml } from "./BuildSection";
import { getTestSectionHtml } from "./TestSection";
import { getVariablesReferenceSectionHtml } from "./VariablesSection";

export class ProjectBuildPanel {
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
        case "addBuild":
          await addBuildToProject(ws, ctx, message.project);
          await this.refreshAfterChange();
          return;
        case "removeBuild":
          await removeBuild(ctx, ws, message.project, message.build);
          await this.refreshAfterChange();
          return;
        case "modifyBuildArgs":
          await modifyBuildArguments(ctx, ws, message.project, message.build);
          await this.refreshAfterChange();
          return;

        // Test management
        case "addTest":
          await addTest(ws, ctx, message.project);
          await this.refreshAfterChange();
          return;

        // Runner management
        case "addRunner":
          await addRunnerToBuild(ws, ctx, message.project, message.build);
          await this.refreshAfterChange();
          return;
        case "removeRunner":
          await removeRunner(ctx, ws, message.project, message.build, message.runner);
          await this.refreshAfterChange();
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
        case "addVariable":
          await this.handleAddVariable(message);
          return;
        case "editVariable":
          await this.handleEditVariable(message);
          return;
        case "removeVariable":
          await this.handleRemoveVariable(message);
          return;

        // Refresh calculated
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
      isProject ? undefined : message.build,
    );
    await this.refreshAfterChange();
  }

  private async handleAddVariable(message: any) {
    const key = await vscode.window.showInputBox({ title: "Variable Name", prompt: "Enter variable name" });
    if (!key) { return; }
    const value = await vscode.window.showInputBox({ title: "Variable Value", prompt: `Enter value for "${key}"` });
    if (value === undefined) { return; }

    if (message.level === "project" && this._selectedProject) {
      await setProjectVariable(this._context, this._wsConfig, this._selectedProject, key, value);
    } else if (message.level === "build" && this._selectedProject && message.build) {
      await setBuildVariable(this._context, this._wsConfig, this._selectedProject, message.build, key, value);
    }
    this.updateHtml();
  }

  private async handleEditVariable(message: any) {
    const currentValue = message.level === "project"
      ? getProjectVariables(this._wsConfig, this._selectedProject ?? "")[message.key] ?? ""
      : getBuildVariables(this._wsConfig, this._selectedProject ?? "", message.build ?? "")[message.key] ?? "";

    const value = await vscode.window.showInputBox({
      title: `Edit Variable: ${message.key}`,
      prompt: `Enter new value for "${message.key}"`,
      value: currentValue,
    });
    if (value === undefined) { return; }

    if (message.level === "project" && this._selectedProject) {
      await setProjectVariable(this._context, this._wsConfig, this._selectedProject, message.key, value);
    } else if (message.level === "build" && this._selectedProject && message.build) {
      await setBuildVariable(this._context, this._wsConfig, this._selectedProject, message.build, message.key, value);
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

  private async refreshAfterChange() {
    await vscode.commands.executeCommand("zephyr-ide.update-web-view");
  }

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
    this._panel.webview.html = this.getHtmlForWebview();
  }

  private getHtmlForWebview(): string {
    const nonce = generateNonce();
    const projectNames = Object.keys(this._wsConfig.projects ?? {});
    const selected = this._selectedProject;

    // Project selector
    const projectOptions = projectNames
      .map((name) => {
        const sel = name === selected ? " selected" : "";
        return `<option value="${escapeHtml(name)}"${sel}>${escapeHtml(name)}</option>`;
      })
      .join("\n");

    // Project section
    let projectHtml = "";
    let buildOrTestHtml = "";
    let selectorHtml = "";

    if (selected && this._wsConfig.projects[selected]) {
      const projectInfo = getProjectInfo(this._wsConfig, selected);
      if (projectInfo) {
        const projectVars = getProjectVariables(this._wsConfig, selected);
        projectHtml = getProjectSectionHtml(projectInfo, selected, projectVars);
      }

      // Build the build/test selector options
      const project = this._wsConfig.projects[selected];
      const buildNames = Object.keys(project.buildConfigs ?? {});
      const testNames = Object.keys(project.twisterConfigs ?? {});
      const currentSelection = this._selectedBuildOrTest ?? "";

      const options: string[] = [];
      for (const bName of buildNames) {
        const val = `build:${bName}`;
        const sel = val === currentSelection ? " selected" : "";
        const activeBuild = this._wsConfig.projectStates[selected]?.activeBuildConfig;
        const activeLabel = bName === activeBuild ? " (active)" : "";
        options.push(`<option value="${escapeHtml(val)}"${sel}>Build: ${escapeHtml(bName)}${activeLabel}</option>`);
      }
      for (const tName of testNames) {
        const val = `test:${tName}`;
        const sel = val === currentSelection ? " selected" : "";
        options.push(`<option value="${escapeHtml(val)}"${sel}>Test: ${escapeHtml(tName)}</option>`);
      }

      if (options.length > 0) {
        selectorHtml = `
          <div class="build-test-selector">
            <label for="buildTestSelect">Build / Test:</label>
            <select id="buildTestSelect">
              ${options.join("\n")}
            </select>
          </div>`;
      }

      // Render the selected build or test
      if (currentSelection.startsWith("build:")) {
        const buildName = currentSelection.slice(6);
        const buildDetails = getBuildDetails(this._wsConfig, selected, buildName);
        if (buildDetails) {
          const buildVars = getBuildVariables(this._wsConfig, selected, buildName);
          const calculated = getCalculatedConfigFiles(project, project.buildConfigs[buildName]);
          const activeBuild = this._wsConfig.projectStates[selected]?.activeBuildConfig;
          const isActive = buildName === activeBuild;
          buildOrTestHtml = getBuildSectionHtml(buildDetails, selected, buildName, buildVars, calculated, undefined, isActive);
        }
      } else if (currentSelection.startsWith("test:")) {
        const testName = currentSelection.slice(5);
        const testDetails = getTestDetails(this._wsConfig, selected, testName);
        if (testDetails) {
          buildOrTestHtml = getTestSectionHtml(testDetails, selected);
        }
      }
    }

    const variablesRefHtml = getVariablesReferenceSectionHtml();

    const noProjectHtml =
      projectNames.length === 0
        ? `<div class="no-project-notice">
            <i class="codicon codicon-info"></i>
            <p>No projects configured. Use the command palette to add a project.</p>
          </div>`
        : "";

    return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${this._panel.webview.cspSource}; font-src ${this._panel.webview.cspSource}; img-src ${this._panel.webview.cspSource} data:; script-src 'nonce-${nonce}';">
      <title>Zephyr IDE: Project Details</title>
      ${this.getStylesheetLinks()}
    </head>
    <body>
      <div class="panel-container">
        <div class="panel-toolbar">
          <h1><i class="codicon codicon-project"></i> Project Details</h1>
          <div class="project-selector">
            <label for="projectSelect">Project:</label>
            <select id="projectSelect">
              ${projectOptions}
            </select>
          </div>
        </div>

        ${noProjectHtml}
        <div id="projectContent">
          ${projectHtml}
          ${selectorHtml}
          ${buildOrTestHtml}
        </div>
        ${variablesRefHtml}
      </div>
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
      <link rel="stylesheet" type="text/css" href="${codiconUri}">
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
