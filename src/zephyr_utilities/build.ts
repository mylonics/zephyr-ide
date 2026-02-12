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
import * as yaml from 'js-yaml';

import { executeTaskHelperInPythonEnv, executeShellCommandInPythonEnv } from "../utilities/utils";
import { notifyError, outputInfo } from "../utilities/output";

import { WorkspaceConfig } from '../setup_utilities/types';
import { addBuild, ProjectConfig, getActiveBuildNameOfProject } from "../project_utilities/project";
import { BuildConfig } from "../project_utilities/build_selector";
import { updateDtsContext } from "../setup_utilities/dts_interface";
import { getSetupState, updateBuildCMakeInfo, clearBuildCMakeInfo } from "../setup_utilities/workspace-config";


export interface BuildInfo {
  bindingsDirs: string[];
  dtsFile: string;
  otherDtsFiles: string[];
  includeDirs: string[];
  kconfigFiles: string[];
  otherKconfigFiles: string[];
}

export async function regenerateCompileCommands(wsConfig: WorkspaceConfig) {
  let compileCommandData = [];

  for (let projectName in wsConfig.projects) {
    let project = wsConfig.projects[projectName];
    for (let buildName in project.buildConfigs) {
      let build = project.buildConfigs[buildName];
      let basepath = path.join(wsConfig.rootPath, project.rel_path, build.name);
      let basefile = path.join(basepath, "compile_commands.json");
      let extfile = path.join(basepath, project.name, "compile_commands.json");
      if (fs.existsSync(basefile)) {
        let rawdata = await fs.readFile(basefile, 'utf8');
        compileCommandData.push(...JSON.parse(rawdata));
      } else if (fs.existsSync(extfile)) {
        let rawdata = await fs.readFile(extfile, 'utf8');
        compileCommandData.push(...JSON.parse(rawdata));
      }
    }
  }
  let data = JSON.stringify(compileCommandData);
  fs.outputFile(path.join(wsConfig.rootPath, '.vscode', 'compile_commands.json'), data);
}

export async function buildHelper(
  context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, pristine: boolean) {
  const setupState = await getSetupState(context, wsConfig);
  if (!setupState) {
    return;
  }
  if (setupState.westUpdated) {
    if (wsConfig.activeProject === undefined) {
      notifyError("Build", "Select a project before trying to build");
      return;
    }
    let project = wsConfig.projects[wsConfig.activeProject];

    let buildName = getActiveBuildNameOfProject(wsConfig, project.name);
    if (buildName === undefined) {
      await addBuild(wsConfig, context);
      buildName = getActiveBuildNameOfProject(wsConfig, project.name);
      if (buildName === undefined) {
        notifyError("Build", `You must choose a Build Configuration to continue.`);
        return;
      }
    }
    return await build(context, wsConfig, project, project.buildConfigs[buildName], pristine);
  } else {
    notifyError("Build", "Run `Zephyr IDE: West Update` command first.");
  }
}

export enum MenuConfig {
  None = 1,
  MenuConfig,
  GuiConfig,
}

export async function buildByName(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, pristine: boolean, projectName: string, buildName: string, isMenuConfig = MenuConfig.None) {
  let project = wsConfig.projects[projectName];
  let buildconfig = project.buildConfigs[buildName];
  if (project && build) {
    if (isMenuConfig !== MenuConfig.None) {
      buildMenuConfig(context, wsConfig, isMenuConfig, project, buildconfig);
    } else {
      build(context, wsConfig, project, buildconfig, pristine);
    }
  } else {
    notifyError("Build", "Invalid project or build");
  }
}

export async function build(
  context: vscode.ExtensionContext,
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

  let cmd = `west build "${projectFolder}" --build-dir "${buildFolder}" `;

  let buildFsDir;
  if (fs.existsSync(buildFolder)) {
    buildFsDir = fs.readdirSync(buildFolder);
  }

  if (pristine || buildFsDir === undefined || buildFsDir.length === 0) {
    // Clear cached CMake info on pristine build
    clearBuildCMakeInfo(wsConfig, project.name, build.name);

    let boardRoot;
    if (build.relBoardDir) {
      boardRoot = path.dirname(path.join(wsConfig.rootPath, build.relBoardDir));
    } else {
      const setupState = await getSetupState(context, wsConfig);
      if (setupState) {
        boardRoot = setupState.zephyrDir;
      }
    }
    cmd = `west build -b ${build.board + (build.revision ? '@' + build.revision : "")} "${projectFolder}" -p --build-dir "${buildFolder}" ${extraWestBuildArgs} -- -DBOARD_ROOT='${boardRoot}' ${extraWestBuildCMakeArgs} `;

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

  outputInfo(`Build: ${project.name}/${build.name}`, `Building ${build.name} from project: ${project.name} (cmd: ${cmd})`, true);
  const setupState = await getSetupState(context, wsConfig);
  let ret = await executeTaskHelperInPythonEnv(setupState, taskName, cmd, setupState?.setupPath);

  // Update cached CMake info after build completes
  updateBuildCMakeInfo(wsConfig, project.name, build.name);

  regenerateCompileCommands(wsConfig);
  updateDtsContext(wsConfig, project, build);
  return ret;
}


export async function buildMenuConfig(
  context: vscode.ExtensionContext,
  wsConfig: WorkspaceConfig,
  config: MenuConfig,
  project?: ProjectConfig,
  build?: BuildConfig
) {

  if (project === undefined) {
    if (wsConfig.activeProject === undefined) {
      notifyError("Menu Config", "Select a project before trying to build");
      return;
    }
    project = wsConfig.projects[wsConfig.activeProject];
  }

  if (build === undefined) {
    let buildName = getActiveBuildNameOfProject(wsConfig, project.name);
    if (buildName === undefined) {
      notifyError("Menu Config", `You must choose a Build Configuration to continue.`);
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
  if (buildFsDir === undefined || buildFsDir.length === 0) {
    notifyError("Menu Config", `Run a Build or Build Pristine before running Menu/GUI Config.`);
    return;
  }

  let cmd = `west build -t ${config === MenuConfig.MenuConfig ? "menuconfig" : "guiconfig"} "${projectFolder}" --build-dir "${buildFolder}" `;
  let taskName = "Zephyr IDE Build: " + project.name + " " + build.name;

  outputInfo(`MenuConfig: ${project.name}/${build.name}`, `Running MenuConfig ${build.name} from project: ${project.name} (cmd: ${cmd})`, true);
  const setupState = await getSetupState(context, wsConfig);
  await executeTaskHelperInPythonEnv(setupState, taskName, cmd, setupState?.setupPath);
  regenerateCompileCommands(wsConfig);
  updateDtsContext(wsConfig, project, build);
}

/**
 * Resolves and validates the project, build, command, and setup state needed for a RAM/ROM report.
 * Returns undefined (and calls notifyError) if any prerequisite is missing.
 */
async function resolveRamRomReportParams(
  context: vscode.ExtensionContext,
  wsConfig: WorkspaceConfig,
  isRamReport: boolean,
  project?: ProjectConfig,
  build?: BuildConfig
) {
  const reportType = isRamReport ? "RAM" : "ROM";

  if (project === undefined) {
    if (wsConfig.activeProject === undefined) {
      notifyError("RAM/ROM Report", "Select a project before trying to run report");
      return undefined;
    }
    project = wsConfig.projects[wsConfig.activeProject];
  }

  if (build === undefined) {
    let buildName = getActiveBuildNameOfProject(wsConfig, project.name);
    if (buildName === undefined) {
      notifyError("RAM/ROM Report", `You must choose a Build Configuration to continue.`);
      return undefined;
    }
    build = project.buildConfigs[buildName];
  }

  let projectFolder = path.join(wsConfig.rootPath, project.rel_path);
  let buildFolder = path.join(wsConfig.rootPath, project.rel_path, build.name);
  let buildFsDir;
  if (fs.existsSync(buildFolder)) {
    buildFsDir = fs.readdirSync(buildFolder);
  }
  if (buildFsDir === undefined || buildFsDir.length === 0) {
    notifyError("RAM/ROM Report", `Run a Build or Build Pristine before running ${reportType} Report.`);
    return undefined;
  }

  const cmd = `west build -t ${isRamReport ? "ram_report" : "rom_report"} "${projectFolder}" --build-dir "${buildFolder}"`;
  const setupState = await getSetupState(context, wsConfig);
  if (!setupState) {
    notifyError("RAM/ROM Report", `No setup state available for ${reportType} Report.`);
    return undefined;
  }

  return { project, build, cmd, setupState };
}

export async function buildRamRomReport(
  context: vscode.ExtensionContext,
  wsConfig: WorkspaceConfig,
  isRamReport: boolean,
  project?: ProjectConfig,
  build?: BuildConfig
) {
  const params = await resolveRamRomReportParams(context, wsConfig, isRamReport, project, build);
  if (!params) { return; }

  let taskName = "Zephyr IDE Build: " + params.project.name + " " + params.build.name;
  outputInfo(`${isRamReport ? "RAM" : "ROM"} Report: ${params.project.name}/${params.build.name}`, `Running ${isRamReport ? "RAM" : "ROM"} Report ${params.build.name} from project: ${params.project.name} (cmd: ${params.cmd})`, true);
  await executeTaskHelperInPythonEnv(params.setupState, taskName, params.cmd, params.setupState?.setupPath);
  regenerateCompileCommands(wsConfig);
}

/**
 * Headless variant of buildRamRomReport that captures and returns the report output.
 * Used in integration tests to assert on success and log report contents.
 */
export async function buildRamRomReportHeadless(
  context: vscode.ExtensionContext,
  wsConfig: WorkspaceConfig,
  isRamReport: boolean,
): Promise<{ success: boolean; output: string }> {
  const reportType = isRamReport ? "RAM" : "ROM";
  const params = await resolveRamRomReportParams(context, wsConfig, isRamReport);
  if (!params) {
    return { success: false, output: `${reportType} Report: prerequisite check failed` };
  }

  const result = await executeShellCommandInPythonEnv(params.cmd, params.setupState.setupPath, params.setupState, true);
  const combined = [result.stdout, result.stderr].filter(Boolean).join('\n');
  if (result.stdout) {
    return { success: true, output: combined };
  } else {
    return { success: false, output: combined || `${reportType} Report: No output` };
  }
}

export async function runDtshShell(
  context: vscode.ExtensionContext,
  wsConfig: WorkspaceConfig,
  project?: ProjectConfig,
  build?: BuildConfig
) {

  if (project === undefined) {
    if (wsConfig.activeProject === undefined) {
      notifyError("DTSH Shell", "Select a project before trying to open dtsh shell");
      return;
    }
    project = wsConfig.projects[wsConfig.activeProject];
  }

  if (build === undefined) {
    let buildName = getActiveBuildNameOfProject(wsConfig, project.name);
    if (buildName === undefined) {
      notifyError("DTSH Shell", `You must choose a Build Configuration to continue.`);
      return;
    }
    build = project.buildConfigs[buildName];
  }

  let cmd = `dtsh "${path.join(wsConfig.rootPath, project.rel_path, build.name, 'zephyr', 'zephyr.dts')}" `;

  let taskName = "Zephyr IDE DTSH Sehll: " + project.name + " " + build.name;

  outputInfo(`DTSH Shell: ${project.name}/${build.name}`, `Running DTSH Shell ${build.name} from project: ${project.name} (cmd: ${cmd})`, true);
  const setupState = await getSetupState(context, wsConfig);
  await executeTaskHelperInPythonEnv(setupState, taskName, cmd, setupState?.setupPath);
}

export async function clean(wsConfig: WorkspaceConfig, projectName: string | undefined) {
  if (projectName === undefined) {
    if (wsConfig.activeProject === undefined) {
      notifyError("Clean", "Select a project before trying to clean");
      return;
    }
    projectName = wsConfig.activeProject;
  }

  let activeBuild = wsConfig.projectStates[projectName].activeBuildConfig;
  if (activeBuild === undefined) {
    notifyError("Clean", "Select a build before trying to clean");
    return;
  }
  await fs.remove(path.join(wsConfig.rootPath, wsConfig.projects[projectName].rel_path, activeBuild));
  vscode.window.showInformationMessage(`Cleaning ${wsConfig.projects[projectName].rel_path}`);
}

export async function getBuildInfo(wsConfig: WorkspaceConfig,
  project: ProjectConfig,
  build: BuildConfig) {
  let buildInfoFilePath = path.join(wsConfig.rootPath, project.rel_path, build.name, "build_info.yml");
  if (fs.existsSync(buildInfoFilePath)) {
    let rawData: any = yaml.load(fs.readFileSync(buildInfoFilePath, 'utf-8'));

    if (rawData && rawData.cmake && rawData.cmake.devicetree && rawData.cmake.kconfig) {
      let dtsFiles = rawData.cmake.devicetree["files"];
      let userDtsFiles = rawData.cmake.devicetree["user-files"];

      let dtsFile = "";

      let otherDtsFiles: string[] = [];

      for (let file in dtsFiles) {
        if (path.extname(dtsFiles[file]) === ".dts") {
          dtsFile = dtsFiles[file];
          break;
        } else {
          if (!(dtsFiles[file] in otherDtsFiles)) {
            otherDtsFiles.push(dtsFiles[file]);
          }
        }
      }
      for (let file in userDtsFiles) {
        if (!(userDtsFiles[file] in otherDtsFiles)) {
          otherDtsFiles.push(userDtsFiles[file]);
        }
      }


      let info: BuildInfo = {
        bindingsDirs: rawData.cmake.devicetree["bindings-dirs"],
        dtsFile: dtsFile,
        otherDtsFiles: otherDtsFiles,
        includeDirs: rawData.cmake.devicetree["include-dirs"],
        kconfigFiles: rawData.cmake.kconfig["files"],
        otherKconfigFiles: rawData.cmake.kconfig["user-files"],
      };
      return info;
    }
  }
}