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
import { readZephyrIdeJson, writeZephyrIdeJson } from "./zephyr_ide_json";
import { splitArgs } from "../project_utilities/runner_profiles";
import { outputError } from "../utilities/output";

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

function readLegacyString(source: any, key: string): string | undefined {
  if (!source || typeof source !== "object") { return undefined; }
  const value = source[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function getLegacyTargetBindings(build: any, buildState: any | undefined): any {
  return {
    launchTarget: readLegacyString(build, "launchTarget") ?? readLegacyString(buildState, "launchTarget"),
    buildDebugTarget: readLegacyString(build, "buildDebugTarget") ?? readLegacyString(buildState, "buildDebugTarget"),
    attachTarget: readLegacyString(build, "attachTarget") ?? readLegacyString(buildState, "attachTarget"),
  };
}

function pickLegacyActiveRunner(build: any, buildState: any | undefined): string | undefined {
  const activeRunner = readLegacyString(build, "activeRunner") ?? readLegacyString(buildState, "activeRunner");
  if (activeRunner) {
    return activeRunner;
  }

  const runnerConfigs = build?.runnerConfigs;
  if (!runnerConfigs || typeof runnerConfigs !== "object") {
    return undefined;
  }

  for (const runnerName of Object.keys(runnerConfigs)) {
    return runnerName;
  }
  return undefined;
}

function hasLegacyRunnerProfileData(build: any, buildState: any | undefined): boolean {
  const targets = getLegacyTargetBindings(build, buildState);
  return !!(
    (build?.runnerConfigs && typeof build.runnerConfigs === "object") ||
    pickLegacyActiveRunner(build, buildState) ||
    targets.launchTarget ||
    targets.buildDebugTarget ||
    targets.attachTarget ||
    buildState?.runnerStates
  );
}

function normalizeBindForSignature(bind: any): any {
  if (!bind || typeof bind !== "object") {
    return { kind: "auto" };
  }
  // west-flash (and legacy "runner" → west-flash for signature purposes)
  if ((bind.kind === "west-flash" || bind.kind === "runner") && typeof bind.runner === "string" && bind.runner.trim().length > 0) {
    const out: any = { kind: "west-flash", runner: bind.runner.trim() };
    if (Array.isArray(bind.extraArgs)) {
      const extraArgs = bind.extraArgs
        .filter((arg: unknown): arg is string => typeof arg === "string" && arg.trim().length > 0)
        .map((arg: string) => arg.trim());
      if (extraArgs.length > 0) {
        out.extraArgs = extraArgs;
      }
    }
    return out;
  }
  if (bind.kind === "cortex-debug" && typeof bind.runner === "string" && bind.runner.trim().length > 0) {
    const out: any = { kind: "cortex-debug", runner: bind.runner.trim() };
    if (bind.enableRtt === true) { out.enableRtt = true; }
    if (typeof bind.probe === "string" && bind.probe.trim()) { out.probe = bind.probe.trim(); }
    return out;
  }
  if (bind.kind === "west-debug" && typeof bind.runner === "string" && bind.runner.trim().length > 0) {
    const out: any = { kind: "west-debug", runner: bind.runner.trim() };
    if (Array.isArray(bind.extraArgs)) {
      const extraArgs = bind.extraArgs
        .filter((arg: unknown): arg is string => typeof arg === "string" && arg.trim().length > 0)
        .map((arg: string) => arg.trim());
      if (extraArgs.length > 0) {
        out.extraArgs = extraArgs;
      }
    }
    return out;
  }
  if (bind.kind === "launch" && typeof bind.name === "string" && bind.name.trim().length > 0) {
    return { kind: "launch", name: bind.name.trim() };
  }
  // Legacy: zephyr-launch → launch for signature purposes
  if (bind.kind === "zephyr-launch" && typeof bind.name === "string" && bind.name.trim().length > 0) {
    return { kind: "launch", name: bind.name.trim() };
  }
  return { kind: "auto" };
}

function buildRunnerProfileSignature(profile: any): string {
  const normalized: any = {
    flash: normalizeBindForSignature(profile?.flash),
    debug: normalizeBindForSignature(profile?.debug),
    attach: normalizeBindForSignature(profile?.attach),
  };
  if (profile?.buildDebug !== undefined) {
    normalized.buildDebug = normalizeBindForSignature(profile.buildDebug);
  }
  return JSON.stringify(normalized);
}

function buildPersistedRunnerProfile(name: string, profile: any): any {
  const persisted: any = {
    name,
    flash: normalizeBindForSignature(profile?.flash),
    debug: normalizeBindForSignature(profile?.debug),
    attach: normalizeBindForSignature(profile?.attach),
  };
  if (profile?.buildDebug !== undefined) {
    persisted.buildDebug = normalizeBindForSignature(profile.buildDebug);
  }
  return persisted;
}

/**
 * Convert a single legacy `RunnerConfig` (any of: pre-bind {name,runner,args};
 * mid-bind {name, flash, build|buildDebug|debug, attach}) plus legacy
 * build target fields (launchTarget/buildDebugTarget/attachTarget) into a
 * `RunnerProfile`-shaped object (sans scope).
 *
 * Exported for tests.
 */
export function migrateRunnerConfig(rc: any, legacyBuild: any | undefined): any {
  // Helper: fold legacy launch target string into a bind.
  const bindFromTarget = (target: string | undefined): any => {
    if (!target || target.startsWith("Auto:") || target === "Zephyr IDE: Debug") {
      return { kind: "auto" };
    }
    return { kind: "launch", name: target };
  };

  // Already in (mid-)bind shape: normalise field set.
  if (rc && typeof rc === "object" && (rc.flash || rc.build || rc.buildDebug || rc.debug || rc.attach)) {
    const flash = rc.flash ?? { kind: "auto" };
    // `debug` is the debug-only slot; `buildDebug` / `build` are the build-and-debug slot.
    const debug = rc.debug ?? { kind: "auto" };
    const attach = rc.attach ?? { kind: "auto" };
    const out: any = { name: rc.name, flash, debug, attach };
    // Preserve buildDebug / build as the dedicated Build-and-Debug slot.
    const buildDebugBind = rc.buildDebug ?? rc.build;
    if (buildDebugBind) { out.buildDebug = buildDebugBind; }
    return out;
  }

  // Pre-bind shape {name, runner, args, argsMode?}.
  // In the old model: buildDebugTarget → Build-and-Debug; launchTarget → Debug-only.
  const flash: any = rc?.runner
    ? { kind: "west-flash", runner: rc.runner, ...(rc.args ? { extraArgs: splitArgs(String(rc.args)) } : {}) }
    : { kind: "auto" };
  const out: any = {
    name: rc?.name,
    flash,
    debug: bindFromTarget(legacyBuild?.launchTarget),
    attach: bindFromTarget(legacyBuild?.attachTarget),
  };
  if (legacyBuild?.buildDebugTarget) {
    out.buildDebug = bindFromTarget(legacyBuild.buildDebugTarget);
  }
  return out;
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

  // Migrate legacy per-build/per-project runner state into workspace-scope
  // RunnerProfiles (`.vscode/zephyr-ide.json#runnerProfiles`). For each build
  // that still has legacy runner or target-binding data, migrate its effective
  // selection into a single deduped `activeProfile`. We do not delete legacy fields off the in-memory
  // ProjectConfig/BuildConfig objects here because they are typed as not
  // having those keys; instead we work via `any` casts and the new shape is
  // what subsequent saves persist.
  await migrateLegacyRunnersToProfiles(context, config);

  return config;
}

/**
 * One-shot migration: scans each project build for legacy runner and target
 * bindings, extracts a single effective RunnerProfile per build into
 * `.vscode/zephyr-ide.json#runnerProfiles`, dedupes identical profiles by
 * content, sets `build.activeProfile`, and removes the legacy fields from the
 * in-memory config.
 *
 * Exported for unit testing.
 *
 * The migration is gated by a `runnerProfilesMigrationVersion` flag stored in
 * `.vscode/zephyr-ide.json`. Once the file records `runnerProfilesMigrationVersion >= 1`,
 * this function short-circuits without rescanning. This prevents duplicate
 * `runner-2`/`runner-3` profile names from appearing on every workspace load
 * if a previous migration partially succeeded.
 *
 * On any migration (even when no new profiles are added — e.g. only legacy
 * fields stripped), the cleaned-up `wsConfig` is persisted via
 * `setWorkspaceState` so the next load sees the same shape this one did.
 */
export const RUNNER_PROFILES_MIGRATION_VERSION = 1;
const MIGRATION_VERSION_KEY = "runnerProfilesMigrationVersion";

export async function migrateLegacyRunnersToProfiles(
  context: vscode.ExtensionContext,
  config: WorkspaceConfig,
): Promise<void> {
  if (!isActiveWorkspaceInitialized(config)) { return; }

  let data: Record<string, unknown> = {};

  // Idempotency guard — once we've migrated, never re-scan. This prevents
  // duplicate `runner-2`/`runner-3` collisions from being appended on every
  // load when (e.g.) a previous migration succeeded but write-back failed.
  try {
    data = readZephyrIdeJson(config) as Record<string, unknown>;
    const recorded = typeof data[MIGRATION_VERSION_KEY] === "number"
      ? (data[MIGRATION_VERSION_KEY] as number)
      : 0;
    if (recorded >= RUNNER_PROFILES_MIGRATION_VERSION) {
      return;
    }
  } catch (e) {
    // Log so a filesystem/parse failure here is visible rather than silently
    // masking a deeper issue, but fall through and still attempt migration —
    // the version flag write at the end will heal a partially-corrupt file.
    outputError("Runner Profile Migration", `Failed to read migration version flag: ${String(e)}`);
  }

  const existingNames = new Set<string>();
  const signatureToName = new Map<string, string>();
  const existingProfiles = Array.isArray(data.runnerProfiles) ? (data.runnerProfiles as any[]) : [];
  const newProfiles: any[] = [];

  for (const profile of existingProfiles) {
    if (!profile || typeof profile.name !== "string" || profile.name.trim().length === 0) {
      continue;
    }
    const profileName = profile.name.trim();
    existingNames.add(profileName);
    const signature = buildRunnerProfileSignature(profile);
    if (!signatureToName.has(signature)) {
      signatureToName.set(signature, profileName);
    }
  }

  const uniqueName = (base: string): string => {
    if (!existingNames.has(base)) { existingNames.add(base); return base; }
    let i = 2;
    while (existingNames.has(`${base}-${i}`)) { i++; }
    const n = `${base}-${i}`;
    existingNames.add(n);
    return n;
  };

  let migrated = false;

  for (const projectName in config.projects) {
    const project = config.projects[projectName] as any;
    const projectState = config.projectStates?.[projectName] as any;

    // Drop project-level legacy runner storage (no replacement — inheritance removed).
    if (project.runnerConfigs) {
      delete project.runnerConfigs;
      migrated = true;
    }
    if (projectState?.runnerStates) {
      delete projectState.runnerStates;
      migrated = true;
    }

    if (!project.buildConfigs) { continue; }
    for (const buildName in project.buildConfigs) {
      const build = project.buildConfigs[buildName] as any;
      const buildState = projectState?.buildStates?.[buildName] as any;
      if (!hasLegacyRunnerProfileData(build, buildState)) { continue; }

      const legacyBindings = getLegacyTargetBindings(build, buildState);
      const legacyRunnerName = pickLegacyActiveRunner(build, buildState);
      const legacyRunner = legacyRunnerName && build.runnerConfigs?.[legacyRunnerName]
        ? build.runnerConfigs[legacyRunnerName]
        : undefined;
      const migratedShape = migrateRunnerConfig(legacyRunner, legacyBindings);
      const signature = buildRunnerProfileSignature(migratedShape);
      let profileName = signatureToName.get(signature);
      if (!profileName) {
        const desiredBaseName = String(migratedShape.name || legacyRunnerName || buildName || "runner");
        profileName = uniqueName(desiredBaseName);
        newProfiles.push(buildPersistedRunnerProfile(profileName, migratedShape));
        signatureToName.set(signature, profileName);
      }
      build.activeProfile = profileName;

      // Strip legacy fields from in-memory shape so subsequent saves are clean.
      delete build.runnerConfigs;
      delete build.activeRunner;
      delete build.launchTarget;
      delete build.launchTargetFolder;
      delete build.buildDebugTarget;
      delete build.buildDebugTargetFolder;
      delete build.attachTarget;
      delete build.attachTargetFolder;
      if (buildState) {
        delete buildState.activeRunner;
        delete buildState.runnerStates;
      }
      migrated = true;
    }
  }

  // Always stamp the migration version so we never re-scan on future loads
  // — even when nothing needed migrating, since the absence of legacy fields
  // already means the workspace is on the new shape.
  try {
    if (migrated && newProfiles.length > 0) {
      data.runnerProfiles = [...existingProfiles, ...newProfiles];
    }
    data[MIGRATION_VERSION_KEY] = RUNNER_PROFILES_MIGRATION_VERSION;
    await writeZephyrIdeJson(config, data);
  } catch (e) {
    outputError("Runner Profile Migration", `Failed to persist migrated runner profiles: ${String(e)}`);
  }

  // Persist the stripped legacy fields and any newly-set `activeProfile`
  // values to workspace state + zephyr-ide.json#projects so the cleanup
  // survives a session close even when the user makes no further edits.
  if (migrated) {
    try {
      await setWorkspaceState(context, config);
    } catch (e) {
      outputError("Runner Profile Migration", `Failed to persist migrated workspace state: ${String(e)}`);
    }
  }
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
