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

import * as path from "upath";
import * as fs from "fs-extra";
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
  ): DashboardPanel {
    const { projectName, buildName } = data.meta;
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
    } else if (message?.command === "openMemorySymbol") {
      await this._openSymbolFile(
        typeof message.path === "string" ? message.path : "",
        typeof message.line === "number" ? message.line : undefined,
      );
    }
  }

  /**
   * Converts POSIX-style absolute paths from cross-compiler build environments
   * into Windows paths.
   *   /c/Users/...     -> C:/Users/... (MSYS2 / MinGW drive-letter shorthand)
   *   /mnt/c/Users/... -> C:/Users/... (WSL mount)
   */
  private static _toWindowsPath(p: string): string | undefined {
    const wsl = p.match(/^\/mnt\/([a-zA-Z])\/(.*)/);
    if (wsl) { return `${wsl[1].toUpperCase()}:/${wsl[2]}`; }
    const msys = p.match(/^\/([a-zA-Z])\/(.*)/);
    if (msys) { return `${msys[1].toUpperCase()}:/${msys[2]}`; }
    return undefined;
  }

  /**
   * Best-effort resolves a symbol path string from the memory report and
   * opens it in the editor.  Probes (in order):
   *   - POSIX cross-compiler path converted to Windows (MSYS2 / WSL)
   *   - the path as-is if absolute
   *   - relative to the build folder (summary.outputDir)
   *   - relative to APPLICATION_SOURCE_DIR (app source root)
   *   - relative to each workspace folder
   * Shows an info message on miss.
   */
  private async _openSymbolFile(symbolPath: string, line?: number): Promise<void> {
    if (!symbolPath) { return; }
    // Strip ":line" suffix if embedded (Zephyr identifiers may use "file.c:42").
    let resolvedLine = line;
    let p = symbolPath;
    const m = p.match(/^(.*):(\d+)$/);
    if (m) {
      p = m[1];
      if (resolvedLine === undefined) { resolvedLine = parseInt(m[2], 10); }
    }

    const candidates: string[] = [];

    // On Windows, DWARF paths from cross-compilers (arm-zephyr-eabi built via
    // MSYS2) are POSIX-style (/c/Users/...) or WSL-style (/mnt/c/Users/...).
    // Convert them to usable Windows paths before falling back to others.
    const winEquiv = DashboardPanel._toWindowsPath(p);
    if (winEquiv) { candidates.push(winEquiv); }

    if (path.isAbsolute(p)) { candidates.push(p); }
    const buildFolder = this._data.summary.outputDir;
    if (buildFolder) {
      candidates.push(path.join(buildFolder, p));
      candidates.push(path.join(buildFolder, "..", p));
    }
    // APPLICATION_SOURCE_DIR from CMake — the actual project source tree root.
    const appDir = this._data.summary.application;
    if (appDir) {
      candidates.push(path.join(appDir, p));
      candidates.push(path.join(appDir, "..", p));
    }
    for (const ws of vscode.workspace.workspaceFolders ?? []) {
      candidates.push(path.join(ws.uri.fsPath, p));
    }
    // ZEPHYR_BASE from the CMake cache — reliable even when the env var is not
    // set (e.g. VS Code opened from Start menu rather than a shell).  Only
    // useful for RELATIVE paths; absolute paths are already handled above.
    const zephyrBase = this._data.summary.zephyrBase ?? process.env["ZEPHYR_BASE"];
    if (zephyrBase && !path.isAbsolute(p)) {
      candidates.push(path.join(zephyrBase, p));
    }

    for (const candidate of candidates) {
      try {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          const uri = vscode.Uri.file(candidate);
          const opts: vscode.TextDocumentShowOptions = {};
          if (resolvedLine !== undefined && resolvedLine > 0) {
            const pos = new vscode.Position(Math.max(0, resolvedLine - 1), 0);
            opts.selection = new vscode.Range(pos, pos);
          }
          await vscode.window.showTextDocument(uri, opts);
          return;
        }
      } catch { /* keep trying */ }
    }
    void vscode.window.showInformationMessage(
      `Zephyr IDE: could not locate source file for symbol: ${symbolPath}`,
    );
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
    } catch (err) {
      await this._panel.webview.postMessage({
        command: "memoryRefreshFailed",
        error: err instanceof Error ? err.message : "Memory refresh failed unexpectedly.",
      });
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
