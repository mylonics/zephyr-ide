/*
Copyright 2025-2026 mylonics 
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

import * as vscode from "vscode";
import { WorkspaceConfig, GlobalConfig } from "../../setup_utilities/types";
import { HostToolsService, HOST_TOOL_INSTALL_VIEW_CONFIG } from "../hostToolsService";
import { generateNonce } from "../webview_shared/nonce";

export class HostToolInstallView {
  public static currentPanel: HostToolInstallView | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionPath: string;
  private readonly _context: vscode.ExtensionContext;
  private _disposables: vscode.Disposable[] = [];
  private _service: HostToolsService;

  private currentWsConfig?: WorkspaceConfig;
  private currentGlobalConfig?: GlobalConfig;

  public static createOrShow(
    extensionPath: string,
    context: vscode.ExtensionContext,
    wsConfig: WorkspaceConfig,
    globalConfig: GlobalConfig
  ) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (HostToolInstallView.currentPanel) {
      HostToolInstallView.currentPanel._panel.reveal(column);
      HostToolInstallView.currentPanel.updateContent(wsConfig, globalConfig);
      return HostToolInstallView.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      "zephyrIDEHostTools",
      "Zephyr IDE: Host Tools",
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.file(extensionPath)],
      }
    );

    HostToolInstallView.currentPanel = new HostToolInstallView(
      panel,
      extensionPath,
      context,
      wsConfig,
      globalConfig
    );
    return HostToolInstallView.currentPanel;
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionPath: string,
    context: vscode.ExtensionContext,
    wsConfig: WorkspaceConfig,
    globalConfig: GlobalConfig
  ) {
    this._panel = panel;
    this._extensionPath = extensionPath;
    this._context = context;
    this._service = new HostToolsService(panel.webview, HOST_TOOL_INSTALL_VIEW_CONFIG);

    this.updateContent(wsConfig, globalConfig);

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      (message) => {
        this.handleWebviewMessage(message);
      },
      null,
      this._disposables
    );
  }

  public updateContent(wsConfig: WorkspaceConfig, globalConfig: GlobalConfig) {
    this.currentWsConfig = wsConfig;
    this.currentGlobalConfig = globalConfig;

    if (!this._htmlInitialized) {
      this._panel.webview.html = this.getHtmlForWebview();
      this._htmlInitialized = true;
    }
  }

  private _htmlInitialized = false;

  private async handleWebviewMessage(message: any) {
    switch (message.command) {
      case "ready":
        // Trigger initial status check when client is ready
        await this._service.checkStatus();
        return;
      case "hostToolsCheckStatus":
        await this._service.checkStatus();
        break;
      case "hostToolsInstallPackageManager":
        await this._service.installPackageManager();
        break;
      case "hostToolsInstallPackage":
        await this._service.installSinglePackage(message.packageName);
        break;
      case "hostToolsInstallAllMissing":
        await this._service.installAllMissing();
        break;
      case "hostToolsInstallAllMissingPackages":
        await this._service.installAllMissingPackages(message.packageNames);
        break;
      case "markComplete":
        await this._service.markComplete(this._context, this.currentWsConfig, this.currentGlobalConfig);
        break;
      case "hostToolsOpenManagerInstallUrl":
        await this._service.openManagerInstallUrl();
        break;
      case "openSetupPanel":
        vscode.commands.executeCommand("zephyr-ide.open-setup-panel");
        break;
    }
  }

  public dispose() {
    HostToolInstallView.currentPanel = undefined;

    this._panel.dispose();

    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }

  private getHtmlForWebview(): string {
    const cssUri = this._panel.webview.asWebviewUri(
      vscode.Uri.joinPath(
        vscode.Uri.file(this._extensionPath),
        "src",
        "panels",
        "host_tool_install_view",
        "host-tool-install.css"
      )
    );

    const codiconUri = this._panel.webview.asWebviewUri(
      vscode.Uri.joinPath(
        vscode.Uri.file(this._extensionPath),
        "node_modules",
        "@vscode",
        "codicons",
        "dist",
        "codicon.css"
      )
    );

    const jsUri = this._panel.webview.asWebviewUri(
      vscode.Uri.joinPath(
        vscode.Uri.file(this._extensionPath),
        "dist",
        "webview",
        "host_tool_install_view",
        "host-tool-install.js"
      )
    );

    const nonce = generateNonce();

    return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${this._panel.webview.cspSource} 'unsafe-inline'; font-src ${this._panel.webview.cspSource}; img-src ${this._panel.webview.cspSource} data:; script-src 'nonce-${nonce}';">
        <title>Host Tools Installation</title>
        <link rel="stylesheet" type="text/css" href="${cssUri}">
        <link rel="stylesheet" type="text/css" href="${codiconUri}" id="vscode-codicon-stylesheet">
    </head>
    <body>
        <host-tools-app></host-tools-app>
        <script nonce="${nonce}" src="${jsUri}"></script>
    </body>
    </html>`;
  }
}
