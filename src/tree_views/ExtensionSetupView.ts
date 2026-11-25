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

import * as vscode from 'vscode';
import { escapeHtml } from '../panels/webview_shared/webviewTypes';
import { WorkspaceConfig, GlobalConfig, isActiveWorkspaceInitialized } from '../setup_utilities/types';

const selectModules = "zephyr-ide.select-west-modules";
const updateModules = "zephyr-ide.update-selected-west-modules";
const setupLinks = [
  ["Overview", "preview", "zephyr-ide.open-setup-panel"],
  ["Host Tools", "package", "zephyr-ide.open-host-tools-panel"],
  ["Zephyr SDK", "desktop-download", "zephyr-ide.open-sdk-panel"],
  ["Workspace Setup", "folder-opened", "zephyr-ide.open-workspace-panel"],
  ["West Update", "sync", selectModules],
  ["Runner Profiles", "chip", "zephyr-ide.open-runner-profile-panel"],
] as const;

export class ExtensionSetupView implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;

  constructor(private extensionUri: vscode.Uri, private wsConfig: WorkspaceConfig, private globalConfig: GlobalConfig) {}

  resolveWebviewView(view: vscode.WebviewView) {
    this.view = view;
    const uri = (...parts: string[]) => vscode.Uri.joinPath(this.extensionUri, ...parts);
    view.webview.options = {
      enableCommandUris: [...setupLinks.map(([, , command]) => command), updateModules],
      localResourceRoots: [uri("node_modules", "@vscode", "codicons", "dist"), uri("src", "tree_views")],
    };
    view.onDidDispose(() => { if (this.view === view) { this.view = undefined; } });
    this.render();
  }

  updateWebView(wsConfig: WorkspaceConfig, globalConfig: GlobalConfig) {
    this.wsConfig = wsConfig;
    this.globalConfig = globalConfig;
    this.render();
  }

  private render() {
    if (!this.view) { return; }
    const { webview } = this.view;
    const toolsStatus = this.globalConfig.toolsAvailable ? vscode.l10n.t("Ready") : vscode.l10n.t("Setup Required");
    const sdkStatus = this.globalConfig.sdkInstalled
      ? (this.globalConfig.sdkVersion ? `v${this.globalConfig.sdkVersion}` : vscode.l10n.t("Installed"))
      : vscode.l10n.t("Not Installed");
    const workspaceStatus = isActiveWorkspaceInitialized(this.wsConfig) ? vscode.l10n.t("Initialized") : vscode.l10n.t("Setup Required");
    const westUpdatedStatus = this.wsConfig.activeSetupState?.westUpdated ? vscode.l10n.t("Updated") : vscode.l10n.t("Not Updated");
    const statuses: Record<string, string> = {
      "Host Tools": toolsStatus, "Zephyr SDK": sdkStatus, "Workspace Setup": workspaceStatus, "West Update": westUpdatedStatus,
    };
    const icon = (name: string) => `<i class="codicon codicon-${name}" aria-hidden="true"></i>`;
    const shortcut = (command: string, name: string, title: string) =>
      `<a class="shortcut" href="command:${command}" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}">${icon(name)}</a>`;
    const rows = setupLinks.map(([label, name, command]) => {
      const title = escapeHtml(vscode.l10n.t(label));
      const status = escapeHtml(statuses[label]);
      const actions = command === selectModules
        ? shortcut(selectModules, "checklist", vscode.l10n.t("Select west projects to update")) +
          shortcut(updateModules, "sync", vscode.l10n.t("Update selected west modules")) : "";
      return `<li><a class="entry" href="command:${command}" title="${title}">
        ${icon(name)}<span class="label">${title}</span><small>${status}</small></a>${actions}</li>`;
    }).join("");
    const css = (...parts: string[]) => webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, ...parts));
    const html = `<!doctype html><html lang="${escapeHtml(vscode.env.language)}"><head><meta charset="utf-8">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; font-src ${webview.cspSource}">
      <link rel="stylesheet" href="${css("node_modules", "@vscode", "codicons", "dist", "codicon.css")}">
      <link rel="stylesheet" href="${css("src", "tree_views", "extension-setup.css")}"></head><body><ul>${rows}</ul></body></html>`;
    if (webview.html !== html) { webview.html = html; }
  }
}
