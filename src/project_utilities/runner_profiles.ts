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
 * FlashBind — selects how the Flash / Build-and-Flash action is executed.
 *
 *   - "auto":        use `runners.yaml` defaults (west picks the runner).
 *   - "west-flash":  invoke `west flash -r <runner> [extraArgs]`.
 *                    `extraArgs` tokens are appended verbatim after runners.yaml
 *                    args and any per-build `BindOverride.extraArgs`.
 */
export type FlashBind =
  | { kind: "auto" }
  | {
    kind: "west-flash";
    runner: string;
    /** Free-text arg tokens appended verbatim to the west flash command. */
    extraArgs?: string[];
  };

/**
 * DebugBind — selects how a Debug / Attach / Build-and-Debug action is run.
 *
 *   - "auto":          use `runners.yaml` defaults, auto-translated to cortex-debug
 *                      by the `zephyr-ide` debug provider.
 *   - "launch":        reference a `launch.json` configuration by name.
 *                      Any `type` is accepted (`cortex-debug`, `zephyr-ide`, …);
 *                      the config is used as-is with no modification.
 *   - "cortex-debug":  name a Zephyr runner and configure structured options.
 *                      The `zephyr-ide` debug provider auto-fills elf/gdb/target
 *                      from `runners.yaml` and applies `enableRtt` / `probe` on
 *                      top. For advanced overrides (e.g. custom serverArgs, extra
 *                      cortex-debug fields) create a `launch.json` config instead.
 *   - "west-debug":    invoke `west debug-server` and connect cortex-debug as an
 *                      external GDB server. `extraArgs` are forwarded to the
 *                      `west debug-server` command line.
 */
export type DebugBind =
  | { kind: "auto" }
  | { kind: "launch"; name: string }
  | {
    kind: "cortex-debug";
    runner: string;
    /**
     * When `true`, `--enable-rtt` is injected into the west runner args so
     * that the RTT terminal is opened automatically after the session starts.
     * Only valid for runners that support RTT (openocd, jlink, bmp).
     */
    enableRtt?: boolean;
    /**
     * Probe / interface selection.
     * - For `openocd`: path to an OpenOCD interface config (e.g. `interface/stlink.cfg`).
     *   Injected as `--openocd-config <probe>` and any conflicting `interface/*.cfg`
     *   already present in `runners.yaml` args is removed.
     * - For `pyocd`: probe identifier (e.g. `stlink`, `cmsis_dap`).
     *   Injected as `--probe=<probe>`.
     * Ignored for all other runners.
     */
    probe?: string;
  }
  | {
    kind: "west-debug";
    runner: string;
    /** Free-text arg tokens forwarded to `west debug-server` after the runner name. */
    extraArgs?: string[];
  };

/**
 * Backward-compat alias — the old single `RunnerBind` union is the union of
 * both bind kinds. Callers that hold a field of type `RunnerBind` should be
 * migrated to use `FlashBind` or `DebugBind` directly; this alias only exists
 * to smooth the compiler errors during the transition.
 * @deprecated Use `FlashBind` (for flash) or `DebugBind` (for debug/attach).
 */
export type RunnerBind = FlashBind | DebugBind;

export interface RunnerProfile {
  name: string;
  /** Used for both Flash and Build-and-Flash actions. */
  flash: FlashBind;
  /**
   * Used exclusively for Build-and-Debug when `zephyr-ide.separateBuildDebugProfile` is enabled.
   * When the setting is disabled this field is ignored and `debug` drives both actions.
   * Optional: omit (or leave undefined) to fall back to the `debug` bind for Build-and-Debug.
   */
  buildDebug?: DebugBind;
  /** Used for Debug (and Build-and-Debug when `buildDebug` is not set or the setting is disabled). */
  debug: DebugBind;
  /** Used for Debug Attach. */
  attach: DebugBind;
}

export type RunnerProfileDictionary = { [name: string]: RunnerProfile };

/**
 * Per-slot override that a `BuildConfig` may add on top of its referenced
 * profile. Only meaningful for slots whose profile kind is `west-flash` or
 * `west-debug` (i.e. the kinds that carry free-text `extraArgs`).
 * `cortex-debug`, `launch`, and `auto` slots ignore overrides.
 */
export interface BindOverride {
  /** Raw arg tokens appended after the profile's extraArgs. */
  extraArgs?: string[];
}

/**
 * Split a shell-style argument string into individual tokens, respecting
 * single- and double-quoted segments. Quote characters are stripped from the
 * resulting token (POSIX-like), so `--key="some path"` becomes the single
 * token `--key=some path`. Inside double quotes, `\\` and `\"` are recognised
 * as escapes for literal backslash and double-quote.
 *
 * This is a small, dependency-free parser — runner extraArgs are simple
 * key/value pairs, not arbitrary shell expressions (no env-var expansion,
 * globbing, or command substitution). Unterminated quoted strings are
 * consumed to end-of-input rather than dropped so a typo doesn't silently
 * swallow the rest of the user's input.
 *
 * Used in three places: migrating legacy string-valued `extraArgs`, parsing
 * user input from the profile editor text boxes, and re-tokenising args
 * after `resolveRunnerArgs` variable substitution before they are forwarded
 * to cortex-debug as `serverArgs` (see debug-provider).
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
      if (i < len) { i++; } // consume closing quote
      continue;
    }

    if (c === "'") {
      inToken = true;
      i++;
      while (i < len && args[i] !== "'") {
        cur += args[i];
        i++;
      }
      if (i < len) { i++; } // consume closing quote
      continue;
    }

    inToken = true;
    cur += c;
    i++;
  }

  pushToken();
  return out;
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
    const buildDebug = sanitizeDebugBind(obj.buildDebug);
    const profile: RunnerProfile = {
      name,
      flash: sanitizeFlashBind(obj.flash) ?? { kind: "auto" },
      debug: sanitizeDebugBind(obj.debug) ?? { kind: "auto" },
      attach: sanitizeDebugBind(obj.attach) ?? { kind: "auto" },
    };
    if (buildDebug) { profile.buildDebug = buildDebug; }
    out.push(profile);
  }
  return out;
}

function sanitizeFlashBind(value: unknown): FlashBind | undefined {
  if (!value || typeof value !== "object") { return undefined; }
  const v = value as Record<string, unknown>;
  if (v.kind === "auto") { return { kind: "auto" }; }
  if (v.kind === "west-flash" && typeof v.runner === "string" && v.runner.trim()) {
    const out: FlashBind = { kind: "west-flash", runner: v.runner.trim() };
    const extra = normalizeExtraArgs(v.extraArgs);
    if (extra.length > 0) { out.extraArgs = extra; }
    return out;
  }
  // Legacy: "runner" kind maps to "west-flash".
  if (v.kind === "runner" && typeof v.runner === "string" && v.runner.trim()) {
    const out: FlashBind = { kind: "west-flash", runner: v.runner.trim() };
    const extra = normalizeExtraArgs(v.extraArgs);
    if (extra.length > 0) { out.extraArgs = extra; }
    return out;
  }
  return undefined;
}

function sanitizeDebugBind(value: unknown): DebugBind | undefined {
  if (!value || typeof value !== "object") { return undefined; }
  const v = value as Record<string, unknown>;
  if (v.kind === "auto") { return { kind: "auto" }; }
  if (v.kind === "launch" && typeof v.name === "string" && v.name.trim()) {
    return { kind: "launch", name: v.name.trim() };
  }
  // Legacy: "zephyr-launch" maps to "launch" (merged).
  if (v.kind === "zephyr-launch" && typeof v.name === "string" && v.name.trim()) {
    return { kind: "launch", name: v.name.trim() };
  }
  if (v.kind === "cortex-debug" && typeof v.runner === "string" && v.runner.trim()) {
    const out: DebugBind = { kind: "cortex-debug", runner: v.runner.trim() };
    if (v.enableRtt === true) { out.enableRtt = true; }
    if (typeof v.probe === "string" && v.probe.trim()) { out.probe = v.probe.trim(); }
    return out;
  }
  if (v.kind === "west-debug" && typeof v.runner === "string" && v.runner.trim()) {
    const out: DebugBind = { kind: "west-debug", runner: v.runner.trim() };
    const extra = normalizeExtraArgs(v.extraArgs);
    if (extra.length > 0) { out.extraArgs = extra; }
    return out;
  }
  // Legacy: "runner" kind in a debug slot maps to "cortex-debug".
  if (v.kind === "runner" && typeof v.runner === "string" && v.runner.trim()) {
    const out: DebugBind = { kind: "cortex-debug", runner: v.runner.trim() };
    // Migrate --enable-rtt from extraArgs to structured field.
    const rawArgs = normalizeExtraArgs(v.extraArgs);
    if (rawArgs.includes("--enable-rtt")) { out.enableRtt = true; }
    return out;
  }
  return undefined;
}

/** @deprecated Use sanitizeFlashBind / sanitizeDebugBind. */
function sanitizeBind(value: unknown): RunnerBind | undefined {
  return sanitizeFlashBind(value) ?? sanitizeDebugBind(value);
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
 * Resolve a `FlashBind` or `DebugBind` (plus optional per-build override) to
 * a concrete `{runner, args}` pair, or `undefined` when the caller should use
 * defaults or launch a named config.
 *
 *   - "auto":         returns undefined (caller uses runners.yaml defaults).
 *   - "west-flash":   returns { runner, args } combining profile extraArgs + override.
 *   - "west-debug":   returns { runner, args } combining profile extraArgs + override.
 *   - "cortex-debug": returns { runner, args: "" } (structured fields, no free args).
 *   - "launch":       returns undefined (caller routes to launch.json).
 *
 * NOTE: For the full three-layer merge (structured + yaml + build override),
 * use `runner_arg_resolver.mergeArgLayers` instead. This function is the
 * lightweight path used when only the combined west args string is needed
 * (e.g. flash command assembly).
 */
export function resolveBind(
  bind: FlashBind | DebugBind | undefined,
  override?: BindOverride,
): { runner: string; args: string } | undefined {
  if (!bind) { return undefined; }
  switch (bind.kind) {
    case "auto":
      return undefined;
    case "west-flash": {
      const parts: string[] = [
        ...(bind.extraArgs ?? []),
        ...(override?.extraArgs ?? []),
      ].map(s => s.trim()).filter(s => s.length > 0);
      return { runner: bind.runner, args: parts.join(" ") };
    }
    case "west-debug": {
      const parts: string[] = [
        ...(bind.extraArgs ?? []),
        ...(override?.extraArgs ?? []),
      ].map(s => s.trim()).filter(s => s.length > 0);
      return { runner: bind.runner, args: parts.join(" ") };
    }
    case "cortex-debug":
      return { runner: bind.runner, args: "" };
    case "launch":
      return undefined;
  }
}

/** Short human-readable label for a flash bind (used by tree view / status bar / panel). */
export function formatFlashBindLabel(bind: FlashBind | undefined, override?: BindOverride): string {
  if (!bind) { return "Auto (runners.yaml)"; }
  switch (bind.kind) {
    case "auto":
      return "Auto (runners.yaml)";
    case "west-flash": {
      const parts = [...(bind.extraArgs ?? []), ...(override?.extraArgs ?? [])]
        .map(s => s.trim())
        .filter(s => s.length > 0);
      const args = parts.join(" ");
      return args ? `${bind.runner} ${args}` : bind.runner;
    }
  }
}

/** Short human-readable label for a debug/attach bind. */
export function formatDebugBindLabel(bind: DebugBind | undefined, override?: BindOverride): string {
  if (!bind) { return "Auto (runners.yaml)"; }
  switch (bind.kind) {
    case "auto":
      return "Auto (runners.yaml)";
    case "launch":
      return `launch.json: ${bind.name}`;
    case "cortex-debug": {
      const extras: string[] = [];
      if (bind.enableRtt) { extras.push("RTT"); }
      if (bind.probe) { extras.push(`probe: ${bind.probe}`); }
      return extras.length > 0 ? `${bind.runner} (${extras.join(", ")})` : bind.runner;
    }
    case "west-debug": {
      const parts = [...(bind.extraArgs ?? []), ...(override?.extraArgs ?? [])]
        .map(s => s.trim())
        .filter(s => s.length > 0);
      const args = parts.join(" ");
      return args ? `west-debug: ${bind.runner} ${args}` : `west-debug: ${bind.runner}`;
    }
  }
}

/**
 * Short human-readable label for any bind (flash or debug).
 * Delegates to the appropriate typed helper.
 */
export function formatBindLabel(bind: FlashBind | DebugBind | undefined, override?: BindOverride): string {
  if (!bind) { return "Auto (runners.yaml)"; }
  switch (bind.kind) {
    case "auto": return "Auto (runners.yaml)";
    case "west-flash": return formatFlashBindLabel(bind, override);
    case "west-debug": return formatDebugBindLabel(bind, override);
    case "cortex-debug": return formatDebugBindLabel(bind, override);
    case "launch": return formatDebugBindLabel(bind, override);
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
  // Find the position of the entry being replaced (rename or in-place save).
  const existingIdx = list.findIndex(p => p.name === removeName);
  // Remove both the old-named entry and any accidental duplicate with the new name.
  const next = list.filter(p => p.name !== removeName && p.name !== profile.name);
  if (existingIdx >= 0) {
    // In-place update or rename: preserve original list position.
    const insertAt = Math.min(existingIdx, next.length);
    next.splice(insertAt, 0, profile);
  } else {
    // New profile: append at the end so the user sees it at the bottom.
    next.push(profile);
  }
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

