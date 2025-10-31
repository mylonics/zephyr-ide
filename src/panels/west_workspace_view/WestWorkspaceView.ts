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
import path from 'path';
import { WorkspaceConfig, GlobalConfig } from '../../setup_utilities/types';
import { getNonce } from "../../utilities/getNonce";
import { setSetupState, setGlobalState, clearSetupState } from '../../setup_utilities/state-management';
import { output } from '../../utilities/utils';
import { getToolsDir } from '../../setup_utilities/workspace-config';
import { westConfig } from '../../setup_utilities/workspace-setup';

export class WestWorkspaceView implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;

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
          const versionStr = `${globalSetupState.zephyrVersion.major}.${globalSetupState.zephyrVersion.minor}.${globalSetupState.zephyrVersion.patch}`;
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
        // Active global workspace: has dropdown with west operations (always open)
        globalData['selected'] = true;
        globalData['open'] = true;
        globalData['actions'] = [{
          icon: 'close',
          actionId: 'deselect',
          tooltip: 'Deselect Workspace'
        }];
        globalData['subItems'] = [
          {
            icons: { leaf: 'settings' },
            label: 'West Config',
            value: { 
              command: 'zephyr-ide.west-config-no-external',
              installPath: globalPath
            }
          },
          {
            icons: { leaf: 'settings-gear' },
            label: 'Setup West Environment',
            value: { 
              command: 'zephyr-ide.setup-west-environment',
              installPath: globalPath
            }
          },
          {
            icons: { leaf: 'git-branch' },
            label: 'West Init',
            value: { 
              command: 'zephyr-ide.west-init',
              installPath: globalPath
            }
          },
          {
            icons: { leaf: 'sync' },
            label: 'West Update',
            value: { 
              command: 'zephyr-ide.west-update',
              installPath: globalPath
            }
          }
        ];
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
            const versionStr = `${setupState.zephyrVersion.major}.${setupState.zephyrVersion.minor}.${setupState.zephyrVersion.patch}`;
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
            // Active workspace: has dropdown with west operations (always open)
            workspaceData['selected'] = true;
            workspaceData['open'] = true;
            workspaceData['actions'] = [{
              icon: 'close',
              actionId: 'deselect',
              tooltip: 'Deselect Workspace'
            }];
            workspaceData['subItems'] = [
              {
                icons: { leaf: 'settings' },
                label: 'West Config',
                value: { 
                  command: 'zephyr-ide.west-config-no-external',
                  installPath: installPath
                }
              },
              {
                icons: { leaf: 'settings-gear' },
                label: 'Setup West Environment',
                value: { 
                  command: 'zephyr-ide.setup-west-environment',
                  installPath: installPath
                }
              },
              {
                icons: { leaf: 'git-branch' },
                label: 'West Init',
                value: { 
                  command: 'zephyr-ide.west-init',
                  installPath: installPath
                }
              },
              {
                icons: { leaf: 'sync' },
                label: 'West Update',
                value: { 
                  command: 'zephyr-ide.west-update',
                  installPath: installPath
                }
              }
            ];
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
      const fileUri = (fp: string) => {
        const fragments = fp.split('/');
        return vscode.Uri.file(
          path.join(this.extensionPath, ...fragments)
        );
      };

      const assetUri = (fp: string) => {
        if (this.view) {
          return this.view.webview.asWebviewUri(fileUri(fp));
        }
      };

      const nonce = getNonce();

      this.view.webview.html = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>West Workspaces</title>
          <link rel="stylesheet" href="${assetUri('node_modules/@vscode/codicons/dist/codicon.css')}"  id="vscode-codicon-stylesheet">
          <link rel="stylesheet" href="${assetUri('src/panels/view.css')}">
          <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${this.view.webview.cspSource}; font-src ${this.view.webview.cspSource}; img-src ${this.view.webview.cspSource} https:; script-src 'nonce-${nonce}';">
          <script nonce="${nonce}" src="${assetUri('node_modules/@vscode-elements/elements/dist/bundled.js')}"  type="module"></script>
          <script nonce="${nonce}" src="${assetUri('src/panels/west_workspace_view/WestWorkspaceViewHandler.js')}"  type="module"></script>
        </head>
        <body>
        <vscode-tree id="workspace-tree" indent-guides arrows></vscode-tree>
        ${body}
        </body>
        </html>`;
    }
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView, 
    context: vscode.WebviewViewResolveContext, 
    token: vscode.CancellationToken
  ): void | Thenable<void> {
    webviewView.webview.options = {
      enableScripts: true,
      enableCommandUris: true,
    };

    this.view = webviewView;
    webviewView.webview.onDidReceiveMessage(async (message) => {
      console.log('WestWorkspaceView received message:', message);
      
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
            console.log('Unknown actionId:', message.actionId);
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
              vscode.commands.executeCommand(message.command);
            }
            break;
          case 'zephyr-ide.setup-west-environment':
          case 'zephyr-ide.west-init':
          case 'zephyr-ide.west-update':
            // Execute the VS Code commands directly
            vscode.commands.executeCommand(message.command);
            break;
          case 'zephyr-ide.workspace-setup-picker':
            vscode.commands.executeCommand('zephyr-ide.workspace-setup-picker');
            break;
          default:
            console.log('Unknown command:', message.command);
        }
      }
    });
    
    this.setHtml("");
    this.updateWebView(this.wsConfig, this.globalConfig);
  }

  private async handleActivate(installPath: string) {
    try {
      const installName = path.basename(installPath);
      
      // Show confirmation prompt (non-modal warning)
      const confirm = await vscode.window.showWarningMessage(
        `Switch to workspace "${installName}"?`,
        'Switch',
        'Cancel'
      );

      if (confirm === 'Switch') {
        await setSetupState(this.context, this.wsConfig, this.globalConfig, installPath);
        vscode.window.showInformationMessage(`Active workspace set to: ${installName}`);
        vscode.commands.executeCommand('zephyr-ide.update-web-view');
      }
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to switch workspace: ${error}`);
    }
  }

  private async handleDeselect() {
    try {
      const confirm = await vscode.window.showWarningMessage(
        'Deselect active workspace?',
        'Deselect',
        'Cancel'
      );

      if (confirm === 'Deselect') {
        await clearSetupState(this.context, this.wsConfig, this.globalConfig);
        vscode.window.showInformationMessage('Active workspace deselected');
        vscode.commands.executeCommand('zephyr-ide.update-web-view');
      }
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to deselect workspace: ${error}`);
    }
  }

  private async handleDelete(installPath: string) {
    try {
      const installName = path.basename(installPath);
      const confirm = await vscode.window.showWarningMessage(
        `Are you sure you want to remove "${installName}" from the workspace registry?\n\nPath: ${installPath}\n\nNote: This will only remove it from the registry, not delete the files.`,
        'Remove from Registry',
        'Cancel'
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
        output.appendLine(`[WEST WORKSPACE] Removed installation from registry: ${installPath}`);
        vscode.commands.executeCommand('zephyr-ide.update-web-view');
      }
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to delete workspace: ${error}`);
    }
  }
}
