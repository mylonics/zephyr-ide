/**
 * @author Jared Wolff <jared@circuitdojo.org>
 * @copyright Circuit Dojo LLC
 * @license Apache 2.0
 */

/*
Modifications Copyright 2024 mylonics 
Author Rijesh Augustine

Code based on https://github.com/circuitdojo/zephyr-tools/extension.ts.
Majority of the file has been changed, but the download and install of sdks 
and checking if build tools are available have been retained.

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

// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import * as cp from "child_process";
import * as util from "util";
import * as os from "os";
import * as fs from "fs-extra";
import * as path from "path";
import * as unzip from "node-stream-zip";
import * as sevenzip from "7zip-bin";
import * as node7zip from "node-7z";
import { compareVersions } from 'compare-versions';

import { FileDownload } from "../setup_utilities/download";
import { getRootPath, getShellEnvironment, output, executeTask } from "../utilities/utils";
import { ProjectConfig } from "../project_utilities/project";

import { westSelector, WestLocation } from "./west_selector";
type ToolChainPath = { [Name: string]: string };
export type ProjectConfigDictionary = { [name: string]: ProjectConfig };

// Config for the extension
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

type CmdEntry = {
  cmd: string;
  usepath: boolean;
};

type DownloadEntry = {
  name: string;
  url: string;
  md5: string;
  cmd?: CmdEntry[];
  filename: string;
  clearTarget?: boolean;
};

// Platform
let platform: NodeJS.Platform = os.platform();

// Arch
let arch: string = os.arch();

// Platform dependant variables
let toolsfoldername = ".zephyr_ide";
let python = "python3";
export let pathdivider = ":";
let which = "which";

switch (platform) {
  case "win32":
    python = "python";
    pathdivider = ";";
    which = "where";
    break;
  default:
    break;
}

// Important directories
let toolsdir = path.join(os.homedir(), toolsfoldername);
export let toolchainDir = path.join(toolsdir, "toolchains");

export function getPlatformName() {
  // Determine what sdk/toolchain to download
  switch (platform) {
    case "darwin":
      return "macos";
    case "linux":
      return "linux";
    case "win32":
      return "windows";
  }
  return;

}

export function getPlatformArch() {
  switch (arch) {
    case "x64":
      return "x86_64";
    case "arm64":
      return "aarch64";
  }
  return;
}

export async function pickToolchainTarget() {
  const toolchainTargets: vscode.QuickPickItem[] = [
    { label: "arm" },
    { label: "sep", kind: vscode.QuickPickItemKind.Separator },
    { label: "aarch64" },
    { label: "arc" },
    { label: "arc64" },
    { label: "microblazeel" },
    { label: "mips" },
    { label: "nios2" },
    { label: "riscv64" },
    { label: "sparc" },
    { label: "x86_64" },
    { label: "xtensa-dc233c" },
    { label: "xtensa-espressif_esp32" },
    { label: "xtensa-espressif_esp32s2" },
    { label: "xtensa-espressif_esp32s3" },
    { label: "xtensa-intel_ace15_mtpm" },
    { label: "xtensa-intel_tgl_adsp" },
    { label: "xtensa-mtk_mt8195_adsp" },
    { label: "xtensa-nxp_imx8m_adsp" },
    { label: "xtensa-nxp_imx8ulp_adsp" },
    { label: "xtensa-nxp_imx_adsp" },
    { label: "xtensa-nxp_rt500_adsp" },
    { label: "xtensa-nxp_rt600_adsp" },
    { label: "xtensa-sample_controller" }];

  const pickOptions: vscode.QuickPickOptions = {
    ignoreFocusOut: true,
    placeHolder: "Select Toolchain Target Architecture",
  };

  let selectedToolchainTarget = await vscode.window.showQuickPick(toolchainTargets, pickOptions);
  if (selectedToolchainTarget) {
    return selectedToolchainTarget.label;
  }
}

export async function checkIfToolsAvailable(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, solo = true) {
  wsConfig.toolsAvailable = false;
  setWorkspaceState(context, wsConfig);

  // Clear output before beginning
  output.clear();
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

  // check if directory in $HOME exists
  let exists = await fs.pathExists(toolsdir);
  if (!exists) {
    console.log("toolsdir not found");
    // Otherwise create home directory
    await fs.mkdirp(toolsdir);
  }

  // Promisified exec
  let exec = util.promisify(cp.exec);

  // Check if Git exists in path
  let res = await exec("git --version").then(
    value => {
      output.append(value.stdout);
      output.append(value.stderr);
      output.appendLine("[SETUP] git installed");
      return true;
    },
    reason => {
      output.appendLine("[SETUP] git is not found");
      output.append(reason);

      switch (platform) {
        case "darwin":
          output.appendLine("[SETUP] use `brew` to install `git`");
          output.appendLine("[SETUP] Install `brew` first: https://brew.sh");
          output.appendLine("[SETUP] Then run `brew install git`");
          break;
        case "linux":
          output.appendLine("[SETUP] refer to your distros preferred `git` install method.");
          break;
        default:
          break;
      }

      // Error message
      vscode.window.showErrorMessage("Unable to continue. Git not installed. Check output for more info.");
      return false;
    }
  );

  // Return if error
  if (!res) {
    return;
  }


  // Otherwise, check Python install
  let cmd = `${python} --version`;
  output.appendLine(cmd);
  res = await exec(cmd).then(
    value => {
      if (value.stdout.includes("Python 3")) {
        output.appendLine("[SETUP] python3 found");
      } else {
        output.appendLine("[SETUP] python3 not found");

        switch (platform) {
          case "darwin":
            output.appendLine("[SETUP] use `brew` to install `python3`");
            output.appendLine("[SETUP] Install `brew` first: https://brew.sh");
            output.appendLine("[SETUP] Then run `brew install python3`");
            break;
          case "linux":
            output.appendLine(
              "[SETUP] install `python` using `apt get install python3.10 python3.10-pip python3.10-venv`"
            );
            break;
          default:
            break;
        }

        vscode.window.showErrorMessage("Error finding python. Check output for more info.");
        return false;
      }

      return true;
    },
    reason => {
      output.append(reason.stderr);
      console.error(reason);

      // Error message
      switch (platform) {
        case "darwin":
          output.appendLine("[SETUP] use `brew` to install `python3`");
          output.appendLine("[SETUP] Install `brew` first: https://brew.sh");
          output.appendLine("[SETUP] Then run `brew install python3`");
          break;
        case "linux":
          output.appendLine(
            "[SETUP] install `python` using `apt get install python3.10 python3.10-pip python3.10-venv`"
          );
          break;
        default:
          break;
      }
      return false;
    }
  );

  // Return if error
  if (!res) {
    return;
  }


  // Check for `pip`
  cmd = `${python} -m pip --version`;
  output.appendLine(cmd);
  res = await exec(cmd).then(
    value => {
      output.append(value.stdout);
      output.append(value.stderr);
      output.appendLine("[SETUP] pip installed");
      return true;
    },
    reason => {
      output.append(reason.stderr);
      console.error(reason);

      // Error message

      // Error message
      switch (platform) {
        case "linux":
          output.appendLine("[SETUP] please install `python3.10-pip` package (or newer)");
          break;
        default:
          output.appendLine("[SETUP] please install `python3` with `pip` support");
          break;
      }
      return false;
    }
  );

  // Return if error
  if (!res) {
    return;
  }

  // Check if venv is available
  cmd = `${python} -m venv --help`;
  output.appendLine(cmd);
  res = await exec(cmd).then(
    value => {
      output.appendLine("[SETUP] python3 venv OK");
      return true;
    },
    reason => {
      output.append(reason.stderr);
      console.error(reason);

      // Error message
      switch (platform) {
        case "linux":
          output.appendLine("[SETUP] please install `python3.10-venv` package (or newer)");
          break;
        default:
          output.appendLine("[SETUP] please install `python3` with `venv` support");
          break;
      }

      return false;
    }
  );

  // Return if error
  if (!res) {
    return;
  }


  // Check if Git exists in path
  res = await exec("cmake --version").then(
    value => {
      output.append(value.stdout);
      output.append(value.stderr);
      output.appendLine("[SETUP] cmake installed");
      return true;
    },
    reason => {
      output.appendLine("[SETUP] cmake is not found");
      output.append(reason);

      switch (platform) {
        case "darwin":
          output.appendLine("[SETUP] use `brew` to install `cmake`");
          output.appendLine("[SETUP] Install `brew` first: https://brew.sh");
          output.appendLine("[SETUP] Then run `brew install cmake`");
          break;
        case "linux":
          output.appendLine("[SETUP] refer to your distros preferred `cmake` install method.");
          break;
        default:
          break;
      }

      // Error message
      vscode.window.showErrorMessage("Unable to continue. cmake not installed. Check output for more info.");
      return false;
    }
  );

  // Return if error
  if (!res) {
    return;
  }


  // Check if Git exists in path
  res = await exec("dtc --version").then(
    value => {
      output.append(value.stdout);
      output.append(value.stderr);
      output.appendLine("[SETUP] dtc installed");
      return true;
    },
    reason => {
      output.appendLine("[SETUP] dtc is not found");
      output.append(reason);

      switch (platform) {
        case "darwin":
          output.appendLine("[SETUP] use `brew` to install `dtc`");
          output.appendLine("[SETUP] Install `brew` first: https://brew.sh");
          output.appendLine("[SETUP] Then run `brew install dtc`");
          break;
        case "linux":
          output.appendLine("[SETUP] refer to your distros preferred `dtc` install method.");
          break;
        default:
          break;
      }

      // Error message
      vscode.window.showErrorMessage("Unable to continue. dtc not installed. Check output for more info.");
      return false;
    }
  );

  // Return if error
  if (!res) {
    return;
  }

  wsConfig.toolsAvailable = true;
  setWorkspaceState(context, wsConfig);
  if (solo) {
    vscode.window.showInformationMessage("Zephyr IDE: Build Tools are available");
  }

  return;
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
      let ans = progressUpdate(wsConfig);
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
      await installSdk(context, wsConfig, true, false);
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
    const selection = await vscode.window.showWarningMessage('Zephyr IDE: Python Env already initialized', 'Reinitialize', 'Cancel');
    if (selection !== 'Reinitialize') {
      return;
    }
  }

  // Show setup progress..
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Setting up Zephyr Environment",
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
      let exec = util.promisify(cp.exec);

      output.appendLine(cmd);
      let res = await exec(cmd).then(
        value => {
          output.append(value.stdout);
          output.appendLine("[SETUP] virtual python environment created");
          return true;
        },
        reason => {
          output.appendLine("[SETUP] unable to setup virtualenv");
          console.error(reason);

          // Error message
          vscode.window.showErrorMessage("Error installing virtualenv. Check output for more info.");
          return false;
        }
      );

      // Return if error
      if (!res) {
        return;
      }

      // Report progress
      progress.report({ increment: 5 });

      wsConfig.env["VIRTUAL_ENV"] = pythonenv;

      // Add env/bin to path
      wsConfig.env["PATH"] = path.join(pythonenv, `bin${pathdivider}`);
      wsConfig.env["PATH"] = path.join(path.join(pythonenv, `Scripts${pathdivider}`), pathdivider + wsConfig.env["PATH"]);

      // Install `west`
      res = await exec(`${python} -m pip install west`, {
        env: getShellEnvironment(wsConfig),
      }).then(
        value => {
          output.append(value.stdout);
          output.append(value.stderr);
          output.appendLine("[SETUP] west installed");
          return true;
        },
        reason => {
          output.appendLine("[SETUP] unable to install west");
          output.append(JSON.stringify(reason));

          // Error message
          vscode.window.showErrorMessage("Error installing west. Check output for more info.");
          return false;
        }
      );

      // Return if error
      if (!res) {
        return;
      }

      output.appendLine("[SETUP] Zephyr setup complete!");

      // Setup flag complete
      wsConfig.pythonEnvironmentSetup = true;
      setWorkspaceState(context, wsConfig);

      progress.report({ increment: 100 });
      if (solo) {
        vscode.window.showInformationMessage(`Zephyr IDE: Python Environment Setup!`);
      }
    }
  );
};

export async function installSdk(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, installLatestArm = false, solo = true) {
  // Show setup progress..
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Setting up Zephyr sdk",
      cancellable: false,
    },
    async (progress, token) => {
      // Clear output before beginning
      output.clear();
      output.show();

      progress.report({ increment: 5 });

      // Skip out if not found
      if (getPlatformName() === undefined) {
        vscode.window.showErrorMessage("Unsupported platform for Zephyr IDE!");
        return;
      }

      let toolchainVersionList: string[] = [];
      let toolchainMd5Path = context.asAbsolutePath("manifest/sdk_md5");
      let toolchainMd5Files = await vscode.workspace.fs.readDirectory(vscode.Uri.file(toolchainMd5Path));
      for (const [index, [filename, type]] of toolchainMd5Files.entries()) {
        if (path.parse(filename).ext === ".sum") {
          toolchainVersionList.push(path.parse(filename).name);
        }
      }

      toolchainVersionList = toolchainVersionList.sort(compareVersions).reverse();
      let toolchainSelection: string | undefined = toolchainVersionList[0];
      let toolchainTargetArch = "arm";
      if (!installLatestArm) {
        // Pick options
        const pickOptions: vscode.QuickPickOptions = {
          ignoreFocusOut: true,
          placeHolder: "Which toolchain version would you like to install?",
        };
        toolchainSelection = await vscode.window.showQuickPick(toolchainVersionList, pickOptions);
        let targ = await pickToolchainTarget();
        if (targ) {
          toolchainTargetArch = targ;
        } else {
          return;
        }
      }

      // Check if user canceled
      if (toolchainSelection === undefined) {
        vscode.window.showErrorMessage("Zephyr IDE Setup canceled.");
        return;
      }

      wsConfig.sdkInstalled = false;
      setWorkspaceState(context, wsConfig);

      let selectedToolchainFile = context.asAbsolutePath("manifest/sdk_md5/" + toolchainSelection + ".sum");

      // Set up downloader path
      FileDownload.init(path.join(toolsdir, "downloads"));

      let toolchainFileRawText = fs.readFileSync(selectedToolchainFile, 'utf8');
      let toolchainMinimalDownloadEntry: DownloadEntry | undefined;
      let toolchainArmDownloadEntry: DownloadEntry | undefined;

      let toolchainBasePath = "toolchains/zephyr-sdk-" + toolchainSelection;
      for (const line of toolchainFileRawText.trim().split('\n')) {
        let s = line.trim().split(/[\s\s]+/g);
        let md5 = s[0];
        let fileName = s[1];
        let parsedFileName = path.parse(fileName);
        if (parsedFileName.ext === ".xz") {
          parsedFileName = path.parse(parsedFileName.name);
        }

        if (parsedFileName.name === "zephyr-sdk-" + toolchainSelection + "_" + getPlatformName() + "-" + getPlatformArch() + "_minimal") {
          toolchainMinimalDownloadEntry = {
            "name": "toolchains",
            "filename": fileName,
            "url": "https://github.com/zephyrproject-rtos/sdk-ng/releases/download/v" + toolchainSelection + "/" + fileName,
            "md5": md5,
            "clearTarget": true,
          };
          if (getPlatformName() === "macos") {
            toolchainMinimalDownloadEntry.cmd = [{
              "cmd": "zephyr-sdk-" + toolchainSelection + "/setup.sh -t " + toolchainTargetArch + "-zephyr-" + (toolchainTargetArch === "arm" ? "eabi" : "elf"),
              "usepath": true
            }];
          }
        } else if (parsedFileName.name === "toolchain_" + getPlatformName() + "-" + getPlatformArch() + "_" + toolchainTargetArch + "-zephyr-" + (toolchainTargetArch === "arm" ? "eabi" : "elf")) {
          toolchainArmDownloadEntry = {
            "name": toolchainBasePath,
            "filename": fileName,
            "url": "https://github.com/zephyrproject-rtos/sdk-ng/releases/download/v" + toolchainSelection + "/" + fileName,
            "md5": md5,
            "clearTarget": false,
          };
        }
      }


      if (toolchainArmDownloadEntry === undefined || toolchainMinimalDownloadEntry === undefined) {
        vscode.window.showErrorMessage("Error finding appropriate toolchain file");
        return;
      }

      // Output indicating toolchain install
      output.appendLine(`[SETUP] Installing zephyr-sdk-${toolchainSelection} toolchain...`);

      // Download minimal sdk file
      let res: boolean = await processDownload(toolchainMinimalDownloadEntry, output, wsConfig);
      if (!res) {
        vscode.window.showErrorMessage("Error downloading minimal toolchain file. Check output for more info.");
        return;
      }
      progress.report({ increment: 5 });

      // Download arm sdk file
      res = await processDownload(toolchainArmDownloadEntry, output, wsConfig);
      if (!res) {
        vscode.window.showErrorMessage("Error downloading arm toolchain file. Check output for more info.");
        return;
      }
      progress.report({ increment: 10 });

      // Setup flag complete
      wsConfig.toolchains[toolchainSelection] = path.join(toolsdir, toolchainBasePath);

      progress.report({ increment: 100 });
      output.appendLine(`[SETUP] Installing zephyr-sdk-${toolchainSelection} complete`);

      if (toolchainTargetArch !== "arm") {
        wsConfig.onlyArm = false;
      }
      wsConfig.armGdbPath = path.join(toolsdir, toolchainBasePath, "arm-zephyr-eabi\\bin\\arm-zephyr-eabi-gdb");
      wsConfig.sdkInstalled = true;
      await setWorkspaceState(context, wsConfig);
      if (solo) {
        vscode.window.showInformationMessage(`Zephyr IDE: Toolchain Setup Complete!`);
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
  let getZephyrDirExec = util.promisify(cp.exec);

  // Get listofports
  cmd = `west list -f {path:28} zephyr`;
  let cwd = wsConfig.rootPath;
  let res = await getZephyrDirExec(cmd, { env: getShellEnvironment(wsConfig), cwd: cwd });
  if (res.stderr) {
    output.append(res.stderr);
    output.show();
  } else {
    if (res.stdout.includes("zephyr")) {
      base = res.stdout.trim();
    }
  }

  if (base) {
    wsConfig.zephyrDir = path.join(wsConfig.rootPath, base);
    wsConfig.env["ZEPHYR_BASE"] = wsConfig.zephyrDir;
  } else {
    vscode.window.showErrorMessage("West Init Failed. Could not find Zephyr Directory.");
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

async function processDownload(download: DownloadEntry, output: vscode.OutputChannel, wsConfig: WorkspaceConfig) {
  // Promisified exec
  let exec = util.promisify(cp.exec);

  // Check if it already exists
  let filepath = await FileDownload.exists(download.filename);

  // Download if doesn't exist _or_ hash doesn't match
  if (filepath === null || (await FileDownload.check(download.filename, download.md5)) === false) {
    output.appendLine("[SETUP] downloading " + download.url);
    filepath = await FileDownload.fetch(download.url);

    // Check again
    if ((await FileDownload.check(download.filename, download.md5)) === false) {
      vscode.window.showErrorMessage("Error downloading " + download.filename + ". Checksum mismatch.");
      return false;
    }
  }

  // Get the path to copy the contents to..
  let copytopath = path.join(toolsdir, download.name);

  // Check if copytopath exists and create if not
  if (!(await fs.pathExists(copytopath))) {
    await fs.mkdirp(copytopath);
  }

  // Unpack and place into `$HOME/.zephyr_ide`
  if (download.url.includes(".zip")) {
    // Unzip and copy
    output.appendLine(`[SETUP] unzip ${filepath} to ${copytopath}`);
    const zip = new unzip.async({ file: filepath });
    zip.on("extract", (entry, file) => {
      // Make executable
      fs.chmodSync(file, 0o755);
    });
    await zip.extract(null, copytopath);
    await zip.close();
  } else if (download.url.includes("tar")) {
    // Then untar
    const cmd = `tar -xvf "${filepath}" -C "${copytopath}"`;
    output.appendLine(cmd);
    let res = await exec(cmd, { env: getShellEnvironment(wsConfig) }).then(
      value => {
        output.append(value.stdout);
        return true;
      },
      reason => {
        output.append(reason.stdout);
        output.append(reason.stderr);

        // Error message
        vscode.window.showErrorMessage("Error un-tar of download. Check output for more info.");

        return false;
      }
    );

    // Return if untar was unsuccessful
    if (!res) {
      return false;
    }
  } else if (download.url.includes("7z")) {
    // Unzip and copy
    output.appendLine(`[SETUP] 7z extract ${filepath} to ${copytopath}`);
    const pathTo7zip = sevenzip.path7za;
    const seven = await node7zip.extractFull(filepath, copytopath, {
      $bin: pathTo7zip,
    });
  }

  // Run any commands that are needed..
  for (let entry of download.cmd ?? []) {
    output.appendLine(entry.cmd);

    // Prepend
    let cmd = entry.cmd;
    if (entry.usepath) {
      cmd = path.join(copytopath, entry.cmd ?? "");
    }

    // Run the command
    let res = await exec(cmd, { env: getShellEnvironment(wsConfig) }).then(
      value => {
        output.append(value.stdout);
        return true;
      },
      reason => {
        output.append(reason.stdout);
        output.append(reason.stderr);

        // Error message
        vscode.window.showErrorMessage("Error for sdk command.");

        return false;
      }
    );

    if (!res) {
      return false;
    }
  }

  return true;
}
