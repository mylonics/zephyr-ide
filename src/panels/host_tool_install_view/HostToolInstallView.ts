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

import * as vscode from "vscode";
import { WorkspaceConfig, GlobalConfig } from "../../setup_utilities/types";
import { HostToolsService, HOST_TOOL_INSTALL_VIEW_CONFIG } from "../hostToolsService";

export class HostToolInstallView {
  public static currentPanel: HostToolInstallView | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionPath: string;
  private readonly _context: vscode.ExtensionContext;
  private _disposables: vscode.Disposable[] = [];
  private _service: HostToolsService;

  private currentWsConfig?: WorkspaceConfig;
  private currentGlobalConfig?: GlobalConfig;

  /**
   * Get just the host tools manager content HTML (without full page wrapper)
   * for embedding in other panels
   */
  public static getContentHtml(): string {
    return `
      <div class="host-tools-manager">
        <div class="info-box">
          <p>
            This tool helps you install and manage development tools required for Zephyr RTOS development.
            The tools will be installed using your platform's package manager.
          </p>
          <p class="host-tools-note">
            <strong>Note:</strong> VS Code may need to be restarted after installation for tools to be available in the PATH.
          </p>
        </div>

        <div id="package-manager-section" class="manager-section">
          <h3>Package Manager Status</h3>
          <div id="manager-status" class="status-area">
            <div class="loading">Checking package manager...</div>
          </div>
        </div>

        <div id="packages-section" class="manager-section">
          <h3>Required Development Tools</h3>
          <div id="packages-status" class="status-area">
            <div class="loading">Checking packages...</div>
          </div>
        </div>

        <div id="actions-section" class="manager-section">
          <div class="button-group">
            <vscode-button id="refresh-btn" appearance="secondary" onclick="hostToolsClient.refreshStatus()">
              <vscode-icon slot="start-icon" name="refresh"></vscode-icon>
              Refresh Status
            </vscode-button>
            <vscode-button id="install-all-btn" onclick="hostToolsClient.installAllMissing()" disabled>
              <vscode-icon slot="start-icon" name="cloud-download"></vscode-icon>
              Install All Missing Packages
            </vscode-button>
          </div>
        </div>
      </div>
    `;
  }

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
    this._panel.webview.html = this.getHtmlForWebview();
    // Automatically check status on load
    this._service.checkStatus();
  }

  private async handleWebviewMessage(message: any) {
    switch (message.command) {
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

    return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Host Tools Installation</title>
        <link rel="stylesheet" type="text/css" href="${cssUri}">
        <link rel="stylesheet" type="text/css" href="${codiconUri}" id="vscode-codicon-stylesheet">
    </head>
    <body>
        <div class="container">
            <div class="breadcrumb">
                <a class="breadcrumb-link" onclick="sendCommand('openSetupPanel')">← Setup & Configuration</a>
                <span class="breadcrumb-separator">/</span>
                <span class="breadcrumb-current">Host Tools</span>
            </div>
            <div class="page-header">
                <div>
                    <h1 class="page-title">Host Tools Installation</h1>
                    <p class="page-subtitle">Install and maintain local system dependencies for Zephyr development.</p>
                </div>
            </div>
            ${HostToolInstallView.getContentHtml()}
            <div class="manager-section">
                <div class="button-group">
                    <vscode-button id="mark-complete-btn" appearance="secondary" onclick="markComplete()">
                        <vscode-icon slot="start-icon" name="check"></vscode-icon>
                        Skip &amp; Mark as Complete
                    </vscode-button>
                </div>
            </div>
        </div>
        <script src="${jsUri}"></script>
    </body>
    </html>`;
  }
}
