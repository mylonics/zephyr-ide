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
import { generateNonce } from "../webview_shared/nonce";

interface SettingDefinition {
  key: string;
  label: string;
  description: string;
  type: "boolean" | "string" | "enum";
  defaultValue: boolean | string | null;
  /** Options for enum settings — each entry has a value and a human-readable label. */
  options?: { value: string; label: string }[];
}

const SETTINGS: SettingDefinition[] = [
  {
    key: "zephyr-ide.globalDirectory",
    label: "Global Directory",
    description: "Global directory for west workspace installation and Zephyr tools. The toolchains subdirectory is used for SDK installations unless overridden.",
    type: "string",
    defaultValue: null,
  },
  {
    key: "zephyr-ide.toolchainDirectory",
    label: "Toolchain Directory",
    description: "Directory containing Zephyr SDK installations. If not specified, defaults to the toolchains subdirectory within the global directory.",
    type: "string",
    defaultValue: null,
  },
  {
    key: "zephyr-ide.venvFolder",
    label: "Virtual Environment Folder",
    description: "Python virtual environment folder path. If not specified, defaults to .venv in the workspace setup path.",
    type: "string",
    defaultValue: null,
  },
  {
    key: "zephyr-ide.useGuiConfig",
    label: "Use GUI Config",
    description: "Display GUI config instead of menu config in Project Tree View.",
    type: "boolean",
    defaultValue: false,
  },
  {
    key: "zephyr-ide.activeViewKconfigButton",
    label: "Active View Kconfig Button",
    description: "Controls what the Kconfig button in the Active Project view does.",
    type: "enum",
    defaultValue: "dashboard",
    options: [
      { value: "dashboard", label: "Open Dashboard (main page)" },
      { value: "kconfig-dashboard", label: "Open Dashboard (Kconfig page)" },
      { value: "gui-config", label: "Run GUI Config (guiconfig)" },
      { value: "menu-config", label: "Run Menu Config (menuconfig)" },
    ],
  },
  {
    key: "zephyr-ide.projectViewKconfigButton",
    label: "Project View Config Button",
    description: "Controls what the Config button in the Projects view does for a build.",
    type: "enum",
    defaultValue: "kconfig-dashboard",
    options: [
      { value: "kconfig-dashboard", label: "Open Dashboard (Kconfig page)" },
      { value: "gui-config", label: "Run GUI Config (guiconfig)" },
      { value: "menu-config", label: "Run Menu Config (menuconfig)" },
    ],
  },
  {
    key: "zephyr-ide.westNarrowUpdate",
    label: "West Narrow Update",
    description: "If enabled, uses 'west update --narrow' instead of 'west update'. Reduces disk usage and download time by fetching only required Git history.",
    type: "boolean",
    defaultValue: false,
  },
  {
    key: "zephyr-ide.westKeepDescendants",
    label: "West Keep Descendants",
    description: "If enabled, passes '--keep-descendants' to 'west update'. West will not reset a project's branch if its current HEAD is already a descendant of the manifest revision, preserving any local commits on top of it.",
    type: "boolean",
    defaultValue: false,
  },
  {
    key: "zephyr-ide.suppressWorkspaceWarning",
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
  {
    key: "zephyr-ide.buildBeforeFlash",
    label: "Build Before Flash",
    description: "Automatically build before flashing when using the 'Zephyr IDE: Flash' command. The dedicated 'Build and Flash' command always builds first regardless of this setting.",
    type: "boolean",
    defaultValue: false,
  },
  {
    key: "zephyr-ide.separateBuildDebugProfile",
    label: "Separate Build & Debug Profile",
    description: "Expose a separate 'Build & Debug' bind slot in Runner Profiles. When enabled, 'Build and Debug' and 'Debug' can each have an independent runner or launch configuration binding. When disabled (default), the single 'Debug' slot drives both actions.",
    type: "boolean",
    defaultValue: false,
  },
  {
    key: "zephyr-ide.useClangd",
    label: "Use clangd IntelliSense",
    description: "Use clangd for IntelliSense instead of the C/C++ extension. When enabled, disables C_Cpp.intelliSenseEngine and configures clangd.arguments with the Zephyr SDK query-driver. Workspace settings are applied automatically when this setting changes. Requires the clangd VS Code extension (llvm-vs-code-extensions.vscode-clangd).",
    type: "boolean",
    defaultValue: false,
  },
  {
    key: "zephyr-ide.scaVariant",
    label: "SCA Variant",
    description: "Static Code Analysis (SCA) tool enabled on pristine builds via -DZEPHYR_SCA_VARIANT. 'dtdoctor' and 'gcc' are bundled in the Zephyr SDK (no extra install). 'clang', 'sparse', and 'codechecker' are open-source tools requiring separate installation. 'coverity', 'cpptest', 'eclair', 'iar_c_stat', and 'polyspace' are commercial tools. 'custom' reads from the SCA Custom Variant setting. 'none' disables SCA.",
    type: "enum",
    defaultValue: "none",
    options: [
      { value: "dtdoctor", label: "dtdoctor (Zephyr built-in DT SCA, no install needed)" },
      { value: "gcc", label: "gcc (-fanalyzer, already in Zephyr SDK)" },
      { value: "clang", label: "clang (Clang static analyzer)" },
      { value: "sparse", label: "sparse (Sparse C semantic parser)" },
      { value: "codechecker", label: "codechecker (open-source analysis framework)" },
      { value: "coverity", label: "coverity (commercial, requires license)" },
      { value: "cpptest", label: "cpptest (Parasoft C/C++test, commercial)" },
      { value: "eclair", label: "eclair (ECLAIR, commercial)" },
      { value: "iar_c_stat", label: "iar_c_stat (IAR C-STAT, requires IAR toolchain)" },
      { value: "polyspace", label: "polyspace (MathWorks Polyspace, commercial)" },
      { value: "custom", label: "Custom (set SCA Custom Variant below)" },
      { value: "none", label: "None (disabled)" },
    ],
  },
  {
    key: "zephyr-ide.scaCustomVariant",
    label: "SCA Custom Variant",
    description: "Custom SCA variant name used when 'SCA Variant' is set to 'custom'. Must match a cmake/sca/<name>/sca.cmake entry in your Zephyr tree (e.g. 'sparse', 'codechecker').",
    type: "string",
    defaultValue: null,
  },
];

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
      "Zephyr IDE: Settings",
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

  private _htmlInitialized = false;

  private constructor(panel: vscode.WebviewPanel, extensionPath: string) {
    this._panel = panel;
    this._extensionPath = extensionPath;

    this.sendUpdate();

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
  }

  private sendUpdate() {
    if (!this._htmlInitialized) {
      this._panel.webview.html = this.getHtmlForWebview();
      this._htmlInitialized = true;
    }
    this.refreshSettings();
  }

  private refreshSettings() {
    const configuration = vscode.workspace.getConfiguration();
    const settings = SETTINGS.map((def) => {
      const inspected = configuration.inspect(def.key);
      let currentValue = configuration.get(def.key);
      let scope: "default" | "user" | "workspace" = "default";
      let userValue: boolean | string | null | undefined = undefined;
      let workspaceValue: boolean | string | null | undefined = undefined;

      if (inspected) {
        userValue = inspected.globalValue as typeof userValue;
        workspaceValue = inspected.workspaceValue as typeof workspaceValue;

        if (workspaceValue !== undefined) {
          scope = "workspace";
          currentValue = workspaceValue;
        } else if (userValue !== undefined) {
          scope = "user";
          currentValue = userValue;
        }
      }

      return {
        key: def.key,
        label: def.label,
        description: def.description,
        type: def.type,
        defaultValue: def.defaultValue,
        options: def.options ?? null,
        currentValue: currentValue ?? def.defaultValue,
        scope,
        userValue: userValue ?? null,
        workspaceValue: workspaceValue ?? null,
        hasUserValue: userValue !== undefined,
        hasWorkspaceValue: workspaceValue !== undefined,
      };
    });

    this._panel.webview.postMessage({ command: "updateSettings", settings });
    this.refreshVariants();
  }

  /** Stub: variants are being replaced by Runner Profiles; the editor is gone. */
  private refreshVariants() {
    this._panel.webview.postMessage({
      command: "updateVariants",
      catalogue: {
        user: [],
        workspace: [],
        referencedNames: [],
        hasWorkspace: false,
      },
      knownRunners: [],
    });
  }

  private async handleWebviewMessage(message: Record<string, any>) {
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
      case "openSetupPanel": {
        await vscode.commands.executeCommand("zephyr-ide.open-setup-panel");
        break;
      }
      case "ready": {
        this.refreshSettings();
        break;
      }

      // Variant editor removed — Runner Profile editor coming in Phase 4.
      case "addVariant":
      case "updateVariant":
      case "removeVariant":
        break;
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
        "dist",
        "webview",
        "settings_view",
        "settings-panel.js"
      )
    );

    return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${this._panel.webview.cspSource}; font-src ${this._panel.webview.cspSource}; img-src ${this._panel.webview.cspSource} data:; script-src 'nonce-${nonce}';">
        <title>Zephyr IDE Settings</title>
        <link rel="stylesheet" type="text/css" href="${cssUri}">
    </head>
    <body>
        <settings-app></settings-app>
        <script nonce="${nonce}" src="${jsUri}"></script>
    </body>
    </html>`;
  }

}
