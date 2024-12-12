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

import { workspace } from "vscode";
import * as path from "path";
import * as util from "util";
import * as cp from "child_process";

import { pathdivider, SetupState, getToolchainDir } from "../setup_utilities/setup";
import { getPlatformName } from "../setup_utilities/setup_toolchain"

export function getRootPath() {
  let rootPaths = workspace.workspaceFolders;
  if (rootPaths === undefined) {
    return;
  } else {
    return rootPaths[0].uri;
  }
}


export function fileExists(path: string) {
  let rootPaths = workspace.workspaceFolders;
  if (rootPaths === undefined) {
    return;
  } else {
    return rootPaths[0].uri;
  }
}

export function getLaunchConfigurationByName(configName: string) {
  let configurations = getLaunchConfigurations();
  if (!configurations) {
    return;
  }

  for (var config of configurations) {
    if (config.name === configName) {
      return config;
    }
  }
}

export async function selectLaunchConfiguration() {
  let configurations = getLaunchConfigurations();
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

export function getLaunchConfigurations() {
  let rootPath = getRootPath();
  if (rootPath) {
    const config = vscode.workspace.getConfiguration("launch", rootPath);
    const configurations = config.get<any[]>("configurations");

    return configurations;
  }
}

//export function setZshArg(platform_name: string, zsh_argument: string[]) {
//  const configuration = vscode.workspace.getConfiguration();
//  let terminal_profile_name = "terminal.integrated.profiles." + platform_name;
//  let terminal_profile: any = configuration.get(terminal_profile_name);
//  if (Object.keys(terminal_profile)[0] === "zsh" || configuration.get('terminal.integrated.defaultProfile.' + platform_name) == "zsh") {
//    terminal_profile.zsh.args = zsh_argument;
//    configuration.update(terminal_profile_name, terminal_profile);
//  }
//}

export function reloadEnvironmentVariables(context: vscode.ExtensionContext, setupState: SetupState | undefined) {
  context.environmentVariableCollection.persistent = false;
  context.environmentVariableCollection.description = "";
  context.environmentVariableCollection.clear();


  context.environmentVariableCollection.description += "Zephyr IDE adds '''ZEPHYR_SDK_INSTALL_DIR'''";
  context.environmentVariableCollection.replace("ZEPHYR_SDK_INSTALL_DIR", getToolchainDir(), { applyAtProcessCreation: true, applyAtShellIntegration: true });

  if (setupState) {
    if (setupState.env["VIRTUAL_ENV"]) {
      context.environmentVariableCollection.description += ", '''VIRTUAL_ENV'''";
      context.environmentVariableCollection.replace("VIRTUAL_ENV", setupState.env["VIRTUAL_ENV"], { applyAtProcessCreation: true, applyAtShellIntegration: true });
    }

    if (setupState.env["PATH"]) {
      context.environmentVariableCollection.description += ", '''PATH Variables'''";
      context.environmentVariableCollection.prepend("PATH", setupState.env["PATH"], { applyAtProcessCreation: true, applyAtShellIntegration: true });
    }

    context.environmentVariableCollection.description += ", '''ZEPHYR_BASE'''";
    context.environmentVariableCollection.replace("ZEPHYR_BASE", setupState.zephyrDir, { applyAtProcessCreation: true, applyAtShellIntegration: true });

  }
}

import * as vscode from "vscode";

export let output = vscode.window.createOutputChannel("Zephyr IDE");

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


export async function executeShellCommand(cmd: string, cwd: string, display_error = true) {

  let options: vscode.ProcessExecutionOptions = {
    cwd: cwd,
  };
  let taskName = "test";
  let exec1 = new vscode.ProcessExecution(cmd, options);

  // Task
  let task = new vscode.Task(
    { type: "zephyr-ide:" + taskName, command: taskName },
    vscode.TaskScope.Workspace,
    taskName,
    "zephyr-ide",
    exec1
  );


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