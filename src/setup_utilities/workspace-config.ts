/*
Copyright 2025-2026 mylonics 
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
import { getPlatformNameAsync } from "../utilities/utils";
import { outputInfo, outputWarning, outputError, notifyError } from "../utilities/output";
import { WorkspaceConfig, SetupState } from "./types";
import { resolveActiveProjectBuild } from "../project_utilities/project";
import { normalizeBuildArgs } from "../project_utilities/build_args";
import { ConfigFiles, ConfigFileEntry, emptyConfigFiles } from "../project_utilities/config_selector";

/**
 * Migrate a ConfigFiles value from the old 4-array format
 * ({config: string[], extraConfig: string[], overlay: string[], extraOverlay: string[]})
 * to the new 2-array-of-entries format
 * ({config: ConfigFileEntry[], overlay: ConfigFileEntry[]}).
 * Returns true if a migration was performed.
 */
function migrateConfigFiles(confFiles: any): boolean {
  if (!confFiles) { return false; }

  const hasStringEntry = (value: any): boolean =>
    Array.isArray(value) && value.some((entry: any) => typeof entry === "string");
  const toConfigEntries = (value: any, forceExtra = false): ConfigFileEntry[] => {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .map((entry: any): ConfigFileEntry | undefined => {
        if (typeof entry === "string") {
          return forceExtra ? { path: entry, extra: true as const } : { path: entry };
        }
        if (entry && typeof entry === "object" && typeof entry.path === "string") {
          if (forceExtra) {
            return { path: entry.path, extra: true as const };
          }
          return entry.extra ? { path: entry.path, extra: true as const } : { path: entry.path };
        }
        return undefined;
      })
      .filter((entry): entry is ConfigFileEntry => !!entry);
  };

  // Detect old format: has "extraConfig" or "extraOverlay" keys, or config[0] is a string
  const needsMigration =
    Array.isArray(confFiles.extraConfig) ||
    Array.isArray(confFiles.extraOverlay) ||
    hasStringEntry(confFiles.config) ||
    hasStringEntry(confFiles.overlay);

  if (!needsMigration) { return false; }

  const newConfig: ConfigFileEntry[] = [
    ...toConfigEntries(confFiles.config),
    ...toConfigEntries(confFiles.extraConfig, true),
  ];
  const newOverlay: ConfigFileEntry[] = [
    ...toConfigEntries(confFiles.overlay),
    ...toConfigEntries(confFiles.extraOverlay, true),
  ];

  confFiles.config = newConfig;
  confFiles.overlay = newOverlay;
  delete confFiles.extraConfig;
  delete confFiles.extraOverlay;
  return true;
}

function argsMatchNormalized(value: any, normalized: string[]): boolean {
  if (!Array.isArray(value) || value.length !== normalized.length) {
    return false;
  }
  for (let i = 0; i < value.length; i++) {
    if (String(value[i]).trim() !== normalized[i]) {
      return false;
    }
  }
  return true;
}

function projectLoader(config: WorkspaceConfig, projects: any): boolean {
  config.projects = {};
  let requiresSave = false;

  if (config.projectStates === undefined) {
    config.projectStates = {};
  }

  for (const key in projects) {
    config.projects[key] = projects[key];

    // Migrate project-level confFiles from old 4-array format
    if (config.projects[key].confFiles && migrateConfigFiles(config.projects[key].confFiles)) {
      requiresSave = true;
    }

    //generate project States if they don't exist
    if (config.projectStates[key] === undefined) {
      config.projectStates[key] = { buildStates: {}, twisterStates: {} };
      if (config.activeProject === undefined) {
        config.activeProject = key;
      }
    }

    for (const build_key in projects[key].buildConfigs) {
      if (config.projectStates[key].buildStates[build_key] === undefined) {
        config.projectStates[key].buildStates[build_key] = { runnerStates: {} };
        if (config.projectStates[key].activeBuildConfig === undefined) {
          config.projectStates[key].activeBuildConfig = build_key;
        }
      }

      // Migrate build-level confFiles from old 4-array format
      if (config.projects[key].buildConfigs[build_key].confFiles &&
          migrateConfigFiles(config.projects[key].buildConfigs[build_key].confFiles)) {
        requiresSave = true;
      }

      const buildConfig = config.projects[key].buildConfigs[build_key];
      const westBuildArgsRaw = buildConfig.westBuildArgs;
      const westBuildCMakeArgsRaw = buildConfig.westBuildCMakeArgs;
      const normalizedWestBuildArgs = normalizeBuildArgs(buildConfig.westBuildArgs);
      const normalizedWestBuildCMakeArgs = normalizeBuildArgs(buildConfig.westBuildCMakeArgs);
      if (!argsMatchNormalized(westBuildArgsRaw, normalizedWestBuildArgs)
        || !argsMatchNormalized(westBuildCMakeArgsRaw, normalizedWestBuildCMakeArgs)) {
        requiresSave = true;
      }
      buildConfig.westBuildArgs = normalizedWestBuildArgs;
      buildConfig.westBuildCMakeArgs = normalizedWestBuildCMakeArgs;

      for (const runner_key in projects[key].buildConfigs[build_key].runnerConfigs) {
        if (config.projectStates[key].buildStates[build_key].runnerStates[runner_key] === undefined) {
          config.projectStates[key].buildStates[build_key].runnerStates[runner_key] = {};
          if (config.projectStates[key].buildStates[build_key].activeRunner === undefined) {
            config.projectStates[key].buildStates[build_key].activeRunner = runner_key;
          }
        }
      }
    }
  }
  return requiresSave;
}

export async function getVariable(config: WorkspaceConfig, variable_name: string, project_name?: string, build_name?: string) {
  const zephyrIdeSettingFilePath = path.join(config.rootPath, ".vscode", "zephyr-ide.json");
  try {
    const object = JSON.parse(fs.readFileSync(zephyrIdeSettingFilePath, 'utf8'));
    if (project_name) {
      const projects = object.projects;
      if (build_name) {
        return projects?.[project_name]?.buildConfigs?.[build_name]?.vars?.[variable_name] ?? "";
      }
      return projects?.[project_name]?.vars?.[variable_name] ?? "";
    }
    return object[variable_name];
  } catch (error) {
    outputError("Workspace Config", `Failed to get custom var, ${variable_name}: ${String(error)}`);
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
      const migrated = projectLoader(config, projects);
      if (migrated) {
        object.projects = config.projects;
        await fs.outputFile(zephyrIdeSettingFilePath, JSON.stringify(object, null, 2));
      }
    }
  } catch (error) {
    outputError("Workspace Config", `Failed to load .vscode/zephyr-ide.json: ${String(error)}`);
  }
}

export function setDefaultTerminal(configuration: vscode.WorkspaceConfiguration, target: vscode.ConfigurationTarget, platform_name: string, force: boolean) {
  if (force || !configuration.inspect('terminal.integrated.defaultProfile.' + platform_name)?.workspaceValue) {
    configuration.update('terminal.integrated.defaultProfile.' + platform_name, "Zephyr IDE Terminal", target, false);
  }
}

export async function setWorkspaceSettings(force = false) {
  const configuration = vscode.workspace.getConfiguration();
  const target = vscode.ConfigurationTarget.Workspace;

  const platform = await getPlatformNameAsync();
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

/**
 * Copy a resource file to the workspace if the destination doesn't already exist.
 * Ensures the destination directory exists before copying.
 */
async function copyResourceIfMissing(
  context: vscode.ExtensionContext,
  srcRelPath: string,
  desPath: string,
  label: string
) {
  if (await fs.pathExists(desPath)) { return; }
  const srcPath = path.join(context.extensionPath, ...srcRelPath.split('/'));
  try {
    await fs.ensureDir(path.dirname(desPath));
    if (await fs.pathExists(srcPath)) {
      await fs.copy(srcPath, desPath);
    } else {
      outputWarning("Workspace Config", `Source ${label} file not found at: ${srcPath} (extensionPath: ${context.extensionPath}). The extension may not be installed correctly.`);
    }
  } catch (error) {
    outputError("Workspace Config", `Failed to copy ${label} from ${srcPath} to ${desPath}: ${String(error)}`);
  }
}

export async function generateGitIgnore(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig) {
  await copyResourceIfMissing(context,
    "resources/git_ignores/gitignore_workspace_install",
    path.join(wsConfig.rootPath, ".gitignore"),
    "gitignore");
}

export async function generateExtensionsRecommendations(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig) {
  await copyResourceIfMissing(context,
    "resources/recommendations/extensions.json",
    path.join(wsConfig.rootPath, ".vscode", "extensions.json"),
    "extensions.json");
}

const toolsfoldername = ".zephyr_ide";

export function getToolsDir() {
  let toolsdir = path.join(os.homedir(), toolsfoldername);

  const configuration = vscode.workspace.getConfiguration();
  // Prefer new camelCase key, fall back to deprecated keys
  const globalDir: string | undefined = configuration.get("zephyr-ide.globalDirectory")
    || configuration.get("zephyr-ide.global_directory");
  if (globalDir) {
    toolsdir = globalDir;
  } else {
    const toolsDirFromFile: string | undefined = configuration.get("zephyr-ide.tools_directory");
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
    outputError("Workspace Config", `Failed to ensure tools directory exists: ${toolsdir}: ${String(e)}`);
  }
  return toolsdir;
}

/**
 * Migrate deprecated setting keys to their camelCase equivalents.
 * Called once on extension activation. For each pair, if the old value exists
 * and the new key is unset, the value is copied to the new key and the old key is cleared.
 */
export async function migrateSettingKeys(): Promise<void> {
  const configuration = vscode.workspace.getConfiguration();

  const migrations: { oldKey: string; newKey: string }[] = [
    { oldKey: "zephyr-ide.tools_directory", newKey: "zephyr-ide.globalDirectory" },
    { oldKey: "zephyr-ide.global_directory", newKey: "zephyr-ide.globalDirectory" },
    { oldKey: "zephyr-ide.toolchain_directory", newKey: "zephyr-ide.toolchainDirectory" },
    { oldKey: "zephyr-ide.use_gui_config", newKey: "zephyr-ide.useGuiConfig" },
    { oldKey: "zephyr-ide.suppress-workspace-warning", newKey: "zephyr-ide.suppressWorkspaceWarning" },
    { oldKey: "zephyr-ide.venv-folder", newKey: "zephyr-ide.venvFolder" },
    { oldKey: "zephyr-ide.project_variable_defaults", newKey: "zephyr-ide.projectVariableDefaults" },
    { oldKey: "zephyr-ide.build_variable_defaults", newKey: "zephyr-ide.buildVariableDefaults" },
  ];

  const migrated: string[] = [];

  for (const { oldKey, newKey } of migrations) {
    const inspect = configuration.inspect(oldKey);
    const newInspect = configuration.inspect(newKey);

    // Migrate global scope
    if (inspect?.globalValue !== undefined && newInspect?.globalValue === undefined) {
      await configuration.update(newKey, inspect.globalValue, vscode.ConfigurationTarget.Global);
      await configuration.update(oldKey, undefined, vscode.ConfigurationTarget.Global);
      if (!migrated.includes(oldKey)) {
        migrated.push(oldKey);
      }
    }

    // Migrate workspace scope
    if (inspect?.workspaceValue !== undefined && newInspect?.workspaceValue === undefined) {
      await configuration.update(newKey, inspect.workspaceValue, vscode.ConfigurationTarget.Workspace);
      await configuration.update(oldKey, undefined, vscode.ConfigurationTarget.Workspace);
      if (!migrated.includes(oldKey)) {
        migrated.push(oldKey);
      }
    }
  }

  if (migrated.length > 0) {
    void vscode.window.showInformationMessage(
      `Zephyr IDE: Migrated ${migrated.length} setting(s) to camelCase keys.`
    );
  }
}

export function getToolchainDir() {
  const configuration = vscode.workspace.getConfiguration();

  // First check if direct toolchain directory is configured
  const toolchainDir: string | undefined = configuration.get("zephyr-ide.toolchainDirectory")
    || configuration.get("zephyr-ide.toolchain_directory");
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
    outputError("Workspace Config", `Failed to create default toolchain directory "${defaultDir}": ${String(e)}`);
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

  // Only read from disk if any value is missing.
  // Use empty string "" as sentinel to indicate "checked but not found" so
  // we don't re-read from disk on every call for builds that lack a value
  // (e.g., non-ARM builds without CMAKE_GDB).
  if (buildState.gdbPath !== undefined && buildState.elfName !== undefined && buildState.toolchainPath !== undefined) {
    return;
  }

  const buildDir = path.join(wsConfig.rootPath, project.rel_path, build.name);
  const info = readCMakeCacheInfo(buildDir);

  if (buildState.gdbPath === undefined) {
    buildState.gdbPath = info.gdbPath || "";
  }
  if (buildState.elfName === undefined) {
    buildState.elfName = info.elfName || "";
  }
  if (buildState.toolchainPath === undefined) {
    buildState.toolchainPath = info.toolchainPath || "";
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
  // Empty string is a sentinel meaning "checked but not found"; fall back to default
  const elfName = buildState?.elfName || "zephyr.elf";

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
  // Empty string is a sentinel meaning "checked but not found"
  return buildState?.gdbPath || undefined;
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
  const venvPath: string | undefined = configuration.get("zephyr-ide.venvFolder")
    || configuration.get("zephyr-ide.venv-folder");

  // Use configured path if it's a non-empty string
  if (venvPath && venvPath.trim()) {
    return venvPath;
  }

  // Default to .venv in the setup path
  return path.join(setupPath, ".venv");
}

/**
 * Read the automatic project selection setting.
 * Falls back to true (the historical default) when unset.
 */
export function getAutomaticProjectSelection(): boolean {
  const configuration = vscode.workspace.getConfiguration();
  return configuration.get<boolean>("zephyr-ide.automaticProjectSelection", true);
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
  const suppressWarning: boolean | undefined = configuration.get("zephyr-ide.suppressWorkspaceWarning")
    ?? configuration.get("zephyr-ide.suppress-workspace-warning");

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
      await configuration.update("zephyr-ide.suppressWorkspaceWarning", true, vscode.ConfigurationTarget.Workspace);
      void vscode.window.showInformationMessage("Workspace warning suppressed for this workspace.");
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
export async function getSetupState(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig): Promise<SetupState | undefined> {
  // If activeSetupState exists, return it
  if (wsConfig.activeSetupState) {
    return wsConfig.activeSetupState;
  }

  // No activeSetupState - warn the user about missing environment
  await checkAndWarnMissingEnvironment(context);

  // Try to get setup state from environment variables
  return getEnvironmentSetupState() ?? undefined;
}

/**
 * Get setup state or show an error notification.
 * Convenience wrapper that eliminates the repeated null-check + notifyError
 * boilerplate at call sites.
 *
 * @param context - VS Code extension context
 * @param wsConfig - Workspace configuration
 * @param caller - Short task label for the error notification (e.g. "Build", "Flash")
 * @returns SetupState if available, undefined otherwise (after notifying the user)
 */
export async function getSetupStateOrNotify(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, caller: string): Promise<SetupState | undefined> {
  const state = await getSetupState(context, wsConfig);
  if (!state) {
    notifyError(caller, "No setup state available. Please set up your workspace first.");
  }
  return state;
}
