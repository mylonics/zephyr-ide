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

import * as vscode from "vscode";
import {
  loadHostToolsManifest,
  getPackageManagerForPlatform,
  getPackageManagerForPlatformAsync,
  checkPackageManagerAvailable,
  installPackageManager,
  getPlatformPackages,
  checkAllPackages,
  installPackage,
  installAllMissingPackages,
  PackageStatus,
  PlatformPackage,
} from "../../setup_utilities/host_tools";
import { WorkspaceConfig, GlobalConfig } from "../../setup_utilities/types";
import { saveSetupState } from "../../setup_utilities/state-management";

export class HostToolInstallView {
  public static currentPanel: HostToolInstallView | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionPath: string;
  private readonly _context: vscode.ExtensionContext;
  private _disposables: vscode.Disposable[] = [];

  private currentWsConfig?: WorkspaceConfig;
  private currentGlobalConfig?: GlobalConfig;

  /**
   * Get just the host tools manager content HTML (without full page wrapper)
   * for embedding in other panels
   */
  public static getContentHtml(): string {
    return `
      <div class="host-tools-manager">
        <div class="info-box">
          <p>
            This tool helps you install and manage development tools required for Zephyr RTOS development.
            The tools will be installed using your platform's package manager.
          </p>
          <p style="margin-top: 10px; font-style: italic; color: var(--vscode-descriptionForeground);">
            <strong>Note:</strong> VS Code may need to be restarted after installation for tools to be available in the PATH.
          </p>
        </div>

        <div id="package-manager-section" class="manager-section">
          <h3>Package Manager Status</h3>
          <div id="manager-status" class="status-area">
            <div class="loading">Checking package manager...</div>
          </div>
        </div>

        <div id="packages-section" class="manager-section">
          <h3>Required Development Tools</h3>
          <div id="packages-status" class="status-area">
            <div class="loading">Checking packages...</div>
          </div>
        </div>

        <div id="actions-section" class="manager-section">
          <div class="button-group">
            <button id="refresh-btn" class="button" onclick="refreshHostToolsStatus()">
              <span class="codicon codicon-refresh"></span>
              Refresh Status
            </button>
            <button id="install-all-btn" class="button button-primary" onclick="installAllMissingTools()" disabled>
              <span class="codicon codicon-cloud-download"></span>
              Install All Missing Packages
            </button>
          </div>
        </div>
      </div>
    `;
  }

  public static createOrShow(
    extensionPath: string,
    context: vscode.ExtensionContext,
    wsConfig: WorkspaceConfig,
    globalConfig: GlobalConfig
  ) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (HostToolInstallView.currentPanel) {
      HostToolInstallView.currentPanel._panel.reveal(column);
      HostToolInstallView.currentPanel.updateContent(wsConfig, globalConfig);
      return HostToolInstallView.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      "zephyrIDEHostTools",
      "Host Tools Installation",
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.file(extensionPath)],
        retainContextWhenHidden: true,
      }
    );

    HostToolInstallView.currentPanel = new HostToolInstallView(
      panel,
      extensionPath,
      context,
      wsConfig,
      globalConfig
    );
    return HostToolInstallView.currentPanel;
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionPath: string,
    context: vscode.ExtensionContext,
    wsConfig: WorkspaceConfig,
    globalConfig: GlobalConfig
  ) {
    this._panel = panel;
    this._extensionPath = extensionPath;
    this._context = context;

    this.updateContent(wsConfig, globalConfig);

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      (message) => {
        this.handleWebviewMessage(message);
      },
      null,
      this._disposables
    );
  }

  public updateContent(wsConfig: WorkspaceConfig, globalConfig: GlobalConfig) {
    this.currentWsConfig = wsConfig;
    this.currentGlobalConfig = globalConfig;
    this._panel.webview.html = this.getHtmlForWebview();
    // Automatically check status on load
    this.checkStatus();
  }

  private async handleWebviewMessage(message: any) {
    switch (message.command) {
      case "checkStatus":
        await this.checkStatus();
        break;
      case "installPackageManager":
        await this.installPackageManager();
        break;
      case "installPackage":
        await this.installSinglePackage(message.packageName);
        break;
      case "installAllMissing":
        await this.installAllMissing();
        break;
      case "markComplete":
        await this.markHostToolsComplete();
        break;
      case "openManagerInstallUrl":
        await this.openManagerInstallUrl();
        break;
    }
  }

  private async checkStatus() {
    try {
      const manager = await getPackageManagerForPlatformAsync();
      if (!manager) {
        this._panel.webview.postMessage({
          command: "updateStatus",
          error: "Unsupported platform",
        });
        return;
      }

      const managerAvailable = await checkPackageManagerAvailable();
      const packageStatuses = await checkAllPackages();

      this._panel.webview.postMessage({
        command: "updateStatus",
        data: {
          managerName: manager.name,
          managerAvailable,
          managerInstallUrl: manager.config.install_url,
          packages: packageStatuses,
        },
      });
    } catch (error) {
      this._panel.webview.postMessage({
        command: "updateStatus",
        error: String(error),
      });
    }
  }

  private async installPackageManager() {
    try {
      this._panel.webview.postMessage({
        command: "installProgress",
        message: "Installing package manager...",
      });

      const success = await installPackageManager();

      if (success) {
        // Re-check the package manager status to see if it's available
        await this.checkStatus();
        
        const managerAvailable = await checkPackageManagerAvailable();
        
        if (!managerAvailable) {
          vscode.window.showWarningMessage(
            "Package manager was installed but is not yet available. Please close and reopen VS Code completely (not just reload) for changes to take effect."
          );
        } else {
          vscode.window.showInformationMessage(
            "Package manager installed successfully."
          );
        }
      } else {
        vscode.window.showErrorMessage(
          "Failed to install package manager. Check output for details."
        );
      }

      this._panel.webview.postMessage({
        command: "installComplete",
      });
    } catch (error) {
      vscode.window.showErrorMessage(`Error: ${error}`);
      this._panel.webview.postMessage({
        command: "installComplete",
      });
    }
  }

  private async installSinglePackage(packageName: string) {
    try {
      const packages = await getPlatformPackages();
      const pkg = packages.find((p) => p.name === packageName);

      if (!pkg) {
        vscode.window.showErrorMessage(`Package ${packageName} not found`);
        return;
      }

      // Update status to installing
      this._panel.webview.postMessage({
        command: "packageInstalling",
        packageName: packageName,
        current: 1,
        total: 1,
      });

      const success = await installPackage(pkg);

      // Check if package is now available
      const packageStatuses = await checkAllPackages();
      const installedPkg = packageStatuses.find(p => p.name === packageName);
      const pendingRestart = success && installedPkg && !installedPkg.available;

      // Update status after installation
      this._panel.webview.postMessage({
        command: "packageInstalled",
        packageName: packageName,
        success: success,
        pendingRestart: pendingRestart,
        current: 1,
        total: 1,
      });

      if (success) {
        if (pendingRestart) {
          vscode.window.showWarningMessage(
            `${packageName} was installed but is not yet available. Please close and reopen VS Code completely (not just reload) for changes to take effect.`
          );
        } else {
          vscode.window.showInformationMessage(
            `${packageName} installed successfully.`
          );
        }
      } else {
        vscode.window.showErrorMessage(
          `Failed to install ${packageName}. Check output for details.`
        );
      }
    } catch (error) {
      vscode.window.showErrorMessage(`Error: ${error}`);
    }
  }

  private async installAllMissing() {
    try {
      // Get the list of missing packages
      const statuses = await checkAllPackages();
      const missingPackages = statuses.filter(s => !s.available);
      
      if (missingPackages.length === 0) {
        vscode.window.showInformationMessage("All packages are already installed");
        return;
      }

      const totalCount = missingPackages.length;
      const packages = await getPlatformPackages();
      
      // Start installation progress
      this._panel.webview.postMessage({
        command: "installAllStarted",
        total: totalCount,
      });

      let installedCount = 0;
      let hasErrors = false;
      
      // Install each package one by one
      for (const status of missingPackages) {
        const pkg = packages.find(p => p.name === status.name);
        if (pkg) {
          // Update status to installing
          this._panel.webview.postMessage({
            command: "packageInstalling",
            packageName: pkg.name,
            current: installedCount + 1,
            total: totalCount,
          });

          const success = await installPackage(pkg);
          installedCount++;

          // Check if package is now available
          const updatedStatus = await checkAllPackages();
          const installedPkg = updatedStatus.find(p => p.name === pkg.name);
          const pendingRestart = success && installedPkg && !installedPkg.available;

          // Update status after installation
          this._panel.webview.postMessage({
            command: "packageInstalled",
            packageName: pkg.name,
            success: success,
            pendingRestart: pendingRestart,
            current: installedCount,
            total: totalCount,
          });

          if (!success) {
            hasErrors = true;
          }
        }
      }
      
      // Check if any packages still aren't available after installation
      const packageStatuses = await checkAllPackages();
      const needsRestart = packageStatuses.some(p => !p.available);
      
      // Complete installation
      this._panel.webview.postMessage({
        command: "installAllComplete",
        needsRestart: needsRestart,
        hasErrors: hasErrors,
      });

      if (needsRestart) {
        vscode.window.showWarningMessage(
          "Some packages were installed but are not yet available. Please close and reopen VS Code completely (not just reload) for changes to take effect."
        );
      } else if (!hasErrors) {
        vscode.window.showInformationMessage(
          "All missing packages installed successfully."
        );
      } else {
        vscode.window.showWarningMessage(
          "Some host tools failed to install. Check the output for details."
        );
      }
    } catch (error) {
      vscode.window.showErrorMessage(`Error: ${error}`);
      this._panel.webview.postMessage({
        command: "installAllComplete",
        needsRestart: false,
        hasErrors: true,
      });
    }
  }

  private async markHostToolsComplete() {
    if (!this.currentWsConfig || !this.currentGlobalConfig) {
      vscode.window.showErrorMessage("Configuration not available");
      return;
    }

    this.currentGlobalConfig.toolsAvailable = true;
    saveSetupState(
      this._context,
      this.currentWsConfig,
      this.currentGlobalConfig
    );

    vscode.window.showInformationMessage(
      "Host tools marked as installed. You can proceed with workspace setup."
    );
  }

  private async openManagerInstallUrl() {
    const manager = await getPackageManagerForPlatformAsync();
    if (manager && manager.config.install_url) {
      vscode.env.openExternal(vscode.Uri.parse(manager.config.install_url));
    }
  }

  public dispose() {
    HostToolInstallView.currentPanel = undefined;

    this._panel.dispose();

    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }

  private getHtmlForWebview(): string {
    const cssUri = this._panel.webview.asWebviewUri(
      vscode.Uri.joinPath(
        vscode.Uri.file(this._extensionPath),
        "src",
        "panels",
        "host_tool_install_view",
        "host-tool-install.css"
      )
    );

    const jsUri = this._panel.webview.asWebviewUri(
      vscode.Uri.joinPath(
        vscode.Uri.file(this._extensionPath),
        "src",
        "panels",
        "host_tool_install_view",
        "host-tool-install.js"
      )
    );

    return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Host Tools Installation</title>
        <link rel="stylesheet" type="text/css" href="${cssUri}">
    </head>
    <body>
        <div class="container">
            <h1>🔧 Host Tools Installation</h1>
            
            <div class="info-box">
                <p>
                    This panel helps you install and manage development tools required for Zephyr RTOS development.
                    The tools will be installed using your platform's package manager.
                </p>
                <p style="margin-top: 10px; font-style: italic; color: var(--vscode-descriptionForeground);">
                    <strong>Note:</strong> VS Code may need to be restarted after installation for tools to be available in the PATH.
                </p>
            </div>

            <div id="package-manager-section" class="section">
                <h2>Package Manager Status</h2>
                <div id="manager-status" class="status-area">
                    <div class="loading">Checking package manager...</div>
                </div>
            </div>

            <div id="packages-section" class="section">
                <h2>Required Development Tools</h2>
                <div id="packages-status" class="status-area">
                    <div class="loading">Checking packages...</div>
                </div>
            </div>

            <div id="actions-section" class="section">
                <div class="button-group">
                    <button id="refresh-btn" class="button" onclick="refreshStatus()">🔄 Refresh Status</button>
                    <button id="install-all-btn" class="button button-primary" onclick="installAllMissing()" disabled>
                        📦 Install All Missing Packages
                    </button>
                    <button id="mark-complete-btn" class="button button-secondary" onclick="markComplete()">
                        ✓ Skip & Mark as Complete
                    </button>
                </div>
            </div>
        </div>
        <script src="${jsUri}"></script>
    </body>
    </html>`;
  }
}
