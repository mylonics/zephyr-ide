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
import path from "upath";

import { executeTaskHelperInPythonEnv } from "../utilities/utils";
import { notifyError, outputInfo } from "../utilities/output";

import { ProjectConfig } from "../project_utilities/project";

import { WorkspaceConfig } from '../setup_utilities/types';
import { BuildConfig } from "../project_utilities/build_selector";
import { RunnerConfig } from "../project_utilities/runner_selector";
import { getSetupState } from "../setup_utilities/workspace-config";

export async function flashByName(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, projectName: string, buildName: string, runnerName: string) {
  let project = wsConfig.projects[projectName];
  let buildConfig = project.buildConfigs[buildName];
  let runnerConfig = buildConfig.runnerConfigs[runnerName];
  if (project && buildConfig && runnerConfig) {
    await flash(context, wsConfig, project, buildConfig, runnerConfig);
  } else {
    notifyError("Flash", "Invalid project or build");
  }
}

export async function flashActive(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig) {

  if (wsConfig.activeProject === undefined) {
    notifyError("Flash", "Select a project before trying to flash");
    return;
  }
  let projectName = wsConfig.activeProject;
  let project = wsConfig.projects[projectName];
  let activeBuildConfig = wsConfig.projectStates[wsConfig.activeProject].activeBuildConfig;

  if (activeBuildConfig === undefined) {
    notifyError("Flash", "Select a build before trying to flash");
    return;
  }
  let build = project.buildConfigs[activeBuildConfig];
  let activeRunnerConfig = wsConfig.projectStates[wsConfig.activeProject].buildStates[activeBuildConfig].activeRunner;

  if (activeRunnerConfig === undefined) {
    notifyError("Flash", "Select a runner before trying to flash");
    return;
  }
  let runner = build.runnerConfigs[activeRunnerConfig];
  flash(context, wsConfig, project, build, runner);
}

export async function flash(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, project: ProjectConfig, build: BuildConfig, runner: RunnerConfig) {
  //let cmds = await vscode.commands.getCommands();
  //const subArr = cmds.filter(str => str.includes("debug"));

  // Tasks
  let cmd = `west flash --build-dir "${path.join(wsConfig.rootPath, project.rel_path, build.name)}"`;

  if (runner.runner !== "default") {
    cmd += ` -r ${runner.runner}`;
  }
  cmd += ` ${runner.args}`;

  let taskName = "Zephyr IDE Flash: " + project.name + " " + build.name;

  outputInfo(`Flash: ${project.name}/${build.name}`, `Flashing ${build.name} from project: ${project.name} (cmd: ${cmd})`, true);
  const setupState = await getSetupState(context, wsConfig);
  await executeTaskHelperInPythonEnv(setupState, taskName, cmd, setupState?.setupPath);
}
