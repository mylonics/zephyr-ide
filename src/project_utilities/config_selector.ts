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
import * as vscode from "vscode";
import { MultiStepInput, mapToQuickPickItems } from "../utilities/multistepQuickPick";
import { outputError } from "../utilities/output";
import * as path from 'upath';

import { WorkspaceConfig } from "../setup_utilities/types";

/** A single config file entry with an optional "extra" flag. */
export interface ConfigFileEntry {
  path: string;
  /** When true the file is passed as EXTRA_CONF_FILE / EXTRA_DTC_OVERLAY_FILE.
   *  When false or omitted it is an override (CONF_FILE / DTC_OVERLAY_FILE). */
  extra?: boolean;
}

// Config for the extension
export interface ConfigFiles {
  config: ConfigFileEntry[];
  overlay: ConfigFileEntry[];
}

/** Create a default (empty) ConfigFiles object. */
export function emptyConfigFiles(): ConfigFiles {
  return { config: [], overlay: [] };
}

/** Merge all fields from `source` into `target` by concatenating arrays. */
export function mergeConfigFiles(target: ConfigFiles, source: ConfigFiles): void {
  for (const key of ["config", "overlay"] as (keyof ConfigFiles)[]) {
    target[key] = target[key].concat(source[key]);
  }
}

/** Helper: get the paths that are primary (override) entries. */
export function primaryPaths(entries: ConfigFileEntry[]): string[] {
  return entries.filter(e => !e.extra).map(e => e.path);
}

/** Helper: get the paths that are extra entries. */
export function extraPaths(entries: ConfigFileEntry[]): string[] {
  return entries.filter(e => e.extra).map(e => e.path);
}

export async function configSelector(wsConfig: WorkspaceConfig, isKConfigSelector: boolean): Promise<ConfigFiles> {
  let fileExt: Record<string, string[]> = {
    'dtc': ['overlay']
  };

  if (isKConfigSelector) {
    fileExt = {
      'KConfig': ['conf', '*']
    };
  }

  const state: ConfigFiles = emptyConfigFiles();

  const confFiles = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: true,
    filters: fileExt
  });

  if (confFiles) {
    const key: keyof ConfigFiles = isKConfigSelector ? "config" : "overlay";
    state[key] = confFiles.map(x => ({ path: path.relative(wsConfig.rootPath, x.fsPath), extra: true }));
  }

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

  const title = 'Remove ' + fileType + ' Files ' + additionalTitleString;
  const key: keyof ConfigFiles = isKConfigSelector ? "config" : "overlay";

  async function selectTypeToRemove(input: MultiStepInput, state: ConfigFiles) {
    const confFileOption: QuickPickItem[] = [];
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
    const pick = await pickPromise;
    if (!pick) {
      return;
    };
    const pickIsExtra = pick.label === confFileOption[0].label;
    return (input: MultiStepInput) => chooseFiles(input, state, pickIsExtra);
  }

  async function chooseFiles(input: MultiStepInput, state: ConfigFiles, isExtra: boolean) {
    const filtered = state[key].filter(e => !!e.extra === isExtra);
    const items = mapToQuickPickItems(filtered.map(e => e.path));

    const temp = await vscode.window.showQuickPick(items, {
      ignoreFocusOut: true,
      placeHolder: "Select files to remove",
      canPickMany: true,
    });
    if (!temp) {
      return;
    }
    const selectedFiles = new Set(temp.map(x => x.label));

    confFiles[key] = confFiles[key].filter(el => !(!!el.extra === isExtra && selectedFiles.has(el.path)));
    return;
  }

  async function collectInputs() {
    if (isPrimary === undefined) {
      await MultiStepInput.run(input => selectTypeToRemove(input, confFiles));
    } else {
      await MultiStepInput.run(input => chooseFiles(input, confFiles, !isPrimary));
    }
    return confFiles;
  }

  const state = await collectInputs();
  return state;
}