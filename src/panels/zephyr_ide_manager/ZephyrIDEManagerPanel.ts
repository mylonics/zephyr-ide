/*
Copyright 2026 mylonics
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
import {
  listModulesWithBlobs,
  installBlobModulesInteractive,
  onBlobProgress,
  BlobModuleInfo,
} from "../../setup_utilities/zephyr_ide_install";
import {
  getZephyrIdeToolchains,
  getZephyrIdeBlobs,
  getZephyrIdePipPackages,
  getZephyrIdeSampleProjects,
  getZephyrIdeCommands,
} from "../../setup_utilities/zephyr_ide_json";
import { outputError, notifyError } from "../../utilities/output";
import { generateNonce } from "../webview_shared/nonce";

export class ZephyrIDEManagerPanel {
  public static currentPanel: ZephyrIDEManagerPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionPath: string;
  private readonly _context: vscode.ExtensionContext;
  private _disposables: vscode.Disposable[] = [];

  private currentWsConfig?: WorkspaceConfig;
  private currentGlobalConfig?: GlobalConfig;

  public static updateAllPanels(wsConfig: WorkspaceConfig, globalConfig: GlobalConfig): void {
    if (ZephyrIDEManagerPanel.currentPanel) {
      ZephyrIDEManagerPanel.currentPanel.updateContent(wsConfig, globalConfig);
    }
  }

  public static createOrShow(
    extensionPath: string,
    context: vscode.ExtensionContext,
    wsConfig: WorkspaceConfig,
    globalConfig: GlobalConfig,
  ) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (ZephyrIDEManagerPanel.currentPanel) {
      ZephyrIDEManagerPanel.currentPanel._panel.reveal(column);
      ZephyrIDEManagerPanel.currentPanel.updateContent(wsConfig, globalConfig);
      return ZephyrIDEManagerPanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      "zephyrIDEManager",
      "Zephyr IDE: Manager",
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.file(extensionPath)],
      },
    );

    ZephyrIDEManagerPanel.currentPanel = new ZephyrIDEManagerPanel(
      panel,
      extensionPath,
      context,
      wsConfig,
      globalConfig,
    );
    return ZephyrIDEManagerPanel.currentPanel;
  }

  private _htmlInitialized = false;

  private constructor(
    panel: vscode.WebviewPanel,
    extensionPath: string,
    context: vscode.ExtensionContext,
    wsConfig: WorkspaceConfig,
    globalConfig: GlobalConfig,
  ) {
    this._panel = panel;
    this._extensionPath = extensionPath;
    this._context = context;

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      (message) => { this.handleWebviewMessage(message); },
      null,
      this._disposables,
    );

    this._disposables.push(
      onBlobProgress((message) => {
        this._panel.webview.postMessage({
          command: "blobInstallProgress",
          data: message,
        });
      }),
    );

    this.updateContent(wsConfig, globalConfig);
    void this.listBlobs();
  }

  public updateContent(wsConfig: WorkspaceConfig, globalConfig: GlobalConfig): void {
    this.currentWsConfig = wsConfig;
    this.currentGlobalConfig = globalConfig;

    if (!this._htmlInitialized) {
      this._panel.webview.html = this.getHtmlForWebview();
      this._htmlInitialized = true;
    }

    this._panel.webview.postMessage({
      command: "updateContent",
      data: {
        toolchains: getZephyrIdeToolchains(wsConfig),
        blobs: getZephyrIdeBlobs(wsConfig),
        pipPackages: getZephyrIdePipPackages(wsConfig),
        sampleProjects: getZephyrIdeSampleProjects(wsConfig).map(project => ({
          name: project.name,
          rel_path: project.rel_path,
        })),
        commands: getZephyrIdeCommands(wsConfig),
      },
    });
  }

  public dispose() {
    ZephyrIDEManagerPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) { x.dispose(); }
    }
  }

  private async handleWebviewMessage(message: Record<string, any>) {
    switch (message.command) {
      case "ready":
        if (this.currentWsConfig && this.currentGlobalConfig) {
          this.updateContent(this.currentWsConfig, this.currentGlobalConfig);
          await this.listBlobs();
        }
        return;
      case "refresh":
        if (this.currentWsConfig && this.currentGlobalConfig) {
          this.updateContent(this.currentWsConfig, this.currentGlobalConfig);
          await this.listBlobs();
        }
        return;
      case "modifyToolchains":
        await vscode.commands.executeCommand("zephyr-ide.modify-zephyr-ide-toolchains");
        await this.refreshAll();
        return;
      case "installToolchains":
        await vscode.commands.executeCommand("zephyr-ide.install-zephyr-ide-toolchains");
        await this.refreshAll();
        return;
      case "modifyPipPackages":
        await vscode.commands.executeCommand("zephyr-ide.modify-zephyr-ide-pip-packages");
        await this.refreshAll();
        return;
      case "installPipPackages":
        await vscode.commands.executeCommand("zephyr-ide.install-zephyr-ide-pip-packages");
        await this.refreshAll();
        return;
      case "modifyBlobs":
        await vscode.commands.executeCommand("zephyr-ide.modify-zephyr-ide-blobs");
        await this.refreshAll();
        return;
      case "installBlobsFromJson":
        await vscode.commands.executeCommand("zephyr-ide.install-zephyr-ide-blobs");
        await this.refreshAll();
        return;
      case "installBlobModules":
        if (Array.isArray(message.modules)) {
          await this.installBlobModules(message.modules);
        }
        return;
      case "modifySampleProjects":
        await vscode.commands.executeCommand("zephyr-ide.modify-zephyr-ide-sample-projects");
        await this.refreshAll();
        return;
      case "modifyCommands":
        await vscode.commands.executeCommand("zephyr-ide.modify-zephyr-ide-commands");
        await this.refreshAll();
        return;
      case "runCommands":
        await vscode.commands.executeCommand("zephyr-ide.run-zephyr-ide-commands");
        return;
      case "openHostToolsPanel":
        void vscode.commands.executeCommand("zephyr-ide.open-host-tools-panel");
        return;
      case "openSetupPanel":
        void vscode.commands.executeCommand("zephyr-ide.open-setup-panel");
        return;
      case "openSdkPanel":
        void vscode.commands.executeCommand("zephyr-ide.open-sdk-panel");
        return;
    }
  }

  private async refreshAll(): Promise<void> {
    if (this.currentWsConfig && this.currentGlobalConfig) {
      this.updateContent(this.currentWsConfig, this.currentGlobalConfig);
      await this.listBlobs();
      await vscode.commands.executeCommand("zephyr-ide.update-web-view");
    }
  }

  private async listBlobs(): Promise<void> {
    if (!this.currentWsConfig) {
      this._panel.webview.postMessage({ command: "blobListResult", data: [] as BlobModuleInfo[] });
      return;
    }

    this._panel.webview.postMessage({ command: "blobListLoading" });
    try {
      const modules = await listModulesWithBlobs(this.currentWsConfig, this._context);
      this._panel.webview.postMessage({ command: "blobListResult", data: modules });
    } catch (error) {
      outputError("Zephyr IDE Manager", `Failed to list blobs: ${String(error)}`);
      this._panel.webview.postMessage({ command: "blobListResult", data: [] as BlobModuleInfo[] });
    }
  }

  private async installBlobModules(modules: string[]): Promise<void> {
    if (!this.currentWsConfig) {
      notifyError("Zephyr IDE Blobs", "No active workspace configuration.");
      this._panel.webview.postMessage({ command: "blobInstallResult", data: false });
      return;
    }

    try {
      this._panel.webview.postMessage({ command: "blobInstallProgress", data: "Starting blob installation..." });
      const result = await installBlobModulesInteractive(this.currentWsConfig, this._context, modules);
      this._panel.webview.postMessage({ command: "blobInstallResult", data: result });
      await this.listBlobs();
    } catch (error) {
      outputError("Zephyr IDE Manager", `Failed to install blob modules: ${String(error)}`);
      this._panel.webview.postMessage({ command: "blobInstallResult", data: false });
    }
  }

  private getHtmlForWebview(): string {
    const nonce = generateNonce();
    const cssUri = this._panel.webview.asWebviewUri(
      vscode.Uri.joinPath(vscode.Uri.file(this._extensionPath), "src", "panels", "zephyr_ide_manager", "zephyr-ide-manager.css"),
    );
    const codiconUri = this._panel.webview.asWebviewUri(
      vscode.Uri.joinPath(vscode.Uri.file(this._extensionPath), "node_modules", "@vscode", "codicons", "dist", "codicon.css"),
    );
    const jsUri = this._panel.webview.asWebviewUri(
      vscode.Uri.joinPath(vscode.Uri.file(this._extensionPath), "dist", "webview", "zephyr_ide_manager", "zephyr-ide-manager.js"),
    );

    return `<!DOCTYPE html>
      <html lang="en">
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${this._panel.webview.cspSource}; font-src ${this._panel.webview.cspSource}; img-src ${this._panel.webview.cspSource} data:; script-src 'nonce-${nonce}';">
          <title>Zephyr IDE Manager</title>
          <link rel="stylesheet" type="text/css" href="${cssUri}">
          <link rel="stylesheet" type="text/css" href="${codiconUri}" id="vscode-codicon-stylesheet">
      </head>
      <body>
          <zephyr-ide-manager-app></zephyr-ide-manager-app>
          <script nonce="${nonce}" src="${jsUri}"></script>
      </body>
      </html>`;
  }
}
