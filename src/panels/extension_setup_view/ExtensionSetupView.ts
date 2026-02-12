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
import path from 'upath';
import { WorkspaceConfig, GlobalConfig } from '../../setup_utilities/types';
import { getNonce } from "../../utilities/getNonce";


export class ExtensionSetupView implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;

  constructor(public extensionPath: string, private context: vscode.ExtensionContext, private wsConfig: WorkspaceConfig, private globalConfig: GlobalConfig) { }

  updateWebView(wsConfig: WorkspaceConfig, globalConfig: GlobalConfig) {
    if (this.view) {
      // Simplified view showing only the most commonly needed commands
      // Other commands (West Config, Setup West Environment, West Init) 
      // remain available via Command Palette and Setup Panel
      let data = [{
        icons: {
          leaf: 'folder-opened',
        },
        label: "Zephyr IDE Configuration",
        value: { command: "zephyr-ide.open-setup-panel" },
      }, {
        icons: {
          leaf: 'sync',
        },
        label: "West Update",
        value: { command: "zephyr-ide.west-update" },
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
          <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${this.view.webview.cspSource}; font-src ${this.view.webview.cspSource}; img-src ${this.view.webview.cspSource} https:; script-src 'nonce-${nonce}';">
          <script nonce="${nonce}" src="${assetUri('node_modules/@vscode-elements/elements/dist/bundled.js')}"  type="module"></script>
          <script nonce="${nonce}" src="${assetUri('src/panels/extension_setup_view/ExtensionSetupViewHandler.js')}"  type="module"></script>
        </head>
        <body>
        <vscode-tree id="setup-tree"></vscode-tree>
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
    
    // Refresh webview when it becomes visible to ensure content is loaded
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        this.updateWebView(this.wsConfig, this.globalConfig);
      }
    });
    
    webviewView.webview.onDidReceiveMessage(message => {
      console.log(message);
      vscode.commands.executeCommand(message.command);
    });
    this.setHtml("");
    this.updateWebView(this.wsConfig, this.globalConfig);
  }
}

