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
import { showQuickPick, showInputBox, showQuickPickMany } from "../utilities/multistepQuickPick";
import { notifyError } from "../utilities/output";
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

  let twisterConfig: Partial<TwisterConfig> = {};
  twisterConfig.tests = [];

  //check if project contain sample.yaml or testcase.yaml
  let projectPath = path.join(rootPath, projectFolder);
  const tests = getTestsFromProject(projectPath);

  if (tests.length === 0) {
    notifyError("Twister Config", `Project Directory does not contain tests in either a sample.yaml or testcase.yaml file`);
    return;
  }

  let testQpItems: QuickPickItem[] = [];
  testQpItems.push({ label: "All", picked: true });
  testQpItems.push({ label: "", kind: vscode.QuickPickItemKind.Separator });
  testQpItems = testQpItems.concat(tests.map(label => ({ label })));

  const testPick = await showQuickPickMany({
    title,
    step: 1,
    totalSteps: 3,
    placeholder: 'Select Tests',
    ignoreFocusOut: false,
    items: testQpItems,
    activeItem: undefined,
    canSelectMany: false
  }).catch((error) => {
    console.error(error);
    return undefined;
  });
  if (testPick === undefined) {
    return;
  }
  if (testPick.length === 0) {
    notifyError("Twister Config", "Need to select at least one test");
    return;
  }

  for (let v of testPick) {
    if (v.label === 'All') {
      twisterConfig.tests = ['All'];
      break;
    }
    twisterConfig.tests.push(v.label);
  }

  let platfroms = ["native_sim", "qemu", "hardware"];

  const platformsQpItems: QuickPickItem[] = platfroms.map(label => ({ label }));
  platformsQpItems.push({ label: "", kind: vscode.QuickPickItemKind.Separator });

  async function validate(name: string) {
    return undefined;
  }

  const platformPick = await showQuickPick({
    title,
    step: 2,
    totalSteps: 3,
    placeholder: 'Select Platform',
    ignoreFocusOut: true,
    items: platformsQpItems,
    activeItem: undefined
  }).catch((error) => {
    console.error(error);
    return undefined;
  });
  if (platformPick === undefined) {
    return;
  }

  twisterConfig.platform = platformPick.label;
  let totalSteps = 4;


  if (twisterConfig.platform === "hardware") {
    twisterConfig.boardConfig = await pickBoard(setupState, rootPath);
    if (twisterConfig.boardConfig === undefined) {
      return;
    }
    totalSteps = 6;

    const comPortPick = await showInputBox({
      title,
      step: 3,
      totalSteps: totalSteps,
      prompt: "Input a COM Port",
      value: "",
      validate: validate,
      placeholder: "COM1"
    });

    twisterConfig.serialPort = comPortPick;
    const comPortBaudPick = await showInputBox({
      title,
      step: 4,
      totalSteps: totalSteps,
      prompt: "Input a COM Port Baudrate",
      value: "",
      validate: validate,
      placeholder: "115200"
    });
    twisterConfig.serialBaud = comPortBaudPick;
  }

  const twisterArgsBox = await showInputBox({
    title,
    step: totalSteps - 1,
    totalSteps: totalSteps,
    prompt: "Additional Twister Arguments",
    value: "",
    placeholder: '--sysbuild',
    validate: validate,
  });
  if (twisterArgsBox === undefined) {
    return;
  }
  twisterConfig.args = twisterArgsBox;

  let default_name = twisterConfig.tests.length > 1 ? "test" : twisterConfig.tests[0];

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

  const nameInputBox = await showInputBox({
    title,
    step: totalSteps,
    totalSteps: totalSteps,
    prompt: "Enter a name for this Test Configuration",
    value: default_name,
    validate: validate,
  });
  if (nameInputBox === undefined) {
    return;
  }
  twisterConfig.name = nameInputBox;

  return twisterConfig as TwisterConfig;
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
