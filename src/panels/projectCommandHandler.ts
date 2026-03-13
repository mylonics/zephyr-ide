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
  const updateCmd = () => {
    if (updateWebView) {
      vscode.commands.executeCommand("zephyr-ide.update-web-view");
    }
  };

  switch (command) {
    case "deleteProject": {
      removeProject(context, wsConfig, value.project).finally(updateCmd);
      return true;
    }
    case "addBuild": {
      addBuildToProject(wsConfig, context, value.project).finally(() => {
        setActive(wsConfig, value.project);
        updateCmd();
      });
      return true;
    }
    case "deleteBuild": {
      removeBuild(context, wsConfig, value.project, value.build).finally(() => {
        setActive(wsConfig, value.project);
        updateCmd();
      });
      return true;
    }
    case "addRunner": {
      addRunnerToBuild(wsConfig, context, value.project, value.build).finally(() => {
        setActive(wsConfig, value.project, value.build);
        updateCmd();
      });
      return true;
    }
    case "deleteRunner": {
      removeRunner(context, wsConfig, value.project, value.build, value.runner).finally(() => {
        setActive(wsConfig, value.project, value.build);
        updateCmd();
      });
      return true;
    }
    case "build": {
      buildByName(context, wsConfig, false, value.project, value.build);
      setActive(wsConfig, value.project, value.build);
      return true;
    }
    case "buildPristine": {
      buildByName(context, wsConfig, true, value.project, value.build);
      setActive(wsConfig, value.project, value.build);
      return true;
    }
    case "menuConfig": {
      buildByName(context, wsConfig, true, value.project, value.build, MenuConfig.MenuConfig);
      setActive(wsConfig, value.project, value.build);
      return true;
    }
    case "guiConfig": {
      buildByName(context, wsConfig, true, value.project, value.build, MenuConfig.GuiConfig);
      setActive(wsConfig, value.project, value.build);
      return true;
    }
    case "flash": {
      flashByName(context, wsConfig, value.project, value.build, value.runner);
      setActive(wsConfig, value.project, value.build, value.runner);
      return true;
    }
    case "setActive": {
      setActive(wsConfig, value.project, value.build, value.runner, value.test);
      return true;
    }
    default:
      return false;
  }
}
