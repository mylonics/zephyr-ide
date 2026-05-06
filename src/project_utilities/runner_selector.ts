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
 * Parse a space-delimited shell-style argument string into individual tokens.
 * Respects single- and double-quoted strings (quotes are stripped from output).
 *
 * Backslash handling (POSIX-ish):
 *   - Outside any quote: `\` escapes the next character literally (so `\ ` is a
 *     literal space, `\"` is a literal double-quote).
 *   - Inside double quotes: `\` escapes only `"`, `\`, `$`, and `` ` ``.
 *   - Inside single quotes: `\` is literal (matches POSIX behaviour).
 *
 * Does NOT expand environment variables, `$()`, or globs.
 */
export function parseShellArgs(args: string): string[] {
  const result: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  let started = false;
  for (let i = 0; i < args.length; i++) {
    const c = args[i];
    if (c === "\\" && !inSingle && i + 1 < args.length) {
      const next = args[i + 1];
      if (!inDouble) {
        // Outside any quote: backslash escapes any character.
        current += next;
        started = true;
        i++;
        continue;
      } else if (next === '"' || next === "\\" || next === "$" || next === "`") {
        current += next;
        started = true;
        i++;
        continue;
      }
      // Inside double quotes, an unrecognized backslash sequence is literal.
      current += c;
      started = true;
      continue;
    }
    if (c === "'" && !inDouble) {
      inSingle = !inSingle;
      started = true;
    } else if (c === '"' && !inSingle) {
      inDouble = !inDouble;
      started = true;
    } else if ((c === " " || c === "\t") && !inSingle && !inDouble) {
      if (started) { result.push(current); current = ""; started = false; }
    } else {
      current += c;
      started = true;
    }
  }
  if (started) { result.push(current); }
  return result;
}

/** Options accepted by the runner selection wizard. */
export interface RunnerSelectorOptions {
  /**
   * Runners listed in this build's runners.yaml. Shown first in the picker
   * so users can see which runners the board actually supports.
   */
  availableRunners?: string[];
  /**
   * Parent-level runners (project runners when adding a build runner).
   * Used together with the global runners setting to decide whether to show
   * the argsMode step — only shown when a same-named parent runner exists.
   */
  parentRunners?: RunnerConfigDictionary;
}

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

export async function runnerSelector(options?: RunnerSelectorOptions) {
  const title = 'Add Runner';
  const parentRunners = options?.parentRunners ?? {};
  const globalRunners = vscode.workspace.getConfiguration().get<GlobalRunnerConfig[]>("zephyr-ide.globalRunners") ?? [];
  const globalRunnerNames = new Set(globalRunners.map(r => r.name));

  /** Returns true if a runner profile with this name exists at a parent level. */
  function hasParentWithName(name: string): boolean {
    return (name in parentRunners) || globalRunnerNames.has(name);
  }

  /** Reserved profile name. Used internally by flashActive when no runner is configured. */
  const RESERVED_NAMES = new Set(["default"]);

  async function pickRunner(input: MultiStepInput, state: Partial<RunnerConfig>) {
    // U2: Show board-available runners first, then all known runners.
    const available = options?.availableRunners ?? [];
    const availableSet = new Set(available);
    const runnersQpItems: QuickPickItem[] = [];
    if (available.length > 0) {
      runnersQpItems.push(
        ...available.map(r => ({ label: r, description: "available for this board" })),
        { label: "", kind: vscode.QuickPickItemKind.Separator } as QuickPickItem,
      );
    }
    runnersQpItems.push(
      ...KNOWN_RUNNERS.filter(r => !availableSet.has(r)).map(r => ({ label: r })),
    );

    const pick = await input.showQuickPick({
      title,
      step: 1,
      totalSteps: 4,
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
    return (input: MultiStepInput) => addRunnerName(input, state);
  }

  // B2: Separate name step so two profiles of the same type can coexist.
  async function addRunnerName(input: MultiStepInput, state: Partial<RunnerConfig>) {
    const defaultName = state.runner ?? "";
    // Show 4 steps if the default name already has a parent (common case).
    // If the user changes the name the count may be off by one, which is
    // acceptable — we recalculate accurately after this step.
    const likelyHasParent = hasParentWithName(defaultName);
    const name = await input.showInputBox({
      title,
      step: 2,
      totalSteps: likelyHasParent ? 4 : 3,
      value: defaultName,
      prompt: 'Profile name — use an existing name to inherit global/project settings',
      ignoreFocusOut: true,
      validate: async (v: string) => {
        const trimmed = v.trim();
        if (RESERVED_NAMES.has(trimmed)) {
          return `"${trimmed}" is reserved (it represents "let west pick"). Choose another name.`;
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
    state.name = name || defaultName;
    const actualHasParent = hasParentWithName(state.name);
    const totalSteps = actualHasParent ? 4 : 3;
    return (input: MultiStepInput) => addRunnerArguments(input, state, totalSteps, actualHasParent);
  }

  async function addRunnerArguments(input: MultiStepInput, state: Partial<RunnerConfig>, totalSteps: number, hasParent: boolean) {
    const args = await input.showInputBox({
      title,
      step: 3,
      totalSteps,
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
    // U3: Only show argsMode step when a parent runner with this name exists.
    if (hasParent) {
      return (input: MultiStepInput) => pickArgsMode(input, state);
    }
    state.argsMode = "append";
    return undefined;
  }

  async function pickArgsMode(input: MultiStepInput, state: Partial<RunnerConfig>) {
    const items: QuickPickItem[] = [
      { label: "append", description: "Combine this level's args with parent-level (global/project) args" },
      { label: "override", description: "Replace parent-level args entirely with this level's args" },
    ];

    const pick = await input.showQuickPick({
      title,
      step: 4,
      totalSteps: 4,
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
  // Default argsMode to "append" if not set (e.g., user backed out of step 4)
  if (state.argsMode === undefined) {
    state.argsMode = "append";
  }
  return state as RunnerConfig;
}

