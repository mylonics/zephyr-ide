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
import { notifyError, outputInfo } from "../utilities/output";

import { ProjectConfig, resolveActiveProjectBuild, resolveActiveProjectBuildRunner, getBuildFolder } from "../project_utilities/project";

import { WorkspaceConfig } from '../setup_utilities/types';
import { BuildConfig } from "../project_utilities/build_selector";
import { RunnerConfig, resolveEffectiveRunner } from "../project_utilities/runner_selector";
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
  // Issue #13: when no runner name is supplied, fall back to the synthetic
  // default runner so callers can flash a build that has no runner profile.
  if (!runnerName) {
    await flash(context, wsConfig, project, buildConfig, SYNTHETIC_DEFAULT_RUNNER, SYNTHETIC_DEFAULT_EFFECTIVE);
    return;
  }
  const runnerConfig = buildConfig.runnerConfigs[runnerName];
  if (runnerConfig) {
    const effectiveRunner = resolveEffectiveRunner(
      project.runnerConfigs ?? {},
      buildConfig.runnerConfigs,
      runnerName,
    );
    await flash(context, wsConfig, project, buildConfig, runnerConfig, effectiveRunner);
  } else {
    notifyError("Flash", `Runner not found: "${runnerName}" in build "${buildName}"`);
  }
}

/** Synthetic runner used when no runner is configured – delegates to west's default selection. */
const SYNTHETIC_DEFAULT_RUNNER: RunnerConfig = { name: "default", runner: "default", args: "", argsMode: "append" };
const SYNTHETIC_DEFAULT_EFFECTIVE = { runner: "default", args: "" };

export async function flashActive(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig) {
  // Resolve project+build first. A runner is optional — if none is configured,
  // fall back to a synthetic default runner so west picks the board's runner.
  const resolved = resolveActiveProjectBuild(wsConfig, { caller: "Flash" });
  if (!resolved) { return; }

  const runnerName = wsConfig.projectStates?.[resolved.projectName]?.buildStates?.[resolved.buildName]?.activeRunner;
  let runner: RunnerConfig;
  let effectiveRunner: { runner: string; args: string };

  if (runnerName && resolved.build.runnerConfigs[runnerName]) {
    runner = resolved.build.runnerConfigs[runnerName];
    effectiveRunner = resolveEffectiveRunner(
      resolved.project.runnerConfigs ?? {},
      resolved.build.runnerConfigs,
      runnerName,
    );
  } else {
    runner = SYNTHETIC_DEFAULT_RUNNER;
    effectiveRunner = SYNTHETIC_DEFAULT_EFFECTIVE;
  }

  await flash(context, wsConfig, resolved.project, resolved.build, runner, effectiveRunner);
}

export async function flash(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, project: ProjectConfig, build: BuildConfig, runner: RunnerConfig, effectiveRunner?: { runner: string; args: string }) {
  const eff = effectiveRunner ?? { runner: runner.runner, args: runner.args ?? "" };
  // Tasks
  let cmd = `west flash --build-dir "${getBuildFolder(wsConfig, project, build)}"`;

  if (eff.runner !== "default") {
    cmd += ` -r ${eff.runner}`;
  }
  const args = (eff.args ?? "").trim();
  if (args) { cmd += ` ${args}`; }

  const taskName = "Zephyr IDE Flash: " + project.name + " " + build.name;

  outputInfo(`Flash: ${project.name}/${build.name}`, `Flashing ${build.name} from project: ${project.name} (cmd: ${cmd})`, true);
  const setupState = await getSetupStateOrNotify(context, wsConfig, "Flash");
  if (!setupState) {
    return;
  }
  await executeTaskHelperInPythonEnv(setupState, taskName, cmd, setupState.setupPath);
}
