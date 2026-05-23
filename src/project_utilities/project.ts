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
import * as fs from "fs-extra";
import * as path from "upath";
import { selectLaunchConfiguration, RUNNER_TARGET_PREFIX } from "../utilities/utils";
import { notifyError, notifyWarningWithActions, outputWarning } from "../utilities/output";
import { buildSelector, BuildConfig, BuildConfigDictionary, BuildStateDictionary } from "./build_selector";
import { WorkspaceConfig } from "../setup_utilities/types";
import { setWorkspaceState } from "../setup_utilities/state-management";
import { RunnerBind, RunnerProfile, BindOverride, loadRunnerProfiles, findRunnerProfile, resolveBind, splitArgs } from "./runner_profiles";
import { configSelector, configRemover, ConfigFiles, mergeConfigFiles } from "./config_selector";
import { setDtsContext } from "../setup_utilities/dts_interface";
import { getSamples } from "../setup_utilities/modules";
import { getSetupState } from "../setup_utilities/workspace-config";
import { getZephyrIdeSampleProjects } from "../setup_utilities/zephyr_ide_json";
import { joinBuildArgs, normalizeBuildArgs, quoteCMakeDef } from "./build_args";
import { MultiStepInput, noOpValidate } from "../utilities/multistepQuickPick";
import { getRunnersYamlHint } from "../zephyr_utilities/runners-yaml";


import { TwisterConfig, TwisterConfigDictionary, twisterSelector, TwisterStateDictionary } from "./twister_selector";


// Project specific configuration
export interface ProjectConfig {
  name: string;
  rel_path: string;
  buildConfigs: BuildConfigDictionary;
  confFiles: ConfigFiles;
  twisterConfigs: TwisterConfigDictionary;
  /** User-defined key-value variables for this project.
   *  Referenced in runner profile args as `${projectvar:key}` and in
   *  tasks.json/launch.json via the `zephyr-ide.get-active-project-variable` command. */
  customVars?: Record<string, string>;
}

// Project specific state
export interface ProjectState {
  activeBuildConfig?: string;
  activeTwisterConfig?: string;
  viewOpen?: boolean;
  buildStates: BuildStateDictionary;
  twisterStates: TwisterStateDictionary;
}

/** Get the absolute folder path for a project */
export function getProjectFolder(wsConfig: WorkspaceConfig, project: ProjectConfig): string {
  return path.join(wsConfig.rootPath, project.rel_path);
}

/** Get the absolute build output folder path for a project/build pair */
export function getBuildFolder(wsConfig: WorkspaceConfig, project: ProjectConfig, build: BuildConfig): string {
  if (build.rel_path) {
    if (path.isAbsolute(build.rel_path)) {
      outputWarning("getBuildFolder", `rel_path "${build.rel_path}" is absolute — falling back to default build folder`);
    } else {
      // Use the same toUnix+normalize pattern used elsewhere in this file for
      // cross-platform correctness: upath.toUnix() converts any backslashes
      // (Windows-style paths) to forward slashes on all host OSes, and the
      // trailing "/" on the root sentinel prevents prefix collisions
      // (e.g. "/workspace" matching "/workspace2").
      const rootNormalized = path.toUnix(path.normalize(wsConfig.rootPath));
      const rootPrefix = rootNormalized.endsWith("/") ? rootNormalized : `${rootNormalized}/`;
      const resolved = path.toUnix(path.resolve(rootNormalized, build.rel_path));
      if (resolved !== rootNormalized && resolved.startsWith(rootPrefix)) {
        return resolved;
      }
      if (resolved === rootNormalized) {
        outputWarning("getBuildFolder", `rel_path "${build.rel_path}" resolves to the workspace root — falling back to default build folder`);
      } else {
        outputWarning("getBuildFolder", `rel_path "${build.rel_path}" escapes workspace root — falling back to default build folder`);
      }
    }
  }
  return path.join(wsConfig.rootPath, project.rel_path, build.name);
}

/**
 * Resolve the board root directory for a build configuration.
 * Used by build, twister, and runner logic to find board definitions.
 */
export function resolveBoardRoot(wsConfig: WorkspaceConfig, build: { relBoardDir?: string }, setupState?: { zephyrDir: string }): string | undefined {
  if (build.relBoardDir) {
    return path.dirname(path.join(wsConfig.rootPath, build.relBoardDir));
  } else if (setupState) {
    return setupState.zephyrDir;
  }
  return undefined;
}

/**
 * Resolve the full board path (including relBoardSubDir) for a build configuration.
 * Handles absolute paths, custom board dirs, and default Zephyr board dirs.
 */
export function resolveBoardPath(wsConfig: WorkspaceConfig, build: { relBoardDir?: string; relBoardSubDir: string }, setupState?: { zephyrDir: string }): string | undefined {
  if (path.isAbsolute(build.relBoardSubDir)) {
    return build.relBoardSubDir;
  }
  if (build.relBoardDir) {
    return path.join(wsConfig.rootPath, build.relBoardDir, build.relBoardSubDir);
  }
  if (setupState) {
    return path.join(setupState.zephyrDir, 'boards', build.relBoardSubDir);
  }
  return undefined;
}

/**
 * Resolve the board root directory and return it as a CMake -D argument string.
 * Returns empty string if no board root can be resolved.
 */
export function resolveBoardRootArg(wsConfig: WorkspaceConfig, build: { relBoardDir?: string }, setupState?: { zephyrDir: string }): string {
  const boardRoot = resolveBoardRoot(wsConfig, build, setupState);
  return boardRoot ? quoteCMakeDef('BOARD_ROOT', boardRoot) : "";
}

/** Get active build name from an already-resolved project */
export function getResolvedBuildName(wsConfig: WorkspaceConfig, resolved: ResolvedProject): string | undefined {
  return wsConfig.projectStates[resolved.projectName]?.activeBuildConfig;
}

/**
 * Return the effective runner profile name for a build, merging the local
 * per-developer override with the committed workspace value.
 *
 * - `string`    — the local `BuildState.localActiveProfile` override wins.
 * - `undefined` — falls back to `BuildConfig.activeProfile` (the JSON value).
 * - The local value `null` explicitly clears the profile ("none locally").
 *
 * The second return value `scope` tells callers whether the effective name
 * came from the local layer (`"local"`), the workspace JSON (`"workspace"`),
 * or neither (`"none"`).  This is used for UI labels.
 */
export function getEffectiveActiveProfileName(
  wsConfig: WorkspaceConfig,
  resolved: ResolvedProjectBuild,
): { name: string | undefined; scope: "local" | "workspace" | "none" } {
  const buildState = wsConfig.projectStates[resolved.projectName]?.buildStates?.[resolved.buildName];
  if (buildState && "localActiveProfile" in buildState) {
    // local override is explicitly set (string or null)
    const local = buildState.localActiveProfile;
    if (local === null) {
      return { name: undefined, scope: "local" };
    }
    if (typeof local === "string") {
      return { name: local, scope: "local" };
    }
  }
  const workspaceName = resolved.build.activeProfile;
  if (workspaceName) {
    return { name: workspaceName, scope: "workspace" };
  }
  return { name: undefined, scope: "none" };
}

/**
 * Get the `RunnerProfile` referenced by a resolved build, or `undefined` when
 * the build has no effective `activeProfile` or the named profile is not defined.
 * The local per-developer override (`BuildState.localActiveProfile`) takes
 * precedence over the committed workspace value (`BuildConfig.activeProfile`).
 * Callers that want to merge in `bindOverrides` should call
 * `resolveActiveProfile` instead.
 */
export function getResolvedProfile(wsConfig: WorkspaceConfig, resolved: ResolvedProjectBuild): RunnerProfile | undefined {
  const { name: profileName } = getEffectiveActiveProfileName(wsConfig, resolved);
  if (!profileName) { return undefined; }
  const profiles = loadRunnerProfiles(wsConfig);
  return findRunnerProfile(profileName, profiles);
}

/** Get the build-level override for a specific bind slot (may be undefined). */
export function getBindOverride(build: BuildConfig, slot: "flash" | "buildDebug" | "debug" | "attach"): BindOverride | undefined {
  return build.bindOverrides?.[slot];
}

/** Get active test name from an already-resolved project */
export function getResolvedTestName(wsConfig: WorkspaceConfig, resolved: ResolvedProject): string | undefined {
  return wsConfig.projectStates[resolved.projectName]?.activeTwisterConfig;
}

/** Get active test config from an already-resolved project */
export function getResolvedTestConfig(wsConfig: WorkspaceConfig, resolved: ResolvedProject): TwisterConfig | undefined {
  const testName = getResolvedTestName(wsConfig, resolved);
  return testName ? resolved.project.twisterConfigs[testName] : undefined;
}

/** Resolved active project info */
export interface ResolvedProject {
  projectName: string;
  project: ProjectConfig;
}

/** Resolved active project + build info */
export interface ResolvedProjectBuild extends ResolvedProject {
  buildName: string;
  build: BuildConfig;
}

/** Resolved active project + build + profile info (when build has an `activeProfile`). */
export interface ResolvedProjectBuildProfile extends ResolvedProjectBuild {
  profileName: string;
  profile: RunnerProfile;
}

/** Options for resolver helpers */
export interface ResolveOptions {
  /** When provided, shows error notifications on failure. When omitted, returns undefined silently. */
  caller?: string;
  projectName?: string;
  buildName?: string;
}

/**
 * Resolve the active project, falling back to the given projectName.
 * When `caller` is provided, shows error notifications on failure.
 * When `caller` is omitted, returns undefined silently.
 */
export function resolveActiveProject(
  wsConfig: WorkspaceConfig,
  options?: ResolveOptions
): ResolvedProject | undefined {
  const name = options?.projectName ?? wsConfig.activeProject;
  if (!name) {
    if (options?.caller) { notifyError(options.caller, "Select a project before trying to continue"); }
    return undefined;
  }
  const project = wsConfig.projects[name];
  if (!project) {
    if (options?.caller) { notifyError(options.caller, `Project "${name}" not found`); }
    return undefined;
  }
  return { projectName: name, project };
}

/**
 * Resolve the active project and its active build.
 * When `caller` is provided, shows error notifications on failure.
 * When `caller` is omitted, returns undefined silently.
 */
export function resolveActiveProjectBuild(
  wsConfig: WorkspaceConfig,
  options?: ResolveOptions
): ResolvedProjectBuild | undefined {
  const resolved = resolveActiveProject(wsConfig, options);
  if (!resolved) {
    return undefined;
  }
  const bName = options?.buildName ?? getResolvedBuildName(wsConfig, resolved);
  if (!bName) {
    if (options?.caller) { notifyError(options.caller, "You must choose a Build Configuration to continue."); }
    return undefined;
  }
  const build = resolved.project.buildConfigs[bName];
  if (!build) {
    if (options?.caller) { notifyError(options.caller, `Build "${bName}" not found`); }
    return undefined;
  }
  return { ...resolved, buildName: bName, build };
}

/**
 * Resolve the active project, build, and its referenced `RunnerProfile`.
 * When `caller` is provided, shows error notifications on failure.
 * When `caller` is omitted, returns undefined silently.
 *
 * Returns undefined when no profile is set, or when the referenced profile
 * cannot be found (caller can fall back to implicit "all auto" behaviour).
 */
export function resolveActiveProfile(
  wsConfig: WorkspaceConfig,
  options?: ResolveOptions
): ResolvedProjectBuildProfile | undefined {
  const resolved = resolveActiveProjectBuild(wsConfig, options);
  if (!resolved) {
    return undefined;
  }
  const { name: profileName } = getEffectiveActiveProfileName(wsConfig, resolved);
  if (!profileName) {
    if (options?.caller) { notifyError(options.caller, "Select a runner profile before trying to continue"); }
    return undefined;
  }
  const profile = findRunnerProfile(profileName, loadRunnerProfiles(wsConfig));
  if (!profile) {
    if (options?.caller) { notifyError(options.caller, `Runner profile "${profileName}" not found`); }
    return undefined;
  }
  return { ...resolved, profileName, profile };
}

/** Resolve the effective `RunnerBind` + extra args for a slot of the active build's profile. */
export function resolveActiveBuildBind(
  wsConfig: WorkspaceConfig,
  slot: "flash" | "debug" | "attach",
  options?: ResolveOptions
): { runner: string; args: string } | undefined {
  const r = resolveActiveProfile(wsConfig, options);
  if (!r) { return undefined; }
  const override = getBindOverride(r.build, slot);
  return resolveBind(r.profile[slot], override);
}

export async function modifyBuildArguments(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, projectName?: string, buildName?: string) {
  const resolved = resolveActiveProjectBuild(wsConfig, { caller: "Project", projectName, buildName });
  if (!resolved) { return; }
  const { build } = resolved;

  // Two-step wizard: modify west args, then cmake args. Back button on step 2
  // allows the user to correct west args after seeing the cmake prompt.
  const title = "Modify Build Arguments";
  const argsState: { westArgs?: string; cmakeArgs?: string; completed?: boolean } = {
    westArgs: joinBuildArgs(build.westBuildArgs),
    cmakeArgs: joinBuildArgs(build.westBuildCMakeArgs),
  };

  async function inputWestArgs(input: MultiStepInput) {
    const value = await input.showInputBox({
      title,
      step: 1,
      totalSteps: 2,
      ignoreFocusOut: true,
      value: argsState.westArgs ?? "",
      prompt: "West build arguments (e.g., --sysbuild)",
      placeholder: "--sysbuild",
      validate: noOpValidate,
    });
    argsState.westArgs = value;
    return (input: MultiStepInput) => inputCMakeArgs(input);
  }

  async function inputCMakeArgs(input: MultiStepInput) {
    const value = await input.showInputBox({
      title,
      step: 2,
      totalSteps: 2,
      ignoreFocusOut: true,
      value: argsState.cmakeArgs ?? "",
      prompt: "CMake arguments (e.g., -DCMAKE_VERBOSE_MAKEFILE=ON)",
      placeholder: "-DCMAKE_VERBOSE_MAKEFILE=ON",
      validate: noOpValidate,
    });
    argsState.cmakeArgs = value;
    // Mark the wizard as completed only after the final step accepts.
    // MultiStepInput.run consumes cancel internally, so without this flag a
    // mid-wizard cancel would apply the step-1 value even though the user
    // aborted.
    argsState.completed = true;
  }

  await MultiStepInput.run(input => inputWestArgs(input));

  if (!argsState.completed) {
    return;
  }

  if (argsState.westArgs !== undefined) {
    build.westBuildArgs = normalizeBuildArgs(argsState.westArgs);
  }
  if (argsState.cmakeArgs !== undefined) {
    build.westBuildCMakeArgs = normalizeBuildArgs(argsState.cmakeArgs);
  }

  await setWorkspaceState(context, wsConfig);
}


export async function createNewProjectFromSample(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig) {
  // Show loading QuickPick with no items, just a placeholder
  const loadingQuickPick = vscode.window.createQuickPick();
  loadingQuickPick.items = [];
  loadingQuickPick.busy = true;
  loadingQuickPick.enabled = false;
  loadingQuickPick.placeholder = "Loading sample projects... Please wait.";
  loadingQuickPick.ignoreFocusOut = true;
  loadingQuickPick.show();

  const setupState = await getSetupState(context, wsConfig);
  if (!setupState) {
    loadingQuickPick.dispose();
    return;
  }
  const samplesDir = await getSamples(setupState);

  loadingQuickPick.dispose();

  // Two-step wizard: pick sample, then choose destination. Back on step 2
  // returns to the sample picker.
  const title = "Create Project From Sample";
  const projectList: vscode.QuickPickItem[] = samplesDir.map(x => ({ label: x[1], detail: "(" + x[0] + ") " + x[3], description: x[2] }));

  const wizardState: { sample?: vscode.QuickPickItem; destination?: string } = {};

  async function pickSample(input: MultiStepInput) {
    const selected = await input.showQuickPick({
      title,
      step: 1,
      totalSteps: 2,
      ignoreFocusOut: true,
      placeholder: "Select Sample Project",
      items: projectList,
    });
    wizardState.sample = selected;
    const detailParts = (selected.detail ?? "").split(") ");
    const selectedSamplePath = detailParts.length > 1 ? detailParts.slice(1).join(") ") : detailParts[0];
    if (!selectedSamplePath) {
      return;
    }
    return (input: MultiStepInput) => inputDestination(input, selectedSamplePath);
  }

  async function inputDestination(input: MultiStepInput, selectedSamplePath: string) {
    const value = await input.showInputBox({
      title,
      step: 2,
      totalSteps: 2,
      ignoreFocusOut: true,
      value: path.basename(selectedSamplePath),
      prompt: "Choose Project Destination",
      validate: noOpValidate,
    });
    wizardState.destination = value;
  }

  // MultiStepInput.run consumes cancel internally; we detect cancellation by
  // checking whether wizardState.destination was set (only set on accept of
  // the final step).
  await MultiStepInput.run(input => pickSample(input));

  const selectedSample = wizardState.sample;
  const projectDest = wizardState.destination;
  if (!selectedSample || !selectedSample.detail || !selectedSample.label || !projectDest) {
    return;
  }

  const detailParts = selectedSample.detail.split(") ");
  const selectedSamplePath = detailParts.length > 1 ? detailParts.slice(1).join(") ") : detailParts[0];
  if (!selectedSamplePath) {
    return;
  }

  const destinationPath = path.join(wsConfig.rootPath, projectDest);
  fs.cpSync(selectedSamplePath, destinationPath, { recursive: true });
  const newProjectName = path.basename(projectDest);
  if (selectedSample.label !== newProjectName) {
    changeProjectNameInCMakeFile(destinationPath, newProjectName);
  }
  return destinationPath;
}


export async function addConfigFiles(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, isKConfig: boolean, isToProject: boolean, projectName?: string, buildName?: string) {
  const resolvedProject = resolveActiveProject(wsConfig, { caller: "Project", projectName });
  if (!resolvedProject) { return; }
  const { project } = resolvedProject;
  projectName = resolvedProject.projectName;

  if (!isToProject) {
    const resolvedBuild = resolveActiveProjectBuild(wsConfig, { caller: "Project", projectName, buildName });
    if (!resolvedBuild) { return; }
    buildName = resolvedBuild.buildName;
  }

  const result = await configSelector(wsConfig, isKConfig);
  if (result) {
    if (isToProject) {
      mergeConfigFiles(project.confFiles, result);
    } else {
      if (buildName) {
        mergeConfigFiles(project.buildConfigs[buildName].confFiles, result);
      } else {
        return;
      }
    }
    await setWorkspaceState(context, wsConfig);
    void vscode.window.showInformationMessage(`Config files added`);
  }

}

export async function removeConfigFiles(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, isKConfig: boolean, isToProject: boolean, projectName?: string, buildName?: string, isPrimary?: boolean) {
  const resolvedProject = resolveActiveProject(wsConfig, { caller: "Project", projectName });
  if (!resolvedProject) { return; }
  const { project } = resolvedProject;
  projectName = resolvedProject.projectName;

  let confFiles = project.confFiles;

  if (!isToProject) {
    const resolvedBuild = resolveActiveProjectBuild(wsConfig, { caller: "Project", projectName, buildName });
    if (resolvedBuild) {
      buildName = resolvedBuild.buildName;
      confFiles = resolvedBuild.build.confFiles;
    }
  }
  const result = await configRemover(confFiles, isKConfig, isToProject, isPrimary);

  if (result) {
    if (isToProject) {
      wsConfig.projects[projectName].confFiles = result;
    } else {
      if (buildName) {
        wsConfig.projects[projectName].buildConfigs[buildName].confFiles = result;
      }
    }
    await setWorkspaceState(context, wsConfig);
    void vscode.window.showInformationMessage(`Config files removed`);
  }
}

export async function removeConfigFile(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, isKConfig: boolean, isToProject: boolean, projectName: string, isPrimary: boolean, fileNames: string[], buildName?: string) {
  let confFiles = wsConfig.projects[projectName].confFiles;
  if (!isToProject) {
    if (buildName === undefined) {
      notifyError("Project", "Set build before trying to remove Config Files");
      return;
    }
    confFiles = wsConfig.projects[projectName].buildConfigs[buildName].confFiles;
  }

  const key: keyof ConfigFiles = isKConfig ? "config" : "overlay";
  const fileSet = new Set(fileNames);
  confFiles[key] = confFiles[key].filter(el => !fileSet.has(el.path));
  await setWorkspaceState(context, wsConfig);
  void vscode.window.showInformationMessage(`Config files removed`);
}

/**
 * Generic helper to show a QuickPick from an object's keys.
 * Returns the selected key or undefined if the user cancelled.
 */
async function askUserForSelection(dict: Record<string, any>, placeholder: string): Promise<string | undefined> {
  const keys = Object.keys(dict);
  if (keys.length === 0) {
    return undefined;
  }
  return await vscode.window.showQuickPick(keys, {
    ignoreFocusOut: true,
    placeHolder: placeholder,
  });
}

export async function askUserForProject(wsConfig: WorkspaceConfig) {
  if (Object.keys(wsConfig.projects).length === 0) {
    notifyError("Project", "Add or create a project first");
    return;
  }
  return await askUserForSelection(wsConfig.projects, "Select Project");
}

export async function setActiveProject(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, selectedProject?: string) {
  if (selectedProject === undefined) {
    selectedProject = await askUserForProject(wsConfig);
    if (selectedProject === undefined) {
      return;
    }
  }

  wsConfig.activeProject = selectedProject;
  await setWorkspaceState(context, wsConfig);
  void vscode.window.showInformationMessage(`Active project set to "${selectedProject}"`);
  void setDtsContext(wsConfig);
}

export async function askUserForBuild(wsConfig: WorkspaceConfig, projectName: string) {
  return await askUserForSelection(wsConfig.projects[projectName].buildConfigs, "Select Build");
}

export async function askUserForTest(wsConfig: WorkspaceConfig, projectName: string) {
  return await askUserForSelection(wsConfig.projects[projectName].twisterConfigs, "Select Test");
}

export async function setActiveBuild(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, selectedBuild?: string) {
  if (wsConfig.activeProject === undefined) {
    await setActiveProject(context, wsConfig);
    if (wsConfig.activeProject === undefined) {
      notifyError("Build Config", "Set Active Project before trying to Set Active Build");
      return;
    }
  }

  if (selectedBuild === undefined) {
    selectedBuild = await askUserForBuild(wsConfig, wsConfig.activeProject);
    if (selectedBuild === undefined) {
      return;
    }
  }

  const buildConfigs = wsConfig.projects[wsConfig.activeProject].buildConfigs;
  wsConfig.projectStates[wsConfig.activeProject].activeBuildConfig = buildConfigs[selectedBuild].name;
  await setWorkspaceState(context, wsConfig);
  void setDtsContext(wsConfig);
  void vscode.window.showInformationMessage(`Active build set to "${selectedBuild}"`);
}

export async function setActiveTest(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, selectedTest?: string) {
  if (wsConfig.activeProject === undefined) {
    await setActiveProject(context, wsConfig);
    if (wsConfig.activeProject === undefined) {
      notifyError("Test Config", "Set Active Project before trying to Set Active Test");
      return;
    }
  }

  if (selectedTest === undefined) {
    selectedTest = await askUserForTest(wsConfig, wsConfig.activeProject);
    if (selectedTest === undefined) {
      return;
    }
  }

  const twisterConfigs = wsConfig.projects[wsConfig.activeProject].twisterConfigs;
  wsConfig.projectStates[wsConfig.activeProject].activeTwisterConfig = twisterConfigs[selectedTest].name;
  await setWorkspaceState(context, wsConfig);
  void setDtsContext(wsConfig);
  void vscode.window.showInformationMessage(`Successfully Set ${selectedTest} as Active Test of ${wsConfig.activeProject}`);
}

export async function removeProject(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, projectName?: string) {
  if (projectName === undefined) {
    projectName = await askUserForProject(wsConfig);
    if (projectName === undefined) {
      return;
    }
  }
  if (projectName in wsConfig.projects) {
    const selection = await vscode.window.showWarningMessage('Are you sure you want to remove ' + projectName + '?', 'Yes', 'Cancel');
    if (selection !== 'Yes') {
      return;
    }
    delete wsConfig.projects[projectName];
    delete wsConfig.projectStates[projectName];
    if (wsConfig.activeProject === projectName) {
      wsConfig.activeProject = undefined;
    }
    await setWorkspaceState(context, wsConfig);
    return true;
  }
}

export async function changeProjectNameInCMakeFile(projectPath: string, newProjectName: string) {
  const projectCmakePath = path.join(projectPath, "CMakeLists.txt");

  if (fs.existsSync(projectCmakePath)) {
    const projectCMakeFile = fs.readFileSync(projectCmakePath, 'utf8');
    const newProjectCMakeFile = projectCMakeFile.replace(/project\([^)]*\)/i, "project(" + newProjectName + ")");
    fs.writeFileSync(projectCmakePath, newProjectCMakeFile);
    return true;
  }
  return false;
}

/**
 * Read the `sampleProjects` list from `.vscode/zephyr-ide.json`, present the
 * user with a multi-select picker, and add each chosen project to the
 * workspace (without copying files — the paths must already exist on disk).
 *
 * Returns `true` if at least one project was added, `false` if the list was
 * empty or the user cancelled, and `undefined` when no sample projects are
 * declared in the file.
 */
export async function addSampleProjectsFromFile(wsConfig: WorkspaceConfig, context: vscode.ExtensionContext): Promise<boolean | undefined> {
  const sampleConfigs = getZephyrIdeSampleProjects(wsConfig);
  if (sampleConfigs.length === 0) {
    return undefined;
  }

  // Reject absolute paths and paths that escape the workspace root.
  // upath always normalises to forward slashes; toUnix() makes this explicit.
  const rootNormalized = path.toUnix(path.normalize(wsConfig.rootPath)) + '/';
  const validConfigs: typeof sampleConfigs = [];
  for (const sample of sampleConfigs) {
    const relPath = sample.rel_path;
    if (path.isAbsolute(relPath)) {
      void vscode.window.showWarningMessage(`Skipping absolute path "${relPath}" in sampleProjects — entries must be relative to the workspace root.`);
      continue;
    }
    const resolved = path.toUnix(path.normalize(path.join(wsConfig.rootPath, relPath))) + '/';
    if (!resolved.startsWith(rootNormalized)) {
      void vscode.window.showWarningMessage(`Skipping "${relPath}" in sampleProjects — path resolves outside the workspace root.`);
      continue;
    }
    validConfigs.push(sample);
  }

  if (validConfigs.length === 0) {
    return undefined;
  }

  // Count project names to detect duplicates so we can disambiguate.
  const nameCounts = new Map<string, number>();
  for (const sample of validConfigs) {
    nameCounts.set(sample.name, (nameCounts.get(sample.name) ?? 0) + 1);
  }
  const projectNameFor = (sample: { name: string; rel_path: string }): string => {
    if ((nameCounts.get(sample.name) ?? 0) > 1) {
      // Include the parent segment to make the name unique.
      // When there is no parent (single-segment path, dirname === '.'), fall back to the name.
      const dir = path.dirname(sample.rel_path);
      if (dir !== '.') {
        return path.join(path.basename(dir), sample.name);
      }
    }
    return sample.name;
  };

  const items = validConfigs.map(sample => {
    const resolvedPath = path.join(wsConfig.rootPath, sample.rel_path);
    const projectName = projectNameFor(sample);
    const alreadyAdded = !!wsConfig.projects[projectName];
    return {
      label: projectName,
      description: sample.rel_path,
      detail: alreadyAdded ? "(already in workspace)" : undefined,
      resolvedPath,
      sample,
      projectName,
      picked: !alreadyAdded,
    };
  });

  const selected = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    title: "Add Sample Projects from zephyr-ide.json",
    placeHolder: "Select sample projects to add to the workspace",
    ignoreFocusOut: true,
  });

  if (!selected || selected.length === 0) {
    return false;
  }

  const hadActiveProject = !!wsConfig.activeProject;
  let addedCount = 0;
  let lastAdded: string | undefined;

  for (const item of selected) {
    const projectPath = item.resolvedPath;
    const projectName = item.projectName;
    if (!fs.pathExistsSync(path.join(projectPath, "CMakeLists.txt"))) {
      void vscode.window.showWarningMessage(`Skipping "${projectName}": no CMakeLists.txt found at ${projectPath}`);
      continue;
    }
    if (wsConfig.projects[projectName]) {
      const choice = await vscode.window.showWarningMessage(
        `A project named "${projectName}" already exists`,
        "Overwrite",
        "Skip"
      );
      if (choice !== "Overwrite") {
        continue;
      }
    }
    // Spread the stored config snapshot first (carries pre-configured buildConfigs,
    // confFiles, twisterConfigs), then override name and rel_path with the current
    // workspace-local values.
    wsConfig.projects[projectName] = {
      name: projectName,
      rel_path: path.relative(wsConfig.rootPath, projectPath),
      // Explicitly copy only the configuration fields from the stored sample;
      // do not blindly spread all properties to avoid carrying over stale data.
      buildConfigs: item.sample.buildConfigs,
      confFiles: item.sample.confFiles,
      twisterConfigs: item.sample.twisterConfigs,
    };
    wsConfig.projectStates[projectName] = { buildStates: {}, viewOpen: true, twisterStates: {} };
    lastAdded = projectName;
    addedCount++;
  }

  if (addedCount > 0) {
    // Activate the last-added project via the standard helper (which also
    // triggers DTS context update), but only when there was no active project
    // before so we don't displace the user's existing selection.
    if (!hadActiveProject && lastAdded) {
      await setActiveProject(context, wsConfig, lastAdded);
    }
    await setWorkspaceState(context, wsConfig);
    void vscode.window.showInformationMessage(
      `Added ${addedCount} sample project${addedCount > 1 ? "s" : ""} from zephyr-ide.json`
    );
    return true;
  }
  return false;
}

export async function addProject(wsConfig: WorkspaceConfig, context: vscode.ExtensionContext, projectPath: string | undefined) {
  if (projectPath === undefined) {
    const dialogOptions: vscode.OpenDialogOptions = {
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      title: "Select Project Folder"
    };

    // Open file picker for destination directory
    const open = await vscode.window.showOpenDialog(dialogOptions);
    if (open === undefined) {
      notifyError("Project", 'Failed to provide a valid target folder.');
      return null;
    }

    projectPath = open[0].fsPath;
    const projectCmakePath = projectPath + "/CMakeLists.txt";
    if (fs.pathExistsSync(projectCmakePath)) {
      const document = await vscode.workspace.openTextDocument(projectCmakePath);
      const contents = document.getText();

      if (!contents.includes("project(")) {
        void vscode.window.showInformationMessage(`Failed to Load Project ${projectPath}, Does your project folder have a correct CMake File?`);
        return;
      }
    } else {
      void vscode.window.showInformationMessage(`Failed to Load Project ${projectPath}, Does your project folder have a CMakeLists.txt File?`);
      return;
    }
  }
  if (projectPath === undefined) {
    return;
  }
  const projectName = path.basename(projectPath);
  if (wsConfig.projects[projectName]) {
    const selection = await vscode.window.showWarningMessage(`A project named "${projectName}" already exists`, 'Overwrite', 'Cancel');
    if (selection !== 'Overwrite') {
      notifyError("Project", `Failed to add project`);
      return;
    }
  }
  wsConfig.projects[projectName] = {
    rel_path: path.relative(wsConfig.rootPath, projectPath),
    name: projectName,
    buildConfigs: {},
    twisterConfigs: {},
    confFiles: {
      config: [],
      overlay: [],
    },
  };
  wsConfig.projectStates[projectName] = { buildStates: {}, viewOpen: true, twisterStates: {} };
  await setActiveProject(context, wsConfig, projectName);
  await setWorkspaceState(context, wsConfig);

  void vscode.window.showInformationMessage(`Successfully loaded Project ${projectPath}`);
  return true;
}

export async function addBuildToProject(wsConfig: WorkspaceConfig, context: vscode.ExtensionContext, projectName: string) {
  const setupState = await getSetupState(context, wsConfig);
  if (!setupState) {
    return;
  }
  const result = await buildSelector(context, setupState, wsConfig.rootPath);
  if (result && result.name !== undefined) {
    if (wsConfig.projects[projectName].buildConfigs[result.name]) {
      const selection = await vscode.window.showWarningMessage('A build configuration named "' + result.name + '" already exists', 'Overwrite', 'Cancel');
      if (selection !== 'Overwrite') {
        notifyError("Build Config", `Failed to add build configuration`);
        return;
      }
    }

    void vscode.window.showInformationMessage(`Creating Build Configuration: ${result.name}`);
    wsConfig.projects[projectName].buildConfigs[result.name] = result;
    wsConfig.projectStates[projectName].buildStates[result.name] = { viewOpen: true };
    // Ensure setActiveBuild operates on the correct project, not wsConfig.activeProject
    wsConfig.activeProject = projectName;
    await setActiveBuild(context, wsConfig, result.name);

    await setWorkspaceState(context, wsConfig);
    return true;
  }
}


export async function addBuild(wsConfig: WorkspaceConfig, context: vscode.ExtensionContext) {
  if (wsConfig.activeProject === undefined) {
    notifyError("Build Config", `Failed to Add Build Configuration, please first select a project`);
    return;
  }
  return await addBuildToProject(wsConfig, context, wsConfig.activeProject);
}

/**
 * Generic helper to confirm removal of a named item, delete it from config and state
 * dictionaries, clear the active selection if it matches, and persist state.
 */
async function confirmAndRemoveItem(
  context: vscode.ExtensionContext,
  wsConfig: WorkspaceConfig,
  itemName: string,
  configDict: Record<string, any>,
  stateDict: Record<string, any>,
  activeRef: { value: string | undefined },
): Promise<boolean | undefined> {
  if (!(itemName in configDict)) { return; }
  const selection = await vscode.window.showWarningMessage(
    'Are you sure you want to remove ' + itemName + '?', 'Yes', 'Cancel');
  if (selection !== 'Yes') { return; }
  delete configDict[itemName];
  delete stateDict[itemName];
  if (activeRef.value === itemName) { activeRef.value = undefined; }
  await setWorkspaceState(context, wsConfig);
  return true;
}

export async function removeBuild(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, projectName?: string, buildName?: string) {
  if (projectName === undefined) {
    projectName = await askUserForProject(wsConfig);
    if (projectName === undefined) { return; }
  }
  if (buildName === undefined) {
    buildName = await askUserForBuild(wsConfig, projectName);
    if (buildName === undefined) { return; }
  }
  const ps = wsConfig.projectStates[projectName];
  return confirmAndRemoveItem(context, wsConfig, buildName,
    wsConfig.projects[projectName].buildConfigs, ps.buildStates,
    { get value() { return ps.activeBuildConfig; }, set value(v) { ps.activeBuildConfig = v; } },
  );
}


export async function addTest(wsConfig: WorkspaceConfig, context: vscode.ExtensionContext, projectName?: string) {
  const setupState = await getSetupState(context, wsConfig);
  if (!setupState) {
    return;
  }

  if (projectName === undefined) {
    projectName = wsConfig.activeProject;
  }

  if (projectName === undefined) {
    notifyError("Test Config", `Failed to Add Test Configuration, please first select a project`);
    return;
  }

  const result = await twisterSelector(wsConfig.projects[projectName].rel_path, context, setupState, wsConfig.rootPath);
  if (result && result.name !== undefined) {
    if (wsConfig.projects[projectName].twisterConfigs[result.name]) {
      const selection = await vscode.window.showWarningMessage('A test configuration named "' + result.name + '" already exists', 'Overwrite', 'Cancel');
      if (selection !== 'Overwrite') {
        notifyError("Test Config", `Failed to add twister configuration`);
        return;
      }
    }

    void vscode.window.showInformationMessage(`Creating Twister Configuration: ${result.name}`);

    //Remove the following upgrade code eventually
    if (wsConfig.projects[projectName].twisterConfigs === undefined) {
      wsConfig.projects[projectName].twisterConfigs = {};
      wsConfig.projectStates[projectName].twisterStates = {};
    }

    wsConfig.projects[projectName].twisterConfigs[result.name] = result;
    wsConfig.projectStates[projectName].twisterStates[result.name] = { viewOpen: true };

    // Ensure setActiveTest operates on the correct project, not wsConfig.activeProject
    wsConfig.activeProject = projectName;
    await setActiveTest(context, wsConfig, result.name);
    await setWorkspaceState(context, wsConfig);
  }
}

export async function removeTest(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, projectName?: string, testName?: string) {
  if (projectName === undefined) {
    projectName = await askUserForProject(wsConfig);
    if (projectName === undefined) { return; }
  }
  if (testName === undefined) {
    testName = await askUserForTest(wsConfig, projectName);
    if (testName === undefined) { return; }
  }
  const ps = wsConfig.projectStates[projectName];
  return confirmAndRemoveItem(context, wsConfig, testName,
    wsConfig.projects[projectName].twisterConfigs, ps.twisterStates,
    { get value() { return ps.activeTwisterConfig; }, set value(v) { ps.activeTwisterConfig = v; } },
  );
}

// =============================================================================
// Runner Profile commands
// =============================================================================

/**
 * Pick a `RunnerProfile` name for the active build and store it as a
 * **local** per-developer override (`BuildState.localActiveProfile`) so the
 * committed `.vscode/zephyr-ide.json` is never modified.
 *
 * - `null`        → clear the local override (revert to workspace default).
 * - `string`      → set the local override to that profile name.
 * - `undefined`   → open an interactive QuickPick (default behavior).
 */
export async function setActiveProfile(
  context: vscode.ExtensionContext,
  wsConfig: WorkspaceConfig,
  presetName?: string | null,
) {
  const resolved = resolveActiveProjectBuild(wsConfig, { caller: "Runner Profile" });
  if (!resolved) { return; }
  const buildState = wsConfig.projectStates[resolved.projectName]?.buildStates?.[resolved.buildName];

  if (presetName !== undefined) {
    // Preset: write directly to local layer (null = "none locally").
    if (buildState) { buildState.localActiveProfile = presetName; }
    await setWorkspaceState(context, wsConfig);
    void vscode.commands.executeCommand("zephyr-ide.update-web-view");
    return;
  }

  const profiles = loadRunnerProfiles(wsConfig);
  const NONE_LABEL = "(None) — clear local profile override";
  const { name: currentEffective, scope: currentScope } = getEffectiveActiveProfileName(wsConfig, resolved);
  const items: vscode.QuickPickItem[] = [
    {
      label: NONE_LABEL,
      description: currentEffective === undefined ? "current" : undefined,
      detail: "Flash/debug fall back to runners.yaml defaults (all binds auto).",
    },
  ];
  const names = profiles.map(p => p.name).sort();
  if (names.length > 0) {
    items.push({ label: "", kind: vscode.QuickPickItemKind.Separator });
    for (const name of names) {
      items.push({
        label: name,
        description: currentEffective === name ? `current (${currentScope})` : undefined,
      });
    }
  }

  const qp = vscode.window.createQuickPick();
  qp.ignoreFocusOut = true;
  qp.placeholder = "Select Runner Profile for active build (saved as local override)";
  qp.items = items;
  const defaultItem = currentEffective !== undefined
    ? items.find(i => i.label === currentEffective)
    : items[0];
  if (defaultItem) { qp.activeItems = [defaultItem]; }

  const pick = await new Promise<vscode.QuickPickItem | undefined>(resolve => {
    qp.onDidAccept(() => { resolve(qp.selectedItems[0]); qp.hide(); });
    qp.onDidHide(() => { resolve(undefined); qp.dispose(); });
    qp.show();
  });

  if (pick === undefined) { return; }
  if (buildState) {
    buildState.localActiveProfile = pick.label === NONE_LABEL ? null : pick.label;
  }
  await setWorkspaceState(context, wsConfig);
  void vscode.commands.executeCommand("zephyr-ide.update-web-view");
}

/**
 * Set the active runner profile for the active build directly in
 * `.vscode/zephyr-ide.json` (workspace scope), bypassing the local override.
 * Any existing local override for this build is cleared so the JSON value
 * immediately becomes the effective profile.
 *
 * This is the "shared / committed" path. `setActiveProfile` is the
 * per-developer (local) path.
 */
export async function setWorkspaceActiveProfile(
  context: vscode.ExtensionContext,
  wsConfig: WorkspaceConfig,
  presetName?: string | null,
) {
  const resolved = resolveActiveProjectBuild(wsConfig, { caller: "Runner Profile" });
  if (!resolved) { return; }
  const buildState = wsConfig.projectStates[resolved.projectName]?.buildStates?.[resolved.buildName];

  if (presetName !== undefined) {
    resolved.build.activeProfile = presetName === null ? undefined : presetName;
    if (buildState) { delete buildState.localActiveProfile; }
    await setWorkspaceState(context, wsConfig);
    void vscode.commands.executeCommand("zephyr-ide.update-web-view");
    return;
  }

  const profiles = loadRunnerProfiles(wsConfig);
  const NONE_LABEL = "(None) — clear workspace profile";
  const current = resolved.build.activeProfile;
  const items: vscode.QuickPickItem[] = [
    {
      label: NONE_LABEL,
      description: current === undefined ? "current" : undefined,
      detail: "Flash/debug fall back to runners.yaml defaults (all binds auto).",
    },
  ];
  const names = profiles.map(p => p.name).sort();
  if (names.length > 0) {
    items.push({ label: "", kind: vscode.QuickPickItemKind.Separator });
    for (const name of names) {
      items.push({
        label: name,
        description: current === name ? "current (workspace)" : undefined,
      });
    }
  }

  const qp = vscode.window.createQuickPick();
  qp.ignoreFocusOut = true;
  qp.placeholder = "Select Runner Profile to save into zephyr-ide.json (workspace default)";
  qp.items = items;
  const defaultItem = current !== undefined
    ? items.find(i => i.label === current)
    : items[0];
  if (defaultItem) { qp.activeItems = [defaultItem]; }

  const pick = await new Promise<vscode.QuickPickItem | undefined>(resolve => {
    qp.onDidAccept(() => { resolve(qp.selectedItems[0]); qp.hide(); });
    qp.onDidHide(() => { resolve(undefined); qp.dispose(); });
    qp.show();
  });

  if (pick === undefined) { return; }
  resolved.build.activeProfile = pick.label === NONE_LABEL ? undefined : pick.label;
  if (buildState) { delete buildState.localActiveProfile; }
  await setWorkspaceState(context, wsConfig);
  void vscode.commands.executeCommand("zephyr-ide.update-web-view");
}

/**
 * Promote the currently effective (local or workspace) active profile for the
 * active build into `.vscode/zephyr-ide.json` and clear the local override.
 * After this call the JSON becomes the source of truth and the local layer is gone.
 */
export async function saveActiveProfileToWorkspace(
  context: vscode.ExtensionContext,
  wsConfig: WorkspaceConfig,
) {
  const resolved = resolveActiveProjectBuild(wsConfig, { caller: "Save Runner Profile" });
  if (!resolved) { return; }
  const buildState = wsConfig.projectStates[resolved.projectName]?.buildStates?.[resolved.buildName];
  const { name: effectiveName } = getEffectiveActiveProfileName(wsConfig, resolved);
  resolved.build.activeProfile = effectiveName;
  if (buildState) { delete buildState.localActiveProfile; }
  await setWorkspaceState(context, wsConfig);
  void vscode.commands.executeCommand("zephyr-ide.update-web-view");
  const label = effectiveName ?? "(none)";
  void vscode.window.showInformationMessage(`Runner profile "${label}" saved to workspace (zephyr-ide.json).`);
}

/**
 * Discard the local per-developer active-profile override for the active build
 * so the committed `.vscode/zephyr-ide.json` value becomes effective again.
 */
export async function resetActiveProfileToWorkspace(
  context: vscode.ExtensionContext,
  wsConfig: WorkspaceConfig,
) {
  const resolved = resolveActiveProjectBuild(wsConfig, { caller: "Reset Runner Profile" });
  if (!resolved) { return; }
  const buildState = wsConfig.projectStates[resolved.projectName]?.buildStates?.[resolved.buildName];
  if (!buildState || !("localActiveProfile" in buildState)) {
    void vscode.window.showInformationMessage("No local runner profile override to reset.");
    return;
  }
  delete buildState.localActiveProfile;
  await setWorkspaceState(context, wsConfig);
  void vscode.commands.executeCommand("zephyr-ide.update-web-view");
  const workspaceName = resolved.build.activeProfile ?? "(none)";
  void vscode.window.showInformationMessage(`Local override cleared. Active runner profile is now workspace default: "${workspaceName}".`);
}

// Common Zephyr runners offered in the local-bind picker — sourced from
// runner_selector.ts (same lists used by the Runner Profile editor).

/**
 * Set (or clear) a per-developer local runner binding for one or all slots of
 * the active build. The local bind takes priority over the active Runner
 * Profile's slot bind when executing Flash, Debug, or Attach.
 *
 * When `presetSlot` and `presetRunner` are both provided the selection is
 * applied directly without showing any QuickPick UI. `presetRunner === null`
 * clears the local bind for the slot (reverts to profile).
 */
export async function setLocalBind(
  context: vscode.ExtensionContext,
  wsConfig: WorkspaceConfig,
  presetSlot?: "flash" | "debug" | "attach",
  presetRunner?: string | null,
) {
  const resolved = resolveActiveProjectBuild(wsConfig, { caller: "Local Bind" });
  if (!resolved) { return; }
  const buildState = wsConfig.projectStates[resolved.projectName]?.buildStates?.[resolved.buildName];
  if (!buildState) { return; }

  // --- Pick slot ---
  type Slot = "flash" | "debug" | "attach";
  let slot: Slot | undefined = presetSlot;
  if (!slot) {
    const slotItems: vscode.QuickPickItem[] = [
      { label: "flash",  iconPath: new vscode.ThemeIcon("zap"),           description: "West flash / Build and Flash" },
      { label: "debug",  iconPath: new vscode.ThemeIcon("debug-alt"),     description: "Debug / Build and Debug" },
      { label: "attach", iconPath: new vscode.ThemeIcon("debug-console"), description: "Debug Attach" },
    ];
    const slotPick = await vscode.window.showQuickPick(slotItems, {
      title: "Local Bind — pick a slot",
      placeHolder: "Which slot should use a locally overridden runner?",
      ignoreFocusOut: true,
    });
    if (!slotPick) { return; }
    slot = slotPick.label as Slot;
  }

  // --- Pick runner / launch config ---
  let runner: string | null | undefined = presetRunner;
  if (runner === undefined) {
    const result = await selectLaunchConfiguration(
      wsConfig,
      "$(discard) Clear local bind — revert to profile",
      undefined,
      slot === "flash" ? "flash" : "debug",
    );
    if (result === undefined) { return; } // user cancelled
    runner = result.isDefault ? null : result.name;
    // result.name is already "runner:X" for runners, or the launch config name for launch.json picks
  }

  // --- Apply ---
  if (!buildState.localBinds) { buildState.localBinds = {}; }
  if (runner === null) {
    delete buildState.localBinds[slot];
    if (Object.keys(buildState.localBinds).length === 0) {
      delete buildState.localBinds;
    }
  } else {
    buildState.localBinds[slot] = runner;
  }

  await setWorkspaceState(context, wsConfig);
  void vscode.commands.executeCommand("zephyr-ide.update-web-view");
}

/**
 * Edit (or clear) the per-build `bindOverrides[slot].extraArgs` for the
 * active build. Only meaningful when the profile slot is a `runner` bind.
 */
export async function setBindOverride(
  context: vscode.ExtensionContext,
  wsConfig: WorkspaceConfig,
  slot: "flash" | "debug" | "attach",
  argsText?: string,
) {
  const resolved = resolveActiveProjectBuild(wsConfig, { caller: "Runner Override" });
  if (!resolved) { return; }
  const currentArgs = resolved.build.bindOverrides?.[slot]?.extraArgs ?? [];
  const currentStr = currentArgs.join(" ");
  const value = argsText ?? await vscode.window.showInputBox({
    title: `Extra runner args for ${slot}`,
    value: currentStr,
    ignoreFocusOut: true,
    placeHolder: "--erase --speed 4000",
    prompt: "Appended after the profile's runner args. Leave blank to clear.",
  });
  if (value === undefined) { return; }
  const parsed = splitArgs(value);
  if (!resolved.build.bindOverrides) { resolved.build.bindOverrides = {}; }
  if (parsed.length === 0) {
    delete resolved.build.bindOverrides[slot];
    if (Object.keys(resolved.build.bindOverrides).length === 0) {
      resolved.build.bindOverrides = undefined;
    }
  } else {
    resolved.build.bindOverrides[slot] = { extraArgs: parsed };
  }
  await setWorkspaceState(context, wsConfig);
  void vscode.commands.executeCommand("zephyr-ide.update-web-view");
}
export async function setActive(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, project: string, build?: string, _runner?: string, test?: string) {
  if (project) {
    wsConfig.activeProject = project;
    if (build) {
      wsConfig.projectStates[wsConfig.activeProject].activeBuildConfig = build;
    }
    if (test) {
      wsConfig.projectStates[wsConfig.activeProject].activeTwisterConfig = test;
    }
    await setWorkspaceState(context, wsConfig);
    void vscode.commands.executeCommand("zephyr-ide.update-web-view");
  }
}

export async function getActiveBuild(wsConfig: WorkspaceConfig) {
  const resolved = resolveActiveProjectBuild(wsConfig);
  if (!resolved) { return; }
  return resolved.build;
}

// ---------------------------------------------------------------------------
// Custom variable management
// ---------------------------------------------------------------------------

/**
 * Return the value of a named custom variable from the active build's `customVars`.
 * Used by the `zephyr-ide.get-active-build-variable` command (tasks.json/launch.json inputs).
 */
export function getActiveBuildVariable(wsConfig: WorkspaceConfig, varName: string): string | undefined {
  const resolved = resolveActiveProjectBuild(wsConfig);
  if (!resolved) { return undefined; }
  return resolved.build.customVars?.[varName];
}

/**
 * Return the value of a named custom variable from the active project's `customVars`.
 * Used by the `zephyr-ide.get-active-project-variable` command (tasks.json/launch.json inputs).
 */
export function getActiveProjectVariable(wsConfig: WorkspaceConfig, varName: string): string | undefined {
  const resolved = resolveActiveProjectBuild(wsConfig);
  if (!resolved) { return undefined; }
  return resolved.project.customVars?.[varName];
}

/**
 * Interactive quick-input editor for `customVars` on a build or project.
 * Allows the user to add, edit, and delete named variables.
 */
async function editCustomVars(
  context: vscode.ExtensionContext,
  wsConfig: WorkspaceConfig,
  scope: "build" | "project",
  existingVars: Record<string, string>,
  saveVars: (updated: Record<string, string>) => Promise<void>,
): Promise<void> {
  const ADD = "$(add)  Add new variable…";
  const DONE = "$(check)  Done";

  let vars = { ...existingVars };

  while (true) {
    const entries = Object.keys(vars).sort().map(k => ({
      label: k,
      description: vars[k],
      detail: `${scope} variable — click to edit or delete`,
    }));
    const pick = await vscode.window.showQuickPick(
      [...entries, { label: ADD, description: "", detail: "" }, { label: DONE, description: "", detail: "" }],
      { title: `Manage ${scope} variables`, placeHolder: "Select a variable to edit/delete, or add a new one", ignoreFocusOut: true }
    );
    if (!pick || pick.label === DONE) { break; }

    if (pick.label === ADD) {
      const key = await vscode.window.showInputBox({ prompt: "Variable name", placeHolder: "bmp_port", ignoreFocusOut: true });
      if (!key?.trim()) { continue; }
      const val = await vscode.window.showInputBox({ prompt: `Value for "${key.trim()}"`, ignoreFocusOut: true, value: "" });
      if (val === undefined) { continue; }
      vars[key.trim()] = val;
    } else {
      const key = pick.label;
      const action = await vscode.window.showQuickPick(
        [
          { label: "$(edit)  Edit value", id: "edit" },
          { label: "$(trash)  Delete", id: "delete" },
          { label: "$(close)  Cancel", id: "cancel" },
        ],
        { title: `Variable: ${key} = ${vars[key]}`, ignoreFocusOut: true }
      );
      if (!action || action.id === "cancel") { continue; }
      if (action.id === "delete") {
        delete vars[key];
      } else {
        const val = await vscode.window.showInputBox({ prompt: `New value for "${key}"`, ignoreFocusOut: true, value: vars[key] });
        if (val === undefined) { continue; }
        vars[key] = val;
      }
    }
  }

  await saveVars(vars);
  await setWorkspaceState(context, wsConfig);
  void vscode.commands.executeCommand("zephyr-ide.update-web-view");
}

/** Open the custom variable editor for the active build. */
export async function manageBuildVariables(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig): Promise<void> {
  const resolved = resolveActiveProjectBuild(wsConfig, { caller: "Manage Build Variables" });
  if (!resolved) { return; }
  await editCustomVars(
    context, wsConfig, "build",
    resolved.build.customVars ?? {},
    async (updated) => { resolved.build.customVars = Object.keys(updated).length ? updated : undefined; },
  );
}

/** Open the custom variable editor for the active project. */
export async function manageProjectVariables(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig): Promise<void> {
  const resolved = resolveActiveProjectBuild(wsConfig, { caller: "Manage Project Variables" });
  if (!resolved) { return; }
  await editCustomVars(
    context, wsConfig, "project",
    resolved.project.customVars ?? {},
    async (updated) => { resolved.project.customVars = Object.keys(updated).length ? updated : undefined; },
  );
}

