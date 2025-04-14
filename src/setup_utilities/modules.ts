/*
Copyright 2025 mylonics 
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
import * as yaml from 'js-yaml';
import * as fs from "fs-extra";
import path from "path";

import { executeShellCommandInPythonEnv, output } from "../utilities/utils";
import { SetupState } from "./setup";

export async function getModuleList(setupState: SetupState) {

  const outputList: Array<string[]> = [];
  let cmd = `west list`;
  let res = await executeShellCommandInPythonEnv(cmd, setupState.setupPath, setupState, false);

  if (!res.stdout) {
    output.append(res.stderr);
    vscode.window.showErrorMessage("Failed to run west boards command. See Zephyr IDE Output for error message");
    return outputList;
  }

  let modules = res.stdout.split(/\r?\n/);
  for (let m in modules) {
    let data = modules[m].split(/\s+/)
    if (data[0] != "manifest" && data[0] != "zephyr" && data[0] != "") {
      outputList.push(data);
    }
  }
  return outputList;
}

export async function getModuleYamlFile(setupState: SetupState, moduleRelPath: string): Promise<any> {
  return yaml.load(fs.readFileSync(path.join(setupState.setupPath, moduleRelPath, "zephyr/module.yml"), 'utf-8'));
}

export async function getDtsIncludes(setupState: SetupState) {
  const modules = await getModuleList(setupState);
  const dtsIncludeArray: string[] = []
  for (let m in modules) {
    let yamlFile = await getModuleYamlFile(setupState, modules[m][1]);
    if (yamlFile && yamlFile.build && yamlFile.build.settings && yamlFile.build.settings.dts_root) {
      console.log(yamlFile)
      dtsIncludeArray.push(path.join(setupState.setupPath, modules[m][1], yamlFile.build.settings.dts_root, "dts"))
    }
  }
  return dtsIncludeArray;
}

export async function getSampleFolder(setupState: SetupState) {
  const modules = await getModuleList(setupState);
  const dtsIncludeArray: string[] = []
  for (let m in modules) {
    let yamlFile = await getModuleYamlFile(setupState, modules[m][1]);
    if (yamlFile && yamlFile.samples) {
      console.log(yamlFile)
      dtsIncludeArray.push(path.join(setupState.setupPath, modules[m][1], yamlFile.samples))
    }
  }
  return dtsIncludeArray;
}

