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
import { selectLaunchConfiguration } from "../utilities/utils";
import { notifyError, notifyWarningWithActions } from "../utilities/output";
import { buildSelector, BuildConfig, BuildConfigDictionary, BuildStateDictionary } from "./build_selector";
import { WorkspaceConfig } from "../setup_utilities/types";
import { setWorkspaceState } from "../setup_utilities/state-management";
import { runnerSelector, RunnerConfig } from "./runner_selector";
import { configSelector, configRemover, ConfigFiles, mergeConfigFiles } from "./config_selector";
import { setDtsContext } from "../setup_utilities/dts_interface";
import { getSamples } from "../setup_utilities/modules";
import { getSetupState } from "../setup_utilities/workspace-config";
import { joinBuildArgs, normalizeBuildArgs, quoteCMakeDef } from "./build_args";

import { TwisterConfig, TwisterConfigDictionary, twisterSelector, TwisterStateDictionary } from "./twister_selector";


// Project specific configuration
export interface ProjectConfig {
  name: string;
  rel_path: string;
  buildConfigs: BuildConfigDictionary;
  confFiles: ConfigFiles;
  twisterConfigs: TwisterConfigDictionary;
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

/** Get active runner name from an already-resolved project+build */
export function getResolvedRunnerName(wsConfig: WorkspaceConfig, resolved: ResolvedProjectBuild): string | undefined {
  return wsConfig.projectStates[resolved.projectName]?.buildStates[resolved.buildName]?.activeRunner;
}

/** Get active runner config from an already-resolved project+build */
export function getResolvedRunnerConfig(wsConfig: WorkspaceConfig, resolved: ResolvedProjectBuild): RunnerConfig | undefined {
  const runnerName = getResolvedRunnerName(wsConfig, resolved);
  return runnerName ? resolved.build.runnerConfigs[runnerName] : undefined;
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

/** Resolved active project + build + runner info */
export interface ResolvedProjectBuildRunner extends ResolvedProjectBuild {
  runnerName: string;
  runner: RunnerConfig;
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
 * Resolve the active project, build, and runner.
 * When `caller` is provided, shows error notifications on failure.
 * When `caller` is omitted, returns undefined silently.
 */
export function resolveActiveProjectBuildRunner(
  wsConfig: WorkspaceConfig,
  options?: ResolveOptions
): ResolvedProjectBuildRunner | undefined {
  const resolved = resolveActiveProjectBuild(wsConfig, options);
  if (!resolved) {
    return undefined;
  }
  const rName = getResolvedRunnerName(wsConfig, resolved);
  if (!rName) {
    if (options?.caller) { notifyError(options.caller, "Select a runner before trying to continue"); }
    return undefined;
  }
  const runner = resolved.build.runnerConfigs[rName];
  if (!runner) {
    if (options?.caller) { notifyError(options.caller, `Runner "${rName}" not found`); }
    return undefined;
  }
  return { ...resolved, runnerName: rName, runner };
}

export async function modifyBuildArguments(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, projectName?: string, buildName?: string) {
  const resolved = resolveActiveProjectBuild(wsConfig, { caller: "Project", projectName, buildName });
  if (!resolved) { return; }
  const { project, build } = resolved;

  const newWestBuildArgs = await vscode.window.showInputBox({ title: "Modify West Build Arguments", value: joinBuildArgs(build.westBuildArgs), prompt: "West build arguments (e.g., --sysbuild)", placeHolder: "--sysbuild" });

  if (newWestBuildArgs !== undefined) {
    build.westBuildArgs = normalizeBuildArgs(newWestBuildArgs);
  }

  const newCMakeBuildArgs = await vscode.window.showInputBox({ title: "Modify CMake Build Arguments", value: joinBuildArgs(build.westBuildCMakeArgs), prompt: "CMake arguments (e.g., -DCMAKE_VERBOSE_MAKEFILE=ON)", placeHolder: "-DCMAKE_VERBOSE_MAKEFILE=ON" });

  if (newCMakeBuildArgs !== undefined) {
    build.westBuildCMakeArgs = normalizeBuildArgs(newCMakeBuildArgs);
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

  // Show sample selection QuickPick as usual
  const projectList: vscode.QuickPickItem[] = samplesDir.map(x => ({ label: x[1], detail: "(" + x[0] + ") " + x[3], description: x[2] }));
  const pickOptions: vscode.QuickPickOptions = {
    ignoreFocusOut: true,
    matchOnDescription: true,
    placeHolder: "Select Sample Project",
  };
  const selectedSample = await vscode.window.showQuickPick(projectList, pickOptions);
  if (selectedSample && selectedSample.detail && selectedSample.label) {
    const detailParts = selectedSample.detail.split(") ");
    const selectedSamplePath = detailParts.length > 1 ? detailParts.slice(1).join(") ") : detailParts[0];
    if (!selectedSamplePath) {
      return;
    }
    const projectDest = await vscode.window.showInputBox({ title: "Choose Project Destination", value: path.basename(selectedSamplePath) });
    if (projectDest) {
      const destinationPath = path.join(wsConfig.rootPath, projectDest);
      fs.cpSync(selectedSamplePath, destinationPath, { recursive: true });
      const newProjectName = path.basename(projectDest);
      if (selectedSample.label !== newProjectName) {
        changeProjectNameInCMakeFile(destinationPath, newProjectName);
      }
      return destinationPath;
    }
  }
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
    result.runnerConfigs = {};
    if (wsConfig.projects[projectName].buildConfigs[result.name]) {
      const selection = await vscode.window.showWarningMessage('A build configuration named "' + result.name + '" already exists', 'Overwrite', 'Cancel');
      if (selection !== 'Overwrite') {
        notifyError("Build Config", `Failed to add build configuration`);
        return;
      }
    }

    void vscode.window.showInformationMessage(`Creating Build Configuration: ${result.name}`);
    wsConfig.projects[projectName].buildConfigs[result.name] = result;
    wsConfig.projectStates[projectName].buildStates[result.name] = { runnerStates: {}, viewOpen: true };
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

export async function removeRunner(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, projectName?: string, buildName?: string, runnerName?: string) {
  if (projectName === undefined) {
    projectName = await askUserForProject(wsConfig);
    if (projectName === undefined) { return; }
  }
  if (buildName === undefined) {
    buildName = await askUserForBuild(wsConfig, projectName);
    if (buildName === undefined) { return; }
  }
  if (runnerName === undefined) {
    runnerName = await askUserForRunner(wsConfig, projectName, buildName);
    if (runnerName === undefined) { return; }
  }
  const build = wsConfig.projects[projectName].buildConfigs[buildName];
  const bs = wsConfig.projectStates[projectName].buildStates[buildName];
  return confirmAndRemoveItem(context, wsConfig, runnerName,
    build.runnerConfigs, bs.runnerStates,
    { get value() { return bs.activeRunner; }, set value(v) { bs.activeRunner = v; } },
  );
}

export async function setActive(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, project: string, build?: string, runner?: string, test?: string) {
  if (project) {
    wsConfig.activeProject = project;
    if (build) {
      wsConfig.projectStates[wsConfig.activeProject].activeBuildConfig = build;
      if (runner) {
        wsConfig.projectStates[wsConfig.activeProject].buildStates[build].activeRunner = runner;
      }
    }
    if (test) {
      wsConfig.projectStates[wsConfig.activeProject].activeTwisterConfig = test;
    }
    await setWorkspaceState(context, wsConfig);
    void vscode.commands.executeCommand("zephyr-ide.update-web-view");
  }
}

export async function askUserForRunner(wsConfig: WorkspaceConfig, projectName: string, buildName: string) {
  return await askUserForSelection(wsConfig.projects[projectName].buildConfigs[buildName].runnerConfigs, "Select Runner");
}


export async function setActiveRunner(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig) {
  if (wsConfig.activeProject === undefined) {
    await setActiveProject(context, wsConfig);
    if (wsConfig.activeProject === undefined) {
      notifyError("Runner Config", "Set Active Project before trying to Set Active Runner");
      return;
    }
  }
  let activeBuildName = wsConfig.projectStates[wsConfig.activeProject].activeBuildConfig;

  if (activeBuildName === undefined) {
    await setActiveBuild(context, wsConfig);
    activeBuildName = wsConfig.projectStates[wsConfig.activeProject].activeBuildConfig;
    if (activeBuildName === undefined) {
      notifyError("Runner Config", "Set Active Build before trying to Set Active Runner");
      return;
    }
  }

  const selectedRunner = await askUserForRunner(wsConfig, wsConfig.activeProject, activeBuildName);

  if (selectedRunner === undefined) {
    return;
  }

  wsConfig.projectStates[wsConfig.activeProject].buildStates[activeBuildName].activeRunner = selectedRunner;
  await setWorkspaceState(context, wsConfig);
  void vscode.window.showInformationMessage(`Successfully Set ${selectedRunner} as Active Runner for ${activeBuildName} of ${wsConfig.activeProject}`);
}

export async function addRunnerToBuild(wsConfig: WorkspaceConfig, context: vscode.ExtensionContext, projectName: string, buildName: string) {
  const build = wsConfig.projects[projectName].buildConfigs[buildName];

  const boardPath = resolveBoardPath(wsConfig, build, await getSetupState(context, wsConfig) ?? undefined);
  let result;
  if (boardPath) {
    result = await runnerSelector(boardPath);
  }

  if (result && result.name !== undefined) {
    if (build.runnerConfigs[result.name]) {
      const selection = await vscode.window.showWarningMessage('A runner named "' + result.name + '" already exists', 'Overwrite', 'Cancel');
      if (selection !== 'Overwrite') {
        notifyError("Runner Config", `Failed to add runner configuration`);
        return;
      }
    }
    void vscode.window.showInformationMessage(`Creating Runner Configuration: ${result.name}`);
    build.runnerConfigs[result.name] = result;
    wsConfig.projectStates[projectName].buildStates[buildName].activeRunner = result.name;
    await setWorkspaceState(context, wsConfig);
    return;
  }
}



export async function addRunner(wsConfig: WorkspaceConfig, context: vscode.ExtensionContext) {
  const resolved = resolveActiveProjectBuild(wsConfig, { caller: "Runner" });
  if (!resolved) {
    return;
  }
  await addRunnerToBuild(wsConfig, context, resolved.projectName, resolved.buildName);
}

export async function getActiveBuild(wsConfig: WorkspaceConfig) {
  const resolved = resolveActiveProjectBuild(wsConfig);
  if (!resolved) { return; }
  return resolved.build;
}

/**
 * Generic helper to select a launch configuration and assign it to the given
 * target property pair on the active build.
 */
async function selectLaunchConfigForTarget(
  context: vscode.ExtensionContext,
  wsConfig: WorkspaceConfig,
  targetNameKey: 'launchTarget' | 'buildDebugTarget' | 'attachTarget',
  targetFolderKey: 'launchTargetFolder' | 'buildDebugTargetFolder' | 'attachTargetFolder'
) {
  const activeBuild = await getActiveBuild(wsConfig);
  const newConfig = await selectLaunchConfiguration(wsConfig);
  if (activeBuild && newConfig) {
    activeBuild[targetNameKey] = newConfig.name;
    activeBuild[targetFolderKey] = newConfig.workspaceFolder;
    await setWorkspaceState(context, wsConfig);
  }
}

export async function selectDebugLaunchConfiguration(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig) {
  await selectLaunchConfigForTarget(context, wsConfig, 'launchTarget', 'launchTargetFolder');
}

export async function selectBuildDebugLaunchConfiguration(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig) {
  await selectLaunchConfigForTarget(context, wsConfig, 'buildDebugTarget', 'buildDebugTargetFolder');
}

export async function selectDebugAttachLaunchConfiguration(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig) {
  await selectLaunchConfigForTarget(context, wsConfig, 'attachTarget', 'attachTargetFolder');
}
