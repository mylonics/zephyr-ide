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
import { generateNonce } from "../webview_shared/webviewTypes";

interface SettingDefinition {
  key: string;
  label: string;
  description: string;
  type: "boolean" | "string";
  defaultValue: boolean | string | null;
}

const SETTINGS: SettingDefinition[] = [
  {
    key: "zephyr-ide.global_directory",
    label: "Global Directory",
    description: "Global directory for west workspace installation and Zephyr tools. The toolchains subdirectory is used for SDK installations unless overridden.",
    type: "string",
    defaultValue: null,
  },
  {
    key: "zephyr-ide.toolchain_directory",
    label: "Toolchain Directory",
    description: "Directory containing Zephyr SDK installations. If not specified, defaults to the toolchains subdirectory within the global directory.",
    type: "string",
    defaultValue: null,
  },
  {
    key: "zephyr-ide.venv-folder",
    label: "Virtual Environment Folder",
    description: "Python virtual environment folder path. If not specified, defaults to .venv in the workspace setup path.",
    type: "string",
    defaultValue: null,
  },
  {
    key: "zephyr-ide.use_gui_config",
    label: "Use GUI Config",
    description: "Display GUI config instead of menu config in Project Tree View.",
    type: "boolean",
    defaultValue: false,
  },
  {
    key: "zephyr-ide.westNarrowUpdate",
    label: "West Narrow Update",
    description: "If enabled, uses 'west update --narrow' instead of 'west update'.",
    type: "boolean",
    defaultValue: false,
  },
  {
    key: "zephyr-ide.suppress-workspace-warning",
    label: "Suppress Workspace Warning",
    description: "Suppress the warning about missing workspace environment variables (ZEPHYR_BASE, ZEPHYR_SDK_INSTALL_DIR).",
    type: "boolean",
    defaultValue: false,
  },
  {
    key: "zephyr-ide.automaticProjectSelection",
    label: "Automatic Project Selection",
    description: "Automatically switch the active project when the editor focus changes to a file belonging to a different project.",
    type: "boolean",
    defaultValue: true,
  },
];

function escapeHtml(str: string | null | undefined): string {
  if (!str) { return ""; }
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export class SettingsPanel {
  public static currentPanel: SettingsPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionPath: string;
  private _disposables: vscode.Disposable[] = [];

  public static createOrShow(extensionPath: string) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (SettingsPanel.currentPanel) {
      SettingsPanel.currentPanel._panel.reveal(column);
      SettingsPanel.currentPanel.refreshSettings();
      return SettingsPanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      "zephyrIDESettings",
      "Zephyr IDE Settings",
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.file(extensionPath)],
        retainContextWhenHidden: true,
      }
    );

    SettingsPanel.currentPanel = new SettingsPanel(panel, extensionPath);
    return SettingsPanel.currentPanel;
  }

  private constructor(panel: vscode.WebviewPanel, extensionPath: string) {
    this._panel = panel;
    this._extensionPath = extensionPath;

    this._panel.webview.html = this.getHtmlForWebview();

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      (message) => { this.handleWebviewMessage(message); },
      null,
      this._disposables,
    );

    // Auto-refresh when settings change externally
    this._disposables.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("zephyr-ide")) {
          this.refreshSettings();
        }
      })
    );

    // Send initial setting values
    this.refreshSettings();
  }

  private refreshSettings() {
    const configuration = vscode.workspace.getConfiguration();
    const settings = SETTINGS.map((def) => {
      const inspected = configuration.inspect(def.key);
      let currentValue = configuration.get(def.key);
      let scope: "default" | "user" | "workspace" = "default";

      if (inspected) {
        if (inspected.workspaceValue !== undefined) {
          scope = "workspace";
          currentValue = inspected.workspaceValue;
        } else if (inspected.globalValue !== undefined) {
          scope = "user";
          currentValue = inspected.globalValue;
        }
      }

      return {
        key: def.key,
        label: def.label,
        description: def.description,
        type: def.type,
        defaultValue: def.defaultValue,
        currentValue: currentValue ?? def.defaultValue,
        scope,
      };
    });

    this._panel.webview.postMessage({ command: "updateSettings", settings });
  }

  private async handleWebviewMessage(message: any) {
    switch (message.command) {
      case "updateSetting": {
        const { key, value, scope } = message;
        const target = scope === "workspace"
          ? vscode.ConfigurationTarget.Workspace
          : vscode.ConfigurationTarget.Global;
        const configuration = vscode.workspace.getConfiguration();
        await configuration.update(key, value, target);
        this.refreshSettings();
        break;
      }
      case "resetSetting": {
        const { key } = message;
        const configuration = vscode.workspace.getConfiguration();
        // Remove from both scopes
        await configuration.update(key, undefined, vscode.ConfigurationTarget.Workspace);
        await configuration.update(key, undefined, vscode.ConfigurationTarget.Global);
        this.refreshSettings();
        break;
      }
      case "openVsCodeSettings": {
        await vscode.commands.executeCommand(
          "workbench.action.openSettings",
          "@ext:mylonics.zephyr-ide"
        );
        break;
      }
      case "browseFolder": {
        const { key } = message;
        const result = await vscode.window.showOpenDialog({
          canSelectFolders: true,
          canSelectFiles: false,
          canSelectMany: false,
          openLabel: "Select Folder",
        });
        if (result && result[0]) {
          this._panel.webview.postMessage({
            command: "folderSelected",
            key,
            path: result[0].fsPath,
          });
        }
        break;
      }
    }
  }

  public dispose() {
    SettingsPanel.currentPanel = undefined;
    this._panel.dispose();

    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }

  private getHtmlForWebview(): string {
    const nonce = generateNonce();
    const cssUri = this._panel.webview.asWebviewUri(
      vscode.Uri.joinPath(
        vscode.Uri.file(this._extensionPath),
        "src",
        "panels",
        "settings_view",
        "settings-panel.css"
      )
    );

    const jsUri = this._panel.webview.asWebviewUri(
      vscode.Uri.joinPath(
        vscode.Uri.file(this._extensionPath),
        "src",
        "panels",
        "settings_view",
        "settings-panel.js"
      )
    );

    const dirSettings = SETTINGS.filter(s => s.type === "string");
    const boolSettings = SETTINGS.filter(s => s.type === "boolean");

    const renderStringSetting = (def: SettingDefinition) => `
      <div class="setting-row" data-key="${escapeHtml(def.key)}" data-type="string">
        <div class="setting-header">
          <div class="setting-label">${escapeHtml(def.label)}</div>
          <div class="setting-scope-badge" id="scope-${escapeHtml(def.key)}">default</div>
        </div>
        <div class="setting-description">${escapeHtml(def.description)}</div>
        <div class="setting-controls">
          <div class="input-group">
            <input type="text" class="setting-input" id="val-${escapeHtml(def.key)}"
              placeholder="Not set (using default)"
              data-action="string-change"
              data-key="${escapeHtml(def.key)}">
            <button class="browse-button" data-action="browse" data-key="${escapeHtml(def.key)}" title="Browse for folder">📁</button>
          </div>
          <select class="scope-select" id="target-${escapeHtml(def.key)}" data-action="scope-change" data-key="${escapeHtml(def.key)}">
            <option value="workspace">Workspace</option>
            <option value="user">User</option>
          </select>
          <button class="reset-button" id="reset-${escapeHtml(def.key)}" data-action="reset" data-key="${escapeHtml(def.key)}" title="Reset to default">↺ Reset</button>
        </div>
      </div>`;

    const renderBoolSetting = (def: SettingDefinition) => `
      <div class="setting-row" data-key="${escapeHtml(def.key)}" data-type="boolean">
        <div class="setting-header">
          <div class="setting-label">${escapeHtml(def.label)}</div>
          <div class="setting-scope-badge" id="scope-${escapeHtml(def.key)}">default</div>
        </div>
        <div class="setting-description">${escapeHtml(def.description)}</div>
        <div class="setting-controls">
          <label class="toggle-switch">
            <input type="checkbox" id="val-${escapeHtml(def.key)}" data-action="toggle-change" data-key="${escapeHtml(def.key)}">
            <span class="toggle-slider"></span>
          </label>
          <select class="scope-select" id="target-${escapeHtml(def.key)}" data-action="scope-change" data-key="${escapeHtml(def.key)}">
            <option value="workspace">Workspace</option>
            <option value="user">User</option>
          </select>
          <button class="reset-button" id="reset-${escapeHtml(def.key)}" data-action="reset" data-key="${escapeHtml(def.key)}" title="Reset to default">↺ Reset</button>
        </div>
      </div>`;

    return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${this._panel.webview.cspSource}; img-src ${this._panel.webview.cspSource} data:; script-src 'nonce-${nonce}';">
        <title>Zephyr IDE Settings</title>
        <link rel="stylesheet" type="text/css" href="${cssUri}">
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>⚙️ Zephyr IDE Settings</h1>
                <button class="open-vscode-settings-button" data-action="open-vscode-settings">
                    Open in VS Code Settings
                </button>
            </div>

            <div class="info-box">
                <p>Configure Zephyr IDE extension settings. Changes are saved automatically.
                Use the scope selector to choose whether a setting applies to this workspace only or to all workspaces (User).</p>
            </div>

            <h2>📁 Directory Settings</h2>
            <div class="settings-group">
                ${dirSettings.map(renderStringSetting).join("\n")}
            </div>

            <h2>🔧 Behavior Settings</h2>
            <div class="settings-group">
                ${boolSettings.map(renderBoolSetting).join("\n")}
            </div>
        </div>
        <script nonce="${nonce}" src="${jsUri}"></script>
    </body>
    </html>`;
  }

}
