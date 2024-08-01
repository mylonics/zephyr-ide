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
import path from "path";

import { getShellEnvironment, executeTaskHelper } from "../utilities/utils";

import { ProjectConfig } from "../project_utilities/project";

import { WorkspaceConfig } from '../setup_utilities/setup';
import { BuildConfig } from "../project_utilities/build_selector";
import { RunnerConfig } from "../project_utilities/runner_selector";

export async function flashByName(wsConfig: WorkspaceConfig, projectName: string, buildName: string, runnerName: string) {
  let project = wsConfig.projects[projectName];
  let buildConfig = project.buildConfigs[buildName];
  let runnerConfig = buildConfig.runnerConfigs[runnerName];
  if (project && buildConfig && runnerConfig) {
    await flash(wsConfig, project, buildConfig, runnerConfig);
  } else {
    vscode.window.showErrorMessage("Invalid project or build");
  }
}

export async function flashActive(wsConfig: WorkspaceConfig) {

  if (wsConfig.activeProject === undefined) {
    vscode.window.showErrorMessage("Select a project before trying to flash");
    return;
  }
  let projectName = wsConfig.activeProject;
  let project = wsConfig.projects[projectName];
  let activeBuildConfig = wsConfig.projectStates[wsConfig.activeProject].activeBuildConfig;

  if (activeBuildConfig === undefined) {
    vscode.window.showErrorMessage("Select a build before trying to flash");
    return;
  }
  let build = project.buildConfigs[activeBuildConfig];
  let activeRunnerConfig = wsConfig.projectStates[wsConfig.activeProject].buildStates[activeBuildConfig].activeRunner;

  if (activeRunnerConfig === undefined) {
    vscode.window.showErrorMessage("Select a runner before trying to flash");
    return;
  }
  let runner = build.runnerConfigs[activeRunnerConfig];
  flash(wsConfig, project, build, runner);
}

export async function flash(wsConfig: WorkspaceConfig, project: ProjectConfig, build: BuildConfig, runner: RunnerConfig) {
  //let cmds = await vscode.commands.getCommands();
  //const subArr = cmds.filter(str => str.includes("debug"));

  // Tasks
  let cmd = `west flash --build-dir ${path.join(wsConfig.rootPath, project.rel_path, build.name)}`;

  if (runner.runner !== "default") {
    cmd += ` -r ${runner.runner}`;
  }
  cmd += ` ${runner.args}`;

  let taskName = "Zephyr IDE Flash: " + project.name + " " + build.name;

  vscode.window.showInformationMessage(`Flashing for ${build.name}`);
  await executeTaskHelper(taskName, cmd, getShellEnvironment(wsConfig.activeSetupState), wsConfig.activeSetupState?.setupPath);
}
