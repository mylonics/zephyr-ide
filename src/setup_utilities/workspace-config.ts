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
import * as path from "path";
import { getPlatformName } from "../utilities/utils";
import { WorkspaceConfig, SetupState } from "./types";

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
  const zephyrIdeSettingFilePath = path.join(config.rootPath, ".vscode/zephyr-ide.json");
  try {
    var object = await JSON.parse(fs.readFileSync(zephyrIdeSettingFilePath, 'utf8'));
    if (project_name) {
      let projects = object.projects;
      if (build_name) {
        return projects[project_name]["buildConfigs"][build_name]["vars"][variable_name];
      }
      return projects[project_name]["vars"][variable_name];
    }
    return object[variable_name];
  } catch (error) {
    console.error('Failed to get custom var, ${variable_name}');
    console.error(error);
    return "";
  }
}

export async function loadProjectsFromFile(config: WorkspaceConfig) {
  const zephyrIdeSettingFilePath = path.join(config.rootPath, ".vscode/zephyr-ide.json");
  try {
    if (!fs.pathExistsSync(zephyrIdeSettingFilePath)) {
      await fs.outputFile(zephyrIdeSettingFilePath, JSON.stringify({}, null, 2), { flag: 'w+' }, function (err: any) {
        if (err) { throw err; }
        console.log('Created zephyr-ide file');
      }
      );
    } else {
      var object = await JSON.parse(fs.readFileSync(zephyrIdeSettingFilePath, 'utf8'));
      let projects = object.projects;
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

  if (getPlatformName() === "windows") {
    setDefaultTerminal(configuration, target, "windows", force);
  }
  if (getPlatformName() === "linux") {
    setDefaultTerminal(configuration, target, "linux", force);
  }
  if (getPlatformName() === "macos") {
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
        console.warn(`Source gitignore file not found at: ${srcPath}`);
      }
    } catch (error) {
      console.error(`Failed to copy gitignore from ${srcPath} to ${desPath}:`, error);
    }
  }
}

export async function generateExtensionsRecommendations(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig) {
  let desPath = path.join(wsConfig.rootPath, ".vscode/extensions.json");
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
        console.warn(`Source extensions.json file not found at: ${srcPath}`);
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
  let toolsDirFromFile: string | undefined = configuration.get("zephyr-ide.tools_directory");
  if (toolsDirFromFile) {
    toolsdir = toolsDirFromFile;
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

export function getToolchainDir() {
  return path.join(getToolsDir(), "toolchains");
}

/**
 * Map board subdirectory architecture prefix to toolchain name
 * @param boardSubDir The board subdirectory (e.g., "arm/st/nucleo_f401re")
 * @returns The toolchain prefix (e.g., "arm-zephyr-eabi") or undefined if unknown
 */
function getToolchainFromBoardDir(boardSubDir: string): string | undefined {
  const archPrefix = boardSubDir.split('/')[0].toLowerCase();
  
  // Map architecture prefixes to toolchain names
  const archToToolchain: { [key: string]: string } = {
    'arm': 'arm-zephyr-eabi',
    'arm64': 'aarch64-zephyr-elf',
    'aarch64': 'aarch64-zephyr-elf',
    'arc': 'arc-zephyr-elf',
    'arc64': 'arc64-zephyr-elf',
    'mips': 'mips-zephyr-elf',
    'nios2': 'nios2-zephyr-elf',
    'riscv': 'riscv64-zephyr-elf',
    'riscv32': 'riscv64-zephyr-elf',
    'riscv64': 'riscv64-zephyr-elf',
    'sparc': 'sparc-zephyr-elf',
    'x86': 'x86_64-zephyr-elf',
    'x86_64': 'x86_64-zephyr-elf',
    'xtensa': 'xtensa-sample_controller_zephyr-elf', // Default xtensa toolchain
    'microblaze': 'microblazeel-zephyr-elf',
  };
  
  return archToToolchain[archPrefix];
}

/**
 * Find the latest installed SDK version in the toolchains directory
 * @returns The SDK directory name (e.g., "zephyr-sdk-0.17.3") or undefined
 */
function findLatestSdkVersion(): string | undefined {
  const toolchainDir = getToolchainDir();
  
  if (!fs.pathExistsSync(toolchainDir)) {
    return undefined;
  }
  
  const entries = fs.readdirSync(toolchainDir);
  const sdkDirs = entries.filter(entry => {
    const fullPath = path.join(toolchainDir, entry);
    return fs.statSync(fullPath).isDirectory() && entry.startsWith('zephyr-sdk-');
  });
  
  if (sdkDirs.length === 0) {
    return undefined;
  }
  
  // Sort by version number (descending) to get the latest
  sdkDirs.sort((a, b) => {
    const versionA = a.replace('zephyr-sdk-', '');
    const versionB = b.replace('zephyr-sdk-', '');
    return versionB.localeCompare(versionA, undefined, { numeric: true });
  });
  
  return sdkDirs[0];
}

/**
 * Get the GDB path for the active build based on its board architecture
 * @param wsConfig The workspace configuration
 * @returns The full path to the GDB executable or undefined if not found
 */
export function getGdbPath(wsConfig: WorkspaceConfig): string | undefined {
  // Check for user-defined ZEPHYR_SDK_INSTALL_DIR first
  const userSdkDir = process.env.ZEPHYR_SDK_INSTALL_DIR;
  
  // Get the active project and build
  if (!wsConfig.activeProject) {
    return undefined;
  }
  
  const project = wsConfig.projects[wsConfig.activeProject];
  if (!project) {
    return undefined;
  }
  
  const activeBuildName = wsConfig.projectStates[wsConfig.activeProject]?.activeBuildConfig;
  if (!activeBuildName) {
    return undefined;
  }
  
  const build = project.buildConfigs[activeBuildName];
  if (!build) {
    return undefined;
  }
  
  // Determine the toolchain from the board subdirectory
  const toolchain = getToolchainFromBoardDir(build.relBoardSubDir);
  if (!toolchain) {
    return undefined;
  }
  
  // Find the SDK directory
  let sdkDir: string;
  if (userSdkDir && fs.pathExistsSync(userSdkDir)) {
    sdkDir = userSdkDir;
  } else {
    const latestSdk = findLatestSdkVersion();
    if (!latestSdk) {
      return undefined;
    }
    sdkDir = path.join(getToolchainDir(), latestSdk);
  }
  
  // Construct the GDB path
  const gdbName = `${toolchain}-gdb`;
  const gdbPath = path.join(sdkDir, toolchain, 'bin', gdbName);
  
  // Check if the GDB executable exists
  if (fs.pathExistsSync(gdbPath)) {
    return gdbPath;
  }
  
  // On Windows, check for .exe extension
  const gdbPathExe = gdbPath + '.exe';
  if (fs.pathExistsSync(gdbPathExe)) {
    return gdbPathExe;
  }
  
  return undefined;
}

/**
 * Create a SetupState from environment variables if they exist
 * This allows the extension to work with externally-managed Zephyr environments
 * @returns SetupState if ZEPHYR_BASE is set, undefined otherwise
 */
export function getEnvironmentSetupState(): SetupState {
  let zephyrBase = process.env.ZEPHYR_BASE;

  if (!zephyrBase) {
    zephyrBase = "";
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
  return getEnvironmentSetupState();
}
