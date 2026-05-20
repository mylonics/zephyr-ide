/*
Copyright 2026 mylonics 
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

/**
 * Runner Profile model (replaces the old RunnerConfig + RunnerVariant pair).
 *
 * A `RunnerProfile` is a named `{flash, debug, attach}` triplet of bind slots.
 * Profiles live at workspace scope (`.vscode/zephyr-ide.json` -> `runnerProfiles`)
 * with optional user scope (`zephyr-ide.runnerProfiles` setting) for sharing
 * across workspaces. Workspace overrides user on name collision.
 *
 * A `BuildConfig` references a profile by name (`activeProfile`) and may add
 * per-slot extra-argument overrides (`bindOverrides`). The override only has
 * effect when the slot's resolved bind kind is `runner` (i.e. it directly
 * names a Zephyr runner); `auto`/`launch` slots ignore the override.
 */

import * as vscode from "vscode";
import { WorkspaceConfig } from "../setup_utilities/types";
import { readZephyrIdeJson, writeZephyrIdeJson } from "../setup_utilities/zephyr_ide_json";

/**
 * RunnerBind kinds:
 *   - "auto":    use defaults from runners.yaml (the cmake-generated file).
 *   - "runner":  name a specific Zephyr west runner (e.g. "openocd").
 *                `extraArgs` is appended after runners.yaml args.
 *   - "launch":  reference a `launch.json` configuration by name (Debug / Attach only).
 *
 * The old "variant" kind has been folded into named RunnerProfiles, which are
 * the new unit of sharing across builds.
 */
export type RunnerBind =
  | { kind: "auto" }
  | { kind: "runner"; runner: string; extraArgs?: string }
  | { kind: "launch"; name: string };

export interface RunnerProfile {
  name: string;
  /** Used for both Flash and Build-and-Flash actions. `launch` is invalid here. */
  flash: RunnerBind;
  /** Used for both Debug and Build-and-Debug actions. */
  debug: RunnerBind;
  /** Used for Debug Attach. */
  attach: RunnerBind;
}

export type RunnerProfileDictionary = { [name: string]: RunnerProfile };

/** Per-slot override that a `BuildConfig` may add on top of its referenced
 *  profile. Only meaningful for slots whose profile kind is `runner`. */
export interface BindOverride {
  /** Extra args appended after the profile's resolved args. */
  extraArgs?: string;
}

export interface BuildBindOverrides {
  flash?: BindOverride;
  debug?: BindOverride;
  attach?: BindOverride;
}

const USER_SETTINGS_KEY = "zephyr-ide.runnerProfiles";
const WORKSPACE_JSON_KEY = "runnerProfiles";

/** Sanitize an unknown blob into a list of `RunnerProfile`s, dropping malformed entries. */
function sanitizeProfiles(value: unknown): RunnerProfile[] {
  if (!Array.isArray(value)) { return []; }
  const out: RunnerProfile[] = [];
  for (const v of value) {
    if (!v || typeof v !== "object") { continue; }
    const obj = v as Record<string, unknown>;
    const name = typeof obj.name === "string" ? obj.name.trim() : "";
    if (!name) { continue; }
    out.push({
      name,
      flash: sanitizeBind(obj.flash) ?? { kind: "auto" },
      debug: sanitizeBind(obj.debug) ?? { kind: "auto" },
      attach: sanitizeBind(obj.attach) ?? { kind: "auto" },
    });
  }
  return out;
}

function sanitizeBind(value: unknown): RunnerBind | undefined {
  if (!value || typeof value !== "object") { return undefined; }
  const v = value as Record<string, unknown>;
  if (v.kind === "auto") { return { kind: "auto" }; }
  if (v.kind === "runner" && typeof v.runner === "string" && v.runner.trim()) {
    const out: RunnerBind = { kind: "runner", runner: v.runner.trim() };
    if (typeof v.extraArgs === "string" && v.extraArgs.trim()) {
      out.extraArgs = v.extraArgs;
    }
    return out;
  }
  if (v.kind === "launch" && typeof v.name === "string" && v.name.trim()) {
    return { kind: "launch", name: v.name.trim() };
  }
  return undefined;
}

/** Load merged profiles from user settings + workspace `.vscode/zephyr-ide.json`.
 *  Workspace overrides user settings on name collision. */
export function loadRunnerProfiles(wsConfig: WorkspaceConfig): RunnerProfile[] {
  const fromSettings = sanitizeProfiles(
    vscode.workspace.getConfiguration().get<unknown>(USER_SETTINGS_KEY),
  );

  const jsonData = wsConfig.rootPath ? readZephyrIdeJson(wsConfig) : {};
  const fromWorkspace = sanitizeProfiles((jsonData as Record<string, unknown>)[WORKSPACE_JSON_KEY]);

  const merged = new Map<string, RunnerProfile>();
  for (const p of fromSettings) { merged.set(p.name, p); }
  for (const p of fromWorkspace) { merged.set(p.name, p); }
  return Array.from(merged.values());
}

export function findRunnerProfile(name: string, profiles: RunnerProfile[]): RunnerProfile | undefined {
  return profiles.find(p => p.name === name);
}

/**
 * Resolve a `RunnerBind` (plus optional per-build override) to a concrete
 * `{runner, args}` pair, or `undefined` when the caller should use defaults.
 *
 *   - "auto":   returns undefined (caller uses runners.yaml defaults).
 *   - "runner": { runner: bind.runner, args: bind.extraArgs + override.extraArgs }
 *   - "launch": returns undefined (caller routes to launch.json).
 */
export function resolveBind(
  bind: RunnerBind | undefined,
  override?: BindOverride,
): { runner: string; args: string } | undefined {
  if (!bind) { return undefined; }
  switch (bind.kind) {
    case "auto":
      return undefined;
    case "runner": {
      const parts = [bind.extraArgs, override?.extraArgs]
        .map(s => (s ?? "").trim())
        .filter(s => s.length > 0);
      return { runner: bind.runner, args: parts.join(" ") };
    }
    case "launch":
      return undefined;
  }
}

/** Short human-readable label for the bind (used by tree view / status bar / panel). */
export function formatBindLabel(bind: RunnerBind | undefined, override?: BindOverride): string {
  if (!bind) { return "Auto (runners.yaml)"; }
  switch (bind.kind) {
    case "auto":
      return "Auto (runners.yaml)";
    case "runner": {
      const parts = [bind.extraArgs, override?.extraArgs]
        .map(s => (s ?? "").trim())
        .filter(s => s.length > 0);
      const args = parts.join(" ");
      return args ? `${bind.runner} ${args}` : bind.runner;
    }
    case "launch":
      return `launch.json: ${bind.name}`;
  }
}

/** Pretty label for the override portion only (e.g. tree-view child suffix). */
export function formatOverrideLabel(override: BindOverride | undefined): string {
  const extra = (override?.extraArgs ?? "").trim();
  return extra ? `(+ ${extra})` : "";
}

// ---------------------------------------------------------------------------
// CRUD helpers (workspace + user scope)
// ---------------------------------------------------------------------------

export type RunnerProfileScope = "user" | "workspace";

/** Load profiles for each scope without merging. Workspace scope returns `[]` when no workspace is open. */
export function listRunnerProfilesByScope(wsConfig: WorkspaceConfig): {
  user: RunnerProfile[];
  workspace: RunnerProfile[];
} {
  const user = sanitizeProfiles(
    vscode.workspace.getConfiguration().get<unknown>(USER_SETTINGS_KEY),
  );
  let workspace: RunnerProfile[] = [];
  if (wsConfig.rootPath) {
    const jsonData = readZephyrIdeJson(wsConfig);
    workspace = sanitizeProfiles((jsonData as Record<string, unknown>)[WORKSPACE_JSON_KEY]);
  }
  return { user, workspace };
}

/** Read a single profile from the given scope, or `undefined` if missing. */
export function getRunnerProfile(
  wsConfig: WorkspaceConfig,
  scope: RunnerProfileScope,
  name: string,
): RunnerProfile | undefined {
  const { user, workspace } = listRunnerProfilesByScope(wsConfig);
  return (scope === "user" ? user : workspace).find(p => p.name === name);
}

/** Persist `profiles` back to the given scope. */
async function writeProfilesForScope(
  wsConfig: WorkspaceConfig,
  scope: RunnerProfileScope,
  profiles: RunnerProfile[],
): Promise<void> {
  if (scope === "user") {
    await vscode.workspace.getConfiguration().update(
      USER_SETTINGS_KEY,
      profiles,
      vscode.ConfigurationTarget.Global,
    );
    return;
  }
  // Workspace scope -> .vscode/zephyr-ide.json
  if (!wsConfig.rootPath) {
    throw new Error("Cannot save workspace runner profile: no workspace open.");
  }
  const data = readZephyrIdeJson(wsConfig);
  data[WORKSPACE_JSON_KEY] = profiles;
  await writeZephyrIdeJson(wsConfig, data);
}

/**
 * Insert or update a profile by name. If `originalName` is supplied and
 * differs from `profile.name`, the original entry is removed (rename).
 */
export async function saveRunnerProfile(
  wsConfig: WorkspaceConfig,
  scope: RunnerProfileScope,
  profile: RunnerProfile,
  originalName?: string,
): Promise<void> {
  const byScope = listRunnerProfilesByScope(wsConfig);
  const list = scope === "user" ? byScope.user : byScope.workspace;
  const removeName = originalName ?? profile.name;
  const next = list.filter(p => p.name !== removeName && p.name !== profile.name);
  next.push(profile);
  next.sort((a, b) => a.name.localeCompare(b.name));
  await writeProfilesForScope(wsConfig, scope, next);
}

/** Delete a profile by name from the given scope. No-op if missing. */
export async function deleteRunnerProfile(
  wsConfig: WorkspaceConfig,
  scope: RunnerProfileScope,
  name: string,
): Promise<void> {
  const byScope = listRunnerProfilesByScope(wsConfig);
  const list = scope === "user" ? byScope.user : byScope.workspace;
  if (!list.some(p => p.name === name)) { return; }
  const next = list.filter(p => p.name !== name);
  await writeProfilesForScope(wsConfig, scope, next);
}

/** Suggest a unique profile name like "Profile", "Profile 2", "Profile 3" within both scopes. */
export function suggestProfileName(wsConfig: WorkspaceConfig, base: string = "Profile"): string {
  const taken = new Set<string>();
  const { user, workspace } = listRunnerProfilesByScope(wsConfig);
  for (const p of [...user, ...workspace]) { taken.add(p.name); }
  if (!taken.has(base)) { return base; }
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base} ${i}`;
    if (!taken.has(candidate)) { return candidate; }
  }
  return `${base} ${Date.now()}`;
}

