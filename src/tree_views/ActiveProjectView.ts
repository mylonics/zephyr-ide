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

import { ProjectConfig, getResolvedRunnerConfig, getResolvedTestConfig, resolveActiveProject, resolveActiveProjectBuild } from '../project_utilities/project';
import { BuildConfig } from '../project_utilities/build_selector';
import { RunnerConfig } from '../project_utilities/runner_selector';
import { WorkspaceConfig } from '../setup_utilities/types';
import { TwisterConfig } from "../project_utilities/twister_selector";
import { getLaunchTargetDisplayName } from '../utilities/utils';

export type ActiveProjectItemContext =
  | 'activeProject.buildPristine'
  | 'activeProject.build'
  | 'activeProject.flash'
  | 'activeProject.debug'
  | 'activeProject.buildDebug'
  | 'activeProject.debugAttach'
  | 'activeProject.twisterRun';

class ActiveProjectItem extends vscode.TreeItem {
  constructor(
    label: string,
    icon: string,
    description: string,
    public readonly contextId: ActiveProjectItemContext,
    commandId: string,
    public readonly launchChangeCmd?: string,
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon(icon);
    this.description = description;
    this.contextValue = contextId;
    this.command = { command: commandId, title: label };
  }
}

export class ActiveProjectView implements vscode.TreeDataProvider<ActiveProjectItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<ActiveProjectItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  public title: string = "Active Project: None";

  constructor(public extensionPath: string, private context: vscode.ExtensionContext, private wsConfig: WorkspaceConfig) { }

  updateWebView(wsConfig: WorkspaceConfig) {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: ActiveProjectItem): vscode.TreeItem {
    return element;
  }

  getParent(): undefined {
    return undefined;
  }

  getChildren(): ActiveProjectItem[] {
    let activeProject: ProjectConfig | undefined;
    let activeBuild: BuildConfig | undefined;
    let activeRunner: RunnerConfig | undefined;
    let activeTwister: TwisterConfig | undefined;
    const resolvedProject = resolveActiveProject(this.wsConfig);
    if (resolvedProject) {
      activeProject = resolvedProject.project;
      const resolved = resolveActiveProjectBuild(this.wsConfig);
      activeBuild = resolved?.build;
      if (resolved) {
        activeRunner = getResolvedRunnerConfig(this.wsConfig, resolved);
        this.title = activeProject.name + ": " + resolved.build.name;
      } else {
        this.title = activeProject.name;
      }
      activeTwister = getResolvedTestConfig(this.wsConfig, resolvedProject);
    } else {
      this.title = "No Active Project";
      return [];
    }

    const debugDisplay = getLaunchTargetDisplayName(activeBuild?.launchTarget ?? "", activeBuild?.launchTargetFolder, "Zephyr IDE: Debug");
    const buildDebugDisplay = getLaunchTargetDisplayName(activeBuild?.buildDebugTarget ?? "", activeBuild?.buildDebugTargetFolder, "Zephyr IDE: Debug");
    const attachDisplay = getLaunchTargetDisplayName(activeBuild?.attachTarget ?? "", activeBuild?.attachTargetFolder, "Zephyr IDE: Attach");

    const items: ActiveProjectItem[] = [
      new ActiveProjectItem("Build Pristine", "project", activeBuild ? activeBuild.name : "None",
        'activeProject.buildPristine', "zephyr-ide.build-pristine"),
      new ActiveProjectItem("Build", "project", activeBuild ? activeBuild.name : "None",
        'activeProject.build', "zephyr-ide.build"),
      new ActiveProjectItem("Flash", "chip", activeRunner ? activeRunner.name : "None",
        'activeProject.flash', "zephyr-ide.flash"),
      new ActiveProjectItem("Debug", "debug-alt", debugDisplay,
        'activeProject.debug', "zephyr-ide.debug", "zephyr-ide.change-debug-launch-for-build"),
      new ActiveProjectItem("Build and Debug", "debug-all", buildDebugDisplay,
        'activeProject.buildDebug', "zephyr-ide.build-debug", "zephyr-ide.change-build-debug-launch-for-build"),
      new ActiveProjectItem("Debug Attach", "debug-console", attachDisplay,
        'activeProject.debugAttach', "zephyr-ide.debug-attach", "zephyr-ide.change-debug-attach-launch-for-build"),
    ];

    if (activeProject.twisterConfigs && Object.keys(activeProject.twisterConfigs).length) {
      items.push(new ActiveProjectItem("Run Tests", "beaker", activeTwister ? activeTwister.name : "",
        'activeProject.twisterRun', "zephyr-ide.run-test"));
    }

    return items;
  }
}

