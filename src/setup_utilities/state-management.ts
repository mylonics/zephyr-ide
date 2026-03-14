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
import * as fs from "fs-extra";
import * as path from "upath";
import { getRootPathFs, reloadEnvironmentVariables } from "../utilities/utils";
import { initializeDtsExt } from "./dts_interface";
import { GlobalConfig, WorkspaceConfig, SetupState, generateSetupState } from "./types";
import { loadProjectsFromFile, setWorkspaceSettings, generateGitIgnore, generateExtensionsRecommendations } from "./workspace-config";

export async function loadGlobalState(context: vscode.ExtensionContext): Promise<GlobalConfig> {
  // Load raw config as any to handle deprecated fields
  const rawConfig: any = await context.globalState.get("zephyr-ide.state") ?? {};
  
  // Migrate old config: remove deprecated fields
  const deprecatedFields = ['armGdbPath', 'toolchains', 'setupState'];
  let needsSave = false;
  
  for (const field of deprecatedFields) {
    if (field in rawConfig) {
      delete rawConfig[field];
      needsSave = true;
    }
  }
  
  // Ensure required fields exist
  const globalConfig: GlobalConfig = {
    setupStateDictionary: rawConfig.setupStateDictionary ?? {},
    toolsAvailable: rawConfig.toolsAvailable,
    sdkInstalled: rawConfig.sdkInstalled,
  };
  
  // Save migrated config if changes were made
  if (needsSave) {
    await context.globalState.update("zephyr-ide.state", globalConfig);
  }
  
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
  for (const existingPath in globalConfig.setupStateDictionary) {
    if (!fs.pathExistsSync(existingPath)) {
      delete globalConfig.setupStateDictionary[existingPath];
    }
  }
  await setGlobalState(context, globalConfig);
}

export async function loadWorkspaceState(context: vscode.ExtensionContext): Promise<WorkspaceConfig> {
  let config: WorkspaceConfig = await context.workspaceState.get("zephyr.env") ?? {
    rootPath: await getRootPathFs(true),
    projects: {},
    automaticProjectSelction: true,
    initialSetupComplete: false,
    projectStates: {}
  };

  if (config.initialSetupComplete) {
    await loadProjectsFromFile(config);
  }
  return config;
}

export async function setWorkspaceState(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig) {
  if (wsConfig.initialSetupComplete) {
    await fs.outputFile(path.join(wsConfig.rootPath, ".vscode", "zephyr-ide.json"), JSON.stringify({ projects: wsConfig.projects }, null, 2), { flag: 'w+' });
  }
  await context.workspaceState.update("zephyr.env", wsConfig);
}

export async function clearWorkspaceState(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig) {
  wsConfig.automaticProjectSelction = true;
  wsConfig.initialSetupComplete = false;
  wsConfig.activeSetupState = undefined;
  await setWorkspaceState(context, wsConfig);
}

export async function clearSetupState(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, globalConfig: GlobalConfig, ext_path: string = "") {
  wsConfig.activeSetupState = undefined;

  await setWorkspaceState(context, wsConfig);
  reloadEnvironmentVariables(context, wsConfig.activeSetupState);
}

export async function setSetupState(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, globalConfig: GlobalConfig, ext_path: string = "") {

  generateGitIgnore(context, wsConfig); // Try to generate a .gitignore each time this is run
  generateExtensionsRecommendations(context, wsConfig); // Try to generate a extensions.json each time this is run
  setWorkspaceSettings();

  wsConfig.activeSetupState = await loadExternalSetupState(context, globalConfig, ext_path);

  if (wsConfig.activeSetupState) {
    initializeDtsExt(wsConfig.activeSetupState, wsConfig);
  }

  await setWorkspaceState(context, wsConfig);
  reloadEnvironmentVariables(context, wsConfig.activeSetupState);
}

export async function saveSetupState(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, globalConfig: GlobalConfig) {
  if (wsConfig.activeSetupState) {
    await setExternalSetupState(context, globalConfig, wsConfig.activeSetupState.setupPath, wsConfig.activeSetupState);
  }
  await setGlobalState(context, globalConfig);
}
