/*
Copyright 2025-2026 mylonics 
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
import { GlobalConfig, WorkspaceConfig, SetupState, generateSetupState, isActiveWorkspaceInitialized } from "./types";
import { loadProjectsFromFile, setWorkspaceSettings, generateGitIgnore, generateExtensionsRecommendations } from "./workspace-config";
import { parseWestConfigManifest } from "./west-config-parser";

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
    sdkVersion: rawConfig.sdkVersion,
  };

  // Migrate registry: for each registered workspace, if `.west/` exists on
  // disk and `initialized` is unset, mark it initialized. Self-heals entries
  // from pre-`initialized`-field releases so they don't get bounced back to the
  // Initial Setup page.
  if (globalConfig.setupStateDictionary) {
    for (const p in globalConfig.setupStateDictionary) {
      const entry = globalConfig.setupStateDictionary[p];
      if (entry && entry.initialized === undefined) {
        const hasWestFolder = fs.pathExistsSync(path.join(p, ".west"));
        entry.initialized = hasWestFolder;
        needsSave = true;
      }
    }
  }

  // Save migrated config if changes were made
  if (needsSave) {
    await context.globalState.update("zephyr-ide.state", globalConfig);
  }

  return globalConfig;
}

export async function setGlobalState(context: vscode.ExtensionContext, globalConfig: GlobalConfig) {
  await context.globalState.update("zephyr-ide.state", globalConfig);
}

/** Remove entries from setupStateDictionary whose paths no longer exist on disk. */
function cleanupNonexistentPaths(setupStateDictionary: Record<string, SetupState>): void {
  for (const existingPath in setupStateDictionary) {
    if (!fs.pathExistsSync(existingPath)) {
      delete setupStateDictionary[existingPath];
    }
  }
}

export async function loadExternalSetupState(context: vscode.ExtensionContext, globalConfig: GlobalConfig, path: string): Promise<SetupState | undefined> {
  if (globalConfig.setupStateDictionary) {
    const sizeBefore = Object.keys(globalConfig.setupStateDictionary).length;
    cleanupNonexistentPaths(globalConfig.setupStateDictionary);
    // Persist cleaned-up dictionary so stale entries don't reappear after reload
    if (Object.keys(globalConfig.setupStateDictionary).length < sizeBefore) {
      await setGlobalState(context, globalConfig);
    }

    if (path in globalConfig.setupStateDictionary) {
      return globalConfig.setupStateDictionary[path];
    }
  }

  if (fs.pathExistsSync(path)) {
    const setupState = generateSetupState(path);
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
  cleanupNonexistentPaths(globalConfig.setupStateDictionary);
  await setGlobalState(context, globalConfig);
}

export async function loadWorkspaceState(context: vscode.ExtensionContext): Promise<WorkspaceConfig> {
  const config: WorkspaceConfig = await context.workspaceState.get("zephyr.env") ?? {
    rootPath: await getRootPathFs(true) ?? "",
    projects: {},
    automaticProjectSelection: true,
    projectStates: {}
  };

  // Migrate old typo key → new key
  if ((config as any).automaticProjectSelction !== undefined && config.automaticProjectSelection === undefined) {
    config.automaticProjectSelection = (config as any).automaticProjectSelction;
    delete (config as any).automaticProjectSelction;
  }

  // Migrate automaticProjectSelection from workspace state → VS Code setting
  if (config.automaticProjectSelection !== undefined) {
    const configuration = vscode.workspace.getConfiguration();
    const inspected = configuration.inspect<boolean>("zephyr-ide.automaticProjectSelection");
    // Only migrate if the VS Code setting has never been explicitly set at workspace level
    if (inspected && inspected.workspaceValue === undefined && config.automaticProjectSelection !== true) {
      await configuration.update("zephyr-ide.automaticProjectSelection", config.automaticProjectSelection, vscode.ConfigurationTarget.Workspace);
    }
    delete config.automaticProjectSelection;
  }

  // Migrate legacy `initialSetupComplete` (workspace-level) into per-workspace
  // `SetupState.initialized` (registry-level). The legacy flag conflated "folder
  // is bound to a workspace" with "workspace has been initialized"; the two are
  // now tracked separately.
  if (config.initialSetupComplete && config.activeSetupState && config.activeSetupState.initialized === undefined) {
    config.activeSetupState.initialized = true;
  }
  delete config.initialSetupComplete;

  if (isActiveWorkspaceInitialized(config)) {
    await loadProjectsFromFile(config);
  }
  return config;
}

export async function setWorkspaceState(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig) {
  if (isActiveWorkspaceInitialized(wsConfig)) {
    await fs.outputFile(path.join(wsConfig.rootPath, ".vscode", "zephyr-ide.json"), JSON.stringify({ projects: wsConfig.projects }, null, 2));
  }
  await context.workspaceState.update("zephyr.env", wsConfig);
}

/**
 * Reset Workspace: mark the active workspace as uninitialized and clear readiness
 * flags. The workspace stays in the registry but will be routed back to the
 * Initial Setup page on next panel open. Does NOT delete the `.west/` folder
 * from disk.
 */
export async function clearWorkspaceState(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, globalConfig: GlobalConfig) {
  if (wsConfig.activeSetupState) {
    wsConfig.activeSetupState.initialized = false;
    wsConfig.activeSetupState.packagesInstalled = false;
    wsConfig.activeSetupState.pythonEnvironmentSetup = false;
    wsConfig.activeSetupState.westUpdated = false;
    // Persist the reset flags to the global dictionary so the state
    // survives deactivation and reactivation.
    await setExternalSetupState(context, globalConfig, wsConfig.activeSetupState.setupPath, wsConfig.activeSetupState);
  }
  await setWorkspaceState(context, wsConfig);
  reloadEnvironmentVariables(context, wsConfig.activeSetupState);
}

/**
 * Clear readiness flags (python env, west updated) on the active workspace
 * without touching the `initialized` marker. Use when the user wants to rerun
 * west setup without returning to the Initial Setup page.
 */
export async function clearWorkspaceReadiness(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, globalConfig: GlobalConfig) {
  if (wsConfig.activeSetupState) {
    wsConfig.activeSetupState.packagesInstalled = false;
    wsConfig.activeSetupState.pythonEnvironmentSetup = false;
    wsConfig.activeSetupState.westUpdated = false;
    await setExternalSetupState(context, globalConfig, wsConfig.activeSetupState.setupPath, wsConfig.activeSetupState);
  }
  await setWorkspaceState(context, wsConfig);
  reloadEnvironmentVariables(context, wsConfig.activeSetupState);
}

/**
 * Deactivate Workspace: unbind the folder from its active workspace. The
 * workspace stays in the registry with `initialized` and readiness preserved.
 */
export async function clearSetupState(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig) {
  wsConfig.activeSetupState = undefined;

  await setWorkspaceState(context, wsConfig);
  reloadEnvironmentVariables(context, wsConfig.activeSetupState);
}

export async function setSetupState(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, globalConfig: GlobalConfig, ext_path: string = "") {

  await generateGitIgnore(context, wsConfig); // Try to generate a .gitignore each time this is run
  await generateExtensionsRecommendations(context, wsConfig); // Try to generate a extensions.json each time this is run
  await setWorkspaceSettings();

  wsConfig.activeSetupState = await loadExternalSetupState(context, globalConfig, ext_path);

  if (wsConfig.activeSetupState) {
    // Only initialize DTS extension if the Python environment is ready and west is
    // already set up (.west/config exists with a valid manifest section). During
    // initial workspace creation the venv and west init have not yet been run, so
    // calling initializeDtsExt would trigger west list errors.
    const manifest = parseWestConfigManifest(wsConfig.activeSetupState.setupPath);
    if (wsConfig.activeSetupState.pythonEnvironmentSetup && manifest && manifest.path) {
      void initializeDtsExt(wsConfig.activeSetupState, wsConfig);
    }
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
