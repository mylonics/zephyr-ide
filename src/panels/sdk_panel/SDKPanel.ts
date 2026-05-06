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
  getWestSDKContext,
  listAvailableSDKs,
  ParsedSDKList,
  onSDKProgress,
  installSDKToolchainsInteractive,
  installToolchainsDirect,
  uninstallToolchains,
} from "../../setup_utilities/west_sdk";
import { notifyError, outputError } from "../../utilities/output";
import { generateNonce } from "../webview_shared/nonce";
import { sdkVersions } from "../../defines";

export class SDKPanel {
  public static currentPanel: SDKPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionPath: string;
  private readonly _context: vscode.ExtensionContext;
  private _disposables: vscode.Disposable[] = [];

  private currentWsConfig?: WorkspaceConfig;
  private currentGlobalConfig?: GlobalConfig;

  /** Cached SDK list fetched in the background. */
  private _cachedSDKList?: ParsedSDKList;
  /** True while a background SDK list fetch is in flight. */
  private _sdkListFetching = false;

  /** Update all open SDK panels with new config */
  public static updateAllPanels(wsConfig: WorkspaceConfig, globalConfig: GlobalConfig) {
    if (SDKPanel.currentPanel) {
      SDKPanel.currentPanel.updateContent(wsConfig, globalConfig);
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

    if (SDKPanel.currentPanel) {
      SDKPanel.currentPanel._panel.reveal(column);
      SDKPanel.currentPanel.updateContent(wsConfig, globalConfig);
      return SDKPanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      "zephyrIDESDK",
      "Zephyr IDE: SDK",
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.file(extensionPath)],
      },
    );

    SDKPanel.currentPanel = new SDKPanel(
      panel,
      extensionPath,
      context,
      wsConfig,
      globalConfig,
    );
    return SDKPanel.currentPanel;
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

    this.updateContent(wsConfig, globalConfig);

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      (message) => { this.handleWebviewMessage(message); },
      null,
      this._disposables,
    );

    // Subscribe to SDK install progress events and forward to webview
    this._disposables.push(
      onSDKProgress((event) => {
        this._panel.webview.postMessage({
          command: 'sdkInstallProgress',
          data: event,
        });
      }),
    );

    // Pre-fetch SDK list in the background
    void this.fetchSDKListInBackground();
  }

  public updateContent(wsConfig: WorkspaceConfig, globalConfig: GlobalConfig) {
    this.currentWsConfig = wsConfig;
    this.currentGlobalConfig = globalConfig;

    if (!this._htmlInitialized) {
      this._panel.webview.html = this.getHtmlForWebview();
      this._htmlInitialized = true;
    }

    // Send init data to the Lit component
    this._panel.webview.postMessage({
      command: "updateContent",
      data: {
        hasSetupState: this.hasValidSetupState(),
        sdkInstalled: globalConfig.sdkInstalled ?? false,
        sdkVersionMap: this.buildSdkVersionMap(),
      },
    });

    // Push cached SDK list immediately if available, otherwise start fetching
    if (this._cachedSDKList) {
      this._panel.webview.postMessage({
        command: "sdkListResult",
        data: this._cachedSDKList,
      });
    } else if (this.hasValidSetupState()) {
      this._panel.webview.postMessage({ command: "sdkListLoading" });
      void this.fetchSDKListInBackground();
    }
  }

  public dispose() {
    SDKPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) { x.dispose(); }
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private hasValidSetupState(): boolean {
    return this.currentGlobalConfig?.setupStateDictionary !== undefined &&
      Object.keys(this.currentGlobalConfig.setupStateDictionary).length > 0;
  }

  private handleWebviewMessage(message: Record<string, any>) {
    switch (message.command) {
      case "ready":
        if (this.currentWsConfig && this.currentGlobalConfig) {
          this.updateContent(this.currentWsConfig, this.currentGlobalConfig);
        }
        return;
      case "installSDK":
        this.installSDK();
        return;
      case "addToolchainsForVersion":
        if (typeof message.version === "string") {
          this.addToolchainsForVersion(message.version);
        }
        return;
      case "applyToolchainChanges":
        if (typeof message.version === "string" && Array.isArray(message.toAdd) && Array.isArray(message.toRemove)) {
          this.applyToolchainChanges(message.version, message.toAdd, message.toRemove);
        }
        return;
      case "listSDKs":
        this.listSDKs();
        return;
      case "openSetupPanel":
        vscode.commands.executeCommand("zephyr-ide.open-setup-panel");
        return;
    }
  }

  private async installSDK() {
    try {
      await vscode.commands.executeCommand("zephyr-ide.install-sdk");
      if (this.currentWsConfig && this.currentGlobalConfig) {
        try {
          this._cachedSDKList = undefined;
          this.updateContent(this.currentWsConfig, this.currentGlobalConfig);
          await this.listSDKs();
        } catch (updateError) {
          outputError("SDK Panel", `Failed to refresh panel after SDK installation: ${String(updateError)}`);
        }
      }
    } catch (error) {
      notifyError("SDK Install", `Failed to install west SDK: ${error}`);
    }
  }

  private async addToolchainsForVersion(version: string) {
    try {
      if (!this.currentWsConfig || !this.currentGlobalConfig) {
        notifyError("SDK Install", "Configuration not available");
        return;
      }
      await installSDKToolchainsInteractive(
        this.currentWsConfig,
        this.currentGlobalConfig,
        this._context,
        version,
      );
      // Refresh the SDK list so the newly installed toolchains appear
      try {
        this._cachedSDKList = undefined;
        this.updateContent(this.currentWsConfig, this.currentGlobalConfig);
        await this.listSDKs();
      } catch (updateError) {
        outputError("SDK Panel", `Failed to refresh panel after adding toolchains: ${String(updateError)}`);
      }
    } catch (error) {
      notifyError("SDK Install", `Failed to add toolchains: ${error}`);
    }
  }

  private async applyToolchainChanges(version: string, toAdd: string[], toRemove: string[]) {
    if (!this.currentWsConfig || !this.currentGlobalConfig) {
      notifyError("SDK", "Configuration not available");
      return;
    }

    try {
      // Uninstall first (no west context needed — filesystem only)
      if (toRemove.length > 0) {
        const { errors } = await uninstallToolchains(version, toRemove);
        if (errors.length > 0) {
          notifyError("SDK Uninstall", `Some toolchains could not be removed:\n${errors.join("\n")}`);
        }
      }

      // Install additions
      if (toAdd.length > 0) {
        await installToolchainsDirect(
          this.currentWsConfig,
          this.currentGlobalConfig,
          this._context,
          version,
          toAdd,
        );
      }
    } finally {
      // Refresh the SDK list regardless of success/failure
      try {
        this._cachedSDKList = undefined;
        this.updateContent(this.currentWsConfig, this.currentGlobalConfig);
        await this.listSDKs();
      } catch (updateError) {
        outputError("SDK Panel", `Failed to refresh panel after applying changes: ${String(updateError)}`);
      }
    }
  }

  private async fetchSDKListInBackground() {
    if (this._sdkListFetching || !this.hasValidSetupState()) {
      return;
    }
    if (!this.currentWsConfig || !this.currentGlobalConfig) {
      return;
    }

    this._sdkListFetching = true;
    try {
      const setupState = await getWestSDKContext(
        this.currentWsConfig,
        this.currentGlobalConfig,
        this._context,
      );
      if (!setupState) { return; }
      const sdkList = await listAvailableSDKs(setupState);
      this._cachedSDKList = sdkList;

      // Push to webview if still open
      this._panel.webview.postMessage({
        command: "sdkListResult",
        data: sdkList,
      });
    } catch {
      // Silently ignore background fetch failures
    } finally {
      this._sdkListFetching = false;
    }
  }

  private async listSDKs() {
    try {
      if (!this.currentWsConfig || !this.currentGlobalConfig) {
        notifyError("SDK List", "Configuration not available");
        return;
      }

      const setupState = await getWestSDKContext(
        this.currentWsConfig,
        this.currentGlobalConfig,
        this._context,
      );
      if (!setupState) {
        notifyError("SDK List", "No valid west installation found for SDK management");
        return;
      }

      const sdkList = await listAvailableSDKs(setupState);
      this._cachedSDKList = sdkList;

      this._panel.webview.postMessage({
        command: "sdkListResult",
        data: sdkList,
      });
    } catch (error) {
      notifyError("SDK List", `Failed to list SDKs: ${error}`);
      this._panel.webview.postMessage({
        command: "sdkListResult",
        data: {
          success: false,
          versions: [],
          error: `Failed to list SDKs: ${error}`,
        },
      });
    }
  }

  // ---------------------------------------------------------------------------
  // HTML Generation
  // ---------------------------------------------------------------------------

  /** Build a version→Zephyr-label lookup from the defines list (version numbers only, e.g. "0.17.4"). */
  private buildSdkVersionMap(): Record<string, string> {
    const map: Record<string, string> = {};
    for (const item of sdkVersions) {
      // Match only real semantic version labels (e.g. "1.0.1", "0.17.4").
      // Separators (kind=Separator) and special options ("latest", "automatic") are excluded.
      if (item.description && /^\d+\.\d+\.\d+/.test(item.label)) {
        map[item.label] = item.description;
      }
    }
    return map;
  }

  private getHtmlForWebview(): string {
    const nonce = generateNonce();
    const cssUri = this._panel.webview.asWebviewUri(
      vscode.Uri.joinPath(vscode.Uri.file(this._extensionPath), "src", "panels", "sdk_panel", "sdk-panel.css"),
    );
    const codiconUri = this._panel.webview.asWebviewUri(
      vscode.Uri.joinPath(vscode.Uri.file(this._extensionPath), "node_modules", "@vscode", "codicons", "dist", "codicon.css"),
    );
    const jsUri = this._panel.webview.asWebviewUri(
      vscode.Uri.joinPath(vscode.Uri.file(this._extensionPath), "dist", "webview", "sdk_panel", "sdk-panel.js"),
    );

    return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${this._panel.webview.cspSource}; font-src ${this._panel.webview.cspSource}; img-src ${this._panel.webview.cspSource} data:; script-src 'nonce-${nonce}';">
            <title>Zephyr SDK</title>
            <link rel="stylesheet" type="text/css" href="${cssUri}">
            <link rel="stylesheet" type="text/css" href="${codiconUri}" id="vscode-codicon-stylesheet">
        </head>
        <body>
            <sdk-app></sdk-app>
            <script nonce="${nonce}" src="${jsUri}"></script>
        </body>
        </html>`;
  }
}
