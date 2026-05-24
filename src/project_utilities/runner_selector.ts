/*
Copyright 2024-2026 mylonics 
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
 * Known Zephyr runners + a thin single-bind picker used by the profile editor.
 * The old `RunnerConfig` per-build model has been replaced by `RunnerProfile`
 * (see `runner_profiles.ts`).
 */

import { QuickPickItem } from 'vscode';
import * as vscode from 'vscode';
import { MultiStepInput, noOpValidate } from "../utilities/multistepQuickPick";
import { outputError } from "../utilities/output";
import { FlashBind, DebugBind, splitArgs } from "./runner_profiles";

/** All known west runners. */
export const KNOWN_RUNNERS = [
  "openocd",
  "jlink",
  "pyocd",
  "stlink",
  "stlink_gdbserver",
  "nrfjprog",
  "nrfutil",
  "nxp_s32dbg",
  "probe-rs",
  "blackmagicprobe",
  "linkserver",
  "dfu-util",
  "uf2",
  "esp32",
  "qemu",
  "bossac",
  "teensy",
  "bflb-mcu-tool",
  "arc-jtag",
  "arc-nsim",
  "native",
  "dediprog",
  "silabs_commander",
  "xsdb",
];

/**
 * Runners that cortex-debug can drive natively (no west bridge needed).
 * Must stay in sync with the native cases in `runnerToServerType` in `runners-yaml.ts`.
 * `bmp` is the shorter alias for `blackmagicprobe`; both are kept because either
 * can appear as the runner name in a board's runners.yaml depending on Zephyr version.
 */
export const CORTEX_DEBUG_RUNNERS = [
  "openocd",
  "jlink",
  "pyocd",
  // Represents the whole stlink family (stlink, stlink_gdbserver, stm32cubeprogrammer-stlink).
  // resolveCanonicalRunner() picks the correct variant from runners.yaml at debug time.
  "stlink",
  // Represents both "blackmagicprobe" and "bmp" runner names.
  // resolveCanonicalRunner() picks the correct variant from runners.yaml at debug time.
  "bmp",
  "qemu",
];

/**
 * Runners that require the `west debugserver` bridge (no native cortex-debug servertype).
 * These are mapped to cortex-debug `servertype: "external"` in `runners-yaml.ts`.
 * Source of truth: `west debugserver --context` plus manual audit.
 */
export const WEST_DEBUG_RUNNERS = [
  "nrfjprog",
  "nxp_s32dbg",
  "linkserver",
  "esp32",
  "stm32cubeprogrammer",
  "probe-rs",
  "teensy",
  "xsdb",
  "arc-nsim",
  "native",
];

/** @deprecated Use {@link CORTEX_DEBUG_RUNNERS} and {@link WEST_DEBUG_RUNNERS} separately. */
export const DEBUG_CAPABLE_RUNNERS = [...CORTEX_DEBUG_RUNNERS, ...WEST_DEBUG_RUNNERS];

export interface BindSelectorOptions {
  /** Slot being edited. Flash cannot use `launch.json` references. */
  slot: "flash" | "debug" | "attach";
  /** Runners listed in this build's runners.yaml (shown first). */
  availableRunners?: string[];
  /** Existing bind to seed extra-args on step 2. */
  current?: FlashBind | DebugBind;
}

/**
 * Two-step wizard: pick a runner (or "auto"), then optionally enter extra args.
 * `launch.json` entries are NOT offered here — for Debug/Attach binds the
 * profile editor uses `selectLaunchConfiguration` directly.
 */
export async function bindSelector(options: BindSelectorOptions): Promise<FlashBind | DebugBind | undefined> {
  const title = `Pick runner for ${options.slot}`;
  const availableSet = new Set(options.availableRunners ?? []);

  const items: QuickPickItem[] = [
    { label: "auto", description: "Use runners.yaml defaults" },
    { label: "", kind: vscode.QuickPickItemKind.Separator } as QuickPickItem,
  ];
  if (options.availableRunners && options.availableRunners.length > 0) {
    items.push({ label: "Available for this board", kind: vscode.QuickPickItemKind.Separator });
    items.push(...options.availableRunners.map(r => ({ label: r, description: "available" })));
    items.push({ label: "Other runners", kind: vscode.QuickPickItemKind.Separator });
  }
  items.push(...KNOWN_RUNNERS.filter(r => !availableSet.has(r)).map(r => ({ label: r })));

  let pickedBind: FlashBind | DebugBind | undefined;

  async function step1(input: MultiStepInput) {
    const pick = await input.showQuickPick({
      title,
      step: 1,
      totalSteps: 2,
      placeholder: "Pick runner (or 'auto')",
      items,
      ignoreFocusOut: true,
    }).catch((error) => {
      outputError("Bind Selector", String(error));
      return undefined;
    });
    if (!pick) { return; }
    if (pick.label === "auto") {
      pickedBind = { kind: "auto" };
      return;
    }
    pickedBind = options.slot === "flash"
      ? { kind: "west-flash", runner: pick.label }
      : { kind: "cortex-debug", runner: pick.label };
    return (input: MultiStepInput) => step2(input);
  }

  async function step2(input: MultiStepInput) {
    const cur = options.current;
    const seeded = cur && (cur.kind === "west-flash" || cur.kind === "west-debug")
      ? (cur.extraArgs ?? []).join(" ")
      : "";
    const args = await input.showInputBox({
      title,
      step: 2,
      totalSteps: 2,
      value: seeded,
      prompt: "Extra args (optional, e.g. --config board.cfg)",
      ignoreFocusOut: true,
      validate: noOpValidate,
    }).catch((error) => {
      outputError("Bind Selector", String(error));
      return undefined;
    });
    if (args === undefined) { return; }
    const trimmed = args.trim();
    if (trimmed && pickedBind && pickedBind.kind === "west-flash") {
      pickedBind = { kind: "west-flash", runner: pickedBind.runner, extraArgs: splitArgs(trimmed) };
    }
  }

  await MultiStepInput.run((input) => step1(input));
  return pickedBind;
}
