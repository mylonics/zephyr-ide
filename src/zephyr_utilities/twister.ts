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
import * as path from 'path';

import { executeTaskHelperInPythonEnv } from "../utilities/utils";

import { WorkspaceConfig } from '../setup_utilities/setup';
import { addTest, ProjectConfig, getActiveTestNameOfProject } from "../project_utilities/project";
import { TwisterConfig } from "../project_utilities/twister_selector";

import * as fs from "fs-extra";

export async function testHelper(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, projectName?: string, testName?: string) {
  if (wsConfig.activeSetupState === undefined) {
    return;
  }
  if (wsConfig.activeSetupState.westUpdated) {
    if (projectName === undefined) {
      projectName = wsConfig.activeProject;
    }
    if (projectName === undefined) {
      vscode.window.showErrorMessage("Select a project before trying to run test");
      return;
    }
    let project = wsConfig.projects[projectName];

    if (testName === undefined) {
      testName = getActiveTestNameOfProject(wsConfig, project.name);
    }

    if (testName === undefined) {
      await addTest(wsConfig, context);
      testName = getActiveTestNameOfProject(wsConfig, project.name);
      if (testName === undefined) {
        await vscode.window.showErrorMessage(`You must choose a Test Configuration to continue.`);
        return;
      }
    }
    return await runTest(wsConfig, project, project.twisterConfigs[testName]);
  } else {
    vscode.window.showErrorMessage("Run `Zephyr IDE: West Update` command first.");
  }
}

export async function runTest(
  wsConfig: WorkspaceConfig,
  project: ProjectConfig,
  testConfig: TwisterConfig
) {

  let projectFolder = path.join(wsConfig.rootPath, project.rel_path);

  let cmd: string;


  let testString = `-T ${projectFolder} `;
  if (testConfig.tests[0] !== "All") {
    testString += "-s ";
    for (let test of testConfig.tests) {
      testString += test + " ";
    }
  }

  testString += `--outdir ${path.join(projectFolder, "twister-out")}  ${testConfig.args ? testConfig.args : ""}`;

  if (testConfig.boardConfig) {
    let boardRoot;

    if (testConfig.boardConfig.relBoardDir) {
      boardRoot = path.dirname(path.join(wsConfig.rootPath, testConfig.boardConfig.relBoardDir));
    } else if (wsConfig.activeSetupState) {
      boardRoot = wsConfig.activeSetupState?.zephyrDir;
    }

    cmd = `west twister --device-testing  ${testConfig.serialPort ? "--device-serial " + testConfig.serialPort : ""} ${testConfig.serialBaud ? "--device-serial-baud " + testConfig.serialBaud : ""} -p ${testConfig.boardConfig.board} ${testString} -- -DBOARD_ROOT='${boardRoot}' `;
  } else {
    cmd = `west twister -p ${testConfig.platform} ${testString} `;
  }


  let taskName = "Zephyr IDE Test: " + project.name + " " + testConfig.name;

  vscode.window.showInformationMessage(`Running ${testConfig.name} Test from project: ${project.name}`);
  let ret = await executeTaskHelperInPythonEnv(wsConfig.activeSetupState, taskName, cmd, wsConfig.activeSetupState?.setupPath);
  return ret;
}

export async function deleteTestDirs(
  wsConfig: WorkspaceConfig,
  project: ProjectConfig
) {
  let projectDir = path.join(wsConfig.rootPath, project.rel_path);

  fs.readdir(projectDir, (err, files) => {
    for (var i = 0, len = files.length; i < len; i++) {
      var match = files[i].match(/twister.*/);
      if (match !== null) {
        fs.rmSync(path.join(projectDir, match[0]), { recursive: true, force: true });
      }
    }
  });

  vscode.window.showInformationMessage(`Deleted ${project.name} test directories`);
}


