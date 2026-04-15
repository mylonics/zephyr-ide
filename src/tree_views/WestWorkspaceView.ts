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
import * as fs from 'fs-extra';
import * as path from 'upath';
import { WorkspaceConfig, GlobalConfig, formatZephyrVersion } from '../setup_utilities/types';
import { setSetupState, setGlobalState, clearSetupState } from '../setup_utilities/state-management';
import { notifyError, notifyWarningWithActions, outputInfo } from '../utilities/output';
import { getToolsDir } from '../setup_utilities/workspace-config';
import { sanitizeTreeId } from '../utilities/utils';

export type WestWorkspaceItemContext =
  | 'westWorkspace.active'
  | 'westWorkspace.inactive'
  | 'westWorkspace.invalid';

class WestWorkspaceItem extends vscode.TreeItem {
  constructor(
    label: string,
    public readonly installPath: string,
    icon: string,
    description: string,
    tooltip: string,
    public readonly contextId: WestWorkspaceItemContext,
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.id = `west.${sanitizeTreeId(installPath)}`;
    this.iconPath = contextId === 'westWorkspace.active'
      ? new vscode.ThemeIcon(icon, new vscode.ThemeColor('statusBar.background'))
      : new vscode.ThemeIcon(icon);
    this.description = description;
    this.tooltip = tooltip;
    this.contextValue = contextId;
  }
}

export class WestWorkspaceView implements vscode.TreeDataProvider<WestWorkspaceItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<WestWorkspaceItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(
    public extensionPath: string,
    private context: vscode.ExtensionContext,
    private wsConfig: WorkspaceConfig,
    private globalConfig: GlobalConfig
  ) { }

  updateWebView(wsConfig: WorkspaceConfig, globalConfig: GlobalConfig) {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: WestWorkspaceItem): vscode.TreeItem {
    return element;
  }

  getParent(): undefined {
    return undefined;
  }

  getChildren(element?: WestWorkspaceItem): WestWorkspaceItem[] {
    if (element) {
      return [];
    }
    const items: WestWorkspaceItem[] = [];

    // Add special "Global Installation" option
    const globalPath = getToolsDir();
    const isGlobal = this.wsConfig.activeSetupState?.setupPath === globalPath;

    let globalDescription = 'System-wide Zephyr installation';
    if (this.globalConfig.setupStateDictionary && this.globalConfig.setupStateDictionary[globalPath]) {
      const globalSetupState = this.globalConfig.setupStateDictionary[globalPath];
      if (globalSetupState.zephyrVersion) {
        const versionStr = formatZephyrVersion(globalSetupState.zephyrVersion);
        globalDescription = `Zephyr ${versionStr}`;
      }
    }

    items.push(new WestWorkspaceItem(
      'Global',
      globalPath,
      'globe',
      globalDescription,
      globalPath,
      isGlobal ? 'westWorkspace.active' : 'westWorkspace.inactive',
    ));

    if (this.globalConfig.setupStateDictionary) {
      for (const installPath in this.globalConfig.setupStateDictionary) {
        if (installPath === globalPath) {
          continue;
        }

        const setupState = this.globalConfig.setupStateDictionary[installPath];
        const isValidPath = fs.pathExistsSync(installPath);
        const isActive = installPath === this.wsConfig.activeSetupState?.setupPath;

        const label = path.basename(installPath);
        let description = '';

        if (!isValidPath) {
          description = 'Path no longer exists';
        } else if (setupState.zephyrVersion) {
          const versionStr = formatZephyrVersion(setupState.zephyrVersion);
          description = `Zephyr ${versionStr}`;
        } else {
          description = 'West workspace';
        }

        let contextId: WestWorkspaceItemContext;
        let icon: string;
        if (!isValidPath) {
          contextId = 'westWorkspace.invalid';
          icon = 'error';
        } else if (isActive) {
          contextId = 'westWorkspace.active';
          icon = 'folder-opened';
        } else {
          contextId = 'westWorkspace.inactive';
          icon = 'symbol-folder';
        }

        items.push(new WestWorkspaceItem(
          label,
          installPath,
          icon,
          description,
          installPath,
          contextId,
        ));
      }
    }

    return items;
  }

  async handleActivate(item: WestWorkspaceItem) {
    try {
      const installName = path.basename(item.installPath);

      const confirm = await notifyWarningWithActions(
        'West Workspace',
        `Switch to workspace "${installName}"?`,
        ['Switch', 'Cancel']
      );

      if (confirm === 'Switch') {
        await setSetupState(this.context, this.wsConfig, this.globalConfig, item.installPath);
        void vscode.window.showInformationMessage(`Active workspace set to: ${installName}`);
        void vscode.commands.executeCommand('zephyr-ide.update-web-view');
      }
    } catch (error) {
      notifyError('West Workspace', `Failed to switch workspace: ${error}`);
    }
  }

  async handleDeselect() {
    try {
      const confirm = await notifyWarningWithActions(
        'West Workspace',
        'Deactivate active workspace?',
        ['Deactivate', 'Cancel']
      );

      if (confirm === 'Deactivate') {
        await clearSetupState(this.context, this.wsConfig);
        void vscode.window.showInformationMessage('Active workspace deactivated');
        void vscode.commands.executeCommand('zephyr-ide.update-web-view');
      }
    } catch (error) {
      notifyError('West Workspace', `Failed to deactivate workspace: ${error}`);
    }
  }

  async handleDelete(item: WestWorkspaceItem) {
    try {
      const installName = path.basename(item.installPath);
      const confirm = await notifyWarningWithActions(
        'West Workspace',
        `Are you sure you want to remove "${installName}" from the workspace registry?\n\nPath: ${item.installPath}\n\nNote: This will only remove it from the registry, not delete the files.`,
        ['Remove from Registry', 'Cancel']
      );

      if (confirm !== 'Remove from Registry') {
        return;
      }

      if (this.globalConfig.setupStateDictionary) {
        delete this.globalConfig.setupStateDictionary[item.installPath];

        await setGlobalState(this.context, this.globalConfig);

        void vscode.window.showInformationMessage(`Installation "${installName}" has been removed from the registry.`);
        outputInfo('West Workspace', `Removed installation from registry: ${item.installPath}`);
        void vscode.commands.executeCommand('zephyr-ide.update-web-view');
      }
    } catch (error) {
      notifyError('West Workspace', `Failed to delete workspace: ${error}`);
    }
  }
}
