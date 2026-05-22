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
import { MultiStepInput, InputStep, noOpValidate, mapToQuickPickItems } from "../utilities/multistepQuickPick";
import { ConfigFiles } from './config_selector';
import { SetupState } from '../setup_utilities/types';
import { executeShellCommandInPythonEnv, output } from "../utilities/utils";
import { notifyError, outputCommandFailure, outputWarning, outputError } from "../utilities/output";
import { isVersionNumberGreaterEqual } from '../setup_utilities/modules';
import { splitBuildArgs } from "./build_args";


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
  rel_path?: string;
  board: string;
  relBoardDir: string;
  relBoardSubDir: string;
  debugOptimization: string;
  westBuildArgs: string[];
  westBuildCMakeArgs: string[];
  /** Name of the `RunnerProfile` this build uses (resolved via loadRunnerProfiles()).
   *  Undefined / unknown profile name → behave as the implicit "Auto" profile
   *  (flash/debug/attach all map to `{kind:"auto"}`). */
  activeProfile?: string;
  /** User-defined key-value variables for this build configuration.
   *  Referenced in runner profile args as `${buildvar:key}` and in
   *  tasks.json/launch.json via the `zephyr-ide.get-active-build-variable` command. */
  customVars?: Record<string, string>;
  confFiles: ConfigFiles;
  revision?: string;
}

// Config for the extension
export interface BuildState {
  viewOpen?: boolean;
  gdbPath?: string; // Cached GDB path from CMakeCache.txt (CMAKE_GDB)
  elfName?: string; // Cached kernel ELF name from CMakeCache.txt (BYPRODUCT_KERNEL_ELF_NAME)
  toolchainPath?: string; // Cached toolchain path from build_info.yml (toolchain.path)
  cachedPristineCmd?: string; // Pristine build command from last build, used to detect config changes
  /** Active sysbuild domain/image (e.g. "mcuboot") for flash and debug. Only relevant for sysbuild projects. */
  sysbuildImage?: string;
}

export interface BoardItem extends QuickPickItem {
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

  if (setupState.zephyrVersion === undefined) {
    return;
  }
  let res;
  let has_qualifiers = false;
  let has_revisions = false;

  if (isVersionNumberGreaterEqual(setupState.zephyrVersion, 4, 1, 0)) {
    res = await executeShellCommandInPythonEnv('west boards -f "{name};{dir};{qualifiers};{revisions};{revision_default}" ' + boardRootString, setupState.setupPath, setupState, false);
    has_qualifiers = true;
    has_revisions = true;
  } else if (isVersionNumberGreaterEqual(setupState.zephyrVersion, 3, 7, 0)) {
    res = await executeShellCommandInPythonEnv('west boards -f "{name};{dir};{qualifiers}" ' + boardRootString, setupState.setupPath, setupState, false);
    has_qualifiers = true;
  } else {
    res = await executeShellCommandInPythonEnv('west boards -f "{name};{dir}" ' + boardRootString, setupState.setupPath, setupState, false);
  }

  if (!res.stdout || res.stdout === "") {
    outputCommandFailure("Board Selection", res);
    notifyError("Board Selection", "Failed to run west boards command. Check the Zephyr IDE output for details.");
    return;
  }

  const outputData = parseBoardListOutput(res.stdout, has_qualifiers, has_revisions);
  return outputData;
}

export type BoardListEntry = { name: string, subdir: string, revisions?: string[], revision_default?: string };

/**
 * Pure function: parse the stdout of `west boards -f "{name};{dir};..."` into a
 * list of board entries, expanding multi-qualifier boards into separate entries and
 * embedding single non-empty qualifiers directly into the board name.
 */
export function parseBoardListOutput(
  stdout: string,
  has_qualifiers: boolean,
  has_revisions: boolean,
): BoardListEntry[] {
  const allBoardData = stdout.split(/\r?\n/);
  const outputData: BoardListEntry[] = [];
  for (let i = 0; i < allBoardData.length; i++) {
    const boardData = allBoardData[i].replaceAll("'", "").split(";");
    if (boardData.length <= 1) { continue; }

    let qualifiers: string[] = [];
    if (has_qualifiers && boardData.length >= 3) {
      qualifiers = boardData[2].split(",");
    }

    let revisions: string[] | undefined;
    let revision_default: string | undefined;

    if (has_revisions && boardData.length >= 4) {
      if (boardData[3] !== "None") {
        revisions = boardData[3].split(/[\s,]+/).filter(r => r.length > 0);
        revision_default = boardData.length >= 5 ? boardData[4] : undefined;
      }
    }

    if (qualifiers.length > 1) {
      for (let j = 0; j < qualifiers.length; j++) {
        outputData.push({ name: boardData[0] + "/" + qualifiers[j], subdir: boardData[1], revisions, revision_default });
      }
    } else if (qualifiers.length === 1 && qualifiers[0] !== "") {
      // Single non-empty qualifier: include it explicitly so the board string is unambiguous.
      outputData.push({ name: boardData[0] + "/" + qualifiers[0], subdir: boardData[1], revisions, revision_default });
    } else {
      outputData.push({ name: boardData[0], subdir: boardData[1], revisions, revision_default });
    }
  }
  return outputData;
}

/** Shared error handler for QuickPick/InputBox promises in the build selector. */
function handleSelectorError(error: unknown): undefined {
  outputError("Build Selector", String(error));
  return undefined;
}

export interface PickBoardState {
  boardConfig?: BoardConfig;
  // Working values accumulated across the 3 sub-steps. Kept on the state so
  // a Back navigation back into a previous step can reuse what was selected.
  relBoardDir?: string;
  boardList?: { name: string, subdir: string, revisions?: string[], revision_default?: string }[];
  pickedBoard?: BoardItem;
}

/**
 * Build the chain of InputSteps that drive the board picker (board dir →
 * board → revision). The chain runs as part of an enclosing
 * `MultiStepInput.run`, which lets Back navigate within the picker as well
 * as to/from any wrapping wizard steps.
 *
 * @param next  Step to continue with after the revision step accepts. When
 *              omitted the chain ends and `MultiStepInput.run` returns.
 */
export function pickBoardSteps(
  setupState: SetupState,
  rootPath: string,
  state: PickBoardState,
  options: { startStep: number; totalSteps: number; next?: InputStep }
): InputStep {
  const title = "Board Picker";
  const { startStep, totalSteps, next } = options;

  // Build the list of candidate board directories once; it doesn't depend on
  // any user input.
  const boardDirectories: string[] = [];
  const boardDir = path.join(rootPath, `boards`);
  if (fs.pathExistsSync(boardDir)) {
    boardDirectories.push(boardDir);
  }
  if (setupState.zephyrDir) {
    boardDirectories.push('Zephyr Directory Only');
  }
  boardDirectories.push("Select Other Folder");
  const boardDirectoriesQpItems: QuickPickItem[] = mapToQuickPickItems(boardDirectories);

  async function pickBoardDir(input: MultiStepInput): Promise<InputStep | void> {
    const pick = await input.showQuickPick({
      title,
      step: startStep,
      totalSteps,
      placeholder: 'Pick Additional Board Directory',
      ignoreFocusOut: true,
      items: boardDirectoriesQpItems,
      activeItem: undefined,
    });

    let relBoardDir: string | undefined = path.relative(rootPath, pick.label);
    if (pick.label === "Select Other Folder") {
      const boarddir = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
      });
      if (boarddir) {
        relBoardDir = path.relative(rootPath, boarddir[0].fsPath);
      } else {
        void vscode.window.showInformationMessage(`Failed to select board directory`);
        return;
      }
    } else if (pick.label === 'Zephyr Directory Only') {
      relBoardDir = undefined;
    }

    state.relBoardDir = relBoardDir;

    const boardList = relBoardDir
      ? await getBoardlistWest(setupState, vscode.Uri.file(path.join(rootPath, relBoardDir)))
      : await getBoardlistWest(setupState, undefined);

    if (!boardList) {
      return;
    }
    state.boardList = boardList;

    return (input: MultiStepInput) => pickBoardName(input);
  }

  async function pickBoardName(input: MultiStepInput): Promise<InputStep | void> {
    const boardList = state.boardList ?? [];
    const boardQpItems: BoardItem[] = boardList.map(x => ({
      revisions: x.revisions,
      revision_default: x.revision_default,
      label: x.name,
      description: x.subdir,
    }));

    const pick = await input.showQuickPick({
      title,
      step: startStep + 1,
      totalSteps,
      placeholder: 'Pick Board',
      ignoreFocusOut: true,
      items: boardQpItems,
      activeItem: undefined,
    });

    state.pickedBoard = pick as BoardItem;

    // If the picked board has no revisions, we can finish here without
    // showing the revision step.
    if (!state.pickedBoard.revisions) {
      finalizeBoardConfig(state, rootPath, setupState, undefined);
      return next;
    }

    return (input: MultiStepInput) => pickRevision(input);
  }

  async function pickRevision(input: MultiStepInput): Promise<InputStep | void> {
    const picked = state.pickedBoard;
    if (!picked || !picked.revisions) {
      return;
    }

    const revisionQPItems: QuickPickItem[] = [];
    let revisionIndex = 0;
    for (const revision of picked.revisions) {
      let description = "";
      if (revision === picked.revision_default) {
        revisionIndex = revisionQPItems.length;
        description = "default";
      }
      revisionQPItems.push({ label: revision, description });
    }

    const revPick = await input.showQuickPick({
      title,
      step: startStep + 2,
      totalSteps,
      placeholder: 'Pick Revision',
      ignoreFocusOut: true,
      items: revisionQPItems,
      activeItem: revisionQPItems[revisionIndex],
    });

    finalizeBoardConfig(state, rootPath, setupState, revPick.label);
    return next;
  }

  return pickBoardDir;
}

function finalizeBoardConfig(
  state: PickBoardState,
  rootPath: string,
  setupState: SetupState,
  revision: string | undefined,
): void {
  const picked = state.pickedBoard;
  if (!picked) {
    return;
  }
  let relBoardSubDir = "";
  if (picked.description) {
    if (state.relBoardDir) {
      relBoardSubDir = path.relative(path.join(rootPath, state.relBoardDir), picked.description);
    } else {
      relBoardSubDir = path.relative(path.join(setupState.zephyrDir, "boards"), picked.description);
    }
  }
  state.boardConfig = {
    board: picked.label,
    relBoardDir: state.relBoardDir,
    relBoardSubDir,
    revision,
  };
}

/**
 * Pick a board interactively. Runs as a 3-step wizard
 * (board dir → board → revision) so the Back button navigates between
 * sub-steps. Returns `undefined` if the user cancels.
 */
export async function pickBoard(setupState: SetupState, rootPath: string): Promise<BoardConfig | undefined> {
  const state: PickBoardState = {};
  try {
    await MultiStepInput.run(pickBoardSteps(setupState, rootPath, state, { startStep: 1, totalSteps: 3 }));
  } catch (error) {
    handleSelectorError(error);
    return undefined;
  }
  return state.boardConfig;
}

export async function buildSelector(context: ExtensionContext, setupState: SetupState, rootPath: string) {
  const title = 'Add Build Configuration';
  const TOTAL_STEPS = 7;

  const state: Partial<BuildConfig> & { completed?: boolean } = {};
  const boardState: PickBoardState = {};

  async function inputBuildName(input: MultiStepInput): Promise<InputStep | void> {
    const boardConfig = boardState.boardConfig;
    if (!boardConfig) {
      return;
    }
    state.relBoardDir = boardConfig.relBoardDir;
    state.relBoardSubDir = boardConfig.relBoardSubDir;
    state.board = boardConfig.board;
    state.revision = boardConfig.revision;

    const name = await input.showInputBox({
      title,
      step: 4,
      totalSteps: TOTAL_STEPS,
      ignoreFocusOut: true,
      value: path.join("build", state.board + (state.revision ? "_" + state.revision : "")),
      prompt: 'Enter build configuration name',
      validate: noOpValidate,
    });
    if (!name) {
      return;
    }
    state.name = name;
    return (input: MultiStepInput) => setBuildOptimization(input);
  }

  async function setBuildOptimization(input: MultiStepInput): Promise<InputStep | void> {
    const buildOptimizations = ["Debug", "Speed", "Size", "No Optimizations", "Don't set. Will be configured in included KConfig file"];
    const buildOptimizationsQpItems: QuickPickItem[] = mapToQuickPickItems(buildOptimizations);

    const pick = await input.showQuickPick({
      title,
      step: 5,
      totalSteps: TOTAL_STEPS,
      placeholder: 'Select Build Optimization',
      ignoreFocusOut: true,
      items: buildOptimizationsQpItems,
      activeItem: typeof state.debugOptimization !== 'string' ? state.debugOptimization : undefined,
    });
    state.debugOptimization = pick.label;
    return (input: MultiStepInput) => inputWestArgs(input);
  }

  async function inputWestArgs(input: MultiStepInput): Promise<InputStep | void> {
    const westBuildArgs = await input.showInputBox({
      title,
      step: 6,
      totalSteps: TOTAL_STEPS,
      ignoreFocusOut: true,
      value: "",
      prompt: 'Additional Build Arguments',
      placeholder: '--sysbuild',
      validate: noOpValidate,
    });
    if (westBuildArgs === undefined) {
      return;
    }
    state.westBuildArgs = splitBuildArgs(westBuildArgs);
    return (input: MultiStepInput) => inputCMakeArgs(input);
  }

  async function inputCMakeArgs(input: MultiStepInput): Promise<InputStep | void> {
    let cmakeArg = "";
    switch (state.debugOptimization) {
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

    const cmakeBuildArgs = await input.showInputBox({
      title,
      step: 7,
      totalSteps: TOTAL_STEPS,
      ignoreFocusOut: true,
      value: cmakeArg,
      prompt: 'Modify CMake Arguments',
      validate: noOpValidate,
    });
    if (cmakeBuildArgs === undefined) {
      return;
    }
    state.westBuildCMakeArgs = splitBuildArgs(cmakeBuildArgs);

    state.confFiles = {
      config: [],
      overlay: [],
    };

    state.completed = true;
    return;
  }

  // Compose the board picker (3 sub-steps) with the rest of the wizard so a
  // single MultiStepInput.run drives all 7 steps. Back navigation works
  // across the entire chain because every prompt is its own InputStep.
  const startStep = pickBoardSteps(setupState, rootPath, boardState, {
    startStep: 1,
    totalSteps: TOTAL_STEPS,
    next: inputBuildName,
  });

  try {
    await MultiStepInput.run(startStep);
  } catch (error) {
    handleSelectorError(error);
    return undefined;
  }

  if (!state.completed || !state.name || !boardState.boardConfig) {
    return undefined;
  }
  return state as BuildConfig;
}
