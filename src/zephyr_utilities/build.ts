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
import { readDashboardData } from '../build_data/build-artifact-reader';
import { readMemoryRefresh } from '../build_data/build-artifact-reader';
import { runFullMemoryRefresh } from '../build_data/memory-report-runner';
import type { DashboardData, DashboardMemoryRefresh } from '../build_data/dashboard-data';

import { WorkspaceConfig } from '../setup_utilities/types';
import { addBuild, ProjectConfig, getResolvedBuildName, resolveActiveProject, resolveActiveProjectBuild, getProjectFolder, getBuildFolder, resolveBoardRootArg, resolveBoardRoot } from "../project_utilities/project";
import { BuildConfig } from "../project_utilities/build_selector";
import { primaryPaths, extraPaths } from "../project_utilities/config_selector";
import { joinBuildArgsForShell, normalizeBuildArgs, normalizeCMakeArg, quoteBuildArgForShell, quoteCMakeDef, quoteUserCMakeArgForShell } from "../project_utilities/build_args";
import { updateDtsContext } from "../setup_utilities/dts_interface";
import { getSetupState, getSetupStateOrNotify, updateBuildCMakeInfo, clearBuildCMakeInfo } from "../setup_utilities/workspace-config";
import { setWorkspaceState } from "../setup_utilities/state-management";
import { invalidateRunnersYamlCache, resolveEffectiveBuildDir } from "./runners-yaml";


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
      // Resolve the sysbuild domain (if any) rather than guessing a
      // <basepath>/<project.name> fallback — that guess only happened to
      // work when the default domain's name matched the project name.
      const effectiveBuildDir = resolveEffectiveBuildDir(getBuildFolder(wsConfig, project, build));
      const compileCommandsFile = path.join(effectiveBuildDir, "compile_commands.json");
      if (fs.existsSync(compileCommandsFile)) {
        await readCompileCommandsFile(compileCommandsFile, compileCommandData);
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
  /** Resolved SCA variant name (e.g. 'dtdoctor', 'gcc'). Empty/undefined means no SCA. */
  scaVariant?: string;
}

/**
 * Pure function: compute the CMake -D definitions that would be passed after `--`
 * in a pristine build. Used by assembleBuildCommand and for cache comparison.
 */
export function computeCMakeDefs(params: Pick<BuildCommandParams, 'boardRootArg' | 'westBuildCMakeArgs' | 'primaryConfFiles' | 'secondaryConfFiles' | 'overlayFiles' | 'extraOverlayFiles' | 'scaVariant'>): string[] {
  const extraWestBuildCMakeArgs = normalizeBuildArgs(params.westBuildCMakeArgs)
    .map((arg) => quoteUserCMakeArgForShell(normalizeCMakeArg(arg)));

  const cmakeDefs: string[] = [params.boardRootArg, ...extraWestBuildCMakeArgs]
    .filter(s => s.trim().length > 0);

  if (params.scaVariant) {
    cmakeDefs.push(quoteCMakeDef('ZEPHYR_SCA_VARIANT', params.scaVariant));
  }
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

  let boardSpec: string;
  if (params.revision) {
    const slashIdx = params.board.indexOf('/');
    if (slashIdx !== -1) {
      boardSpec = params.board.slice(0, slashIdx) + '@' + params.revision + params.board.slice(slashIdx);
    } else {
      boardSpec = params.board + '@' + params.revision;
    }
  } else {
    boardSpec = params.board;
  }

  const cmakeDefs = computeCMakeDefs(params);

  const cmakeSection = cmakeDefs.length > 0 ? ` -- ${cmakeDefs.join(' ')}` : '';
  return `west build -b ${boardSpec} "${params.projectFolder}" -p --build-dir "${params.buildFolder}" ${extraWestBuildArgs}${cmakeSection}`.trimEnd();
}

/**
 * Read the SCA variant from VS Code settings and resolve to a concrete variant
 * name, or undefined if SCA is disabled.
 */
export function resolveSCAVariant(): string | undefined {
  const cfg = vscode.workspace.getConfiguration();
  const variant = cfg.get<string>("zephyr-ide.scaVariant") ?? "none";
  if (variant === "none") { return undefined; }
  if (variant === "custom") {
    const custom = cfg.get<string | null>("zephyr-ide.scaCustomVariant") ?? "";
    return custom.trim() || undefined;
  }
  return variant;
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

  const boardRoot = resolveBoardRoot(wsConfig, build);
  const boardRootArg = boardRoot ? quoteCMakeDef('BOARD_ROOT', boardRoot) : "";
  const resolvedPrimaryConf = primaryPaths(allKconfig).map(x => path.join(wsConfig.rootPath, x));
  const resolvedSecondaryConf = extraPaths(allKconfig).map(x => path.join(wsConfig.rootPath, x));
  const resolvedOverlay = primaryPaths(allOverlay).map(x => path.join(wsConfig.rootPath, x));
  const resolvedExtraOverlay = extraPaths(allOverlay).map(x => path.join(wsConfig.rootPath, x));

  const scaVariant = resolveSCAVariant();

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
    scaVariant,
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
    // Drop any cached runners.yaml entries for this build directory. The
    // in-memory cache normally self-invalidates via mtime+size, but the build
    // folder is about to be wiped and regenerated; clearing eagerly avoids
    // any chance of serving a stale entry on filesystems with coarse mtime
    // resolution (e.g. some Windows / network shares).
    invalidateRunnersYamlCache(buildFolder);
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

/**
 * Runs the native Zephyr `west build -t dashboard` target, which generates an
 * HTML memory dashboard and opens it in the system browser.
 *
 * This is a thin wrapper around the Zephyr build system — identical in spirit
 * to buildRamRomReport — and runs as a visible VS Code task so the terminal
 * output is accessible to the user.
 */
export async function buildDashboardReport(
  context: vscode.ExtensionContext,
  wsConfig: WorkspaceConfig,
  project?: ProjectConfig,
  build?: BuildConfig
): Promise<{ buildFolder: string; projectName: string; buildName: string } | undefined> {
  if (!project || !build) {
    const resolved = resolveActiveProjectBuild(wsConfig, { caller: "Dashboard Report", projectName: project?.name });
    if (!resolved) { return undefined; }
    project = project ?? resolved.project;
    build = build ?? resolved.build;
  }

  const projectFolder = getProjectFolder(wsConfig, project);
  const buildFolder = getBuildFolder(wsConfig, project, build);
  if (!isBuildFolderPopulated(buildFolder)) {
    notifyError("Dashboard Report", "Run a Build or Build Pristine before generating the Dashboard Report.");
    return undefined;
  }

  const setupState = await getSetupStateOrNotify(context, wsConfig, "Dashboard Report");
  if (!setupState) { return undefined; }

  const taskName = `Zephyr IDE Dashboard Report: ${project.name} ${build.name}`;
  const cmd = `west build -t dashboard "${projectFolder}" --build-dir "${buildFolder}"`;
  outputInfo(
    `Dashboard Report: ${project.name}/${build.name}`,
    `Running Zephyr dashboard report for ${build.name} (cmd: ${cmd})`,
    true
  );
  await executeTaskHelperInPythonEnv(setupState, taskName, cmd, setupState.setupPath);

  return { buildFolder, projectName: project.name, buildName: build.name };
}

export async function buildDashboard(
  context: vscode.ExtensionContext,
  wsConfig: WorkspaceConfig,
  project?: ProjectConfig,
  build?: BuildConfig
): Promise<{ success: boolean; data: DashboardData; buildFolder: string; projectName: string; buildName: string } | undefined> {
  if (!project || !build) {
    const resolved = resolveActiveProjectBuild(wsConfig, { caller: "Dashboard", projectName: project?.name });
    if (!resolved) { return undefined; }
    project = project ?? resolved.project;
    build = build ?? resolved.build;
  }

  const buildFolder = getBuildFolder(wsConfig, project, build);
  if (!isBuildFolderPopulated(buildFolder)) {
    notifyError("Dashboard", `Run a Build or Build Pristine before opening the Dashboard.`);
    return undefined;
  }

  const setupState = await getSetupStateOrNotify(context, wsConfig, "Dashboard");
  if (!setupState) {
    return undefined;
  }

  outputInfo(`Dashboard: ${project.name}/${build.name}`, `Generating dashboard for ${build.name}`, true);

  // Read fast artifacts from disk immediately — no subprocess needed.
  const cachedPristineCmd = wsConfig.projectStates[project.name]?.buildStates[build.name]?.cachedPristineCmd ?? null;
  const data = await readDashboardData(buildFolder, project.name, build.name, 'zephyr', cachedPristineCmd);
  return { success: true, data, buildFolder, projectName: project.name, buildName: build.name };
}

/**
 * Runs the full memory refresh (stat file via nm + cmake ram/rom_report
 * targets) and returns updated memory tree + summary data.
 * Intended to be called after buildDashboard(), in the background.
 * Returns undefined on setup failure, or a result with an optional error
 * message if cmake targets fail (data will still be read from disk).
 */
export async function refreshDashboardMemory(
  context: vscode.ExtensionContext,
  wsConfig: WorkspaceConfig,
  buildFolder: string,
  projectName?: string,
  buildName?: string,
): Promise<(DashboardMemoryRefresh & { error?: string }) | undefined> {
  const setupState = await getSetupStateOrNotify(context, wsConfig, "Memory Refresh");
  if (!setupState) { return undefined; }

  const error = await runFullMemoryRefresh(buildFolder, setupState, projectName, buildName) ?? undefined;
  return { ...readMemoryRefresh(buildFolder), error };
}

/**
 * Get the path to a build's zephyr.dts file. Resolves the active project/build
 * when not given explicitly. Resolves sysbuild domains via resolveEffectiveBuildDir
 * so the returned path points at the domain that actually produced zephyr.dts.
 * @param wsConfig The workspace configuration
 * @returns The path to zephyr.dts, or undefined if no active build
 */
export function getZephyrDtsPath(
  wsConfig: WorkspaceConfig,
  project?: ProjectConfig,
  build?: BuildConfig
): string | undefined {
  if (!project || !build) {
    const resolved = resolveActiveProjectBuild(wsConfig);
    if (!resolved) { return undefined; }
    project = project ?? resolved.project;
    build = build ?? resolved.build;
  }
  const effectiveBuildDir = resolveEffectiveBuildDir(getBuildFolder(wsConfig, project, build));
  return path.join(effectiveBuildDir, 'zephyr', 'zephyr.dts');
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

  const cmd = `dtsh "${getZephyrDtsPath(wsConfig, project, build)}" `;

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

  const buildFolder = getBuildFolder(wsConfig, resolved.project, resolved.build);
  await fs.remove(buildFolder);
  // Drop cached runners.yaml entries — the file is gone, and stat-based
  // invalidation would only fire on the next debug session.
  invalidateRunnersYamlCache(buildFolder);
  void vscode.window.showInformationMessage(`Cleaning ${resolved.project.rel_path}`);
}

export async function getBuildInfo(wsConfig: WorkspaceConfig,
  project: ProjectConfig,
  build: BuildConfig) {
  const effectiveBuildDir = resolveEffectiveBuildDir(getBuildFolder(wsConfig, project, build));
  const buildInfoFilePath = path.join(effectiveBuildDir, "build_info.yml");
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
