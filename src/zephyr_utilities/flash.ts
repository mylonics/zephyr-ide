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
import { loadRunnerVariants, resolveBind } from "../project_utilities/runner_variants";
import { getSetupStateOrNotify } from "../setup_utilities/workspace-config";

export async function flashByName(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, projectName: string, buildName: string, runnerName?: string) {
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
  
  let runner = "default", args = "";
  if (runnerName) {
    // Fall back to project-level runners ("inherited by builds with same name")
    // when the build doesn't define one under that name.
    const runnerConfig = buildConfig.runnerConfigs[runnerName] ?? project.runnerConfigs?.[runnerName];
    if (runnerConfig) {
      const variants = loadRunnerVariants(wsConfig);
      const resolved = resolveBind(runnerConfig.flash, variants);
      if (resolved) {
        runner = resolved.runner;
        args = resolved.args;
      }
      if (runnerConfig.flash.kind === "launch") {
        outputWarning("Flash", `Runner "${runnerName}" has flash bind set to launch.json config, which is not valid for flashing. Using default runner.`);
      }
    } else {
      notifyError("Flash", `Runner not found: "${runnerName}" in build "${buildName}" or project "${projectName}"`);
      return;
    }
  }

  await flash(context, wsConfig, project, buildConfig, runner, args);
}

export async function flashActive(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig) {
  const resolved = resolveActiveProjectBuild(wsConfig, { caller: "Flash" });
  if (!resolved) { return; }

  const activeRunnerName = wsConfig.projectStates?.[resolved.projectName]?.buildStates?.[resolved.buildName]?.activeRunner;
  let runner = "default", args = "";

  // Fall back to project-level runner configs when the build doesn't define one
  // under that name (matches the "inherited by builds with same name" UI promise).
  const activeRunnerConfig = activeRunnerName
    ? (resolved.build.runnerConfigs[activeRunnerName]
       ?? resolved.project.runnerConfigs?.[activeRunnerName])
    : undefined;

  if (activeRunnerName && activeRunnerConfig) {
    const rc = activeRunnerConfig;
    const variants = loadRunnerVariants(wsConfig);
    const resolved2 = resolveBind(rc.flash, variants);
    if (resolved2) {
      runner = resolved2.runner;
      args = resolved2.args;
    }
    // If kind is "launch", log a warning
    if (rc.flash.kind === "launch") {
      outputWarning("Flash", `Runner "${activeRunnerName}" has flash bind set to launch.json config, which is not valid for flashing. Using default runner.`);
    }
  }

  await flash(context, wsConfig, resolved.project, resolved.build, runner, args);
}

export async function flash(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, project: ProjectConfig, build: BuildConfig, runner: string, args: string) {
  // Tasks
  let cmd = `west flash --build-dir "${getBuildFolder(wsConfig, project, build)}"`;

  if (runner !== "default") {
    cmd += ` -r ${runner}`;
  }
  const trimmedArgs = args.trim();
  if (trimmedArgs) { cmd += ` ${trimmedArgs}`; }

  const taskName = "Zephyr IDE Flash: " + project.name + " " + build.name;

  outputInfo(`Flash: ${project.name}/${build.name}`, `Flashing ${build.name} from project: ${project.name} (cmd: ${cmd})`, true);
  const setupState = await getSetupStateOrNotify(context, wsConfig, "Flash");
  if (!setupState) {
    return;
  }
  await executeTaskHelperInPythonEnv(setupState, taskName, cmd, setupState.setupPath);
}
