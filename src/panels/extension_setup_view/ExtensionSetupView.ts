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
import { SetupStateType, WorkspaceConfig } from '../../setup_utilities/setup';
import { getNonce } from "../../utilities/getNonce";
import { getRootPath } from '../../utilities/utils';


export class ExtensionSetupView implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;

  constructor(public extensionPath: string, private context: vscode.ExtensionContext, private wsConfig: WorkspaceConfig) { }

  updateWebView(wsConfig: WorkspaceConfig) {
    let bodyString = "";

    if (getRootPath() === undefined) {
      bodyString = bodyString + `Open a folder/workspace before continuing`;
    } else if (wsConfig.selectSetupType === SetupStateType.NONE) {
      bodyString = bodyString + `Choose how you would like to develop.<p/>`;

      bodyString = bodyString + `Clone Zephyr into the current workspace:`;
      bodyString = bodyString + `<vscode-button id="cmd-btn" class="widebtn" name="zephyr-ide.use-local-zephyr-install" >Use Local Zephyr Install</vscode-button><p/>`;

      bodyString = bodyString + `Use a Zephyr install that is available globally:`;
      bodyString = bodyString + `<vscode-button id="cmd-btn" class="widebtn" name="zephyr-ide.use-global-zephyr-install" >Use Global Zephyr Install</vscode-button><p/>`;

    } else if (wsConfig.activeSetupState) {
      bodyString = bodyString + `Using ${wsConfig.selectSetupType} Zephyr Install`;
      if (!wsConfig.initialSetupComplete) {
        bodyString = bodyString + `<vscode-label> <span class="normal" >In order to use the Zephyr IDE Extension the workspace needs to be fully initialized.</span></vscode-label>`;
        bodyString = bodyString + `<vscode-button id="cmd-btn" class="widebtn" name="zephyr-ide.init-workspace" >Initialize Workspace</vscode-button>`;
        bodyString = bodyString + `<vscode-label><span class="normal" >The Initialize Extension command is comprised of the following commands:</span></vscode-label>`;
      }
      bodyString = bodyString + `<vscode-button id="cmd-btn" class="widebtn" ${wsConfig.activeSetupState.toolsAvailable ? "secondary" : ""} name="zephyr-ide.check-build-dependencies" >Check Build Dependencies</vscode-button>`;
      bodyString = bodyString + `<vscode-button id="cmd-btn"class="widebtn" ${wsConfig.activeSetupState.pythonEnvironmentSetup ? "secondary" : ""} name="zephyr-ide.setup-west-environment" >Setup West Environment</vscode-button>`;
      bodyString = bodyString + `<vscode-button id="cmd-btn"class="widebtn" ${wsConfig.activeSetupState.sdkInstalled ? "secondary" : ""} name="zephyr-ide.install-sdk" >Install SDK</vscode-button>`;
      bodyString = bodyString + `<vscode-button id="cmd-btn"class="widebtn" ${wsConfig.activeSetupState.westInited ? "secondary" : ""} name="zephyr-ide.west-init" >West Init</vscode-button>`;
      bodyString = bodyString + `<vscode-button id="cmd-btn"class="widebtn" ${wsConfig.activeSetupState.westUpdated ? "secondary" : ""} name="zephyr-ide.west-update" >West Update</vscode-button>`;
      bodyString = bodyString + `<vscode-label><span class="normal" >Note: West Update should be run whenever the west.yml file is changed</span></vscode-label><hr>`;

      bodyString = bodyString + `<vscode-label><span class="normal" >The workspace may be reset with the following commands:</span></vscode-label>`;
      bodyString = bodyString + `<vscode-button id="cmd-btn" class="widebtn" ${Object.keys(wsConfig.projects).length === 0 ? "secondary" : ""} name="zephyr-ide.clear-projects" >Clear Projects</vscode-button>`;
      bodyString = bodyString + `<vscode-button id="cmd-btn" class="widebtn" name="zephyr-ide.reset-zephyr-install-selection" >Change Zephyr Install Selection</vscode-button>`;
      bodyString = bodyString + `<vscode-button id="cmd-btn" class="widebtn" name="zephyr-ide.reset-extension" >Reset Workspace Settings</vscode-button><p></p>`;
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
    this.updateWebView(this.wsConfig);
  }
}

