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
import { t } from "../utilities/taskManager";

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

export function getShellEnvironment(setupState: SetupState | undefined, as_terminal_profile = false) {
  if (setupState === undefined) {
    return process.env;
  }

  let envPath = process.env;
  if (setupState.env["VIRTUAL_ENV"]) {
    envPath["VIRTUAL_ENV"] = setupState.env["VIRTUAL_ENV"];
  }
  if (setupState.env["PATH"]) {
    envPath["PATH"] = path.join(setupState.env["PATH"], pathdivider + envPath["PATH"]);
  }
  envPath["ZEPHYR_BASE"] = setupState.zephyrDir;
  envPath["ZEPHYR_SDK_INSTALL_DIR"] = getToolchainDir();

  return envPath;
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

export async function executeTaskHelper(taskName: string, cmd: string, envPath: NodeJS.ProcessEnv, cwd: string | undefined) {
  output.appendLine(`Running cmd: ${cmd}`);
  let options: vscode.ShellExecutionOptions = {
    env: <{ [key: string]: string }>envPath,
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


export async function executeShellCommand2(cmd: string, setupState: SetupState | undefined, display_error = true) {
  let exec = util.promisify(cp.exec);
  let res = await exec(cmd, { env: getShellEnvironment(setupState), cwd: setupState?.setupPath }).then(
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

export async function executeShellCommand(cmd: string, setupState: SetupState | undefined, display = false, display_error = true,) {
  let task = await t.createTerminal(cmd, setupState, display);
  let res = await task.getResult();

  if ((display_error && res.code !== 0) || display) {
    task.term.show();
  } else {
    task.term.dispose();
  }

  return res;
};



