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
import { WorkspaceConfig, GlobalConfig } from '../../setup_utilities/types';
import { generateWebviewHtml, initWebviewView } from '../webviewHelper';


export class ExtensionSetupView implements vscode.WebviewViewProvider {
  public view: vscode.WebviewView | undefined;

  constructor(public extensionPath: string, private context: vscode.ExtensionContext, private wsConfig: WorkspaceConfig, private globalConfig: GlobalConfig) { }

  updateWebView(wsConfig: WorkspaceConfig, globalConfig: GlobalConfig) {
    if (this.view) {
      // Simplified view showing only the most commonly needed commands
      // Other commands (West Config, Setup West Environment, West Init) 
      // remain available via Command Palette and Setup Panel
      const data = [{
        icons: {
          leaf: 'folder-opened',
        },
        label: "IDE for Zephyr Configuration",
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
      this.view.webview.html = generateWebviewHtml(this.view, this.extensionPath, body, {
        handlerJsPath: 'src/panels/extension_setup_view/ExtensionSetupViewHandler.js',
        treeElementHtml: '<vscode-tree id="setup-tree"></vscode-tree>',
        includeCSP: true,
      });
    }
  };


  resolveWebviewView(webviewView: vscode.WebviewView, context: vscode.WebviewViewResolveContext, token: vscode.CancellationToken): void | Thenable<void> {
    initWebviewView(
      this, webviewView,
      () => this.updateWebView(this.wsConfig, this.globalConfig),
      (message) => {
        // Only allow known zephyr-ide commands from the webview
        if (typeof message.command === 'string' && message.command.startsWith('zephyr-ide.')) {
          void vscode.commands.executeCommand(message.command);
        }
      },
      () => { this.setHtml(""); this.updateWebView(this.wsConfig, this.globalConfig); }
    );
  }
}

