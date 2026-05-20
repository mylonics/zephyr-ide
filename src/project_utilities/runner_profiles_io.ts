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
 * Persistence helpers for `RunnerProfile` lists in the two supported scopes:
 *   - "user":      `zephyr-ide.runnerProfiles` in user/global VS Code settings.
 *   - "workspace": top-level `runnerProfiles` array in `.vscode/zephyr-ide.json`.
 *
 * `loadRunnerProfiles(wsConfig)` (in `runner_profiles.ts`) merges the two with
 * workspace-overrides-user semantics. These helpers operate on each scope
 * independently so the profile editor UI can show and mutate each list separately.
 */

import * as vscode from "vscode";
import { WorkspaceConfig } from "../setup_utilities/types";
import { readZephyrIdeJson, writeZephyrIdeJson } from "../setup_utilities/zephyr_ide_json";
import { RunnerProfile, RunnerBind } from "./runner_profiles";

export type ProfileScope = "user" | "workspace";

const USER_SETTINGS_KEY = "zephyr-ide.runnerProfiles";
const WORKSPACE_JSON_KEY = "runnerProfiles";

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

/** Read user-scope profiles from `zephyr-ide.runnerProfiles` (global settings only). */
export function readUserProfiles(): RunnerProfile[] {
  const inspected = vscode.workspace.getConfiguration().inspect<unknown>(USER_SETTINGS_KEY);
  return sanitizeProfiles(inspected?.globalValue);
}

/** Persist user-scope profiles to `zephyr-ide.runnerProfiles` (global). */
export async function writeUserProfiles(profiles: RunnerProfile[]): Promise<void> {
  await vscode.workspace.getConfiguration().update(
    USER_SETTINGS_KEY,
    profiles.length > 0 ? profiles : undefined,
    vscode.ConfigurationTarget.Global,
  );
}

/** Read workspace-scope profiles from `.vscode/zephyr-ide.json`'s `runnerProfiles` array. */
export function readWorkspaceProfiles(wsConfig: WorkspaceConfig): RunnerProfile[] {
  const data = readZephyrIdeJson(wsConfig);
  return sanitizeProfiles((data as Record<string, unknown>)[WORKSPACE_JSON_KEY]);
}

/** Persist workspace-scope profiles to `.vscode/zephyr-ide.json`. */
export async function writeWorkspaceProfiles(wsConfig: WorkspaceConfig, profiles: RunnerProfile[]): Promise<void> {
  const data = readZephyrIdeJson(wsConfig) as Record<string, unknown>;
  if (profiles.length === 0) {
    delete data[WORKSPACE_JSON_KEY];
  } else {
    data[WORKSPACE_JSON_KEY] = profiles;
  }
  await writeZephyrIdeJson(wsConfig, data);
}

export function readProfilesForScope(scope: ProfileScope, wsConfig: WorkspaceConfig): RunnerProfile[] {
  return scope === "user" ? readUserProfiles() : readWorkspaceProfiles(wsConfig);
}

export async function writeProfilesForScope(scope: ProfileScope, wsConfig: WorkspaceConfig, profiles: RunnerProfile[]): Promise<void> {
  if (scope === "user") {
    await writeUserProfiles(profiles);
  } else {
    await writeWorkspaceProfiles(wsConfig, profiles);
  }
}

/** Generate a unique profile name within `existing`. Appends -2, -3, … as needed. */
export function uniqueProfileName(base: string, existing: Iterable<string>): string {
  const seen = new Set(existing);
  const trimmed = (base || "profile").trim() || "profile";
  if (!seen.has(trimmed)) { return trimmed; }
  for (let i = 2; i < 1000; i++) {
    const candidate = `${trimmed}-${i}`;
    if (!seen.has(candidate)) { return candidate; }
  }
  return `${trimmed}-${Date.now()}`;
}

export interface ProfileValidationError {
  field: "name";
  message: string;
}

/** Validate a single profile within a scope. `originalName` is set when editing in place. */
export function validateProfile(
  candidate: RunnerProfile,
  scopeProfiles: RunnerProfile[],
  originalName?: string,
): ProfileValidationError | undefined {
  const name = candidate.name.trim();
  if (!name) { return { field: "name", message: "Profile name cannot be empty." }; }
  for (const existing of scopeProfiles) {
    if (existing.name === name && existing.name !== originalName) {
      return { field: "name", message: `A profile named "${name}" already exists in this scope.` };
    }
  }
  return undefined;
}
