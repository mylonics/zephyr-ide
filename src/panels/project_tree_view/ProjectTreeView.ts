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
import { ProjectConfig, addBuildToProject, addConfigFiles, addRunnerToBuild, removeBuild, removeProject, removeRunner, setActive, removeConfigFiles, removeConfigFile } from '../../project_utilities/project';
import { BuildConfig } from '../../project_utilities/build_selector';
import { getNonce } from "../../utilities/getNonce";
import { RunnerConfig } from '../../project_utilities/runner_selector';
import { buildByName } from '../../zephyr_utilities/build';
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

  generateOverlayFileEntry(entry: any, projectName: string, buildName: string | undefined, confFiles: ConfigFiles) {
    entry.subItems = [];
    for (let index = 0; index < confFiles.overlay.length; index++) {
      entry.subItems.push({
        icons: {
          branch: 'file',
          leaf: 'file',
          open: 'file',
        }, label: 'dtc',
        value: { project: projectName, build: buildName, cmd: "removeOverlayFile", isExtra: false, filename: confFiles.overlay[index] },
        actions: this.fileItemActions,
        description: confFiles.overlay[index]
      });
    }
    for (let index = 0; index < confFiles.extraOverlay.length; index++) {
      entry.subItems.push({
        icons: {
          branch: 'file',
          leaf: 'file',
          open: 'file',
        }, label: 'Extra dtc',
        value: { project: projectName, build: buildName, cmd: "removeOverlayFile", isExtra: true, filename: confFiles.extraOverlay[index] },
        actions: this.fileItemActions,
        description: confFiles.extraOverlay[index]
      });
    }
    return { entry };
  }

  generateConfigFileEntry(entry: any, projectName: string, buildName: string | undefined, confFiles: ConfigFiles) {
    entry.subItems = [];
    for (let index = 0; index < confFiles.config.length; index++) {
      entry.subItems.push({
        icons: {
          branch: 'file',
          leaf: 'file',
          open: 'file',
        }, label: 'Conf',
        value: { project: projectName, build: buildName, cmd: "removeKConfigFile", isExtra: false, filename: confFiles.config[index] },
        actions: this.fileItemActions,
        description: confFiles.config[index]
      });
    }
    for (let index = 0; index < confFiles.extraConfig.length; index++) {
      entry.subItems.push({
        icons: {
          branch: 'file',
          leaf: 'file',
          open: 'file',
        }, label: 'Extra Conf',
        value: { project: projectName, build: buildName, cmd: "removeKConfigFile", isExtra: true, filename: confFiles.extraConfig[index] },
        actions: this.fileItemActions,
        description: confFiles.extraConfig[index]
      });
    }
    return entry;
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
      subItems: [
        {
          icons: {
            branch: 'tools',
            leaf: 'tools',
            open: 'tools',
          }, label: 'Runner', description: runner.runner
        },
      ]
    };

    if (runner.args) {
      entry.subItems.push({
        icons: {
          branch: 'file-code',
          leaf: 'file-code',
          open: 'file-code',
        }, label: 'Args', description: runner.args
      });
    }
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
      buildData['open'] = true;
      buildData['subItems'] = [
        {
          icons: {
            branch: 'circuit-board',
            leaf: 'circuit-board',
            open: 'circuit-board',
          },
          value: { cmd: "openBoardDtc", project: projectName, build: build.name },
          label: 'Board',
          description: build.board
        },
        {
          icons: {
            branch: 'file-submodule',
            leaf: 'file-submodule',
            open: 'file-submodule',
          },
          value: { cmd: "openBoardDir", project: projectName, build: build.name },
          label: 'Board Dir',
          description: build.relBoardDir,
        },
        {
          icons: {
            branch: 'settings',
            leaf: 'settings',
            open: 'settings',
          },
          actions: this.fileActions,
          label: "KConfig",
          value: { project: projectName, build: build.name, cmd: "addKConfigFile" },
          open: true,
          subItems: []
        }, {
          icons: {
            branch: 'circuit-board',
            leaf: 'circuit-board',
            open: 'circuit-board',
          },
          actions: this.fileActions,
          label: "DTC Overlay",
          value: { project: projectName, build: build.name, cmd: "addOverlayFile" },
          open: true,
          subItems: []
        },
      ];
    }
    this.generateConfigFileEntry(buildData.subItems[2], projectName, build.name, build.confFiles);
    this.generateOverlayFileEntry(buildData.subItems[3], projectName, build.name, build.confFiles);

    const lengthOfSubItems = buildData.subItems.length;

    let runnerNames = [];

    for (let key in build.runners) {
      runnerNames.push(key);
      let foundEntry = false;
      let index = 4;
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

    var i = buildData.subItems.length - 1;
    while (i >= 4) {
      if (!runnerNames.includes(buildData.subItems[i].label)) {
        buildData.subItems.splice(i, 1);
      }
      i--;
    }

    if (!Object.keys(build.runners).length) {
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
      projectData['subItems'] = [
        {
          icons: this.path_icons,
          label: 'Path',
          description: project.rel_path,
          value: { cmd: "openMain", project: project.name },
        },
        {
          icons: {
            branch: 'settings',
            leaf: 'settings',
            open: 'settings',
          },
          actions: this.fileActions,
          label: "KConfig",
          value: { project: project.name, build: undefined, cmd: "addKConfigFile" },
          open: true,
          subItems: []
        }, {
          icons: {
            branch: 'circuit-board',
            leaf: 'circuit-board',
            open: 'circuit-board',
          },
          actions: this.fileActions,
          label: "DTC Overlay",
          value: { project: project.name, build: undefined, cmd: "addOverlayFile" },
          open: true,
          subItems: []
        },
      ];
      projectData['open'] = true;
    }
    this.generateConfigFileEntry(projectData.subItems[1], project.name, undefined, project.confFiles);
    this.generateOverlayFileEntry(projectData.subItems[2], project.name, undefined, project.confFiles);

    const lengthOfSubItems = projectData.subItems.length;

    let buildNames = [];

    for (let key in project.buildConfigs) {
      buildNames.push(key);
      let foundEntry = false;
      let index = 3;
      for (; index < lengthOfSubItems; index++) {
        if (projectData.subItems[index].label === key) {
          foundEntry = true;
          break;
        }
      }
      if (foundEntry) {
        this.generateBuildString(projectData.subItems[index], project.name, project.buildConfigs[key]);
      } else {
        projectData.subItems.push(this.generateBuildString(undefined, project.name, project.buildConfigs[key]));
      }
    }

    var i = projectData.subItems.length - 1;
    while (i >= 3) {
      if (!buildNames.includes(projectData.subItems[i].label)) {
        projectData.subItems.splice(i, 1);
      }
      i--;
    }

    if (!Object.keys(project.buildConfigs).length) {
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
    <vscode-tree id="basic-example" indent-guides arrows></vscode-tree>
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
        case "openMain": {
          let project = this.wsConfig.projects[message.value.project];
          let filePath = vscode.Uri.file(path.join(this.wsConfig.rootPath, project.rel_path, "src", "main.c"));

          vscode.workspace.openTextDocument(filePath).then(
            document => vscode.window.showTextDocument(document));
          filePath = vscode.Uri.file(path.join(this.wsConfig.rootPath, project.rel_path, "src", "main.cpp"));
          vscode.workspace.openTextDocument(filePath).then(
            document => vscode.window.showTextDocument(document));

          setActive(this.wsConfig, message.value.project, message.value.build, message.value.runner);
          break;
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

