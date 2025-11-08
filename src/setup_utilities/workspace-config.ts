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
    pythonEnvironmentSetup: false,
    westUpdated: true, // Assume west is already set up in external environment
    packagesInstalled: true, // Assume packages are already installed in external environment
    zephyrDir: zephyrBase,
    zephyrVersion: undefined, // Will be determined later if needed
    env: {},
    setupPath: path.dirname(zephyrBase), // Use parent directory of ZEPHYR_BASE
  };

  return setupState;
}
