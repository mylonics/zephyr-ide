/*
Copyright 2025-2026 mylonics 
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

import * as vscode from "vscode";
import * as path from 'upath';

import { executeTaskHelperInPythonEnv } from "../utilities/utils";
import { notifyError, outputInfo } from "../utilities/output";

import { WorkspaceConfig, SetupState } from '../setup_utilities/types';
import { addTest, ProjectConfig, getResolvedTestName, resolveActiveProject, getProjectFolder, resolveBoardRootArg } from "../project_utilities/project";
import { TwisterConfig } from "../project_utilities/twister_selector";
import { BoardConfig } from "../project_utilities/build_selector";
import { getSetupState } from "../setup_utilities/workspace-config";

import * as fs from "fs-extra";

export async function testHelper(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, projectName?: string, testName?: string) {
  const setupState = await getSetupState(context, wsConfig);
  if (!setupState) {
    return;
  }
  if (setupState.westUpdated) {
    const resolved = resolveActiveProject(wsConfig, { caller: "Twister Test", projectName });
    if (!resolved) { return; }
    const project = resolved.project;

    if (testName === undefined) {
      testName = getResolvedTestName(wsConfig, resolved);
    }

    if (testName === undefined) {
      await addTest(wsConfig, context);
      testName = getResolvedTestName(wsConfig, resolved);
      if (testName === undefined) {
        notifyError("Twister Test", `You must choose a Test Configuration to continue.`);
        return;
      }
    }
    return await runTest(setupState, wsConfig, project, project.twisterConfigs[testName]);
  } else {
    notifyError("Twister Test", "Run `Zephyr IDE: West Update` command first.");
  }
}

/**
 * Pure function: build the `-p` board spec string for `west twister`.
 * Inserts `@revision` after the base board name and before any qualifier slashes,
 * matching the format used by `assembleBuildCommand` for `west build`.
 */
export function assembleTwisterBoardSpec(board: string, revision: string | undefined): string {
  if (!revision) { return board; }
  const slashIdx = board.indexOf('/');
  if (slashIdx !== -1) {
    return board.slice(0, slashIdx) + '@' + revision + board.slice(slashIdx);
  }
  return board + '@' + revision;
}

/** Input parameters for pure twister-command assembly. */
export interface TwisterCommandParams {
  projectFolder: string;
  tests: string[];
  args: string;
  platform: string;
  boardConfig?: BoardConfig;
  serialPort?: string;
  serialBaud?: string;
  /** Pre-resolved BOARD_ROOT cmake def (e.g. via resolveBoardRootArg), or "" when not applicable. */
  boardRootArg: string;
}

/**
 * Pure function: assemble a `west twister` command string from resolved parameters.
 * Extracted from runTest to enable unit testing without VS Code or filesystem dependencies.
 */
export function assembleTwisterCommand(params: TwisterCommandParams): string {
  let testString = `-T "${params.projectFolder}" `;
  if (params.tests.length > 0 && params.tests[0] !== "All") {
    for (const test of params.tests) {
      testString += "-s " + test + " ";
    }
  }

  testString += `--outdir "${path.join(params.projectFolder, "twister-out")}"  ${params.args ? params.args : ""}`;

  if (params.boardConfig) {
    const boardRootCmakeArg = params.boardRootArg ? `-- ${params.boardRootArg}` : "";
    const boardSpec = assembleTwisterBoardSpec(params.boardConfig.board, params.boardConfig.revision);
    return `west twister --device-testing  ${params.serialPort ? "--device-serial " + params.serialPort : ""} ${params.serialBaud ? "--device-serial-baud " + params.serialBaud : ""} -p ${boardSpec} ${testString} ${boardRootCmakeArg} `;
  } else {
    return `west twister -p ${params.platform} ${testString} `;
  }
}

export async function runTest(
  setupState: SetupState,
  wsConfig: WorkspaceConfig,
  project: ProjectConfig,
  testConfig: TwisterConfig
) {

  const projectFolder = getProjectFolder(wsConfig, project);

  const boardRootArg = testConfig.boardConfig ? resolveBoardRootArg(wsConfig, testConfig.boardConfig) : "";
  const cmd = assembleTwisterCommand({
    projectFolder,
    tests: testConfig.tests,
    args: testConfig.args,
    platform: testConfig.platform,
    boardConfig: testConfig.boardConfig,
    serialPort: testConfig.serialPort,
    serialBaud: testConfig.serialBaud,
    boardRootArg,
  });

  const taskName = "Zephyr IDE Test: " + project.name + " " + testConfig.name;

  outputInfo(`Twister: ${project.name}/${testConfig.name}`, `Running ${testConfig.name} Test from project: ${project.name} (cmd: ${cmd})`, true);
  const ret = await executeTaskHelperInPythonEnv(setupState, taskName, cmd, setupState.setupPath);
  return ret;
}

export async function deleteTestDirs(
  wsConfig: WorkspaceConfig,
  project: ProjectConfig
) {
  const projectDir = getProjectFolder(wsConfig, project);

  if (!await fs.pathExists(projectDir)) {
    return;
  }

  const files = await fs.readdir(projectDir);
  for (const file of files) {
    const match = file.match(/^twister-out($|[\-_])/);
    if (match !== null) {
      await fs.rm(path.join(projectDir, file), { recursive: true, force: true });
    }
  }

  void vscode.window.showInformationMessage(`Deleted ${project.name} test directories`);
}


