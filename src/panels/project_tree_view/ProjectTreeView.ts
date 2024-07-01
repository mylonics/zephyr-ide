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
import { ProjectConfig, addBuildToProject, addConfigFiles, addRunnerToBuild, removeBuild, removeProject, removeRunner, setActive, modifyBuildArguments, removeConfigFile } from '../../project_utilities/project';
import { BuildConfig } from '../../project_utilities/build_selector';
import { getNonce } from "../../utilities/getNonce";
import { RunnerConfig } from '../../project_utilities/runner_selector';
import { buildByName, buildMenuConfig } from '../../zephyr_utilities/build';
import { flashByName } from '../../zephyr_utilities/flash';
import { ConfigFiles } from '../../project_utilities/config_selector';

import { WorkspaceConfig } from '../../setup_utilities/setup';

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
    }, {
      icon: "trash",
      actionId: "deleteProject",
      tooltip: "Delete Project",
    },
  ];
  buildActions = [
    {
      icon: "play",
      actionId: "build",
      tooltip: "Build",
    }, {
      icon: "debug-rerun",
      actionId: "buildPristine",
      tooltip: "Build Pristine",
    }, {
      icon: "settings-gear",
      actionId: "menuConfig",
      tooltip: "Menu Config",
    }, {
      icon: "add",
      actionId: "addRunner",
      tooltip: "Add Runner",
    }, {
      icon: "trash",
      actionId: "deleteBuild",
      tooltip: "Delete Build",
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
    let entry = {
      icons: {
        branch: 'chip',
        leaf: 'chip',
        open: 'chip',
      },
      actions: this.runnerActions,
      label: runner.name,
      value: { project: projectName, build: buildName, runner: runner.name },
      open: true,
      subItems: []
    };

    return entry;
  }

  generateBuildString(buildData: any | undefined, projectName: string, build: BuildConfig): any {
    if (buildData === undefined) {
      buildData = {};
      buildData['icons'] = {
        branch: 'project',
        leaf: 'project',
        open: 'project',
      };
      buildData['actions'] = this.buildActions;
      buildData['label'] = build.name;
      buildData['value'] = { project: projectName, build: build.name };
      buildData['open'] = false;
      buildData['description'] = build.board;
      buildData['subItems'] = [];
    }

    const lengthOfSubItems = buildData.subItems.length;

    let runnerNames = [];

    //Add runners
    for (let key in build.runners) {
      runnerNames.push(key);
      let foundEntry = false;
      let index = 0;
      for (; index < lengthOfSubItems; index++) {
        if (buildData.subItems[index].label === key) {
          foundEntry = true;
          break;
        }
      }
      if (foundEntry) {
        this.generateRunnerString(projectName, build.name, build.runners[key]);
      } else {
        buildData.subItems.push(this.generateRunnerString(projectName, build.name, build.runners[key]));
      }
    }

    //Remove runners
    var i = buildData.subItems.length - 1;
    while (i >= 0) {
      if (!runnerNames.includes(buildData.subItems[i].label)) {
        buildData.subItems.splice(i, 1);
      }
      i--;
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
        description: 'Add Runner'
      });
    }

    return buildData;
  }


  generateProjectString(projectData: any | undefined, project: ProjectConfig): any {
    if (projectData === undefined) {
      projectData = {};
      projectData['icons'] = {
        branch: 'folder',
        leaf: 'file',
        open: 'folder-opened',
      };
      projectData['actions'] = this.projectActions;
      projectData['label'] = project.name;
      projectData['value'] = { project: project.name };
      projectData['subItems'] = [];
      projectData['open'] = false;
    }

    const lengthOfSubItems = projectData.subItems.length;

    let buildNames = [];

    for (let key in project.buildConfigs) {
      buildNames.push(key);
      let foundEntry = false;
      let index = 0
      for (; index < lengthOfSubItems; index++) {
        if (projectData.subItems[index].label === key) {
          foundEntry = true;
          break;
        }
      }
      if (foundEntry) {
        this.generateBuildString(projectData.subItems[index], project.name, project.buildConfigs[key]);
      } else {
        if (projectData.subItems.length === 1 && projectData.subItems[0].label === 'Add Build') {
          projectData.subItems[0] = this.generateBuildString(undefined, project.name, project.buildConfigs[key]);

        } else {
          projectData.subItems.push(this.generateBuildString(undefined, project.name, project.buildConfigs[key]));

        }
      }
    }

    var i = projectData.subItems.length - 1;
    while (i >= 3) {
      if (!buildNames.includes(projectData.subItems[i].label)) {
        projectData.subItems.splice(i, 1);
      }
      i--;
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

    for (let key in wsConfig.projects) {
      projectNames.push(key);
      let foundEntry = false;
      for (let index = 0; index < this.treeData.length; index++) {
        if (this.treeData[index].label === key) {
          this.generateProjectString(this.treeData[index], wsConfig.projects[key]);
          foundEntry = true;
          break;
        }
      }
      if (!foundEntry) {
        this.treeData.push(this.generateProjectString(undefined, wsConfig.projects[key]));
      }
    }

    var i = this.treeData.length;
    while (i--) {
      if (!projectNames.includes(this.treeData[i].label)) {
        this.treeData.splice(i, 1);
      }
    }

    if (this.view) {
      this.view.webview.postMessage(this.treeData);
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
      }
      switch (message.command) {
        case "deleteProject": {
          removeProject(this.context, this.wsConfig, message.value.project).finally(() => { vscode.commands.executeCommand("zephyr-ide.update-web-view"); });
          break;
        }
        case "addBuild": {
          addBuildToProject(this.wsConfig, this.context, message.value.project).finally(() => { setActive(this.wsConfig, message.value.project); vscode.commands.executeCommand("zephyr-ide.update-web-view"); });
          break;
        }
        case "deleteBuild": {
          removeBuild(this.context, this.wsConfig, message.value.project, message.value.build).finally(() => { setActive(this.wsConfig, message.value.project); vscode.commands.executeCommand("zephyr-ide.update-web-view"); });
          break;
        }
        case "addRunner": {
          addRunnerToBuild(this.wsConfig, this.context, message.value.project, message.value.build).finally(() => { setActive(this.wsConfig, message.value.project, message.value.build); vscode.commands.executeCommand("zephyr-ide.update-web-view"); });
          break;
        }
        case "deleteRunner": {
          removeRunner(this.context, this.wsConfig, message.value.project, message.value.build, message.value.runner).finally(() => { setActive(this.wsConfig, message.value.project, message.value.build); vscode.commands.executeCommand("zephyr-ide.update-web-view"); });
          break;
        }
        case "build": {
          buildByName(this.wsConfig, false, message.value.project, message.value.build);
          setActive(this.wsConfig, message.value.project, message.value.build);
          break;
        }
        case "buildPristine": {
          buildByName(this.wsConfig, true, message.value.project, message.value.build);
          setActive(this.wsConfig, message.value.project, message.value.build);
          break;
        }
        case "menuConfig": {
          buildByName(this.wsConfig, true, message.value.project, message.value.build, true);
          setActive(this.wsConfig, message.value.project, message.value.build);
          break;
        }
        case "flash": {
          flashByName(this.wsConfig, message.value.project, message.value.build, message.value.runner);
          setActive(this.wsConfig, message.value.project, message.value.build, message.value.runner);
          break;
        }
        case "setActive": {
          setActive(this.wsConfig, message.value.project, message.value.build, message.value.runner);
          break;
        }
        case "openBoardDtc": {
          let build = this.wsConfig.projects[message.value.project].buildConfigs[message.value.build];
          let filePath;
          if (path.isAbsolute(build.relBoardSubDir)) {
            if (build.board.includes("/")) {
              filePath = vscode.Uri.file(path.join(build.relBoardSubDir, "board.cmake"));
            } else {
              filePath = vscode.Uri.file(path.join(build.relBoardSubDir, build.board + ".dts"));
            }
          } else {
            filePath = vscode.Uri.file(path.join(this.wsConfig.rootPath, build.relBoardDir, build.relBoardSubDir, build.board + ".dts")); //kept for backwards compatibility
          }

          vscode.workspace.openTextDocument(filePath).then(document => vscode.window.showTextDocument(document));
          setActive(this.wsConfig, message.value.project, message.value.build, message.value.runner);
          break;
        }
        case "modifyBuildArgs": {
          modifyBuildArguments(this.context, this.wsConfig, message.value.project, message.value.build).finally(() => { vscode.commands.executeCommand("zephyr-ide.update-web-view"); });
          setActive(this.wsConfig, message.value.project, message.value.build, message.value.runner);
        }
        case "addFile": {
          switch (message.value.cmd) {
            case "addOverlayFile": {
              addConfigFiles(this.context, this.wsConfig, false, !message.value.build, message.value.project, message.value.build).finally(() => { vscode.commands.executeCommand("zephyr-ide.update-web-view"); });
              break;
            }
            case "addKConfigFile": {
              addConfigFiles(this.context, this.wsConfig, true, !message.value.build, message.value.project, message.value.build).finally(() => { vscode.commands.executeCommand("zephyr-ide.update-web-view"); });
              break;
            }
          }
          break;
        }
        case "deleteFile": {
          switch (message.value.cmd) {
            case "removeOverlayFile": {
              removeConfigFile(this.context, this.wsConfig, false, !message.value.build, message.value.project, !message.value.isExtra, [message.value.filename], message.value.build).finally(() => { vscode.commands.executeCommand("zephyr-ide.update-web-view"); });
              break;
            }
            case "removeKConfigFile": {
              removeConfigFile(this.context, this.wsConfig, true, !message.value.build, message.value.project, !message.value.isExtra, [message.value.filename], message.value.build).finally(() => { vscode.commands.executeCommand("zephyr-ide.update-web-view"); });
              break;
            }
          }
          break;
        }

        default:
          console.log("unknown command");
          console.log(message);
      }
    });
    this.setHtml("");
    vscode.commands.executeCommand("zephyr-ide.update-web-view");
  }
}

