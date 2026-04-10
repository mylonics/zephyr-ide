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

/**
 * Shared client-side logic for host tools installation UI.
 * Used by both host-tool-install.ts (standalone panel) and setup-panel.ts (embedded).
 */

import { WebviewApi, escapeHtml } from './webviewTypes';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PackageStatus {
  name: string;
  package: string;
  available: boolean;
}

export interface HostToolsStatusData {
  managerName: string;
  managerAvailable: boolean;
  managerInstallUrl?: string;
  packages: PackageStatus[];
}

export type PackageState = 'installing' | 'installed' | 'pending-restart' | 'error';

export interface InstallationState {
  inProgress: boolean;
  total: number;
  current: number;
  packageStates: Record<string, PackageState>;
}

/**
 * Unified command names used for host tools messages.
 * Outbound = webview → extension, Inbound = extension → webview.
 */
const OUTBOUND_COMMANDS = {
  checkStatus: 'hostToolsCheckStatus',
  installPackageManager: 'hostToolsInstallPackageManager',
  installPackage: 'hostToolsInstallPackage',
  installAllMissing: 'hostToolsInstallAllMissing',
  installAllMissingPackages: 'hostToolsInstallAllMissingPackages',
  openManagerInstallUrl: 'hostToolsOpenManagerInstallUrl',
} as const;

const INBOUND_COMMANDS = {
  updateStatus: 'hostToolsUpdateStatus',
  startInstallAll: 'hostToolsStartInstallAll',
  installAllStarted: 'hostToolsInstallAllStarted',
  packageInstalling: 'hostToolsPackageInstalling',
  packageInstalled: 'hostToolsPackageInstalled',
  installAllComplete: 'hostToolsInstallAllComplete',
} as const;

// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------

/** How the status of individual packages is rendered. */
export type PackageDisplayMode = 'cards' | 'table';

interface PackageDisplayInfo {
  statusClass: string;
  statusText: string;
  itemClass: string;
  showInstallButton: boolean;
}

function getPackageDisplayInfo(
  pkg: PackageStatus,
  state: InstallationState,
  managerAvailable: boolean
): PackageDisplayInfo {
  const savedState = state.packageStates[pkg.name];
  const isInstalling = savedState === 'installing';
  const isPendingRestart = savedState === 'pending-restart';

  if (isInstalling) {
    return {
      itemClass: 'installing',
      statusClass: 'status-installing',
      statusText: '<span class="codicon codicon-sync codicon-modifier-spin"></span> Installing',
      showInstallButton: false,
    };
  }
  if (isPendingRestart) {
    return {
      itemClass: 'pending-restart',
      statusClass: 'status-pending-restart',
      statusText: '<span class="codicon codicon-warning"></span> Not Available Pending Restart',
      showInstallButton: false,
    };
  }
  if (pkg.available) {
    return {
      itemClass: 'available',
      statusClass: 'status-available',
      statusText: '✓ Installed',
      showInstallButton: false,
    };
  }
  return {
    itemClass: 'missing',
    statusClass: 'status-missing',
    statusText: '✗ Not Available',
    showInstallButton: managerAvailable,
  };
}

function countMissing(packages: PackageStatus[], state: InstallationState): number {
  let count = 0;
  for (const pkg of packages) {
    const isPendingRestart = state.packageStates[pkg.name] === 'pending-restart';
    if (!pkg.available && !isPendingRestart) {
      count++;
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// HostToolsClient
// ---------------------------------------------------------------------------

/**
 * Manages client-side state and DOM rendering for host tools installation.
 * Created once per webview entry point.
 */
export class HostToolsClient {
  readonly state: InstallationState = {
    inProgress: false,
    total: 0,
    current: 0,
    packageStates: {},
  };

  currentStatus: HostToolsStatusData | null = null;

  constructor(
    private readonly vscode: WebviewApi,
    private readonly displayMode: PackageDisplayMode,
  ) {}

  // -----------------------------------------------------------------------
  // Extension (outbound) commands
  // -----------------------------------------------------------------------

  refreshStatus(): void {
    this.vscode.postMessage({ command: OUTBOUND_COMMANDS.checkStatus });
  }

  installPackageManager(): void {
    this.vscode.postMessage({ command: OUTBOUND_COMMANDS.installPackageManager });
  }

  installPackage(packageName: string): void {
    this.vscode.postMessage({ command: OUTBOUND_COMMANDS.installPackage, packageName });
  }

  installAllMissing(): void {
    this.vscode.postMessage({ command: OUTBOUND_COMMANDS.installAllMissing });
  }

  openManagerInstallUrl(): void {
    this.vscode.postMessage({ command: OUTBOUND_COMMANDS.openManagerInstallUrl });
  }

  // -----------------------------------------------------------------------
  // Extension message handling
  // -----------------------------------------------------------------------

  /** Route an incoming message. Returns true if this client handled it. */
  handleMessage(message: any): boolean {
    const cmd = message.command;

    if (cmd === INBOUND_COMMANDS.updateStatus) {
      if (message.error) {
        this.displayError(message.error);
      } else {
        this.currentStatus = message.data;
        this.displayStatus(message.data);
      }
      return true;
    }
    if (cmd === INBOUND_COMMANDS.startInstallAll) {
      this.handleStartInstallAll();
      return true;
    }
    if (cmd === INBOUND_COMMANDS.installAllStarted) {
      this.handleInstallAllStarted(message.total);
      return true;
    }
    if (cmd === INBOUND_COMMANDS.packageInstalling) {
      this.handlePackageInstalling(message.packageName, message.current, message.total);
      return true;
    }
    if (cmd === INBOUND_COMMANDS.packageInstalled) {
      this.handlePackageInstalled(message.packageName, message.success, message.pendingRestart, message.current, message.total);
      return true;
    }
    if (cmd === INBOUND_COMMANDS.installAllComplete) {
      this.handleInstallAllComplete(message.needsRestart, message.hasErrors);
      return true;
    }
    return false;
  }

  // -----------------------------------------------------------------------
  // Installation flow
  // -----------------------------------------------------------------------

  private handleStartInstallAll(): void {
    if (!this.currentStatus || this.state.inProgress) {
      return;
    }

    const packagesToInstall: string[] = [];
    for (const pkg of this.currentStatus.packages) {
      const savedState = this.state.packageStates[pkg.name];
      if (!pkg.available && savedState !== 'pending-restart' && savedState !== 'installing') {
        packagesToInstall.push(pkg.name);
      }
    }

    this.vscode.postMessage({
      command: OUTBOUND_COMMANDS.installAllMissingPackages,
      packageNames: packagesToInstall,
    });
  }

  private handleInstallAllStarted(total: number): void {
    this.state.inProgress = true;
    this.state.total = total;
    this.state.current = 0;

    const installAllBtn = document.getElementById('install-all-btn');
    if (installAllBtn) {
      installAllBtn.setAttribute('disabled', '');
      installAllBtn.innerHTML = `<vscode-icon slot="start-icon" name="loading" spin></vscode-icon> Installing Packages (0/${total})`;
    }

    this.disableAllButtons(true);
  }

  private handlePackageInstalling(packageName: string, current: number, total: number): void {
    if (total > 1) {
      const installAllBtn = document.getElementById('install-all-btn');
      if (installAllBtn) {
        const currentNum = Number(current);
        const totalNum = Number(total);
        installAllBtn.innerHTML = `<vscode-icon slot="start-icon" name="loading" spin></vscode-icon> Installing Packages (${currentNum}/${totalNum})`;
      }
    }

    this.state.packageStates[packageName] = 'installing';
    this.updatePackageStatus(packageName, 'installing');
  }

  private handlePackageInstalled(
    packageName: string,
    success: boolean,
    pendingRestart: boolean,
    current: number,
    _total: number,
  ): void {
    this.state.current = current;

    let newState: PackageState;
    if (!success) {
      newState = 'error';
    } else if (pendingRestart) {
      newState = 'pending-restart';
    } else {
      newState = 'installed';
    }

    this.state.packageStates[packageName] = newState;
    this.updatePackageStatus(packageName, newState);
  }

  private handleInstallAllComplete(needsRestart: boolean, hasErrors: boolean): void {
    this.state.inProgress = false;

    const installAllBtn = document.getElementById('install-all-btn');
    if (installAllBtn) {
      if (needsRestart) {
        installAllBtn.innerHTML = `<vscode-icon slot="start-icon" name="warning"></vscode-icon> Pending Restart`;
      } else if (hasErrors) {
        installAllBtn.innerHTML = `<vscode-icon slot="start-icon" name="error"></vscode-icon> Installation Failed`;
      } else {
        installAllBtn.innerHTML = `<vscode-icon slot="start-icon" name="check"></vscode-icon> All Packages Installed`;
      }
    }

    setTimeout(() => {
      this.disableAllButtons(false);
      this.refreshStatus();
    }, 2000);
  }

  // -----------------------------------------------------------------------
  // DOM rendering
  // -----------------------------------------------------------------------

  private disableAllButtons(disable: boolean): void {
    document.querySelectorAll('vscode-button').forEach(btn => {
      btn.toggleAttribute('disabled', disable);
    });
  }

  private displayError(error: string): void {
    const managerStatus = document.getElementById('manager-status');
    if (managerStatus) {
      managerStatus.innerHTML = `
        <div style="padding: 20px; text-align: center; color: var(--vscode-errorForeground);">
          Error: ${escapeHtml(error)}
        </div>`;
    }
    const packagesStatus = document.getElementById('packages-status');
    if (packagesStatus) {
      packagesStatus.innerHTML = '';
    }
  }

  displayStatus(data: HostToolsStatusData): void {
    if (this.displayMode === 'cards') {
      this.displayStatusCards(data);
    } else {
      this.displayStatusTable(data);
    }
  }

  // ---- Cards mode (used by standalone HostToolInstallView) ----

  private displayStatusCards(data: HostToolsStatusData): void {
    const managerHtml = `
      <div class="manager-status-box ${data.managerAvailable ? 'manager-available' : 'manager-unavailable'}">
        <div class="manager-info">
          <div>
            <div class="manager-name">${escapeHtml(data.managerName)}</div>
            <div style="font-size: 12px; color: var(--vscode-descriptionForeground);">Package Manager</div>
          </div>
          <span class="status-badge ${data.managerAvailable ? 'status-available' : 'status-missing'}">
            ${data.managerAvailable ? '✓ Available' : '✗ Not Available'}
          </span>
        </div>
        ${!data.managerAvailable ? `
          <div style="margin-top: 10px;">
            ${data.managerInstallUrl
              ? `<p style="margin-bottom: 10px; font-size: 12px;">The ${escapeHtml(data.managerName)} package manager is required but not installed.</p>
                 <vscode-button onclick="hostToolsClient.openManagerInstallUrl()">Install ${escapeHtml(data.managerName)}</vscode-button>`
              : `<vscode-button onclick="hostToolsClient.installPackageManager()">Install ${escapeHtml(data.managerName)}</vscode-button>`
            }
          </div>` : ''}
      </div>`;

    const el = document.getElementById('manager-status');
    if (el) { el.innerHTML = managerHtml; }

    const availableCount = data.packages.filter(p => p.available).length;
    const actuallyMissing = countMissing(data.packages, this.state);
    const totalCount = data.packages.length;

    let packagesHtml = `
      <div class="summary-box">
        <div class="summary-item"><div class="summary-count available">${availableCount}</div><div class="summary-label">Available</div></div>
        <div class="summary-item"><div class="summary-count missing">${actuallyMissing}</div><div class="summary-label">Not Available</div></div>
        <div class="summary-item"><div class="summary-count">${totalCount}</div><div class="summary-label">Total</div></div>
      </div>
      <div class="package-list">`;

    for (const pkg of data.packages) {
      const info = getPackageDisplayInfo(pkg, this.state, data.managerAvailable);
      packagesHtml += `
        <div class="package-item ${info.itemClass}" data-package-name="${escapeHtml(pkg.name)}">
          <div class="package-info">
            <div class="package-name">${escapeHtml(pkg.name)}</div>
            <div class="package-package">${escapeHtml(pkg.package)}</div>
          </div>
          <div class="package-actions">
            <span class="status-badge ${info.statusClass}">${info.statusText}</span>
            ${info.showInstallButton
              ? `<vscode-button appearance="secondary" onclick="hostToolsClient.installPackage('${escapeHtml(pkg.name)}')" style="padding: 2px 8px; min-height: 0;">Install</vscode-button>`
              : ''}
          </div>
        </div>`;
    }
    packagesHtml += '</div>';

    const pkgEl = document.getElementById('packages-status');
    if (pkgEl) { pkgEl.innerHTML = packagesHtml; }

    this.updateActionButtons(actuallyMissing, data.managerAvailable);
  }

  // ---- Table mode (used by SetupPanel embedded view) ----

  private displayStatusTable(data: HostToolsStatusData): void {
    const managerStatus = document.getElementById('manager-status');
    const packagesStatus = document.getElementById('packages-status');

    if (managerStatus) {
      if (!data.managerAvailable) {
        managerStatus.innerHTML = `
          <div class="warning">
            <strong>${escapeHtml(data.managerName)}</strong> is not installed or not in PATH.
            <div style="margin-top: 10px;">
              <vscode-button appearance="secondary" onclick="hostToolsClient.installPackageManager()">
                Install ${escapeHtml(data.managerName)}
              </vscode-button>
            </div>
          </div>`;
      } else {
        managerStatus.innerHTML = `
          <div class="success">✓ <strong>${escapeHtml(data.managerName)}</strong> is available</div>`;
      }
    }

    if (!packagesStatus) { return; }

    if (!data.packages || data.packages.length === 0) {
      packagesStatus.innerHTML = '<div class="info">No packages to check</div>';
      return;
    }

    let html = '<table class="packages-table"><thead><tr><th>Package</th><th>Status</th><th>Action</th></tr></thead><tbody>';
    let actuallyMissing = false;

    for (const pkg of data.packages) {
      const info = getPackageDisplayInfo(pkg, this.state, data.managerAvailable);
      if (info.showInstallButton) { actuallyMissing = true; }

      html += `<tr data-package-name="${escapeHtml(pkg.name)}">
        <td><strong>${escapeHtml(pkg.name)}</strong></td>
        <td><span class="${info.statusClass}">${info.statusText}</span></td>
        <td>${info.showInstallButton
          ? `<vscode-button appearance="secondary" onclick="hostToolsClient.installPackage('${escapeHtml(pkg.name)}')" style="padding: 2px 8px; min-height: 0;">Install</vscode-button>`
          : ''}</td>
      </tr>`;
    }

    html += '</tbody></table>';
    packagesStatus.innerHTML = html;

    const installAllBtn = document.getElementById('install-all-btn');
    if (installAllBtn) {
      installAllBtn.toggleAttribute('disabled', !actuallyMissing || !data.managerAvailable || this.state.inProgress);
    }
  }

  private updateActionButtons(actuallyMissing: number, managerAvailable: boolean): void {
    const installAllBtn = document.getElementById('install-all-btn');
    const markCompleteBtn = document.getElementById('mark-complete-btn');

    if (installAllBtn) {
      installAllBtn.toggleAttribute('disabled', !(actuallyMissing > 0 && managerAvailable && !this.state.inProgress));
    }
    if (markCompleteBtn) {
      markCompleteBtn.toggleAttribute('disabled', !(actuallyMissing > 0));
    }
  }

  // ---- In-place row update (works for both cards and table modes) -----

  private updatePackageStatus(packageName: string, newState: string): void {
    if (this.displayMode === 'cards') {
      this.updatePackageCard(packageName, newState);
    } else {
      this.updatePackageRow(packageName, newState);
    }
  }

  private updatePackageCard(packageName: string, state: string): void {
    const packageItem = document.querySelector(`[data-package-name="${packageName}"]`) as HTMLElement | null;
    if (!packageItem) { return; }

    const statusBadge = packageItem.querySelector('.status-badge');
    const actionButtons = packageItem.querySelector('.package-actions');
    if (!statusBadge) { return; }

    packageItem.classList.remove('available', 'missing', 'installing', 'pending-restart');
    statusBadge.classList.remove('status-available', 'status-missing', 'status-installing', 'status-pending-restart');

    switch (state) {
      case 'installing':
        packageItem.classList.add('installing');
        statusBadge.classList.add('status-installing');
        statusBadge.innerHTML = '<span class="codicon codicon-sync codicon-modifier-spin"></span> Installing';
        if (actionButtons) {
          const installBtn = actionButtons.querySelector('vscode-button') as HTMLElement | null;
          if (installBtn) { installBtn.style.display = 'none'; }
        }
        break;
      case 'installed':
        packageItem.classList.add('available');
        statusBadge.classList.add('status-available');
        statusBadge.innerHTML = '✓ Installed';
        break;
      case 'pending-restart':
        packageItem.classList.add('pending-restart');
        statusBadge.classList.add('status-pending-restart');
        statusBadge.innerHTML = '<span class="codicon codicon-warning"></span> Not Available Pending Restart';
        break;
      case 'error':
      default:
        packageItem.classList.add('missing');
        statusBadge.classList.add('status-missing');
        statusBadge.innerHTML = '✗ Installation Failed';
        break;
    }
  }

  private updatePackageRow(packageName: string, state: string): void {
    const row = document.querySelector(`tr[data-package-name="${packageName}"]`) as HTMLElement | null;
    if (!row) { return; }

    const statusCell = row.querySelector('td:nth-child(2)');
    const actionCell = row.querySelector('td:nth-child(3)');
    if (!statusCell) { return; }

    switch (state) {
      case 'installing':
        statusCell.innerHTML = '<span class="info"><span class="codicon codicon-sync codicon-modifier-spin"></span> Installing</span>';
        if (actionCell) { actionCell.innerHTML = ''; }
        break;
      case 'installed':
        statusCell.innerHTML = '<span class="success">✓ Installed</span>';
        if (actionCell) { actionCell.innerHTML = ''; }
        break;
      case 'pending-restart':
        statusCell.innerHTML = '<span class="warning"><span class="codicon codicon-warning"></span> Not Available Pending Restart</span>';
        if (actionCell) { actionCell.innerHTML = ''; }
        break;
      case 'error':
        statusCell.innerHTML = '<span class="error">✗ Installation Failed</span>';
        break;
    }
  }
}
