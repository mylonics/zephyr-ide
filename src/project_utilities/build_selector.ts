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
import { executeShellCommand, getShellEnvironment, output } from "../utilities/utils";

// Config for the extension
export interface BuildConfig {
  name: string;
  board: string;
  relBoardDir: string;
  relBoardSubDir: string;
  debugOptimization: string;
  runners: RunnerConfigDictionary;
  activeRunner?: string;
  confFiles: ConfigFiles;
  launchTarget: string;
  buildDebugTarget: string;
  attachTarget: string;
}

export type BuildConfigDictionary = { [name: string]: BuildConfig };

export async function buildSelector(context: ExtensionContext, wsConfig: WorkspaceConfig) {
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

    let zephyrBoardDir: string;
    if (wsConfig.zephyrDir) {
      zephyrBoardDir = path.join(wsConfig.zephyrDir, `boards`);
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

    return (input: MultiStepInput) => inputBoardName(input, state, zephyrBoardDir !== pick.label);
  }

  async function inputBoardName(input: MultiStepInput, state: Partial<BuildConfig>, useCustomFolder: boolean) {
    let boards: { name: string, subdir: string }[] = [];

    if (state.relBoardDir) {
      console.log("Changing board dir to " + state.relBoardDir);
      let boardList = await getBoardlistWest(useCustomFolder, vscode.Uri.file(path.join(wsConfig.rootPath, state.relBoardDir)), wsConfig.onlyArm);
      if (!boardList) {
        return;
      }
      boards = boards.concat(boardList);
      const boardQpItems: QuickPickItem[] = boards.map(x => ({ label: x.name, description: x.subdir }));
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
      state.relBoardSubDir = pick.description;

      return (input: MultiStepInput) => inputBuildName(input, state);
    }
  }

  async function getBoardlistWest(useCustomFolder: boolean, folder: vscode.Uri, onlyArm: boolean): Promise<{ name: string, subdir: string }[] | undefined> {
    const extensionPath = context.extensionPath;
    let srcPath = path.join(extensionPath, "scripts", "board_list.py");

    let noQualifiers = false;
    let resultOrig: { res: boolean, val: string };
    let result: { res: boolean, val: string };
    if (useCustomFolder) {
      resultOrig = await executeShellCommand("python " + srcPath + " --board-root " + path.dirname(folder.fsPath) + " -f '{name}:{qualifiers}:{dir}'", getShellEnvironment(wsConfig), false);
      if (!resultOrig.res) {
        noQualifiers = true;
        result = await executeShellCommand("python " + srcPath + " --board-root " + path.dirname(folder.fsPath) + " -f '{name}:{name}:{dir}'", getShellEnvironment(wsConfig), false);
      } else {
        result = resultOrig;
      }
    } else {
      resultOrig = await executeShellCommand("west boards -f '{name}:{qualifiers}:{dir}'", getShellEnvironment(wsConfig), false);
      if (!resultOrig.res) {
        noQualifiers = true;
        result = await executeShellCommand("west boards -f '{name}:{name}:{dir}'", getShellEnvironment(wsConfig), false);
      } else {
        result = resultOrig;
      }
    }


    if (!result.res) {
      output.append(result.val);
      vscode.window.showErrorMessage("Failed to run west boards command. See Zephyr IDE Output for error message");
      return;
    }

    let allBoardData = result.val.split(/\r?\n/);
    let outputData: { name: string, subdir: string }[] = [];
    for (let i = 0; i < allBoardData.length; i++) {

      let arr = allBoardData[i].replaceAll("'", "").split(":");
      let boardData = arr.splice(0, 2);
      boardData.push(arr.join(':'));

      let qualifiers = boardData[1].split(",");
      if (qualifiers.length > 1) {
        for (let j = 0; j < qualifiers.length; j++) {
          outputData.push({ name: boardData[0] + "/" + qualifiers[j], subdir: boardData[2] });
        }
      } else {
        if (boardData.length > 2) {
          outputData.push({ name: boardData[0], subdir: boardData[2] });
        }
      }

    }
    return outputData;
  }

  async function getBoardlist(folder: vscode.Uri, onlyArm: boolean): Promise<{ name: string, subdir: string }[]> {
    let files = await vscode.workspace.fs.readDirectory(folder);
    let boards: { name: string, subdir: string }[] = [];

    while (true) {
      let file = files.pop();

      // Stop looping once done.
      if (file === undefined) {
        break;
      }

      if (file[0].includes(".yaml")) {
        let parsed = path.parse(file[0]);
        boards.unshift({ name: parsed.name, subdir: parsed.dir });
      } else if (file[0].includes("build") || file[0].includes(".git")) {
        // Don't do anything
      } else if (file[1] === vscode.FileType.Directory) {
        let filePath = vscode.Uri.joinPath(folder, file[0]);
        let subfolders = await vscode.workspace.fs.readDirectory(filePath);

        for (let { index, value } of subfolders.map((value, index) => ({
          index,
          value,
        }))) {
          subfolders[index][0] = path.join(file[0], subfolders[index][0]);
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

