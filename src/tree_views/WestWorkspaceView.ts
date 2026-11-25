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
import * as fs from 'fs-extra';
import * as path from 'upath';
import { WorkspaceConfig, GlobalConfig, formatZephyrVersion } from '../setup_utilities/types';
import { setSetupState, setGlobalState, clearSetupState } from '../setup_utilities/state-management';
import { notifyError, notifyWarningWithActions, outputInfo } from '../utilities/output';
import { sanitizeTreeId, compareWorkspacePathsByLocality, canonicalizePath } from '../utilities/utils';

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
      ? new vscode.ThemeIcon(icon, new vscode.ThemeColor('textLink.foreground'))
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

    if (this.globalConfig.setupStateDictionary) {
      const seen = new Set<string>();
      for (const installPath in this.globalConfig.setupStateDictionary) {
        const canonical = canonicalizePath(installPath);
        if (seen.has(canonical)) { continue; }
        seen.add(canonical);
        const setupState = this.globalConfig.setupStateDictionary[installPath];
        const isValidPath = fs.pathExistsSync(installPath);
        const isActive = installPath === this.wsConfig.activeSetupState?.setupPath;

        const label = path.basename(installPath);
        let description = '';

        if (!isValidPath) {
          description = vscode.l10n.t("Path no longer exists");
        } else if (setupState.zephyrVersion) {
          const versionStr = formatZephyrVersion(setupState.zephyrVersion);
          description = `Zephyr ${versionStr}`;
        } else {
          description = vscode.l10n.t("West workspace");
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

      // Sort so the workspace matching the currently open folder appears first
      const rootPath = this.wsConfig.rootPath;
      if (rootPath) {
        items.sort((a, b) =>
          compareWorkspacePathsByLocality(rootPath, a.installPath, b.installPath)
        );
      }
    }

    return items;
  }

  async handleActivate(item: WestWorkspaceItem) {
    try {
      const installName = path.basename(item.installPath);

      const confirm = await notifyWarningWithActions(
        'West Workspace',
        vscode.l10n.t("Switch to workspace \"{0}\"?", installName),
        ['Switch', 'Cancel']
      );

      if (confirm === 'Switch') {
        await setSetupState(this.context, this.wsConfig, this.globalConfig, item.installPath);
        void vscode.window.showInformationMessage(vscode.l10n.t("Active workspace set to: {0}", installName));
        void vscode.commands.executeCommand('zephyr-ide.update-web-view');
      }
    } catch (error) {
      notifyError('West Workspace', vscode.l10n.t("Failed to switch workspace: {0}", String(error)));
    }
  }

  async handleDeselect() {
    try {
      const confirm = await notifyWarningWithActions(
        'West Workspace',
        vscode.l10n.t("Deactivate active workspace?"),
        ['Deactivate', 'Cancel']
      );

      if (confirm === 'Deactivate') {
        await clearSetupState(this.context, this.wsConfig);
        void vscode.window.showInformationMessage(vscode.l10n.t("Active workspace deactivated"));
        void vscode.commands.executeCommand('zephyr-ide.update-web-view');
      }
    } catch (error) {
      notifyError('West Workspace', vscode.l10n.t("Failed to deactivate workspace: {0}", String(error)));
    }
  }

  async handleDelete(item: WestWorkspaceItem) {
    try {
      const installName = path.basename(item.installPath);
      const confirm = await notifyWarningWithActions(
        'West Workspace',
        vscode.l10n.t("Remove \"{0}\" from the workspace registry?\n\nPath: {1}\n\nFiles on disk will be kept.", installName, item.installPath),
        ['Remove from Registry', 'Cancel']
      );

      if (confirm !== 'Remove from Registry') {
        return;
      }

      if (this.globalConfig.setupStateDictionary) {
        delete this.globalConfig.setupStateDictionary[item.installPath];

        await setGlobalState(this.context, this.globalConfig);

        void vscode.window.showInformationMessage(vscode.l10n.t("Installation \"{0}\" has been removed from the registry.", installName));
        outputInfo('West Workspace', `Removed installation from registry: ${item.installPath}`);
        void vscode.commands.executeCommand('zephyr-ide.update-web-view');
      }
    } catch (error) {
      notifyError('West Workspace', vscode.l10n.t("Failed to delete workspace: {0}", String(error)));
    }
  }
}
