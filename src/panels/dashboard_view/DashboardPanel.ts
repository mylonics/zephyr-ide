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
import * as fs from "fs-extra";

import type { DashboardData } from "./dashboard-data";
import { generateNonce } from "../webview_shared/nonce";

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
  private readonly _projectName: string;
  private readonly _buildName: string;
  private _jsonPath: string;
  private _disposables: vscode.Disposable[] = [];
  private _htmlInitialized = false;

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  public static createOrShow(
    extensionPath: string,
    jsonPath: string,
    projectName: string,
    buildName: string,
  ) {
    const key = `${projectName}/${buildName}`;
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : vscode.ViewColumn.One;

    const existing = DashboardPanel._panels.get(key);
    if (existing) {
      existing._panel.reveal(column);
      existing._jsonPath = jsonPath;
      void existing.refresh();
      return;
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

    const instance = new DashboardPanel(panel, extensionPath, jsonPath, projectName, buildName);
    DashboardPanel._panels.set(key, instance);
  }

  // ---------------------------------------------------------------------------
  // Private implementation
  // ---------------------------------------------------------------------------

  private constructor(
    panel: vscode.WebviewPanel,
    extensionPath: string,
    jsonPath: string,
    projectName: string,
    buildName: string,
  ) {
    this._panel = panel;
    this._extensionPath = extensionPath;
    this._jsonPath = jsonPath;
    this._projectName = projectName;
    this._buildName = buildName;

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    this._panel.webview.onDidReceiveMessage(
      (message) => { void this.handleMessage(message); },
      null,
      this._disposables,
    );

    this._panel.webview.html = this.getHtmlShell();
    this._htmlInitialized = true;
    void this.refresh();
  }

  private async handleMessage(message: Record<string, unknown>) {
    if (message?.command === "ready") {
      await this.refresh();
    }
  }

  private async refresh() {
    if (!this._htmlInitialized) {
      return;
    }
    try {
      if (!fs.existsSync(this._jsonPath)) {
        await this._panel.webview.postMessage({
          command: "error",
          message: `Dashboard JSON not found: ${this._jsonPath}`,
        });
        return;
      }
      const raw = await fs.readFile(this._jsonPath, "utf8");
      const parsed = JSON.parse(raw) as Omit<DashboardData, "meta">;
      const data: DashboardData = {
        ...parsed,
        meta: {
          projectName: this._projectName,
          buildName: this._buildName,
          generatedAt: new Date().toISOString(),
        },
      };
      await this._panel.webview.postMessage({ command: "updateContent", data });
    } catch (err) {
      await this._panel.webview.postMessage({
        command: "error",
        message: `Failed to load dashboard data: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
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
