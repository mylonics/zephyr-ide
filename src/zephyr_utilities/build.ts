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
import * as path from 'upath';
import * as fs from 'fs-extra';

import { executeTaskHelperInPythonEnv, executeShellCommandInPythonEnv, loadYamlFile } from "../utilities/utils";
import { notifyError, outputInfo, outputWarning } from "../utilities/output";

import { WorkspaceConfig } from '../setup_utilities/types';
import { addBuild, ProjectConfig, getResolvedBuildName, resolveActiveProject, resolveActiveProjectBuild, getProjectFolder, getBuildFolder, resolveBoardRootArg, resolveBoardRoot } from "../project_utilities/project";
import { BuildConfig } from "../project_utilities/build_selector";
import { primaryPaths, extraPaths } from "../project_utilities/config_selector";
import { joinBuildArgsForShell, normalizeBuildArgs, quoteBuildArgForShell, quoteCMakeDef } from "../project_utilities/build_args";
import { updateDtsContext } from "../setup_utilities/dts_interface";
import { getSetupState, getSetupStateOrNotify, updateBuildCMakeInfo, clearBuildCMakeInfo } from "../setup_utilities/workspace-config";
import { setWorkspaceState } from "../setup_utilities/state-management";


export interface BuildInfo {
  bindingsDirs: string[];
  dtsFile: string;
  otherDtsFiles: string[];
  includeDirs: string[];
  kconfigFiles: string[];
  otherKconfigFiles: string[];
}

/** Returns true when the build folder exists and contains at least one file */
function isBuildFolderPopulated(buildFolder: string): boolean {
  if (!fs.existsSync(buildFolder)) { return false; }
  return fs.readdirSync(buildFolder).length > 0;
}

/** Reads and parses a compile_commands.json file, pushing entries into the accumulator. */
async function readCompileCommandsFile(filePath: string, accumulator: any[]): Promise<void> {
  if (!fs.existsSync(filePath)) { return; }
  const rawdata = await fs.readFile(filePath, 'utf8');
  try {
    const parsed = JSON.parse(rawdata);
    if (Array.isArray(parsed)) {
      accumulator.push(...parsed);
    } else {
      outputWarning("Build", `compile_commands.json is not an array: ${filePath}`);
    }
  } catch (e) {
    outputWarning("Build", `Failed to parse compile_commands.json at ${filePath}: ${e}`);
  }
}

export async function regenerateCompileCommands(wsConfig: WorkspaceConfig) {
  const compileCommandData: any[] = [];

  for (const projectName in wsConfig.projects) {
    const project = wsConfig.projects[projectName];
    for (const buildName in project.buildConfigs) {
      const build = project.buildConfigs[buildName];
      const basepath = getBuildFolder(wsConfig, project, build);
      const basefile = path.join(basepath, "compile_commands.json");
      const extfile = path.join(basepath, project.name, "compile_commands.json");
      if (fs.existsSync(basefile)) {
        await readCompileCommandsFile(basefile, compileCommandData);
      } else if (fs.existsSync(extfile)) {
        await readCompileCommandsFile(extfile, compileCommandData);
      }
    }
  }
  const data = JSON.stringify(compileCommandData);
  await fs.outputFile(path.join(wsConfig.rootPath, '.vscode', 'compile_commands.json'), data);
}

export async function buildHelper(
  context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, pristine: boolean) {
  const setupState = await getSetupState(context, wsConfig);
  if (!setupState) {
    return;
  }
  if (setupState.westUpdated) {
    const resolved = resolveActiveProject(wsConfig, { caller: "Build" });
    if (!resolved) { return; }
    const { project } = resolved;

    let buildName = getResolvedBuildName(wsConfig, resolved);
    if (buildName === undefined) {
      await addBuild(wsConfig, context);
      buildName = getResolvedBuildName(wsConfig, resolved);
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
  const project = wsConfig.projects[projectName];
  if (!project) {
    notifyError("Build", "Invalid project or build");
    return;
  }
  const buildconfig = project.buildConfigs[buildName];
  if (buildconfig) {
    if (isMenuConfig !== MenuConfig.None) {
      await buildMenuConfig(context, wsConfig, isMenuConfig, project, buildconfig);
    } else {
      await build(context, wsConfig, project, buildconfig, pristine);
    }
  } else {
    notifyError("Build", "Invalid project or build");
  }
}

/** Input parameters for pure build-command assembly. */
export interface BuildCommandParams {
  board: string;
  revision?: string;
  projectFolder: string;
  buildFolder: string;
  westBuildArgs: string[];
  westBuildCMakeArgs: string[];
  primaryConfFiles: string[];
  secondaryConfFiles: string[];
  overlayFiles: string[];
  extraOverlayFiles: string[];
  boardRootArg: string;
  isPristine: boolean;
}

/**
 * Pure function: compute the CMake -D definitions that would be passed after `--`
 * in a pristine build. Used by assembleBuildCommand and for cache comparison.
 */
export function computeCMakeDefs(params: Pick<BuildCommandParams, 'boardRootArg' | 'westBuildCMakeArgs' | 'primaryConfFiles' | 'secondaryConfFiles' | 'overlayFiles' | 'extraOverlayFiles'>): string[] {
  const extraWestBuildCMakeArgs = normalizeBuildArgs(params.westBuildCMakeArgs)
    .map((arg) => quoteBuildArgForShell(arg));

  const cmakeDefs: string[] = [params.boardRootArg, ...extraWestBuildCMakeArgs]
    .filter(s => s.trim().length > 0);

  if (params.primaryConfFiles.length) {
    cmakeDefs.push(quoteCMakeDef('CONF_FILE', params.primaryConfFiles.join(";")));
  }
  if (params.secondaryConfFiles.length) {
    cmakeDefs.push(quoteCMakeDef('EXTRA_CONF_FILE', params.secondaryConfFiles.join(";")));
  }
  if (params.overlayFiles.length) {
    cmakeDefs.push(quoteCMakeDef('DTC_OVERLAY_FILE', params.overlayFiles.join(";")));
  }
  if (params.extraOverlayFiles.length) {
    cmakeDefs.push(quoteCMakeDef('EXTRA_DTC_OVERLAY_FILE', params.extraOverlayFiles.join(";")));
  }
  return cmakeDefs;
}

/**
 * Pure function: assemble a `west build` command string from resolved parameters.
 * Extracted from build() to enable unit testing without VS Code or filesystem dependencies.
 */
export function assembleBuildCommand(params: BuildCommandParams): string {
  const extraWestBuildArgs = joinBuildArgsForShell(params.westBuildArgs);

  if (!params.isPristine) {
    return `west build "${params.projectFolder}" --build-dir "${params.buildFolder}" ${extraWestBuildArgs}`.trimEnd();
  }

  const boardSpec = params.board + (params.revision ? '@' + params.revision : "");

  const cmakeDefs = computeCMakeDefs(params);

  const cmakeSection = cmakeDefs.length > 0 ? ` -- ${cmakeDefs.join(' ')}` : '';
  return `west build -b ${boardSpec} "${params.projectFolder}" -p --build-dir "${params.buildFolder}" ${extraWestBuildArgs}${cmakeSection}`.trimEnd();
}

export async function build(
  context: vscode.ExtensionContext,
  wsConfig: WorkspaceConfig,
  project: ProjectConfig,
  build: BuildConfig,
  pristine: boolean
) {

  const allKconfig = project.confFiles.config.concat(build.confFiles.config);
  const allOverlay = project.confFiles.overlay.concat(build.confFiles.overlay);

  const projectFolder = getProjectFolder(wsConfig, project);
  const buildFolder = getBuildFolder(wsConfig, project, build);

  const setupState = await getSetupStateOrNotify(context, wsConfig, "Build");
  if (!setupState) {
    return;
  }

  const buildFolderExists = fs.existsSync(buildFolder);

  // Treat a build folder with neither CMakeCache.txt nor domains.yaml (for sysbuild)
  // as requiring a pristine build so that the board, cmake args, and conf files are passed.
  const cmakeCacheExists = buildFolderExists &&
    (fs.existsSync(path.join(buildFolder, 'CMakeCache.txt')) ||
     fs.existsSync(path.join(buildFolder, 'domains.yaml')));

  let isPristine = pristine || !buildFolderExists || !cmakeCacheExists;

  const boardRoot = resolveBoardRoot(wsConfig, build, setupState);
  const boardRootArg = boardRoot ? quoteCMakeDef('BOARD_ROOT', boardRoot) : "";
  const resolvedPrimaryConf = primaryPaths(allKconfig).map(x => path.join(wsConfig.rootPath, x));
  const resolvedSecondaryConf = extraPaths(allKconfig).map(x => path.join(wsConfig.rootPath, x));
  const resolvedOverlay = primaryPaths(allOverlay).map(x => path.join(wsConfig.rootPath, x));
  const resolvedExtraOverlay = extraPaths(allOverlay).map(x => path.join(wsConfig.rootPath, x));

  // Always compute the pristine command so we can compare against the cache
  const pristineCmd = assembleBuildCommand({
    board: build.board,
    revision: build.revision,
    projectFolder,
    buildFolder,
    westBuildArgs: build.westBuildArgs,
    westBuildCMakeArgs: build.westBuildCMakeArgs ?? [],
    primaryConfFiles: resolvedPrimaryConf,
    secondaryConfFiles: resolvedSecondaryConf,
    overlayFiles: resolvedOverlay,
    extraOverlayFiles: resolvedExtraOverlay,
    boardRootArg,
    isPristine: true,
  });

  // If the pristine command changed since last build, force pristine
  const buildState = wsConfig.projectStates[project.name]?.buildStates[build.name];
  if (!isPristine && buildState?.cachedPristineCmd) {
    if (pristineCmd !== buildState.cachedPristineCmd) {
      isPristine = true;
      outputInfo(`Build: ${project.name}/${build.name}`, "CMake configuration changed, forcing pristine build");
    }
  }

  if (isPristine) {
    // Clear cached CMake info on pristine build
    clearBuildCMakeInfo(wsConfig, project.name, build.name);
  }

  const cmd = isPristine ? pristineCmd : assembleBuildCommand({
    board: build.board,
    revision: build.revision,
    projectFolder,
    buildFolder,
    westBuildArgs: build.westBuildArgs,
    westBuildCMakeArgs: build.westBuildCMakeArgs ?? [],
    primaryConfFiles: resolvedPrimaryConf,
    secondaryConfFiles: resolvedSecondaryConf,
    overlayFiles: resolvedOverlay,
    extraOverlayFiles: resolvedExtraOverlay,
    boardRootArg: "",
    isPristine: false,
  });

  const taskName = "Zephyr IDE Build: " + project.name + " " + build.name;

  outputInfo(`Build: ${project.name}/${build.name}`, `Building ${build.name} from project: ${project.name} (cmd: ${cmd})`, true);
  const ret = await executeTaskHelperInPythonEnv(setupState, taskName, cmd, setupState.setupPath);

  // Only update caches on successful build
  if (ret) {
    if (buildState) {
      buildState.cachedPristineCmd = pristineCmd;
    }
    updateBuildCMakeInfo(wsConfig, project.name, build.name);
    await setWorkspaceState(context, wsConfig);
    await regenerateCompileCommands(wsConfig);
    await updateDtsContext(wsConfig, project, build);
  }
  return ret;
}


export async function buildMenuConfig(
  context: vscode.ExtensionContext,
  wsConfig: WorkspaceConfig,
  config: MenuConfig,
  project?: ProjectConfig,
  build?: BuildConfig
) {

  if (!project || !build) {
    const resolved = resolveActiveProjectBuild(wsConfig, { caller: "Menu Config", projectName: project?.name });
    if (!resolved) { return; }
    project = project ?? resolved.project;
    build = build ?? resolved.build;
  }

  const projectFolder = getProjectFolder(wsConfig, project);
  const buildFolder = getBuildFolder(wsConfig, project, build);
  if (!isBuildFolderPopulated(buildFolder)) {
    notifyError("Menu Config", `Run a Build or Build Pristine before running Menu/GUI Config.`);
    return;
  }

  const cmd = `west build -t ${config === MenuConfig.MenuConfig ? "menuconfig" : "guiconfig"} "${projectFolder}" --build-dir "${buildFolder}" `;
  const taskName = "Zephyr IDE Build: " + project.name + " " + build.name;

  outputInfo(`MenuConfig: ${project.name}/${build.name}`, `Running MenuConfig ${build.name} from project: ${project.name} (cmd: ${cmd})`, true);
  const setupState = await getSetupStateOrNotify(context, wsConfig, "Menu Config");
  if (!setupState) {
    return;
  }
  await executeTaskHelperInPythonEnv(setupState, taskName, cmd, setupState.setupPath);
  await regenerateCompileCommands(wsConfig);
  await updateDtsContext(wsConfig, project, build);
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

  if (!project || !build) {
    const resolved = resolveActiveProjectBuild(wsConfig, { caller: "RAM/ROM Report", projectName: project?.name });
    if (!resolved) { return undefined; }
    project = project ?? resolved.project;
    build = build ?? resolved.build;
  }

  const projectFolder = getProjectFolder(wsConfig, project);
  const buildFolder = getBuildFolder(wsConfig, project, build);
  if (!isBuildFolderPopulated(buildFolder)) {
    notifyError("RAM/ROM Report", `Run a Build or Build Pristine before running ${reportType} Report.`);
    return undefined;
  }

  const cmd = `west build -t ${isRamReport ? "ram_report" : "rom_report"} "${projectFolder}" --build-dir "${buildFolder}"`;
  const setupState = await getSetupStateOrNotify(context, wsConfig, "RAM/ROM Report");
  if (!setupState) {
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

  const taskName = "Zephyr IDE Build: " + params.project.name + " " + params.build.name;
  outputInfo(`${isRamReport ? "RAM" : "ROM"} Report: ${params.project.name}/${params.build.name}`, `Running ${isRamReport ? "RAM" : "ROM"} Report ${params.build.name} from project: ${params.project.name} (cmd: ${params.cmd})`, true);
  await executeTaskHelperInPythonEnv(params.setupState, taskName, params.cmd, params.setupState.setupPath);
  await regenerateCompileCommands(wsConfig);
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
  if (result.exitCode === 0) {
    return { success: true, output: combined || `${reportType} Report: completed successfully` };
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

  if (!project || !build) {
    const resolved = resolveActiveProjectBuild(wsConfig, { caller: "DTSH Shell", projectName: project?.name });
    if (!resolved) { return; }
    project = project ?? resolved.project;
    build = build ?? resolved.build;
  }

  const cmd = `dtsh "${path.join(getBuildFolder(wsConfig, project, build), 'zephyr', 'zephyr.dts')}" `;

  const taskName = "Zephyr IDE DTSH Shell: " + project.name + " " + build.name;

  outputInfo(`DTSH Shell: ${project.name}/${build.name}`, `Running DTSH Shell ${build.name} from project: ${project.name} (cmd: ${cmd})`, true);
  const setupState = await getSetupStateOrNotify(context, wsConfig, "DTSH Shell");
  if (!setupState) {
    return;
  }
  await executeTaskHelperInPythonEnv(setupState, taskName, cmd, setupState.setupPath);
}

export async function clean(wsConfig: WorkspaceConfig, projectName: string | undefined) {
  const resolved = resolveActiveProjectBuild(wsConfig, { caller: "Clean", projectName });
  if (!resolved) { return; }

  await fs.remove(getBuildFolder(wsConfig, resolved.project, resolved.build));
  void vscode.window.showInformationMessage(`Cleaning ${resolved.project.rel_path}`);
}

export async function getBuildInfo(wsConfig: WorkspaceConfig,
  project: ProjectConfig,
  build: BuildConfig) {
  const buildInfoFilePath = path.join(getBuildFolder(wsConfig, project, build), "build_info.yml");
  const rawData: any = loadYamlFile(buildInfoFilePath);

  if (rawData && rawData.cmake && rawData.cmake.devicetree && rawData.cmake.kconfig) {
    const dtsFiles = rawData.cmake.devicetree["files"] ?? [];
    const userDtsFiles = rawData.cmake.devicetree["user-files"] ?? [];

    let dtsFile = "";

    const otherDtsFiles: string[] = [];

    for (const file of dtsFiles) {
      if (path.extname(file) === ".dts") {
        dtsFile = file;
        break;
      } else {
        if (!otherDtsFiles.includes(file)) {
          otherDtsFiles.push(file);
        }
      }
    }
    for (const file of userDtsFiles) {
      if (!otherDtsFiles.includes(file)) {
        otherDtsFiles.push(file);
      }
    }

    const info: BuildInfo = {
      bindingsDirs: rawData.cmake.devicetree["bindings-dirs"] ?? [],
      dtsFile: dtsFile,
      otherDtsFiles: otherDtsFiles,
      includeDirs: rawData.cmake.devicetree["include-dirs"] ?? [],
      kconfigFiles: rawData.cmake.kconfig["files"] ?? [],
      otherKconfigFiles: rawData.cmake.kconfig["user-files"] ?? [],
    };
    return info;
  }
}
