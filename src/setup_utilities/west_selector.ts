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
import { MultiStepInput, showQuickPick } from "../utilities/multistepQuickPick";
import { WorkspaceConfig } from './setup';
import * as yaml from 'js-yaml';

import { zephyrVersions, ncsVersions, zephyrHals } from "../defines";

// Config for the extension
export interface WestLocation {
  path: string | undefined;
  failed: boolean;
  gitRepo: string;
  additionalArgs: string;
}



export async function westSelector(context: ExtensionContext, wsConfig: WorkspaceConfig) {
  const title = 'Initialize West';

  async function getAdditionalArguments(input: MultiStepInput, state: Partial<WestLocation>) {
    async function validateArgs(name: string) {
      return undefined;
    }
    state.additionalArgs = await input.showInputBox({
      title,
      step: 3,
      totalSteps: 3,
      ignoreFocusOut: true,
      placeholder: "--mr main",
      value: "",
      prompt: 'Additional arguments? (--mr main, --mf west.yml)',
      validate: validateArgs,
      shouldResume: shouldResume
    }).catch((error) => {
      console.error(error);
      return "";
    });
  }

  async function pickWestYml(input: MultiStepInput, state: Partial<WestLocation>) {
    type westOptionDict = { [name: string]: string };
    // Looks for board directories
    let westOptions: westOptionDict = {};

    westOptions["Full Zephyr"] = "default_west.yml";
    westOptions["Minimal Zephyr (Select Desired HALs)"] = "minimal_west.yml";
    westOptions["Minimal BLE Zephyr (Select Desired HALs)"] = "minimal_ble_west.yml";
    westOptions["NRF Connect Config"] = "ncs_west.yml";
    westOptions["From Git Repo"] = "";
    westOptions["Select west.yml in Workspace"] = "";

    const westOptionQpItems: QuickPickItem[] = [];
    for (let key in westOptions) {
      westOptionQpItems.push({ label: key });
    }

    const pickPromise = await input.showQuickPick({
      title,
      step: 1,
      totalSteps: 3,
      placeholder: 'Select west.yml',
      ignoreFocusOut: true,
      items: westOptionQpItems,
      activeItem: typeof state.path !== 'string' ? state.path : undefined,
      shouldResume: shouldResume,
    }).catch((error) => {
      return;
    });

    let pick = await pickPromise;
    if (!pick) {
      state.failed = true;
      return;
    }

    let copyTemplate = false;
    let westFile;

    if (pick.label === "From Git Repo") {
      async function validateGitRepoString(name: string) {
        return undefined;
      }
      state.gitRepo = await input.showInputBox({
        title,
        step: 2,
        totalSteps: 3,
        ignoreFocusOut: true,
        placeholder: "https://github.com/zephyrproject-rtos/example-application",
        value: "",
        prompt: 'Specify a git repository to clone from',
        validate: validateGitRepoString,
        shouldResume: shouldResume
      }).catch((error) => {
        console.error(error);
        return undefined;
      });
      if (state.gitRepo && state.gitRepo !== "") {
        await getAdditionalArguments(input, state);
        state.failed = false;
      } else {
        state.failed = true;
      }
      return;
    }
    else if (pick.label === "Select west.yml in Workspace") {
      let browsedWestFile = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        filters: {
          'west.yml': ['yml']
        },
      });
      if (browsedWestFile !== undefined) {
        westFile = path.dirname(browsedWestFile[0].fsPath);
      } else {
        state.failed = true;
        return;
      }
    } else {
      westFile = westOptions[pick.label];
      copyTemplate = true;
    }

    if (westFile === undefined || pick.label === undefined) {
      await vscode.window.showInformationMessage(`Failed to select west.yml file`);
      state.failed = true;
      return;
    }

    if (copyTemplate) {
      let desiredHals;
      if (westFile === "minimal_west.yml" || westFile === "minimal_ble_west.yml") {
        const pickPromise = await showQuickPick({
          title,
          step: 2,
          totalSteps: 3,
          ignoreFocusOut: true,
          placeholder: "",
          items: zephyrHals,
          shouldResume: shouldResume,
          canSelectMany: true,
        }).catch((error) => {
          return;
        });
        desiredHals = pickPromise;
      }

      const extensionPath = context.extensionPath;
      let srcPath = path.join(extensionPath, "west_templates", westFile);
      let westDirPath = "";
      if (wsConfig.activeSetupState) {
        westDirPath = path.join(wsConfig.activeSetupState.setupPath, "west-manifest");
      }
      let desPath = path.join(westDirPath, "west.yml");
      let exists = await fs.pathExists(westDirPath);
      if (!exists) {
        await fs.mkdirp(westDirPath);
      }

      let res = await fs.copyFile(srcPath, desPath, fs.constants.COPYFILE_FICLONE);
      let doc: any = yaml.load(fs.readFileSync(desPath, 'utf-8'));

      let isNcsProject = false;
      for (let i = 0; i < doc.manifest.projects.length; i++) {
        if (doc.manifest.projects[i].name === "sdk-nrf") {
          isNcsProject = true;
        }
      }

      let versionList = zephyrVersions;
      let versionSelectionString = "Select Zephyr Version";
      if (isNcsProject) {
        versionList = ncsVersions;
        versionSelectionString = "Select NCS Version";
      }

      const versionQP: QuickPickItem[] = [];
      versionQP.push({ label: "Default" });
      versionQP.push({ label: "", kind: vscode.QuickPickItemKind.Separator });


      for (let key in versionList) {
        versionQP.push({ label: versionList[key] });
      }

      const pickPromise = await input.showQuickPick({
        title,
        step: 3,
        totalSteps: 3,
        ignoreFocusOut: true,
        placeholder: versionSelectionString,
        items: versionQP,
        activeItem: typeof state.path !== 'string' ? state.path : undefined,
        shouldResume: shouldResume,
      }).catch((error) => {
        return;
      });

      let pick = await pickPromise;
      if (!pick) {
        state.failed = true;
        return;
      }
      if (pick.label === "Other Version") {
        async function validate(name: string) {
          return undefined;
        }

        const inputPromise = input.showInputBox({
          title,
          step: 3,
          totalSteps: 4,
          ignoreFocusOut: true,
          value: "Default",
          prompt: 'Input a Version Number (i.e vX.X.X) or branch name (i.e main)',
          validate: validate,
          shouldResume: shouldResume
        }).catch((error) => {
          console.error(error);
          return undefined;
        });
        let version = await inputPromise;
        if (!version) {
          return;
        };
        pick.label = version;
      }

      if (pick.label === "Default") {
        pick.label = versionList[0];
      }

      for (let i = 0; i < doc.manifest.projects.length; i++) {
        if ((isNcsProject && doc.manifest.projects[i].name === "sdk-nrf") || !isNcsProject && doc.manifest.projects[i].name === "zephyr") {
          doc.manifest.projects[i].revision = pick.label;
        }
      }
      if (desiredHals) {
        desiredHals.forEach(e => {
          doc.manifest.projects[0].import["name-allowlist"].push(e.description);
        });
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

  function shouldResume() {
    // Could show a notification with the option to resume.
    return new Promise<boolean>((resolve, reject) => {
      reject();
    });
  }

  async function collectInputs() {
    const state = {} as Partial<WestLocation>;
    await MultiStepInput.run(input => pickWestYml(input, state));

    return state as WestLocation;
  }

  const state = await collectInputs();
  return state;
}

