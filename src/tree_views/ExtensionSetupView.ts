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

import * as vscode from 'vscode';
import { WorkspaceConfig, GlobalConfig } from '../setup_utilities/types';

class SetupItem extends vscode.TreeItem {
  constructor(label: string, icon: string, commandId: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon(icon);
    this.command = { command: commandId, title: label };
  }
}

export class ExtensionSetupView implements vscode.TreeDataProvider<SetupItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<SetupItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(public extensionPath: string, private context: vscode.ExtensionContext, private wsConfig: WorkspaceConfig, private globalConfig: GlobalConfig) { }

  updateWebView(wsConfig: WorkspaceConfig, globalConfig: GlobalConfig) {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: SetupItem): vscode.TreeItem {
    return element;
  }

  getParent(): undefined {
    return undefined;
  }

  getChildren(): SetupItem[] {
    return [
      new SetupItem("Zephyr IDE Configuration", "folder-opened", "zephyr-ide.open-setup-panel"),
      new SetupItem("West Update", "sync", "zephyr-ide.west-update"),
    ];
  }
}

