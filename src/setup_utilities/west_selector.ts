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

import { QuickPickItem, ExtensionContext } from 'vscode';
import * as vscode from "vscode";
import * as path from "upath";
import * as fs from "fs-extra";
import { MultiStepInput } from "../utilities/multistepQuickPick";
import { notifyError, outputInfo, outputError } from "../utilities/output";
import { WorkspaceConfig } from './types';
import * as yaml from 'js-yaml';

import { zephyrVersions, ncsVersions, zephyrHals } from "../defines";

/**
 * Configuration interface for west workspace initialization
 */
export interface WestLocation {
  /** Local path to west.yml directory (if using local file) */
  path: string | undefined;
  /** Indicates if the selection/configuration failed */
  failed: boolean;
  /** Git repository URL (if cloning from git) */
  gitRepo: string;
  /** Additional west init arguments */
  additionalArgs: string;
}



/**
 * Interactive west workspace selector - allows users to choose how to initialize a west workspace
 * 
 * Available template options:
 * - Full Zephyr installation
 * - Minimal Zephyr with custom HAL selection
 * - Minimal BLE Zephyr with custom HAL selection  
 * - NRF Connect SDK configuration
 * 
 * @param context VS Code extension context
 * @param wsConfig Current workspace configuration
 * @returns Promise resolving to WestLocation configuration
 */
export async function westSelector(context: ExtensionContext, wsConfig: WorkspaceConfig): Promise<WestLocation> {
  const title = 'Initialize West';

  const defaultState: WestLocation = {
    path: undefined,
    failed: false,
    gitRepo: "",
    additionalArgs: ""
  };

  // Shared state that is accumulated across steps
  type WestInternalState = {
    westFile?: string;
    desiredHals?: readonly QuickPickItem[];
    isNcsProject?: boolean;
    versionLabel?: string;
  } & Partial<WestLocation>;

  // Compute total steps dynamically depending on whether HAL selection is required.
  // Base steps: 1) template, 2) version, 3) additional args.
  // When a minimal template is chosen we insert a HAL step between template and version.
  function totalStepsFor(state: WestInternalState): number {
    const needsHal = state.westFile === "minimal_west.yml" || state.westFile === "minimal_ble_west.yml";
    return needsHal ? 4 : 3;
  }

  async function pickTemplate(input: MultiStepInput, state: WestInternalState) {
    if (!wsConfig.activeSetupState) {
      outputInfo("West Selector", "No active setup state found");
      state.failed = true;
      return;
    }

    type westOptionDict = { [name: string]: string };
    const westOptions: westOptionDict = {};
    westOptions["Full Zephyr"] = "default_west.yml";
    westOptions["Minimal Zephyr (Select Desired HALs)"] = "minimal_west.yml";
    westOptions["Minimal BLE Zephyr (Select Desired HALs)"] = "minimal_ble_west.yml";
    westOptions["Sim Only"] = "simulated_west.yml";
    westOptions["NRF Connect Config"] = "ncs_west.yml";

    // Internal testing template — only visible in CI/test environments
    if (process.env.CI || process.env.ZEPHYR_IDE_TESTING) {
      westOptions["Testing"] = "testing_west.yml";
    }

    const westOptionQpItems: QuickPickItem[] = Object.keys(westOptions).map(label => ({ label }));

    const pick = await input.showQuickPick({
      title,
      step: 1,
      totalSteps: totalStepsFor(state),
      placeholder: 'Select West manifest template',
      ignoreFocusOut: true,
      items: westOptionQpItems,
    });

    const westFile = westOptions[pick.label];
    if (!westFile) {
      notifyError("West Selector", `Failed to select workspace template`);
      state.failed = true;
      return;
    }

    state.westFile = westFile;
    const needsHal = westFile === "minimal_west.yml" || westFile === "minimal_ble_west.yml";
    if (needsHal) {
      return (input: MultiStepInput) => pickHals(input, state);
    }
    return (input: MultiStepInput) => pickVersion(input, state);
  }

  async function pickHals(input: MultiStepInput, state: WestInternalState) {
    state.desiredHals = await input.showQuickPickMany({
      title,
      step: 2,
      totalSteps: totalStepsFor(state),
      ignoreFocusOut: true,
      placeholder: "Select desired HALs (toggle then press Enter)",
      items: zephyrHals,
    });
    return (input: MultiStepInput) => pickVersion(input, state);
  }

  async function pickVersion(input: MultiStepInput, state: WestInternalState) {
    if (!state.westFile || !wsConfig.activeSetupState) {
      state.failed = true;
      return;
    }

    // Materialize the west.yml so we can determine whether it is an NCS project.
    const extensionPath = context.extensionPath;
    const srcPath = path.join(extensionPath, "resources", "west_templates", state.westFile);
    const westDirPath = path.join(wsConfig.activeSetupState.setupPath, "west-manifest");
    const desPath = path.join(westDirPath, "west.yml");
    const exists = await fs.pathExists(westDirPath);
    if (!exists) {
      await fs.mkdirp(westDirPath);
    }
    await fs.copyFile(srcPath, desPath, fs.constants.COPYFILE_FICLONE);

    const doc: any = yaml.load(fs.readFileSync(desPath, 'utf-8'));
    let isNcsProject = false;
    for (let i = 0; i < doc.manifest.projects.length; i++) {
      if (doc.manifest.projects[i].name === "sdk-nrf") {
        isNcsProject = true;
      }
    }
    state.isNcsProject = isNcsProject;

    const versionList = isNcsProject ? ncsVersions : zephyrVersions;
    const versionSelectionString = isNcsProject ? "Select NCS Version" : "Select Zephyr Version";

    const versionQP: QuickPickItem[] = [
      { label: "Default" },
      { label: "", kind: vscode.QuickPickItemKind.Separator },
      ...versionList.map(version => ({ label: version }))
    ];

    const needsHal = state.westFile === "minimal_west.yml" || state.westFile === "minimal_ble_west.yml";
    const versionStep = needsHal ? 3 : 2;

    const pick = await input.showQuickPick({
      title,
      step: versionStep,
      totalSteps: totalStepsFor(state),
      ignoreFocusOut: true,
      placeholder: versionSelectionString,
      items: versionQP,
    });

    let versionLabel = pick.label;
    if (versionLabel === "Other Version") {
      const version = await input.showInputBox({
        title,
        step: versionStep,
        totalSteps: totalStepsFor(state),
        ignoreFocusOut: true,
        value: "Default",
        prompt: 'Enter version (e.g., v3.7.0) or branch name (e.g., main)',
        validate: async (value: string) => {
          if (!value || value.trim() === "") {
            return "Please enter a version";
          }
          return undefined;
        }
      });

      if (version && version.trim() !== "") {
        versionLabel = version;
      } else {
        state.failed = true;
        return;
      }
    }

    if (versionLabel === "Default") {
      versionLabel = versionList[0];
    }
    state.versionLabel = versionLabel;

    // Apply the version and HAL selections to the materialized west.yml
    doc.manifest.projects.forEach((project: any) => {
      const shouldUpdate = (isNcsProject && project.name === "sdk-nrf") ||
        (!isNcsProject && project.name === "zephyr");
      if (shouldUpdate) {
        project.revision = versionLabel;
      }
    });

    if (state.desiredHals && state.desiredHals.length > 0) {
      const allowList = doc.manifest.projects[0].import?.["name-allowlist"];
      if (allowList) {
        state.desiredHals.forEach((hal: any) => {
          if (hal.description && !allowList.includes(hal.description)) {
            allowList.push(hal.description);
          }
        });
      }
    }

    fs.writeFileSync(desPath, yaml.dump(doc));

    state.failed = false;
    state.path = westDirPath;

    return (input: MultiStepInput) => getAdditionalArguments(input, state);
  }

  async function getAdditionalArguments(input: MultiStepInput, state: WestInternalState) {
    const needsHal = state.westFile === "minimal_west.yml" || state.westFile === "minimal_ble_west.yml";
    const argsStep = needsHal ? 4 : 3;
    state.additionalArgs = await input.showInputBox({
      title,
      step: argsStep,
      totalSteps: totalStepsFor(state),
      ignoreFocusOut: true,
      placeholder: "--mr main",
      value: "",
      prompt: 'Additional west init arguments (optional)',
      validate: async () => undefined
    });
  }

  async function collectInputs(): Promise<WestLocation> {
    const state: WestInternalState = { ...defaultState };
    try {
      await MultiStepInput.run(input => pickTemplate(input, state));
      if (state.failed || !state.path) {
        return { ...defaultState, failed: true };
      }
      return {
        path: state.path,
        failed: false,
        gitRepo: state.gitRepo ?? "",
        additionalArgs: state.additionalArgs ?? "",
      };
    } catch (error) {
      outputError("West Selector", `Error in west selector: ${String(error)}`);
      return { ...defaultState, failed: true };
    }
  }

  return await collectInputs();
}

