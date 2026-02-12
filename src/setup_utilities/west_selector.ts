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
import * as path from "upath";
import * as fs from "fs-extra";
import { MultiStepInput, showQuickPickMany } from "../utilities/multistepQuickPick";
import { notifyError } from "../utilities/output";
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

  async function getAdditionalArguments(input: MultiStepInput, state: Partial<WestLocation>) {
    try {
      state.additionalArgs = await input.showInputBox({
        title,
        step: 3,
        totalSteps: 3,
        ignoreFocusOut: true,
        placeholder: "--mr main",
        value: "",
        prompt: 'Additional west init arguments (optional)',
        validate: async () => undefined
      });
    } catch (error) {
      console.error('Error getting additional arguments:', error);
      state.additionalArgs = "";
    }
  }

  async function pickWestYml(input: MultiStepInput, state: Partial<WestLocation>) {
    if (!wsConfig.activeSetupState) {
      console.log("No active setup state found");
      console.log("Workspace configuration:", JSON.stringify(wsConfig, null, 2));
      return;
    }
    type westOptionDict = { [name: string]: string };
    // Looks for board directories
    let westOptions: westOptionDict = {};

    westOptions["Full Zephyr"] = "default_west.yml";
    westOptions["Minimal Zephyr (Select Desired HALs)"] = "minimal_west.yml";
    westOptions["Minimal BLE Zephyr (Select Desired HALs)"] = "minimal_ble_west.yml";
    westOptions["Sim Only"] = "simulated_west.yml";
    westOptions["NRF Connect Config"] = "ncs_west.yml";

    // Internal testing template — only visible in CI/test environments
    if (process.env.CI || process.env.ZEPHYR_IDE_TESTING) {
      westOptions["Testing"] = "testing_west.yml";
    }

    const westOptionQpItems: QuickPickItem[] = [];
    for (let key in westOptions) {
      westOptionQpItems.push({ label: key });
    }

    const pickPromise = await input.showQuickPick({
      title,
      step: 1,
      totalSteps: 3,
      placeholder: 'Select Zephyr workspace template',
      ignoreFocusOut: true,
      items: westOptionQpItems,
      activeItem: typeof state.path !== 'string' ? state.path : undefined,
    }).catch((error) => {
      return;
    });

    let pick = await pickPromise;
    if (!pick) {
      state.failed = true;
      return;
    }

    // All remaining options are template-based
    const westFile = westOptions[pick.label];
    const copyTemplate = true;

    if (!westFile) {
      notifyError("West Selector", `Failed to select workspace template`);
      state.failed = true;
      return;
    }

    if (copyTemplate) {
      let desiredHals;
      if (westFile === "minimal_west.yml" || westFile === "minimal_ble_west.yml") {
        const pickPromise = await showQuickPickMany({
          title,
          step: 2,
          totalSteps: 3,
          ignoreFocusOut: true,
          placeholder: "",
          items: zephyrHals,
          canSelectMany: true,
        }).catch((error) => {
          return;
        });
        desiredHals = await pickPromise;
      }

      const extensionPath = context.extensionPath;
      let srcPath = path.join(extensionPath, "resources", "west_templates", westFile);
      let westDirPath = path.join(wsConfig.activeSetupState.setupPath, "west-manifest");
      let desPath = path.join(westDirPath, "west.yml");
      let exists = await fs.pathExists(westDirPath);
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

      const versionList = isNcsProject ? ncsVersions : zephyrVersions;
      const versionSelectionString = isNcsProject ? "Select NCS Version" : "Select Zephyr Version";

      const versionQP: QuickPickItem[] = [
        { label: "Default" },
        { label: "", kind: vscode.QuickPickItemKind.Separator },
        ...versionList.map(version => ({ label: version }))
      ];

      const pickPromise = await input.showQuickPick({
        title,
        step: 3,
        totalSteps: 3,
        ignoreFocusOut: true,
        placeholder: versionSelectionString,
        items: versionQP,
        activeItem: typeof state.path !== 'string' ? state.path : undefined
      }).catch((error) => {
        return;
      });

      let pick = await pickPromise;
      if (!pick) {
        state.failed = true;
        return;
      }
      if (pick.label === "Other Version") {
        try {
          const version = await input.showInputBox({
            title,
            step: 3,
            totalSteps: 4,
            ignoreFocusOut: true,
            value: "Default",
            prompt: 'Input a Version Number (i.e vX.X.X) or branch name (i.e main)',
            validate: async (value: string) => {
              if (!value || value.trim() === "") {
                return "Please enter a version";
              }
              return undefined;
            }
          });

          if (version && version.trim() !== "") {
            pick.label = version;
          } else {
            state.failed = true;
            return;
          }
        } catch (error) {
          console.error('Error getting version:', error);
          state.failed = true;
          return;
        }
      }

      if (pick.label === "Default") {
        pick.label = versionList[0];
      }

      // Update project revision
      doc.manifest.projects.forEach((project: any) => {
        const shouldUpdate = (isNcsProject && project.name === "sdk-nrf") ||
          (!isNcsProject && project.name === "zephyr");
        if (shouldUpdate) {
          project.revision = pick.label;
        }
      });

      // Add desired HALs if any were selected
      if (desiredHals && desiredHals.length > 0) {
        const allowList = doc.manifest.projects[0].import["name-allowlist"];
        if (allowList) {
          desiredHals.forEach((hal: any) => {
            if (hal.description && !allowList.includes(hal.description)) {
              allowList.push(hal.description);
            }
          });
        }
      }

      fs.writeFileSync(desPath, yaml.dump(doc));


      state.failed = false;
      state.path = westDirPath;
    } else {
      state.failed = false;
      state.path = westFile.toString();
    }
    await getAdditionalArguments(input, state);
    return;
  }

  async function collectInputs(): Promise<WestLocation> {
    const state = { ...defaultState } as Partial<WestLocation>;
    try {
      await MultiStepInput.run(input => pickWestYml(input, state));
      return state as WestLocation;
    } catch (error) {
      console.error('Error in west selector:', error);
      console.error(state);
      return { ...defaultState, failed: true };
    }
  }

  return await collectInputs();
}

