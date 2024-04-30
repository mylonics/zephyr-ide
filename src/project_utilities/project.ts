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
import * as path from "path";
import { selectLaunchConfiguration } from "../utilities/utils";
import { buildSelector, BuildConfigDictionary } from "./build_selector";
import { setWorkspaceState, WorkspaceConfig } from "../setup_utilities/setup";
import { runnerSelector } from "./runner_selector";
import { configSelector, configRemover, ConfigFiles } from "./config_selector";

// Project specific configuration
export interface ProjectConfig {
  name: string;
  rel_path: string;
  activeBuildConfig?: string;
  buildConfigs: BuildConfigDictionary;
  confFiles: ConfigFiles;
}

export async function createNewProjectFromSample(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig) {
  if (!wsConfig.zephyrDir) {
    vscode.window.showErrorMessage("Run `Zephyr IDE: West Init` first.");
    return;
  }
  let sampleDir = path.join(wsConfig.zephyrDir, "samples/basic");
  let files = await vscode.workspace.fs.readDirectory(vscode.Uri.file(sampleDir));
  let projectList: string[] = [];

  while (true) {
    let file = files.pop();
    // Stop looping once done.
    if (file === undefined) {
      break;
    }

    if (file[1] === vscode.FileType.Directory) {
      projectList.unshift(file[0]);
    }
  }

  const pickOptions: vscode.QuickPickOptions = {
    ignoreFocusOut: true,
    placeHolder: "Select Sample Project",
  };

  let selectedProject = await vscode.window.showQuickPick(projectList, pickOptions);

  if (selectedProject) {
    let projectName = await vscode.window.showInputBox({ title: "Choose Project Name", value: selectedProject });

    if (projectName) {
      if (projectName in wsConfig.projects) {
        vscode.window.showErrorMessage("A project of that name already exists.");
      }
      let projectDest = path.join(wsConfig.rootPath, projectName);
      fs.cpSync(path.join(sampleDir, selectedProject), projectDest, { recursive: true });
      return projectDest;
    }
  }
}

export async function addConfigFiles(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, isKConfig: boolean, isToProject: boolean, projectName?: string, buildName?: string, isPrimary?: boolean) {
  if (!projectName) {
    if (wsConfig.activeProject === undefined) {
      vscode.window.showErrorMessage("Set Active Project before trying to Add Config Files");
      return;
    }
    projectName = wsConfig.activeProject;
  }

  if (!isToProject) {
    if (!buildName) {
      if (wsConfig.projects[projectName].activeBuildConfig === undefined) {
        vscode.window.showErrorMessage("Set Active Build before trying to Add Config Files");
        return;
      }
      buildName = wsConfig.projects[projectName].activeBuildConfig;
    }
  }

  let result = await configSelector(wsConfig, isKConfig, isToProject, isPrimary);
  if (result) {
    if (isToProject) {
      wsConfig.projects[projectName].confFiles.config = wsConfig.projects[projectName].confFiles.config.concat(result.config);
      wsConfig.projects[projectName].confFiles.extraConfig = wsConfig.projects[projectName].confFiles.extraConfig.concat(result.extraConfig);
      wsConfig.projects[projectName].confFiles.overlay = wsConfig.projects[projectName].confFiles.overlay.concat(result.overlay);
      wsConfig.projects[projectName].confFiles.extraOverlay = wsConfig.projects[projectName].confFiles.extraOverlay.concat(result.extraOverlay);
    } else {
      if (buildName) {
        wsConfig.projects[projectName].buildConfigs[buildName].confFiles.config = wsConfig.projects[projectName].buildConfigs[buildName].confFiles.config.concat(result.config);
        wsConfig.projects[projectName].buildConfigs[buildName].confFiles.extraConfig = wsConfig.projects[projectName].buildConfigs[buildName].confFiles.extraConfig.concat(result.extraConfig);
        wsConfig.projects[projectName].buildConfigs[buildName].confFiles.overlay = wsConfig.projects[projectName].buildConfigs[buildName].confFiles.overlay.concat(result.overlay);
        wsConfig.projects[projectName].buildConfigs[buildName].confFiles.extraOverlay = wsConfig.projects[projectName].buildConfigs[buildName].confFiles.extraOverlay.concat(result.extraOverlay);
      }
    }
    await setWorkspaceState(context, wsConfig);
    vscode.window.showInformationMessage(`Successfully Added Config Files`);
  }

}

export async function removeConfigFiles(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, isKConfig: boolean, isToProject: boolean, projectName?: string, buildName?: string, isPrimary?: boolean) {
  if (!projectName) {
    if (wsConfig.activeProject === undefined) {
      vscode.window.showErrorMessage("Set Active Project before trying to remove Config Files");
      return;
    }
    projectName = wsConfig.activeProject;
  }

  let confFiles = wsConfig.projects[projectName].confFiles;

  if (!isToProject) {
    if (!buildName) {
      if (wsConfig.projects[projectName].activeBuildConfig === undefined) {
        vscode.window.showErrorMessage("Set Active Build before trying to remove Config Files");
        return;
      }
      buildName = wsConfig.projects[projectName].activeBuildConfig;
    }
    if (buildName) {
      confFiles = wsConfig.projects[projectName].buildConfigs[buildName].confFiles;
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
      vscode.window.showErrorMessage("Set build before trying to remove Config Files");
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
    vscode.window.showErrorMessage("First Run `Add Project` or `Create Project`");
    return;
  }

  let projectList: string[] = [];
  for (let key in wsConfig.projects) {
    projectList.push(key);
  }

  let selectedProject = await vscode.window.showQuickPick(projectList, pickOptions);
  return selectedProject;
}

export async function setActiveProject(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig) {
  let selectedProject = await askUserForProject(wsConfig);
  if (selectedProject === undefined) {
    return;
  }
  wsConfig.activeProject = selectedProject;
  await setWorkspaceState(context, wsConfig);
  vscode.window.showInformationMessage(`Successfully Set ${selectedProject} as Active Project`);
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

export async function setActiveBuild(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig) {
  if (wsConfig.activeProject === undefined) {
    setActiveProject(context, wsConfig);
    if (wsConfig.activeProject === undefined) {
      vscode.window.showErrorMessage("Set Active Project before trying to Set Active Build");
      return;
    }
  }

  let selectedBuild = await askUserForBuild(context, wsConfig, wsConfig.activeProject);
  if (selectedBuild === undefined) {
    return;
  }
  let buildConfigs = wsConfig.projects[wsConfig.activeProject].buildConfigs;
  wsConfig.projects[wsConfig.activeProject].activeBuildConfig = buildConfigs[selectedBuild].name;
  await setWorkspaceState(context, wsConfig);
  vscode.window.showInformationMessage(`Successfully Set ${selectedBuild} as Active Build of ${wsConfig.activeProject}`);
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
      vscode.window.showErrorMessage('Failed to provide a valid target folder.');
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
  let projectName = path.parse(projectPath).name;
  wsConfig.projects[projectName] = {
    rel_path: path.relative(wsConfig.rootPath, projectPath),
    name: projectName,
    buildConfigs: {},
    confFiles: {
      config: [],
      extraConfig: [],
      overlay: [],
      extraOverlay: [],
    },
  };
  wsConfig.activeProject = projectName;
  await setWorkspaceState(context, wsConfig);

  vscode.window.showInformationMessage(`Successfully loaded Project ${projectPath}`);
}

export async function addBuildToProject(wsConfig: WorkspaceConfig, context: vscode.ExtensionContext, projectName: string) {

  let result = await buildSelector(wsConfig);
  if (result && result.name !== undefined) {
    result.runners = {};
    if (wsConfig.projects[projectName].buildConfigs[result.name]) {
      const selection = await vscode.window.showWarningMessage('Build Configuration with name: ' + result.name + ' already exists!', 'Overwrite', 'Cancel');
      if (selection !== 'Overwrite') {
        vscode.window.showErrorMessage(`Failed to add build configuration`);
        return;
      }
    }

    vscode.window.showInformationMessage(`Creating Build Configuration: ${result.name}`);
    wsConfig.projects[projectName].buildConfigs[result.name] = result;
    wsConfig.projects[projectName].activeBuildConfig = result.name;
    await setWorkspaceState(context, wsConfig);
  }

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
    if (wsConfig.projects[projectName].activeBuildConfig === buildName) {
      wsConfig.projects[projectName].activeBuildConfig = undefined;
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

  if (runnerName in build.runners) {
    const selection = await vscode.window.showWarningMessage('Are you sure you want to remove ' + runnerName + '?', 'Yes', 'Cancel');
    if (selection !== 'Yes') {
      return;
    }
    delete build.runners[runnerName];
    if (build.activeRunner === runnerName) {
      build.activeRunner = undefined;
    }
    await setWorkspaceState(context, wsConfig);
    return true;
  }
}

export async function addBuild(wsConfig: WorkspaceConfig, context: vscode.ExtensionContext) {
  if (wsConfig.activeProject === undefined) {
    vscode.window.showErrorMessage(`Failed to Add Build Configuration, please first select a project`);
    return;
  }
  await addBuildToProject(wsConfig, context, wsConfig.activeProject);
}

export async function setActive(wsConfig: WorkspaceConfig, project: string, build?: string, runner?: string) {
  if (project) {
    wsConfig.activeProject = project;
    if (build) {
      wsConfig.projects[wsConfig.activeProject].activeBuildConfig = build;
      let buildConfig = wsConfig.projects[wsConfig.activeProject].buildConfigs[build];
      if (runner) {
        buildConfig.activeRunner = runner;
      }
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
  for (let key in buildConfig.runners) {
    runnerList.push(key);
  }

  let selectedRunner = await vscode.window.showQuickPick(runnerList, pickOptions);
  return selectedRunner;
}


export async function setActiveRunner(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig) {
  if (wsConfig.activeProject === undefined) {
    setActiveProject(context, wsConfig);
    if (wsConfig.activeProject === undefined) {
      vscode.window.showErrorMessage("Set Active Project before trying to Set Active Build");
      return;
    }
  }
  let activeBuildName = wsConfig.projects[wsConfig.activeProject].activeBuildConfig;

  if (activeBuildName === undefined) {
    setActiveBuild(context, wsConfig);
    activeBuildName = wsConfig.projects[wsConfig.activeProject].activeBuildConfig;
    if (activeBuildName === undefined) {
      vscode.window.showErrorMessage("Set Active Build before trying to Set Active Runner");
      return;
    }
    return;
  }

  let activeBuild = wsConfig.projects[wsConfig.activeProject].buildConfigs[activeBuildName];

  let runnerList: string[] = [];
  for (let key in activeBuild.runners) {
    runnerList.push(key);
  }
  let selectedRunner = await askUserForRunner(context, wsConfig, wsConfig.activeProject, activeBuildName);

  if (selectedRunner === undefined) {
    return;
  }
  activeBuild.activeRunner = selectedRunner;
  await setWorkspaceState(context, wsConfig);
  vscode.window.showInformationMessage(`Successfully Set ${selectedRunner} as Active Runner for ${activeBuild.name} of ${wsConfig.activeProject}`);
}

export async function addRunnerToBuild(wsConfig: WorkspaceConfig, context: vscode.ExtensionContext, projectName: string, buildName: string) {
  let build = wsConfig.projects[projectName].buildConfigs[buildName];
  let result = await runnerSelector();
  if (result && result.name !== undefined) {
    if (build.runners[result.name]) {
      const selection = await vscode.window.showWarningMessage('Runner Configuration with name: ' + result.name + ' already exists!', 'Overwrite', 'Cancel');
      if (selection !== 'Overwrite') {
        vscode.window.showErrorMessage(`Failed to add runner configuration`);
        return;
      }
    }
    vscode.window.showInformationMessage(`Creating Runner Configuration: ${result.name}`);
    build.runners[result.name] = result;
    build.activeRunner = result.name;
    await setWorkspaceState(context, wsConfig);
    return;
  }
}



export async function addRunner(wsConfig: WorkspaceConfig, context: vscode.ExtensionContext) {
  if (wsConfig.activeProject === undefined) {
    vscode.window.showInformationMessage(`Failed to add Runner, please first select a project`);
    return;
  }
  let activeProject = wsConfig.projects[wsConfig.activeProject];
  if (activeProject.activeBuildConfig === undefined) {
    vscode.window.showInformationMessage(`Failed to add Runner, please first select a build`);
    return;
  }
  let activeBuild = activeProject.activeBuildConfig;
  await addRunnerToBuild(wsConfig, context, wsConfig.activeProject, activeBuild);
}

export async function getActiveBuild(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig) {
  if (wsConfig.activeProject === undefined) {
    return;
  }
  let project = wsConfig.projects[wsConfig.activeProject];

  if (project.activeBuildConfig === undefined) {
    return;
  }

  return project.buildConfigs[project.activeBuildConfig];
}

export async function selectDebugLaunchConfiguration(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig) {
  let activeBuild = await getActiveBuild(context, wsConfig);
  let newConfig = await selectLaunchConfiguration();
  if (activeBuild && newConfig) {
    activeBuild.launchTarget = newConfig;
    await setWorkspaceState(context, wsConfig);
  }
}

export async function selectBuildDebugLaunchConfiguration(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig) {
  let activeBuild = await getActiveBuild(context, wsConfig);
  let newConfig = await selectLaunchConfiguration();
  if (activeBuild && newConfig) {
    activeBuild.buildDebugTarget = newConfig;
    await setWorkspaceState(context, wsConfig);
  }
}

export async function selectDebugAttachLaunchConfiguration(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig) {
  let activeBuild = await getActiveBuild(context, wsConfig);
  let newConfig = await selectLaunchConfiguration();
  if (activeBuild && newConfig) {
    activeBuild.attachTarget = newConfig;
    await setWorkspaceState(context, wsConfig);
  }
}
