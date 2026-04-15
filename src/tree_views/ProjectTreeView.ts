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
import { ProjectConfig, addTest, removeTest, setActive } from '../project_utilities/project';
import { BuildConfig } from '../project_utilities/build_selector';
import { RunnerConfig } from '../project_utilities/runner_selector';
import { WorkspaceConfig } from '../setup_utilities/types';
import { TwisterConfig } from '../project_utilities/twister_selector';
import { handleSharedProjectCommand } from './projectCommandHandler';
import { testHelper } from '../zephyr_utilities/twister';
import { outputError } from '../utilities/output';
import { sanitizeTreeId } from '../utilities/utils';

export function getUseGuiConfig(): boolean | undefined {
  const configuration = vscode.workspace.getConfiguration();
  return configuration.get("zephyr-ide.useGuiConfig")
    ?? configuration.get("zephyr-ide.use_gui_config");
}

export type ProjectTreeItemContext =
  | 'projectItem'
  | 'buildItem'
  | 'runnerItem'
  | 'testItem'
  | 'addBuildPlaceholder'
  | 'addRunnerPlaceholder';

export class ProjectTreeItem extends vscode.TreeItem {
  children: ProjectTreeItem[] = [];
  data: { project?: string; build?: string; runner?: string; test?: string; cmd?: string } = {};
  parent: ProjectTreeItem | undefined;

  constructor(
    label: string,
    icon: string,
    collapsible: boolean,
    contextValue: ProjectTreeItemContext | string,
    description?: string,
  ) {
    super(label, collapsible ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon(icon);
    this.contextValue = contextValue;
    if (description) {
      this.description = description;
    }
  }
}

export class ProjectTreeView implements vscode.TreeDataProvider<ProjectTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<ProjectTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private rootItems: ProjectTreeItem[] = [];
  public treeView: vscode.TreeView<ProjectTreeItem> | undefined;

  constructor(public extensionPath: string, private context: vscode.ExtensionContext, private wsConfig: WorkspaceConfig) {
  }

  private generateRunnerItem(projectName: string, buildName: string, runner: RunnerConfig): ProjectTreeItem {
    const buildStates = this.wsConfig.projectStates[projectName]?.buildStates;
    if (buildStates?.[buildName] && buildStates[buildName].runnerStates[runner.name] === undefined) {
      buildStates[buildName].runnerStates[runner.name] = { viewOpen: true };
    }

    const item = new ProjectTreeItem(runner.name, 'chip', false, 'runnerItem');
    item.id = `runner:${sanitizeTreeId(projectName)}:${sanitizeTreeId(buildName)}:${sanitizeTreeId(runner.name)}`;
    item.data = { project: projectName, build: buildName, runner: runner.name };
    item.command = { command: 'zephyr-ide.tree-view.select', title: 'Select', arguments: [item] };
    return item;
  }

  private generateBuildItem(projectName: string, build: BuildConfig): ProjectTreeItem {
    const buildState = this.wsConfig.projectStates[projectName]?.buildStates?.[build.name];
    const viewOpen = buildState?.viewOpen;

    const isActiveBuild = projectName === this.wsConfig.activeProject &&
      this.wsConfig.projectStates[projectName]?.activeBuildConfig === build.name;

    const item = new ProjectTreeItem(build.name, 'project', true, 'buildItem',
      build.board + (build.revision ? '@' + build.revision : ""));
    item.id = `build:${sanitizeTreeId(projectName)}:${sanitizeTreeId(build.name)}`;
    item.data = { project: projectName, build: build.name };
    item.collapsibleState = (viewOpen !== undefined ? viewOpen : true)
      ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed;

    if (isActiveBuild) {
      item.iconPath = new vscode.ThemeIcon('project', new vscode.ThemeColor('statusBar.background'));
    } else {
      item.command = { command: 'zephyr-ide.tree-view.select', title: 'Select', arguments: [item] };
    }

    for (const key in build.runnerConfigs) {
      const runnerItem = this.generateRunnerItem(projectName, build.name, build.runnerConfigs[key]);
      runnerItem.parent = item;
      item.children.push(runnerItem);
    }

    if (item.children.length === 0) {
      const placeholder = new ProjectTreeItem('Add Runner', 'add', false, 'addRunnerPlaceholder', 'Add Runner');
      placeholder.id = `placeholder:addRunner:${sanitizeTreeId(projectName)}:${sanitizeTreeId(build.name)}`;
      placeholder.data = { project: projectName, build: build.name, cmd: "addRunner" };
      placeholder.command = { command: 'zephyr-ide.tree-view.add-runner', title: 'Add Runner', arguments: [placeholder] };
      placeholder.parent = item;
      item.children.push(placeholder);
    }

    return item;
  }

  private generateTestItem(projectName: string, test: TwisterConfig): ProjectTreeItem {
    const twisterStates = this.wsConfig.projectStates[projectName]?.twisterStates;
    if (twisterStates && twisterStates[test.name] === undefined) {
      twisterStates[test.name] = { viewOpen: true };
    }

    const item = new ProjectTreeItem(test.name, 'beaker', false, 'testItem', test.platform);
    item.id = `test:${sanitizeTreeId(projectName)}:${sanitizeTreeId(test.name)}`;
    item.data = { project: projectName, test: test.name };
    item.command = { command: 'zephyr-ide.tree-view.select', title: 'Select', arguments: [item] };
    return item;
  }

  private generateProjectItem(project: ProjectConfig): ProjectTreeItem {
    const projectState = this.wsConfig.projectStates[project.name];
    const viewOpen = projectState?.viewOpen;

    const isActive = this.wsConfig.activeProject === project.name;

    const item = new ProjectTreeItem(project.name, 'folder', true, 'projectItem');
    item.id = `project:${sanitizeTreeId(project.name)}`;
    item.data = { project: project.name };
    item.collapsibleState = (viewOpen !== undefined ? viewOpen : true)
      ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed;

    if (isActive) {
      item.iconPath = new vscode.ThemeIcon('folder-opened', new vscode.ThemeColor('statusBar.background'));
    } else {
      item.command = { command: 'zephyr-ide.tree-view.select', title: 'Select', arguments: [item] };
    }

    for (const key in project.buildConfigs) {
      const buildItem = this.generateBuildItem(project.name, project.buildConfigs[key]);
      buildItem.parent = item;
      item.children.push(buildItem);
    }

    for (const key in project.twisterConfigs) {
      const testItem = this.generateTestItem(project.name, project.twisterConfigs[key]);
      testItem.parent = item;
      item.children.push(testItem);
    }

    if (item.children.length === 0) {
      const placeholder = new ProjectTreeItem('Add Build', 'add', false, 'addBuildPlaceholder', 'Add Build');
      placeholder.id = `placeholder:addBuild:${sanitizeTreeId(project.name)}`;
      placeholder.data = { project: project.name, cmd: "addBuild" };
      placeholder.command = { command: 'zephyr-ide.tree-view.add-build', title: 'Add Build', arguments: [placeholder] };
      placeholder.parent = item;
      item.children.push(placeholder);
    }

    return item;
  }

  updateWebView(wsConfig: WorkspaceConfig) {
    this.rootItems = [];
    for (const key in wsConfig.projects) {
      this.rootItems.push(this.generateProjectItem(wsConfig.projects[key]));
    }
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: ProjectTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: ProjectTreeItem): ProjectTreeItem[] {
    if (!element) {
      return this.rootItems;
    }
    return element.children;
  }

  getParent(element: ProjectTreeItem): ProjectTreeItem | undefined {
    return element.parent;
  }

  /** Track expand/collapse for state persistence */
  handleExpand(element: ProjectTreeItem) {
    this.updateOpenState(element, true);
  }

  handleCollapse(element: ProjectTreeItem) {
    this.updateOpenState(element, false);
  }

  private updateOpenState(element: ProjectTreeItem, open: boolean) {
    try {
      const projectName = element.data.project;
      if (!projectName || !this.wsConfig.projectStates[projectName]) {
        return;
      }

      if (element.contextValue === 'projectItem') {
        this.wsConfig.projectStates[projectName].viewOpen = open;
      } else if (element.contextValue === 'buildItem' && element.data.build) {
        const buildStates = this.wsConfig.projectStates[projectName].buildStates;
        if (buildStates?.[element.data.build]) {
          buildStates[element.data.build].viewOpen = open;
        }
      }
    } catch (e: any) {
      outputError("ProjectTreeView", e.message ?? String(e));
    }
  }

  /** Handle clicking a tree item — sets the active project/build/runner/test */
  handleSelect(item: ProjectTreeItem) {
    const p = item.data.project;
    if (!p) {
      return;
    }

    // Skip the full setActive round-trip if nothing actually changes
    const state = this.wsConfig.projectStates[p];
    const alreadyActiveProject = this.wsConfig.activeProject === p;
    const alreadyActiveBuild = !item.data.build || state?.activeBuildConfig === item.data.build;
    const alreadyActiveRunner = !item.data.runner ||
      (item.data.build && state?.buildStates?.[item.data.build]?.activeRunner === item.data.runner);
    const alreadyActiveTest = !item.data.test || state?.activeTwisterConfig === item.data.test;

    if (alreadyActiveProject && alreadyActiveBuild && alreadyActiveRunner && alreadyActiveTest) {
      return;
    }

    void setActive(this.context, this.wsConfig, p, item.data.build, item.data.runner, item.data.test);
  }

  // Command handlers for inline actions

  handleAddTest(item: ProjectTreeItem) {
    void addTest(this.wsConfig, this.context, item.data.project!).finally(() => { void setActive(this.context, this.wsConfig, item.data.project!); });
  }

  handleDeleteTest(item: ProjectTreeItem) {
    void removeTest(this.context, this.wsConfig, item.data.project!, item.data.test!).finally(() => { void setActive(this.context, this.wsConfig, item.data.project!); });
  }

  handleTest(item: ProjectTreeItem) {
    void testHelper(this.context, this.wsConfig, item.data.project!, item.data.test!);
    void setActive(this.context, this.wsConfig, item.data.project!, undefined, undefined, item.data.test!);
  }

  /** Delegate to the shared command handler for build/flash/delete operations */
  handleSharedCommand(command: string, item: ProjectTreeItem) {
    handleSharedProjectCommand(this.context, this.wsConfig, command, item.data, true);
  }
}

