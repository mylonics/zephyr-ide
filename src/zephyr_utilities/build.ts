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

import { WorkspaceConfig } from '../setup_utilities/setup';
import { addBuild, ProjectConfig } from "../project_utilities/project";
import { BuildConfig } from "../project_utilities/build_selector";

export async function buildHelper(
  context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, pristine: boolean) {
  if (wsConfig.westUpdated) {
    if (wsConfig.activeProject === undefined) {
      vscode.window.showErrorMessage("Select a project before trying to build");
      return;
    }
    let project = wsConfig.projects[wsConfig.activeProject];

    if (project.activeBuildConfig === undefined) {
      await addBuild(wsConfig, context);
      if (project.activeBuildConfig === undefined) {
        await vscode.window.showErrorMessage(`You must choose a Build Configuration to continue.`);
        return;
      }
    }
    await build(wsConfig, project, project.buildConfigs[project.activeBuildConfig], pristine);
  } else {
    vscode.window.showErrorMessage("Run `Zephyr IDE: West Update` command first.");
  }
}

export async function buildByName(wsConfig: WorkspaceConfig, pristine: boolean, projectName: string, buildName: string) {
  if (wsConfig.westUpdated) {
    let project = wsConfig.projects[projectName];
    let buildconfig = project.buildConfigs[buildName];
    if (project && build) {
      build(wsConfig, project, buildconfig, pristine);
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

  let cmd = `west build -b ${build.board} ${path.join(wsConfig.rootPath, project.rel_path)} ${pristine ? "-p" : ""} --build-dir ${path.join(wsConfig.rootPath, project.rel_path, build.name)} ${extraWestBuildArgs} -- -DBOARD_ROOT='${path.dirname(path.join(wsConfig.rootPath, build.relBoardDir))}' ${extraWestBuildCMakeArgs} `;
  if (primaryConfFiles.length) {
    cmd = cmd + ` -DCONF_FILE='${primaryConfFiles}' `;
  }
  if (secondaryConfFiles.length) {
    cmd = cmd + ` -DEXTRA_CONF_FILE='${secondaryConfFiles}' `;
  }
  if (overlayFiles.length) {
    cmd = cmd + ` -DDTC_OVERLAY_FILE='${overlayFiles}' `;
  }
  if (extraOverlayFiles.length) {
    cmd = cmd + ` -DEXTRA_DTC_OVERLAY_FILE='${extraOverlayFiles}' `;
  }


  switch (build.debugOptimization) {
    case "Debug":
      cmd = cmd + ` -DCONFIG_DEBUG_OPTIMIZATIONS=y -DCONFIG_DEBUG_THREAD_INFO=y `;
      break;
    case "Speed":
      cmd = cmd + ` -DCONFIG_SPEED_OPTIMIZATIONS=y `;
      break;
    case "Size":
      cmd = cmd + ` -DCONFIG_SIZE_OPTIMIZATIONS=y `;
      break;
    case "No Optimizations":
      cmd = cmd + ` -DCONFIG_NO_OPTIMIZATIONS=y`;
      break;
    default:
      break;
  }
  let taskName = "Zephyr IDE Build: " + project.name + " " + build.name;

  vscode.window.showInformationMessage(`Building ${build.name} from project: ${project.name}`);
  await executeTaskHelper(taskName, cmd, getShellEnvironment(wsConfig), path.join(wsConfig.rootPath, project.rel_path));
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
    if (project.activeBuildConfig === undefined) {
      await vscode.window.showErrorMessage(`You must choose a Build Configuration to continue.`);
      return;
    }
    build = project.buildConfigs[project.activeBuildConfig];
  }

  let cmd = `west build -t ${isMenuConfig ? "menuconfig" : "guiconfig"} -b ${build.board} ${path.join(wsConfig.rootPath, project.rel_path)} --build-dir ${path.join(wsConfig.rootPath, project.rel_path, build.name)} -- -DBOARD_ROOT='${path.dirname(path.join(wsConfig.rootPath, build.relBoardDir))}' `;

  let taskName = "Zephyr IDE Build: " + project.name + " " + build.name;

  vscode.window.showInformationMessage(`Running MenuConfig ${build.name} from project: ${project.name}`);
  await executeTaskHelper(taskName, cmd, getShellEnvironment(wsConfig), path.join(wsConfig.rootPath, project.rel_path));
}


export async function clean(wsConfig: WorkspaceConfig, projectName: string | undefined) {
  if (projectName === undefined) {
    if (wsConfig.activeProject === undefined) {
      vscode.window.showErrorMessage("Select a project before trying to clean");
      return;
    }
    projectName = wsConfig.activeProject;
  }
  let activeBuild = wsConfig.projects[projectName].activeBuildConfig;
  if (activeBuild === undefined) {
    vscode.window.showErrorMessage("Select a build before trying to clean");
    return;
  }
  await fs.remove(path.join(wsConfig.rootPath, wsConfig.projects[projectName].rel_path, activeBuild));
  vscode.window.showInformationMessage(`Cleaning ${wsConfig.projects[projectName].rel_path}`);
}
