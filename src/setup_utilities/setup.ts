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

import { getPlatformName, installSdk, pickToolchainTarget, ToolChainDictionary } from "../setup_utilities/setup_toolchain";
import { getRootPath, getShellEnvironment, output, executeShellCommand, executeTaskHelper } from "../utilities/utils";
import { ProjectConfig, ProjectState } from "../project_utilities/project";

import { westSelector, WestLocation } from "./west_selector";
export type ProjectConfigDictionary = { [name: string]: ProjectConfig };
export type ProjectStateDictionary = { [name: string]: ProjectState };

export interface SetupState {
  toolsAvailable: boolean,
  pythonEnvironmentSetup: boolean,
  westUpdated: boolean,
  sdkInstalled?: boolean,
  zephyrDir: string,
  env: { [name: string]: string | undefined },
  setupPath: string,
}

export type SetupStateDictionary = { [name: string]: SetupState };

export function generateSetupState(setupPath: string): SetupState {
  return {
    toolsAvailable: false,
    pythonEnvironmentSetup: false,
    westUpdated: false,
    zephyrDir: '',
    env: {},
    setupPath: setupPath
  };
}

export interface GlobalConfig {
  toolchains: ToolChainDictionary,
  armGdbPath: string,
  setupState?: SetupState,
  sdkInstalled?: boolean,
  setupStateDictionary?: SetupStateDictionary, //Can eventually remove the optional
}

export enum SetupStateType {
  NONE = "None",
  LOCAL = "Local",
  GLOBAL = "Global",
  EXTERNAL = "External",
  SELECTED = "Selected"
}

export interface WorkspaceConfig {
  rootPath: string;
  projects: ProjectConfigDictionary,
  activeProject?: string,
  initialSetupComplete: boolean,
  automaticProjectSelction: boolean,
  localSetupState?: SetupState,
  activeSetupState?: SetupState,
  selectSetupType: SetupStateType,
  projectStates: ProjectStateDictionary,
}



function projectLoader(config: WorkspaceConfig, projects: any) {
  config.projects = {};

  if (config.projectStates === undefined) {
    config.projectStates = {};
  }

  for (let key in projects) {
    config.projects[key] = projects[key];

    //generate project States if they don't exist
    if (config.projectStates[key] == undefined) {
      config.projectStates[key] = { buildStates: {} }
      if (config.activeProject == undefined) {
        config.activeProject = key;
      }
    }

    for (let build_key in projects[key].buildConfigs) {
      if (config.projectStates[key].buildStates[build_key] == undefined) {
        config.projectStates[key].buildStates[build_key] = { runnerStates: {} }
        if (config.projectStates[key].activeBuildConfig == undefined) {
          config.projectStates[key].activeBuildConfig = build_key;
        }
      }

      //Remove after upgrade
      if (projects[key].buildConfigs[build_key].runnerConfigs == undefined) {
        config.projects[key].buildConfigs[build_key].runnerConfigs = projects[key].buildConfigs[build_key].runners;
      }

      for (let runner_key in projects[key].buildConfigs[build_key].runnerConfigs) {
        if (config.projectStates[key].buildStates[build_key].runnerStates[runner_key] == undefined) {
          config.projectStates[key].buildStates[build_key].runnerStates[runner_key] = {};
          if (config.projectStates[key].buildStates[build_key].activeRunner == undefined) {
            config.projectStates[key].buildStates[build_key].activeRunner = runner_key;
          }
        }
      }
    }
  }
}

export function getActiveBuildOfProject(wsConfig: WorkspaceConfig, project: string) {
  return wsConfig.projectStates[project].activeBuildConfig;
}

export function getActiveRunnerOfBuild(wsConfig: WorkspaceConfig, project: string, build: string) {
  return wsConfig.projectStates[project].buildStates[build].activeRunner;
}

export function getActiveBuildConfigOfProject(wsConfig: WorkspaceConfig, project: string) {
  let buildName = wsConfig.projectStates[project].activeBuildConfig;
  if (buildName) {
    return wsConfig.projects[project].buildConfigs[buildName];
  }
  return;
}

export function getActiveRunnerConfigOfBuild(wsConfig: WorkspaceConfig, project: string, build: string) {
  let activeBuild = getActiveBuildConfigOfProject(wsConfig, project);
  if (activeBuild && wsConfig.projectStates[project].buildStates[build].activeRunner != undefined) {
    let activeRunnerName = wsConfig.projectStates[project].buildStates[build].activeRunner;
    if (activeRunnerName) {
      return activeBuild.runnerConfigs[activeRunnerName];
    }
  }
  return;
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
  const configuration = await vscode.workspace.getConfiguration();
  let useExternalJson: boolean | undefined = await configuration.get("zephyr-ide.use-zephyr-ide-json");
  if (useExternalJson) {
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
  } else {
    let temp: ProjectConfigDictionary | undefined = await configuration.get("zephyr-ide.projects");
    temp = JSON.parse(JSON.stringify(temp));
    if (temp) {
      projectLoader(config, temp);
    }
  }
}

export async function loadGlobalState(context: vscode.ExtensionContext): Promise<GlobalConfig> {
  let globalConfig: GlobalConfig = await context.globalState.get("zephyr-ide.state") ?? {
    toolchains: {},
    armGdbPath: '',
    setupStateDictionary: {}
  };
  return globalConfig;
}

export async function setGlobalState(context: vscode.ExtensionContext, globalConfig: GlobalConfig) {
  await context.globalState.update("zephyr-ide.state", globalConfig);
}


export async function loadExternalSetupState(context: vscode.ExtensionContext, globalConfig: GlobalConfig, path: string): Promise<SetupState | undefined> {
  if (globalConfig.setupStateDictionary) {
    for (let prexistingPath in globalConfig.setupStateDictionary) {
      if (!fs.pathExistsSync(prexistingPath)) {
        delete globalConfig.setupStateDictionary[prexistingPath];
      }
    }

    if (path in globalConfig.setupStateDictionary) {
      return globalConfig.setupStateDictionary[path];
    }
  }

  if (fs.pathExistsSync(path)) {
    let setupState = generateSetupState(path);
    if (globalConfig.setupStateDictionary === undefined) {
      globalConfig.setupStateDictionary = {};
    }
    globalConfig.setupStateDictionary[path] = setupState;
    return setupState;
  }

  return;
}

export async function setExternalSetupState(context: vscode.ExtensionContext, globalConfig: GlobalConfig, path: string, setupState: SetupState) {
  if (globalConfig.setupStateDictionary === undefined) {
    globalConfig.setupStateDictionary = {};
  }
  globalConfig.setupStateDictionary[path] = setupState;

  //delete folders that don't exist
  for (path in globalConfig.setupStateDictionary) {
    if (!fs.pathExistsSync(path)) {
      delete globalConfig.setupStateDictionary[path];
    }
  }
  setGlobalState(context, globalConfig);
}


export async function loadWorkspaceState(context: vscode.ExtensionContext): Promise<WorkspaceConfig> {
  let rootPath = getRootPath()?.fsPath;
  if (!rootPath) {
    rootPath = "";
  }


  let config: WorkspaceConfig = await context.workspaceState.get("zephyr.env") ?? {
    rootPath: rootPath,
    projects: {},
    automaticProjectSelction: true,
    initialSetupComplete: false,
    selectSetupType: SetupStateType.NONE,
    projectStates: {}
  };

  loadProjectsFromFile(config);
  return config;
}

export function setDefaultTerminal(configuration: vscode.WorkspaceConfiguration, target: vscode.ConfigurationTarget, platform_name: string) {
  configuration.update('terminal.integrated.defaultProfile.' + platform_name, "Zephyr IDE Terminal", target, false);
}

export async function oneTimeWorkspaceSetup(context: vscode.ExtensionContext) {
  let configName = "zephyr-ide-v50-one-time-config.env";
  let oneTimeConfig: boolean | undefined = await context.workspaceState.get(configName)

  if (oneTimeConfig === undefined || oneTimeConfig === false) {
    const configuration = await vscode.workspace.getConfiguration();
    const target = vscode.ConfigurationTarget.Workspace;

    if (getPlatformName() === "windows") {
      setDefaultTerminal(configuration, target, "windows");
    }
    if (getPlatformName() === "linux") {
      setDefaultTerminal(configuration, target, "linux");
    }
    if (getPlatformName() === "macos") {
      setDefaultTerminal(configuration, target, "osx");
    }

    configuration.update("C_Cpp.default.compileCommands", path.join("${workspaceFolder}", '.vscode', 'compile_commands.json'), target)

    configuration.update("cmake.configureOnOpen", false, target);
    await context.workspaceState.update(configName, true)
  }
}

async function generateGitIgnore(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig) {
  const extensionPath = context.extensionPath;
  let srcPath = path.join(extensionPath, "git_ignores", "gitignore_workspace_install");
  let desPath = path.join(wsConfig.rootPath, ".gitignore");
  let exists = await fs.pathExists(desPath);
  if (!exists) {
    let res = await fs.copyFile(srcPath, desPath, fs.constants.COPYFILE_FICLONE);
  }
}

export async function setSetupState(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, globalConfig: GlobalConfig, setupStateType: SetupStateType, ext_path: string = "") {
  generateGitIgnore(context, wsConfig); // Try to generate a .gitignore each time this is run
  if (setupStateType !== SetupStateType.NONE) {
    oneTimeWorkspaceSetup(context);
  }
  if (setupStateType === SetupStateType.SELECTED) {
    wsConfig.activeSetupState = await loadExternalSetupState(context, globalConfig, ext_path);
    if (wsConfig.activeSetupState) {
      wsConfig.selectSetupType = setupStateType;
    } else {
      wsConfig.selectSetupType = SetupStateType.NONE;
    }
  } else {
    wsConfig.activeSetupState = undefined;
    wsConfig.selectSetupType = setupStateType;
  }

  await setWorkspaceState(context, wsConfig);

  const configuration = await vscode.workspace.getConfiguration();
  const target = vscode.ConfigurationTarget.Workspace;
  if (wsConfig.activeSetupState && wsConfig.activeSetupState.zephyrDir) {
    if (wsConfig.activeSetupState.setupPath === wsConfig.rootPath) {
      configuration.update("devicetree.zephyr", path.join("${workspaceFolder}", path.relative(wsConfig.rootPath, wsConfig.activeSetupState.zephyrDir)), target);
      configuration.update("kconfig.zephyr.base", path.join("${workspaceFolder}", path.relative(wsConfig.rootPath, wsConfig.activeSetupState.zephyrDir)), target);
    } else {
      configuration.update("devicetree.zephyr", wsConfig.activeSetupState.zephyrDir, target);
      configuration.update("kconfig.zephyr.base", wsConfig.activeSetupState.zephyrDir, target);
    }
  }
}

export function saveSetupState(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, globalConfig: GlobalConfig) {
  if (wsConfig.activeSetupState) {
    setExternalSetupState(context, globalConfig, wsConfig.activeSetupState.setupPath, wsConfig.activeSetupState);
  }
  setGlobalState(context, globalConfig);
}

export async function setWorkspaceState(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig) {
  fs.outputFile(path.join(wsConfig.rootPath, ".vscode/zephyr-ide.json"), JSON.stringify({ projects: wsConfig.projects }, null, 2), { flag: 'w+' }, function (err: any) {
    if (err) { throw err; }
  });

  const configuration = await vscode.workspace.getConfiguration();
  const target = vscode.ConfigurationTarget.Workspace;

  await configuration.update("zephyr-ide.use-zephyr-ide-json", true, target);
  await configuration.update('zephyr-ide.projects', null, false);

  await context.workspaceState.update("zephyr.env", wsConfig);
}

export async function clearWorkspaceState(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig) {
  wsConfig.automaticProjectSelction = true;
  wsConfig.initialSetupComplete = false;
  wsConfig.selectSetupType = SetupStateType.NONE;
  setWorkspaceState(context, wsConfig);
}

let python = os.platform() === "linux" ? "python3" : "python";
export let pathdivider = os.platform() === "win32" ? ";" : ":";

let toolsfoldername = ".zephyr_ide";

export function getToolsDir() {
  let toolsdir = path.join(os.homedir(), toolsfoldername);

  const configuration = vscode.workspace.getConfiguration();
  let toolsDirFromFile: string | undefined = configuration.get("zephyr-ide.tools_directory");
  if (toolsDirFromFile != undefined || toolsDirFromFile != null) {
    toolsdir = toolsDirFromFile;
  }
  return toolsdir
}

export function getToolchainDir() {
  return path.join(getToolsDir(), "toolchains");
}

export async function checkIfToolAvailable(tool: string, cmd: string, wsConfig: WorkspaceConfig, printStdOut: boolean, includes?: string) {
  if (wsConfig.activeSetupState == undefined) {
    vscode.window.showErrorMessage(`Unable to check for tools. Select Global or Local Install First.`)
    return;
  }
  let res = await executeShellCommand(cmd, wsConfig.activeSetupState?.setupPath, getShellEnvironment(wsConfig.activeSetupState), true);
  if (res.stdout) {
    if (printStdOut) {
      output.append(res.stdout);
    }
    if ((includes && res.stdout.includes(includes)) || includes === undefined) {
      output.appendLine(`[SETUP] ${tool} installed`);
      return true;
    }
    output.appendLine(`[SETUP] ${tool} of the correct version is not found`);
    vscode.window.showErrorMessage(`Unable to continue. ${tool} not installed. Check output for more info.`);
    return false;
  } else {
    output.appendLine(`[SETUP] ${tool} is not found`);
    output.appendLine(`[SETUP] Follow zephyr getting started guide for how to install ${tool}`);
    vscode.window.showErrorMessage(`Unable to continue. ${tool} not installed. Check output for more info.`);
    return false;
  }
}

export async function checkIfToolsAvailable(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, globalConfig: GlobalConfig, solo = true) {
  if (wsConfig.activeSetupState === undefined) {
    return;
  }
  wsConfig.activeSetupState.toolsAvailable = false;
  saveSetupState(context, wsConfig, globalConfig);
  output.show();

  output.appendLine(
    "Zephyr IDE will now check if build tools are installed and available in system path."
  );

  output.appendLine(
    "Please follow the section Install Dependencies. https://docs.zephyrproject.org/latest/develop/getting_started/index.html#install-dependencies."
  );

  output.appendLine(
    "The remaining sections on that page will automatically be handled by the zephyr tools extension"
  );

  output.appendLine(
    "For Windows you may use Chocolately, for debian you may use apt, and for macOS you may use Homebrew"
  );

  let res = await checkIfToolAvailable("git", "git --version", wsConfig, true);
  if (!res) {
    return false;
  }
  res = await checkIfToolAvailable("python", `${python} --version`, wsConfig, true, "Python 3");
  if (!res) {
    return false;
  }

  res = await checkIfToolAvailable("pip", `${python} -m pip --version`, wsConfig, true);
  if (!res) {
    return false;
  }

  res = await checkIfToolAvailable("python3 venv", `${python} -m venv --help`, wsConfig, false);
  if (!res) {
    return false;
  }

  res = await checkIfToolAvailable("cmake", `cmake --version`, wsConfig, true);
  if (!res) {
    return false;
  }

  res = await checkIfToolAvailable("dtc", "dtc --version", wsConfig, true);
  if (!res) {
    return false;
  }

  wsConfig.activeSetupState.toolsAvailable = true;
  saveSetupState(context, wsConfig, globalConfig);
  if (solo) {
    vscode.window.showInformationMessage("Zephyr IDE: Build Tools are available");
  }

  return true;
}

export function workspaceInit(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, globalConfig: GlobalConfig, progressUpdate: (wsConfig: WorkspaceConfig) => any) {
  vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Zephyr IDE Workspace Initialization',
      cancellable: false,
    },
    async (progress, token) => {
      if (wsConfig.activeSetupState === undefined) {
        return;
      }

      let westInited = await checkWestInit(wsConfig.activeSetupState);
      let westSelection;
      if (!westInited) {
        westSelection = await westSelector(context, wsConfig);
        if (westSelection === undefined || westSelection.failed) {
          vscode.window.showErrorMessage("Zephyr IDE Initialization: Invalid West Init Selection");
          return;
        }
      }

      let toolchainSelection = await pickToolchainTarget(context, globalConfig);
      progress.report({ message: "Checking for Build Tools In Path (1/5)" });
      await checkIfToolsAvailable(context, wsConfig, globalConfig, false);
      progressUpdate(wsConfig);
      if (!wsConfig.activeSetupState.toolsAvailable) {
        vscode.window.showErrorMessage("Zephyr IDE Initialization: Missing Build Tools. See Output. Workspace Init Failed");
        return;
      }
      progress.report({ message: "Setting Up Python Environment (2/5)", increment: 5 });
      await setupWestEnvironment(context, wsConfig, globalConfig, false);
      progressUpdate(wsConfig);
      if (!wsConfig.activeSetupState.pythonEnvironmentSetup) {
        vscode.window.showErrorMessage("Zephyr IDE Initialization Step 2/5: Failed to Create Python Environment");
        return;
      }
      progress.report({ message: "Installing SDK (3/5)", increment: 20 });
      await installSdk(context, globalConfig, output, true, toolchainSelection, false);
      progressUpdate(wsConfig);
      if (!globalConfig.sdkInstalled) {
        vscode.window.showErrorMessage("Zephyr IDE Initialization Step 3/5: Sdk failed to install");
        return;
      }

      progress.report({ message: "Initializing West Respository (4/5)", increment: 20 });
      westInited = await checkWestInit(wsConfig.activeSetupState);

      if (!westInited) {
        let result = await westInit(context, wsConfig, globalConfig, false, westSelection);
        progressUpdate(wsConfig);

        if (result === false) {
          vscode.window.showErrorMessage("Zephyr IDE Initialization Step 4/5: West Failed to initialize");
          return;
        }
      }

      progress.report({ message: "Updating West Repository (5/5)", increment: 30 });
      await westUpdate(context, wsConfig, globalConfig, false);
      progressUpdate(wsConfig);
      if (!wsConfig.activeSetupState.westUpdated) {
        vscode.window.showErrorMessage("Zephyr IDE Initialization Step 5/5: West Failed to update");
        return;
      }
      progress.report({ message: "Zephyr IDE Initialization Complete", increment: 100 });
      progressUpdate(wsConfig);
      vscode.window.showInformationMessage("Zephyr IDE Initialization Complete");
    }
  );
}

export function checkWestInit(setupState: SetupState) {
  let westPath = path.join(setupState.setupPath, ".west");
  let res = fs.pathExistsSync(westPath);
  return res;
}

export async function westInit(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, globalConfig: GlobalConfig, solo = true, westSelection?: WestLocation) {
  if (wsConfig.activeSetupState === undefined || wsConfig.activeSetupState.setupPath === undefined) {
    return;
  }
  let westInited = await checkWestInit(wsConfig.activeSetupState);

  if (westInited) {
    const selection = await vscode.window.showWarningMessage('Zephyr IDE: West already initialized. Call West Update instead. If you would like to reinitialize the .west folder will be deleted', 'Reinitialize', 'Cancel');
    if (selection !== 'Reinitialize') {
      return true;
    }
  }

  if (westSelection === undefined) {
    westSelection = await westSelector(context, wsConfig);
    if (westSelection === undefined || westSelection.failed) {
      return false;
    }
  }

  let westPath = path.join(wsConfig.activeSetupState.setupPath, ".west");

  wsConfig.activeSetupState.westUpdated = false;
  saveSetupState(context, wsConfig, globalConfig);

  // Delete .west if it already exists 
  if ((await fs.pathExists(westPath))) {
    await fs.rmSync(westPath, { recursive: true, force: true });
  }

  const configuration = vscode.workspace.getConfiguration();
  const target = vscode.ConfigurationTarget.Workspace;

  configuration.update('git.enabled', false, target, false);
  configuration.update('git.path', false, target, false);
  configuration.update('git.autofetch', false, target, false);
  configuration.update('git.autorefresh', false, target, false);

  let cmd;
  if (westSelection.gitRepo) {
    cmd = `west init -m ${westSelection.gitRepo} ${westSelection.additionalArgs}`;
  } else if (westSelection.path === undefined) {
    cmd = `west init ${westSelection.additionalArgs}`;
  } else {
    cmd = `west init -l ${westSelection.path} ${westSelection.additionalArgs}`;
  }

  wsConfig.activeSetupState.zephyrDir = ""
  let westInitRes = await executeTaskHelper("Zephyr IDE: West Init", cmd, getShellEnvironment(wsConfig.activeSetupState), wsConfig.activeSetupState.setupPath);

  if (!westInitRes) {
    vscode.window.showErrorMessage("West Init Failed. See terminal for error information.");
  } else {
    if (solo) {
      vscode.window.showInformationMessage(`Successfully Completed West Init`);
    }
    saveSetupState(context, wsConfig, globalConfig);
  }

  configuration.update('git.enabled', undefined, target, false);
  configuration.update('git.path', undefined, target, false);
  configuration.update('git.autofetch', undefined, target, false);
  configuration.update('git.autorefresh', undefined, target, false);
  return westInitRes;
}

export async function setupWestEnvironment(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, globalConfig: GlobalConfig, solo = true) {
  if (wsConfig.activeSetupState === undefined) {
    return;
  }
  let pythonenv = path.join(wsConfig.activeSetupState.setupPath, ".venv");
  let env_exists = await fs.pathExists(pythonenv);

  let westEnvironmentSetup: string | undefined = 'Reinitialize';
  if (wsConfig.activeSetupState.pythonEnvironmentSetup || env_exists) {
    if (env_exists) {
      westEnvironmentSetup = await vscode.window.showWarningMessage('Zephyr IDE: Python Env already exists', 'Use Existing', 'Reinitialize', 'Cancel');
    } else {
      westEnvironmentSetup = await vscode.window.showWarningMessage('Zephyr IDE: Python Env already setup', 'Reinitialize', 'Cancel');
    }

    if (westEnvironmentSetup !== 'Reinitialize' && westEnvironmentSetup !== 'Use Existing') {
      return;
    }
  }

  // Show setup progress..
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Setting up West Python Environment",
      cancellable: false,
    },
    async (progress, token) => {
      if (wsConfig.activeSetupState === undefined) {
        return;
      }
      wsConfig.activeSetupState.pythonEnvironmentSetup = false;
      wsConfig.activeSetupState.env = {};
      saveSetupState(context, wsConfig, globalConfig);

      if (westEnvironmentSetup === "Reinitialize") {
        // Delete python env if it already exists 
        if ((await fs.pathExists(pythonenv))) {
          await fs.rmSync(pythonenv, { recursive: true, force: true });
        }

        // Then create the virtualenv
        let cmd = `${python} -m venv "${pythonenv}"`;
        let res = await executeShellCommand(cmd, wsConfig.activeSetupState.setupPath, getShellEnvironment(wsConfig.activeSetupState), true);
        if (res.stderr) {
          output.appendLine("[SETUP] Unable to create Python Virtual Environment");
          vscode.window.showErrorMessage("Error installing virtualenv. Check output for more info.");
          return;
        } else {
          output.appendLine("[SETUP] Python Virtual Environment created");
        }
      }

      // Report progress
      progress.report({ increment: 5 });

      wsConfig.activeSetupState.env["VIRTUAL_ENV"] = pythonenv;

      // Add env/bin to path
      wsConfig.activeSetupState.env["PATH"] = path.join(pythonenv, `bin${pathdivider}`);
      wsConfig.activeSetupState.env["PATH"] = path.join(path.join(pythonenv, `Scripts${pathdivider}`), pathdivider + wsConfig.activeSetupState.env["PATH"]);

      // Install `west`
      let res = await executeShellCommand(`python -m pip install west`, wsConfig.activeSetupState.setupPath, getShellEnvironment(wsConfig.activeSetupState), true);
      if (res.stdout) {
        output.append(res.stdout);
        output.appendLine("[SETUP] west installed");
      } else {
        output.appendLine("[SETUP] Unable to install west");
        vscode.window.showErrorMessage("Error installing west. Check output for more info.");
        return;
      }

      output.appendLine("[SETUP] West Python Environment Setup complete!");

      // Setup flag complete
      wsConfig.activeSetupState.pythonEnvironmentSetup = true;
      saveSetupState(context, wsConfig, globalConfig);

      progress.report({ increment: 100 });
      if (solo) {
        vscode.window.showInformationMessage(`Zephyr IDE: West Python Environment Setup!`);
      }
    }
  );
};


export async function westUpdate(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, globalConfig: GlobalConfig, solo = true) {
  if (wsConfig.activeSetupState === undefined) {
    return;
  }
  // Get the active workspace root path
  if (solo) {
    vscode.window.showInformationMessage(`Zephyr IDE: West Update`);
  }

  let westUpdateRes = await executeTaskHelper("Zephyr IDE: West Update", `west update`, getShellEnvironment(wsConfig.activeSetupState), wsConfig.activeSetupState.setupPath);
  if (!westUpdateRes) {
    vscode.window.showErrorMessage("West Update Failed. Check output for more info.");
    return false;
  }

  // Get zephyr BASE
  let base = undefined;

  // Get listofports
  let cmd = `west list -f {path:28} zephyr`;
  let res = await executeShellCommand(cmd, wsConfig.activeSetupState.setupPath, getShellEnvironment(wsConfig.activeSetupState), true);
  if (res.stdout && res.stdout.includes("zephyr")) {
    base = res.stdout.trim();
  }

  if (base) {
    wsConfig.activeSetupState.zephyrDir = path.join(wsConfig.activeSetupState.setupPath, base);
  } else {
    vscode.window.showErrorMessage("West Update Failed. Could not find Zephyr Directory.");
    return;
  }


  if (!wsConfig.activeSetupState.zephyrDir) {
    vscode.window.showErrorMessage("West Update Failed. Missing zephyr base directory.");
    return false;
  }

  cmd = `pip install -r ${path.join(wsConfig.activeSetupState.zephyrDir, "scripts", "requirements.txt")}`;
  let pipInstallRes = await executeTaskHelper("Zephyr IDE: West Update", cmd, getShellEnvironment(wsConfig.activeSetupState), wsConfig.activeSetupState.setupPath);
  if (!pipInstallRes) {
    vscode.window.showErrorMessage("West Update Failed. Error installing python requirements.");
    return false;
  }
  cmd = `pip install -U dtsh`;
  let dtshInstallRes = await executeTaskHelper("Zephyr IDE: West Update", cmd, getShellEnvironment(wsConfig.activeSetupState), wsConfig.activeSetupState.setupPath);
  if (!dtshInstallRes) {
    vscode.window.showWarningMessage("Failed to install dtsh");
  }

  wsConfig.initialSetupComplete = true;
  wsConfig.activeSetupState.westUpdated = true;
  saveSetupState(context, wsConfig, globalConfig);
  setWorkspaceState(context, wsConfig);
  if (solo) {
    vscode.window.showInformationMessage("Zephyr IDE: West Update Complete");
  }
  return true;
}
