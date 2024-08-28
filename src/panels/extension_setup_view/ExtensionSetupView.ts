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
import { SetupStateType, WorkspaceConfig, GlobalConfig, getToolsDir } from '../../setup_utilities/setup';
import { getNonce } from "../../utilities/getNonce";
import { getRootPath } from '../../utilities/utils';
import { checkWestInit } from '../../setup_utilities/setup';


export class ExtensionSetupView implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;

  constructor(public extensionPath: string, private context: vscode.ExtensionContext, private wsConfig: WorkspaceConfig, private globalConfig: GlobalConfig) { }

  updateWebView(wsConfig: WorkspaceConfig, globalConfig: GlobalConfig) {
    let bodyString = "";

    let westInited = false;
    if (wsConfig.activeSetupState) {
      westInited = checkWestInit(wsConfig.activeSetupState);
    }

    if (getRootPath() === undefined) {
      bodyString = bodyString + `Open a folder/workspace before continuing`;
    } else if (wsConfig.activeSetupState && wsConfig.selectSetupType !== SetupStateType.NONE) {
      if (wsConfig.activeSetupState.setupPath === wsConfig.rootPath) {
        bodyString = bodyString + `Using Workspace Folder for Zephyr Install`;
      } else if (wsConfig.activeSetupState.setupPath === getToolsDir()) {
        bodyString = bodyString + `Using Global Folder for Zephyr Install`;
      } else {
        bodyString = bodyString + `Using ${wsConfig.activeSetupState.setupPath} Folder for Zephyr Install`;
      }

      if (!wsConfig.initialSetupComplete) {
        bodyString = bodyString + `<vscode-label> <span class="normal" >In order to use the Zephyr IDE Extension the workspace needs to be fully initialized.</span></vscode-label>`;
        bodyString = bodyString + `<vscode-button id="cmd-btn" class="widebtn" name="zephyr-ide.init-workspace" >Initialize Workspace</vscode-button>`;
        bodyString = bodyString + `<vscode-label><span class="normal" >The Initialize Extension command is comprised of the following commands:</span></vscode-label>`;
      }
      bodyString = bodyString + `<vscode-button id="cmd-btn" class="widebtn" ${wsConfig.activeSetupState.toolsAvailable ? "secondary" : ""} name="zephyr-ide.check-build-dependencies" >Check Build Dependencies</vscode-button>`;
      bodyString = bodyString + `<vscode-button id="cmd-btn"class="widebtn" ${wsConfig.activeSetupState.pythonEnvironmentSetup ? "secondary" : ""} name="zephyr-ide.setup-west-environment" >Setup West Environment</vscode-button>`;
      bodyString = bodyString + `<vscode-button id="cmd-btn"class="widebtn" ${globalConfig.sdkInstalled ? "secondary" : ""} name="zephyr-ide.install-sdk" >Install SDK</vscode-button>`;
      bodyString = bodyString + `<vscode-button id="cmd-btn"class="widebtn" ${westInited ? "secondary" : ""} name="zephyr-ide.west-init" >West Init</vscode-button>`;
      bodyString = bodyString + `<vscode-button id="cmd-btn"class="widebtn" ${wsConfig.activeSetupState.westUpdated ? "secondary" : ""} name="zephyr-ide.west-update" >West Update</vscode-button>`;
      bodyString = bodyString + `<vscode-label><span class="normal" >Note: West Update should be run whenever the west.yml file is changed</span></vscode-label><hr>`;

      bodyString = bodyString + `<vscode-label><span class="normal" >The workspace may be reset with the following commands:</span></vscode-label>`;
      bodyString = bodyString + `<vscode-button id="cmd-btn" class="widebtn" ${Object.keys(wsConfig.projects).length === 0 ? "secondary" : ""} name="zephyr-ide.clear-projects" >Clear Projects</vscode-button>`;
      bodyString = bodyString + `<vscode-button id="cmd-btn" class="widebtn" name="zephyr-ide.reset-zephyr-install-selection" >Change Folder used for Zephyr Install</vscode-button>`;
      bodyString = bodyString + `<vscode-button id="cmd-btn" class="widebtn" name="zephyr-ide.reset-extension" >Reset Workspace Settings</vscode-button><p></p>`;
    } else {
      bodyString = bodyString + `Select Folder for Zephyr Setup Location.<p/>`;
      bodyString = bodyString + `<vscode-button id="cmd-btn" class="widebtn" name="zephyr-ide.use-local-zephyr-install" >Workspace</vscode-button>`;
      bodyString = bodyString + `<vscode-button id="cmd-btn" class="widebtn" name="zephyr-ide.use-global-zephyr-install" >Global</vscode-button>`;
      bodyString = bodyString + `<vscode-button id="cmd-btn" class="widebtn" name="zephyr-ide.use-external-zephyr-install" >Other Folder</vscode-button>`;
    }
    this.setHtml(bodyString);
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
          <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${this.view.webview.cspSource}; font-src ${this.view.webview.cspSource}; img-src ${this.view.webview.cspSource} https:; script-src 'nonce-${nonce}';">
          <script nonce="${nonce}" src="${assetUri('node_modules/@vscode-elements/elements/dist/bundled.js')}"  type="module"></script>
          <script nonce="${nonce}" src="${assetUri('src/panels/extension_setup_view/ExtensionSetupViewHandler.js')}"  type="module"></script>
        </head>
        <body>
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
      vscode.commands.executeCommand(message.command);
    });
    this.updateWebView(this.wsConfig, this.globalConfig);
  }
}

