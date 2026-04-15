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
import { WorkspaceConfig, GlobalConfig } from '../setup_utilities/types';

class SetupItem extends vscode.TreeItem {
  constructor(label: string, icon: string, commandId: string, status?: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon(icon);
    this.command = { command: commandId, title: label };
    if (status) {
      this.description = status;
    }
  }
}

export class ExtensionSetupView implements vscode.TreeDataProvider<SetupItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<SetupItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(public extensionPath: string, private context: vscode.ExtensionContext, private wsConfig: WorkspaceConfig, private globalConfig: GlobalConfig) { }

  updateWebView(wsConfig: WorkspaceConfig, globalConfig: GlobalConfig) {
    this.wsConfig = wsConfig;
    this.globalConfig = globalConfig;
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: SetupItem): vscode.TreeItem {
    return element;
  }

  getParent(): undefined {
    return undefined;
  }

  getChildren(): SetupItem[] {
    const toolsStatus = this.globalConfig.toolsAvailable ? "Ready" : "Setup Required";
    const sdkStatus = this.globalConfig.sdkInstalled
      ? (this.globalConfig.sdkVersion ? `v${this.globalConfig.sdkVersion}` : "Installed")
      : "Not Installed";
    const workspaceStatus = (this.wsConfig.initialSetupComplete && this.wsConfig.activeSetupState) ? "Initialized" : "Setup Required";
    const westUpdatedStatus = this.wsConfig.activeSetupState?.westUpdated ? "Updated" : "Not Updated";
    const pythonEnvStatus = this.wsConfig.activeSetupState?.pythonEnvironmentSetup ? "Ready" : "Not Configured";

    return [
      new SetupItem("Overview", "preview", "zephyr-ide.open-setup-panel"),
      new SetupItem("Host Tools", "package", "zephyr-ide.open-host-tools-panel", toolsStatus),
      new SetupItem("Zephyr SDK", "desktop-download", "zephyr-ide.open-sdk-panel", sdkStatus),
      new SetupItem("Workspace Setup", "folder-opened", "zephyr-ide.open-workspace-panel", workspaceStatus),
      new SetupItem("West Update", "sync", "zephyr-ide.west-update", westUpdatedStatus),
    ];
  }
}

