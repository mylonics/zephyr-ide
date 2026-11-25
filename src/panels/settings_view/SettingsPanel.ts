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

import { webviewMessages } from "../webview-messages";
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
  /** Set for string settings that represent a filesystem folder, to show a Browse button. */
  pathType?: "folder";
}

const SETTINGS: SettingDefinition[] = [
  {
    key: "zephyr-ide.toolchainDirectory",
    label: vscode.l10n.t("Toolchain Directory"),
    description: vscode.l10n.t("Manually specify the directory containing Zephyr SDK installations (e.g., containing zephyr-sdk-0.17.0, zephyr-sdk-0.17.3 subdirectories). If not specified, defaults to the toolchains subdirectory within the tools directory."),
    type: "string",
    defaultValue: null,
    pathType: "folder",
  },
  {
    key: "zephyr-ide.venvFolder",
    label: vscode.l10n.t("Virtual Environment Folder"),
    description: vscode.l10n.t("Python virtual environment folder path. If not specified, defaults to .venv in the workspace setup path."),
    type: "string",
    defaultValue: null,
    pathType: "folder",
  },
  {
    key: "zephyr-ide.activeViewKconfigButton",
    label: vscode.l10n.t("Active View Kconfig Button"),
    description: vscode.l10n.t("Controls what the Kconfig button in the Active Project view does."),
    type: "enum",
    defaultValue: "dashboard",
    options: [
      { value: "dashboard", label: vscode.l10n.t("Open Dashboard (main page)") },
      { value: "kconfig-dashboard", label: vscode.l10n.t("Open Dashboard (Kconfig page)") },
      { value: "gui-config", label: vscode.l10n.t("Run GUI Config (guiconfig)") },
      { value: "menu-config", label: vscode.l10n.t("Run Menu Config (menuconfig)") },
    ],
  },
  {
    key: "zephyr-ide.projectViewKconfigButton",
    label: vscode.l10n.t("Project View Config Button"),
    description: vscode.l10n.t("Controls what the Config button in the Projects view does for a build."),
    type: "enum",
    defaultValue: "kconfig-dashboard",
    options: [
      { value: "kconfig-dashboard", label: vscode.l10n.t("Open Dashboard (Kconfig page)") },
      { value: "gui-config", label: vscode.l10n.t("Run GUI Config (guiconfig)") },
      { value: "menu-config", label: vscode.l10n.t("Run Menu Config (menuconfig)") },
    ],
  },
  {
    key: "zephyr-ide.westNarrowUpdate",
    label: vscode.l10n.t("West Narrow Update"),
    description: vscode.l10n.t("If enabled, uses 'west update --narrow' instead of 'west update'. Reduces disk usage and download time by fetching only required Git history."),
    type: "boolean",
    defaultValue: false,
  },
  {
    key: "zephyr-ide.westKeepDescendants",
    label: vscode.l10n.t("West Keep Descendants"),
    description: vscode.l10n.t("If enabled, passes '--keep-descendants' to 'west update'. West will not reset a project's branch if its current HEAD is already a descendant of the manifest revision, preserving any local commits on top of it."),
    type: "boolean",
    defaultValue: false,
  },
  {
    key: "zephyr-ide.westZephyrExport",
    label: vscode.l10n.t("West Zephyr Export"),
    description: vscode.l10n.t("If enabled, runs 'west zephyr-export' after a successful west update. This registers the Zephyr CMake package so that out-of-tree applications can find Zephyr with 'find_package(Zephyr)'."),
    type: "boolean",
    defaultValue: false,
  },
  {
    key: "zephyr-ide.suppressWorkspaceWarning",
    label: vscode.l10n.t("Suppress Workspace Warning"),
    description: vscode.l10n.t("Suppress the warning about missing workspace environment variables (ZEPHYR_BASE, ZEPHYR_SDK_INSTALL_DIR)."),
    type: "boolean",
    defaultValue: false,
  },
  {
    key: "zephyr-ide.disableZephyrBaseInjection",
    label: vscode.l10n.t("Disable ZEPHYR_BASE Injection"),
    description: vscode.l10n.t("Disable Zephyr IDE's automatic injection of the ZEPHYR_BASE environment variable into terminals, tasks, and build/debug processes. Enable this if you manage ZEPHYR_BASE yourself."),
    type: "boolean",
    defaultValue: false,
  },
  {
    key: "zephyr-ide.zephyrBaseOverride",
    label: vscode.l10n.t("ZEPHYR_BASE Override"),
    description: vscode.l10n.t("Absolute or workspace-root-relative path to a Zephyr base directory. When set, overrides the ZEPHYR_BASE value Zephyr IDE would otherwise inject into terminals, tasks, and build/debug processes. It does not change which Zephyr tree Zephyr IDE itself scans for boards, samples, DTS bindings, or Python requirements. Ignored when 'Disable ZEPHYR_BASE Injection' is enabled."),
    type: "string",
    defaultValue: null,
    pathType: "folder",
  },
  {
    key: "zephyr-ide.automaticProjectSelection",
    label: vscode.l10n.t("Automatic Project Selection"),
    description: vscode.l10n.t("Automatically switch the active project when the editor focus changes to a file belonging to a different project."),
    type: "boolean",
    defaultValue: true,
  },
  {
    key: "zephyr-ide.buildBeforeFlash",
    label: vscode.l10n.t("Build Before Flash"),
    description: vscode.l10n.t("Automatically build before flashing when using the 'Zephyr IDE: Flash' command. The dedicated 'Build and Flash' command always builds first regardless of this setting."),
    type: "boolean",
    defaultValue: false,
  },
  {
    key: "zephyr-ide.statusBar.showBuildPristine",
    label: vscode.l10n.t("Status Bar: Show Build Pristine"),
    description: vscode.l10n.t("Show the 'Build Pristine' button in the status bar. Requires restart to take effect."),
    type: "boolean",
    defaultValue: true,
  },
  {
    key: "zephyr-ide.statusBar.showBuild",
    label: vscode.l10n.t("Status Bar: Show Build"),
    description: vscode.l10n.t("Show the 'Build' button in the status bar. Requires restart to take effect."),
    type: "boolean",
    defaultValue: true,
  },
  {
    key: "zephyr-ide.statusBar.showFlash",
    label: vscode.l10n.t("Status Bar: Show Flash"),
    description: vscode.l10n.t("Show the 'Flash' button in the status bar. Requires restart to take effect."),
    type: "boolean",
    defaultValue: false,
  },
  {
    key: "zephyr-ide.statusBar.showBuildFlash",
    label: vscode.l10n.t("Status Bar: Show Build and Flash"),
    description: vscode.l10n.t("Show the 'Build and Flash' button in the status bar. Requires restart to take effect."),
    type: "boolean",
    defaultValue: true,
  },
  {
    key: "zephyr-ide.statusBar.showDebug",
    label: vscode.l10n.t("Status Bar: Show Debug"),
    description: vscode.l10n.t("Show the 'Debug' button in the status bar. Requires restart to take effect."),
    type: "boolean",
    defaultValue: false,
  },
  {
    key: "zephyr-ide.statusBar.showBuildDebug",
    label: vscode.l10n.t("Status Bar: Show Build and Debug"),
    description: vscode.l10n.t("Show the 'Build and Debug' button in the status bar. Requires restart to take effect."),
    type: "boolean",
    defaultValue: true,
  },
  {
    key: "zephyr-ide.activeProjectPanel.showBuild",
    label: vscode.l10n.t("Active Project Panel: Show Build"),
    description: vscode.l10n.t("Show the 'Build' button in the Active Project panel."),
    type: "boolean",
    defaultValue: true,
  },
  {
    key: "zephyr-ide.activeProjectPanel.showBuildPristine",
    label: vscode.l10n.t("Active Project Panel: Show Build Pristine"),
    description: vscode.l10n.t("Show the 'Build Pristine' button in the Active Project panel."),
    type: "boolean",
    defaultValue: false,
  },
  {
    key: "zephyr-ide.activeProjectPanel.showFlash",
    label: vscode.l10n.t("Active Project Panel: Show Flash"),
    description: vscode.l10n.t("Show the 'Flash' button in the Active Project panel."),
    type: "boolean",
    defaultValue: true,
  },
  {
    key: "zephyr-ide.activeProjectPanel.showBuildFlash",
    label: vscode.l10n.t("Active Project Panel: Show Build and Flash"),
    description: vscode.l10n.t("Show the 'Build and Flash' button in the Active Project panel."),
    type: "boolean",
    defaultValue: false,
  },
  {
    key: "zephyr-ide.activeProjectPanel.showBuildDebug",
    label: vscode.l10n.t("Active Project Panel: Show Build and Debug"),
    description: vscode.l10n.t("Show the 'Build and Debug' button in the Active Project panel."),
    type: "boolean",
    defaultValue: false,
  },
  {
    key: "zephyr-ide.activeProjectPanel.showDebug",
    label: vscode.l10n.t("Active Project Panel: Show Debug"),
    description: vscode.l10n.t("Show the 'Debug' button in the Active Project panel."),
    type: "boolean",
    defaultValue: true,
  },
  {
    key: "zephyr-ide.activeProjectPanel.showAttach",
    label: vscode.l10n.t("Active Project Panel: Show Attach"),
    description: vscode.l10n.t("Show the 'Attach' button in the Active Project panel."),
    type: "boolean",
    defaultValue: true,
  },
  {
    key: "zephyr-ide.activeProjectPanel.showBuildDashboard",
    label: vscode.l10n.t("Active Project Panel: Show Build Dashboard"),
    description: vscode.l10n.t("Show the 'Build Dashboard' button at the bottom of the Active Project panel. When shown, the Kconfig button is hidden from Build and Build Pristine rows."),
    type: "boolean",
    defaultValue: true,
  },
  {
    key: "zephyr-ide.separateBuildDebugProfile",
    label: vscode.l10n.t("Separate Build & Debug Profile"),
    description: vscode.l10n.t("Expose a separate 'Build & Debug' bind slot in Runner Profiles. When enabled, 'Build and Debug' and 'Debug' can each have an independent runner or launch configuration binding. When disabled (default), the single 'Debug' slot drives both actions."),
    type: "boolean",
    defaultValue: false,
  },
  {
    key: "zephyr-ide.useClangd",
    label: vscode.l10n.t("Use clangd IntelliSense"),
    description: vscode.l10n.t("Use clangd for IntelliSense instead of the C/C++ extension. When enabled, disables C_Cpp.intelliSenseEngine and configures clangd.arguments with the Zephyr SDK query-driver. Workspace settings are applied automatically when this setting changes. Requires the clangd VS Code extension (llvm-vs-code-extensions.vscode-clangd)."),
    type: "boolean",
    defaultValue: false,
  },
  {
    key: "zephyr-ide.compileCommandsMode",
    label: vscode.l10n.t("Compile Commands Mode"),
    description: vscode.l10n.t("Controls which build compile_commands.json files are merged into .vscode/compile_commands.json: the active build only, all builds in the active project, or all builds in the workspace."),
    type: "enum",
    defaultValue: "all",
    options: [
      { value: "active", label: vscode.l10n.t("Active build only") },
      { value: "project", label: vscode.l10n.t("All builds in active project") },
      { value: "all", label: vscode.l10n.t("All workspace builds (default)") },
    ],
  },
  {
    key: "zephyr-ide.scaVariant",
    label: vscode.l10n.t("SCA Variant"),
    description: vscode.l10n.t("Static Code Analysis (SCA) tool enabled on pristine builds via -DZEPHYR_SCA_VARIANT. 'dtdoctor' and 'gcc' are bundled in the Zephyr SDK (no extra install). 'clang', 'sparse', and 'codechecker' are open-source tools requiring separate installation. 'coverity', 'cpptest', 'eclair', 'iar_c_stat', and 'polyspace' are commercial tools. 'custom' reads from the SCA Custom Variant setting. 'none' disables SCA."),
    type: "enum",
    defaultValue: "none",
    options: [
      { value: "dtdoctor", label: vscode.l10n.t("dtdoctor (Zephyr built-in DT SCA, no install needed)") },
      { value: "gcc", label: vscode.l10n.t("gcc (-fanalyzer, already in Zephyr SDK)") },
      { value: "clang", label: vscode.l10n.t("clang (Clang static analyzer)") },
      { value: "sparse", label: vscode.l10n.t("sparse (Sparse C semantic parser)") },
      { value: "codechecker", label: vscode.l10n.t("codechecker (open-source analysis framework)") },
      { value: "coverity", label: vscode.l10n.t("coverity (commercial, requires license)") },
      { value: "cpptest", label: vscode.l10n.t("cpptest (Parasoft C/C++test, commercial)") },
      { value: "eclair", label: vscode.l10n.t("eclair (ECLAIR, commercial)") },
      { value: "iar_c_stat", label: vscode.l10n.t("iar_c_stat (IAR C-STAT, requires IAR toolchain)") },
      { value: "polyspace", label: vscode.l10n.t("polyspace (MathWorks Polyspace, commercial)") },
      { value: "custom", label: vscode.l10n.t("Custom (set SCA Custom Variant below)") },
      { value: "none", label: vscode.l10n.t("None (disabled)") },
    ],
  },
  {
    key: "zephyr-ide.scaCustomVariant",
    label: vscode.l10n.t("SCA Custom Variant"),
    description: vscode.l10n.t("Custom SCA variant name used when 'SCA Variant' is set to 'custom'. Must match a cmake/sca/<name>/sca.cmake entry in your Zephyr tree (e.g. 'sparse', 'codechecker')."),
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
      vscode.l10n.t("Zephyr IDE: Settings"),
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
        pathType: def.pathType ?? null,
        currentValue: currentValue ?? def.defaultValue,
        scope,
        userValue: userValue ?? null,
        workspaceValue: workspaceValue ?? null,
        hasUserValue: userValue !== undefined,
        hasWorkspaceValue: workspaceValue !== undefined,
      };
    });

    this._panel.webview.postMessage({ command: "updateSettings", settings });
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
          openLabel: vscode.l10n.t("Select Folder"),
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
    <html lang="${vscode.env.language}">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${this._panel.webview.cspSource}; font-src ${this._panel.webview.cspSource}; img-src ${this._panel.webview.cspSource} data:; script-src 'nonce-${nonce}';">
        <title>Zephyr IDE Settings</title>
        <link rel="stylesheet" type="text/css" href="${cssUri}">
    </head>
    <body>
      ${webviewMessages(nonce)}
        <settings-app></settings-app>
        <script nonce="${nonce}" src="${jsUri}"></script>
    </body>
    </html>`;
  }

}
