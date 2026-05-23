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

import { ProjectConfig, getResolvedProfile, getBindOverride, getResolvedTestConfig, resolveActiveProject, resolveActiveProjectBuild, getEffectiveActiveProfileName } from '../project_utilities/project';
import { BuildConfig } from '../project_utilities/build_selector';
import { WorkspaceConfig } from '../setup_utilities/types';
import { TwisterConfig } from "../project_utilities/twister_selector";
import { formatBindLabel, RunnerProfile } from '../project_utilities/runner_profiles';
import { RUNNER_TARGET_PREFIX, WEST_FLASH_PREFIX, CORTEX_DEBUG_PREFIX, WEST_DEBUG_PREFIX } from '../utilities/utils';

export type ActiveProjectItemContext =
  | 'activeProject.buildPristine'
  | 'activeProject.build'
  | 'activeProject.flash'
  | 'activeProject.buildFlash'
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
    let activeProfile: RunnerProfile | undefined;
    let activeTwister: TwisterConfig | undefined;
    let resolvedBuild: ReturnType<typeof resolveActiveProjectBuild> | undefined;
    const resolvedProject = resolveActiveProject(this.wsConfig);
    if (resolvedProject) {
      activeProject = resolvedProject.project;
      resolvedBuild = resolveActiveProjectBuild(this.wsConfig);
      activeBuild = resolvedBuild?.build;
      if (resolvedBuild) {
        activeProfile = getResolvedProfile(this.wsConfig, resolvedBuild);
        this.title = activeProject.name + ": " + resolvedBuild.build.name;
      } else {
        this.title = activeProject.name;
      }
      activeTwister = getResolvedTestConfig(this.wsConfig, resolvedProject);
    } else {
      this.title = "No Active Project";
      return [];
    }

    // 3-bind model: Flash drives Flash + Build-and-Flash; the unified `debug`
    // bind drives Debug + Build-and-Debug; `attach` is dedicated.
    // When `zephyr-ide.separateBuildDebugProfile` is on and the profile has a
    // dedicated `buildDebug` slot, show it separately for Build-and-Debug.
    const separateBuildDebug = !!vscode.workspace.getConfiguration().get<boolean>("zephyr-ide.separateBuildDebugProfile");
    const profileScope = resolvedBuild ? getEffectiveActiveProfileName(this.wsConfig, resolvedBuild).scope : "none";
    const localSuffix = profileScope === "local" ? " (local)" : "";

    // Local bind overrides take priority over profile display per slot.
    const localBinds = resolvedBuild
      ? this.wsConfig.projectStates[resolvedBuild.projectName]?.buildStates?.[resolvedBuild.buildName]?.localBinds
      : undefined;
    const slotDesc = (slot: "flash" | "debug" | "attach", profileDisplay: string): string => {
      const lb = localBinds?.[slot];
      if (lb === null) { return "auto (local bind)"; }
      if (typeof lb === "string") {
        const prefixes = [WEST_FLASH_PREFIX, CORTEX_DEBUG_PREFIX, WEST_DEBUG_PREFIX, RUNNER_TARGET_PREFIX];
        const matchedPrefix = prefixes.find(p => lb.startsWith(p));
        const displayName = matchedPrefix ? lb.slice(matchedPrefix.length) : lb;
        return `${displayName} (local bind)`;
      }
      return profileDisplay;
    };

    const flashProfile = activeProfile
      ? formatBindLabel(activeProfile.flash, activeBuild && getBindOverride(activeBuild, "flash")) + localSuffix
      : "None";
    const debugProfile = activeProfile
      ? formatBindLabel(activeProfile.debug, activeBuild && getBindOverride(activeBuild, "debug")) + localSuffix
      : "None";
    const buildDebugProfile = separateBuildDebug && activeProfile?.buildDebug
      ? formatBindLabel(activeProfile.buildDebug, activeBuild && getBindOverride(activeBuild, "buildDebug")) + localSuffix
      : debugProfile;
    const attachProfile = activeProfile
      ? formatBindLabel(activeProfile.attach, activeBuild && getBindOverride(activeBuild, "attach")) + localSuffix
      : "None";

    const flashDisplay = slotDesc("flash", flashProfile);
    const debugDisplay = slotDesc("debug", debugProfile);
    const buildDebugDisplay = slotDesc("debug", buildDebugProfile);
    const attachDisplay = slotDesc("attach", attachProfile);

    const items: ActiveProjectItem[] = [
      new ActiveProjectItem("Build Pristine", "project", activeBuild ? activeBuild.name : "None",
        'activeProject.buildPristine', "zephyr-ide.build-pristine"),
      new ActiveProjectItem("Build", "project", activeBuild ? activeBuild.name : "None",
        'activeProject.build', "zephyr-ide.build"),
      new ActiveProjectItem("Flash", "chip", flashDisplay,
        'activeProject.flash', "zephyr-ide.flash"),
      new ActiveProjectItem("Build and Flash", "cloud-upload", flashDisplay,
        'activeProject.buildFlash', "zephyr-ide.build-flash"),
      new ActiveProjectItem("Debug", "debug-alt", debugDisplay,
        'activeProject.debug', "zephyr-ide.debug"),
      new ActiveProjectItem("Build and Debug", "debug-all", buildDebugDisplay,
        'activeProject.buildDebug', "zephyr-ide.build-debug"),
      new ActiveProjectItem("Debug Attach", "debug-console", attachDisplay,
        'activeProject.debugAttach', "zephyr-ide.debug-attach"),
    ];

    if (activeProject.twisterConfigs && Object.keys(activeProject.twisterConfigs).length) {
      items.push(new ActiveProjectItem("Run Tests", "beaker", activeTwister ? activeTwister.name : "",
        'activeProject.twisterRun', "zephyr-ide.run-test"));
    }

    return items;
  }
}

