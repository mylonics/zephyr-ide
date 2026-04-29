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

import type { DashboardData, DashboardMemoryRefresh } from "./dashboard-data";
import { generateNonce } from "../webview_shared/nonce";

/** Callback invoked when the user requests a memory report refresh. */
type MemoryRefreshCallback = () => Promise<(DashboardMemoryRefresh & { error?: string }) | undefined>;

/**
 * VS Code webview panel that displays the Zephyr build dashboard natively.
 * Data is produced by `resources/zephyr_dashboard_json.py` and read from a
 * JSON file on disk; no upstream HTML is loaded.  One panel is opened per
 * project/build pair.
 */
export class DashboardPanel {
  private static readonly _panels: Map<string, DashboardPanel> = new Map();

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionPath: string;
  private _data: DashboardData;
  private readonly _onRefreshMemory: MemoryRefreshCallback;
  private _memoryRefreshing = false;
  private _disposables: vscode.Disposable[] = [];

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Returns the open panel for the given project/build pair, if any. */
  public static getPanel(projectName: string, buildName: string): DashboardPanel | undefined {
    return DashboardPanel._panels.get(`${projectName}/${buildName}`);
  }

  public static createOrShow(
    extensionPath: string,
    data: DashboardData,
    onRefreshMemory: MemoryRefreshCallback,
  ): DashboardPanel {    const { projectName, buildName } = data.meta;
    const key = `${projectName}/${buildName}`;
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : vscode.ViewColumn.One;

    const existing = DashboardPanel._panels.get(key);
    if (existing) {
      existing._panel.reveal(column);
      existing._data = data;
      void existing._postData();
      return existing;
    }

    const panel = vscode.window.createWebviewPanel(
      "zephyrIDEDashboard",
      `Dashboard: ${projectName} / ${buildName}`,
      column ?? vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.file(extensionPath)],
      },
    );

    const instance = new DashboardPanel(panel, extensionPath, data, onRefreshMemory);
    DashboardPanel._panels.set(key, instance);
    return instance;
  }

  // ---------------------------------------------------------------------------
  // Private implementation
  // ---------------------------------------------------------------------------

  private constructor(
    panel: vscode.WebviewPanel,
    extensionPath: string,
    data: DashboardData,
    onRefreshMemory: MemoryRefreshCallback,
  ) {
    this._panel = panel;
    this._extensionPath = extensionPath;
    this._data = data;
    this._onRefreshMemory = onRefreshMemory;

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    this._panel.webview.onDidReceiveMessage(
      (message) => { void this.handleMessage(message); },
      null,
      this._disposables,
    );

    this._panel.webview.html = this.getHtmlShell();
    void this._postData();
  }

  private async handleMessage(message: Record<string, unknown>) {
    if (message?.command === "ready") {
      await this._postData();
    } else if (message?.command === "refreshMemory") {
      await this.refreshMemory();
    }
  }

  /**
   * Triggers a memory report refresh via the stored callback and pushes the
   * updated memory data to the webview.  Safe to call concurrently — a second
   * call while a refresh is in-progress is a no-op.
   */
  public async refreshMemory(): Promise<void> {
    if (this._memoryRefreshing) { return; }
    this._memoryRefreshing = true;
    await this._panel.webview.postMessage({ command: "memoryRefreshing" });
    try {
      const result = await this._onRefreshMemory();
      if (result) {
        this._data.memory = result.memory;
        this._data.summary.memorySummary = result.memorySummary;
        await this._panel.webview.postMessage({
          command: "updateMemory",
          memory: result.memory,
          memorySummary: result.memorySummary,
          error: result.error,
        });
      } else {
        await this._panel.webview.postMessage({
          command: "memoryRefreshFailed",
          error: "Memory refresh could not start. Check Zephyr IDE setup.",
        });
      }
    } finally {
      this._memoryRefreshing = false;
    }
  }

  private async _postData(): Promise<void> {
    await this._panel.webview.postMessage({ command: "updateContent", data: this._data });
  }

  private getHtmlShell(): string {
    const nonce = generateNonce();
    const cssUri = this._panel.webview.asWebviewUri(
      vscode.Uri.joinPath(
        vscode.Uri.file(this._extensionPath),
        "src",
        "panels",
        "dashboard_view",
        "dashboard-panel.css",
      ),
    );
    const codiconUri = this._panel.webview.asWebviewUri(
      vscode.Uri.joinPath(
        vscode.Uri.file(this._extensionPath),
        "node_modules",
        "@vscode",
        "codicons",
        "dist",
        "codicon.css",
      ),
    );
    const jsUri = this._panel.webview.asWebviewUri(
      vscode.Uri.joinPath(
        vscode.Uri.file(this._extensionPath),
        "dist",
        "webview",
        "dashboard_view",
        "dashboard-panel.js",
      ),
    );
    const cspSource = this._panel.webview.cspSource;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; font-src ${cspSource}; img-src ${cspSource} data:; script-src 'nonce-${nonce}';">
  <title>Zephyr IDE Dashboard</title>
  <link rel="stylesheet" type="text/css" href="${cssUri}">
  <link rel="stylesheet" type="text/css" href="${codiconUri}" id="vscode-codicon-stylesheet">
</head>
<body>
  <dashboard-app></dashboard-app>
  <script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
  }

  public dispose() {
    for (const [key, panel] of DashboardPanel._panels.entries()) {
      if (panel === this) {
        DashboardPanel._panels.delete(key);
        break;
      }
    }
    this._panel.dispose();
    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) { x.dispose(); }
    }
  }
}
