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
import { output, executeShellCommand } from "../utilities/utils";
import { WorkspaceConfig, GlobalConfig } from "./types";
import { saveSetupState } from "./state-management";

let python = os.platform() === "linux" ? "python3" : "python";
export let pathdivider = os.platform() === "win32" ? ";" : ":";

export async function checkIfToolAvailable(tool: string, cmd: string, wsConfig: WorkspaceConfig, printStdOut: boolean, includes?: string) {
  let res = await executeShellCommand(cmd, "", true);
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
  globalConfig.toolsAvailable = false;
  saveSetupState(context, wsConfig, globalConfig);
  output.show();

  output.appendLine(
    "Zephyr IDE will now check if build tools are installed and available in system path."
  );

  output.appendLine(
    "Please follow the section Install Dependencies. https://docs.zephyrproject.org/latest/develop/getting_started/index.html#install-dependencies."
  );

  let res = await checkIfToolAvailable("git", "git --version", wsConfig, true);
  if (!res) {
    console.log("git Tool Unavilable");
    return false;
  }
  res = await checkIfToolAvailable("python", `${python} --version`, wsConfig, true, "Python 3");
  if (!res) {
    console.log("python Tool Unavilable");
    return false;
  }

  res = await checkIfToolAvailable("pip", `${python} -m pip --version`, wsConfig, true);
  if (!res) {
    console.log("pip Tool Unavilable");
    return false;
  }

  res = await checkIfToolAvailable("python3 venv", `${python} -m venv --help`, wsConfig, false);
  if (!res) {
    console.log("python3 venv Tool Unavilable");
    return false;
  }

  res = await checkIfToolAvailable("cmake", `cmake --version`, wsConfig, true);
  if (!res) {
    console.log("cmake Tool Unavilable");
    return false;
  }

  res = await checkIfToolAvailable("dtc", "dtc --version", wsConfig, true);
  if (!res) {
    console.log("DTC Tool Unavilable");
    return false;
  }

  globalConfig.toolsAvailable = true;
  saveSetupState(context, wsConfig, globalConfig);
  if (solo) {
    vscode.window.showInformationMessage("Zephyr IDE: Build Tools are available");
  }

  return true;
}
