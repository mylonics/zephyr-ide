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

import { QuickPickItem, ExtensionContext } from 'vscode';
import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs-extra";
import { MultiStepInput, showQuickPickMany, showInputBox } from "../utilities/multistepQuickPick";
import { SetupState } from '../setup_utilities/types';
import { pickBoard, BoardConfig } from './build_selector';

// Config for the extension
export interface TwisterConfig {
  name: string;
  platform: string;
  tests: string[];
  args: string;
  serialPort?: string | undefined;
  serialBaud?: string | undefined;
  boardConfig?: BoardConfig;
}

import * as yaml from 'js-yaml';

export function getTestsFromProject(projectPath: string) {
  let testcasePath = path.join(projectPath, "testcase.yaml");
  let samplePath = path.join(projectPath, "sample.yaml");

  let filePath: string | undefined;
  if (fs.existsSync(testcasePath)) {
    filePath = testcasePath;
  } else if (fs.existsSync(samplePath)) {
    filePath = samplePath;
  }

  let tests: string[] = [];
  if (filePath) {
    let yamlFile: any = yaml.load(fs.readFileSync(filePath, 'utf-8'));
    if (yamlFile && yamlFile.tests) {
      for (var prop in yamlFile.tests) {
        tests.push(prop);
      }
    }
  }
  return tests;
}

// Config for the extension
export interface TwisterState {
  viewOpen?: boolean;
}

export type TwisterConfigDictionary = { [name: string]: TwisterConfig };
export type TwisterStateDictionary = { [name: string]: TwisterState };

export async function twisterSelector(projectFolder: string, context: ExtensionContext, setupState: SetupState, rootPath: string) {
  const title = 'Add Twister Configuration';

  // Validate project has tests first
  let projectPath = path.join(rootPath, projectFolder);
  const tests = getTestsFromProject(projectPath);

  if (tests.length === 0) {
    vscode.window.showErrorMessage(`Project Directory does not contain tests in either a sample.yaml or testcase.yaml file`);
    return;
  }

  async function selectTests(input: MultiStepInput, state: Partial<TwisterConfig>) {
    let testQpItems: QuickPickItem[] = [];
    testQpItems.push({ label: "All", picked: true });
    testQpItems.push({ label: "", kind: vscode.QuickPickItemKind.Separator });
    testQpItems = testQpItems.concat(tests.map(label => ({ label })));

    // Use standalone showQuickPickMany for multi-select functionality
    const testPick = await showQuickPickMany({
      title,
      step: 1,
      totalSteps: 6, // Maximum possible steps for hardware path
      placeholder: 'Select Tests',
      ignoreFocusOut: false,
      items: testQpItems,
      activeItem: undefined
    }).catch((error) => {
      console.error(error);
      return undefined;
    });

    if (testPick === undefined) {
      return;
    }
    if (testPick.length === 0) {
      vscode.window.showErrorMessage("Need to select at least one test");
      return;
    }

    // Handle multi-select logic
    let selectedTests: string[] = [];
    for (let v of testPick) {
      if (v.label === 'All') {
        selectedTests = ['All'];
        break;
      }
      selectedTests.push(v.label);
    }

    state.tests = selectedTests;
    return (input: MultiStepInput) => selectPlatform(input, state);
  }

  async function selectPlatform(input: MultiStepInput, state: Partial<TwisterConfig>) {
    let platforms = ["native_sim", "qemu", "hardware"];
    const platformsQpItems: QuickPickItem[] = platforms.map(label => ({ label }));
    platformsQpItems.push({ label: "", kind: vscode.QuickPickItemKind.Separator });

    const pickPromise = input.showQuickPick({
      title,
      step: 2,
      totalSteps: 6, // Maximum possible steps for hardware path
      placeholder: 'Select Platform',
      ignoreFocusOut: true,
      items: platformsQpItems,
      activeItem: undefined
    }).catch((error) => {
      console.error(error);
      return undefined;
    });

    let pick = await pickPromise;
    if (!pick) {
      return;
    }

    state.platform = pick.label;

    if (state.platform === "hardware") {
      return (input: MultiStepInput) => selectBoardForHardware(input, state);
    } else {
      return (input: MultiStepInput) => inputTwisterArgs(input, state);
    }
  }

  async function selectBoardForHardware(input: MultiStepInput, state: Partial<TwisterConfig>) {
    let boardData = await pickBoard(setupState, rootPath);
    if (boardData) {
      state.boardConfig = boardData;
      return (input: MultiStepInput) => inputSerialPort(input, state);
    } else {
      return;
    }
  }

  async function inputSerialPort(input: MultiStepInput, state: Partial<TwisterConfig>) {
    const inputPromise = input.showInputBox({
      title,
      step: 3,
      totalSteps: 6,
      value: "",
      prompt: "Input a COM Port",
      placeholder: "COM1",
      ignoreFocusOut: true,
      validate: validate
    }).catch((error) => {
      console.error(error);
      return undefined;
    });

    state.serialPort = await inputPromise;
    if (state.serialPort === undefined) {
      return;
    }

    return (input: MultiStepInput) => inputSerialBaud(input, state);
  }

  async function inputSerialBaud(input: MultiStepInput, state: Partial<TwisterConfig>) {
    const inputPromise = input.showInputBox({
      title,
      step: 4,
      totalSteps: 6,
      value: "",
      prompt: "Input a COM Port Baudrate",
      placeholder: "115200",
      ignoreFocusOut: true,
      validate: validate
    }).catch((error) => {
      console.error(error);
      return undefined;
    });

    state.serialBaud = await inputPromise;
    if (state.serialBaud === undefined) {
      return;
    }

    return (input: MultiStepInput) => inputTwisterArgs(input, state);
  }

  async function inputTwisterArgs(input: MultiStepInput, state: Partial<TwisterConfig>) {
    const totalSteps = state.platform === "hardware" ? 6 : 4;
    const currentStep = state.platform === "hardware" ? 5 : 3;

    const inputPromise = input.showInputBox({
      title,
      step: currentStep,
      totalSteps: totalSteps,
      value: "",
      prompt: "Additional Twister Arguments",
      placeholder: '--sysbuild',
      ignoreFocusOut: true,
      validate: validate
    }).catch((error) => {
      console.error(error);
      return undefined;
    });

    state.args = await inputPromise;
    if (state.args === undefined) {
      return;
    }

    return (input: MultiStepInput) => inputConfigName(input, state);
  }

  async function inputConfigName(input: MultiStepInput, state: Partial<TwisterConfig>) {
    const totalSteps = state.platform === "hardware" ? 6 : 4;
    const currentStep = totalSteps;

    // Generate default name
    let default_name = (state.tests && state.tests.length > 1) ? "test" : (state.tests ? state.tests[0] : "test");

    if (default_name === "All") {
      default_name = "test";
    }

    if (state.boardConfig) {
      default_name = default_name + "_" + state.boardConfig.board;
      if (state.boardConfig.revision) {
        default_name = default_name + "_" + state.boardConfig.revision;
      }
    } else {
      default_name = default_name + "_" + state.platform;
    }

    const inputPromise = input.showInputBox({
      title,
      step: currentStep,
      totalSteps: totalSteps,
      value: default_name,
      prompt: "Enter a name for this Test Configuration",
      ignoreFocusOut: true,
      validate: validate
    }).catch((error) => {
      console.error(error);
      return undefined;
    });

    state.name = await inputPromise;
    if (state.name === undefined) {
      return;
    }

    return;
  }

  async function validate(name: string) {
    return undefined;
  }

  async function collectInputs() {
    const state = {} as Partial<TwisterConfig>;
    state.tests = [];
    await MultiStepInput.run(input => selectTests(input, state));
    return state as TwisterConfig;
  }

  const state = await collectInputs();
  return state;
}

export async function reconfigureTest(config: TwisterConfig) {
  async function validate(name: string) {
    return undefined;
  }

  let title = "Reconfigure Test";
  if (config.boardConfig) {
    const comPortPick = await showInputBox({
      title,
      step: 1,
      totalSteps: 3,
      prompt: "Input a COM Port",
      value: config.serialPort ? config.serialPort : "",
      validate: validate,
      placeholder: "COM1"
    });

    config.serialPort = comPortPick;
    const comPortBaudPick = await showInputBox({
      title,
      step: 2,
      totalSteps: 3,
      prompt: "Input a COM Port Baudrate",
      value: config.serialBaud ? config.serialBaud : "",
      validate: validate,
      placeholder: "115200"
    });

    config.serialBaud = comPortBaudPick;
  }

  const argsPick = await showInputBox({
    title,
    step: 3,
    totalSteps: 3,
    prompt: "Additional Twister Arguments",
    value: config.args ? config.args : "",
    validate: validate
  });
  config.args = argsPick;
}
