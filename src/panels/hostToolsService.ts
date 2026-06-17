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
import {
  getPackageManagerForPlatformAsync,
  checkPackageManagerAvailable,
  checkAllPackages,
  checkPackageAvailable,
  installPackageManager as installPkgMgr,
  installPackage,
  installPackagesBatch,
  getPlatformPackages,
  refreshWindowsPath,
} from '../setup_utilities/host_tools';
import { WorkspaceConfig, GlobalConfig } from '../setup_utilities/types';
import { saveSetupState } from '../setup_utilities/state-management';
import { notifyError, notifyWarning } from '../utilities/output';
import { isWindows, checkWindowsLongPathsEnabled, enableWindowsLongPaths } from '../utilities/utils';
import * as cp from 'child_process';

/** The 7-Zip winget package definition used for optional install. */
const SEVEN_ZIP_PKG = {
  name: '7-Zip',
  package: '7zip.7zip',
  check_command: '7z --help',
  post_install_step: "[System.Environment]::SetEnvironmentVariable('Path', [System.Environment]::GetEnvironmentVariable('Path', 'User') + ';C:\\Program Files\\7-Zip', 'User')",
};

/** Returns true if 7z is accessible on PATH or found at the default install location. */
function check7ZipAvailable(): boolean {
  // Check default install dir directly (doesn't need PATH)
  try {
    require('fs').accessSync('C:\\Program Files\\7-Zip\\7z.exe');
    return true;
  } catch { /* not at default location */ }
  // Try running it
  try {
    cp.execSync('7z --help', { stdio: 'ignore', timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Provider for the live state references the HostToolsService needs in order
 * to persist pending-restart entries and `toolsAvailable` updates back to
 * globalState. Returns undefined fields when not yet wired (the service then
 * skips persistence and the UI-only behavior degrades gracefully).
 */
export interface HostToolsStateRefs {
  context?: vscode.ExtensionContext;
  wsConfig?: WorkspaceConfig;
  globalConfig?: GlobalConfig;
}

/**
 * Command names used for host tools messages between extension and webview.
 * Both HostToolInstallView and SetupPanel use the same command names.
 */
export const HOST_TOOLS_COMMANDS = {
  updateStatus: 'hostToolsUpdateStatus',
  packageChecked: 'hostToolsPackageChecked',
  packageInstalling: 'hostToolsPackageInstalling',
  packageInstalled: 'hostToolsPackageInstalled',
  startInstallAll: 'hostToolsStartInstallAll',
  installAllStarted: 'hostToolsInstallAllStarted',
  installAllComplete: 'hostToolsInstallAllComplete',
} as const;

export interface HostToolsServiceConfig {
  /** Label used in error/warning notifications (e.g. "Host Tools" or "Setup Panel") */
  errorLabel: string;
  /** Whether to re-check status after batch installing all packages */
  recheckAfterBatchInstall: boolean;
  /** Message shown when marking tools complete */
  markCompleteMessage: string;
  /** Called after markComplete saves state, for panel refresh etc. */
  onMarkComplete?: () => void;
  /**
   * Called whenever the service mutates persisted state that the host panels
   * may need to re-render (e.g. `toolsAvailable` flipped, pending-restart
   * list changed). Panels use this to trigger a webview refresh.
   */
  onStatusChanged?: () => void;
}

/** Pre-built config for HostToolInstallView */
export const HOST_TOOL_INSTALL_VIEW_CONFIG: HostToolsServiceConfig = {
  errorLabel: 'Host Tools',
  recheckAfterBatchInstall: false,
  markCompleteMessage: 'Host tools marked as installed. You can proceed with workspace setup.',
};

/**
 * Shared host tools installation logic used by both HostToolInstallView and SetupPanel.
 */
export class HostToolsService {
  private _stateRefs: HostToolsStateRefs = {};

  constructor(
    private readonly webview: vscode.Webview,
    private readonly config: HostToolsServiceConfig
  ) { }

  /**
   * Provide live references to the extension context and current configs.
   * Callers should invoke this whenever wsConfig/globalConfig are reloaded so
   * subsequent installs persist their pending-restart entries correctly.
   */
  setStateRefs(refs: HostToolsStateRefs): void {
    this._stateRefs = refs;
  }

  private post(command: string, data?: Record<string, any>) {
    this.webview.postMessage({ command, ...data });
  }

  /**
   * Persist `pendingRestart` for a single package into globalConfig. Called
   * after install attempts to save the restart-needed state across reloads.
   */
  private async persistPendingRestart(packageName: string, pendingRestart: boolean): Promise<void> {
    const { context, wsConfig, globalConfig } = this._stateRefs;
    if (!context || !wsConfig || !globalConfig) {
      return;
    }
    const list = globalConfig.pendingRestartPackages ?? [];
    const idx = list.indexOf(packageName);
    let changed = false;
    if (pendingRestart && idx === -1) {
      list.push(packageName);
      changed = true;
    } else if (!pendingRestart && idx !== -1) {
      list.splice(idx, 1);
      changed = true;
    }
    if (changed) {
      globalConfig.pendingRestartPackages = list;
      await saveSetupState(context, wsConfig, globalConfig);
      this.config.onStatusChanged?.();
    }
  }

  /**
   * If every package check_command succeeds, set `toolsAvailable = true` and
   * persist. This auto-clears the "Setup Required" badge after a successful
   * install without requiring the user to click "Mark Complete".
   */
  private async maybeMarkToolsAvailable(): Promise<void> {
    const { context, wsConfig, globalConfig } = this._stateRefs;
    if (!context || !wsConfig || !globalConfig) {
      return;
    }
    const statuses = await checkAllPackages();
    const allAvailable = statuses.length > 0 && statuses.every(s => s.available);
    if (allAvailable && !globalConfig.toolsAvailable) {
      globalConfig.toolsAvailable = true;
      await saveSetupState(context, wsConfig, globalConfig);
      this.config.onStatusChanged?.();
    }
  }

  async checkStatus(): Promise<void> {
    try {
      // On Windows, refresh PATH from registry before running any detection.
      // VS Code's extension host inherits the PATH from the process that
      // launched VS Code. If winget or other tools were installed after
      // VS Code started, or if VS Code was launched from a context that did
      // not include the full user PATH (e.g. system-wide install in
      // Program Files), the inherited PATH may be missing entries such as
      // %LOCALAPPDATA%\Microsoft\WindowsApps (where winget lives) or the
      // directories for winget-managed tools (cmake, git, python, etc.).
      if (isWindows()) {
        await refreshWindowsPath();
      }

      const manager = await getPackageManagerForPlatformAsync();
      if (!manager) {
        this.post(HOST_TOOLS_COMMANDS.updateStatus, { error: 'Unsupported platform' });
        return;
      }

      const managerAvailable = await checkPackageManagerAvailable();
      const packages = await getPlatformPackages();
      const pendingRestartList = this._stateRefs.globalConfig?.pendingRestartPackages ?? [];

      // On Windows, check whether the LongPathsEnabled registry key is set.
      const windowsLongPathsEnabled = isWindows()
        ? await checkWindowsLongPathsEnabled()
        : undefined;

      // On Windows, check whether 7-Zip is optionally installed.
      const sevenZipAvailable = isWindows() ? check7ZipAvailable() : undefined;

      // Send the full package list immediately with `checking: true` so the UI
      // can render every card with a "Checking…" spinner right away. Packages
      // marked as pending-restart from a previous install (and persisted across
      // window reload) are surfaced so the badge re-appears immediately.
      const initialStatuses = packages.map(pkg => ({
        name: pkg.name,
        package: pkg.package,
        available: false,
        pendingRestart: pendingRestartList.includes(pkg.name) || undefined,
      }));

      this.post(HOST_TOOLS_COMMANDS.updateStatus, {
        data: {
          managerName: manager.name,
          managerAvailable,
          managerInstallUrl: manager.config.install_url,
          packages: initialStatuses,
          checking: true,
          windowsLongPathsEnabled,
          sevenZipAvailable,
        },
      });

      // Check each package in parallel and post per-package updates as they
      // complete, so the user sees results stream in rather than waiting for
      // the entire batch.
      await Promise.all(packages.map(async (pkg) => {
        const status = await checkPackageAvailable(pkg);
        this.post(HOST_TOOLS_COMMANDS.packageChecked, {
          packageName: status.name,
          available: status.available,
        });
        // If this package was previously pending-restart and is now available,
        // clear it from the persisted list so the badge doesn't reappear next
        // window.
        if (status.available && pendingRestartList.includes(status.name)) {
          await this.persistPendingRestart(status.name, false);
        }
      }));

      // After all checks complete, see if all tools are now available and
      // auto-flip the global toolsAvailable flag if so.
      await this.maybeMarkToolsAvailable();
    } catch (error) {
      this.post(HOST_TOOLS_COMMANDS.updateStatus, { error: String(error) });
    }
  }

  async enableLongPaths(): Promise<void> {
    const success = await enableWindowsLongPaths();
    if (success) {
      void vscode.window.showInformationMessage('Windows long path support has been enabled. No restart is required.');
    } else {
      void vscode.window.showErrorMessage(
        'Could not enable Windows long path support. The UAC prompt may have been cancelled. ' +
        'You can enable it manually by running the following command in an elevated PowerShell prompt:\n' +
        'Set-ItemProperty -Path "HKLM:\\SYSTEM\\CurrentControlSet\\Control\\FileSystem" -Name "LongPathsEnabled" -Value 1'
      );
    }
    // Refresh status so the banner updates to reflect the new long paths state.
    await this.checkStatus();
  }

  async install7Zip(): Promise<void> {
    this.post('sevenZipInstalling', {});
    const success = await installPackage(SEVEN_ZIP_PKG);
    const available = check7ZipAvailable();
    this.post('sevenZipInstalled', { success, available });
    if (success) {
      if (!available) {
        notifyWarning('Host Tools', '7-Zip was installed but may not be on PATH yet. Close and reopen VS Code for it to take effect.');
      } else {
        void vscode.window.showInformationMessage('7-Zip installed successfully.');
      }
    } else {
      notifyError('Host Tools', 'Failed to install 7-Zip.');
    }
  }

  async installPackageManager(): Promise<void> {
    try {
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
    } catch (error) {
      notifyError(this.config.errorLabel, `Package manager installation error: ${error}`);
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

      this.post(HOST_TOOLS_COMMANDS.packageInstalling, {
        packageName,
        current: 1,
        total: 1,
      });

      const success = await installPackage(pkg);

      const packageStatuses = await checkAllPackages();
      const installedPkg = packageStatuses.find(p => p.name === packageName);
      const pendingRestart = !!(success && installedPkg && !installedPkg.available);

      // Persist pending-restart so the badge survives a window reload.
      if (success) {
        await this.persistPendingRestart(packageName, pendingRestart);
      }

      this.post(HOST_TOOLS_COMMANDS.packageInstalled, {
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
          // A successful install where the package is now available may have
          // completed the host-tools requirement; auto-flip toolsAvailable.
          await this.maybeMarkToolsAvailable();
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
      this.post(HOST_TOOLS_COMMANDS.startInstallAll);
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
      // Resolve the package manager once and reuse it for every installPackage()
      // call below, avoiding N redundant async platform-detection lookups.
      const manager = await getPackageManagerForPlatformAsync();

      this.post(HOST_TOOLS_COMMANDS.installAllStarted, { total: totalCount });

      let installedCount = 0;
      let hasErrors = false;

      const packagesToInstall = packageNames
        .map((packageName) => packages.find(p => p.name === packageName))
        .filter((pkg): pkg is NonNullable<typeof pkg> => !!pkg);

      // On Linux/apt, run one batch install command so sudo prompts once for
      // the bulk install operation instead of once per package task.
      if (manager?.name === 'apt' && packagesToInstall.length > 1) {
        for (const pkg of packagesToInstall) {
          this.post(HOST_TOOLS_COMMANDS.packageInstalling, {
            packageName: pkg.name,
            current: installedCount + 1,
            total: totalCount,
          });
          installedCount++;
        }

        const batchSuccess = await installPackagesBatch(packagesToInstall, manager);

        for (const pkg of packagesToInstall) {
          const installedPkg = await checkPackageAvailable(pkg);
          const success = batchSuccess;
          const pendingRestart = success && !installedPkg.available;

          if (success) {
            await this.persistPendingRestart(pkg.name, pendingRestart);
          }

          this.post(HOST_TOOLS_COMMANDS.packageInstalled, {
            packageName: pkg.name,
            success,
            pendingRestart,
            current: packageNames.indexOf(pkg.name) + 1,
            total: totalCount,
          });

          if (!success) {
            hasErrors = true;
          }
        }

        const packageStatuses = await checkAllPackages();
        const justInstalledNames = new Set(packageNames);
        const needsRestart = packageStatuses
          .filter(p => justInstalledNames.has(p.name))
          .some(p => !p.available);

        this.post(HOST_TOOLS_COMMANDS.installAllComplete, {
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

        await this.maybeMarkToolsAvailable();

        if (this.config.recheckAfterBatchInstall) {
          await this.checkStatus();
        }
        return;
      }

      for (const packageName of packageNames) {
        const pkg = packages.find(p => p.name === packageName);
        if (pkg) {
          this.post(HOST_TOOLS_COMMANDS.packageInstalling, {
            packageName: pkg.name,
            current: installedCount + 1,
            total: totalCount,
          });

          const success = await installPackage(pkg, manager ?? undefined);
          installedCount++;

          const installedPkg = await checkPackageAvailable(pkg);
          const pendingRestart = success && !installedPkg.available;

          // Persist pending-restart so the badge survives a window reload.
          if (success) {
            await this.persistPendingRestart(pkg.name, pendingRestart);
          }

          this.post(HOST_TOOLS_COMMANDS.packageInstalled, {
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

      this.post(HOST_TOOLS_COMMANDS.installAllComplete, {
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

      // After the batch, see if all tools are available now and auto-flip the
      // global toolsAvailable flag (clears "Setup Required" badges).
      await this.maybeMarkToolsAvailable();

      if (this.config.recheckAfterBatchInstall) {
        await this.checkStatus();
      }
    } catch (error) {
      notifyError(this.config.errorLabel, `Batch installation error: ${error}`);
      this.post(HOST_TOOLS_COMMANDS.installAllComplete, {
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

    // Notify listeners that toolsAvailable changed so the tree view and overview
    // panel can refresh their "Setup Required" / "Ready" status immediately.
    this.config.onStatusChanged?.();

    if (this.config.onMarkComplete) {
      this.config.onMarkComplete();
    }
  }

  async openManagerInstallUrl(): Promise<void> {
    const manager = await getPackageManagerForPlatformAsync();
    if (manager && manager.config.install_url) {
      void vscode.env.openExternal(vscode.Uri.parse(manager.config.install_url));
    }
  }
}
