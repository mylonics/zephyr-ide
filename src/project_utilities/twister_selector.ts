/*
Copyright 2025-2026 mylonics 
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
import * as path from "upath";
import * as fs from "fs-extra";
import { MultiStepInput, noOpValidate, mapToQuickPickItems } from "../utilities/multistepQuickPick";
import { notifyError } from "../utilities/output";
import { loadYamlFile } from "../utilities/utils";
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

export function getTestsFromProject(projectPath: string) {
  const testcasePath = path.join(projectPath, "testcase.yaml");
  const samplePath = path.join(projectPath, "sample.yaml");

  let filePath: string | undefined;
  if (fs.existsSync(testcasePath)) {
    filePath = testcasePath;
  } else if (fs.existsSync(samplePath)) {
    filePath = samplePath;
  }

  const tests: string[] = [];
  if (filePath) {
    const yamlFile: any = loadYamlFile(filePath);
    if (yamlFile && yamlFile.tests) {
      for (const prop of Object.keys(yamlFile.tests)) {
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

  const twisterConfig: Partial<TwisterConfig> = {};
  twisterConfig.tests = [];

  //check if project contain sample.yaml or testcase.yaml
  const projectPath = path.join(rootPath, projectFolder);
  const tests = getTestsFromProject(projectPath);

  if (tests.length === 0) {
    notifyError("Twister Config", `Project Directory does not contain tests in either a sample.yaml or testcase.yaml file`);
    return;
  }

  // Compute the total number of steps dynamically. Base path is 4 steps
  // (tests, platform, args, name); when the hardware platform is chosen the
  // com port / baud rate steps are inserted, bringing the total to 6.
  function totalStepsFor(): number {
    return twisterConfig.platform === "hardware" ? 6 : 4;
  }

  async function pickTests(input: MultiStepInput) {
    let testQpItems: QuickPickItem[] = [];
    testQpItems.push({ label: "All", picked: true });
    testQpItems.push({ label: "", kind: vscode.QuickPickItemKind.Separator });
    testQpItems = testQpItems.concat(mapToQuickPickItems(tests));

    const testPickResult = await input.showQuickPickMany({
      title,
      step: 1,
      totalSteps: totalStepsFor(),
      placeholder: 'Select Tests (toggle then press Enter)',
      ignoreFocusOut: true,
      items: testQpItems,
      activeItem: undefined,
    });

    // No custom buttons on this step, so the result is always an array.
    if (!Array.isArray(testPickResult) || testPickResult.length === 0) {
      notifyError("Twister Config", "Need to select at least one test");
      return;
    }
    const testPick = testPickResult as readonly QuickPickItem[];

    twisterConfig.tests = [];
    for (const v of testPick) {
      if (v.label === 'All') {
        twisterConfig.tests = ['All'];
        break;
      }
      twisterConfig.tests.push(v.label);
    }

    return (input: MultiStepInput) => pickPlatform(input);
  }

  async function pickPlatform(input: MultiStepInput) {
    const platforms = ["native_sim", "qemu", "hardware"];
    const platformsQpItems: QuickPickItem[] = mapToQuickPickItems(platforms);

    const platformPick = await input.showQuickPick({
      title,
      step: 2,
      totalSteps: totalStepsFor(),
      placeholder: 'Select Platform',
      ignoreFocusOut: true,
      items: platformsQpItems,
      activeItem: undefined,
    });

    twisterConfig.platform = platformPick.label;

    if (twisterConfig.platform === "hardware") {
      return (input: MultiStepInput) => pickHardwareBoard(input);
    }
    return (input: MultiStepInput) => inputTwisterArgs(input);
  }

  async function pickHardwareBoard(input: MultiStepInput) {
    // pickBoard runs a 3-step sub-wizard (board dir → board → revision). It
    // shares the same MultiStepInput so the Back button navigates back
    // through those sub-steps and then back to platform/tests.
    const boardConfig = await pickBoard(setupState, rootPath, input);
    if (boardConfig === undefined) {
      return;
    }
    twisterConfig.boardConfig = boardConfig;
    return (input: MultiStepInput) => inputComPort(input);
  }

  async function inputComPort(input: MultiStepInput) {
    const comPort = await input.showInputBox({
      title,
      step: 3,
      totalSteps: totalStepsFor(),
      prompt: "Enter serial port (e.g., COM1)",
      ignoreFocusOut: true,
      value: "",
      validate: noOpValidate,
      placeholder: "COM1",
    });
    twisterConfig.serialPort = comPort;
    return (input: MultiStepInput) => inputBaud(input);
  }

  async function inputBaud(input: MultiStepInput) {
    const baud = await input.showInputBox({
      title,
      step: 4,
      totalSteps: totalStepsFor(),
      prompt: "Enter baud rate (e.g., 115200)",
      ignoreFocusOut: true,
      value: "",
      validate: noOpValidate,
      placeholder: "115200",
    });
    twisterConfig.serialBaud = baud;
    return (input: MultiStepInput) => inputTwisterArgs(input);
  }

  async function inputTwisterArgs(input: MultiStepInput) {
    const argsStep = totalStepsFor() - 1;
    const args = await input.showInputBox({
      title,
      step: argsStep,
      totalSteps: totalStepsFor(),
      prompt: "Additional Twister Arguments",
      ignoreFocusOut: true,
      value: "",
      placeholder: '--sysbuild',
      validate: noOpValidate,
    });
    twisterConfig.args = args;
    return (input: MultiStepInput) => inputName(input);
  }

  async function inputName(input: MultiStepInput) {
    const steps = totalStepsFor();
    let default_name = (twisterConfig.tests && twisterConfig.tests.length > 1) ? "test" : (twisterConfig.tests ? twisterConfig.tests[0] : "test");
    if (default_name === "All") {
      default_name = "test";
    }
    if (twisterConfig.boardConfig) {
      default_name = default_name + "_" + twisterConfig.boardConfig.board;
      if (twisterConfig.boardConfig.revision) {
        default_name = default_name + "_" + twisterConfig.boardConfig.revision;
      }
    } else {
      default_name = default_name + "_" + twisterConfig.platform;
    }

    const name = await input.showInputBox({
      title,
      step: steps,
      totalSteps: steps,
      prompt: "Enter test configuration name",
      ignoreFocusOut: true,
      value: default_name,
      validate: noOpValidate,
    });
    twisterConfig.name = name;
  }

  await MultiStepInput.run(input => pickTests(input));

  if (!twisterConfig.name || !twisterConfig.tests || twisterConfig.tests.length === 0) {
    return;
  }

  return twisterConfig as TwisterConfig;
}

export async function reconfigureTest(config: TwisterConfig) {
  const title = "Reconfigure Test";
  const hasBoardConfig = !!config.boardConfig;
  const totalSteps = hasBoardConfig ? 3 : 1;

  async function inputComPort(input: MultiStepInput) {
    const comPort = await input.showInputBox({
      title,
      step: 1,
      totalSteps,
      prompt: "Enter serial port (e.g., COM1)",
      ignoreFocusOut: true,
      value: config.serialPort ? config.serialPort : "",
      validate: noOpValidate,
      placeholder: "COM1",
    });
    if (comPort !== undefined) {
      config.serialPort = comPort;
    }
    return (input: MultiStepInput) => inputBaud(input);
  }

  async function inputBaud(input: MultiStepInput) {
    const baud = await input.showInputBox({
      title,
      step: 2,
      totalSteps,
      prompt: "Enter baud rate (e.g., 115200)",
      ignoreFocusOut: true,
      value: config.serialBaud ? config.serialBaud : "",
      validate: noOpValidate,
      placeholder: "115200",
    });
    if (baud !== undefined) {
      config.serialBaud = baud;
    }
    return (input: MultiStepInput) => inputArgs(input);
  }

  async function inputArgs(input: MultiStepInput) {
    const step = hasBoardConfig ? 3 : 1;
    const args = await input.showInputBox({
      title,
      step,
      totalSteps,
      prompt: "Additional Twister Arguments",
      ignoreFocusOut: true,
      value: config.args ? config.args : "",
      validate: noOpValidate,
    });
    if (args !== undefined) {
      config.args = args;
    }
  }

  if (hasBoardConfig) {
    await MultiStepInput.run(input => inputComPort(input));
  } else {
    await MultiStepInput.run(input => inputArgs(input));
  }
}
