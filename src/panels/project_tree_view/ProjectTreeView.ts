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
import path from 'path';
import { ProjectConfig, addBuildToProject, addRunnerToBuild, addTest, removeTest, removeBuild, removeProject, removeRunner, setActive } from '../../project_utilities/project';
import { BuildConfig } from '../../project_utilities/build_selector';
import { getNonce } from "../../utilities/getNonce";
import { RunnerConfig } from '../../project_utilities/runner_selector';
import { buildByName, MenuConfig } from '../../zephyr_utilities/build';
import { testHelper } from '../../zephyr_utilities/twister';
import { flashByName } from '../../zephyr_utilities/flash';
import { WorkspaceConfig } from '../../setup_utilities/types';
import { TwisterConfig } from '../../project_utilities/twister_selector';

export function getUseGuiConfig(): boolean | undefined {
  const configuration = vscode.workspace.getConfiguration();
  return configuration.get("zephyr-ide.use_gui_config");
}

export class ProjectTreeView implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private needToClearHtml: boolean = false;
  private treeData: any = [];
  path_icons = {
    branch: 'folder-library',
    leaf: 'folder-library',
    open: 'folder-library',
  };
  projectActions = [
    {
      icon: "add",
      actionId: "addBuild",
      tooltip: "Add Build",
    },
    {
      icon: "beaker",
      actionId: "addTest",
      tooltip: "Add Test",
    },
    {
      icon: "trash",
      actionId: "deleteProject",
      tooltip: "Delete Project",
    },
  ];

  generateBuildActions() {
    let buildConfigMenu = {
      icon: "settings-gear",
      actionId: "menuConfig",
      tooltip: "Menu Config",
    };

    if (getUseGuiConfig()) {
      buildConfigMenu = {
        icon: "preview",
        actionId: "guiConfig",
        tooltip: "Gui Config",
      };
    }
    let buildActions = [
      {
        icon: "play",
        actionId: "build",
        tooltip: "Build",
      }, {
        icon: "debug-rerun",
        actionId: "buildPristine",
        tooltip: "Build Pristine",
      }, buildConfigMenu,
      {
        icon: "add",
        actionId: "addRunner",
        tooltip: "Add Runner",
      }, {
        icon: "trash",
        actionId: "deleteBuild",
        tooltip: "Delete Build",
      },
    ];

    return buildActions;
  }

  testActions = [
    {
      icon: "play",
      actionId: "test",
      tooltip: "Test",
    }, {
      icon: "trash",
      actionId: "deleteTest",
      tooltip: "Delete Test",
    },
  ];
  fileActions = [{
    icon: "add",
    actionId: "addFile",
    tooltip: "Add File",
  }];
  fileItemActions = [{
    icon: "trash",
    actionId: "deleteFile",
    tooltip: "Delete File",
  }];
  runnerActions = [
    {
      icon: "arrow-circle-up",
      actionId: "flash",
      tooltip: "Flash",
    }, {
      icon: "trash",
      actionId: "deleteRunner",
      tooltip: "Delete Runner",
    },
  ];

  constructor(public extensionPath: string, private context: vscode.ExtensionContext, private wsConfig: WorkspaceConfig) {
  }

  generateRunnerString(projectName: string, buildName: string, runner: RunnerConfig): any {
    if (this.wsConfig.projectStates[projectName].buildStates[buildName].runnerStates[runner.name] === undefined) {
      this.wsConfig.projectStates[projectName].buildStates[buildName].runnerStates[runner.name] = { viewOpen: true };
    }
    let viewOpen = this.wsConfig.projectStates[projectName].buildStates[buildName].runnerStates[runner.name].viewOpen;
    let entry = {
      icons: {
        branch: 'chip',
        leaf: 'chip',
        open: 'chip',
      },
      actions: this.runnerActions,
      label: runner.name,
      value: { project: projectName, build: buildName, runner: runner.name },
      open: viewOpen !== undefined ? viewOpen : true,
      subItems: []
    };

    return entry;
  }

  generateBuildString(projectName: string, build: BuildConfig): any {
    let viewOpen = this.wsConfig.projectStates[projectName].buildStates[build.name].viewOpen;
    let buildData: any = {};
    buildData['icons'] = {
      branch: 'project',
      leaf: 'project',
      open: 'project',
    };
    buildData['actions'] = this.generateBuildActions();
    buildData['label'] = build.name;
    buildData['value'] = { project: projectName, build: build.name };
    buildData['open'] = viewOpen !== undefined ? viewOpen : true;
    buildData['description'] = build.board + (build.revision ? '@' + build.revision : "");
    buildData['subItems'] = [];

    let runnerNames = [];

    //Add runners
    for (let key in build.runnerConfigs) {
      runnerNames.push(key);
      buildData.subItems.push(this.generateRunnerString(projectName, build.name, build.runnerConfigs[key]));
    }

    // If no runners then add Add Runner command
    if (buildData.subItems.length === 0) {
      buildData.subItems.push({
        icons: {
          branch: 'add',
          leaf: 'add',
          open: 'add',
        },
        label: 'Add Runner',
        value: { cmd: "addRunner", project: projectName, build: build.name },
        description: 'Add Runner',
      });
    }

    return buildData;
  }


  generateTestString(projectName: string, test: TwisterConfig): any {
    let viewOpen = this.wsConfig.projectStates[projectName].twisterStates[test.name].viewOpen;
    let buildData: any = {};
    buildData['icons'] = {
      branch: 'beaker',
      leaf: 'beaker',
      open: 'beaker',
    };
    buildData['actions'] = this.testActions;
    buildData['label'] = test.name;
    buildData['value'] = { project: projectName, test: test.name };
    buildData['open'] = viewOpen !== undefined ? viewOpen : true;
    buildData['description'] = test.platform;
    buildData['subItems'] = [];

    return buildData;
  }


  generateProjectString(project: ProjectConfig): any {
    let viewOpen = this.wsConfig.projectStates[project.name].viewOpen;

    let projectData: any = {};
    projectData['icons'] = {
      branch: 'folder',
      leaf: 'folder',
      open: 'folder-opened',
    };
    projectData['actions'] = this.projectActions;
    projectData['label'] = project.name;
    projectData['value'] = { project: project.name };
    projectData['subItems'] = [];
    projectData['open'] = viewOpen !== undefined ? viewOpen : true;
    // Mark the active project (selected for highlight)
    if (this.wsConfig.activeProject === project.name) {
      projectData['selected'] = true;
    }

    // Always render children so arrows are visible; interaction is restricted in the webview handler
    for (let key in project.buildConfigs) {
      projectData.subItems.push(this.generateBuildString(project.name, project.buildConfigs[key]));
    }

    for (let key in project.twisterConfigs) {
      projectData.subItems.push(this.generateTestString(project.name, project.twisterConfigs[key]));
    }

    if (projectData.subItems.length === 0) {
      projectData.subItems.push({
        icons: {
          branch: 'add',
          leaf: 'add',
          open: 'add',
        },
        label: 'Add Build',
        value: { cmd: "addBuild", project: project.name },
        description: 'Add Build',
      });
    }
    return projectData;
  }

  updateWebView(wsConfig: WorkspaceConfig) {
    if (Object.keys(wsConfig.projects).length === 0) {
      let bodyString = '<vscode-label side-aligned="end">No Projects Registered In Workspace</vscode-label>';
      this.setHtml(bodyString);
      this.needToClearHtml = true;
      return;
    } else if (this.needToClearHtml) {
      this.setHtml("");
    }

    let projectNames = [];
    this.treeData = [];

    for (let key in wsConfig.projects) {
      projectNames.push(key);
      this.treeData.push(this.generateProjectString(wsConfig.projects[key]));
    }
    if (this.view) {
      this.view.webview.postMessage(this.treeData);
    }
  }

  saveTreeDataOpenState() {
    try {
      this.treeData.forEach((element: any) => {
        if (element.label in this.wsConfig.projects) {
          // Persist open state for all projects so their state is restored when they become active
          this.wsConfig.projectStates[element.label].viewOpen = element.open;
          element.subItems.forEach((build_element: any) => {
            if (build_element.label in this.wsConfig.projects[element.label].buildConfigs) {
              this.wsConfig.projectStates[element.label].buildStates[build_element.label].viewOpen = build_element.open;
            }
          });
        }
      });
    }
    catch (e: any) {
      console.log(e.Message);
    }
  }

  setHtml(body: string) {
    if (this.view !== undefined) {
      const fileUri = (fp: string) => {
        const fragments = fp.split('/');

        return vscode.Uri.file(
          path.join(this.extensionPath, ...fragments)
        );
      };

      const assetUri = (fp: string) => {
        if (this.view) {
          return this.view.webview.asWebviewUri(fileUri(fp));
        }
      };

      const nonce = getNonce();

      this.view.webview.html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Document</title>
      <link rel="stylesheet" href="${assetUri('node_modules/@vscode/codicons/dist/codicon.css')}"  id="vscode-codicon-stylesheet">
      <link rel="stylesheet" href="${assetUri('src/panels/view.css')}">
      <script nonce="${nonce}" src="${assetUri('node_modules/@vscode-elements/elements/dist/bundled.js')}"  type="module"></script>
      <script nonce="${nonce}" src="${assetUri('src/panels/project_tree_view/ProjectTreeViewHandler.js')}"  type="module"></script>
    </head>
    <body>
  <vscode-tree id="project-tree" indent-guides arrows></vscode-tree>
    ${body}
    </body>
    </html>`;
    }
  };

  resolveWebviewView(webviewView: vscode.WebviewView, context: vscode.WebviewViewResolveContext, token: vscode.CancellationToken): void | Thenable<void> {
    webviewView.webview.options = {
      enableScripts: true,
      enableCommandUris: true,
    };

    this.view = webviewView;
    webviewView.webview.onDidReceiveMessage(message => {
      console.log(message);
      if (message.treeData) {
        this.treeData = message.treeData;
        this.saveTreeDataOpenState();
      }
      switch (message.command) {
        case "deleteProject": {
          removeProject(this.context, this.wsConfig, message.value.project).finally(() => { vscode.commands.executeCommand("zephyr-ide.update-web-view"); });
          break;
        }
        case "addBuild": {
          addBuildToProject(this.wsConfig, this.context, message.value.project).finally(() => { setActive(this.wsConfig, message.value.project); });
          break;
        }
        case "deleteBuild": {
          removeBuild(this.context, this.wsConfig, message.value.project, message.value.build).finally(() => { setActive(this.wsConfig, message.value.project); });
          break;
        }
        case "addTest": {
          addTest(this.wsConfig, this.context, message.value.project).finally(() => { setActive(this.wsConfig, message.value.project); });
          break;
        }
        case "deleteTest": {
          removeTest(this.context, this.wsConfig, message.value.project, message.value.test).finally(() => { setActive(this.wsConfig, message.value.project); });
          break;
        }
        case "addRunner": {
          addRunnerToBuild(this.wsConfig, this.context, message.value.project, message.value.build).finally(() => { setActive(this.wsConfig, message.value.project, message.value.build); });
          break;
        }
        case "deleteRunner": {
          removeRunner(this.context, this.wsConfig, message.value.project, message.value.build, message.value.runner).finally(() => { setActive(this.wsConfig, message.value.project, message.value.build); });
          break;
        }
        case "build": {
          buildByName(this.context, this.wsConfig, false, message.value.project, message.value.build);
          setActive(this.wsConfig, message.value.project, message.value.build);
          break;
        }
        case "buildPristine": {
          buildByName(this.context, this.wsConfig, true, message.value.project, message.value.build);
          setActive(this.wsConfig, message.value.project, message.value.build);
          break;
        }
        case "test": {
          testHelper(this.context, this.wsConfig, message.value.project, message.value.test);
          setActive(this.wsConfig, message.value.project, undefined, undefined, message.value.test);
          break;
        }
        case "menuConfig": {
          buildByName(this.context, this.wsConfig, true, message.value.project, message.value.build, MenuConfig.MenuConfig);
          setActive(this.wsConfig, message.value.project, message.value.build, undefined, undefined);
          break;
        }
        case "guiConfig": {
          buildByName(this.context, this.wsConfig, true, message.value.project, message.value.build, MenuConfig.GuiConfig);
          setActive(this.wsConfig, message.value.project, message.value.build, undefined, undefined);
          break;
        }
        case "flash": {
          flashByName(this.context, this.wsConfig, message.value.project, message.value.build, message.value.runner);
          setActive(this.wsConfig, message.value.project, message.value.build, message.value.runner);
          break;
        }
        case "setActive": {
          setActive(this.wsConfig, message.value.project, message.value.build, message.value.runner, message.value.test);
          break;
        }
        default:
          console.log("unknown command");
          console.log(message);
      }
    });
    this.setHtml("");
  }
}

