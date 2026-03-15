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
import {
  getPackageManagerForPlatformAsync,
  checkPackageManagerAvailable,
  checkAllPackages,
  checkPackageAvailable,
  installPackageManager as installPkgMgr,
  installPackage,
  getPlatformPackages,
} from '../setup_utilities/host_tools';
import { WorkspaceConfig, GlobalConfig } from '../setup_utilities/types';
import { saveSetupState } from '../setup_utilities/state-management';
import { notifyError, notifyWarning } from '../utilities/output';

/**
 * Maps the webview command names used for host tools messages.
 * HostToolInstallView uses short names; SetupPanel prefixes with "hostTools".
 */
export interface HostToolsCommandNames {
  updateStatus: string;
  packageInstalling: string;
  packageInstalled: string;
  startInstallAll: string;
  installAllStarted: string;
  installAllComplete: string;
  /** Optional: sent before installPackageManager starts. Omit to skip. */
  installProgress?: string;
  /** Optional: sent after installPackageManager finishes. Omit to skip. */
  installComplete?: string;
}

export interface HostToolsServiceConfig {
  commands: HostToolsCommandNames;
  /** Label used in error/warning notifications (e.g. "Host Tools" or "Setup Panel") */
  errorLabel: string;
  /** Whether to re-check status after batch installing all packages */
  recheckAfterBatchInstall: boolean;
  /** Message shown when marking tools complete */
  markCompleteMessage: string;
  /** Called after markComplete saves state, for panel refresh etc. */
  onMarkComplete?: () => void;
}

/** Pre-built config for HostToolInstallView */
export const HOST_TOOL_INSTALL_VIEW_CONFIG: HostToolsServiceConfig = {
  commands: {
    updateStatus: 'updateStatus',
    packageInstalling: 'packageInstalling',
    packageInstalled: 'packageInstalled',
    startInstallAll: 'startInstallAll',
    installAllStarted: 'installAllStarted',
    installAllComplete: 'installAllComplete',
    installProgress: 'installProgress',
    installComplete: 'installComplete',
  },
  errorLabel: 'Host Tools',
  recheckAfterBatchInstall: false,
  markCompleteMessage: 'Host tools marked as installed. You can proceed with workspace setup.',
};

/** Pre-built config for SetupPanel */
export const SETUP_PANEL_CONFIG: HostToolsServiceConfig = {
  commands: {
    updateStatus: 'updateHostToolsStatus',
    packageInstalling: 'hostToolsPackageInstalling',
    packageInstalled: 'hostToolsPackageInstalled',
    startInstallAll: 'hostToolsStartInstallAll',
    installAllStarted: 'hostToolsInstallAllStarted',
    installAllComplete: 'hostToolsInstallAllComplete',
  },
  errorLabel: 'Setup Panel',
  recheckAfterBatchInstall: true,
  markCompleteMessage: 'Host tools marked as available.',
};

/**
 * Shared host tools installation logic used by both HostToolInstallView and SetupPanel.
 */
export class HostToolsService {
  constructor(
    private readonly webview: vscode.Webview,
    private readonly config: HostToolsServiceConfig
  ) {}

  private post(command: string, data?: Record<string, any>) {
    this.webview.postMessage({ command, ...data });
  }

  async checkStatus(): Promise<void> {
    try {
      const manager = await getPackageManagerForPlatformAsync();
      if (!manager) {
        this.post(this.config.commands.updateStatus, { error: 'Unsupported platform' });
        return;
      }

      const managerAvailable = await checkPackageManagerAvailable();
      const packageStatuses = await checkAllPackages();

      this.post(this.config.commands.updateStatus, {
        data: {
          managerName: manager.name,
          managerAvailable,
          managerInstallUrl: manager.config.install_url,
          packages: packageStatuses,
        },
      });
    } catch (error) {
      this.post(this.config.commands.updateStatus, { error: String(error) });
    }
  }

  async installPackageManager(): Promise<void> {
    try {
      if (this.config.commands.installProgress) {
        this.post(this.config.commands.installProgress, { message: 'Installing package manager...' });
      }

      const success = await installPkgMgr();

      if (success) {
        await this.checkStatus();

        const managerAvailable = await checkPackageManagerAvailable();

        if (!managerAvailable) {
          notifyWarning(this.config.errorLabel,
            'Package manager was installed but is not yet available. Please close and reopen VS Code completely (not just reload) for changes to take effect.'
          );
        } else {
          void vscode.window.showInformationMessage('Package manager installed successfully.');
        }
      } else {
        notifyError(this.config.errorLabel, 'Failed to install package manager. Check output for details.');
      }

      if (this.config.commands.installComplete) {
        this.post(this.config.commands.installComplete);
      }
    } catch (error) {
      notifyError(this.config.errorLabel, `Package manager installation error: ${error}`);
      if (this.config.commands.installComplete) {
        this.post(this.config.commands.installComplete);
      }
    }
  }

  async installSinglePackage(packageName: string): Promise<void> {
    try {
      const packages = await getPlatformPackages();
      const pkg = packages.find(p => p.name === packageName);

      if (!pkg) {
        notifyError(this.config.errorLabel, `Package ${packageName} not found`);
        return;
      }

      this.post(this.config.commands.packageInstalling, {
        packageName,
        current: 1,
        total: 1,
      });

      const success = await installPackage(pkg);

      const packageStatuses = await checkAllPackages();
      const installedPkg = packageStatuses.find(p => p.name === packageName);
      const pendingRestart = success && installedPkg && !installedPkg.available;

      this.post(this.config.commands.packageInstalled, {
        packageName,
        success,
        pendingRestart,
        current: 1,
        total: 1,
      });

      if (success) {
        if (pendingRestart) {
          notifyWarning(this.config.errorLabel,
            `${packageName} was installed but is not yet available. Please close and reopen VS Code completely (not just reload) for changes to take effect.`
          );
        } else {
          void vscode.window.showInformationMessage(`${packageName} installed successfully.`);
        }
      } else {
        notifyError(this.config.errorLabel, `Failed to install ${packageName}. Check output for details.`);
      }
    } catch (error) {
      notifyError(this.config.errorLabel, `Package installation error: ${error}`);
    }
  }

  async installAllMissing(): Promise<void> {
    try {
      this.post(this.config.commands.startInstallAll);
    } catch (error) {
      notifyError(this.config.errorLabel, `Install all error: ${error}`);
    }
  }

  async installAllMissingPackages(packageNames: string[]): Promise<void> {
    try {
      if (packageNames.length === 0) {
        void vscode.window.showInformationMessage('All packages are already installed');
        return;
      }

      const totalCount = packageNames.length;
      const packages = await getPlatformPackages();

      this.post(this.config.commands.installAllStarted, { total: totalCount });

      let installedCount = 0;
      let hasErrors = false;

      for (const packageName of packageNames) {
        const pkg = packages.find(p => p.name === packageName);
        if (pkg) {
          this.post(this.config.commands.packageInstalling, {
            packageName: pkg.name,
            current: installedCount + 1,
            total: totalCount,
          });

          const success = await installPackage(pkg);
          installedCount++;

          const installedPkg = await checkPackageAvailable(pkg);
          const pendingRestart = success && !installedPkg.available;

          this.post(this.config.commands.packageInstalled, {
            packageName: pkg.name,
            success,
            pendingRestart,
            current: installedCount,
            total: totalCount,
          });

          if (!success) {
            hasErrors = true;
          }
        }
      }

      const packageStatuses = await checkAllPackages();
      const justInstalledNames = new Set(packageNames);
      const needsRestart = packageStatuses
        .filter(p => justInstalledNames.has(p.name))
        .some(p => !p.available);

      this.post(this.config.commands.installAllComplete, {
        needsRestart,
        hasErrors,
      });

      if (needsRestart) {
        notifyWarning(this.config.errorLabel,
          'Some packages were installed but are not yet available. Please close and reopen VS Code completely (not just reload) for changes to take effect.'
        );
      } else if (!hasErrors) {
        void vscode.window.showInformationMessage('All missing packages installed successfully.');
      } else {
        notifyWarning(this.config.errorLabel, 'Some host tools failed to install. Check the output for details.');
      }

      if (this.config.recheckAfterBatchInstall) {
        await this.checkStatus();
      }
    } catch (error) {
      notifyError(this.config.errorLabel, `Batch installation error: ${error}`);
      this.post(this.config.commands.installAllComplete, {
        needsRestart: false,
        hasErrors: true,
      });
    }
  }

  async markComplete(
    context: vscode.ExtensionContext,
    wsConfig: WorkspaceConfig | undefined,
    globalConfig: GlobalConfig | undefined
  ): Promise<void> {
    if (!wsConfig || !globalConfig) {
      notifyError(this.config.errorLabel, 'Configuration not available');
      return;
    }

    globalConfig.toolsAvailable = true;
    await saveSetupState(context, wsConfig, globalConfig);

    void vscode.window.showInformationMessage(this.config.markCompleteMessage);

    if (this.config.onMarkComplete) {
      this.config.onMarkComplete();
    }
  }

  async openManagerInstallUrl(): Promise<void> {
    const manager = await getPackageManagerForPlatformAsync();
    if (manager && manager.config.install_url) {
      vscode.env.openExternal(vscode.Uri.parse(manager.config.install_url));
    }
  }
}
