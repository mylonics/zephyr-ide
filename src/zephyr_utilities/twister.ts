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

import * as vscode from "vscode";
import * as path from 'upath';

import { executeTaskHelperInPythonEnv } from "../utilities/utils";
import { notifyError, outputInfo } from "../utilities/output";

import { WorkspaceConfig, SetupState } from '../setup_utilities/types';
import { addTest, ProjectConfig, getResolvedTestName, resolveActiveProject, getProjectFolder, resolveBoardRootArg } from "../project_utilities/project";
import { TwisterConfig } from "../project_utilities/twister_selector";
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
    notifyError("Twister Test", "Run `IDE for Zephyr: West Update` command first.");
  }
}

export async function runTest(
  setupState: SetupState,
  wsConfig: WorkspaceConfig,
  project: ProjectConfig,
  testConfig: TwisterConfig
) {

  const projectFolder = getProjectFolder(wsConfig, project);

  let cmd: string;


  let testString = `-T "${projectFolder}" `;
  if (testConfig.tests.length > 0 && testConfig.tests[0] !== "All") {
    for (const test of testConfig.tests) {
      testString += "-s " + test + " ";
    }
  }

  testString += `--outdir "${path.join(projectFolder, "twister-out")}"  ${testConfig.args ? testConfig.args : ""}`;

  if (testConfig.boardConfig) {
    const boardRootArg = resolveBoardRootArg(wsConfig, testConfig.boardConfig, setupState);
    const boardRootCmakeArg = boardRootArg ? `-- ${boardRootArg}` : "";
    cmd = `west twister --device-testing  ${testConfig.serialPort ? "--device-serial " + testConfig.serialPort : ""} ${testConfig.serialBaud ? "--device-serial-baud " + testConfig.serialBaud : ""} -p ${testConfig.boardConfig.board} ${testString} ${boardRootCmakeArg} `;
  } else {
    cmd = `west twister -p ${testConfig.platform} ${testString} `;
  }


  const taskName = "IDE for Zephyr Test: " + project.name + " " + testConfig.name;

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


