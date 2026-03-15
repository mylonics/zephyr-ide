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

import { executeTaskHelperInPythonEnv } from "../utilities/utils";
import { notifyError, outputInfo } from "../utilities/output";

import { ProjectConfig, resolveActiveProjectBuildRunner, getBuildFolder } from "../project_utilities/project";

import { WorkspaceConfig } from '../setup_utilities/types';
import { BuildConfig } from "../project_utilities/build_selector";
import { RunnerConfig } from "../project_utilities/runner_selector";
import { getSetupStateOrNotify } from "../setup_utilities/workspace-config";

export async function flashByName(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, projectName: string, buildName: string, runnerName: string) {
  let project = wsConfig.projects[projectName];
  if (!project) {
    notifyError("Flash", `Project not found: "${projectName}"`);
    return;
  }
  let buildConfig = project.buildConfigs[buildName];
  if (!buildConfig) {
    notifyError("Flash", `Build configuration not found: "${buildName}" in project "${projectName}"`);
    return;
  }
  let runnerConfig = buildConfig.runnerConfigs[runnerName];
  if (runnerConfig) {
    await flash(context, wsConfig, project, buildConfig, runnerConfig);
  } else {
    notifyError("Flash", `Runner not found: "${runnerName}" in build "${buildName}"`);
  }
}

export async function flashActive(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig) {
  const resolved = resolveActiveProjectBuildRunner(wsConfig, { caller: "Flash" });
  if (!resolved) { return; }

  await flash(context, wsConfig, resolved.project, resolved.build, resolved.runner);
}

export async function flash(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, project: ProjectConfig, build: BuildConfig, runner: RunnerConfig) {
  // Tasks
  let cmd = `west flash --build-dir "${getBuildFolder(wsConfig, project, build)}"`;

  if (runner.runner !== "default") {
    cmd += ` -r ${runner.runner}`;
  }
  cmd += ` ${runner.args ?? ""}`;

  let taskName = "Zephyr IDE Flash: " + project.name + " " + build.name;

  outputInfo(`Flash: ${project.name}/${build.name}`, `Flashing ${build.name} from project: ${project.name} (cmd: ${cmd})`, true);
  const setupState = await getSetupStateOrNotify(context, wsConfig, "Flash");
  if (!setupState) {
    return;
  }
  await executeTaskHelperInPythonEnv(setupState, taskName, cmd, setupState.setupPath);
}
