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
  getBuildFolder,
  addRunnerToProject,
  removeProjectRunner,
} from "../../project_utilities/project";
import { ConfigFiles } from "../../project_utilities/config_selector";
import { generateNonce } from "../webview_shared/nonce";
import { getLaunchTargetDisplayName, getLaunchConfigurations } from "../../utilities/utils";
import { normalizeBuildArgs } from "../../project_utilities/build_args";
import { KNOWN_RUNNERS, RunnerConfig } from "../../project_utilities/runner_selector";
import { RunnerBind, formatBindLabel, loadRunnerVariants, findRunnerVariant } from "../../project_utilities/runner_variants";
import { getRunnersYamlHint } from "../../zephyr_utilities/runners-yaml";

import type {
  ProjectBuildPanelData,
  WebviewBindInfo,
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

  private async handleMessage(message: Record<string, any>) {
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
          // Legacy message from the pre-4-bind UI; ignored.
          return;
        case "addProjectRunner":
          await addRunnerToProject(ws, ctx, message.project);
          await this.refreshAfterChange();
          return;
        case "removeProjectRunner":
          await removeProjectRunner(ctx, ws, message.project, message.runner);
          await this.refreshAfterChange();
          return;
        case "updateProjectRunner":
          // Legacy message from the pre-4-bind UI; ignored.
          return;
        case "pickBind":
          await this.handlePickBind(message);
          return;
        case "setBindExtraArgs":
          await this.handleSetBindExtraArgs(message);
          return;
        case "setActiveRunner": {
          const buildState = ws.projectStates[message.project]?.buildStates[message.build];
          if (buildState) {
            buildState.activeRunner = message.runner ?? undefined;
            await setWorkspaceState(ctx, ws);
          }
          await this.refreshAfterChange();
          return;
        }

        // Build actions
        case "build":
          await this.runBuildAction("build", "zephyr-ide.build");
          return;
        case "buildPristine":
          await this.runBuildAction("buildPristine", "zephyr-ide.build-pristine");
          return;
        case "flash":
          await this.runBuildAction("flash", "zephyr-ide.flash");
          return;
        case "debug":
          await this.runBuildAction("debug", "zephyr-ide.debug");
          return;
        case "buildDebug":
          await this.runBuildAction("buildDebug", "zephyr-ide.build-debug");
          return;
        case "runDashboard":
          await this.runBuildAction("runDashboard", "zephyr-ide.run-dashboard");
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

  private async handleRemoveConfigFile(message: Record<string, any>, isKConfig: boolean, isProject: boolean) {
    if (!this._selectedProject || !message.file) {
      return;
    }
    const isPrimary = message.extra !== true && message.extra !== "true";
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

  private async handleToggleFileExtra(message: Record<string, any>) {
    if (!this._selectedProject || !message.file) {
      return;
    }
    const file = String(message.file);
    const isKConfig = message.isKConfig === "true";
    const isProject = message.isProject === "true";

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

  private async handleUpsertVariable(message: Record<string, any>) {
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

  private async handleRemoveVariable(message: Record<string, any>) {
    if (message.level === "project" && this._selectedProject) {
      await removeProjectVariable(this._context, this._wsConfig, this._selectedProject, message.key);
    } else if (message.level === "build" && this._selectedProject && message.build) {
      await removeBuildVariable(this._context, this._wsConfig, this._selectedProject, message.build, message.key);
    }
    this.updateHtml();
  }

  private getBuildArgList(message: Record<string, any>): { projectName: string; buildName: string; args: string[] } | undefined {
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

  private async handleUpsertBuildArg(message: Record<string, any>) {
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

  private async handleRemoveBuildArg(message: Record<string, any>) {
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

  // ---------------------------------------------------------------------------
  // Runner bind handlers (4-bind model: flash / build / buildDebug / attach)
  // ---------------------------------------------------------------------------

  /**
   * Returns the live RunnerConfig dictionary for the requested level, plus
   * helpers for persistence. For the build level the returned `setActive`
   * function updates the build's active runner.
   */
  private resolveRunnerScope(message: Record<string, any>): {
    project: string;
    build: string | undefined;
    runners: Record<string, RunnerConfig> | undefined;
    setActive?: (name: string | undefined) => void;
  } | undefined {
    const projectName = String(message.project ?? this._selectedProject ?? "");
    if (!projectName) { return undefined; }
    const project = this._wsConfig.projects[projectName];
    if (!project) { return undefined; }

    const buildName = message.build ? String(message.build) : undefined;
    if (buildName) {
      const build = project.buildConfigs?.[buildName];
      if (!build) { return undefined; }
      if (!build.runnerConfigs) { build.runnerConfigs = {}; }
      const buildState = this._wsConfig.projectStates[projectName]?.buildStates?.[buildName];
      return {
        project: projectName,
        build: buildName,
        runners: build.runnerConfigs,
        setActive: (name) => { if (buildState) { buildState.activeRunner = name; } },
      };
    }
    if (!project.runnerConfigs) { project.runnerConfigs = {}; }
    return {
      project: projectName,
      build: undefined,
      runners: project.runnerConfigs,
    };
  }

  private static readonly BIND_TARGETS = ["flash", "build", "buildDebug", "attach"] as const;
  private static isBindTarget(t: any): t is typeof ProjectBuildPanel.BIND_TARGETS[number] {
    return ProjectBuildPanel.BIND_TARGETS.includes(t);
  }

  /**
   * Synthesise a sensible auto-created RunnerConfig name from the picked bind.
   * Falls back to "default" / "default-N" if there's a collision.
   */
  private synthesizeRunnerName(bind: RunnerBind, existing: Set<string>): string {
    let base = "default";
    if (bind.kind === "runner") { base = bind.runner; }
    else if (bind.kind === "variant") { base = bind.variant; }
    else if (bind.kind === "launch") { base = bind.name; }
    if (!existing.has(base)) { return base; }
    for (let i = 2; i < 1000; i++) {
      const candidate = `${base}-${i}`;
      if (!existing.has(candidate)) { return candidate; }
    }
    return `${base}-${Date.now()}`;
  }

  private async handlePickBind(message: Record<string, any>) {
    const target = message.target;
    if (!ProjectBuildPanel.isBindTarget(target)) {
      outputError("Project Build Panel", `pickBind: invalid target "${String(target)}"`);
      return;
    }

    const scope = this.resolveRunnerScope(message);
    if (!scope) {
      notifyError("Runner Config", "Cannot resolve project/build for runner bind change.");
      return;
    }

    const ws = this._wsConfig;
    const variants = loadRunnerVariants(ws);
    const variantNames = new Set(variants.map(v => v.name));

    // Gather catalogues for the picker
    let availableRunners: string[] = [];
    let launchConfigs: string[] = [];
    if (scope.build) {
      const build = ws.projects[scope.project].buildConfigs[scope.build];
      const buildFolder = getBuildFolder(ws, ws.projects[scope.project], build);
      const hint = getRunnersYamlHint(buildFolder);
      availableRunners = hint?.availableRunners ?? [];
    }
    if (target !== "flash") {
      const all = await getLaunchConfigurations(ws);
      launchConfigs = (all ?? [])
        .map((c: any) => c?.name)
        .filter((n: any): n is string => typeof n === "string" && n.length > 0);
    }

    // Build grouped QuickPick items
    type Item = vscode.QuickPickItem & { _bind?: RunnerBind };
    const items: Item[] = [];
    items.push({ label: "Auto", description: "Use runners.yaml defaults", _bind: { kind: "auto" } });

    if (variants.length > 0) {
      items.push({ label: "Variants", kind: vscode.QuickPickItemKind.Separator });
      for (const v of variants) {
        items.push({
          label: `variant: ${v.name}`,
          description: `${v.runner} ${v.args}`.trim(),
          _bind: { kind: "variant", variant: v.name },
        });
      }
    }

    const availableSet = new Set(availableRunners);
    if (availableRunners.length > 0) {
      items.push({ label: "Available for this board", kind: vscode.QuickPickItemKind.Separator });
      for (const r of availableRunners) {
        items.push({ label: r, description: "from runners.yaml", _bind: { kind: "runner", runner: r } });
      }
    }

    const otherRunners = KNOWN_RUNNERS.filter(r => !availableSet.has(r));
    if (otherRunners.length > 0) {
      items.push({ label: "Other runners", kind: vscode.QuickPickItemKind.Separator });
      for (const r of otherRunners) {
        items.push({ label: r, _bind: { kind: "runner", runner: r } });
      }
    }

    if (target !== "flash" && launchConfigs.length > 0) {
      items.push({ label: "launch.json configurations", kind: vscode.QuickPickItemKind.Separator });
      for (const name of launchConfigs) {
        items.push({ label: `launch.json: ${name}`, _bind: { kind: "launch", name } });
      }
    }

    const targetLabel = target === "buildDebug" ? "Build & Debug" : target.charAt(0).toUpperCase() + target.slice(1);
    const pick = await vscode.window.showQuickPick(items, {
      title: `Pick ${targetLabel} bind`,
      placeHolder: `Select what runs for ${targetLabel}`,
      ignoreFocusOut: true,
    }).then(v => v as Item | undefined, (e) => { outputError("Runner Bind", String(e)); return undefined; });

    if (!pick || !pick._bind) { return; }
    const newBind = pick._bind;

    // Validation
    if (target === "flash" && newBind.kind === "launch") {
      notifyError("Runner Bind", "launch.json bindings are not allowed for the Flash target.");
      return;
    }
    if (newBind.kind === "variant" && !variantNames.has(newBind.variant)) {
      notifyError("Runner Bind", `Variant "${newBind.variant}" is not defined. Add it under "zephyr-ide.runnerVariants" or .vscode/zephyr-ide.json.`);
      return;
    }

    // Apply: either to the named runner, or auto-create one when none exist.
    const runnerName: string | undefined = message.runner ? String(message.runner) : undefined;
    const runners = scope.runners!;
    let target_runner: RunnerConfig | undefined;
    let createdNew = false;

    if (runnerName) {
      target_runner = runners[runnerName];
      if (!target_runner) {
        notifyError("Runner Bind", `Runner "${runnerName}" not found. The configuration may have been removed; reload the panel.`);
        return;
      }
    } else if (Object.keys(runners).length === 0) {
      // Auto-create-when-empty: synthesise a "default" RunnerConfig.
      const newName = this.synthesizeRunnerName(newBind, new Set(Object.keys(runners)));
      target_runner = {
        name: newName,
        flash: { kind: "auto" },
        build: { kind: "auto" },
        buildDebug: { kind: "auto" },
        attach: { kind: "auto" },
      };
      runners[newName] = target_runner;
      createdNew = true;
      // Mark the new config active at the build level.
      if (scope.setActive) { scope.setActive(newName); }
    } else {
      // Build has runners but no specific runner was named — refuse to silently mutate.
      notifyError("Runner Bind", "No runner specified. Add a runner first or pass a runner name.");
      return;
    }

    target_runner[target] = newBind;

    await setWorkspaceState(this._context, this._wsConfig);
    if (createdNew) {
      void vscode.window.showInformationMessage(`Created runner configuration "${target_runner.name}".`);
    }
    await this.refreshAfterChange();
  }

  private async handleSetBindExtraArgs(message: Record<string, any>) {
    const target = message.target;
    if (!ProjectBuildPanel.isBindTarget(target)) {
      outputError("Project Build Panel", `setBindExtraArgs: invalid target "${String(target)}"`);
      return;
    }
    const scope = this.resolveRunnerScope(message);
    if (!scope) { return; }
    const runnerName = String(message.runner ?? "");
    if (!runnerName) { return; }
    const runner = scope.runners?.[runnerName];
    if (!runner) {
      notifyError("Runner Bind", `Runner "${runnerName}" not found.`);
      return;
    }
    const bind = runner[target];
    if (!bind || (bind.kind !== "runner" && bind.kind !== "variant")) {
      // extraArgs is only meaningful for runner/variant binds; ignore otherwise.
      return;
    }
    const value = String(message.value ?? "").trim();
    if (value) {
      bind.extraArgs = value;
    } else {
      delete bind.extraArgs;
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

  /**
   * Run a build/flash/debug action while telling the webview which action is
   * in flight, so the matching button can show a spinner and the rest can be
   * disabled. The webview is responsible for clearing state on `finished`.
   */
  private async runBuildAction(action: string, commandId: string): Promise<void> {
    void this._panel.webview.postMessage({ command: "buildActionStatus", action, state: "started" });
    try {
      await vscode.commands.executeCommand(commandId);
    } finally {
      void this._panel.webview.postMessage({ command: "buildActionStatus", action, state: "finished" });
    }
  }

  private updateHtml() {
    void this._updateHtmlAsync();
  }

  private async _updateHtmlAsync() {
    const data = await this.generatePanelData();
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
  private async generatePanelData(): Promise<ProjectBuildPanelData> {
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
          // Catalogues used by both runner cards and the picker UX.
          const variants = loadRunnerVariants(this._wsConfig);
          const launchConfigs = await getLaunchConfigurations(this._wsConfig);
          const launchConfigNames = (launchConfigs ?? [])
            .map((c) => c?.name)
            .filter((n): n is string => typeof n === "string" && n.length > 0);
          const variantNames = variants.map((v) => ({ name: v.name, runner: v.runner, args: v.args }));
          const availableRunners = details.runnersYamlHint?.availableRunners ?? [];

          const toBindInfo = (b: RunnerBind | undefined): WebviewBindInfo => {
            // RunnerConfig is loaded from persisted JSON; defensively validate
            // the discriminator before trusting the type.
            const bind: RunnerBind = (b && typeof (b as any).kind === "string")
              ? b
              : { kind: "auto" };
            const display = formatBindLabel(bind, variants);
            const extraArgs = (bind.kind === "runner" || bind.kind === "variant")
              ? (bind.extraArgs ?? "")
              : "";
            const missingVariant = bind.kind === "variant" && !findRunnerVariant(bind.variant, variants);
            return {
              bind: bind as WebviewBindInfo["bind"],
              display,
              extraArgs,
              missingVariant,
            };
          };

          const toRunnerInfo = (r: { name: string; config: RunnerConfig }): WebviewRunnerInfo => ({
            name: r.name,
            flash: toBindInfo(r.config.flash),
            build: toBindInfo(r.config.build),
            buildDebug: toBindInfo(r.config.buildDebug),
            attach: toBindInfo(r.config.attach),
          });

          const runners: WebviewRunnerInfo[] = details.runners.map(toRunnerInfo);
          const projectRunners: WebviewRunnerInfo[] = details.projectRunners.map(toRunnerInfo);

          buildDetails = {
            ...details,
            runners,
            projectRunners,
            activeRunner: details.activeRunner,
            runnersYamlHint: details.runnersYamlHint,
            availableRunners,
            knownRunners: KNOWN_RUNNERS,
            variantNames,
            launchConfigNames,
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
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${this._panel.webview.cspSource}; font-src ${this._panel.webview.cspSource}; img-src ${this._panel.webview.cspSource} data:; script-src 'nonce-${nonce}';">
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
