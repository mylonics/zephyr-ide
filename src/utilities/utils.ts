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

import { pathdivider, toolchainDir, WorkspaceConfig } from "../setup_utilities/setup";

export function getRootPath() {
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

export function getShellEnvironment(wsConfig: WorkspaceConfig) {
  let envPath = process.env;
  if (wsConfig.env["VIRTUAL_ENV"]) {
    envPath["VIRTUAL_ENV"] = wsConfig.env["VIRTUAL_ENV"];
  }
  if (wsConfig.env["PATH"]) {
    envPath["PATH"] = path.join(wsConfig.env["PATH"], pathdivider + envPath["PATH"]);
  }
  if (wsConfig.env["ZEPHYR_BASE"]) {
    envPath["ZEPHYR_BASE"] = wsConfig.env["ZEPHYR_BASE"];
  }
  envPath["ZEPHYR_SDK_INSTALL_DIR"] = toolchainDir;
  return envPath;
}

import * as vscode from "vscode";

export let output = vscode.window.createOutputChannel("Zephyr IDE");

export async function executeTask(task: vscode.Task) {
  const execution = await vscode.tasks.executeTask(task);
  output.appendLine("Starting Task: " + task.name);

  return new Promise<void>(resolve => {
    let disposable = vscode.tasks.onDidEndTask(e => {
      if (e.execution.task.name === task.name) {
        disposable.dispose();
        resolve();
      }
    });
  });
}

