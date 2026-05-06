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

// Config for the extension
export interface RunnerConfig {
  name: string;
  runner: string;
  args: string;
  /** How this level's args combine with the parent level. Default: "append". */
  argsMode?: "append" | "override";
}

/**
 * Global runner config as stored in `zephyr-ide.globalRunners` VS Code
 * settings.  No `argsMode` because the global level is the base — there is no
 * parent to combine with.
 */
export interface GlobalRunnerConfig {
  name: string;
  runner: string;
  args: string;
}

export interface RunnerState {
  viewOpen?: boolean;
}

export type RunnerConfigDictionary = { [name: string]: RunnerConfig };
export type RunnerStateDictionary = { [name: string]: RunnerState };

/** All known west runners. "default" means let west/CMake pick based on board. */
const KNOWN_RUNNERS = [
  "default",
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

/**
 * Resolve the effective runner type and arguments by cascading:
 *   global (VS Code settings) → project → build
 *
 * Levels that do not have a runner with the given `runnerName` are skipped.
 * The `argsMode` on project/build levels controls whether their args are
 * appended to or override the accumulated result from the level above.
 */
export function resolveEffectiveRunner(
  projectRunners: RunnerConfigDictionary,
  buildRunners: RunnerConfigDictionary,
  runnerName: string,
): { runner: string; args: string } {
  const globalRunners = vscode.workspace.getConfiguration().get<GlobalRunnerConfig[]>("zephyr-ide.globalRunners") ?? [];
  const globalRunner = globalRunners.find(r => r.name === runnerName);
  const projectRunner = projectRunners[runnerName];
  const buildRunner = buildRunners[runnerName];

  let resolvedRunner = globalRunner?.runner ?? "";
  let resolvedArgs = globalRunner?.args ?? "";

  // Apply project level
  if (projectRunner) {
    const pArgsMode = projectRunner.argsMode ?? "append";
    if (pArgsMode === "override") {
      resolvedRunner = projectRunner.runner;
      resolvedArgs = projectRunner.args;
    } else {
      if (projectRunner.runner) { resolvedRunner = projectRunner.runner; }
      const parts = [resolvedArgs, projectRunner.args].filter(s => s.trim());
      resolvedArgs = parts.join(" ");
    }
  }

  // Apply build level
  if (buildRunner) {
    const bArgsMode = buildRunner.argsMode ?? "append";
    if (bArgsMode === "override") {
      resolvedRunner = buildRunner.runner;
      resolvedArgs = buildRunner.args;
    } else {
      if (buildRunner.runner) { resolvedRunner = buildRunner.runner; }
      const parts = [resolvedArgs, buildRunner.args].filter(s => s.trim());
      resolvedArgs = parts.join(" ");
    }
  }

  if (!resolvedRunner) {
    resolvedRunner = "default";
  }

  return { runner: resolvedRunner, args: resolvedArgs };
}

export async function runnerSelector() {
  const title = 'Add Runner';

  async function pickRunner(input: MultiStepInput, state: Partial<RunnerConfig>) {
    const runnersQpItems: QuickPickItem[] = KNOWN_RUNNERS.map(r => ({ label: r }));

    const pick = await input.showQuickPick({
      title,
      step: 1,
      totalSteps: 3,
      placeholder: 'Pick Runner',
      items: runnersQpItems,
      ignoreFocusOut: true,
    }).catch((error) => {
      outputError("Runner Selector", String(error));
      return undefined;
    });
    if (!pick) {
      return;
    }

    state.runner = pick.label;
    state.name = pick.label;
    return (input: MultiStepInput) => addRunnerArguments(input, state);
  }

  async function addRunnerArguments(input: MultiStepInput, state: Partial<RunnerConfig>) {
    const args = await input.showInputBox({
      title,
      step: 2,
      totalSteps: 3,
      value: "",
      prompt: 'Runner Arguments (optional, e.g. --config board.cfg)',
      ignoreFocusOut: true,
      validate: noOpValidate,
    }).catch((error) => {
      outputError("Runner Selector", String(error));
      return undefined;
    });
    if (args === undefined) {
      return;
    }
    state.args = args;
    return (input: MultiStepInput) => pickArgsMode(input, state);
  }

  async function pickArgsMode(input: MultiStepInput, state: Partial<RunnerConfig>) {
    const items: QuickPickItem[] = [
      { label: "append", description: "Combine this level's args with parent-level (global/project) args" },
      { label: "override", description: "Replace parent-level args entirely with this level's args" },
    ];

    const pick = await input.showQuickPick({
      title,
      step: 3,
      totalSteps: 3,
      placeholder: 'Args Mode',
      items,
      ignoreFocusOut: true,
    }).catch((error) => {
      outputError("Runner Selector", String(error));
      return undefined;
    });
    if (!pick) {
      return;
    }
    state.argsMode = pick.label as "append" | "override";
  }

  const state = {} as Partial<RunnerConfig>;
  await MultiStepInput.run(input => pickRunner(input, state));

  if (!state.name) {
    return undefined;
  }
  // Default argsMode to "append" if not set (e.g., user backed out of step 3)
  if (state.argsMode === undefined) {
    state.argsMode = "append";
  }
  return state as RunnerConfig;
}

