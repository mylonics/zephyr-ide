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
import * as vscode from "vscode";
import { MultiStepInput, mapToQuickPickItems } from "../utilities/multistepQuickPick";
import { outputError } from "../utilities/output";
import path from 'upath';

import { WorkspaceConfig } from "../setup_utilities/types";

// Config for the extension
export interface ConfigFiles {
  config: string[];
  extraConfig: string[];
  overlay: string[];
  extraOverlay: string[];
}

/** Returns the key of the ConfigFiles array corresponding to the given selector flags. */
export function getConfFileKey(isKConfig: boolean, isPrimary: boolean): keyof ConfigFiles {
  if (isKConfig) {
    return isPrimary ? "config" : "extraConfig";
  }
  return isPrimary ? "overlay" : "extraOverlay";
}

/** Merge all fields from `source` into `target` by concatenating arrays. */
export function mergeConfigFiles(target: ConfigFiles, source: ConfigFiles): void {
  for (const key of ["config", "extraConfig", "overlay", "extraOverlay"] as (keyof ConfigFiles)[]) {
    target[key] = target[key].concat(source[key]);
  }
}

export async function configSelector(wsConfig: WorkspaceConfig, isKConfigSelector: boolean, isProjectSelctor: boolean, isPrimary: boolean | undefined = undefined) {
  let additionalTitleString = "to Build";
  if (isProjectSelctor) {
    additionalTitleString = "to Project";
  }

  let fileType = "Devicetree Overlay";
  let fileExt: any = {
    'dtc': ['overlay']
  };
  let link = "https://docs.zephyrproject.org/latest/build/dts/howtos.html";

  if (isKConfigSelector) {
    fileType = "KConfig";
    fileExt = {
      'KConfig': ['conf', '*']
    };
    link = "https://docs.zephyrproject.org/latest/build/kconfig/setting.html#initial-conf";
  }

  let title = 'Add ' + fileType + ' Files ' + additionalTitleString;

  async function chooseIfPrimary(input: MultiStepInput, state: ConfigFiles) {
    let confFileOption: QuickPickItem[] = [];
    confFileOption.push({ label: "Add extra " + fileType + " File (Recommended)" });
    confFileOption.push({ label: "Override West's Automatic " + fileType + " File (see " + link + ")" });

    const pickPromise = input.showQuickPick({
      title,
      step: 1,
      totalSteps: 2,
      placeholder: 'Select type of file to add',
      items: confFileOption,
      activeItem: undefined,
      ignoreFocusOut: true
    }).catch((error) => {
      outputError("Config Selector", String(error));
      return undefined;
    });
    let pick = await pickPromise;
    if (!pick) {
      return;
    };
    let isPrimary = pick.label !== confFileOption[0].label;
    return (input: MultiStepInput) => chooseFiles(input, state, isPrimary);
  }

  async function chooseFiles(input: MultiStepInput, state: ConfigFiles, isPrimary: boolean) {
    const confFiles = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: true,
      filters: fileExt
    });

    if (confFiles) {
      const key = getConfFileKey(isKConfigSelector, isPrimary);
      state[key] = state[key].concat(confFiles.map(x => (path.relative(wsConfig.rootPath, x.fsPath))));
    } else {
      void vscode.window.showInformationMessage(`Failed to select files`);
      return;
    }

    let addMoreOption: QuickPickItem[] = [];
    addMoreOption.push({ label: "Add More" });
    addMoreOption.push({ label: "Finished" });

    const pickPromise = input.showQuickPick({
      title,
      step: 3,
      totalSteps: 3,
      placeholder: 'Add more files?',
      items: addMoreOption,
      activeItem: undefined,
      ignoreFocusOut: true
    }).catch((error) => {
      outputError("Config Selector", String(error));
      return undefined;
    });
    let pick = await pickPromise;
    if (!pick) {
      return;
    };
    if (pick.label === addMoreOption[0].label) {
      return (input: MultiStepInput) => chooseFiles(input, state, isPrimary);
    }
    return;
  }

  async function collectInputs() {
    const state = {
      config: [],
      extraConfig: [],
      overlay: [],
      extraOverlay: [],
    };
    if (isPrimary === undefined) {
      await MultiStepInput.run(input => chooseIfPrimary(input, state));
    } else {
      await MultiStepInput.run(input => chooseFiles(input, state, isPrimary));
    }
    return state as ConfigFiles;
  }

  const state = await collectInputs();
  return state;
}



export async function configRemover(confFiles: ConfigFiles, isKConfigSelector: boolean, isProjectSelctor: boolean, isPrimary: boolean | undefined = undefined) {
  let additionalTitleString = "from Build";
  if (isProjectSelctor) {
    additionalTitleString = "from Project";
  }

  let fileType = "Devicetree Overlay";
  if (isKConfigSelector) {
    fileType = "KConfig";
  }

  let title = 'Remove ' + fileType + ' Files ' + additionalTitleString;

  async function selectTypeToRemove(input: MultiStepInput, state: ConfigFiles) {
    let confFileOption: QuickPickItem[] = [];
    confFileOption.push({ label: "Remove extra " + fileType + " File" });
    confFileOption.push({ label: "Overriden " + fileType + " File" });

    const pickPromise = input.showQuickPick({
      title,
      step: 1,
      totalSteps: 2,
      placeholder: 'Select type of file to remove',
      items: confFileOption,
      ignoreFocusOut: true,
      activeItem: undefined,
    }).catch((error) => {
      outputError("Config Selector", String(error));
      return undefined;
    });
    let pick = await pickPromise;
    if (!pick) {
      return;
    };
    let isPrimary = pick.label !== confFileOption[0].label;
    return (input: MultiStepInput) => chooseFiles(input, state, isPrimary);
  }

  async function chooseFiles(input: MultiStepInput, state: ConfigFiles, isPrimary: boolean) {
    const key = getConfFileKey(isKConfigSelector, isPrimary);
    const items = mapToQuickPickItems(state[key]);

    let temp = await vscode.window.showQuickPick(items, {
      ignoreFocusOut: true,
      placeHolder: "Select files to remove",
      canPickMany: true,
    });
    if (!temp) {
      return;
    }
    let selectedFiles = temp.map(x => (x.label));

    confFiles[key] = confFiles[key].filter(el => !selectedFiles.includes(el));
    return;
  }

  async function collectInputs() {
    if (isPrimary === undefined) {
      await MultiStepInput.run(input => selectTypeToRemove(input, confFiles));
    } else {
      await MultiStepInput.run(input => chooseFiles(input, confFiles, isPrimary));
    }
    return confFiles;
  }

  const state = await collectInputs();
  return state;
}