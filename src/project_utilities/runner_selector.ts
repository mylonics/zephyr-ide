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

import { QuickPickItem } from 'vscode';
import * as vscode from 'vscode';
import { MultiStepInput, noOpValidate } from "../utilities/multistepQuickPick";
import { outputError } from "../utilities/output";
import { RunnerBind, loadRunnerVariants } from "./runner_variants";
import { WorkspaceConfig } from "../setup_utilities/types";

// Config for the extension
export interface RunnerConfig {
  name: string;
  flash:      RunnerBind;
  build:      RunnerBind;
  buildDebug: RunnerBind;
  attach:     RunnerBind;
}

export interface RunnerState {
  viewOpen?: boolean;
}

export type RunnerConfigDictionary = { [name: string]: RunnerConfig };
export type RunnerStateDictionary = { [name: string]: RunnerState };

/** All known west runners. */
export const KNOWN_RUNNERS = [
  "openocd",
  "jlink",
  "pyocd",
  "stlink",
  "nrfjprog",
  "nrfutil",
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
  "dediprog",
  "silabs_commander",
  "xsdb",
];

/** Options accepted by the runner selection wizard. */
export interface RunnerSelectorOptions {
  /**
   * Runners listed in this build's runners.yaml. Shown first in the picker
   * so users can see which runners the board actually supports.
   */
  availableRunners?: string[];
  /**
   * Existing runner names to validate uniqueness.
   */
  existingNames?: string[];
  /**
   * Workspace config for loading variants.
   */
  wsConfig?: WorkspaceConfig;
}

export async function runnerSelector(options?: RunnerSelectorOptions) {
  const title = 'Add Runner';
  const existingNames = new Set(options?.existingNames ?? []);
  const variants = options?.wsConfig ? loadRunnerVariants(options.wsConfig) : [];

  interface RunnerPickState {
    kind: "runner" | "variant";
    label: string;
    runner?: string;
    variant?: string;
  }

  async function pickRunnerOrVariant(input: MultiStepInput, state: Partial<RunnerConfig & { pickState?: RunnerPickState; extraArgs?: string }>) {
    const available = options?.availableRunners ?? [];
    const availableSet = new Set(available);
    const items: QuickPickItem[] = [];
    
    // Show variants first
    if (variants.length > 0) {
      items.push(
        ...variants.map(v => ({ 
          label: `variant: ${v.name}`, 
          description: `${v.runner} ${v.args}`.trim(),
          detail: "Variant from settings/workspace" 
        })),
        { label: "", kind: vscode.QuickPickItemKind.Separator } as QuickPickItem,
      );
    }
    
    // Then board-available runners
    if (available.length > 0) {
      items.push(
        ...available.map(r => ({ label: r, description: "available for this board" })),
        { label: "", kind: vscode.QuickPickItemKind.Separator } as QuickPickItem,
      );
    }
    
    // Then all known runners
    items.push(
      ...KNOWN_RUNNERS.filter(r => !availableSet.has(r)).map(r => ({ label: r })),
    );

    const pick = await input.showQuickPick({
      title,
      step: 1,
      totalSteps: 3,
      placeholder: 'Pick Runner or Variant',
      items,
      ignoreFocusOut: true,
    }).catch((error) => {
      outputError("Runner Selector", String(error));
      return undefined;
    });
    if (!pick) {
      return;
    }

    const label = pick.label;
    if (label.startsWith("variant: ")) {
      const variantName = label.slice("variant: ".length);
      state.pickState = { kind: "variant", label, variant: variantName };
      state.name = label;
    } else {
      state.pickState = { kind: "runner", label, runner: label };
      state.name = label;
    }
    return (input: MultiStepInput) => addRunnerName(input, state);
  }

  async function addRunnerName(input: MultiStepInput, state: Partial<RunnerConfig & { pickState?: RunnerPickState; extraArgs?: string }>) {
    const defaultName = state.pickState?.label ?? "";
    const name = await input.showInputBox({
      title,
      step: 2,
      totalSteps: 3,
      value: defaultName,
      prompt: 'Profile name (must be unique)',
      ignoreFocusOut: true,
      validate: async (v: string) => {
        const trimmed = v.trim();
        if (!trimmed) {
          return "Name cannot be empty";
        }
        if (existingNames.has(trimmed)) {
          return `"${trimmed}" already exists. Choose another name.`;
        }
        return undefined;
      },
    }).catch((error) => {
      outputError("Runner Selector", String(error));
      return undefined;
    });
    if (name === undefined) {
      return;
    }
    state.name = name.trim() || defaultName;
    return (input: MultiStepInput) => addExtraArguments(input, state);
  }

  async function addExtraArguments(input: MultiStepInput, state: Partial<RunnerConfig & { pickState?: RunnerPickState; extraArgs?: string }>) {
    const args = await input.showInputBox({
      title,
      step: 3,
      totalSteps: 3,
      value: "",
      prompt: 'Extra arguments (optional, e.g. --config board.cfg)',
      ignoreFocusOut: true,
      validate: noOpValidate,
    }).catch((error) => {
      outputError("Runner Selector", String(error));
      return undefined;
    });
    if (args === undefined) {
      return;
    }
    state.extraArgs = args.trim();
    return undefined;
  }

  const state = {} as Partial<RunnerConfig & { pickState?: RunnerPickState; extraArgs?: string }>;
  await MultiStepInput.run(input => pickRunnerOrVariant(input, state));

  if (!state.name || !state.pickState) {
    return undefined;
  }

  // Build the flash bind based on what was picked
  let flashBind: RunnerBind;
  if (state.pickState.kind === "variant") {
    flashBind = state.extraArgs 
      ? { kind: "variant", variant: state.pickState.variant!, extraArgs: state.extraArgs }
      : { kind: "variant", variant: state.pickState.variant! };
  } else {
    flashBind = state.extraArgs
      ? { kind: "runner", runner: state.pickState.runner!, extraArgs: state.extraArgs }
      : { kind: "runner", runner: state.pickState.runner! };
  }

  return {
    name: state.name,
    flash: flashBind,
    build: { kind: "auto" },
    buildDebug: { kind: "auto" },
    attach: { kind: "auto" },
  } as RunnerConfig;
}

