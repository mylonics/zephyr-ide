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

import * as vscode from 'vscode';
import * as path from 'upath';
import { addConfigFiles, setActive, modifyBuildArguments, removeConfigFile, getResolvedProfile, getBindOverride, getResolvedTestConfig, resolveActiveProject, resolveActiveProjectBuild } from '../project_utilities/project';
import { ConfigFiles, ConfigFileEntry } from '../project_utilities/config_selector';
import { joinBuildArgs } from '../project_utilities/build_args';
import { formatBindLabel } from '../project_utilities/runner_profiles';

import { WorkspaceConfig } from '../setup_utilities/types';
import { getSetupState } from '../setup_utilities/workspace-config';
import { outputInfo } from '../utilities/output';
import { sanitizeTreeId } from '../utilities/utils';

export class ConfigItem extends vscode.TreeItem {
  children: ConfigItem[] = [];
  parent: ConfigItem | undefined;
  /** Data payload for command handlers */
  data: { project?: string; build?: string; runner?: string; test?: string; isExtra?: boolean; filename?: string; fileCmd?: string } = {};

  constructor(
    label: string,
    icon: string,
    collapsible: boolean,
    contextValue?: string,
    description?: string,
  ) {
    super(label, collapsible ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon(icon);
    if (contextValue) {
      this.contextValue = contextValue;
    }
    if (description) {
      this.description = description;
    }
  }
}

export class ProjectConfigState {
  projectOpenState: boolean = true;
  buildOpenState: boolean = true;
  runnerOpenState: boolean = true;
  twisterOpenState: boolean = true;
  projectKConfigOpenState: boolean = true;
  projectOverlayOpenState: boolean = true;
  buildKConfigOpenState: boolean = true;
  buildOverlayOpenState: boolean = true;
}

export class ProjectConfigView implements vscode.TreeDataProvider<ConfigItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<ConfigItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private rootItems: ConfigItem[] = [];
  private projectConfigState: ProjectConfigState;
  public treeView: vscode.TreeView<ConfigItem> | undefined;

  constructor(public extensionPath: string, private context: vscode.ExtensionContext, private wsConfig: WorkspaceConfig) {
    this.projectConfigState = this.context.workspaceState.get("zephyr-ide.project-config-view-state") ?? new ProjectConfigState;
  }

  async setProjectConfigState() {
    await this.context.workspaceState.update("zephyr-ide.project-config-view-state", this.projectConfigState);
  }

  private makeFileChildren(
    projectName: string,
    buildName: string | undefined,
    entries: ConfigFileEntry[],
    removeCmd: string,
  ): ConfigItem[] {
    const level = buildName ? 'build' : 'project';
    const type = removeCmd === 'removeKConfigFile' ? 'kconfig' : 'overlay';
    const items: ConfigItem[] = [];
    for (const entry of entries) {
      const isExtra = !!entry.extra;
      const label = isExtra ? (type === 'kconfig' ? "Extra Config" : "Extra Overlay") : (type === 'kconfig' ? "Config" : "Overlay");
      const idSuffix = isExtra ? '-extra' : '';
      const item = new ConfigItem(label, 'file', false, 'configFile', entry.path);
      item.id = `config-file-${level}-${type}${idSuffix}.${sanitizeTreeId(entry.path)}`;
      item.data = { project: projectName, build: buildName, fileCmd: removeCmd, isExtra, filename: entry.path };
      items.push(item);
    }
    return items;
  }

  private makeConfigGroup(projectName: string, buildName: string | undefined, confFiles: ConfigFiles | undefined, isKConfig: boolean): ConfigItem {
    const label = isKConfig ? "Kconfig" : "Devicetree Overlay";
    const icon = isKConfig ? "settings" : "circuit-board";
    const level = buildName ? 'build' : 'project';
    const type = isKConfig ? 'kconfig' : 'overlay';
    const contextValue = isKConfig
      ? (buildName ? 'configFileGroup.kconfig.build' : 'configFileGroup.kconfig.project')
      : (buildName ? 'configFileGroup.overlay.build' : 'configFileGroup.overlay.project');

    const group = new ConfigItem(label, icon, true, contextValue);
    group.id = `config-${level}-${type}`;
    group.data = { project: projectName, build: buildName };

    if (confFiles) {
      if (isKConfig) {
        group.children = this.makeFileChildren(projectName, buildName, confFiles.config, "removeKConfigFile");
      } else {
        group.children = this.makeFileChildren(projectName, buildName, confFiles.overlay, "removeOverlayFile");
      }
      for (const child of group.children) {
        child.parent = group;
      }
    }
    // If no children, not collapsible
    if (group.children.length === 0) {
      group.collapsibleState = vscode.TreeItemCollapsibleState.None;
    }
    return group;
  }

  /** Build the full tree structure from workspace config. */
  private buildTree(): ConfigItem[] {
    if (Object.keys(this.wsConfig.projects).length === 0) {
      return [];
    }

    if (this.wsConfig.activeProject === undefined) {
      this.wsConfig.activeProject = Object.keys(this.wsConfig.projects)[0];
    }

    const resolvedProject = resolveActiveProject(this.wsConfig);
    if (!resolvedProject) {
      return [];
    }

    const activeProject = resolvedProject.project;
    const resolved = resolveActiveProjectBuild(this.wsConfig);
    const activeBuild = resolved?.build;
    const activeProfile = resolved ? getResolvedProfile(this.wsConfig, resolved) : undefined;
    const activeTest = getResolvedTestConfig(this.wsConfig, resolvedProject);

    const items: ConfigItem[] = [];

    // Project group
    const projectItem = new ConfigItem(activeProject.name, 'symbol-folder', true, 'configProject');
    projectItem.id = 'config-project';
    projectItem.data = { project: activeProject.name };
    projectItem.collapsibleState = this.projectConfigState.projectOpenState
      ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed;

    const mainItem = new ConfigItem('main', 'folder-library', false, 'configClickable');
    mainItem.id = 'config-project.main';
    mainItem.description = activeProject.rel_path;
    mainItem.data = { project: activeProject.name };
    mainItem.command = { command: 'zephyr-ide.config-view.open-main', title: 'Open main', arguments: [mainItem] };

    const cmakeItem = new ConfigItem('CMake File', 'folder-library', false, 'configClickable');
    cmakeItem.id = 'config-project.cmake';
    cmakeItem.data = { project: activeProject.name };
    cmakeItem.command = { command: 'zephyr-ide.config-view.open-cmake', title: 'Open CMakeLists', arguments: [cmakeItem] };

    const projKConfig = this.makeConfigGroup(activeProject.name, undefined, activeProject.confFiles, true);
    if (projKConfig.children.length > 0) {
      projKConfig.collapsibleState = this.projectConfigState.projectKConfigOpenState
        ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed;
    }

    const projOverlay = this.makeConfigGroup(activeProject.name, undefined, activeProject.confFiles, false);
    if (projOverlay.children.length > 0) {
      projOverlay.collapsibleState = this.projectConfigState.projectOverlayOpenState
        ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed;
    }

    projectItem.children = [mainItem, cmakeItem, projKConfig, projOverlay];
    for (const child of projectItem.children) {
      child.parent = projectItem;
    }
    items.push(projectItem);

    // Build group
    if (activeBuild) {
      const buildItem = new ConfigItem(activeBuild.name, 'project', true, 'configBuild');
      buildItem.id = 'config-build';
      buildItem.data = { project: activeProject.name, build: activeBuild.name };
      buildItem.collapsibleState = this.projectConfigState.buildOpenState
        ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed;

      const boardItem = new ConfigItem('Board', 'circuit-board', false, 'configClickable');
      boardItem.id = 'config-build.board';
      boardItem.description = activeBuild.board + (activeBuild.revision ? '@' + activeBuild.revision : "");
      boardItem.data = { project: activeProject.name, build: activeBuild.name };
      boardItem.command = { command: 'zephyr-ide.config-view.open-board-dtc', title: 'Open Board DTS', arguments: [boardItem] };

      const boardDirItem = new ConfigItem('Board Dir', 'file-submodule', false, undefined, activeBuild.relBoardSubDir);
      boardDirItem.id = 'config-build.boarddir';

      const buildKConfig = this.makeConfigGroup(activeProject.name, activeBuild.name, activeBuild.confFiles, true);
      if (buildKConfig.children.length > 0) {
        buildKConfig.collapsibleState = this.projectConfigState.buildKConfigOpenState
          ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed;
      }

      const buildOverlay = this.makeConfigGroup(activeProject.name, activeBuild.name, activeBuild.confFiles, false);
      if (buildOverlay.children.length > 0) {
        buildOverlay.collapsibleState = this.projectConfigState.buildOverlayOpenState
          ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed;
      }

      const westArgsItem = new ConfigItem('West Args', 'circuit-board', false, 'configClickable', joinBuildArgs(activeBuild.westBuildArgs));
      westArgsItem.id = 'config-build.westargs';
      westArgsItem.data = { project: activeProject.name, build: activeBuild.name };
      westArgsItem.command = { command: 'zephyr-ide.config-view.modify-build-args', title: 'Modify Build Args', arguments: [westArgsItem] };

      const cmakeArgsItem = new ConfigItem('CMake Args', 'circuit-board', false, 'configClickable', joinBuildArgs(activeBuild.westBuildCMakeArgs));
      cmakeArgsItem.id = 'config-build.cmakeargs';
      cmakeArgsItem.data = { project: activeProject.name, build: activeBuild.name };
      cmakeArgsItem.command = { command: 'zephyr-ide.config-view.modify-build-args', title: 'Modify Build Args', arguments: [cmakeArgsItem] };

      buildItem.children = [boardItem, boardDirItem, buildKConfig, buildOverlay, westArgsItem, cmakeArgsItem];
      for (const child of buildItem.children) {
        child.parent = buildItem;
      }
      items.push(buildItem);

      // Runner Profile group
      // Shows bind slots (Flash / [Build & Debug /] Debug / Attach); the
      // Build & Debug slot is only shown when `separateBuildDebugProfile` is enabled.
      if (activeProfile && activeBuild) {
        const separateBuildDebug = !!vscode.workspace.getConfiguration().get<boolean>("zephyr-ide.separateBuildDebugProfile");

        const runnerItem = new ConfigItem(activeProfile.name, 'chip', true, 'configRunner');
        runnerItem.id = 'config-runner';
        runnerItem.data = { project: activeProject.name, build: activeBuild.name, runner: activeProfile.name };
        runnerItem.collapsibleState = this.projectConfigState.runnerOpenState
          ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed;

        const flashItem = new ConfigItem('Flash', 'zap', false, undefined,
          formatBindLabel(activeProfile.flash, getBindOverride(activeBuild, "flash")));
        flashItem.id = 'config-runner.flash';
        const debugItem = new ConfigItem('Debug', 'debug-alt', false, undefined,
          formatBindLabel(activeProfile.debug, getBindOverride(activeBuild, "debug")));
        debugItem.id = 'config-runner.debug';
        const attachItem = new ConfigItem('Attach', 'debug-console', false, undefined,
          formatBindLabel(activeProfile.attach, getBindOverride(activeBuild, "attach")));
        attachItem.id = 'config-runner.attach';

        const children = [flashItem];
        if (separateBuildDebug) {
          const buildDebugItem = new ConfigItem('Build & Debug', 'debug-all', false, undefined,
            formatBindLabel(
              activeProfile.buildDebug ?? activeProfile.debug,
              getBindOverride(activeBuild, "buildDebug") ?? getBindOverride(activeBuild, "debug"),
            ));
          buildDebugItem.id = 'config-runner.buildDebug';
          buildDebugItem.tooltip = 'Used for Build-and-Debug (separateBuildDebugProfile is on)';
          children.push(buildDebugItem);
          debugItem.tooltip = 'Used for Debug only (separateBuildDebugProfile is on)';
        } else {
          debugItem.tooltip = 'Drives both Debug and Build-and-Debug';
        }
        children.push(debugItem, attachItem);
        runnerItem.children = children;
        for (const child of runnerItem.children) {
          child.parent = runnerItem;
        }
        items.push(runnerItem);
      } else if (activeBuild) {
        // No profile selected — show a placeholder that opens the profile picker.
        const placeholder = new ConfigItem('(no runner profile) — click to pick', 'chip', false);
        placeholder.id = 'config-runner';
        placeholder.tooltip = 'Flash/Debug/Attach fall back to runners.yaml defaults. Click to select a Runner Profile.';
        placeholder.command = {
          command: 'zephyr-ide.set-active-profile',
          title: 'Select Active Runner Profile',
        };
        items.push(placeholder);
      }
    }

    // Twister group
    if (activeTest) {
      const twisterItem = new ConfigItem(activeTest.name, 'beaker', true, 'configTwister');
      twisterItem.id = 'config-twister';
      twisterItem.data = { project: activeProject.name, test: activeTest.name };
      twisterItem.collapsibleState = this.projectConfigState.twisterOpenState
        ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed;

      const platformItem = new ConfigItem('platform', 'tools', false, undefined, activeTest.platform);
      platformItem.id = 'config-twister.platform';
      const testsItem = new ConfigItem('Tests', 'file-code', false, undefined, activeTest.tests.join(', '));
      testsItem.id = 'config-twister.tests';
      twisterItem.children = [platformItem, testsItem];

      const argsItem = new ConfigItem('Args', 'file-code', false, 'configClickable', activeTest.args);
      argsItem.id = 'config-twister.args';
      argsItem.data = { project: activeProject.name, test: activeTest.name };
      argsItem.command = { command: 'zephyr-ide.config-view.modify-test-args', title: 'Modify Test Args', arguments: [argsItem] };
      twisterItem.children.push(argsItem);

      if (activeTest.boardConfig) {
        const boardItem = new ConfigItem('Board', 'circuit-board', false, undefined,
          activeTest.boardConfig.board + (activeTest.boardConfig.revision ? '@' + activeTest.boardConfig.revision : ""));
        boardItem.id = 'config-twister.board';
        twisterItem.children.push(boardItem);

        const portItem = new ConfigItem('Port', 'symbol-string', false, 'configClickable', activeTest.serialPort ?? "");
        portItem.id = 'config-twister.port';
        portItem.data = { project: activeProject.name, test: activeTest.name };
        portItem.command = { command: 'zephyr-ide.config-view.modify-test-args', title: 'Modify Test Args', arguments: [portItem] };
        twisterItem.children.push(portItem);

        const baudItem = new ConfigItem('Baud', 'pulse', false, 'configClickable', activeTest.serialBaud ?? "");
        baudItem.id = 'config-twister.baud';
        baudItem.data = { project: activeProject.name, test: activeTest.name };
        baudItem.command = { command: 'zephyr-ide.config-view.modify-test-args', title: 'Modify Test Args', arguments: [baudItem] };
        twisterItem.children.push(baudItem);
      }

      for (const child of twisterItem.children) {
        child.parent = twisterItem;
      }
      items.push(twisterItem);
    }

    return items;
  }

  updateWebView(wsConfig: WorkspaceConfig) {
    this.rootItems = this.buildTree();
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: ConfigItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: ConfigItem): ConfigItem[] {
    if (!element) {
      return this.rootItems;
    }
    return element.children;
  }

  getParent(element: ConfigItem): ConfigItem | undefined {
    return element.parent;
  }

  /** Track expand/collapse changes from the TreeView events */
  handleExpand(element: ConfigItem) {
    this.updateStateFromElement(element, true);
  }

  handleCollapse(element: ConfigItem) {
    this.updateStateFromElement(element, false);
  }

  private updateStateFromElement(element: ConfigItem, open: boolean) {
    switch (element.contextValue) {
      case 'configProject': this.projectConfigState.projectOpenState = open; break;
      case 'configBuild': this.projectConfigState.buildOpenState = open; break;
      case 'configRunner': this.projectConfigState.runnerOpenState = open; break;
      case 'configTwister': this.projectConfigState.twisterOpenState = open; break;
      case 'configFileGroup.kconfig.project': this.projectConfigState.projectKConfigOpenState = open; break;
      case 'configFileGroup.overlay.project': this.projectConfigState.projectOverlayOpenState = open; break;
      case 'configFileGroup.kconfig.build': this.projectConfigState.buildKConfigOpenState = open; break;
      case 'configFileGroup.overlay.build': this.projectConfigState.buildOverlayOpenState = open; break;
    }
    void this.setProjectConfigState();
  }

  // Command handlers (called from registered commands in extension.ts)

  async handleOpenBoardDtc(item: ConfigItem) {
    const project = this.wsConfig.projects[item.data.project!];
    if (!project || !item.data.build || !project.buildConfigs[item.data.build]) {
      return;
    }
    const build = project.buildConfigs[item.data.build];

    let boardPath: string | undefined = undefined;
    if (path.isAbsolute(build.relBoardSubDir)) {
      boardPath = build.relBoardSubDir;
    } else {
      if (build.relBoardDir) {
        boardPath = path.join(this.wsConfig.rootPath, build.relBoardDir, build.relBoardSubDir);
      } else {
        const setupState = await getSetupState(this.context, this.wsConfig);
        if (setupState) {
          boardPath = path.join(setupState.zephyrDir, 'boards', build.relBoardSubDir);
        }
      }
    }

    if (boardPath) {
      const filePath = vscode.Uri.file(path.join(boardPath, build.board + ".dts"));
      try {
        const document = await vscode.workspace.openTextDocument(filePath);
        await vscode.window.showTextDocument(document);
      } catch {
        outputInfo("Project Config", `Board DTS file not found: ${filePath.fsPath}`);
      }
      void setActive(this.context, this.wsConfig, item.data.project!, item.data.build);
    }
  }

  async handleOpenMain(item: ConfigItem) {
    const project = this.wsConfig.projects[item.data.project!];
    const mainCPath = vscode.Uri.file(path.join(this.wsConfig.rootPath, project.rel_path, "src", "main.c"));

    try {
      const document = await vscode.workspace.openTextDocument(mainCPath);
      await vscode.window.showTextDocument(document);
    } catch {
      try {
        const mainCppPath = vscode.Uri.file(path.join(this.wsConfig.rootPath, project.rel_path, "src", "main.cpp"));
        const document = await vscode.workspace.openTextDocument(mainCppPath);
        await vscode.window.showTextDocument(document);
      } catch {
        outputInfo("Project Config", `Neither main.c nor main.cpp found in ${project.rel_path}/src`);
      }
    }
    void setActive(this.context, this.wsConfig, item.data.project!);
  }

  async handleOpenCmake(item: ConfigItem) {
    const project = this.wsConfig.projects[item.data.project!];
    const filePath = vscode.Uri.file(path.join(this.wsConfig.rootPath, project.rel_path, "CMakeLists.txt"));

    try {
      const document = await vscode.workspace.openTextDocument(filePath);
      await vscode.window.showTextDocument(document);
    } catch {
      outputInfo("Project Config", `CMakeLists.txt not found in ${project.rel_path}`);
    }
    void setActive(this.context, this.wsConfig, item.data.project!);
  }

  handleModifyBuildArgs(item: ConfigItem) {
    void modifyBuildArguments(this.context, this.wsConfig, item.data.project!, item.data.build!).finally(() => { void vscode.commands.executeCommand("zephyr-ide.update-web-view"); });
    void setActive(this.context, this.wsConfig, item.data.project!, item.data.build!);
  }

  handleModifyTestArgs(item: ConfigItem) {
    void vscode.commands.executeCommand("zephyr-ide.reconfigure-active-test");
    void setActive(this.context, this.wsConfig, item.data.project!);
  }

  handleAddFile(item: ConfigItem) {
    const isKConfig = item.contextValue?.includes('kconfig') ?? false;
    const isProjectLevel = !item.data.build;
    void addConfigFiles(this.context, this.wsConfig, isKConfig, isProjectLevel, item.data.project!, item.data.build).finally(() => { void vscode.commands.executeCommand("zephyr-ide.update-web-view"); });
  }

  handleDeleteFile(item: ConfigItem) {
    const isKConfig = item.data.fileCmd === "removeKConfigFile";
    const isProjectLevel = !item.data.build;
    void removeConfigFile(this.context, this.wsConfig, isKConfig, isProjectLevel, item.data.project!, !item.data.isExtra, [item.data.filename!], item.data.build).finally(() => { void vscode.commands.executeCommand("zephyr-ide.update-web-view"); });
  }
}
