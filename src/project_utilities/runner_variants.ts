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

import * as vscode from "vscode";
import { WorkspaceConfig } from "../setup_utilities/types";
import { readZephyrIdeJson } from "../setup_utilities/zephyr_ide_json";
import { notifyError } from "../utilities/output";

export interface RunnerVariant {
  name: string;
  runner: string;  // e.g. "openocd", "blackmagicprobe"
  args: string;    // freeform
}

/** Load merged variants from settings.json (`zephyr-ide.runnerVariants`) and
 *  workspace `.vscode/zephyr-ide.json` (top-level `runnerVariants` array).
 *  Workspace overrides user settings on name collision. */
export function loadRunnerVariants(wsConfig: WorkspaceConfig): RunnerVariant[] {
  const fromSettings = vscode.workspace.getConfiguration().get<RunnerVariant[]>("zephyr-ide.runnerVariants") ?? [];
  
  // Read from workspace .vscode/zephyr-ide.json
  const jsonData = readZephyrIdeJson(wsConfig);
  const fromWorkspace = Array.isArray(jsonData.runnerVariants) 
    ? jsonData.runnerVariants.filter((v: any) => 
        v && typeof v === "object" && typeof v.name === "string" && typeof v.runner === "string"
      ).map((v: any) => ({
        name: v.name,
        runner: v.runner,
        args: typeof v.args === "string" ? v.args : "",
      }))
    : [];
  
  // Workspace overrides user settings on name collision
  const merged = new Map<string, RunnerVariant>();
  for (const variant of fromSettings) {
    merged.set(variant.name, variant);
  }
  for (const variant of fromWorkspace) {
    merged.set(variant.name, variant);
  }
  
  return Array.from(merged.values());
}

export function findRunnerVariant(name: string, variants: RunnerVariant[]): RunnerVariant | undefined {
  return variants.find(v => v.name === name);
}

export type RunnerBind =
  | { kind: "auto" }
  | { kind: "runner";  runner: string;  extraArgs?: string }
  | { kind: "variant"; variant: string; extraArgs?: string }
  | { kind: "launch";  name: string };  // launch.json config; only valid for build/buildDebug/attach

/** Resolve a Bind to a concrete (runner, args) pair.
 *  - "auto":   returns undefined (caller uses defaults)
 *  - "runner": { runner: bind.runner, args: bind.extraArgs ?? "" }
 *  - "variant": looks up variant; returns { runner: v.runner, args: (v.args + " " + (extraArgs ?? "")).trim() } — APPEND
 *  - "launch": returns undefined (caller handles launch.json path)
 *  Returns undefined for any unresolvable bind (with notifyError when missing variant). */
export function resolveBind(bind: RunnerBind, variants: RunnerVariant[]): { runner: string; args: string } | undefined {
  switch (bind.kind) {
    case "auto":
      return undefined;
    
    case "runner":
      return {
        runner: bind.runner,
        args: bind.extraArgs ?? "",
      };
    
    case "variant": {
      const variant = findRunnerVariant(bind.variant, variants);
      if (!variant) {
        notifyError("Runner Variant", `Variant "${bind.variant}" not found. Check zephyr-ide.runnerVariants or .vscode/zephyr-ide.json.`);
        return undefined;
      }
      // APPEND extraArgs to variant args
      const parts = [variant.args, bind.extraArgs].filter(s => s && s.trim());
      return {
        runner: variant.runner,
        args: parts.join(" "),
      };
    }
    
    case "launch":
      return undefined;
  }
}

/** Format a RunnerBind as a short human-readable label for the webview/UI.
 *  - auto:    "Auto (runners.yaml)"
 *  - runner:  "<runner>" or "<runner> <extraArgs>"
 *  - variant: "variant: <name> → <runner> <args>" (resolved if possible) or
 *             "variant: <name> (missing!)" if the variant is unknown.
 *  - launch:  "launch.json: <name>"
 */
export function formatBindLabel(bind: RunnerBind | undefined, variants: RunnerVariant[]): string {
  if (!bind) {
    return "Auto (runners.yaml)";
  }
  switch (bind.kind) {
    case "auto":
      return "Auto (runners.yaml)";
    case "runner": {
      const extra = (bind.extraArgs ?? "").trim();
      return extra ? `${bind.runner} ${extra}` : bind.runner;
    }
    case "variant": {
      const v = findRunnerVariant(bind.variant, variants);
      if (!v) {
        return `variant: ${bind.variant} (missing!)`;
      }
      const extra = (bind.extraArgs ?? "").trim();
      const allArgs = [v.args, extra].filter(s => s && s.trim()).join(" ");
      return allArgs
        ? `variant: ${bind.variant} → ${v.runner} ${allArgs}`
        : `variant: ${bind.variant} → ${v.runner}`;
    }
    case "launch":
      return `launch.json: ${bind.name}`;
  }
}
