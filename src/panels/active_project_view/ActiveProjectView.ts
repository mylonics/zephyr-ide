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

import { ProjectConfig, } from '../../project_utilities/project';
import { BuildConfig } from '../../project_utilities/build_selector';
import { getNonce } from "../../utilities/getNonce";
import { RunnerConfig } from '../../project_utilities/runner_selector';
import { WorkspaceConfig, getActiveBuildConfigOfProject, getActiveRunnerConfigOfBuild } from '../../setup_utilities/setup';

export class ActiveProjectView implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;

  launchActions = [
    {
      icon: "arrow-swap",
      actionId: "changeLaunchTarget",
      tooltip: "Change Launch Target",
    },
  ];

  buildActions = [
    {
      icon: "settings-gear",
      actionId: "startMenuConfig",
      tooltip: "MenuConfig",
    },
  ];


  constructor(public extensionPath: string, private context: vscode.ExtensionContext, private wsConfig: WorkspaceConfig) {

  }

  updateWebView(wsConfig: WorkspaceConfig) {
    if (this.view) {
      let activeProject: ProjectConfig | undefined;
      let activeBuild: BuildConfig | undefined;
      let activeRunner: RunnerConfig | undefined;
      if (wsConfig.activeProject !== undefined) {
        activeProject = wsConfig.projects[wsConfig.activeProject];
        activeBuild = getActiveBuildConfigOfProject(wsConfig, wsConfig.activeProject)
        if (activeBuild !== undefined) {
          activeRunner = getActiveRunnerConfigOfBuild(wsConfig, wsConfig.activeProject, activeBuild.name);
          this.view.title = activeProject.name + ": " + activeBuild.name;
        } else {
          this.view.title = activeProject.name;
        }
      } else {
        this.view.title = "Active Project: None";
        this.view.webview.postMessage([{}]);
        return;
      }


      let data = [{
        icons: {
          leaf: 'project',
        },
        actions: this.buildActions,
        label: "Build Pristine",
        description: activeBuild ? activeBuild.name : "Not Available",
        value: { command: "vsCommand", vsCommand: "zephyr-ide.build-pristine" },
      }, {
        icons: {
          leaf: 'project',
        },
        actions: this.buildActions,
        label: "Build",
        description: activeBuild ? activeBuild.name : "Not Available",
        value: { command: "vsCommand", vsCommand: "zephyr-ide.build" },
      }, {
        icons: {
          leaf: 'chip',
        },
        label: "Flash",
        description: activeRunner ? activeRunner.name : "Not Available",
        value: { command: "vsCommand", vsCommand: "zephyr-ide.flash" },
      }, {
        icons: {
          leaf: 'debug-alt',
        },
        actions: this.launchActions,
        label: "Debug",
        value: { command: "vsCommand", vsCommand: "zephyr-ide.debug", "launchChangeCmd": "zephyr-ide.change-debug-launch-for-build", },
        description: activeBuild?.launchTarget ? activeBuild.launchTarget : "Zephyr IDE: Debug",
      }, {
        icons: {
          leaf: 'debug-all',
        },
        actions: this.launchActions,
        label: "Build and Debug",
        value: { command: "vsCommand", vsCommand: "zephyr-ide.build-debug", "launchChangeCmd": "zephyr-ide.change-build-debug-launch-for-build", },
        description: activeBuild?.buildDebugTarget ? activeBuild.buildDebugTarget : "Zephyr IDE: Debug",
      }, {
        icons: {
          leaf: 'debug-console',
        },
        actions: this.launchActions,
        label: "Debug Attach",
        value: { command: "vsCommand", vsCommand: "zephyr-ide.debug-attach", "launchChangeCmd": "zephyr-ide.change-debug-attach-launch-for-build" },
        description: activeBuild?.attachTarget ? activeBuild.attachTarget : "Zephyr IDE: Attach",
      }];

      this.view.webview.postMessage(data);
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
      <script nonce="${nonce}" src="${assetUri('src/panels/active_project_view/ActiveProjectViewHandler.js')}"  type="module"></script>
    </head>
    <body>
    <vscode-tree id="basic-example" ></vscode-tree>
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
      switch (message.command) {
        case "vsCommand": {
          vscode.commands.executeCommand(message.value.vsCommand);
          break;
        }
        case "changeLaunchTarget": {
          vscode.commands.executeCommand(message.value.launchChangeCmd);
          break;
        }
        case "startMenuConfig": {
          vscode.commands.executeCommand("zephyr-ide.start-menu-config");
          break;
        }
        default:
          console.log("unknown command");
          console.log(message);
      }
    });
    this.setHtml("");
    this.updateWebView(this.wsConfig);
  }
}

