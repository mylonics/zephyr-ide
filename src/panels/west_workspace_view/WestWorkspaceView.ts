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
import path from 'upath';
import { WorkspaceConfig, GlobalConfig, formatZephyrVersion } from '../../setup_utilities/types';
import { setSetupState, setGlobalState, clearSetupState } from '../../setup_utilities/state-management';
import { output } from '../../utilities/utils';
import { notifyError, notifyWarningWithActions, outputInfo } from '../../utilities/output';
import { getToolsDir } from '../../setup_utilities/workspace-config';
import { westConfig } from '../../setup_utilities/workspace-setup';
import { generateWebviewHtml, initWebviewView } from '../webviewHelper';

export class WestWorkspaceView implements vscode.WebviewViewProvider {
  public view: vscode.WebviewView | undefined;

  constructor(
    public extensionPath: string,
    private context: vscode.ExtensionContext,
    private wsConfig: WorkspaceConfig,
    private globalConfig: GlobalConfig
  ) { }

  updateWebView(wsConfig: WorkspaceConfig, globalConfig: GlobalConfig) {
    if (this.view) {
      const data: any[] = [];

      // Add special "Global Installation" option
      const globalPath = getToolsDir();
      const isGlobal = wsConfig.activeSetupState?.setupPath === globalPath;

      // Get version info for global installation if it exists in setupStateDictionary
      let globalDescription = 'System-wide Zephyr installation';
      if (globalConfig.setupStateDictionary && globalConfig.setupStateDictionary[globalPath]) {
        const globalSetupState = globalConfig.setupStateDictionary[globalPath];
        if (globalSetupState.zephyrVersion) {
          const versionStr = formatZephyrVersion(globalSetupState.zephyrVersion);
          globalDescription = `Zephyr ${versionStr}`;
        }
      }

      const globalData: any = {
        icons: {
          open: 'globe',
          closed: 'globe'
        },
        label: 'Global',
        description: globalDescription,
        tooltip: globalPath,
        value: { installPath: globalPath }
      };

      if (isGlobal) {
        // Active global workspace: no dropdown, just close action
        globalData['selected'] = true;
        globalData['actions'] = [{
          icon: 'close',
          actionId: 'deselect',
          tooltip: 'Deselect Workspace'
        }];
      } else {
        globalData['actions'] = [{
          icon: 'target',
          actionId: 'activate',
          tooltip: 'Set as Active'
        }];
      }
      data.push(globalData);

      if (globalConfig.setupStateDictionary) {
        for (const installPath in globalConfig.setupStateDictionary) {
          // Skip global path as it's already added above
          if (installPath === globalPath) {
            continue;
          }

          const setupState = globalConfig.setupStateDictionary[installPath];
          const isValidPath = fs.pathExistsSync(installPath);
          const isActive = installPath === wsConfig.activeSetupState?.setupPath;

          let label = path.basename(installPath);
          let description = '';

          if (!isValidPath) {
            label = `$(error) ${label}`;
            description = 'Path no longer exists';
          } else if (setupState.zephyrVersion) {
            const versionStr = formatZephyrVersion(setupState.zephyrVersion);
            description = `Zephyr ${versionStr}`;
          } else {
            description = 'West workspace';
          }

          const workspaceData: any = {
            icons: {
              open: 'folder-opened',
              closed: 'folder'
            },
            label: label,
            description: description,
            tooltip: installPath,
            value: { installPath: installPath }
          };

          if (isActive && isValidPath) {
            // Active workspace: no dropdown, just close action
            workspaceData['selected'] = true;
            workspaceData['actions'] = [{
              icon: 'close',
              actionId: 'deselect',
              tooltip: 'Deselect Workspace'
            }];
          } else {
            // Non-active workspace: no dropdown, just action icons
            workspaceData['actions'] = [];

            if (isValidPath) {
              // Activate action
              workspaceData['actions'].push({
                icon: 'target',
                actionId: 'activate',
                tooltip: 'Set as Active'
              });
            }

            // Delete action (available for both valid and invalid paths)
            workspaceData['actions'].push({
              icon: 'trash',
              actionId: 'delete',
              tooltip: 'Delete from Registry'
            });
          }

          data.push(workspaceData);
        }
      }

      this.view.webview.postMessage(data);
    }
  }

  setHtml(body: string) {
    if (this.view !== undefined) {
      this.view.webview.html = generateWebviewHtml(this.view, this.extensionPath, body, {
        handlerJsPath: 'src/panels/west_workspace_view/WestWorkspaceViewHandler.js',
        treeElementHtml: '<vscode-tree id="workspace-tree"></vscode-tree>',
        includeCSP: true,
      });
    }
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    token: vscode.CancellationToken
  ): void | Thenable<void> {
    initWebviewView(
      this, webviewView,
      () => this.updateWebView(this.wsConfig, this.globalConfig),
      (message) => this.handleMessage(message),
      () => { this.setHtml(""); this.updateWebView(this.wsConfig, this.globalConfig); }
    );
  }

  private async handleMessage(message: any) {
      if (message.actionId) {
        // Handle action button clicks
        switch (message.actionId) {
          case 'activate':
            await this.handleActivate(message.value.installPath);
            break;
          case 'deselect':
            await this.handleDeselect();
            break;
          case 'delete':
            await this.handleDelete(message.value.installPath);
            break;
          default:
            break;
        }
      } else if (message.command) {
        // Handle sub-item clicks and other commands
        switch (message.command) {
          case 'zephyr-ide.west-config':
          case 'zephyr-ide.west-config-no-external':
            // For west-config-no-external, we need to call westConfig with options
            if (message.command === 'zephyr-ide.west-config-no-external') {
              // Call westConfig programmatically without external installation option
              await westConfig(this.context, this.wsConfig, this.globalConfig, {
                showUseWestFolder: true,
                showUseWestYml: true,
                showCreateNewWestYml: true,
                showUseExternalInstallation: false
              });
            } else {
              void vscode.commands.executeCommand(message.command);
            }
            break;
          case 'zephyr-ide.setup-west-environment':
          case 'zephyr-ide.west-init':
          case 'zephyr-ide.west-update':
            // Execute the VS Code commands directly
            void vscode.commands.executeCommand(message.command);
            break;
          case 'zephyr-ide.workspace-setup-picker':
            void vscode.commands.executeCommand('zephyr-ide.workspace-setup-picker');
            break;
          default:
            break;
        }
      }
  }

  private async handleActivate(installPath: string) {
    try {
      const installName = path.basename(installPath);

      // Show confirmation prompt (non-modal warning)
      const confirm = await notifyWarningWithActions(
        'West Workspace',
        `Switch to workspace "${installName}"?`,
        ['Switch', 'Cancel']
      );

      if (confirm === 'Switch') {
        await setSetupState(this.context, this.wsConfig, this.globalConfig, installPath);
        vscode.window.showInformationMessage(`Active workspace set to: ${installName}`);
        void vscode.commands.executeCommand('zephyr-ide.update-web-view');
      }
    } catch (error) {
      notifyError('West Workspace', `Failed to switch workspace: ${error}`);
    }
  }

  private async handleDeselect() {
    try {
      const confirm = await notifyWarningWithActions(
        'West Workspace',
        'Deselect active workspace?',
        ['Deselect', 'Cancel']
      );

      if (confirm === 'Deselect') {
        await clearSetupState(this.context, this.wsConfig);
        vscode.window.showInformationMessage('Active workspace deselected');
        void vscode.commands.executeCommand('zephyr-ide.update-web-view');
      }
    } catch (error) {
      notifyError('West Workspace', `Failed to deselect workspace: ${error}`);
    }
  }

  private async handleDelete(installPath: string) {
    try {
      const installName = path.basename(installPath);
      const confirm = await notifyWarningWithActions(
        'West Workspace',
        `Are you sure you want to remove "${installName}" from the workspace registry?\n\nPath: ${installPath}\n\nNote: This will only remove it from the registry, not delete the files.`,
        ['Remove from Registry', 'Cancel']
      );

      if (confirm !== 'Remove from Registry') {
        return;
      }

      // Remove from setupStateDictionary
      if (this.globalConfig.setupStateDictionary) {
        delete this.globalConfig.setupStateDictionary[installPath];

        // Save updated global config
        await setGlobalState(this.context, this.globalConfig);

        vscode.window.showInformationMessage(`Installation "${installName}" has been removed from the registry.`);
        outputInfo('West Workspace', `Removed installation from registry: ${installPath}`);
        void vscode.commands.executeCommand('zephyr-ide.update-web-view');
      }
    } catch (error) {
      notifyError('West Workspace', `Failed to delete workspace: ${error}`);
    }
  }
}
