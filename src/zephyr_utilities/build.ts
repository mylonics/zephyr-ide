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
import * as path from 'path';
import * as fs from 'fs-extra';

import { getShellEnvironment, executeTaskHelper } from "../utilities/utils";

import { WorkspaceConfig, getActiveBuildOfProject, getActiveRunnerOfBuild } from '../setup_utilities/setup';
import { addBuild, ProjectConfig } from "../project_utilities/project";
import { BuildConfig } from "../project_utilities/build_selector";

export async function regenerateCompileCommands(wsConfig: WorkspaceConfig) {
  let compileCommandData = [];

  for (let projectName in wsConfig.projects) {
    let project = wsConfig.projects[projectName];
    for (let buildName in project.buildConfigs) {
      let build = project.buildConfigs[buildName];
      let basepath = path.join(wsConfig.rootPath, project.rel_path, build.name);
      let basefile = path.join(basepath, "compile_commands.json");
      let extfile = path.join(basepath, project.name, "compile_commands.json")
      if (fs.existsSync(basefile)) {
        let rawdata = await fs.readFile(basefile, 'utf8');
        compileCommandData.push(...JSON.parse(rawdata))
      } else if (fs.existsSync(extfile)) {
        let rawdata = await fs.readFile(extfile, 'utf8');
        compileCommandData.push(...JSON.parse(rawdata))
      }
    }
  }
  let data = JSON.stringify(compileCommandData);
  fs.outputFile(path.join(wsConfig.rootPath, '.vscode', 'compile_commands.json'), data);
}

export async function buildHelper(
  context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, pristine: boolean) {
  if (wsConfig.activeSetupState === undefined) {
    return;
  }
  if (wsConfig.activeSetupState.westUpdated) {
    if (wsConfig.activeProject === undefined) {
      vscode.window.showErrorMessage("Select a project before trying to build");
      return;
    }
    let project = wsConfig.projects[wsConfig.activeProject];

    let buildName = getActiveBuildOfProject(wsConfig, project.name);
    if (buildName === undefined) {
      await addBuild(wsConfig, context);
      buildName = getActiveBuildOfProject(wsConfig, project.name);
      if (buildName === undefined) {
        await vscode.window.showErrorMessage(`You must choose a Build Configuration to continue.`);
        return;
      }
    }
    return await build(wsConfig, project, project.buildConfigs[buildName], pristine);
  } else {
    vscode.window.showErrorMessage("Run `Zephyr IDE: West Update` command first.");
  }
}

export async function buildByName(wsConfig: WorkspaceConfig, pristine: boolean, projectName: string, buildName: string, isMenuConfig = false) {
  if (wsConfig.activeSetupState && wsConfig.activeSetupState.westUpdated) {
    let project = wsConfig.projects[projectName];
    let buildconfig = project.buildConfigs[buildName];
    if (project && build) {
      if (isMenuConfig) {
        buildMenuConfig(wsConfig, true, project, buildconfig);
      } else {
        build(wsConfig, project, buildconfig, pristine);
      }
    } else {
      vscode.window.showErrorMessage("Invalid project or build");
    }
  } else {
    vscode.window.showErrorMessage("Run `Zephyr IDE: West Update` command first.");
  }
}

export async function build(
  wsConfig: WorkspaceConfig,
  project: ProjectConfig,
  build: BuildConfig,
  pristine: boolean
) {

  let primaryConfFiles = project.confFiles.config.concat(build.confFiles.config);
  primaryConfFiles = primaryConfFiles.map(x => (path.join(wsConfig.rootPath, x)));
  let secondaryConfFiles = project.confFiles.extraConfig.concat(build.confFiles.extraConfig);
  secondaryConfFiles = secondaryConfFiles.map(x => (path.join(wsConfig.rootPath, x)));

  let overlayFiles = project.confFiles.overlay.concat(build.confFiles.overlay);
  overlayFiles = overlayFiles.map(x => (path.join(wsConfig.rootPath, x)));
  let extraOverlayFiles = project.confFiles.extraOverlay.concat(build.confFiles.extraOverlay);
  extraOverlayFiles = extraOverlayFiles.map(x => (path.join(wsConfig.rootPath, x)));

  let extraWestBuildArgs = "";
  if (build.westBuildArgs !== undefined) {
    extraWestBuildArgs = build.westBuildArgs;
  }

  let extraWestBuildCMakeArgs = "";
  if (build.westBuildCMakeArgs !== undefined) {
    extraWestBuildCMakeArgs = build.westBuildCMakeArgs;
  }

  let projectFolder = path.join(wsConfig.rootPath, project.rel_path);
  let buildFolder = path.join(wsConfig.rootPath, project.rel_path, build.name);

  let cmd = `west build ${projectFolder} --build-dir ${buildFolder} `;

  let buildFsDir;
  if (fs.existsSync(buildFolder)) {
    buildFsDir = fs.readdirSync(buildFolder);
  }

  if (pristine || buildFsDir == undefined || buildFsDir.length == 0) {

    let boardRoot;
    if (build.relBoardDir) {
      boardRoot = path.dirname(path.join(wsConfig.rootPath, build.relBoardDir));
    } else if (wsConfig.activeSetupState) {
      boardRoot = wsConfig.activeSetupState?.zephyrDir;
    }
    cmd = `west build -b ${build.board} ${projectFolder} -p --build-dir ${buildFolder} ${extraWestBuildArgs} -- -DBOARD_ROOT='${boardRoot}' ${extraWestBuildCMakeArgs} `;

    if (primaryConfFiles.length) {
      let confFileString = "";
      primaryConfFiles.map(x => (confFileString = confFileString + x + ";"));
      cmd = cmd + ` -DCONF_FILE='${confFileString}' `;
    }
    if (secondaryConfFiles.length) {
      let confFileString = "";
      secondaryConfFiles.map(x => (confFileString = confFileString + x + ";"));
      cmd = cmd + ` -DEXTRA_CONF_FILE='${confFileString}' `;
    }
    if (overlayFiles.length) {
      let overlayFileString = "";
      overlayFiles.map(x => (overlayFileString = overlayFileString + x + ";"));
      cmd = cmd + ` -DDTC_OVERLAY_FILE='${overlayFileString}' `;
    }
    if (extraOverlayFiles.length) {
      let overlayFileString = "";
      extraOverlayFiles.map(x => (overlayFileString = overlayFileString + x + ";"));
      cmd = cmd + ` -DEXTRA_DTC_OVERLAY_FILE='${overlayFileString}' `;
    }

  }


  let taskName = "Zephyr IDE Build: " + project.name + " " + build.name;

  vscode.window.showInformationMessage(`Building ${build.name} from project: ${project.name}`);
  let ret = await executeTaskHelper(taskName, cmd, getShellEnvironment(wsConfig.activeSetupState), wsConfig.activeSetupState?.setupPath);
  regenerateCompileCommands(wsConfig);
  return ret;
}


export async function buildMenuConfig(
  wsConfig: WorkspaceConfig,
  isMenuConfig: boolean,
  project?: ProjectConfig,
  build?: BuildConfig
) {

  if (project === undefined) {
    if (wsConfig.activeProject === undefined) {
      vscode.window.showErrorMessage("Select a project before trying to build");
      return;
    }
    project = wsConfig.projects[wsConfig.activeProject];
  }

  if (build === undefined) {
    let buildName = getActiveBuildOfProject(wsConfig, project.name)
    if (buildName === undefined) {
      await vscode.window.showErrorMessage(`You must choose a Build Configuration to continue.`);
      return;
    }
    build = project.buildConfigs[buildName];
  }


  let projectFolder = path.join(wsConfig.rootPath, project.rel_path);
  let buildFolder = path.join(wsConfig.rootPath, project.rel_path, build.name);
  let buildFsDir;
  if (fs.existsSync(buildFolder)) {
    buildFsDir = fs.readdirSync(buildFolder);
  }
  if (buildFsDir == undefined || buildFsDir.length == 0) {
    await vscode.window.showErrorMessage(`Run a Build or Build Pristine before running Menu/GUI Config.`);
    return;
  }

  let cmd = `west build -t ${isMenuConfig ? "menuconfig" : "guiconfig"} ${projectFolder} --build-dir ${buildFolder} `;
  let taskName = "Zephyr IDE Build: " + project.name + " " + build.name;

  vscode.window.showInformationMessage(`Running MenuConfig ${build.name} from project: ${project.name}`);
  await executeTaskHelper(taskName, cmd, getShellEnvironment(wsConfig.activeSetupState), wsConfig.activeSetupState?.setupPath);
  regenerateCompileCommands(wsConfig);
}

export async function buildRamRomReport(
  wsConfig: WorkspaceConfig,
  isRamReport: boolean,
  project?: ProjectConfig,
  build?: BuildConfig
) {

  if (project === undefined) {
    if (wsConfig.activeProject === undefined) {
      vscode.window.showErrorMessage("Select a project before trying to run report");
      return;
    }
    project = wsConfig.projects[wsConfig.activeProject];
  }

  if (build === undefined) {
    let buildName = getActiveBuildOfProject(wsConfig, project.name)
    if (buildName === undefined) {
      await vscode.window.showErrorMessage(`You must choose a Build Configuration to continue.`);
      return;
    }
    build = project.buildConfigs[buildName];
  }

  let projectFolder = path.join(wsConfig.rootPath, project.rel_path);
  let buildFolder = path.join(wsConfig.rootPath, project.rel_path, build.name);
  let buildFsDir;
  if (fs.existsSync(buildFolder)) {
    buildFsDir = fs.readdirSync(buildFolder);
  }
  if (buildFsDir == undefined || buildFsDir.length == 0) {
    await vscode.window.showErrorMessage(`Run a Build or Build Pristine before running Menu/GUI Config.`);
    return;
  }

  let cmd = `west build -t ${isRamReport ? "ram_report" : "rom_report"} ${projectFolder} --build-dir ${buildFolder} `;

  let taskName = "Zephyr IDE Build: " + project.name + " " + build.name;

  vscode.window.showInformationMessage(`Running ${isRamReport ? "RAM" : "ROM"} Report ${build.name} from project: ${project.name}`);
  await executeTaskHelper(taskName, cmd, getShellEnvironment(wsConfig.activeSetupState), wsConfig.activeSetupState?.setupPath);
  regenerateCompileCommands(wsConfig);
}

export async function runDtshShell(
  wsConfig: WorkspaceConfig,
  project?: ProjectConfig,
  build?: BuildConfig
) {

  if (project === undefined) {
    if (wsConfig.activeProject === undefined) {
      vscode.window.showErrorMessage("Select a project before trying to open dtsh shell");
      return;
    }
    project = wsConfig.projects[wsConfig.activeProject];
  }

  if (build === undefined) {
    let buildName = getActiveBuildOfProject(wsConfig, project.name)
    if (buildName === undefined) {
      await vscode.window.showErrorMessage(`You must choose a Build Configuration to continue.`);
      return;
    }
    build = project.buildConfigs[buildName];
  }

  let cmd = `dtsh ${path.join(wsConfig.rootPath, project.rel_path, build.name, 'zephyr', 'zephyr.dts')} `;

  let taskName = "Zephyr IDE DTSH Sehll: " + project.name + " " + build.name;

  vscode.window.showInformationMessage(`Running DTSH Shell ${build.name} from project: ${project.name}`);
  await executeTaskHelper(taskName, cmd, getShellEnvironment(wsConfig.activeSetupState), wsConfig.activeSetupState?.setupPath);
}

export async function clean(wsConfig: WorkspaceConfig, projectName: string | undefined) {
  if (projectName === undefined) {
    if (wsConfig.activeProject === undefined) {
      vscode.window.showErrorMessage("Select a project before trying to clean");
      return;
    }
    projectName = wsConfig.activeProject;
  }

  let activeBuild = wsConfig.projectStates[projectName].activeBuildConfig;
  if (activeBuild === undefined) {
    vscode.window.showErrorMessage("Select a build before trying to clean");
    return;
  }
  await fs.remove(path.join(wsConfig.rootPath, wsConfig.projects[projectName].rel_path, activeBuild));
  vscode.window.showInformationMessage(`Cleaning ${wsConfig.projects[projectName].rel_path}`);
}
