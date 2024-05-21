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

import { installSdk } from "../setup_utilities/download";
import { getRootPath, getShellEnvironment, output, executeTask, executeShellCommand } from "../utilities/utils";
import { ProjectConfig } from "../project_utilities/project";

import { westSelector, WestLocation } from "./west_selector";
type ToolChainPath = { [Name: string]: string };
export type ProjectConfigDictionary = { [name: string]: ProjectConfig };

export interface WorkspaceConfig {
  rootPath: string;
  env: { [name: string]: string | undefined };
  projects: ProjectConfigDictionary;
  activeProject?: string;
  zephyrDir: string | undefined;
  initialSetupComplete: boolean,
  toolsAvailable: boolean,
  pythonEnvironmentSetup: boolean,
  westInited: boolean;
  westUpdated: boolean;
  sdkInstalled: boolean;
  automaticProjectSelction: boolean;
  toolchains: ToolChainPath;
  onlyArm: boolean,
  armGdbPath: string | undefined
}

export async function loadProjectsFromFile(config: WorkspaceConfig) {
  const configuration = await vscode.workspace.getConfiguration();
  let useExternalJson: boolean | undefined = await configuration.get("zephyr-ide.use-zephyr-ide-json");
  if (useExternalJson) {
    const zephyrIdeSettingFilePath = path.join(config.rootPath, ".vscode/zephyr-ide.json");
    try {
      if (!fs.pathExistsSync(zephyrIdeSettingFilePath)) {
        await fs.writeFile(zephyrIdeSettingFilePath, JSON.stringify({}, null, 2), { flag: 'w+' }, function (err: any) {
          if (err) { throw err; }
          console.log('Created zephyr-ide file');
        }
        );
      } else {
        var object = await JSON.parse(fs.readFileSync(zephyrIdeSettingFilePath, 'utf8'));
        let projects = object.projects;
        config.projects = {};
        if (projects) {
          for (let key in projects) {

            for (let buildKey in projects[key].buildConfigs) {
              if (projects[key].buildConfigs[buildKey].relBoardSubDir === undefined) {
                projects[key].buildConfigs[buildKey].relBoardSubDir = path.join("arm", projects[key].buildConfigs[buildKey].board);
              }
            }
            config.projects[key] = projects[key];
          }
        }
      }
    } catch (error) {
      console.error("Failed to load .vscode/zephyr-ide.json");
      console.error(error);
    }
  } else {
    let temp: ProjectConfigDictionary | undefined = await configuration.get("zephyr-ide.projects");
    temp = JSON.parse(JSON.stringify(temp));
    if (temp) {
      config.projects = {};
      for (let key in temp) {
        for (let buildKey in temp[key].buildConfigs) {
          if (temp[key].buildConfigs[buildKey].relBoardSubDir === undefined) {
            temp[key].buildConfigs[buildKey].relBoardSubDir = path.join("arm", temp[key].buildConfigs[buildKey].board);
          }
        }
        config.projects[key] = temp[key];
      }
    }
  }
}

export async function loadWorkspaceState(context: vscode.ExtensionContext): Promise<WorkspaceConfig> {
  let rootPath = getRootPath()?.fsPath;
  if (!rootPath) {
    rootPath = "";
  }

  let config: WorkspaceConfig = await context.workspaceState.get("zephyr.env") ?? {
    rootPath: rootPath,
    env: {},
    projects: {},
    automaticProjectSelction: true,
    pythonEnvironmentSetup: false,
    westInited: false,
    westUpdated: false,
    toolsAvailable: false,
    zephyrDir: undefined,
    sdkInstalled: false,
    initialSetupComplete: false,
    toolchains: {},
    armGdbPath: undefined,
    onlyArm: true,
  };

  loadProjectsFromFile(config);
  return config;
}

export async function setWorkspaceState(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig) {
  const configuration = await vscode.workspace.getConfiguration();
  let useExternalJson: boolean | undefined = await configuration.get("zephyr-ide.use-zephyr-ide-json");
  if (useExternalJson) {
    fs.writeFile(path.join(wsConfig.rootPath, ".vscode/zephyr-ide.json"), JSON.stringify({ projects: wsConfig.projects }, null, 2), { flag: 'w+' }, function (err: any) {
      if (err) { throw err; }
      console.log('complete');
    });
  } else {
    await configuration.update('zephyr-ide.projects', wsConfig.projects, false);
  }

  await context.workspaceState.update("zephyr.env", wsConfig);
}

export async function clearWorkspaceState(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig) {
  wsConfig.env = {};
  wsConfig.automaticProjectSelction = true;
  wsConfig.pythonEnvironmentSetup = false;
  wsConfig.westInited = false;
  wsConfig.westUpdated = false;
  wsConfig.toolsAvailable = false;
  wsConfig.zephyrDir = undefined;
  wsConfig.sdkInstalled = false;
  wsConfig.initialSetupComplete = false;
  wsConfig.toolchains = {};
  wsConfig.armGdbPath = undefined;
  wsConfig.onlyArm = true;
  setWorkspaceState(context, wsConfig);
}

let toolsfoldername = ".zephyr_ide";
let python = os.platform() === "win32" ? "python" : "python3";
export let pathdivider = os.platform() === "win32" ? ";" : ":";


// Important directories
export let toolsdir = path.join(os.homedir(), toolsfoldername);
export let toolchainDir = path.join(toolsdir, "toolchains");

export async function checkIfToolAvailable(tool: string, cmd: string, wsConfig: WorkspaceConfig, printStdOut: boolean, includes?: string) {
  let res = await executeShellCommand(cmd, wsConfig.rootPath, getShellEnvironment(wsConfig), true);
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

export async function checkIfToolsAvailable(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, solo = true) {
  wsConfig.toolsAvailable = false;
  setWorkspaceState(context, wsConfig);
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

  wsConfig.toolsAvailable = true;
  setWorkspaceState(context, wsConfig);
  if (solo) {
    vscode.window.showInformationMessage("Zephyr IDE: Build Tools are available");
  }

  return true;
}

export function workspaceInit(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, progressUpdate: (wsConfig: WorkspaceConfig) => any) {
  vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Zephyr IDE Workspace Initialzation',
      cancellable: false,
    },
    async (progress, token) => {
      let westSelection = await westSelector(context, wsConfig);
      if (westSelection === undefined || westSelection.failed) {
        return;
      }

      progress.report({ message: "Checking for Build Tools In Path (1/5)" });
      await checkIfToolsAvailable(context, wsConfig, false);
      progressUpdate(wsConfig);
      if (!wsConfig.toolsAvailable) {
        vscode.window.showErrorMessage("Zephyr IDE Initialization: Missing Build Tools. See Output. Workspace Init Failed");
        return;
      }
      progress.report({ message: "Setting Up Python Environment (2/5)", increment: 5 });
      await setupWestEnvironment(context, wsConfig, false);
      progressUpdate(wsConfig);
      if (!wsConfig.pythonEnvironmentSetup) {
        vscode.window.showErrorMessage("Zephyr IDE Initialization Step 2/5: Failed to Create Python Environment");
        return;
      }
      progress.report({ message: "Installing SDK (3/5)", increment: 20 });
      await installSdk(context, wsConfig, output, true, false);
      progressUpdate(wsConfig);
      if (!wsConfig.sdkInstalled) {
        vscode.window.showErrorMessage("Zephyr IDE Initialization Step 3/5: Sdk failed to install");
        return;
      }
      progress.report({ message: "Initializing West Respository (4/5)", increment: 20 });
      let result = await westInit(context, wsConfig, false, westSelection);
      progressUpdate(wsConfig);
      if (result === false || !wsConfig.westInited) {
        vscode.window.showErrorMessage("Zephyr IDE Initialization Step 4/5: West Failed to initialize");
        return;
      }
      progress.report({ message: "Updating West Repository (5/5)", increment: 30 });
      await westUpdate(context, wsConfig, false);
      progressUpdate(wsConfig);
      if (!wsConfig.westUpdated) {
        vscode.window.showErrorMessage("Zephyr IDE Initialization Step 5/5: West Failed to update");
        return;
      }
      progress.report({ message: "Zephyr IDE Initialization Complete", increment: 100 });
      progressUpdate(wsConfig);
      vscode.window.showInformationMessage("Zephyr IDE Initialization Complete");
    }
  );
}

export async function westInit(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, solo = true, westSelection?: WestLocation) {
  if (wsConfig.westInited) {
    const selection = await vscode.window.showWarningMessage('Zephyr IDE: West already initialized. Call West Update instead. If you would like to reinitialize delete the .west folder first', 'Reinitialize', 'Cancel');
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

  if (westSelection.markAsInitialized === true) {
    wsConfig.westInited = true;
    setWorkspaceState(context, wsConfig);
    return true;
  }

  let westPath = path.join(wsConfig.rootPath, ".west");

  wsConfig.westInited = false;
  wsConfig.westUpdated = false;
  setWorkspaceState(context, wsConfig);

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

  // Tasks
  let taskName = "Zephyr IDE: West Init";
  let options: vscode.ShellExecutionOptions = {
    env: <{ [key: string]: string }>getShellEnvironment(wsConfig)
  };

  let cmd;
  if (westSelection.path === undefined) {
    cmd = `west init`;
  } else {
    cmd = `west init -l ${westSelection.path}`;
  }
  let exec = new vscode.ShellExecution(cmd, options);

  // Task
  let task = new vscode.Task(
    { type: "zephyr-ide", command: taskName },
    vscode.TaskScope.Workspace,
    taskName,
    "zephyr-ide",
    exec
  );

  await executeTask(task);

  //should check if task has executed properly before calling the below functions
  wsConfig.westInited = true;
  setWorkspaceState(context, wsConfig);

  configuration.update('git.enabled', undefined, target, false);
  configuration.update('git.path', undefined, target, false);
  configuration.update('git.autofetch', undefined, target, false);
  configuration.update('git.autorefresh', undefined, target, false);

  if (solo) {
    vscode.window.showInformationMessage(`Successfully Completed West Init`);
  }
  return true;
}

export async function setupWestEnvironment(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, solo = true) {
  if (wsConfig.pythonEnvironmentSetup) {
    const selection = await vscode.window.showWarningMessage('Zephyr IDE: West Python Env already initialized', 'Reinitialize', 'Cancel');
    if (selection !== 'Reinitialize') {
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
      let pythonenv = path.join(wsConfig.rootPath, ".venv");

      wsConfig.pythonEnvironmentSetup = false;
      wsConfig.env = {};
      setWorkspaceState(context, wsConfig);

      // Delete python env if it already exists 
      if ((await fs.pathExists(pythonenv))) {
        await fs.rmSync(pythonenv, { recursive: true, force: true });
      }

      // Then create the virtualenv
      let cmd = `${python} -m venv "${pythonenv}"`;
      let res = await executeShellCommand(cmd, wsConfig.rootPath, getShellEnvironment(wsConfig), true);
      if (res.stderr) {
        output.appendLine("[SETUP] Unable to create Python Virtual Environment");
        vscode.window.showErrorMessage("Error installing virtualenv. Check output for more info.");
        return;
      } else {
        output.appendLine("[SETUP] Python Virtual Environment created");
      }

      // Report progress
      progress.report({ increment: 5 });

      wsConfig.env["VIRTUAL_ENV"] = pythonenv;

      // Add env/bin to path
      wsConfig.env["PATH"] = path.join(pythonenv, `bin${pathdivider}`);
      wsConfig.env["PATH"] = path.join(path.join(pythonenv, `Scripts${pathdivider}`), pathdivider + wsConfig.env["PATH"]);

      // Install `west`
      res = await executeShellCommand(`${python} -m pip install west`, wsConfig.rootPath, getShellEnvironment(wsConfig), true);
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
      wsConfig.pythonEnvironmentSetup = true;
      setWorkspaceState(context, wsConfig);

      progress.report({ increment: 100 });
      if (solo) {
        vscode.window.showInformationMessage(`Zephyr IDE: West Python Environment Setup!`);
      }
    }
  );
};


export async function westUpdate(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, solo = true) {
  // Get the active workspace root path
  if (solo) {
    vscode.window.showInformationMessage(`Zephyr IDE: West Update`);
  }

  // Options for Shell Execution
  let options: vscode.ShellExecutionOptions = {
    env: <{ [key: string]: string }>getShellEnvironment(wsConfig),
    cwd: wsConfig.rootPath,
  };

  // Tasks
  let taskName = "Zephyr IDE: Update West";

  // Enable python env
  let cmd = `west update`;
  let exec = new vscode.ShellExecution(cmd, options);

  // Task
  let task = new vscode.Task(
    { type: "zephyr-ide", command: taskName },
    vscode.TaskScope.Workspace,
    taskName,
    "zephyr-ide",
    exec
  );

  await executeTask(task).then(
    execution => {
      return true;
    },
    error => {
      output.append(error.stdout);
      output.append(error.stderr);
      vscode.window.showErrorMessage("West Update Failed. Check output for more info.");
      return false;
    },
  );

  // Get zephyr BASE
  let base = undefined;

  // Get listofports
  cmd = `west list -f {path:28} zephyr`;
  let res = await executeShellCommand(cmd, wsConfig.rootPath, getShellEnvironment(wsConfig), true);
  if (res.stdout && res.stdout.includes("zephyr")) {
    base = res.stdout.trim();
  }

  if (base) {
    wsConfig.zephyrDir = path.join(wsConfig.rootPath, base);
    wsConfig.env["ZEPHYR_BASE"] = wsConfig.zephyrDir;
  } else {
    vscode.window.showErrorMessage("West Update Failed. Could not find Zephyr Directory.");
    return;
  }


  if (!wsConfig.zephyrDir) {
    vscode.window.showErrorMessage("West Update Failed. Missing zephyr base directory.");
    return false;
  }

  // Install python dependencies `pip install -r zephyr/requirements.txt`
  cmd = `pip install -r ${path.join(wsConfig.zephyrDir, "scripts", "requirements.txt")}`;
  exec = new vscode.ShellExecution(cmd, options);

  // Task
  task = new vscode.Task(
    { type: "zephyr-ide", command: taskName },
    vscode.TaskScope.Workspace,
    taskName,
    "zephyr-ide",
    exec
  );

  let res1 = await executeTask(task).then(
    execution => {
      return true;
    },
    error => {
      output.append(error.stdout);
      output.append(error.stderr);
      vscode.window.showErrorMessage("West Update Failed. Check output for more info.");
      return false;
    },
  );

  if (res1) {
    wsConfig.initialSetupComplete = true;
    wsConfig.westUpdated = true;
    setWorkspaceState(context, wsConfig);
    if (solo) {
      vscode.window.showInformationMessage("Zephyr IDE: West Update Complete");
    }
    return true;
  }

  return false;
}
