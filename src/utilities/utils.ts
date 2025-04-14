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
import * as path from "path";
import * as util from "util";
import * as cp from "child_process";
import * as os from "os";

import { pathdivider, SetupState, getToolchainDir, WorkspaceConfig } from "../setup_utilities/setup";

// Platform
let platform: NodeJS.Platform = os.platform();

// Arch
let arch: string = os.arch();

export function getPlatformName() {
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

export function getPythonVenvBinaryFolder(setupState: SetupState) {
  if (setupState.env["VIRTUAL_ENV"])
    switch (platform) {
      case "win32":
        return path.join(setupState.env["VIRTUAL_ENV"], `Scripts`);
      default:
        return path.join(setupState.env["VIRTUAL_ENV"], `bin`);
    }
  return '';
}

export async function getRootPathFs(first = false) {
  let rootPath = await getRootPath(first);
  if (rootPath && rootPath.fsPath) {
    return rootPath.fsPath
  }
  return "";
}

export async function getRootPath(first = false) {
  let rootPaths = vscode.workspace.workspaceFolders;
  if (rootPaths === undefined) {
    return;
  } else if (rootPaths.length > 1) {
    if (first) {
      return rootPaths[0].uri;
    }

    const pickOptions: vscode.QuickPickOptions = {
      ignoreFocusOut: true,
      placeHolder: "Select Workspace Root",
    };
    const roots: vscode.QuickPickItem[] = rootPaths.map(x => ({ label: x.name, description: x.uri.fsPath }));

    console.log(rootPaths);
    let selectedRoot = await vscode.window.showQuickPick(roots, pickOptions);
    if (selectedRoot && selectedRoot.description) {
      return vscode.Uri.file(selectedRoot.description);
    }
  } else {
    return rootPaths[0].uri;
  }
}

export async function getLaunchConfigurationByName(wsConfig: WorkspaceConfig, configName: string) {
  let configurations = await getLaunchConfigurations(wsConfig);
  if (!configurations) {
    return;
  }

  for (var config of configurations) {
    if (config.name === configName) {
      return config;
    }
  }
}

export async function selectLaunchConfiguration(wsConfig: WorkspaceConfig) {
  let configurations = await getLaunchConfigurations(wsConfig);
  if (!configurations) {
    return;
  }

  const pickOptions: vscode.QuickPickOptions = {
    ignoreFocusOut: true,
    placeHolder: "Select Launch Configuration",
  };
  let names = configurations.map(x => (x.name));

  return await vscode.window.showQuickPick(names, pickOptions);
}

export async function getLaunchConfigurations(wsConfig: WorkspaceConfig) {
  if (wsConfig.rootPath != "") {
    const config = vscode.workspace.getConfiguration("launch", vscode.Uri.file(wsConfig.rootPath));
    const configurations = config.get<any[]>("configurations");

    return configurations;
  }
}


export let output = vscode.window.createOutputChannel("Zephyr IDE");

export function closeTerminals(names: string[]) {
  const terminals = vscode.window.terminals;
  for (let t in terminals) {
    if (terminals[t].name in names) {
      terminals[t].dispose();
    }
  }
}

async function executeTask(task: vscode.Task) {
  const execution = await vscode.tasks.executeTask(task);
  output.appendLine("Starting Task: " + task.name);

  return new Promise<number | undefined>(resolve => {
    let disposable = vscode.tasks.onDidEndTaskProcess(e => {
      if (e.execution.task.name === task.name) {
        disposable.dispose();
        resolve(e.exitCode);
      }
    });
  });
}

export async function executeTaskHelper(taskName: string, cmd: string, cwd: string | undefined) {
  output.appendLine(`Running cmd: ${cmd}`);
  let options: vscode.ShellExecutionOptions = {
    cwd: cwd,
  };

  let exec = new vscode.ShellExecution(cmd, options);

  // Task
  let task = new vscode.Task(
    { type: "zephyr-ide:" + taskName, command: taskName },
    vscode.TaskScope.Workspace,
    taskName,
    "zephyr-ide",
    exec
  );

  let res = await executeTask(task);
  return (res !== undefined && res === 0);
}

export async function executeShellCommandInPythonEnv(cmd: string, cwd: string, setupState: SetupState, display_error = true) {
  let newCmd = path.join(getPythonVenvBinaryFolder(setupState), cmd);
  return executeShellCommand(newCmd, cwd, display_error);
};

export async function executeShellCommand(cmd: string, cwd: string, display_error = true) {
  let exec = util.promisify(cp.exec);
  let res = await exec(cmd, { cwd: cwd }).then(

    value => {
      return { stdout: value.stdout, stderr: value.stderr };
    },
    reason => {
      if (display_error) {
        output.append(reason);
      }
      return { stdout: undefined, stderr: reason.stderr };
    }
  );
  return res;
};

export function reloadEnvironmentVariables(context: vscode.ExtensionContext, setupState: SetupState | undefined) {
  context.environmentVariableCollection.persistent = false;
  context.environmentVariableCollection.clear();

  context.environmentVariableCollection.description = "Zephyr IDE adds `ZEPHYR_SDK_INSTALL_DIR`";
  context.environmentVariableCollection.replace("ZEPHYR_SDK_INSTALL_DIR", getToolchainDir(), { applyAtProcessCreation: true, applyAtShellIntegration: true });

  if (setupState) {
    if (setupState.env["VIRTUAL_ENV"]) {
      context.environmentVariableCollection.description += ", `VIRTUAL_ENV`";
      context.environmentVariableCollection.replace("VIRTUAL_ENV", setupState.env["VIRTUAL_ENV"], { applyAtProcessCreation: true, applyAtShellIntegration: true });
    }

    if (setupState.env["PATH"]) {
      context.environmentVariableCollection.description += ", `Python .venv PATH`";
      context.environmentVariableCollection.prepend("PATH", setupState.env["PATH"], { applyAtProcessCreation: true, applyAtShellIntegration: true });
      context.environmentVariableCollection.description += ", `ZEPHYR_BASE`";
      context.environmentVariableCollection.replace("ZEPHYR_BASE", setupState.zephyrDir, { applyAtProcessCreation: true, applyAtShellIntegration: true });
    }
  }
}