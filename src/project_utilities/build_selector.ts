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
import { MultiStepInput, showQuickPick, showInputBox } from "../utilities/multistepQuickPick";
import { RunnerConfigDictionary, RunnerStateDictionary } from './runner_selector';
import { ConfigFiles } from './config_selector';
import { SetupState } from '../setup_utilities/types';
import { executeShellCommandInPythonEnv, output } from "../utilities/utils";
import { isVersionNumberGreaterEqual, isVersionNumberGreater } from '../setup_utilities/modules';


// Config for the extension
export interface BoardConfig {
  board: string;
  relBoardDir?: string;
  relBoardSubDir: string;
  revision?: string;
}

// Config for the extension
export interface BuildConfig {
  name: string;
  board: string;
  relBoardDir: string;
  relBoardSubDir: string;
  debugOptimization: string;
  westBuildArgs: string;
  westBuildCMakeArgs: string;
  runnerConfigs: RunnerConfigDictionary;
  confFiles: ConfigFiles;
  launchTarget: string;
  buildDebugTarget: string;
  attachTarget: string;
  revision?: string;
}

// Config for the extension
export interface BuildState {
  activeRunner?: string;
  viewOpen?: boolean;
  runnerStates: RunnerStateDictionary;
}

interface BoardItem extends QuickPickItem {
  revisions?: string[],
  revision_default?: string;
}


export type BuildConfigDictionary = { [name: string]: BuildConfig };
export type BuildStateDictionary = { [name: string]: BuildState };

async function getBoardlistWest(setupState: SetupState, folder: vscode.Uri | undefined): Promise<{ name: string, subdir: string, revisions?: string[], revision_default?: string }[] | undefined> {
  let boardRootString = "";
  if (folder) {
    boardRootString = " --board-root " + path.dirname(folder.fsPath);
  }

  let prevError: any;
  if (setupState.zephyrVersion === undefined) { return; }
  let res;
  let has_qualifiers = false;
  let has_revisions = false;
  if (isVersionNumberGreater(setupState.zephyrVersion, 4, 1, 0)) {
    res = await executeShellCommandInPythonEnv("west boards -f '{name};{dir};{qualifiers};{revisions};{revision_default}'" + boardRootString, setupState.setupPath, setupState, false);
    has_qualifiers = true;
    has_revisions = true;
  } else if (isVersionNumberGreaterEqual(setupState.zephyrVersion, 3, 7, 0)) {
    res = await executeShellCommandInPythonEnv("west boards -f '{name};{dir};{qualifiers}'" + boardRootString, setupState.setupPath, setupState, false);
    has_qualifiers = true;
  } else {
    res = await executeShellCommandInPythonEnv("west boards -f '{name};{dir}'" + boardRootString, setupState.setupPath, setupState, false);
  }

  if (!res.stdout) {
    output.append(prevError);
    output.append(res.stderr);
    vscode.window.showErrorMessage("Failed to run west boards command. See Zephyr IDE Output for error message");
    return;
  }

  let allBoardData = res.stdout.split(/\r?\n/);
  let outputData: { name: string, subdir: string, revisions?: string[], revision_default?: string }[] = [];
  for (let i = 0; i < allBoardData.length; i++) {
    let boardData = allBoardData[i].replaceAll("'", "").split(";");
    try {
      if (boardData.length > 1) {

        let qualifiers: string[] = [];
        if (has_qualifiers) {
          qualifiers = boardData[2].split(",");
        }

        let revisions: string[] | undefined;
        let revision_default: string | undefined;

        if (has_revisions) {
          if (boardData[3] !== "None") {
            revisions = boardData[3].split(" ");
            revision_default = boardData[4];
          }
        }

        if (qualifiers.length > 1) {
          for (let j = 0; j < qualifiers.length; j++) {
            outputData.push({ name: boardData[0] + "/" + qualifiers[j], subdir: boardData[1], revisions: revisions, revision_default: revision_default });
          }
        } else {
          outputData.push({ name: boardData[0], subdir: boardData[1], revisions: revisions, revision_default: revision_default });
        }
      }
    } catch (error) {
      console.log(error);
    }


  }
  return outputData;
}

export async function pickBoard(setupState: SetupState, rootPath: string) {
  // Looks for board directories
  let boardDirectories: string[] = [];

  // Look in root
  let boardDir = path.join(rootPath, `boards`);
  if (fs.pathExistsSync(boardDir)) {
    boardDirectories = boardDirectories.concat(boardDir);
  }

  if (setupState.zephyrDir) {
    boardDirectories.push('Zephyr Directory Only');
  }
  console.log("Boards dir: " + boardDirectories);

  boardDirectories.push("Select Other Folder");
  const boardDirectoriesQpItems: QuickPickItem[] = boardDirectories.map(label => ({ label }));

  const title = "Board Picker";

  let pickPromise = showQuickPick({
    title,
    step: 1,
    totalSteps: 3,
    placeholder: 'Pick Additional Board Directory',
    ignoreFocusOut: true,
    items: boardDirectoriesQpItems,
    activeItem: undefined,
    dispose: false,
  }).catch((error) => {
    console.error(error);
    return undefined;
  });
  let pick = (await pickPromise as QuickPickItem);
  if (!pick) {
    return;
  };

  let relBoardDir: string | undefined = path.relative(rootPath, (pick.label));
  if (pick.label === "Select Other Folder") {
    const boarddir = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
    });
    if (boarddir) {
      relBoardDir = path.relative(rootPath, boarddir[0].fsPath);
    } else {
      vscode.window.showInformationMessage(`Failed to select board directory`);
      return;
    }
  } else if (pick.label === 'Zephyr Directory Only') {
    relBoardDir = undefined;
  }

  let boardList;
  if (relBoardDir) {
    boardList = await getBoardlistWest(setupState, vscode.Uri.file(path.join(rootPath, relBoardDir)));
  } else {
    boardList = await getBoardlistWest(setupState, undefined);
  }

  if (!boardList) {
    return;
  }

  const boardQpItems: BoardItem[] = boardList.map(x => ({ revisions: x.revisions, revision_default: x.revision_default, label: x.name, description: x.subdir }));
  pickPromise = showQuickPick({
    title,
    step: 2,
    totalSteps: 3,
    placeholder: 'Pick Board',
    ignoreFocusOut: true,
    items: boardQpItems,
    activeItem: undefined
  }).catch((error) => {
    console.error(error);
    return undefined;
  });
  pick = (await pickPromise as QuickPickItem);
  if (!pick) {
    return;
  };

  let pick_data = (pick as BoardItem);

  let relBoardSubDir: string = "";
  if (pick_data.description) {
    if (relBoardDir) {
      relBoardSubDir = path.relative(path.join(rootPath, relBoardDir), pick_data.description);
    } else {
      relBoardSubDir = path.relative(path.join(setupState.zephyrDir, "boards"), pick_data.description);
    }
  }


  let board = pick_data.label;
  let revision: string | undefined;
  if (pick_data.revisions) {
    let revisionQPItems: QuickPickItem[] = [];
    let revisionIndex = 0;
    for (let revision of pick_data.revisions) {
      let description = "";
      if (revision === pick_data.revision_default) {
        revisionIndex = revisionQPItems.length;
        description = "default";
      }
      revisionQPItems.push({ label: revision, description: description });
    }

    let pickPromise = showQuickPick({
      title,
      step: 3,
      totalSteps: 3,
      placeholder: 'Pick Revision',
      ignoreFocusOut: true,
      items: revisionQPItems,
      activeItem: revisionQPItems[revisionIndex]
    }).catch((error) => {
      console.error(error);
      return undefined;
    });
    let pick = (await pickPromise as QuickPickItem);
    if (!pick) {
      return;
    };
    revision = pick.label;
  }



  let boardConfig = {
    board: board,
    relBoardDir: relBoardDir,
    relBoardSubDir: relBoardSubDir,
    revision: revision,
  };
  return boardConfig;
}

export async function buildSelector(context: ExtensionContext, setupState: SetupState, rootPath: string) {
  const title = 'Add Build Configuration';

  async function pickBoardStep(input: MultiStepInput, state: Partial<BuildConfig>) {
    let boardData = await pickBoard(setupState, rootPath);
    if (boardData) {
      state.relBoardDir = boardData.relBoardDir;
      state.relBoardSubDir = boardData.relBoardSubDir;
      state.board = boardData.board;
      state.revision = boardData.revision;
    } else {
      return;
    }

    return (input: MultiStepInput) => inputBuildName(input, state);
  }

  async function inputBuildName(input: MultiStepInput, state: Partial<BuildConfig>) {
    if (state.board === undefined) {
      return;
    }

    const inputPromise = input.showInputBox({
      title,
      step: 4,
      totalSteps: 7,
      ignoreFocusOut: true,
      value: path.join("build", state.board + (state.revision ? "_" + state.revision : "")),
      prompt: 'Choose a name for the Build',
      validate: validate
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
      step: 5,
      totalSteps: 7,
      placeholder: 'Select Build Optimization',
      ignoreFocusOut: true,
      items: buildOptimizationsQpItems,
      activeItem: typeof state.debugOptimization !== 'string' ? state.debugOptimization : undefined
    }).catch((error) => {
      console.error(error);
      return undefined;
    });
    let pick = await pickPromise;
    if (!pick) {
      return;
    };
    let debugOptimization = pick.label;

    const westArgsInputPromise = input.showInputBox({
      title,
      step: 6,
      totalSteps: 7,
      ignoreFocusOut: true,
      value: "",
      prompt: 'Additional Build Arguments',
      placeholder: '--sysbuild',
      validate: validate
    }).catch((error) => {
      console.error(error);
      return undefined;
    });
    let westBuildArgs = await westArgsInputPromise;
    if (westBuildArgs === undefined) {
      return;
    };

    state.westBuildArgs = westBuildArgs;

    let cmakeArg = "";
    switch (debugOptimization) {
      case "Debug":
        cmakeArg = ` -DCONFIG_DEBUG_OPTIMIZATIONS=y -DCONFIG_DEBUG_THREAD_INFO=y `;
        break;
      case "Speed":
        cmakeArg = ` -DCONFIG_SPEED_OPTIMIZATIONS=y `;
        break;
      case "Size":
        cmakeArg = ` -DCONFIG_SIZE_OPTIMIZATIONS=y `;
        break;
      case "No Optimizations":
        cmakeArg = ` -DCONFIG_NO_OPTIMIZATIONS=y`;
        break;
      default:
        break;
    }

    const cmakeArgsInputPromise = input.showInputBox({
      title,
      step: 7,
      totalSteps: 7,
      ignoreFocusOut: true,
      value: cmakeArg,
      prompt: 'Modify CMake Arguments',
      validate: validate
    }).catch((error) => {
      console.error(error);
      return undefined;
    });
    let cmakeBuildArgs = await cmakeArgsInputPromise;
    if (cmakeBuildArgs === undefined) {
      return;
    };

    state.westBuildCMakeArgs = cmakeBuildArgs;


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

  async function collectInputs() {
    const state = {} as Partial<BuildConfig>;
    await MultiStepInput.run(input => pickBoardStep(input, state));
    return state as BuildConfig;
  }

  const state = await collectInputs();
  return state;
}

