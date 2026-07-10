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

import { executeTaskHelperInPythonEnv, RUNNER_TARGET_PREFIX, WEST_FLASH_PREFIX } from "../utilities/utils";
import { notifyError, outputInfo, outputWarning } from "../utilities/output";

import { ProjectConfig, ResolvedProjectBuild, resolveActiveProjectBuild, getBuildFolder, getEffectiveActiveProfileName } from "../project_utilities/project";

import { WorkspaceConfig } from '../setup_utilities/types';
import { BuildConfig } from "../project_utilities/build_selector";
import { loadRunnerProfiles, findRunnerProfile, resolveRunnerArgs, RunnerVarContext, FlashBind, BindOverride } from "../project_utilities/runner_profiles";
import { getSetupStateOrNotify } from "../setup_utilities/workspace-config";

/**
 * Resolve the west runner name and final (already-substituted) args string
 * for a flash operation. Per-token substitution is applied so that variables
 * expanding to paths with spaces stay as single tokens.
 */
function resolveFlashRunnerAndArgs(
  profileFlashBind: FlashBind,
  bindOverride: BindOverride | undefined,
  ctx?: RunnerVarContext,
): { runner: string; args: string } {
  if (profileFlashBind.kind !== "west-flash") {
    return { runner: "default", args: "" };
  }
  const bind = profileFlashBind;
  const allTokens = [
    ...(bind.extraArgs ?? []),
    ...(bindOverride?.extraArgs ?? []),
  ];
  const parts = ctx
    ? allTokens.map(t => resolveRunnerArgs(t, ctx)).filter(t => t.trim().length > 0)
    : allTokens.map(s => s.trim()).filter(s => s.length > 0);
  return { runner: bind.runner, args: parts.join(" ") };
}

/**
 * Shared helper: look up the active runner profile for a build and resolve
 * the flash runner + (already-substituted) args string.
 *
 * When `resolved` is provided the effective profile name is determined via
 * `getEffectiveActiveProfileName` (respects the local per-developer override
 * stored in BuildState). When only `profileName` is given (e.g. flashByName)
 * that explicit name is used directly. When neither is provided the function
 * returns the "auto" defaults.
 */
function resolveFlashFromProfile(
  profileName: string | undefined,
  project: ProjectConfig,
  buildConfig: BuildConfig,
  wsConfig: WorkspaceConfig,
  resolved?: ResolvedProjectBuild,
): { runner: string; args: string } {
  let effectiveName: string | undefined;
  if (profileName !== undefined) {
    effectiveName = profileName;
  } else if (resolved) {
    effectiveName = getEffectiveActiveProfileName(wsConfig, resolved).name;
  } else {
    effectiveName = buildConfig.activeProfile;
  }
  if (!effectiveName) { return { runner: "default", args: "" }; }

  const profile = findRunnerProfile(effectiveName, loadRunnerProfiles(wsConfig));
  if (!profile) {
    notifyError("Flash", `Runner profile not found: "${effectiveName}"`);
    return { runner: "default", args: "" };
  }
  // FlashBind only allows "auto" and "west-flash" — no launch kinds.
  const buildFolder = getBuildFolder(wsConfig, project, buildConfig);
  const ctx: RunnerVarContext = {
    workspaceFolder: wsConfig.rootPath,
    buildFolder,
    board: buildConfig.board,
    boardRevision: buildConfig.revision ?? "",
    project: project.name,
    build: buildConfig.name,
    buildVars: buildConfig.customVars,
    projectVars: project.customVars,
  };
  return resolveFlashRunnerAndArgs(profile.flash, buildConfig.bindOverrides?.flash, ctx);
}

export async function flashActive(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig) {
  const resolved = resolveActiveProjectBuild(wsConfig, { caller: "Flash" });
  if (!resolved) { return; }
  // Check per-developer local bind first — takes priority over profile.
  const localFlashRunner = wsConfig.projectStates?.[resolved.projectName]?.buildStates?.[resolved.buildName]?.localBinds?.flash;
  if (localFlashRunner != null) {
    // Strip any "?probe=..." query (the shared local-bind format supports it
    // even though the flash picker doesn't currently offer one) before parsing
    // the runner prefix.
    const [runnerStr] = localFlashRunner.split('?');
    // Strip "west-flash:" (new) or "runner:" (legacy) prefix before passing runner name to west.
    const runnerName = runnerStr.startsWith(WEST_FLASH_PREFIX)
      ? runnerStr.slice(WEST_FLASH_PREFIX.length)
      : runnerStr.startsWith(RUNNER_TARGET_PREFIX)
        ? runnerStr.slice(RUNNER_TARGET_PREFIX.length)
        : runnerStr; // very old format without prefix (backward compat)
    // The local bind stands in for the profile's runner, but the per-build
    // bindOverrides.flash.extraArgs ("appended after the profile's runner
    // args") still layers on top so it isn't silently dropped.
    const buildFolder = getBuildFolder(wsConfig, resolved.project, resolved.build);
    const ctx: RunnerVarContext = {
      workspaceFolder: wsConfig.rootPath,
      buildFolder,
      board: resolved.build.board,
      boardRevision: resolved.build.revision ?? "",
      project: resolved.project.name,
      build: resolved.build.name,
      buildVars: resolved.build.customVars,
      projectVars: resolved.project.customVars,
    };
    const overrideArgs = resolved.build.bindOverrides?.flash?.extraArgs ?? [];
    const args = overrideArgs
      .map(token => resolveRunnerArgs(token, ctx))
      .filter(token => token.trim().length > 0)
      .join(" ");
    await flash(context, wsConfig, resolved.project, resolved.build, runnerName, args);
    return;
  }
  const { runner, args } = resolveFlashFromProfile(undefined, resolved.project, resolved.build, wsConfig, resolved);
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
  // args are already substituted by resolveFlashFromProfile (per-token).
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