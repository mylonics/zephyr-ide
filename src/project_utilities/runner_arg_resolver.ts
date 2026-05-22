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
 * Three-layer runner argument resolver.
 *
 * Resolves the final set of runner arguments for a given slot by merging:
 *   1. **Profile layer** — structured args from the active `RunnerProfile`.
 *   2. **YAML layer**    — args from runners.yaml that are NOT already set by
 *      the profile (i.e. fills gaps, never overrides).
 *   3. **Build layer**   — per-build `BuildSlotOverride` that can: override
 *      individual arg values, remove args from lower layers, or add new ones.
 *
 * The resolved output (`ResolvedArgs`) can then be emitted as:
 *   - A west CLI argument list (`toWestArgs`) for `west flash` / `west debug`.
 *   - A cortex-debug configuration patch (`toCortexDebugPatch`) for the
 *     debug-provider translation layer.
 *
 * ## Key design decisions
 *
 * - **Neutral canonical form** — args are stored as `{ id, value? }` objects.
 *   West flags and cortex-debug properties are both *derived* representations.
 * - **Schema-less args** — unknown/custom flags live in parallel `raw: string[]`
 *   arrays and are appended verbatim to the west command or left out of the
 *   cortex-debug config (they can be added to `serverArgs` for jlink/pyocd/etc
 *   by the caller if desired).
 * - **Per-`id` provenance** — every resolved entry carries a `source` so the UI
 *   can badge values as "yaml", "profile", or "build".
 * - **Multi-value args** — schema entries with `multi: true` can appear many
 *   times; they are stored as separate `ArgValue` entries sharing the same `id`,
 *   disambiguated by their sequential occurrence.
 */

import { findArgDefByWestFlag, getSchemaFor } from "./runner_arg_schema";
import type { ArgDef } from "./runner_arg_schema";

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

/** Source layer from which a resolved arg came. */
export type ArgSource = "profile" | "yaml" | "build";

/**
 * A single structured arg value in canonical form.
 * For `type === "bool"` args, `value` is always `undefined` — presence in
 * the array means the flag is enabled.
 */
export interface ArgValue {
  id: string;
  value?: string;
}

/**
 * Structured + raw args as stored in a `RunnerBind` (kind === "runner") or
 * a build-level addition.
 */
export interface RunnerArgs {
  /** Schema-known structured args. */
  structured: ArgValue[];
  /** Unknown/custom west flags, e.g. ["--some-vendor-flag", "val"]. */
  raw?: string[];
}

/**
 * Per-build per-slot override stored in `BuildBindOverrides[slot]`.
 * Extends the old `BindOverride` which only had `extraArgs?: string[]`.
 */
export interface BuildSlotOverride {
  /**
   * Override the *value* of an existing structured arg from the profile or
   * yaml layer. Key = ArgDef.id, value = new value string (or `undefined`
   * to clear a value-bearing arg, effectively disabling it).
   * Set `removed` to fully suppress an arg's presence.
   */
  overrides?: Record<string, string | undefined>;

  /**
   * Arg ids to suppress entirely (remove from the merged output).
   * Applies to both profile-sourced and yaml-sourced entries.
   */
  removed?: string[];

  /**
   * New schema-known args to add at build level (beyond what profile+yaml provide).
   */
  additions?: ArgValue[];

  /**
   * Raw flag strings added at build level (escape hatch).
   */
  rawAdditions?: string[];
}

/**
 * A single arg in the resolved / merged output, annotated with its source layer.
 */
export interface ResolvedArgEntry extends ArgValue {
  source: ArgSource;
}

/**
 * Final merged output from `mergeArgLayers`.
 */
export interface ResolvedArgs {
  runner: string;
  /** Merged structured args in declaration order with provenance. */
  structured: ResolvedArgEntry[];
  /** All raw args concatenated (profile raw → yaml raw → build raw). */
  raw: string[];
}

// ---------------------------------------------------------------------------
// YAML arg parser
// ---------------------------------------------------------------------------

/**
 * Parse a `runners.yaml args[runner]` string array (west-style flag argv)
 * into structured `ArgValue[]`, using the schema to recognise known flags.
 * Unknown flags are returned in `raw`.
 *
 * @param runner - Zephyr runner name (e.g. "openocd", "jlink").
 * @param yamlFlags - The `args[runner]` array from runners.yaml.
 */
export function parseYamlArgs(
  runner: string,
  yamlFlags: string[],
): { structured: ArgValue[]; raw: string[] } {
  const structured: ArgValue[] = [];
  const raw: string[] = [];
  const schema = getSchemaFor(runner);

  let i = 0;
  while (i < yamlFlags.length) {
    const token = yamlFlags[i];

    // Try key=value first (e.g. "--device=STM32F401RE").
    const eqIdx = token.indexOf("=");
    let matched = false;

    if (eqIdx > 0) {
      const flag = token.slice(0, eqIdx);
      const value = token.slice(eqIdx + 1);
      const def = findArgDefByWestFlag(runner, flag);
      if (def && def.west.takesValue) {
        structured.push({ id: def.id, value });
        matched = true;
      }
    }

    if (!matched) {
      const def = findArgDefByWestFlag(runner, token);
      if (def) {
        if (def.west.takesValue) {
          const next = yamlFlags[i + 1];
          if (next !== undefined) {
            structured.push({ id: def.id, value: next });
            i += 2;
            continue;
          }
          // Flag without value — add as bool-like with empty value.
          structured.push({ id: def.id, value: "" });
        } else {
          // Boolean flag — presence only.
          structured.push({ id: def.id });
        }
        matched = true;
      }
    }

    if (!matched) {
      raw.push(token);
    }
    i++;
  }

  // Validate: remove any schema entries that are set to slots incompatible
  // with the context. Callers pass slot info via mergeArgLayers so we don't
  // filter here — that keeps this function pure.
  void schema;

  return { structured, raw };
}

// ---------------------------------------------------------------------------
// Three-layer merge
// ---------------------------------------------------------------------------

/**
 * Options controlling the merge behaviour.
 */
export interface MergeOptions {
  /**
   * The bind slot being resolved. Used to filter out args that are
   * slot-specific (e.g. --verify is flash-only).
   */
  slot: "flash" | "debug" | "attach" | "buildDebug";
}

/**
 * Merge the three argument layers into a single resolved output.
 *
 * Layer priority (lowest to highest):
 *   1. **yaml** — fills ids not already present in profile.
 *   2. **profile** — user's template; drives the base.
 *   3. **build override** — can replace, remove, or add on top.
 *
 * For `multi: true` args (e.g. `interface-cfg` for openocd), all values from
 * each layer are concatenated, deduplicated by value.
 *
 * @param runner       - Zephyr runner name.
 * @param profileArgs  - Structured args from the RunnerBind in the active profile.
 * @param yamlArgs     - Parsed result of `parseYamlArgs(runner, runnersYaml.args[runner])`.
 * @param buildOverride - Per-build override (may be undefined when no override exists).
 * @param opts         - Merge options (slot filter).
 */
export function mergeArgLayers(
  runner: string,
  profileArgs: RunnerArgs | undefined,
  yamlArgs: { structured: ArgValue[]; raw: string[] } | undefined,
  buildOverride: BuildSlotOverride | undefined,
  opts: MergeOptions,
): ResolvedArgs {
  const schema = getSchemaFor(runner);
  const removed = new Set<string>(buildOverride?.removed ?? []);

  // Helper: find schema def (may be undefined for unknown runners).
  const def = (id: string): ArgDef | undefined => schema.find(d => d.id === id);

  // Helper: check slot filter.
  const slotOk = (id: string): boolean => {
    const d = def(id);
    if (!d || !d.slots) { return true; }
    return d.slots.includes(opts.slot);
  };

  // ── Build the structured merged list ─────────────────────────────────────

  // We track which ids have been "claimed" by the profile so yaml doesn't re-add them.
  // For multi-value args, the profile claims the id and yaml may add *additional* distinct values.
  const profileIds = new Set<string>((profileArgs?.structured ?? []).map(a => a.id));

  // Start with profile args as the base.
  const merged: ResolvedArgEntry[] = [];

  for (const av of profileArgs?.structured ?? []) {
    if (removed.has(av.id)) { continue; }
    if (!slotOk(av.id)) { continue; }
    const d = def(av.id);
    const overrideVal = buildOverride?.overrides?.[av.id];
    if (overrideVal !== undefined) {
      // Build layer overrides the value.
      merged.push({ id: av.id, value: overrideVal, source: "build" });
    } else {
      merged.push({ ...av, source: "profile" });
    }
  }

  // Add yaml args for ids NOT already covered by the profile.
  for (const av of yamlArgs?.structured ?? []) {
    if (removed.has(av.id)) { continue; }
    if (!slotOk(av.id)) { continue; }
    const d = def(av.id);
    if (profileIds.has(av.id) && !d?.multi) {
      // Profile already sets this id (non-multi) — yaml is just filling gaps.
      // Check if the build layer wants to override it.
      if (buildOverride?.overrides?.[av.id] !== undefined && !merged.some(m => m.id === av.id)) {
        merged.push({ id: av.id, value: buildOverride.overrides[av.id], source: "build" });
      }
      continue;
    }
    // For multi-value args: check if yaml value is already in merged (dedup by value).
    if (d?.multi) {
      const existingValues = new Set(merged.filter(m => m.id === av.id).map(m => m.value));
      if (existingValues.has(av.value)) { continue; }
    }
    const overrideVal = buildOverride?.overrides?.[av.id];
    if (overrideVal !== undefined) {
      merged.push({ id: av.id, value: overrideVal, source: "build" });
    } else {
      merged.push({ ...av, source: "yaml" });
    }
  }

  // Build-level additions (schema-known).
  for (const av of buildOverride?.additions ?? []) {
    if (removed.has(av.id)) { continue; }
    if (!slotOk(av.id)) { continue; }
    merged.push({ ...av, source: "build" });
  }

  // ── Build the raw list ────────────────────────────────────────────────────
  const raw: string[] = [
    ...(profileArgs?.raw ?? []),
    ...(yamlArgs?.raw ?? []),
    ...(buildOverride?.rawAdditions ?? []),
  ];

  return { runner, structured: merged, raw };
}

// ---------------------------------------------------------------------------
// West emission
// ---------------------------------------------------------------------------

/**
 * Emit a `ResolvedArgs` as a west CLI argument list.
 *
 * Structured args are emitted first in declaration order (as given by the
 * schema), followed by the raw args verbatim.
 *
 * For `multi: true` args, each occurrence emits its own `--flag value` pair.
 */
export function toWestArgs(resolved: ResolvedArgs): string[] {
  const schema = getSchemaFor(resolved.runner);
  const out: string[] = [];

  for (const entry of resolved.structured) {
    const d = schema.find(s => s.id === entry.id);
    if (!d) {
      // Schema not found (race between schema change and stored data) — skip.
      continue;
    }
    if (d.west.takesValue) {
      if (entry.value !== undefined && entry.value !== "") {
        out.push(d.west.flag, entry.value);
      }
    } else {
      // Boolean flag — presence only.
      out.push(d.west.flag);
    }
  }

  out.push(...resolved.raw);
  return out;
}

// ---------------------------------------------------------------------------
// Cortex-debug emission
// ---------------------------------------------------------------------------

/**
 * Intermediate cortex-debug config patch produced from a `ResolvedArgs`.
 * Applied on top of the base config built from runners.yaml in debug-provider.
 */
export interface CortexDebugPatch {
  /** Simple scalar property assignments, e.g. `{ device: "STM32F401" }`. */
  properties: Record<string, string>;
  /** Array properties to populate, e.g. `{ configFiles: ["..."], searchDir: ["..."] }`. */
  arrayProps: Record<string, string[]>;
  /** Extra pairs to push onto `cfg.serverArgs`, e.g. ["-speed", "4000"]. */
  serverArgPairs: string[];
  /** Whether RTT should be enabled. */
  rttEnable: boolean;
  /** RTT decoder port override (undefined = use default / existing). */
  rttPort?: number;
  /** RTT control block address (undefined = "auto"). */
  rttAddress?: string;
}

/**
 * Build a `CortexDebugPatch` from a `ResolvedArgs` for a given runner.
 *
 * The patch is meant to be merged into a cortex-debug config object after the
 * runners.yaml baseline has been applied. Where a runners.yaml property and the
 * patch disagree, the patch wins (user intent > board defaults).
 */
export function toCortexDebugPatch(resolved: ResolvedArgs): CortexDebugPatch {
  const schema = getSchemaFor(resolved.runner);
  const patch: CortexDebugPatch = {
    properties: {},
    arrayProps: {},
    serverArgPairs: [],
    rttEnable: false,
  };

  for (const entry of resolved.structured) {
    const d = schema.find(s => s.id === entry.id);
    if (!d || !d.cortexDebug) { continue; }

    const mapping = d.cortexDebug;
    switch (mapping.kind) {
      case "property":
        if (entry.value !== undefined) {
          patch.properties[mapping.prop] = entry.value;
        }
        break;
      case "arrayPush":
        if (entry.value !== undefined) {
          if (!patch.arrayProps[mapping.prop]) {
            patch.arrayProps[mapping.prop] = [];
          }
          patch.arrayProps[mapping.prop].push(entry.value);
        }
        break;
      case "serverArgPair":
        if (entry.value !== undefined) {
          patch.serverArgPairs.push(mapping.flag, entry.value);
        }
        break;
      case "rttEnable":
        patch.rttEnable = true;
        break;
      case "rttPort":
        if (entry.value !== undefined) {
          patch.rttPort = parseInt(entry.value, 10) || 0;
        }
        break;
      case "rttAddress":
        patch.rttAddress = entry.value;
        break;
      case "none":
        break;
    }
  }

  return patch;
}

/**
 * Apply a `CortexDebugPatch` onto an existing cortex-debug config object
 * (mutates in place). Returns the same object for chaining convenience.
 */
export function applyCortexDebugPatch(cfg: Record<string, any>, patch: CortexDebugPatch): Record<string, any> {
  // Scalar properties — patch wins.
  Object.assign(cfg, patch.properties);

  // Array properties — replace (patch is derived from user intent, which should
  // supersede runners.yaml base; callers may merge before calling if preferred).
  for (const [prop, values] of Object.entries(patch.arrayProps)) {
    cfg[prop] = values;
  }

  // serverArgs — push pairs.
  if (patch.serverArgPairs.length > 0) {
    if (!Array.isArray(cfg.serverArgs)) { cfg.serverArgs = []; }
    cfg.serverArgs.push(...patch.serverArgPairs);
  }

  // RTT.
  if (patch.rttEnable) {
    const port = patch.rttPort ?? 0;
    const address = patch.rttAddress ?? "auto";
    // openocd / jlink use rttConfig; bmp-debug uses flat rttEnabled.
    if (cfg.servertype === "bmp") {
      cfg.rttEnabled = true;
    } else {
      cfg.rttConfig = {
        enabled: true,
        address,
        rtt_start_retry: 1000,
        decoders: [{ port, type: "console", label: "RTT Channel 0" }],
      };
    }
  }

  return cfg;
}

// ---------------------------------------------------------------------------
// Helpers used by the UI
// ---------------------------------------------------------------------------

/**
 * Return the ids of all schema-known args that appear in `yamlArgs` but are
 * NOT set in `profileArgs`. This is the set the build-page should show as
 * "yaml-sourced" rows which the user can override or remove.
 */
export function getYamlOnlyIds(
  runner: string,
  profileArgs: RunnerArgs | undefined,
  yamlArgs: { structured: ArgValue[] } | undefined,
): string[] {
  const profileIds = new Set<string>((profileArgs?.structured ?? []).map(a => a.id));
  const schema = getSchemaFor(runner);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const av of yamlArgs?.structured ?? []) {
    if (profileIds.has(av.id)) { continue; }
    if (seen.has(av.id)) { continue; }
    if (!schema.some(d => d.id === av.id)) { continue; } // unknown id
    seen.add(av.id);
    out.push(av.id);
  }
  return out;
}
