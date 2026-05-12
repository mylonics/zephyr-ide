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
 * Persistence helpers for `RunnerVariant` lists in the two supported scopes:
 *   - "user":      `zephyr-ide.runnerVariants` in the user/global VS Code settings.
 *   - "workspace": top-level `runnerVariants` array in `.vscode/zephyr-ide.json`.
 *
 * `loadRunnerVariants(wsConfig)` (in `runner_variants.ts`) merges the two with
 * workspace-overrides-user semantics. These helpers operate on each scope
 * independently so the variant editor UI can show and mutate each list separately.
 */

import * as vscode from "vscode";
import { WorkspaceConfig } from "../setup_utilities/types";
import { readZephyrIdeJson, writeZephyrIdeJson } from "../setup_utilities/zephyr_ide_json";
import { RunnerVariant } from "./runner_variants";

export type VariantScope = "user" | "workspace";

const USER_SETTINGS_KEY = "zephyr-ide.runnerVariants";

/** Sanitize an unknown blob into a list of `RunnerVariant`s, dropping malformed entries. */
function sanitizeVariants(value: unknown): RunnerVariant[] {
  if (!Array.isArray(value)) { return []; }
  const out: RunnerVariant[] = [];
  for (const v of value) {
    if (!v || typeof v !== "object") { continue; }
    const name = typeof (v as any).name === "string" ? (v as any).name.trim() : "";
    const runner = typeof (v as any).runner === "string" ? (v as any).runner.trim() : "";
    const args = typeof (v as any).args === "string" ? (v as any).args : "";
    if (!name || !runner) { continue; }
    out.push({ name, runner, args });
  }
  return out;
}

/** Read user-scope variants from `zephyr-ide.runnerVariants` (global settings only). */
export function readUserVariants(): RunnerVariant[] {
  const inspected = vscode.workspace.getConfiguration().inspect<RunnerVariant[]>(USER_SETTINGS_KEY);
  return sanitizeVariants(inspected?.globalValue);
}

/** Persist user-scope variants to `zephyr-ide.runnerVariants` (global). */
export async function writeUserVariants(variants: RunnerVariant[]): Promise<void> {
  await vscode.workspace.getConfiguration().update(
    USER_SETTINGS_KEY,
    variants.length > 0 ? variants : undefined,
    vscode.ConfigurationTarget.Global,
  );
}

/** Read workspace-scope variants from `.vscode/zephyr-ide.json`'s `runnerVariants` array. */
export function readWorkspaceVariants(wsConfig: WorkspaceConfig): RunnerVariant[] {
  const data = readZephyrIdeJson(wsConfig);
  return sanitizeVariants(data.runnerVariants);
}

/** Persist workspace-scope variants to `.vscode/zephyr-ide.json`. */
export async function writeWorkspaceVariants(wsConfig: WorkspaceConfig, variants: RunnerVariant[]): Promise<void> {
  const data = readZephyrIdeJson(wsConfig);
  if (variants.length === 0) {
    delete data.runnerVariants;
  } else {
    data.runnerVariants = variants;
  }
  await writeZephyrIdeJson(wsConfig, data);
}

export function readVariantsForScope(scope: VariantScope, wsConfig: WorkspaceConfig): RunnerVariant[] {
  return scope === "user" ? readUserVariants() : readWorkspaceVariants(wsConfig);
}

export async function writeVariantsForScope(scope: VariantScope, wsConfig: WorkspaceConfig, variants: RunnerVariant[]): Promise<void> {
  if (scope === "user") {
    await writeUserVariants(variants);
  } else {
    await writeWorkspaceVariants(wsConfig, variants);
  }
}

/** Generate a unique variant name within `existing`. Appends -2, -3, … as needed. */
export function uniqueVariantName(base: string, existing: Iterable<string>): string {
  const seen = new Set(existing);
  const trimmed = (base || "variant").trim() || "variant";
  if (!seen.has(trimmed)) { return trimmed; }
  for (let i = 2; i < 1000; i++) {
    const candidate = `${trimmed}-${i}`;
    if (!seen.has(candidate)) { return candidate; }
  }
  return `${trimmed}-${Date.now()}`;
}

export interface VariantValidationError {
  field: "name" | "runner";
  message: string;
}

/** Validate a single variant within a scope. `originalName` is set when editing in place. */
export function validateVariant(
  candidate: RunnerVariant,
  scopeVariants: RunnerVariant[],
  originalName?: string,
): VariantValidationError | undefined {
  const name = candidate.name.trim();
  if (!name) { return { field: "name", message: "Variant name cannot be empty." }; }
  if (!candidate.runner.trim()) { return { field: "runner", message: "Variant runner cannot be empty." }; }
  for (const existing of scopeVariants) {
    if (existing.name === name && existing.name !== originalName) {
      return { field: "name", message: `A variant named "${name}" already exists in this scope.` };
    }
  }
  return undefined;
}
