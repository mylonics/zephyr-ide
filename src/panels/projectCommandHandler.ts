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

import * as vscode from 'vscode';
import { addBuildToProject, addRunnerToBuild, removeBuild, removeProject, removeRunner, setActive } from '../project_utilities/project';
import { buildByName, MenuConfig } from '../zephyr_utilities/build';
import { flashByName } from '../zephyr_utilities/flash';
import { WorkspaceConfig } from '../setup_utilities/types';
import { outputError, outputWarning } from '../utilities/output';

/** Shared action button for adding a file (used by ProjectTreeView and ProjectConfigView). */
export const FILE_ADD_ACTION = [{ icon: "add", actionId: "addFile", tooltip: "Add File" }];

/** Shared action button for deleting a file (used by ProjectTreeView and ProjectConfigView). */
export const FILE_DELETE_ACTION = [{ icon: "trash", actionId: "deleteFile", tooltip: "Delete File" }];

/** Set of currently running command keys to allow concurrent builds while preventing duplicate operations. */
const runningCommands = new Set<string>();

/**
 * Handle common project command messages shared between ProjectTreeView and ProjectConfigView.
 * Returns true if the command was handled, false otherwise (allowing the caller to handle view-specific commands).
 * 
 * @param updateWebView - whether to call `zephyr-ide.update-web-view` after mutating operations
 */
export function handleSharedProjectCommand(
  context: vscode.ExtensionContext,
  wsConfig: WorkspaceConfig,
  command: string,
  value: any,
  updateWebView: boolean
): boolean {
  // Validate that value is a non-null object before accessing properties
  if (!value || typeof value !== 'object') {
    if (command !== 'setActive') {
      outputError("Project Command", `Invalid message data for command: ${command}`);
    }
    return false;
  }

  const updateCmd = () => {
    if (updateWebView) {
      void vscode.commands.executeCommand("zephyr-ide.update-web-view");
    }
  };

  /** Run an async operation keyed by `key` to prevent duplicate execution of the same operation. */
  const runAsync = (label: string, key: string, fn: () => Promise<any>, afterFn?: () => void) => {
    if (runningCommands.has(key)) {
      outputWarning(label, `${label}: another command is already running, please wait.`);
      return;
    }
    runningCommands.add(key);
    void fn()
      .catch(err => outputError(label, `${label} failed: ${err}`))
      .finally(() => { runningCommands.delete(key); afterFn?.(); updateCmd(); });
  };

  /** Run a build-like async operation keyed by project/build: set active immediately, refresh webview on completion. */
  const runBuildAsync = (label: string, key: string, fn: () => Promise<any>, ...activeArgs: [string, string?, string?]) => {
    if (runningCommands.has(key)) {
      outputWarning(label, `${label}: another command is already running, please wait.`);
      return;
    }
    runningCommands.add(key);
    void setActive(context, wsConfig, ...activeArgs);
    void fn()
      .catch(err => outputError(label, `${label} failed: ${err}`))
      .finally(() => { runningCommands.delete(key); updateCmd(); });
  };

  switch (command) {
    case "deleteProject": {
      runAsync("Delete Project", `deleteProject/${value.project}`, () => removeProject(context, wsConfig, value.project));
      return true;
    }
    case "addBuild": {
      runAsync("Add Build", `addBuild/${value.project}`, () => addBuildToProject(wsConfig, context, value.project),
        () => void setActive(context, wsConfig, value.project));
      return true;
    }
    case "deleteBuild": {
      runAsync("Delete Build", `deleteBuild/${value.project}/${value.build}`, () => removeBuild(context, wsConfig, value.project, value.build),
        () => void setActive(context, wsConfig, value.project));
      return true;
    }
    case "addRunner": {
      runAsync("Add Runner", `addRunner/${value.project}/${value.build}`, () => addRunnerToBuild(wsConfig, context, value.project, value.build),
        () => void setActive(context, wsConfig, value.project, value.build));
      return true;
    }
    case "deleteRunner": {
      runAsync("Delete Runner", `deleteRunner/${value.project}/${value.build}/${value.runner}`, () => removeRunner(context, wsConfig, value.project, value.build, value.runner),
        () => void setActive(context, wsConfig, value.project, value.build));
      return true;
    }
    case "build": {
      runBuildAsync("Build", `build/${value.project}/${value.build}`, () => buildByName(context, wsConfig, false, value.project, value.build), value.project, value.build);
      return true;
    }
    case "buildPristine": {
      runBuildAsync("Build Pristine", `build/${value.project}/${value.build}`, () => buildByName(context, wsConfig, true, value.project, value.build), value.project, value.build);
      return true;
    }
    case "menuConfig": {
      runBuildAsync("Menu Config", `build/${value.project}/${value.build}`, () => buildByName(context, wsConfig, true, value.project, value.build, MenuConfig.MenuConfig), value.project, value.build);
      return true;
    }
    case "guiConfig": {
      runBuildAsync("GUI Config", `build/${value.project}/${value.build}`, () => buildByName(context, wsConfig, true, value.project, value.build, MenuConfig.GuiConfig), value.project, value.build);
      return true;
    }
    case "flash": {
      runBuildAsync("Flash", `flash/${value.project}/${value.build}/${value.runner}`, () => flashByName(context, wsConfig, value.project, value.build, value.runner), value.project, value.build, value.runner);
      return true;
    }
    case "setActive": {
      void setActive(context, wsConfig, value.project, value.build, value.runner, value.test);
      return true;
    }
    default:
      return false;
  }
}
