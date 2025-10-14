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
import { setSetupState, setGlobalState } from '../../setup_utilities/state-management';
import { westSelector } from '../../setup_utilities/west_selector';
import { postWorkspaceSetup } from '../../setup_utilities/west-operations';
import { output } from '../../utilities/utils';

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

      if (globalConfig.setupStateDictionary) {
        for (const installPath in globalConfig.setupStateDictionary) {
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

          if (isActive) {
            label = `$(check) ${label}`;
          }

          const subItems: any[] = [];

          if (isValidPath) {
            // Set as Active
            if (!isActive) {
              subItems.push({
                icons: { leaf: 'target' },
                label: 'Set as Active',
                value: { 
                  command: 'zephyr-ide.west-workspace-set-active',
                  installPath: installPath
                }
              });
            }

            // Reconfigure
            subItems.push({
              icons: { leaf: 'tools' },
              label: 'Reconfigure',
              value: { 
                command: 'zephyr-ide.west-workspace-reconfigure',
                installPath: installPath
              }
            });

            // West Update
            subItems.push({
              icons: { leaf: 'sync' },
              label: 'West Update',
              value: { 
                command: 'zephyr-ide.west-workspace-update',
                installPath: installPath
              }
            });

            // Open west.yml
            const westYmlPath = path.join(installPath, '.west', 'config');
            const manifestPath = path.join(installPath, 'west.yml');
            if (fs.pathExistsSync(westYmlPath) || fs.pathExistsSync(manifestPath)) {
              subItems.push({
                icons: { leaf: 'file-code' },
                label: 'Open west.yml',
                value: { 
                  command: 'zephyr-ide.west-workspace-open-yml',
                  installPath: installPath
                }
              });
            }
          }

          // Delete (available for both valid and invalid paths)
          subItems.push({
            icons: { leaf: 'trash' },
            label: 'Delete from Registry',
            value: { 
              command: 'zephyr-ide.west-workspace-delete',
              installPath: installPath
            }
          });

          data.push({
            icons: { 
              open: 'folder-opened',
              closed: 'folder'
            },
            label: label,
            description: description,
            tooltip: installPath,
            value: { installPath: installPath },
            subItems: subItems,
            open: false
          });
        }
      }

      if (data.length === 0) {
        // Show message when no workspaces are found
        data.push({
          icons: { leaf: 'info' },
          label: 'No West workspaces found',
          description: 'Create one using Workspace Setup',
          value: { command: 'zephyr-ide.workspace-setup-picker' },
          subItems: []
        });
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
      
      if (message.command) {
        switch (message.command) {
          case 'zephyr-ide.west-workspace-set-active':
            await this.handleSetActive(message.installPath);
            break;
          case 'zephyr-ide.west-workspace-reconfigure':
            await this.handleReconfigure(message.installPath);
            break;
          case 'zephyr-ide.west-workspace-update':
            await this.handleWestUpdate(message.installPath);
            break;
          case 'zephyr-ide.west-workspace-open-yml':
            await this.handleOpenWestYml(message.installPath);
            break;
          case 'zephyr-ide.west-workspace-delete':
            await this.handleDelete(message.installPath);
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

  private async handleSetActive(installPath: string) {
    try {
      await setSetupState(this.context, this.wsConfig, this.globalConfig, installPath);
      vscode.window.showInformationMessage(`Active workspace set to: ${path.basename(installPath)}`);
      vscode.commands.executeCommand('zephyr-ide.update-web-view');
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to set active workspace: ${error}`);
    }
  }

  private async handleReconfigure(installPath: string) {
    try {
      // Set the setup state to the selected installation
      await setSetupState(this.context, this.wsConfig, this.globalConfig, installPath);

      if (!this.wsConfig.activeSetupState) {
        vscode.window.showErrorMessage('Failed to load installation state for reconfiguration.');
        return;
      }

      // Run west selector to reconfigure
      output.show();
      output.appendLine(`[WEST WORKSPACE] Reconfiguring installation: ${installPath}`);

      const westSelection = await westSelector(this.context, this.wsConfig);

      if (!westSelection || westSelection.failed) {
        vscode.window.showErrorMessage('Reconfiguration cancelled or failed.');
        return;
      }

      // Run post-setup process to apply the reconfiguration
      await postWorkspaceSetup(this.context, this.wsConfig, this.globalConfig, installPath, westSelection);
      vscode.window.showInformationMessage(`Installation "${path.basename(installPath)}" has been reconfigured successfully.`);
      vscode.commands.executeCommand('zephyr-ide.update-web-view');
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to reconfigure workspace: ${error}`);
    }
  }

  private async handleWestUpdate(installPath: string) {
    try {
      // Set the setup state to the selected installation
      await setSetupState(this.context, this.wsConfig, this.globalConfig, installPath);

      if (!this.wsConfig.activeSetupState) {
        vscode.window.showErrorMessage('Failed to load installation state.');
        return;
      }

      output.show();
      output.appendLine(`[WEST WORKSPACE] Running west update for: ${installPath}`);

      await postWorkspaceSetup(this.context, this.wsConfig, this.globalConfig, installPath, undefined);
      vscode.window.showInformationMessage(`West update completed for: ${path.basename(installPath)}`);
      vscode.commands.executeCommand('zephyr-ide.update-web-view');
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to run west update: ${error}`);
    }
  }

  private async handleOpenWestYml(installPath: string) {
    try {
      // Try to find west.yml in the installation
      let westYmlPath = path.join(installPath, 'west.yml');
      
      if (!fs.pathExistsSync(westYmlPath)) {
        // Look in .west/config for manifest path
        const westConfigPath = path.join(installPath, '.west', 'config');
        if (fs.pathExistsSync(westConfigPath)) {
          const configContent = fs.readFileSync(westConfigPath, 'utf-8');
          const manifestMatch = configContent.match(/manifest\.path\s*=\s*(.+)/);
          if (manifestMatch) {
            const manifestDir = manifestMatch[1].trim();
            westYmlPath = path.join(installPath, manifestDir, 'west.yml');
          }
        }
      }

      if (fs.pathExistsSync(westYmlPath)) {
        const doc = await vscode.workspace.openTextDocument(westYmlPath);
        await vscode.window.showTextDocument(doc);
      } else {
        vscode.window.showWarningMessage(`Could not find west.yml in ${path.basename(installPath)}`);
      }
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to open west.yml: ${error}`);
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
