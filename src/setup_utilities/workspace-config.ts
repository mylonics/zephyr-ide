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
import * as os from "os";
import * as fs from "fs-extra";
import * as path from "upath";
import * as yaml from 'js-yaml';
import { getPlatformName } from "../utilities/utils";
import { outputInfo, outputWarning } from "../utilities/output";
import { WorkspaceConfig, SetupState } from "./types";
import { resolveActiveProjectBuild } from "../project_utilities/project";

function projectLoader(config: WorkspaceConfig, projects: any) {
  config.projects = {};

  if (config.projectStates === undefined) {
    config.projectStates = {};
  }

  for (let key in projects) {
    config.projects[key] = projects[key];

    //generate project States if they don't exist
    if (config.projectStates[key] === undefined) {
      config.projectStates[key] = { buildStates: {}, twisterStates: {} };
      if (config.activeProject === undefined) {
        config.activeProject = key;
      }
    }

    for (let build_key in projects[key].buildConfigs) {
      if (config.projectStates[key].buildStates[build_key] === undefined) {
        config.projectStates[key].buildStates[build_key] = { runnerStates: {} };
        if (config.projectStates[key].activeBuildConfig === undefined) {
          config.projectStates[key].activeBuildConfig = build_key;
        }
      }

      //Remove after upgrade
      if (projects[key].buildConfigs[build_key].runnerConfigs === undefined) {
        config.projects[key].buildConfigs[build_key].runnerConfigs = projects[key].buildConfigs[build_key].runners;
      }

      for (let runner_key in projects[key].buildConfigs[build_key].runnerConfigs) {
        if (config.projectStates[key].buildStates[build_key].runnerStates[runner_key] === undefined) {
          config.projectStates[key].buildStates[build_key].runnerStates[runner_key] = {};
          if (config.projectStates[key].buildStates[build_key].activeRunner === undefined) {
            config.projectStates[key].buildStates[build_key].activeRunner = runner_key;
          }
        }
      }
    }
  }
}

export async function getVariable(config: WorkspaceConfig, variable_name: string, project_name?: string, build_name?: string) {
  const zephyrIdeSettingFilePath = path.join(config.rootPath, ".vscode", "zephyr-ide.json");
  try {
    const object = JSON.parse(fs.readFileSync(zephyrIdeSettingFilePath, 'utf8'));
    if (project_name) {
      let projects = object.projects;
      if (build_name) {
        return projects[project_name]["buildConfigs"][build_name]["vars"][variable_name];
      }
      return projects[project_name]["vars"][variable_name];
    }
    return object[variable_name];
  } catch (error) {
    console.error(`Failed to get custom var, ${variable_name}`);
    console.error(error);
    return "";
  }
}

export async function loadProjectsFromFile(config: WorkspaceConfig) {
  const zephyrIdeSettingFilePath = path.join(config.rootPath, ".vscode", "zephyr-ide.json");
  try {
    if (!fs.pathExistsSync(zephyrIdeSettingFilePath)) {
      await fs.outputFile(zephyrIdeSettingFilePath, JSON.stringify({ projects: {} }, null, 2), { flag: 'w+' });
      outputInfo('Workspace Config', 'Created zephyr-ide file');
    } else {
      const object = JSON.parse(fs.readFileSync(zephyrIdeSettingFilePath, 'utf8'));
      const projects = object.projects ?? {};
      projectLoader(config, projects);
    }
  } catch (error) {
    console.error("Failed to load .vscode/zephyr-ide.json");
    console.error(error);
  }
}

export function setDefaultTerminal(configuration: vscode.WorkspaceConfiguration, target: vscode.ConfigurationTarget, platform_name: string, force: boolean) {
  if (force || !configuration.inspect('terminal.integrated.defaultProfile.' + platform_name)?.workspaceValue) {
    configuration.update('terminal.integrated.defaultProfile.' + platform_name, "Zephyr IDE Terminal", target, false);
  }
}

export async function setWorkspaceSettings(force = false) {
  const configuration = await vscode.workspace.getConfiguration();
  const target = vscode.ConfigurationTarget.Workspace;

  const platform = getPlatformName();
  if (platform === "windows") {
    setDefaultTerminal(configuration, target, "windows", force);
  } else if (platform === "linux") {
    setDefaultTerminal(configuration, target, "linux", force);
  } else if (platform === "macos") {
    setDefaultTerminal(configuration, target, "osx", force);
  }
  if (force || !configuration.inspect("C_Cpp.default.compileCommands")?.workspaceValue) {
    configuration.update("C_Cpp.default.compileCommands", path.join("${workspaceFolder}", '.vscode', 'compile_commands.json'), target);
  }
  if (force || !configuration.inspect("cmake.configureOnOpen")?.workspaceValue) {
    configuration.update("cmake.configureOnOpen", false, target);
  }
}

export async function generateGitIgnore(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig) {
  let desPath = path.join(wsConfig.rootPath, ".gitignore");
  let exists = await fs.pathExists(desPath);
  if (!exists) {
    const extensionPath = context.extensionPath;
    let srcPath = path.join(extensionPath, "resources", "git_ignores", "gitignore_workspace_install");

    try {
      // Check if source file exists
      if (await fs.pathExists(srcPath)) {
        await fs.copy(srcPath, desPath);
      } else {
        outputWarning("Workspace Config", `Source gitignore file not found at: ${srcPath} (extensionPath: ${extensionPath}). The extension may not be installed correctly.`);
      }
    } catch (error) {
      console.error(`Failed to copy gitignore from ${srcPath} to ${desPath}:`, error);
    }
  }
}

export async function generateExtensionsRecommendations(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig) {
  let desPath = path.join(wsConfig.rootPath, ".vscode", "extensions.json");
  let exists = await fs.pathExists(desPath);
  if (!exists) {
    const extensionPath = context.extensionPath;
    let srcPath = path.join(extensionPath, "resources", "recommendations", "extensions.json");

    try {
      // Ensure the .vscode directory exists
      await fs.ensureDir(path.dirname(desPath));

      // Check if source file exists
      if (await fs.pathExists(srcPath)) {
        await fs.copy(srcPath, desPath);
      } else {
        outputWarning("Workspace Config", `Source extensions.json file not found at: ${srcPath} (extensionPath: ${extensionPath}). The extension may not be installed correctly.`);
      }
    } catch (error) {
      console.error(`Failed to copy extensions.json from ${srcPath} to ${desPath}:`, error);
    }
  }
}

let toolsfoldername = ".zephyr_ide";

export function getToolsDir() {
  let toolsdir = path.join(os.homedir(), toolsfoldername);

  const configuration = vscode.workspace.getConfiguration();
  // Prefer the new global_directory setting; fall back to deprecated tools_directory
  let globalDir: string | undefined = configuration.get("zephyr-ide.global_directory");
  if (globalDir) {
    toolsdir = globalDir;
  } else {
    let toolsDirFromFile: string | undefined = configuration.get("zephyr-ide.tools_directory");
    if (toolsDirFromFile) {
      toolsdir = toolsDirFromFile;
    }
  }
  // Ensure directory exists before returning
  try {
    if (!fs.pathExistsSync(toolsdir)) {
      fs.ensureDirSync(toolsdir);
    }
  } catch (e) {
    console.error("Failed to ensure tools directory exists:", toolsdir, e);
  }
  return toolsdir;
}

/**
 * Automatically migrate the deprecated 'tools_directory' setting to 'global_directory'.
 * Called once on extension activation. No-op if already migrated or tools_directory is unset.
 */
export async function migrateToolsDirectory(): Promise<void> {
  const configuration = vscode.workspace.getConfiguration();
  const toolsDir: string | undefined = configuration.get("zephyr-ide.tools_directory");
  const globalDir: string | undefined = configuration.get("zephyr-ide.global_directory");

  if (toolsDir && !globalDir) {
    await configuration.update("zephyr-ide.global_directory", toolsDir, vscode.ConfigurationTarget.Global);
    await configuration.update("zephyr-ide.tools_directory", undefined, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage(
      `Zephyr IDE: 'zephyr-ide.tools_directory' has been automatically migrated to 'zephyr-ide.global_directory' (${toolsDir}).`
    );
  }
}

export function getToolchainDir() {
  const configuration = vscode.workspace.getConfiguration();

  // First check if direct toolchain directory is configured
  let toolchainDir: string | undefined = configuration.get("zephyr-ide.toolchain_directory");
  if (toolchainDir && toolchainDir.trim()) {
    // Return configured path without creating it - user is responsible for ensuring it exists
    return toolchainDir;
  }

  // Fall back to toolchains subdirectory in tools directory
  const defaultDir = path.join(getToolsDir(), "toolchains");

  // Ensure the default directory exists
  try {
    if (!fs.pathExistsSync(defaultDir)) {
      fs.ensureDirSync(defaultDir);
    }
  } catch (e) {
    console.error(`Failed to create default toolchain directory "${defaultDir}":`, e);
  }

  return defaultDir;
}

/**
 * Information parsed from a build directory (CMakeCache.txt + build_info.yml).
 */
interface CMakeCacheInfo {
  gdbPath?: string;
  elfName?: string;
  toolchainPath?: string;
}

/**
 * Read build information from a build directory in a single pass.
 * Resolves the effective domain build directory once (via domains.yaml for sysbuild),
 * then reads both CMakeCache.txt (for CMAKE_GDB / BYPRODUCT_KERNEL_ELF_NAME) and
 * build_info.yml (for toolchain.path) from that directory.
 * @param buildDir The top-level build directory path
 * @returns An object containing the parsed GDB path, ELF name, and toolchain path
 */
function readCMakeCacheInfo(buildDir: string): CMakeCacheInfo {
  const info: CMakeCacheInfo = {};

  // Resolve the effective build directory, handling sysbuild via domains.yaml
  let effectiveBuildDir = buildDir;
  const domainsYamlPath = path.join(buildDir, "domains.yaml");
  if (fs.pathExistsSync(domainsYamlPath)) {
    outputInfo("CMakeCache", `Found domains.yaml at "${domainsYamlPath}" — sysbuild detected.`);
    try {
      const domainsDoc: any = yaml.load(fs.readFileSync(domainsYamlPath, 'utf-8'));
      const defaultName = domainsDoc?.default;
      const domains: any[] = domainsDoc?.domains;
      if (defaultName && Array.isArray(domains)) {
        const defaultDomain = domains.find((d: any) => d.name === defaultName);
        if (defaultDomain?.build_dir) {
          effectiveBuildDir = defaultDomain.build_dir;
          outputInfo("CMakeCache", `Using domain "${defaultName}" build dir at "${effectiveBuildDir}".`);
        } else {
          outputWarning("CMakeCache", `Default domain "${defaultName}" has no build_dir in domains.yaml.`);
          return info;
        }
      } else {
        outputWarning("CMakeCache", `domains.yaml missing "default" or "domains" fields.`);
        return info;
      }
    } catch (domainError) {
      outputWarning("CMakeCache", `Error reading domains.yaml: ${domainError}`);
      return info;
    }
  }

  // Read CMakeCache.txt for GDB path and ELF name
  const cmakeCachePath = path.join(effectiveBuildDir, "CMakeCache.txt");
  if (!fs.pathExistsSync(cmakeCachePath)) {
    outputWarning("CMakeCache", `CMakeCache.txt not found at "${cmakeCachePath}". The project may not have been built yet.`);
  } else {
    try {
      const cacheContent = fs.readFileSync(cmakeCachePath, 'utf-8');

      const gdbMatch = cacheContent.match(/^CMAKE_GDB:\w+=(.+)$/m);
      if (gdbMatch && gdbMatch[1]) {
        info.gdbPath = gdbMatch[1].trim();
        outputInfo("CMakeCache", `Found GDB path: "${info.gdbPath}"`);
      } else {
        outputInfo("CMakeCache", `CMAKE_GDB not found in "${cmakeCachePath}".`);
      }

      const elfMatch = cacheContent.match(/^BYPRODUCT_KERNEL_ELF_NAME:\w+=(.+)$/m);
      if (elfMatch && elfMatch[1]) {
        info.elfName = elfMatch[1].trim();
        outputInfo("CMakeCache", `Found kernel ELF name: "${info.elfName}"`);
      } else {
        outputWarning("CMakeCache", `BYPRODUCT_KERNEL_ELF_NAME not found in "${cmakeCachePath}".`);
      }
    } catch (error) {
      outputWarning("CMakeCache", `Error reading CMakeCache.txt: ${error}`);
    }
  }

  // Read build_info.yml for toolchain path (same effective build directory)
  const buildInfoPath = path.join(effectiveBuildDir, "build_info.yml");
  if (fs.pathExistsSync(buildInfoPath)) {
    try {
      const rawData: any = yaml.load(fs.readFileSync(buildInfoPath, 'utf-8'));
      const toolchainPath = rawData?.toolchain?.path;
      if (toolchainPath && typeof toolchainPath === 'string') {
        info.toolchainPath = toolchainPath;
        outputInfo("CMakeCache", `Found toolchain path: "${info.toolchainPath}"`);
      }
    } catch (e) {
      outputWarning("CMakeCache", `Failed to parse build_info.yml at "${buildInfoPath}": ${e}`);
    }
  }

  return info;
}

/**
 * Update cached CMake info (GDB path, ELF name, and toolchain path) for a build after build completes
 * @param wsConfig The workspace configuration  
 * @param projectName The project name
 * @param buildName The build name
 */
export function updateBuildCMakeInfo(wsConfig: WorkspaceConfig, projectName: string, buildName: string): void {
  const project = wsConfig.projects[projectName];
  if (!project) {
    return;
  }

  const build = project.buildConfigs[buildName];
  if (!build) {
    return;
  }

  const buildState = wsConfig.projectStates[projectName]?.buildStates[buildName];
  if (!buildState) {
    return;
  }

  const buildDir = path.join(wsConfig.rootPath, project.rel_path, build.name);
  const info = readCMakeCacheInfo(buildDir);

  if (info.gdbPath) {
    buildState.gdbPath = info.gdbPath;
    outputInfo("CMakeCache", `Updated cached GDB path for ${buildName}: "${info.gdbPath}"`);
  }
  if (info.elfName) {
    buildState.elfName = info.elfName;
    outputInfo("CMakeCache", `Updated cached ELF name for ${buildName}: "${info.elfName}"`);
  }
  if (info.toolchainPath) {
    buildState.toolchainPath = info.toolchainPath;
    outputInfo("CMakeCache", `Updated cached toolchain path for ${buildName}: "${info.toolchainPath}"`);
  }
}

/**
 * Clear cached CMake info (GDB path, ELF name, and toolchain path) for a build (called on pristine/clean)
 * @param wsConfig The workspace configuration
 * @param projectName The project name
 * @param buildName The build name
 */
export function clearBuildCMakeInfo(wsConfig: WorkspaceConfig, projectName: string, buildName: string): void {
  const buildState = wsConfig.projectStates[projectName]?.buildStates[buildName];
  if (buildState) {
    buildState.gdbPath = undefined;
    buildState.elfName = undefined;
    buildState.toolchainPath = undefined;
    outputInfo("CMakeCache", `Cleared cached CMake info for ${buildName}`);
  }
}

/**
 * Ensure cached build info (GDB path, ELF name, and toolchain path) is populated for the given build.
 * Only reads from disk if any value is missing from the build state.
 * This avoids redundant file reads when multiple getters are called for the same build.
 */
function ensureBuildCMakeInfoCached(wsConfig: WorkspaceConfig, projectName: string, buildName: string): void {
  const project = wsConfig.projects[projectName];
  if (!project) {
    return;
  }

  const build = project.buildConfigs[buildName];
  if (!build) {
    return;
  }

  const buildState = wsConfig.projectStates[projectName]?.buildStates[buildName];
  if (!buildState) {
    return;
  }

  // Only read from disk if any value is missing
  if (buildState.gdbPath && buildState.elfName && buildState.toolchainPath) {
    return;
  }

  const buildDir = path.join(wsConfig.rootPath, project.rel_path, build.name);
  const info = readCMakeCacheInfo(buildDir);

  if (info.gdbPath && !buildState.gdbPath) {
    buildState.gdbPath = info.gdbPath;
  }
  if (info.elfName && !buildState.elfName) {
    buildState.elfName = info.elfName;
  }
  if (info.toolchainPath && !buildState.toolchainPath) {
    buildState.toolchainPath = info.toolchainPath;
  }
}

/**
 * Get the full path to the Zephyr kernel ELF file for the active build.
 * Uses cached ELF name from BuildState, or reads from CMakeCache.txt,
 * falling back to the default "zephyr.elf".
 * @param wsConfig The workspace configuration
 * @returns The full path to the ELF file, or undefined if no active build
 */
export function getZephyrElfPath(wsConfig: WorkspaceConfig): string | undefined {
  const resolved = resolveActiveProjectBuild(wsConfig);
  if (!resolved) { return undefined; }

  const { projectName, project, buildName, build } = resolved;

  ensureBuildCMakeInfoCached(wsConfig, projectName, buildName);

  const buildState = wsConfig.projectStates[projectName]?.buildStates[buildName];
  let elfName = buildState?.elfName ?? "zephyr.elf";

  // For sysbuild, elfName may be an absolute path; use it directly
  if (path.isAbsolute(elfName)) {
    return elfName;
  }

  return path.join(wsConfig.rootPath, project.rel_path, buildName, "zephyr", elfName);
}

/**
 * Get the directory containing the Zephyr kernel ELF file for the active build.
 * This is the "zephyr" subdirectory within the build directory.
 * @param wsConfig The workspace configuration
 * @returns The path to the zephyr output directory, or undefined if no active build
 */
export function getZephyrElfDir(wsConfig: WorkspaceConfig): string | undefined {
  const resolved = resolveActiveProjectBuild(wsConfig);
  if (!resolved) { return undefined; }

  return path.join(wsConfig.rootPath, resolved.project.rel_path, resolved.buildName, "zephyr");
}

/**
 * Get the GDB path from the active build's CMake cache (CMAKE_GDB).
 * Uses cached value from BuildState if available, otherwise reads from CMakeCache.txt.
 * @param wsConfig The workspace configuration
 * @returns The full path to the GDB executable or undefined if not found
 */
export function getGdbPath(wsConfig: WorkspaceConfig): string | undefined {
  const resolved = resolveActiveProjectBuild(wsConfig);
  if (!resolved) { return undefined; }

  ensureBuildCMakeInfoCached(wsConfig, resolved.projectName, resolved.buildName);

  const buildState = wsConfig.projectStates[resolved.projectName]?.buildStates[resolved.buildName];
  return buildState?.gdbPath;
}

/**
 * Get the toolchain directory for the active build.
 * Uses cached toolchain path from BuildState if available; otherwise reads from
 * build_info.yml (toolchain.path) and caches the result for future calls.
 * Handles sysbuild by using the default domain's build_info.yml.
 * Falls back to getToolchainDir() (the configured or default directory) when no
 * active build is selected or build_info.yml is not present/readable.
 * @param wsConfig The workspace configuration
 * @returns The toolchain directory path
 */
export function getToolchainPath(wsConfig: WorkspaceConfig): string {
  const resolved = resolveActiveProjectBuild(wsConfig);
  if (resolved) {
    ensureBuildCMakeInfoCached(wsConfig, resolved.projectName, resolved.buildName);
    const buildState = wsConfig.projectStates[resolved.projectName]?.buildStates[resolved.buildName];
    if (buildState?.toolchainPath) {
      return buildState.toolchainPath;
    }
  }
  // No active build or build_info.yml not available: return configured/default toolchain directory
  return getToolchainDir();
}

/**
 * Get the ARM GDB path (without Python support) from the active build.
 * Takes the CMAKE_GDB path and replaces the Python-enabled GDB variant
 * (e.g. arm-zephyr-eabi-gdb-py) with the plain GDB variant (arm-zephyr-eabi-gdb).
 * @param wsConfig The workspace configuration
 * @returns The full path to the ARM GDB executable or undefined if not found
 */
export function getArmGdbPath(wsConfig: WorkspaceConfig): string | undefined {
  const gdbPath = getGdbPath(wsConfig);
  if (!gdbPath) {
    return undefined;
  }

  // Replace gdb-py with gdb (handles both with and without .exe extension)
  return gdbPath.replace(/gdb-py(\.exe)?$/, 'gdb$1');
}

/**
 * Get the Python virtual environment path, either from configuration or default
 * @param setupPath - The setup path to use for the default venv location
 * @returns The path to the Python virtual environment
 */
export function getVenvPath(setupPath: string): string {
  const configuration = vscode.workspace.getConfiguration();
  let venvPath: string | undefined = configuration.get("zephyr-ide.venv-folder");

  // Use configured path if it's a non-empty string
  if (venvPath && venvPath.trim()) {
    return venvPath;
  }

  // Default to .venv in the setup path
  return path.join(setupPath, ".venv");
}

/**
 * Create a SetupState from environment variables if they exist
 * This allows the extension to work with externally-managed Zephyr environments
 * @returns SetupState if ZEPHYR_BASE is set, undefined otherwise
 */
export function getEnvironmentSetupState(): SetupState | undefined {
  const zephyrBase = process.env.ZEPHYR_BASE;

  if (!zephyrBase) {
    return undefined;
  }

  // Create a setup state based on environment variables
  const setupState: SetupState = {
    pythonEnvironmentSetup: true,
    westUpdated: true, // Assume west is already set up in external environment
    packagesInstalled: true, // Assume packages are already installed in external environment
    zephyrDir: zephyrBase,
    zephyrVersion: undefined, // Will be determined later if needed
    env: {},
    setupPath: path.dirname(zephyrBase), // Use parent directory of ZEPHYR_BASE
  };

  return setupState;
}

/**
 * Check if required Zephyr environment variables are present
 * @returns true if either ZEPHYR_BASE or ZEPHYR_SDK_INSTALL_DIR is set, false otherwise
 */
function checkZephyrEnvironmentVariables(): boolean {
  return !!(process.env.ZEPHYR_BASE || process.env.ZEPHYR_SDK_INSTALL_DIR);
}

/**
 * Show a warning if Zephyr environment variables are not set
 * Allows user to suppress future warnings
 */
async function checkAndWarnMissingEnvironment(context: vscode.ExtensionContext): Promise<void> {
  const configuration = vscode.workspace.getConfiguration();
  const suppressWarning: boolean | undefined = configuration.get("zephyr-ide.suppress-workspace-warning");

  // Don't show warning if user has suppressed it
  if (suppressWarning) {
    return;
  }

  // Check if environment variables are present
  if (!checkZephyrEnvironmentVariables()) {
    const result = await vscode.window.showWarningMessage(
      "No Zephyr workspace environment detected. Neither ZEPHYR_BASE nor ZEPHYR_SDK_INSTALL_DIR environment variables are set.\n\nChoose 'Continue' to proceed using system environment variables, 'Don't Show Again' to suppress this warning, or 'Setup Workspace' to open the setup wizard.",
      "Continue",
      "Don't Show Again",
      "Setup Workspace"
    );

    if (result === "Don't Show Again") {
      // Save the preference to not show again
      await configuration.update("zephyr-ide.suppress-workspace-warning", true, vscode.ConfigurationTarget.Workspace);
      vscode.window.showInformationMessage("Workspace warning suppressed for this workspace.");
    } else if (result === "Setup Workspace") {
      // Open the setup wizard panel for workspace configuration
      await vscode.commands.executeCommand("zephyr-ide.setupWorkspace");
    }
  }
}

/**
 * Get the setup state for the workspace, handling all the logic for:
 * - Returning existing activeSetupState if available
 * - Warning user if no environment is set up
 * - Creating setup state from environment variables if available
 * 
 * @param context - VS Code extension context
 * @param wsConfig - Workspace configuration
 * @returns SetupState if available, undefined otherwise
 */
export async function getSetupState(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig): Promise<SetupState> {
  // If activeSetupState exists, return it
  if (wsConfig.activeSetupState) {
    return wsConfig.activeSetupState;
  }

  // No activeSetupState - warn the user about missing environment
  await checkAndWarnMissingEnvironment(context);

  // Try to get setup state from environment variables
  // Fall back to an empty default state if no environment is configured
  return getEnvironmentSetupState() ?? {
    pythonEnvironmentSetup: false,
    westUpdated: false,
    packagesInstalled: false,
    zephyrDir: "",
    zephyrVersion: undefined,
    env: {},
    setupPath: ".",
  };
}
