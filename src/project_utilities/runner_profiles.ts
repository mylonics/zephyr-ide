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
 *
 * ## Variable substitution in runner args
 *
 * Both the profile's `extraArgs` and the per-build `BindOverride.extraArgs`
 * support VS Code–style `${...}` expressions resolved by `resolveRunnerArgs`.
 * All resolved values are plain strings; unknown expressions are left intact
 * for VS Code's own resolver (debug-config path).
 *
 * | Expression              | Resolves to                                           |
 * |-------------------------|-------------------------------------------------------|
 * | `${workspaceFolder}`    | Workspace root path                                   |
 * | `${buildFolder}`        | Build output directory                                |
 * | `${board}`              | Board name (e.g. `nucleo_f401re`)                     |
 * | `${boardRevision}`      | Board revision, or `""` when not set                  |
 * | `${project}`            | Project name                                          |
 * | `${build}`              | Build configuration name                              |
 * | `${buildvar:key}`       | Per-build custom variable (see `BuildConfig.customVars`) |
 * | `${projectvar:key}`     | Per-project custom variable (see `ProjectConfig.customVars`) |
 * | `${cmake:VAR}`          | Value from the build's `CMakeCache.txt` (case-insensitive) |
 * | `${kconfig:VAR}`        | Kconfig value from `zephyr/.config` (with/without `CONFIG_` prefix; strings unquoted) |
 * | `${env:VAR}`            | `process.env` value, or `""` when unset               |
 * | `${config:some.key}`    | VS Code workspace/user configuration value            |
 * | anything else           | Left unchanged (VS Code resolves later)               |
 *
 * Custom build/project variables can be edited interactively via the
 * `zephyr-ide.manage-build-variables` and `zephyr-ide.manage-project-variables`
 * commands, and referenced inside `tasks.json` / `launch.json` inputs through
 * the `zephyr-ide.get-active-build-variable` /
 * `zephyr-ide.get-active-project-variable` input commands.
 */

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "upath";
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
  | { kind: "runner"; runner: string; extraArgs?: string[] }
  | { kind: "launch"; name: string };

export interface RunnerProfile {
  name: string;
  /** Used for both Flash and Build-and-Flash actions. `launch` is invalid here. */
  flash: RunnerBind;
  /**
   * Used exclusively for Build-and-Debug when `zephyr-ide.separateBuildDebugProfile` is enabled.
   * When the setting is disabled this field is ignored and `debug` drives both actions.
   * Optional: omit (or leave undefined) to fall back to the `debug` bind for Build-and-Debug.
   */
  buildDebug?: RunnerBind;
  /** Used for Debug (and Build-and-Debug when `buildDebug` is not set or the setting is disabled). */
  debug: RunnerBind;
  /** Used for Debug Attach. */
  attach: RunnerBind;
}

export type RunnerProfileDictionary = { [name: string]: RunnerProfile };

/** Per-slot override that a `BuildConfig` may add on top of its referenced
 *  profile. Only meaningful for slots whose profile kind is `runner`. */
export interface BindOverride {
  /** Extra args appended after the profile's resolved args. */
  extraArgs?: string[];
}

/**
 * Split a shell-style argument string into individual tokens, respecting
 * single- and double-quoted segments (the quote characters are preserved in
 * the token). Used when migrating legacy string-valued `extraArgs` and when
 * parsing user input from text boxes.
 */
export function splitArgs(s: string): string[] {
  const trimmed = s.trim();
  if (!trimmed) { return []; }
  const result: string[] = [];
  let current = "";
  let inQuote = false;
  let quoteChar = "";
  for (const ch of trimmed) {
    if (inQuote) {
      current += ch;
      if (ch === quoteChar) { inQuote = false; }
    } else if (ch === '"' || ch === "'") {
      inQuote = true;
      quoteChar = ch;
      current += ch;
    } else if (/\s/.test(ch)) {
      if (current) { result.push(current); current = ""; }
    } else {
      current += ch;
    }
  }
  if (current) { result.push(current); }
  return result;
}

/** Normalise an unknown serialised `extraArgs` value (string for legacy data,
 *  string[] for current format) into a clean `string[]`. */
function normalizeExtraArgs(v: unknown): string[] {
  if (Array.isArray(v)) {
    return v.filter((s): s is string => typeof s === "string" && s.trim().length > 0)
            .map(s => s.trim());
  }
  if (typeof v === "string" && v.trim()) {
    return splitArgs(v);
  }
  return [];
}

export interface BuildBindOverrides {
  flash?: BindOverride;
  buildDebug?: BindOverride;
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
    const buildDebug = sanitizeBind(obj.buildDebug);
    const profile: RunnerProfile = {
      name,
      flash: sanitizeBind(obj.flash) ?? { kind: "auto" },
      debug: sanitizeBind(obj.debug) ?? { kind: "auto" },
      attach: sanitizeBind(obj.attach) ?? { kind: "auto" },
    };
    if (buildDebug) { profile.buildDebug = buildDebug; }
    out.push(profile);
  }
  return out;
}

function sanitizeBind(value: unknown): RunnerBind | undefined {
  if (!value || typeof value !== "object") { return undefined; }
  const v = value as Record<string, unknown>;
  if (v.kind === "auto") { return { kind: "auto" }; }
  if (v.kind === "runner" && typeof v.runner === "string" && v.runner.trim()) {
    const out: RunnerBind = { kind: "runner", runner: v.runner.trim() };
    const extra = normalizeExtraArgs(v.extraArgs);
    if (extra.length > 0) { out.extraArgs = extra; }
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
      const parts = [...(bind.extraArgs ?? []), ...(override?.extraArgs ?? [])]
        .map(s => s.trim())
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
      const parts = [...(bind.extraArgs ?? []), ...(override?.extraArgs ?? [])]
        .map(s => s.trim())
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
  const parts = (override?.extraArgs ?? []).filter(s => s.trim().length > 0);
  const extra = parts.join(" ");
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

// ---------------------------------------------------------------------------
// Variable resolution for runner args
// ---------------------------------------------------------------------------

/**
 * Read an arbitrary key from a build's CMakeCache.txt.
 * CMakeCache format: `KEY:TYPE=VALUE` (or occasionally `KEY=VALUE`).
 * Matching is case-insensitive. Returns undefined when the file or key is absent.
 */
function readCmakeCacheVar(buildFolder: string, varName: string): string | undefined {
  const cachePath = path.join(buildFolder, "CMakeCache.txt");
  if (!fs.existsSync(cachePath)) { return undefined; }
  const upper = varName.toUpperCase();
  for (const line of fs.readFileSync(cachePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("#")) { continue; }
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) { continue; }
    const keyPart = trimmed.slice(0, eqIdx).split(":")[0].trim();
    if (keyPart.toUpperCase() === upper) {
      return trimmed.slice(eqIdx + 1);
    }
  }
  return undefined;
}

/**
 * Read a Kconfig value from a build's `zephyr/.config`.
 * The variable name may be supplied with or without the `CONFIG_` prefix.
 * String values have surrounding quotes stripped.
 * Returns `"n"` for explicitly unset symbols, undefined when not found.
 */
function readKconfigVar(buildFolder: string, varName: string): string | undefined {
  const dotConfigPath = path.join(buildFolder, "zephyr", ".config");
  if (!fs.existsSync(dotConfigPath)) { return undefined; }
  const key = varName.startsWith("CONFIG_") ? varName : `CONFIG_${varName}`;
  const prefix = `${key}=`;
  for (const line of fs.readFileSync(dotConfigPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith(prefix)) {
      let val = trimmed.slice(prefix.length);
      if (val.startsWith('"') && val.endsWith('"')) {
        val = val.slice(1, -1);
      }
      return val;
    }
    if (trimmed === `# ${key} is not set`) {
      return "n";
    }
  }
  return undefined;
}

/**
 * Context values available for variable substitution in runner profile arguments.
 */
export interface RunnerVarContext {
  /** Absolute path to the VS Code workspace root. */
  workspaceFolder: string;
  /** Absolute path to the build output directory (e.g. `.../myproject/myboard`). */
  buildFolder: string;
  /** Board name (e.g. `nucleo_f401re`). */
  board: string;
  /** Board revision, or empty string if not set. */
  boardRevision: string;
  /** Project name as shown in the Zephyr IDE Projects panel. */
  project: string;
  /** Build configuration name. */
  build: string;
  /** Custom variables from `BuildConfig.customVars`. */
  buildVars?: Record<string, string>;
  /** Custom variables from `ProjectConfig.customVars`. */
  projectVars?: Record<string, string>;
}

/**
 * Perform VS Code-style variable substitution on a runner args string.
 *
 * Supported variables:
 *   - `${workspaceFolder}`  — workspace root path
 *   - `${buildFolder}`      — build output directory
 *   - `${board}`            — board name
 *   - `${boardRevision}`    — board revision (empty string when not set)
 *   - `${project}`          — project name
 *   - `${build}`            — build configuration name
 *   - `${buildvar:key}`     — custom build variable (defined in Zephyr IDE project settings)
 *   - `${projectvar:key}`   — custom project variable (defined in Zephyr IDE project settings)
 *   - `${cmake:VAR_NAME}`   — any key from the build's CMakeCache.txt
 *   - `${kconfig:VAR}`      — Kconfig value from the build's zephyr/.config
 *                             (accepts with or without the `CONFIG_` prefix;
 *                              string values are unquoted automatically)
 *   - `${env:VAR_NAME}`     — environment variable value (empty string when unset)
 *   - `${config:some.key}`  — VS Code workspace/user configuration value
 *
 * Unknown `${...}` expressions are left unchanged so they can be resolved
 * later by VS Code's own variable substitution pass (debug path only).
 */
export function resolveRunnerArgs(args: string, ctx: RunnerVarContext): string {
  return args.replace(/\$\{([^}]+)\}/g, (match, expr: string) => {
    switch (expr) {
      case "workspaceFolder": return ctx.workspaceFolder;
      case "buildFolder": return ctx.buildFolder;
      case "board": return ctx.board;
      case "boardRevision": return ctx.boardRevision;
      case "project": return ctx.project;
      case "build": return ctx.build;
    }
    if (expr.startsWith("buildvar:")) {
      return ctx.buildVars?.[expr.slice(9)] ?? "";
    }
    if (expr.startsWith("projectvar:")) {
      return ctx.projectVars?.[expr.slice(11)] ?? "";
    }
    if (expr.startsWith("env:")) {
      return process.env[expr.slice(4)] ?? "";
    }
    if (expr.startsWith("cmake:")) {
      return readCmakeCacheVar(ctx.buildFolder, expr.slice(6)) ?? "";
    }
    if (expr.startsWith("kconfig:")) {
      return readKconfigVar(ctx.buildFolder, expr.slice(8)) ?? "";
    }
    if (expr.startsWith("config:")) {
      const key = expr.slice(7);
      const val = vscode.workspace.getConfiguration().get(key);
      if (val === undefined || val === null) { return ""; }
      return typeof val === "string" ? val : String(val);
    }
    // Leave unknown expressions intact (VS Code resolves them for debug configs).
    return match;
  });
}

