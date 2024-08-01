/*
Copyright 2024 mylonics 
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
import { MultiStepInput } from "../utilities/multistepQuickPick";

import path from "path";
import * as fs from 'fs';

// Config for the extension
export interface RunnerConfig {
  name: string;
  runner: string;
  args: string;
}

export interface RunnerState {
  viewOpen?: boolean;
}

export type RunnerConfigDictionary = { [name: string]: RunnerConfig };
export type RunnerStateDictionary = { [name: string]: RunnerState };

export async function runnerSelector(boardfolder: string) {
  const title = 'Add Runner';
  let runners = ["default"];

  let boardcmakePath = path.join(boardfolder, 'board.cmake');
  if (fs.existsSync(boardcmakePath)) {
    const boardCMakeFile = fs.readFileSync(boardcmakePath, 'utf8');
    boardCMakeFile.split(/\r?\n/).forEach(line => {

      if (line.includes("include(${ZEPHYR_BASE}/boards/common/") && line.includes(".board.cmake)")) {
        runners.push(line.replace('include(${ZEPHYR_BASE}/boards/common/', '').replace(".board.cmake)", '').replace(/\s/g, ''));
      }
    });
  }

  async function pickRunner(input: MultiStepInput, state: Partial<RunnerConfig>) {

    // Get runners
    const runnersQpItems: QuickPickItem[] = runners.map(label => ({ label }));

    const pickPromise = input.showQuickPick({
      title,
      step: 1,
      totalSteps: 3,
      placeholder: 'Pick Runner',
      items: runnersQpItems,
      ignoreFocusOut: true,
      activeItem: typeof state.runner !== 'string' ? state.runner : undefined,
      shouldResume: shouldResume
    }).catch((error) => {
      console.error(error);
      return undefined;
    });
    let pick = await pickPromise;
    if (!pick) {
      return;
    }

    state.runner = pick.label;
    if (state.runner === undefined) {
      return;
    }
    return (input: MultiStepInput) => inputRunnerName(input, state);
  }

  async function inputRunnerName(input: MultiStepInput, state: Partial<RunnerConfig>) {
    if (state.runner === undefined) {
      return;
    }

    let inputNamePromise = input.showInputBox({
      title,
      step: 2,
      totalSteps: 3,
      value: state.runner,
      ignoreFocusOut: true,
      prompt: 'Choose a name for this Runner Configuration',
      validate: validate,
      shouldResume: shouldResume
    }).catch((error) => {
      console.error(error);
      return undefined;
    });

    state.name = await inputNamePromise;
    if (state.name === undefined) {
      return;
    }
    return (input: MultiStepInput) => addRunnerArguments(input, state);
  }

  async function addRunnerArguments(input: MultiStepInput, state: Partial<RunnerConfig>) {
    if (state.name === undefined) {
      return;
    }

    let inputPromise = input.showInputBox({
      title,
      step: 3,
      totalSteps: 3,
      value: "",
      prompt: 'Add Runner Arguments',
      ignoreFocusOut: true,
      validate: validate,
      shouldResume: shouldResume
    }).catch((error) => {
      console.error(error);
      return undefined;
    });
    state.args = await inputPromise;

    if (state.args === undefined) {
      return;
    }
    return;
  }

  async function validate(name: string) {
    return undefined;
  }

  function shouldResume() {
    // Could show a notification with the option to resume.
    return new Promise<boolean>((resolve, reject) => {
      reject();
    });
  }

  async function collectInputs() {
    const state = {} as Partial<RunnerConfig>;
    await MultiStepInput.run(input => pickRunner(input, state));
    return state as RunnerConfig;
  }

  const state = await collectInputs();
  return state;
}

