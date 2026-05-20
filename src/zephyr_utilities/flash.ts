/*
Copyright 2024-2026 mylonics 
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

import { executeTaskHelperInPythonEnv } from "../utilities/utils";
import { notifyError, outputInfo, outputWarning } from "../utilities/output";

import { ProjectConfig, resolveActiveProjectBuild, getBuildFolder } from "../project_utilities/project";

import { WorkspaceConfig } from '../setup_utilities/types';
import { BuildConfig } from "../project_utilities/build_selector";
import { loadRunnerProfiles, findRunnerProfile, resolveBind, resolveRunnerArgs } from "../project_utilities/runner_profiles";
import { getSetupStateOrNotify } from "../setup_utilities/workspace-config";

export async function flashByName(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, projectName: string, buildName: string, profileName?: string) {
  const project = wsConfig.projects[projectName];
  if (!project) {
    notifyError("Flash", `Project not found: "${projectName}"`);
    return;
  }
  const buildConfig = project.buildConfigs[buildName];
  if (!buildConfig) {
    notifyError("Flash", `Build configuration not found: "${buildName}" in project "${projectName}"`);
    return;
  }

  // Default: "default" runner + no args (west picks from runners.yaml).
  let runner = "default", args = "";
  const effectiveProfileName = profileName ?? buildConfig.activeProfile;
  if (effectiveProfileName) {
    const profile = findRunnerProfile(effectiveProfileName, loadRunnerProfiles(wsConfig));
    if (!profile) {
      notifyError("Flash", `Runner profile not found: "${effectiveProfileName}"`);
      return;
    }
    if (profile.flash.kind === "launch") {
      outputWarning("Flash", `Profile "${effectiveProfileName}" has flash bind set to launch.json config, which is not valid for flashing. Using default runner.`);
    } else {
      const r = resolveBind(profile.flash, buildConfig.bindOverrides?.flash);
      if (r) { runner = r.runner; args = r.args; }
    }
  }

  await flash(context, wsConfig, project, buildConfig, runner, args);
}

export async function flashActive(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig) {
  const resolved = resolveActiveProjectBuild(wsConfig, { caller: "Flash" });
  if (!resolved) { return; }

  let runner = "default", args = "";
  const profileName = resolved.build.activeProfile;
  if (profileName) {
    const profile = findRunnerProfile(profileName, loadRunnerProfiles(wsConfig));
    if (profile) {
      if (profile.flash.kind === "launch") {
        outputWarning("Flash", `Profile "${profileName}" has flash bind set to launch.json config, which is not valid for flashing. Using default runner.`);
      } else {
        const r = resolveBind(profile.flash, resolved.build.bindOverrides?.flash);
        if (r) { runner = r.runner; args = r.args; }
      }
    }
  }

  await flash(context, wsConfig, resolved.project, resolved.build, runner, args);
}

export async function flash(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, project: ProjectConfig, build: BuildConfig, runner: string, args: string) {
  // Tasks
  const buildFolder = getBuildFolder(wsConfig, project, build);
  let cmd = `west flash --build-dir "${buildFolder}"`;

  // Forward the user-selected sysbuild image (set via "Zephyr IDE: Set
  // Sysbuild Image") to `west flash --domain` so Flash targets the same image
  // the Debug provider would (parity with debug-provider.ts:resolveRunnersYamlPath).
  // When no sysbuild domain is selected, west chooses the default domain itself.
  const sysbuildImage = wsConfig.projectStates?.[project.name]?.buildStates?.[build.name]?.sysbuildImage;
  if (sysbuildImage) {
    cmd += ` --domain ${sysbuildImage}`;
  }

  if (runner !== "default") {
    cmd += ` -r ${runner}`;
  }
  const resolvedArgs = resolveRunnerArgs(args, {
    workspaceFolder: wsConfig.rootPath,
    buildFolder,
    board: build.board,
    boardRevision: build.revision ?? "",
    project: project.name,
    build: build.name,
    buildVars: build.customVars,
    projectVars: project.customVars,
  });
  const trimmedArgs = resolvedArgs.trim();
  if (trimmedArgs) { cmd += ` ${trimmedArgs}`; }

  const taskName = "Zephyr IDE Flash: " + project.name + " " + build.name;

  outputInfo(`Flash: ${project.name}/${build.name}`, `Flashing ${build.name} from project: ${project.name} (cmd: ${cmd})`, true);
  const setupState = await getSetupStateOrNotify(context, wsConfig, "Flash");
  if (!setupState) {
    return;
  }
  await executeTaskHelperInPythonEnv(setupState, taskName, cmd, setupState.setupPath);
}
