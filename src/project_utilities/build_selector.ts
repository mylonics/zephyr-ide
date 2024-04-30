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
import { MultiStepInput } from "../utilities/multistepQuickPick";
import { RunnerConfigDictionary } from './runner_selector';
import { ConfigFiles } from './config_selector';
import { WorkspaceConfig } from '../setup_utilities/setup';

// Config for the extension
export interface BuildConfig {
  name: string;
  board: string;
  relBoardDir: string;
  debugOptimization: string;
  runners: RunnerConfigDictionary;
  activeRunner?: string;
  confFiles: ConfigFiles;
  launchTarget: string;
  buildDebugTarget: string;
  attachTarget: string;
}

export type BuildConfigDictionary = { [name: string]: BuildConfig };

export async function buildSelector(wsConfig: WorkspaceConfig) {


  const title = 'Add Build Configuration';

  async function pickBoardDir(input: MultiStepInput, state: Partial<BuildConfig>) {
    console.log("Roto path: " + wsConfig.rootPath);

    // Looks for board directories
    let boardDirectories: string[] = [];

    // Look in root
    let boardDir = path.join(wsConfig.rootPath, `boards`);
    if (fs.pathExistsSync(boardDir)) {
      boardDirectories = boardDirectories.concat(boardDir);
    }

    if (wsConfig.zephyrDir) {
      let zephyrBoardDir = path.join(wsConfig.zephyrDir, `boards`);
      if (fs.pathExistsSync(zephyrBoardDir)) {
        boardDirectories = boardDirectories.concat(zephyrBoardDir);
      }
    }
    console.log("Boards dir: " + boardDirectories);

    boardDirectories.push("Select Other Folder");
    const boardDirectoriesQpItems: QuickPickItem[] = boardDirectories.map(label => ({ label }));

    const pickPromise = input.showQuickPick({
      title,
      step: 1,
      totalSteps: 4,
      placeholder: 'Pick Board Directory',
      items: boardDirectoriesQpItems,
      activeItem: typeof state.relBoardDir !== 'string' ? state.relBoardDir : undefined,
      shouldResume: shouldResume
    }).catch((error) => {
      console.error(error);
      return undefined;
    });
    let pick = await pickPromise;
    if (!pick) {
      return;
    };

    state.relBoardDir = path.relative(wsConfig.rootPath, pick.label);
    if (pick.label === "Select Other Folder") {
      const boarddir = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
      });
      if (boarddir) {
        state.relBoardDir = path.relative(wsConfig.rootPath, boarddir[0].fsPath);
      } else {
        vscode.window.showInformationMessage(`Failed to select board directory`);
        return;
      }
    }

    return (input: MultiStepInput) => inputBoardName(input, state);
  }

  async function inputBoardName(input: MultiStepInput, state: Partial<BuildConfig>) {
    let boards: string[] = [];

    if (state.relBoardDir) {
      console.log("Changing board dir to " + state.relBoardDir);
      boards = boards.concat(await getBoardlist(vscode.Uri.file(path.join(wsConfig.rootPath, state.relBoardDir)), wsConfig.onlyArm));
      const boardQpItems: QuickPickItem[] = boards.map(label => ({ label }));
      const pickPromise = input.showQuickPick({
        title,
        step: 2,
        totalSteps: 4,
        placeholder: 'Pick Board',
        items: boardQpItems,
        activeItem: typeof state.relBoardDir !== 'string' ? state.relBoardDir : undefined,
        shouldResume: shouldResume
      }).catch((error) => {
        console.error(error);
        return undefined;
      });
      let pick = await pickPromise;
      if (!pick) {
        return;
      };
      state.board = pick.label;

      return (input: MultiStepInput) => inputBuildName(input, state);
    }
  }

  async function getBoardlist(folder: vscode.Uri, onlyArm: boolean): Promise<string[]> {
    if (onlyArm) {
      let files = await vscode.workspace.fs.readDirectory(vscode.Uri.joinPath(folder, "arm"));
      return files.map((x => (x[0])));
    }

    let files = await vscode.workspace.fs.readDirectory(folder);
    let boards: string[] = [];

    while (true) {
      let file = files.pop();

      // Stop looping once done.
      if (file === undefined) {
        break;
      }

      if (file[0].includes(".yaml")) {
        let parsed = path.parse(file[0]);
        boards.push(parsed.name);
      } else if (file[0].includes("build") || file[0].includes(".git")) {
        // Don't do anything
      } else if (file[1] === vscode.FileType.Directory) {
        let path = vscode.Uri.joinPath(folder, file[0]);
        let subfolders = await vscode.workspace.fs.readDirectory(path);

        for (let { index, value } of subfolders.map((value, index) => ({
          index,
          value,
        }))) {
          subfolders[index][0] = vscode.Uri.parse(`${file[0]}/${subfolders[index][0]}`).fsPath;
        }
        files = files.concat(subfolders);
      }
    }
    return boards;
  }


  async function inputBuildName(input: MultiStepInput, state: Partial<BuildConfig>) {
    if (state.board === undefined) {
      return;
    }

    const inputPromise = input.showInputBox({
      title,
      step: 3,
      totalSteps: 4,
      value: path.join("build", state.board),
      prompt: 'Choose a name for the Build',
      validate: validate,
      shouldResume: shouldResume
    }).catch((error) => {
      console.error(error);
      return undefined;
    });
    let name = await inputPromise;
    if (!name) {
      return;
    };

    state.name = name;
    return (input: MultiStepInput) => setBuildOptimization(input, state);
  }

  async function setBuildOptimization(input: MultiStepInput, state: Partial<BuildConfig>) {
    const buildOptimizations = ["Debug", "Speed", "Size", "No Optimizations", "Don't set. Will be configured in included KConfig file"];
    const buildOptimizationsQpItems: QuickPickItem[] = buildOptimizations.map(label => ({ label }));

    const pickPromise = input.showQuickPick({
      title,
      step: 4,
      totalSteps: 4,
      placeholder: 'Select Build Optimization',
      items: buildOptimizationsQpItems,
      activeItem: typeof state.debugOptimization !== 'string' ? state.debugOptimization : undefined,
      shouldResume: shouldResume
    }).catch((error) => {
      console.error(error);
      return undefined;
    });
    let pick = await pickPromise;
    if (!pick) {
      return;
    };
    state.debugOptimization = pick.label;


    state.confFiles = {
      config: [],
      extraConfig: [],
      overlay: [],
      extraOverlay: []
    };

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
    const state = {} as Partial<BuildConfig>;
    await MultiStepInput.run(input => pickBoardDir(input, state));
    return state as BuildConfig;
  }

  const state = await collectInputs();
  return state;
}

