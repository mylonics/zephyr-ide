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
import { showQuickPick, showInputBox } from "../utilities/multistepQuickPick";
import { SetupState } from '../setup_utilities/setup';
import { getBoardlistWest } from './build_selector';
// Config for the extension
export interface TwisterConfig {
  name: string;
  platform: string;
  serialPort: string | undefined;
  serialBaud: string | undefined;
  tests: string[];
}

// Config for the extension
export interface TwisterState {
  activeRunner?: string;
  viewOpen?: boolean;
}

export type TwisterConfigDictionary = { [name: string]: TwisterConfig };
//export type BuildStateDictionary = { [name: string]: BuildState };

export async function twisterSelector(projectFolder: string, context: ExtensionContext, setupState: SetupState, rootPath: string) {
  const title = 'Add Twister Configuration';

  let twisterConfig: Partial<TwisterConfig> = {}

  //check if project contain sample.yaml or testcase.yaml
  let projectPath = path.join(rootPath, projectFolder);
  let sampleFile = path.join(projectPath, "sample.yaml");
  let testCaseFile = path.join(projectPath, "testcase.yaml");
  if (!fs.pathExistsSync(sampleFile) && !fs.pathExistsSync(testCaseFile)) {
    vscode.window.showInformationMessage(`Project Directory does not contain either a sample.yaml or testcase.yaml file`);
  }

  //ask if you want native_sim qemu or hardware
  let platfroms = ["native_sim", "qemu"];

  const platformsQpItems: QuickPickItem[] = platfroms.map(label => ({ label }));
  platformsQpItems.push({ label: "", kind: vscode.QuickPickItemKind.Separator });

  let boardlistQpItems: QuickPickItem[] = [];
  let boardlist = await getBoardlistWest(setupState, undefined);
  if (boardlist) {
    boardlistQpItems = boardlist.map(x => ({ label: x.name }));
  }
  platformsQpItems.push(...boardlistQpItems);

  function shouldResume() {
    // Could show a notification with the option to resume.
    return new Promise<boolean>((resolve, reject) => {
      reject();
    });
  }

  async function validate(name: string) {
    return undefined;
  }

  const platformPick = await showQuickPick({
    title,
    step: 1,
    totalSteps: 4,
    placeholder: 'Select Platform',
    ignoreFocusOut: true,
    items: platformsQpItems,
    activeItem: undefined,
    shouldResume: shouldResume,
  }).catch((error) => {
    console.error(error);
    return undefined;
  });


  if (platformPick) {
    twisterConfig.platform = platformPick[0].label;
    if (!platfroms.includes(twisterConfig.platform)) {
      const comPortPick = await showInputBox({
        title,
        step: 2,
        totalSteps: 4,
        prompt: "Input a COM Port",
        value: "",
        validate: validate,
        placeholder: "COM1",
        shouldResume
      })
      twisterConfig.serialPort = comPortPick;
      const comPortBaudPick = await showInputBox({
        title,
        step: 3,
        totalSteps: 4,
        prompt: "Input a COM Port Baudrate",
        value: "",
        validate: validate,
        placeholder: "115200",
        shouldResume
      })
      twisterConfig.serialBaud = comPortBaudPick;
    }
  }


  return twisterConfig;
}

