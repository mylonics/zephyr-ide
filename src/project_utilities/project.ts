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
import * as fs from "fs-extra";
import * as path from "upath";
import { selectLaunchConfiguration } from "../utilities/utils";
import { notifyError, notifyWarningWithActions } from "../utilities/output";
import { buildSelector, BuildConfig, BuildConfigDictionary, BuildStateDictionary } from "./build_selector";
import { WorkspaceConfig } from "../setup_utilities/types";
import { setWorkspaceState } from "../setup_utilities/state-management";
import { runnerSelector, RunnerConfig } from "./runner_selector";
import { configSelector, configRemover, ConfigFiles } from "./config_selector";
import { setDtsContext } from "../setup_utilities/dts_interface";
import { getSamples } from "../setup_utilities/modules";
import { getSetupState } from "../setup_utilities/workspace-config";

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

/** Get active build name from an already-resolved project */
export function getResolvedBuildName(wsConfig: WorkspaceConfig, resolved: ResolvedProject): string | undefined {
  return wsConfig.projectStates[resolved.projectName].activeBuildConfig;
}

/** Get active runner name from an already-resolved project+build */
export function getResolvedRunnerName(wsConfig: WorkspaceConfig, resolved: ResolvedProjectBuild): string | undefined {
  return wsConfig.projectStates[resolved.projectName].buildStates[resolved.buildName]?.activeRunner;
}

/** Get active runner config from an already-resolved project+build */
export function getResolvedRunnerConfig(wsConfig: WorkspaceConfig, resolved: ResolvedProjectBuild): RunnerConfig | undefined {
  const runnerName = getResolvedRunnerName(wsConfig, resolved);
  return runnerName ? resolved.build.runnerConfigs[runnerName] : undefined;
}

/** Get active test name from an already-resolved project */
export function getResolvedTestName(wsConfig: WorkspaceConfig, resolved: ResolvedProject): string | undefined {
  return wsConfig.projectStates[resolved.projectName].activeTwisterConfig;
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

  const newWestBuildArgs = await vscode.window.showInputBox({ title: "Modify West Build Arguments", value: build.westBuildArgs, prompt: "West Build arguments i.e --sysbuild", placeHolder: "--sysbuild" });

  if (newWestBuildArgs !== undefined) {
    build.westBuildArgs = newWestBuildArgs;
  }

  const newCMakeBuildArgs = await vscode.window.showInputBox({ title: "Modify CMake Build Arguments", value: build.westBuildCMakeArgs, prompt: "CMake Build arguments i.e -DCMAKE_VERBOSE_MAKEFILE=ON", placeHolder: "-DCMAKE_VERBOSE_MAKEFILE=ON" });

  if (newCMakeBuildArgs !== undefined) {
    build.westBuildCMakeArgs = newCMakeBuildArgs;
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
    loadingQuickPick.hide();
    return;
  }
  const samplesDir = await getSamples(setupState);

  loadingQuickPick.hide();

  // Show sample selection QuickPick as usual
  const projectList: vscode.QuickPickItem[] = samplesDir.map(x => ({ label: x[1], detail: "(" + x[0] + ") " + x[3], description: x[2] }));
  const pickOptions: vscode.QuickPickOptions = {
    ignoreFocusOut: true,
    matchOnDescription: true,
    placeHolder: "Select Sample Project",
  };
  let selectedSample = await vscode.window.showQuickPick(projectList, pickOptions);
  if (selectedSample && selectedSample.detail && selectedSample.label) {
    let selectedSamplePath = selectedSample.detail.split(") ")[1];
    const projectDest = await vscode.window.showInputBox({ title: "Choose Project Destination", value: path.basename(selectedSamplePath) });
    if (projectDest) {
      const destinationPath = path.join(wsConfig.rootPath, projectDest);
      fs.cpSync(selectedSamplePath, destinationPath, { recursive: true });
      let newProjectName = path.basename(projectDest);
      if (selectedSample.label !== newProjectName) {
        changeProjectNameInCMakeFile(destinationPath, newProjectName);
      }
      return destinationPath;
    }
  }
}


export async function addConfigFiles(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, isKConfig: boolean, isToProject: boolean, projectName?: string, buildName?: string, isPrimary?: boolean) {
  const resolvedProject = resolveActiveProject(wsConfig, { caller: "Project", projectName });
  if (!resolvedProject) { return; }
  const { project } = resolvedProject;
  projectName = resolvedProject.projectName;

  if (!isToProject) {
    const resolvedBuild = resolveActiveProjectBuild(wsConfig, { caller: "Project", projectName, buildName });
    if (!resolvedBuild) { return; }
    buildName = resolvedBuild.buildName;
  }

  let result = await configSelector(wsConfig, isKConfig, isToProject, isPrimary);
  if (result) {
    if (isToProject) {
      project.confFiles.config = project.confFiles.config.concat(result.config);
      project.confFiles.extraConfig = project.confFiles.extraConfig.concat(result.extraConfig);
      project.confFiles.overlay = project.confFiles.overlay.concat(result.overlay);
      project.confFiles.extraOverlay = project.confFiles.extraOverlay.concat(result.extraOverlay);
    } else {
      if (buildName) {
        let buildConf = project.buildConfigs[buildName].confFiles;
        buildConf.config = buildConf.config.concat(result.config);
        buildConf.extraConfig = buildConf.extraConfig.concat(result.extraConfig);
        buildConf.overlay = buildConf.overlay.concat(result.overlay);
        buildConf.extraOverlay = buildConf.extraOverlay.concat(result.extraOverlay);
      } else {
        return;
      }
    }
    await setWorkspaceState(context, wsConfig);
    vscode.window.showInformationMessage(`Successfully Added Config Files`);
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
  let result = await configRemover(confFiles, isKConfig, isToProject, isPrimary);

  if (result) {
    if (isToProject) {
      wsConfig.projects[projectName].confFiles = result;
    } else {
      if (buildName) {
        wsConfig.projects[projectName].buildConfigs[buildName].confFiles = result;
      }
    }
  }

  await setWorkspaceState(context, wsConfig);
  vscode.window.showInformationMessage(`Successfully Removed Config Files`);
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

  if (isKConfig) {
    if (isPrimary) {
      confFiles.config = confFiles.config.filter(function (el) {
        return !fileNames.includes(el);
      });
    } else {
      confFiles.extraConfig = confFiles.extraConfig.filter(function (el) {
        return !fileNames.includes(el);
      });
    }
  } else {
    if (isPrimary) {
      confFiles.overlay = confFiles.overlay.filter(function (el) {
        return !fileNames.includes(el);
      });
    } else {
      confFiles.extraOverlay = confFiles.extraOverlay.filter(function (el) {
        return !fileNames.includes(el);
      });
    }
  }
  await setWorkspaceState(context, wsConfig);
  vscode.window.showInformationMessage(`Successfully Removed Config Files`);
}

export async function askUserForProject(wsConfig: WorkspaceConfig) {
  const pickOptions: vscode.QuickPickOptions = {
    ignoreFocusOut: true,
    placeHolder: "Select Project",
  };
  if (Object.keys(wsConfig.projects).length === 0) {
    notifyError("Project", "First Run `Add Project` or `Create Project`");
    return;
  }

  let projectList: string[] = [];
  for (let key in wsConfig.projects) {
    projectList.push(key);
  }

  let selectedProject = await vscode.window.showQuickPick(projectList, pickOptions);
  return selectedProject;
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
  vscode.window.showInformationMessage(`Successfully Set ${selectedProject} as Active Project`);
  setDtsContext(wsConfig);
}

export async function askUserForBuild(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, projectName: string) {
  const pickOptions: vscode.QuickPickOptions = {
    ignoreFocusOut: true,
    placeHolder: "Select Build",
  };

  let buildConfigs = wsConfig.projects[projectName].buildConfigs;

  let buildList: string[] = [];
  for (let key in buildConfigs) {
    buildList.push(key);
  }

  let selectedBuild = await vscode.window.showQuickPick(buildList, pickOptions);
  return selectedBuild;
}

export async function askUserForTest(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, projectName: string) {
  const pickOptions: vscode.QuickPickOptions = {
    ignoreFocusOut: true,
    placeHolder: "Select Test",
  };

  let twisterConfigs = wsConfig.projects[projectName].twisterConfigs;

  let testList: string[] = [];
  for (let key in twisterConfigs) {
    testList.push(key);
  }

  let selectedTest = await vscode.window.showQuickPick(testList, pickOptions);
  return selectedTest;
}

export async function setActiveBuild(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, projectName?: string, selectedBuild?: string) {
  if (wsConfig.activeProject === undefined) {
    setActiveProject(context, wsConfig);
    if (wsConfig.activeProject === undefined) {
      notifyError("Build Config", "Set Active Project before trying to Set Active Build");
      return;
    }
  }

  if (selectedBuild === undefined) {
    selectedBuild = await askUserForBuild(context, wsConfig, wsConfig.activeProject);
    if (selectedBuild === undefined) {
      return;
    }
  }

  let buildConfigs = wsConfig.projects[wsConfig.activeProject].buildConfigs;
  wsConfig.projectStates[wsConfig.activeProject].activeBuildConfig = buildConfigs[selectedBuild].name;
  await setWorkspaceState(context, wsConfig);
  setDtsContext(wsConfig);
  vscode.window.showInformationMessage(`Successfully Set ${selectedBuild} as Active Build of ${wsConfig.activeProject}`);
}

export async function setActiveTest(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, projectName?: string, selectedTest?: string) {
  if (wsConfig.activeProject === undefined) {
    setActiveProject(context, wsConfig);
    if (wsConfig.activeProject === undefined) {
      notifyError("Test Config", "Set Active Project before trying to Set Active Build");
      return;
    }
  }

  if (selectedTest === undefined) {
    selectedTest = await askUserForTest(context, wsConfig, wsConfig.activeProject);
    if (selectedTest === undefined) {
      return;
    }
  }

  let twisterConfigs = wsConfig.projects[wsConfig.activeProject].twisterConfigs;
  wsConfig.projectStates[wsConfig.activeProject].activeTwisterConfig = twisterConfigs[selectedTest].name;
  await setWorkspaceState(context, wsConfig);
  setDtsContext(wsConfig);
  vscode.window.showInformationMessage(`Successfully Set ${selectedTest} as Active Test of ${wsConfig.activeProject}`);
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
    if (wsConfig.activeProject === projectName) {
      wsConfig.activeProject = undefined;
    }
    await setWorkspaceState(context, wsConfig);
    return true;
  }
}

export async function changeProjectNameInCMakeFile(projectPath: string, newProjectName: string) {
  let projectCmakePath = projectPath + "/CMakeLists.txt";

  if (fs.existsSync(projectCmakePath)) {
    const projectCMakeFile = fs.readFileSync(projectCmakePath, 'utf8');
    let newProjectCMakeFile = projectCMakeFile.replace(/project\([^)]*\)/i, "project(" + newProjectName + ")");
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
      title: "Select project folder."
    };

    // Open file picker for destination directory
    let open = await vscode.window.showOpenDialog(dialogOptions);
    if (open === undefined) {
      notifyError("Project", 'Failed to provide a valid target folder.');
      return null;
    }

    projectPath = open[0].fsPath;
    let projectCmakePath = projectPath + "/CMakeLists.txt";
    if (fs.pathExistsSync(projectCmakePath)) {
      let contents = await vscode.workspace.openTextDocument(projectCmakePath).then(document => {
        return document.getText();
      });

      if (contents.includes("project(")) {

      } else {
        vscode.window.showInformationMessage(`Failed to Load Project ${projectPath}, Does your project folder have a correct CMake File?`);
        return;
      }
    } else {
      vscode.window.showInformationMessage(`Failed to Load Project ${projectPath}, Does your project folder have a CMakeLists.txt File?`);
      return;
    }
  }
  if (projectPath === undefined) {
    return;
  }
  let projectName = path.basename(projectPath);
  wsConfig.projects[projectName] = {
    rel_path: path.relative(wsConfig.rootPath, projectPath),
    name: projectName,
    buildConfigs: {},
    twisterConfigs: {},
    confFiles: {
      config: [],
      extraConfig: [],
      overlay: [],
      extraOverlay: [],
    },
  };
  wsConfig.projectStates[projectName] = { buildStates: {}, viewOpen: true, twisterStates: {} };
  setActiveProject(context, wsConfig, projectName);
  await setWorkspaceState(context, wsConfig);

  vscode.window.showInformationMessage(`Successfully loaded Project ${projectPath}`);
  return true;
}

export async function addBuildToProject(wsConfig: WorkspaceConfig, context: vscode.ExtensionContext, projectName: string) {
  const setupState = await getSetupState(context, wsConfig);
  if (!setupState) {
    return;
  }
  let result = await buildSelector(context, setupState, wsConfig.rootPath);
  if (result && result.name !== undefined) {
    result.runnerConfigs = {};
    if (wsConfig.projects[projectName].buildConfigs[result.name]) {
      const selection = await vscode.window.showWarningMessage('Build Configuration with name: ' + result.name + ' already exists!', 'Overwrite', 'Cancel');
      if (selection !== 'Overwrite') {
        notifyError("Build Config", `Failed to add build configuration`);
        return;
      }
    }

    vscode.window.showInformationMessage(`Creating Build Configuration: ${result.name}`);
    wsConfig.projects[projectName].buildConfigs[result.name] = result;
    wsConfig.projectStates[projectName].buildStates[result.name] = { runnerStates: {}, viewOpen: true };
    setActiveBuild(context, wsConfig, projectName, result.name);

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

export async function removeBuild(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, projectName?: string, buildName?: string) {
  if (projectName === undefined) {
    projectName = await askUserForProject(wsConfig);
    if (projectName === undefined) {
      return;
    }
  }
  if (buildName === undefined) {
    buildName = await askUserForBuild(context, wsConfig, projectName);
    if (buildName === undefined) {
      return;
    }
  }
  if (buildName in wsConfig.projects[projectName].buildConfigs) {

    const selection = await vscode.window.showWarningMessage('Are you sure you want to remove ' + buildName + '?', 'Yes', 'Cancel');
    if (selection !== 'Yes') {
      return;
    }
    delete wsConfig.projects[projectName].buildConfigs[buildName];
    if (wsConfig.projectStates[projectName].activeBuildConfig === buildName) {
      wsConfig.projectStates[projectName].activeBuildConfig = undefined;
    }
    await setWorkspaceState(context, wsConfig);
    return true;
  }
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

  let result = await twisterSelector(wsConfig.projects[projectName].rel_path, context, setupState, wsConfig.rootPath);
  if (result && result.name !== undefined) {
    if (wsConfig.projects[projectName].twisterConfigs[result.name]) {
      const selection = await vscode.window.showWarningMessage('Twister Configuration with name: ' + result.name + ' already exists!', 'Overwrite', 'Cancel');
      if (selection !== 'Overwrite') {
        notifyError("Test Config", `Failed to add twister configuration`);
        return;
      }
    }

    vscode.window.showInformationMessage(`Creating Twister Configuration: ${result.name}`);

    //Remove the following upgrade code eventually
    if (wsConfig.projects[projectName].twisterConfigs === undefined) {
      wsConfig.projects[projectName].twisterConfigs = {};
      wsConfig.projectStates[projectName].twisterStates = {};
    }

    wsConfig.projects[projectName].twisterConfigs[result.name] = result;
    wsConfig.projectStates[projectName].twisterStates[result.name] = { viewOpen: true };

    setActiveTest(context, wsConfig, projectName, result.name);
    await setWorkspaceState(context, wsConfig);
  }
}

export async function removeTest(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, projectName?: string, testName?: string) {
  if (projectName === undefined) {
    projectName = await askUserForProject(wsConfig);
    if (projectName === undefined) {
      return;
    }
  }
  if (testName === undefined) {
    testName = await askUserForTest(context, wsConfig, projectName);
    if (testName === undefined) {
      return;
    }
  }
  if (testName in wsConfig.projects[projectName].twisterConfigs) {

    const selection = await vscode.window.showWarningMessage('Are you sure you want to remove ' + testName + '?', 'Yes', 'Cancel');
    if (selection !== 'Yes') {
      return;
    }
    delete wsConfig.projects[projectName].twisterConfigs[testName];
    if (wsConfig.projectStates[projectName].activeTwisterConfig === testName) {
      wsConfig.projectStates[projectName].activeTwisterConfig = undefined;
    }
    await setWorkspaceState(context, wsConfig);
    return true;
  }
}

export async function removeRunner(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, projectName?: string, buildName?: string, runnerName?: string) {
  if (projectName === undefined) {
    projectName = await askUserForProject(wsConfig);
    if (projectName === undefined) {
      return;
    }
  }
  if (buildName === undefined) {
    buildName = await askUserForBuild(context, wsConfig, projectName);
    if (buildName === undefined) {
      return;
    }
  }
  if (runnerName === undefined) {
    runnerName = await askUserForRunner(context, wsConfig, projectName, buildName);
    if (runnerName === undefined) {
      return;
    }
  }
  let build = wsConfig.projects[projectName].buildConfigs[buildName];

  if (runnerName in build.runnerConfigs) {
    const selection = await vscode.window.showWarningMessage('Are you sure you want to remove ' + runnerName + '?', 'Yes', 'Cancel');
    if (selection !== 'Yes') {
      return;
    }
    delete build.runnerConfigs[runnerName];
    if (wsConfig.projectStates[projectName].buildStates[buildName].activeRunner === runnerName) {
      wsConfig.projectStates[projectName].buildStates[buildName].activeRunner = undefined;
    }
    await setWorkspaceState(context, wsConfig);
    return true;
  }
}

export async function setActive(wsConfig: WorkspaceConfig, project: string, build?: string, runner?: string, test?: string) {
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
    vscode.commands.executeCommand("zephyr-ide.update-web-view");
  }
}

export async function askUserForRunner(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, projectName: string, buildName: string) {
  const pickOptions: vscode.QuickPickOptions = {
    ignoreFocusOut: true,
    placeHolder: "Select Runner",
  };

  let buildConfig = wsConfig.projects[projectName].buildConfigs[buildName];

  let runnerList: string[] = [];
  for (let key in buildConfig.runnerConfigs) {
    runnerList.push(key);
  }

  let selectedRunner = await vscode.window.showQuickPick(runnerList, pickOptions);
  return selectedRunner;
}


export async function setActiveRunner(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig) {
  if (wsConfig.activeProject === undefined) {
    setActiveProject(context, wsConfig);
    if (wsConfig.activeProject === undefined) {
      notifyError("Runner Config", "Set Active Project before trying to Set Active Build");
      return;
    }
  }
  let activeBuildName = wsConfig.projectStates[wsConfig.activeProject].activeBuildConfig;

  if (activeBuildName === undefined) {
    setActiveBuild(context, wsConfig);
    activeBuildName = wsConfig.projectStates[wsConfig.activeProject].activeBuildConfig;
    if (activeBuildName === undefined) {
      notifyError("Runner Config", "Set Active Build before trying to Set Active Runner");
      return;
    }
  }

  let activeBuild = wsConfig.projects[wsConfig.activeProject].buildConfigs[activeBuildName];

  let selectedRunner = await askUserForRunner(context, wsConfig, wsConfig.activeProject, activeBuildName);

  if (selectedRunner === undefined) {
    return;
  }

  wsConfig.projectStates[wsConfig.activeProject].buildStates[activeBuildName].activeRunner = selectedRunner;
  await setWorkspaceState(context, wsConfig);
  vscode.window.showInformationMessage(`Successfully Set ${selectedRunner} as Active Runner for ${activeBuild.name} of ${wsConfig.activeProject}`);
}

export async function addRunnerToBuild(wsConfig: WorkspaceConfig, context: vscode.ExtensionContext, projectName: string, buildName: string) {
  let build = wsConfig.projects[projectName].buildConfigs[buildName];

  let result;
  if (path.isAbsolute(build.relBoardSubDir)) {
    result = await runnerSelector(build.relBoardSubDir);
  } else {
    if (build.relBoardDir) {
      //Custom Folder
      result = await runnerSelector(path.join(wsConfig.rootPath, build.relBoardDir, build.relBoardSubDir));
    } else {
      const setupState = await getSetupState(context, wsConfig);
      if (setupState) {
        //Default zephyr folder
        result = await runnerSelector(path.join(setupState.zephyrDir, 'boards', build.relBoardSubDir));
      }
    }
  }

  if (result && result.name !== undefined) {
    if (build.runnerConfigs[result.name]) {
      const selection = await vscode.window.showWarningMessage('Runner Configuration with name: ' + result.name + ' already exists!', 'Overwrite', 'Cancel');
      if (selection !== 'Overwrite') {
        notifyError("Runner Config", `Failed to add runner configuration`);
        return;
      }
    }
    vscode.window.showInformationMessage(`Creating Runner Configuration: ${result.name}`);
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

export async function selectDebugLaunchConfiguration(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig) {
  let activeBuild = await getActiveBuild(wsConfig);
  let newConfig = await selectLaunchConfiguration(wsConfig);
  if (activeBuild && newConfig) {
    activeBuild.launchTarget = newConfig.name;
    activeBuild.launchTargetFolder = newConfig.workspaceFolder;
    await setWorkspaceState(context, wsConfig);
  }
}

export async function selectBuildDebugLaunchConfiguration(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig) {
  let activeBuild = await getActiveBuild(wsConfig);
  let newConfig = await selectLaunchConfiguration(wsConfig);
  if (activeBuild && newConfig) {
    activeBuild.buildDebugTarget = newConfig.name;
    activeBuild.buildDebugTargetFolder = newConfig.workspaceFolder;
    await setWorkspaceState(context, wsConfig);
  }
}

export async function selectDebugAttachLaunchConfiguration(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig) {
  let activeBuild = await getActiveBuild(wsConfig);
  let newConfig = await selectLaunchConfiguration(wsConfig);
  if (activeBuild && newConfig) {
    activeBuild.attachTarget = newConfig.name;
    activeBuild.attachTargetFolder = newConfig.workspaceFolder;
    await setWorkspaceState(context, wsConfig);
  }
}


//export function getTestsFromProject(wsConfig: WorkspaceConfig, projectName: string) {
//  let projectPath = path.join(wsConfig.rootPath, wsConfig.projects[projectName].rel_path);
//  let testcasePath = path.join(projectPath, "testcase.yaml");
//  let samplePath = path.join(projectPath, "sample.yaml");
//
//  let filePath: string | undefined;
//  if (fs.existsSync(testcasePath)) {
//    filePath = testcasePath;
//  } else if (fs.existsSync(samplePath)) {
//    filePath = samplePath;
//  }
//
//  let tests: string[] = []
//  if (filePath) {
//    let yamlFile: any = yaml.load(fs.readFileSync(filePath, 'utf-8'));
//    if (yamlFile && yamlFile.tests) {
//      for (var prop in yamlFile.tests) {
//        tests.push(prop);
//      }
//    }
//  }
//  return tests;
//}