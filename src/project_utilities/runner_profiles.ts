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
 * Runner Profile model.
 *
 * A `RunnerProfile` is a named `{flash, debug, attach}` triplet of bind slots.
 * Profiles live at workspace scope (`.vscode/zephyr-ide.json` -> `runnerProfiles`)
 * with optional user scope (`zephyr-ide.runnerProfiles` setting) for sharing
 * across workspaces. Workspace overrides user on name collision.
 *
 * Bind slots are intentionally thin: either use runners.yaml auto-detection or
 * reference a launch.json entry by name. Legacy runner-shaped binds are still
 * accepted while loading so the workspace migration can convert them to launch
 * entries.
 */

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "upath";
import { WorkspaceConfig } from "../setup_utilities/types";
import { readZephyrIdeJson, writeZephyrIdeJson } from "../setup_utilities/zephyr_ide_json";

export type RunnerBind =
  | { kind: "auto" }
  | { kind: "launch"; name: string; workspaceFolder?: string };

interface LegacyRunnerArgs {
  structured?: { id: string; value?: string }[];
  raw?: string[];
}

export interface RunnerProfile {
  name: string;
  /** Used for both Flash and Build-and-Flash actions. */
  flash: RunnerBind;
  /** Optional Build-and-Debug bind when `zephyr-ide.separateBuildDebugProfile` is enabled. */
  buildDebug?: RunnerBind;
  /** Used for Debug (and Build-and-Debug when buildDebug is unset/disabled). */
  debug: RunnerBind;
  /** Used for Debug Attach. */
  attach: RunnerBind;
}

export type RunnerProfileDictionary = { [name: string]: RunnerProfile };

/**
 * Split a shell-style argument string into individual tokens, respecting
 * single- and double-quoted segments. Quote characters are stripped from the
 * resulting token (POSIX-like), so `--key="some path"` becomes one token.
 */
export function splitArgs(args: string): string[] {
  const out: string[] = [];
  const len = args.length;
  let i = 0;
  let cur = "";
  let inToken = false;

  const pushToken = () => {
    if (inToken) {
      out.push(cur);
      cur = "";
      inToken = false;
    }
  };

  while (i < len) {
    const c = args[i];

    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      pushToken();
      i++;
      continue;
    }

    if (c === '"') {
      inToken = true;
      i++;
      while (i < len && args[i] !== '"') {
        if (args[i] === "\\" && i + 1 < len && (args[i + 1] === '"' || args[i + 1] === "\\")) {
          cur += args[i + 1];
          i += 2;
        } else {
          cur += args[i];
          i++;
        }
      }
      if (i < len) { i++; }
      continue;
    }

    if (c === "'") {
      inToken = true;
      i++;
      while (i < len && args[i] !== "'") {
        cur += args[i];
        i++;
      }
      if (i < len) { i++; }
      continue;
    }

    inToken = true;
    cur += c;
    i++;
  }

  pushToken();
  return out;
}

/** Normalise an unknown serialised `extraArgs` value into a clean `string[]`. */
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

function sanitizeArgValue(v: unknown): { id: string; value?: string } | undefined {
  if (!v || typeof v !== "object") { return undefined; }
  const obj = v as Record<string, unknown>;
  if (typeof obj.id !== "string" || !obj.id) { return undefined; }
  return { id: obj.id, ...(typeof obj.value === "string" ? { value: obj.value } : {}) };
}

function sanitizeRunnerArgs(v: unknown): LegacyRunnerArgs | undefined {
  if (!v || typeof v !== "object") { return undefined; }
  const obj = v as Record<string, unknown>;
  const structured = Array.isArray(obj.structured)
    ? obj.structured.map(sanitizeArgValue).filter((x): x is { id: string; value?: string } => x !== undefined)
    : [];
  const raw = Array.isArray(obj.raw)
    ? obj.raw.filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    : [];
  if (structured.length === 0 && raw.length === 0) { return undefined; }
  return { structured, ...(raw.length > 0 ? { raw } : {}) };
}

function sanitizeBind(value: unknown): RunnerBind | undefined {
  if (!value || typeof value !== "object") { return undefined; }
  const v = value as Record<string, unknown>;
  if (v.kind === "auto") { return { kind: "auto" }; }
  if (v.kind === "runner" && typeof v.runner === "string" && v.runner.trim()) {
    const out: any = { kind: "legacyRunner", runner: v.runner.trim() };
    const extra = normalizeExtraArgs(v.extraArgs);
    if (extra.length > 0) { out.extraArgs = extra; }
    const args = sanitizeRunnerArgs(v.args);
    if (args) { out.args = args; }
    return out as RunnerBind;
  }
  if (v.kind === "legacyRunner" && typeof v.runner === "string" && v.runner.trim()) {
    return v as any;
  }
  if (v.kind === "launch" && typeof v.name === "string" && v.name.trim()) {
    const out: RunnerBind = { kind: "launch", name: v.name.trim() };
    if (typeof v.workspaceFolder === "string" && v.workspaceFolder.trim()) {
      out.workspaceFolder = v.workspaceFolder.trim();
    }
    return out;
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

/** Short human-readable label for the bind (used by tree view / status bar / panel). */
export function formatBindLabel(bind: RunnerBind | undefined): string {
  if (!bind || bind.kind === "auto") { return "Auto (runners.yaml)"; }
  return `launch.json: ${bind.name}`;
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

