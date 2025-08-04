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
import { SetupState } from "./types";


export interface ZephyrVersionNumber {
  major: number;
  minor: number;
  patch: number;
  tweak: number;
  extra: number;
}

export async function getModuleList(setupState: SetupState) {

  const outputList: Array<string[]> = [];
  let cmd = `west list -f "{name:30} {abspath:28} {revision:40} {url}"`;
  let res = await executeShellCommandInPythonEnv(cmd, setupState.setupPath, setupState, false);

  if (!res.stdout) {
    output.append(res.stderr);
    vscode.window.showErrorMessage("Failed to run west list command. See Zephyr IDE Output for error message");
    return outputList;
  }

  let modules = res.stdout.split(/\r?\n/);
  for (let m in modules) {
    let data = modules[m].split(/\s+/);
    if (data[0] !== "manifest" && data[0] !== "") {
      outputList.push(data);
    }
  }
  return outputList;
}

export async function getModuleVersion(modulePath: string): Promise<any> {
  let filePath = path.join(modulePath, "VERSION");

  if (fs.existsSync(filePath)) {
    const file = fs.readFileSync(filePath, 'utf8');
    let lines = file.split(/\r?\n/);
    let versionNumber: ZephyrVersionNumber = {
      major: +lines[0].split("=")[1],
      minor: +lines[1].split("=")[1],
      patch: +lines[2].split("=")[1],
      tweak: +lines[3].split("=")[1],
      extra: +lines[4].split("=")[1],
    };
    console.log(versionNumber);
    return versionNumber;
  }
}

export function isVersionNumberGreaterEqual(version: ZephyrVersionNumber, major: number, minor: number, patch: number) {
  if (version.major > major) {
    return true;
  } else if (version.major === major) {
    if (version.minor > minor) {
      return true;
    } else if (version.minor === minor) {

      if (version.patch >= patch) {
        return true;
      }
    }
  }
  return false;
}

export function isVersionNumberGreater(version: ZephyrVersionNumber, major: number, minor: number, patch: number) {
  if (version.major > major) {
    return true;
  } else if (version.major === major) {
    if (version.minor > minor) {
      return true;
    } else if (version.minor === minor) {
      if (version.patch > patch) {
        return true;
      }
    }
  }
  return false;
}

export async function getModuleYamlFile(moduleAbsPath: string): Promise<any> {
  let filePath = path.join(moduleAbsPath, "zephyr/module.yml");
  if (fs.existsSync(filePath)) {
    return yaml.load(fs.readFileSync(filePath, 'utf-8'));
  }
}

export async function getDtsIncludes(setupState: SetupState) {
  const modules = await getModuleList(setupState);
  const dtsIncludeArray: string[] = [];
  for (let m in modules) {
    let yamlFile = await getModuleYamlFile(modules[m][1]);
    if (yamlFile && yamlFile.build && yamlFile.build.settings && yamlFile.build.settings.dts_root) {
      dtsIncludeArray.push(path.join(setupState.setupPath, modules[m][1], yamlFile.build.settings.dts_root, "dts"));
    }
  }
  return dtsIncludeArray;
}

export async function getModulePathAndVersion(setupState: SetupState, moduleName: string) {
  const modules = await getModuleList(setupState);
  for (let m in modules) {
    if (modules[m][0] === moduleName) {
      return { path: modules[m][1], version: modules[m][2] };
    }
  }
  return;
}

export async function getModuleSampleFolders(setupState: SetupState) {
  const modules = await getModuleList(setupState);
  const samplefolders: [string, string][] = [["zephyr", path.join(setupState.zephyrDir, 'samples')]];

  for (let m in modules) {
    let yamlFile = await getModuleYamlFile(modules[m][1]);
    if (yamlFile && yamlFile.samples) {
      for (let i in yamlFile.samples) {
        let sampleFolder: [string, string] = [modules[m][0], path.join(setupState.setupPath, modules[m][1], yamlFile.samples[i])];
        samplefolders.push(sampleFolder);
      }
    }
  }
  return samplefolders;
}

export async function getSampleRecursive(dir: string, moduleName: string, sampleList: [string, string, string, string][]) {
  let tentativePath = path.join(dir, "sample.yaml");
  if (fs.existsSync(tentativePath)) {
    let yamlFile: any = await yaml.load(fs.readFileSync(tentativePath, 'utf-8'));
    if (yamlFile && yamlFile.sample && yamlFile.sample.name) {
      let description = yamlFile.sample.description ? yamlFile.sample.description : "";
      return sampleList.push([moduleName, yamlFile.sample.name, description, dir]);
    }
  } else {
    let folderList = fs.readdirSync(dir)
      .map(fileName => {
        return path.join(dir, fileName);
      })
      .filter(fileName => {
        return !fs.lstatSync(fileName).isFile();
      });

    for (let i in folderList) {
      getSampleRecursive(folderList[i], moduleName, sampleList);
    }
  }
}

export async function getSamples(setupState: SetupState) {
  let samplefolders = await getModuleSampleFolders(setupState);
  let sampleList: [string, string, string, string][] = [];
  for (let i in samplefolders) {
    await getSampleRecursive(samplefolders[i][1], samplefolders[i][0], sampleList);
  }
  return sampleList;
}


