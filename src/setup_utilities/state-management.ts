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
import * as crypto from "crypto";
import { getRootPathFs, reloadEnvironmentVariables, isWSL, getPlatformName } from "../utilities/utils";
import { initializeDtsExt } from "./dts_interface";
import { GlobalConfig, WorkspaceConfig, SetupState, generateSetupState, isActiveWorkspaceInitialized } from "./types";
import { loadProjectsFromFile, setWorkspaceSettings, generateGitIgnore, generateExtensionsRecommendations } from "./workspace-config";
import { parseWestConfigManifest } from "./west-config-parser";

/**
 * Per-extension-host-process token used to detect full process restarts so
 * `pendingRestartPackages` can be cleared. Generated lazily on first read so
 * each new extension host activation gets a fresh value.
 */
let _currentSessionToken: string | undefined;
function getCurrentSessionToken(): string {
  if (!_currentSessionToken) {
    _currentSessionToken = crypto.randomUUID();
  }
  return _currentSessionToken;
}

/**
 * Return a short string that identifies the current platform for the purpose
 * of isolating host-tool / SDK availability state.
 *
 * - Local sessions: "windows" | "linux" | "macos" | "unknown"
 * - WSL:           "wsl"
 * - Other remotes: "<remoteName>-<platform>" e.g. "ssh-remote-linux"
 *
 * WSL gets its own top-level key (not "wsl-linux") for readability and
 * backward compatibility.  All other remote environments are prefixed with
 * `vscode.env.remoteName` so that, for example, a local Linux machine and
 * an SSH-remote Linux machine each get a distinct storage bucket.
 *
 * Exported for unit testing.
 */
export function getPlatformStateKey(): string {
  // WSL has its own dedicated key to distinguish it from native Linux.
  // isWSL() is used here (same as the rest of the codebase) so the check is
  // consistent and centralised; it is equivalent to
  // `vscode.env.remoteName === "wsl"`.
  if (isWSL()) {
    return "wsl";
  }

  const remoteName = vscode.env.remoteName;
  const platformName = getPlatformName() ?? "unknown";

  // For any other remote environment (SSH, Dev Containers, etc.), prefix the
  // platform name with the remoteName so that remote tool state stays
  // isolated from local state even when the OS is the same on both ends.
  if (remoteName) {
    return `${remoteName}-${platformName}`;
  }

  return platformName;
}

/**
 * Self-heal registry entries that are missing the `initialized` field.
 *
 * For each entry in `setupStateDictionary` that does not yet have an
 * `initialized` value, checks whether a `.west/` folder exists on disk at
 * the workspace path and sets the flag accordingly.  Entries that already
 * have `initialized` set (true **or** false) are left unchanged.
 *
 * Mutates entries in-place.  Returns `true` if at least one entry was
 * modified so the caller knows whether to persist the updated dictionary.
 *
 * Exported for unit testing.
 */
export function backfillInitializedFlags(
  setupStateDictionary: Record<string, SetupState>
): boolean {
  let changed = false;
  for (const p in setupStateDictionary) {
    const entry = setupStateDictionary[p];
    if (entry && entry.initialized === undefined) {
      entry.initialized = fs.pathExistsSync(path.join(p, ".west"));
      changed = true;
    }
  }
  return changed;
}

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

  // Determine the platform key for this environment.
  const platformKey = getPlatformStateKey();

  // Ensure platformStates map exists.
  if (!rawConfig.platformStates) {
    rawConfig.platformStates = {};
  }

  // -----------------------------------------------------------------------
  // Migration: lift legacy top-level platform-specific fields into the
  // per-platform bucket.  This handles state saved by older versions of the
  // extension (before per-platform isolation was introduced).
  //
  // NOTE: this list must stay in sync with the fields defined in the
  // PlatformState interface (src/setup_utilities/types.ts).
  // -----------------------------------------------------------------------
  const legacyPlatformFields = [
    'toolsAvailable', 'sdkInstalled', 'sdkVersion',
    'pendingRestartPackages', 'pendingRestartSessionToken',
  ];
  for (const field of legacyPlatformFields) {
    if (field in rawConfig) {
      // Only migrate into the current platform's bucket if it doesn't already
      // have its own value for this field — avoids overwriting a newer value
      // that was already stored per-platform on a previous run.
      if (!rawConfig.platformStates[platformKey]) {
        rawConfig.platformStates[platformKey] = {};
      }
      if (!(field in rawConfig.platformStates[platformKey])) {
        rawConfig.platformStates[platformKey][field] = rawConfig[field];
      }
      delete rawConfig[field];
      needsSave = true;
    }
  }

  // Read the current platform's state (may be empty on first WSL run).
  const platformState: Record<string, any> = rawConfig.platformStates[platformKey] ?? {};

  // Ensure required fields exist
  const globalConfig: GlobalConfig = {
    setupStateDictionary: rawConfig.setupStateDictionary ?? {},
    platformStates: rawConfig.platformStates,
    toolsAvailable: platformState.toolsAvailable,
    sdkInstalled: platformState.sdkInstalled,
    sdkVersion: platformState.sdkVersion,
    pendingRestartPackages: platformState.pendingRestartPackages,
    pendingRestartSessionToken: platformState.pendingRestartSessionToken,
  };

  // Clear pending-restart state if the persisted session token differs from
  // the one generated for this extension host process. A mismatch means the
  // VS Code window was reloaded or the extension host was restarted, which
  // refreshes PATH from the OS — so any "pending restart" entries should be
  // discarded.
  const currentToken = getCurrentSessionToken();
  if (globalConfig.pendingRestartSessionToken !== currentToken) {
    if (globalConfig.pendingRestartPackages && globalConfig.pendingRestartPackages.length > 0) {
      globalConfig.pendingRestartPackages = [];
      needsSave = true;
    }
    globalConfig.pendingRestartSessionToken = currentToken;
    needsSave = true;
  }

  // Migrate registry: for each registered workspace, if `.west/` exists on
  // disk and `initialized` is unset, mark it initialized. Self-heals entries
  // from pre-`initialized`-field releases so they don't get bounced back to the
  // Initial Setup page.
  if (globalConfig.setupStateDictionary) {
    if (backfillInitializedFlags(globalConfig.setupStateDictionary)) {
      needsSave = true;
    }
  }

  // Save migrated config if changes were made
  if (needsSave) {
    await setGlobalState(context, globalConfig);
  }

  return globalConfig;
}

export async function setGlobalState(context: vscode.ExtensionContext, globalConfig: GlobalConfig) {
  const platformKey = getPlatformStateKey();

  // Sync the current platform's flat fields back into the platformStates map
  // so that the serialised form is fully platform-aware.
  if (!globalConfig.platformStates) {
    globalConfig.platformStates = {};
  }
  globalConfig.platformStates[platformKey] = {
    toolsAvailable: globalConfig.toolsAvailable,
    sdkInstalled: globalConfig.sdkInstalled,
    sdkVersion: globalConfig.sdkVersion,
    pendingRestartPackages: globalConfig.pendingRestartPackages,
    pendingRestartSessionToken: globalConfig.pendingRestartSessionToken,
  };

  // Persist only the fields that should live in globalState.  The flat
  // platform-specific fields are stored exclusively inside `platformStates`
  // so that switching between platforms (e.g. Windows ↔ WSL) never bleeds
  // one platform's tool availability into another.
  const storedConfig = {
    setupStateDictionary: globalConfig.setupStateDictionary,
    platformStates: globalConfig.platformStates,
  };

  await context.globalState.update("zephyr-ide.state", storedConfig);
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
    // Merge the projects field into any existing zephyr-ide.json so we don't
    // wipe out other top-level keys (e.g. `toolchains`, `blobs`, custom vars)
    // that the user may have added or that other helpers manage.
    const filePath = path.join(wsConfig.rootPath, ".vscode", "zephyr-ide.json");
    let existing: Record<string, any> = {};
    try {
      if (fs.pathExistsSync(filePath)) {
        const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          existing = parsed;
        }
      }
    } catch {
      // Treat unreadable / malformed file as empty so the projects state is
      // still written rather than silently lost.
      existing = {};
    }
    existing.projects = wsConfig.projects;
    await fs.outputFile(filePath, JSON.stringify(existing, null, 2));
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
