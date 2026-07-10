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
  | 'activeProject.twisterRun'
  | 'activeProject.buildDashboard'
  | `activeProject.${string}`;  // dynamic contexts with flag suffixes (e.g. activeProject.build.withPristine.withKconfig)

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
        const [runnerPart, queryPart] = lb.split('?');
        let localProbe: string | undefined;
        if (queryPart) {
          const parts = queryPart.split('&');
          for (const p of parts) {
            const [k, v] = p.split('=');
            if (k === "probe") {
              localProbe = decodeURIComponent(v);
            }
          }
        }
        const prefixTypeMap: [string, string][] = [
          [WEST_FLASH_PREFIX, "flash"],
          [CORTEX_DEBUG_PREFIX, "cortex-debug"],
          [WEST_DEBUG_PREFIX, "west debugserver"],
          [RUNNER_TARGET_PREFIX, "west debugserver"],  // legacy prefix
        ];
        const matched = prefixTypeMap.find(([p]) => runnerPart.startsWith(p));
        let runnerName = matched ? runnerPart.slice(matched[0].length) : runnerPart;
        if (localProbe) {
          const probeName = localProbe.startsWith("interface/") ? localProbe.slice("interface/".length) : localProbe;
          runnerName = `${runnerName} (${probeName})`;
        }
        const typeLabel = matched ? matched[1] : "";
        return typeLabel
          ? `${runnerName} [${typeLabel}] (local bind)`
          : `${runnerName} (local bind)`;
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

    const cfg = vscode.workspace.getConfiguration();
    const showBuildPristine = cfg.get<boolean>("zephyr-ide.activeProjectPanel.showBuildPristine") ?? true;
    const showBuild = cfg.get<boolean>("zephyr-ide.activeProjectPanel.showBuild") ?? true;
    const showFlash = cfg.get<boolean>("zephyr-ide.activeProjectPanel.showFlash") ?? true;
    const showBuildFlash = cfg.get<boolean>("zephyr-ide.activeProjectPanel.showBuildFlash") ?? false;
    const showBuildDebug = cfg.get<boolean>("zephyr-ide.activeProjectPanel.showBuildDebug") ?? false;
    const showDebug = cfg.get<boolean>("zephyr-ide.activeProjectPanel.showDebug") ?? true;
    const showAttach = cfg.get<boolean>("zephyr-ide.activeProjectPanel.showAttach") ?? true;
    const showBuildDashboard = cfg.get<boolean>("zephyr-ide.activeProjectPanel.showBuildDashboard") ?? false;

    // Build dynamic context values encoding which inline-action buttons are present.
    // Flag suffixes: .withPristine (build-pristine button), .withKconfig (kconfig button),
    //                .withBuildFlash (build-flash button), .withBuildDebug (build-debug button)
    // Example: activeProject.build.withPristine.withKconfig
    let buildContextFlags = '';
    if (!showBuildPristine) { buildContextFlags += '.withPristine'; }
    if (!showBuildDashboard) { buildContextFlags += '.withKconfig'; }
    const buildContextValue = `activeProject.build${buildContextFlags}` as ActiveProjectItemContext;

    let buildPristineContextFlags = '';
    if (!showBuildDashboard) { buildPristineContextFlags += '.withKconfig'; }
    const buildPristineContextValue = `activeProject.buildPristine${buildPristineContextFlags}` as ActiveProjectItemContext;

    const flashContextValue = !showBuildFlash ? 'activeProject.flash.withBuildFlash' : 'activeProject.flash';
    const debugContextValue = !showBuildDebug ? 'activeProject.debug.withBuildDebug' : 'activeProject.debug';

    const items: ActiveProjectItem[] = [];
    if (showBuildPristine) {
      items.push(new ActiveProjectItem("Build Pristine", "project", activeBuild ? activeBuild.name : "None",
        buildPristineContextValue, "zephyr-ide.build-pristine"));
    }
    if (showBuild) {
      items.push(new ActiveProjectItem("Build", "project", activeBuild ? activeBuild.name : "None",
        buildContextValue, "zephyr-ide.build"));
    }
    if (showFlash) {
      items.push(new ActiveProjectItem("Flash", "chip", flashDisplay,
        flashContextValue, "zephyr-ide.flash"));
    }
    if (showBuildFlash) {
      items.push(new ActiveProjectItem("Build and Flash", "cloud-upload", flashDisplay,
        'activeProject.buildFlash', "zephyr-ide.build-flash"));
    }
    if (showDebug) {
      items.push(new ActiveProjectItem("Debug", "debug-alt", debugDisplay,
        debugContextValue, "zephyr-ide.debug"));
    }
    if (showBuildDebug) {
      items.push(new ActiveProjectItem("Build and Debug", "debug-all", buildDebugDisplay,
        'activeProject.buildDebug', "zephyr-ide.build-debug"));
    }
    if (showAttach) {
      items.push(new ActiveProjectItem("Debug Attach", "debug-console", attachDisplay,
        'activeProject.debugAttach', "zephyr-ide.debug-attach"));
    }

    if (activeProject.twisterConfigs && Object.keys(activeProject.twisterConfigs).length) {
      items.push(new ActiveProjectItem("Run Tests", "beaker", activeTwister ? activeTwister.name : "",
        'activeProject.twisterRun', "zephyr-ide.run-test"));
    }

    if (showBuildDashboard) {
      items.push(new ActiveProjectItem("Build Dashboard", "dashboard", activeBuild ? activeBuild.name : "None",
        'activeProject.buildDashboard', "zephyr-ide.run-dashboard"));
    }

    return items;
  }
}

