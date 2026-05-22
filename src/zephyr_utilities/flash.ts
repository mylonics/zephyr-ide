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
import { parseYamlArgs, mergeArgLayers, toWestArgs } from "../project_utilities/runner_arg_resolver";
import { parseRunnersYaml, resolveRunnersYamlPath } from "./runners-yaml";
import { getSetupStateOrNotify } from "../setup_utilities/workspace-config";

/**
 * Resolve the west runner name and final args string for a flash operation,
 * using the three-layer merge when the bind has structured args.
 */
function resolveFlashRunnerAndArgs(
  wsConfig: WorkspaceConfig,
  build: BuildConfig,
  buildFolder: string,
  profileFlashBind: import("../project_utilities/runner_profiles").RunnerBind,
  bindOverride: import("../project_utilities/runner_profiles").BindOverride | undefined,
  sysbuildImage: string | undefined,
): { runner: string; args: string } {
  if (profileFlashBind.kind !== "runner") {
    return { runner: "default", args: "" };
  }
  const bind = profileFlashBind;
  const runnerName = bind.runner;

  // If the bind has structured args, use the three-layer resolver.
  if (bind.args) {
    // Parse runners.yaml for the yaml layer.
    const runnersYamlPath = resolveRunnersYamlPath(buildFolder, sysbuildImage);
    const runnersYaml = parseRunnersYaml(runnersYamlPath);
    const yamlArgs = runnersYaml
      ? parseYamlArgs(runnerName, runnersYaml.args[runnerName] ?? [])
      : undefined;

    // Build override: promote BindOverride to the resolver's BuildSlotOverride shape.
    const buildOverride = bindOverride ? {
      overrides: bindOverride.overrides,
      removed: bindOverride.removed,
      additions: bindOverride.additions,
      rawAdditions: [...(bindOverride.rawAdditions ?? []), ...(bindOverride.extraArgs ?? [])],
    } : undefined;

    const resolved = mergeArgLayers(runnerName, bind.args, yamlArgs, buildOverride, { slot: "flash" });
    const westArgTokens = toWestArgs(resolved);
    return { runner: runnerName, args: westArgTokens.join(" ") };
  }

  // Legacy path: combine extraArgs + override extraArgs as a plain string.
  const parts = [
    ...(bind.extraArgs ?? []),
    ...(bindOverride?.rawAdditions ?? []),
    ...(bindOverride?.extraArgs ?? []),
  ].map(s => s.trim()).filter(s => s.length > 0);
  return { runner: runnerName, args: parts.join(" ") };
}

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

  const buildFolder = getBuildFolder(wsConfig, project, buildConfig);
  const sysbuildImage = wsConfig.projectStates?.[projectName]?.buildStates?.[buildName]?.sysbuildImage;

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
      const resolved = resolveFlashRunnerAndArgs(
        wsConfig, buildConfig, buildFolder,
        profile.flash, buildConfig.bindOverrides?.flash, sysbuildImage,
      );
      runner = resolved.runner;
      args = resolved.args;
    }
  }

  await flash(context, wsConfig, project, buildConfig, runner, args);
}

export async function flashActive(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig) {
  const resolved = resolveActiveProjectBuild(wsConfig, { caller: "Flash" });
  if (!resolved) { return; }

  const buildFolder = getBuildFolder(wsConfig, resolved.project, resolved.build);
  const sysbuildImage = wsConfig.projectStates?.[resolved.projectName]?.buildStates?.[resolved.buildName]?.sysbuildImage;

  let runner = "default", args = "";
  const profileName = resolved.build.activeProfile;
  if (profileName) {
    const profile = findRunnerProfile(profileName, loadRunnerProfiles(wsConfig));
    if (profile) {
      if (profile.flash.kind === "launch") {
        outputWarning("Flash", `Profile "${profileName}" has flash bind set to launch.json config, which is not valid for flashing. Using default runner.`);
      } else {
        const r = resolveFlashRunnerAndArgs(
          wsConfig, resolved.build, buildFolder,
          profile.flash, resolved.build.bindOverrides?.flash, sysbuildImage,
        );
        runner = r.runner;
        args = r.args;
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