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
  /**
   * True when this package was previously installed but is not yet visible on
   * PATH (typically because VS Code wasn't fully restarted after install). The
   * extension persists these across window reloads so the badge survives.
   */
  pendingRestart?: boolean;
}

export interface HostToolsStatusData {
  managerName: string;
  managerAvailable: boolean;
  managerInstallUrl?: string;
  packages: PackageStatus[];
  /** When true, all packages are pending their initial availability check. */
  checking?: boolean;
  /**
   * Windows-only: whether the LongPathsEnabled registry key is set to 1.
   * undefined when not running on Windows.
   */
  windowsLongPathsEnabled?: boolean;
  /** Windows-only: whether 7-Zip is optionally installed. undefined when not running on Windows. */
  sevenZipAvailable?: boolean;
}

export type PackageState = 'checking' | 'installing' | 'installed' | 'pending-restart' | 'error';

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
  enableWindowsLongPaths: 'enableWindowsLongPaths',
} as const;

const INBOUND_COMMANDS = {
  updateStatus: 'hostToolsUpdateStatus',
  packageChecked: 'hostToolsPackageChecked',
  startInstallAll: 'hostToolsStartInstallAll',
  installAllStarted: 'hostToolsInstallAllStarted',
  packageInstalling: 'hostToolsPackageInstalling',
  packageInstalled: 'hostToolsPackageInstalled',
  installAllComplete: 'hostToolsInstallAllComplete',
} as const;

// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------

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

  if (savedState === 'checking') {
    return {
      itemClass: 'checking',
      statusClass: 'status-checking',
      statusText: '<span class="codicon codicon-sync codicon-modifier-spin"></span> Checking',
      showInstallButton: false,
    };
  }
  if (savedState === 'installing') {
    return {
      itemClass: 'installing',
      statusClass: 'status-installing',
      statusText: '<span class="codicon codicon-sync codicon-modifier-spin"></span> Installing',
      showInstallButton: false,
    };
  }
  if (savedState === 'pending-restart') {
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
    const s = state.packageStates[pkg.name];
    // Exclude packages that are actively installing or already completed in this
    // session — they should not inflate the "Not Available" summary count.
    const clientResolved = s === 'pending-restart' || s === 'installing' || s === 'installed' || s === 'checking';
    if (!pkg.available && !clientResolved) {
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
  ) {
    document.addEventListener('click', (e: Event) => {
      const target = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
      if (!target) { return; }
      const action = target.getAttribute('data-action');
      const pkg = target.getAttribute('data-package') ?? '';
      switch (action) {
        case 'installPackage': this.installPackage(pkg); break;
        case 'installPackageManager': this.installPackageManager(); break;
        case 'openManagerInstallUrl': this.openManagerInstallUrl(); break;
        case 'navigateToSetup': this.navigateToSetup(); break;
      }
    });
  }

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

  enableWindowsLongPaths(): void {
    this.vscode.postMessage({ command: OUTBOUND_COMMANDS.enableWindowsLongPaths });
  }

  // -----------------------------------------------------------------------
  // Extension message handling
  // -----------------------------------------------------------------------

  /** Route an incoming message. Returns true if this client handled it. */
  handleMessage(message: Record<string, any>): boolean {
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
    if (cmd === INBOUND_COMMANDS.packageChecked) {
      this.handlePackageChecked(message.packageName, message.available);
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
      this.handlePackageInstalling(message.packageName, message.current, message.total, message.batch);
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

    if (packagesToInstall.length === 0) {
      // Nothing left to install — forward the empty list so the extension
      // surfaces its "already installed" message instead of this silently
      // no-oping and leaving the user unsure whether the click registered.
      this.vscode.postMessage({
        command: OUTBOUND_COMMANDS.installAllMissingPackages,
        packageNames: [],
      });
      return;
    }

    // Close the double-click race window: mark in-progress immediately so a
    // second rapid click sees the flag before the round-trip to the extension
    // returns with 'installAllStarted'.
    this.state.inProgress = true;

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

  private handlePackageInstalling(packageName: string, current: number, total: number, batch?: boolean): void {
    const installAllBtn = document.getElementById('install-all-btn');
    if (installAllBtn) {
      if (batch) {
        // All these packages install via a single package-manager command
        // (e.g. one apt invocation) — a per-package counter would be
        // misleading since none has "finished" independently of the others.
        const totalNum = Number(total);
        installAllBtn.innerHTML = `<vscode-icon slot="start-icon" name="loading" spin></vscode-icon> Installing ${totalNum} Package${totalNum === 1 ? '' : 's'}…`;
      } else if (total > 1) {
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

    // Keep the completion/error label visible for 2 seconds so the user can
    // read the outcome, then re-enable controls and refresh to the latest state.
    setTimeout(() => {
      this.disableAllButtons(false);
      this.refreshStatus();
    }, 2000);
  }

  // -----------------------------------------------------------------------
  // Status checking flow
  // -----------------------------------------------------------------------

  private handlePackageChecked(packageName: string, available: boolean): void {
    // Update the cached status data with the real check result.
    if (this.currentStatus) {
      const pkg = this.currentStatus.packages.find(p => p.name === packageName);
      if (pkg) {
        pkg.available = available;
      }
    }

    // Clear the 'checking' state — the package now shows its real status.
    // Keep a persisted 'pending-restart' state when the package is still not
    // available so the badge survives the post-check render.
    const prev = this.state.packageStates[packageName];
    if (prev === 'pending-restart' && !available) {
      // Leave pending-restart in place; the cached status now also reflects unavailable.
    } else {
      delete this.state.packageStates[packageName];
    }

    // Patch just this one card/row in-place.
    this.refreshSinglePackage(packageName);

    // Update summary counts and action buttons to reflect the new state.
    if (this.currentStatus) {
      this.updateSummary();
      const actuallyMissing = countMissing(this.currentStatus.packages, this.state);
      this.updateActionButtons(actuallyMissing, this.currentStatus.managerAvailable);
    }
  }

  /**
   * Re-render a single package card or table row from the current status data.
   * Unlike updatePackageCard (which maps a PackageState to fixed HTML), this
   * method uses getPackageDisplayInfo so the rendered output always reflects
   * the combined server + client state.
   */
  private refreshSinglePackage(packageName: string): void {
    if (!this.currentStatus) { return; }
    const pkg = this.currentStatus.packages.find(p => p.name === packageName);
    if (!pkg) { return; }

    const info = getPackageDisplayInfo(pkg, this.state, this.currentStatus.managerAvailable);

    const el = document.querySelector(`[data-package-name="${packageName}"]`) as HTMLElement | null;
    if (!el) { return; }

    el.classList.remove('available', 'missing', 'installing', 'pending-restart', 'checking');
    el.classList.add(info.itemClass);

    const badge = el.querySelector('.status-badge');
    if (badge) {
      badge.classList.remove('status-available', 'status-missing', 'status-installing', 'status-pending-restart', 'status-checking');
      badge.classList.add(info.statusClass);
      badge.innerHTML = info.statusText;
    }

    const actionArea = el.querySelector('.package-actions');
    if (actionArea) {
      const btn = actionArea.querySelector('vscode-button') as HTMLElement | null;
      if (btn) { btn.style.display = info.showInstallButton ? '' : 'none'; }
    }
  }

  /**
   * Update the summary counts box (cards mode) in-place without re-rendering
   * the full package list.
   */
  private updateSummary(): void {
    if (!this.currentStatus) { return; }

    const availableCount = this.currentStatus.packages.filter(
      p => p.available || this.state.packageStates[p.name] === 'installed'
    ).length;
    const actuallyMissing = countMissing(this.currentStatus.packages, this.state);
    const totalCount = this.currentStatus.packages.length;

    const summaryBox = document.querySelector('.summary-box');
    if (summaryBox) {
      const counts = summaryBox.querySelectorAll('.summary-count');
      if (counts.length >= 3) {
        counts[0].textContent = String(availableCount);
        counts[1].textContent = String(actuallyMissing);
        counts[2].textContent = String(totalCount);
      }
    }
  }

  // -----------------------------------------------------------------------
  // DOM rendering
  // -----------------------------------------------------------------------

  /**
   * Enable or disable install-related buttons only.
   * "Refresh Status" (#refresh-btn) and "Skip & Mark as Complete" (#mark-complete-btn)
   * are intentionally excluded so users can still check status or abort if an
   * installation hangs.
   */
  private disableAllButtons(disable: boolean): void {
    const installAllBtn = document.getElementById('install-all-btn');
    if (installAllBtn) { installAllBtn.toggleAttribute('disabled', disable); }
    document.querySelectorAll<HTMLElement>('.install-inline-btn').forEach(btn => {
      btn.toggleAttribute('disabled', disable);
    });
  }

  private displayError(error: string): void {
    const managerStatus = document.getElementById('manager-status');
    if (managerStatus) {
      managerStatus.innerHTML = `
        <div class="error-state">
          Error: ${escapeHtml(error)}
        </div>`;
    }
    const packagesStatus = document.getElementById('packages-status');
    if (packagesStatus) {
      packagesStatus.innerHTML = '';
    }
  }

  displayStatus(data: HostToolsStatusData): void {
    // When the extension signals that checks are starting, mark every package as
    // 'checking' so the initial render shows spinner indicators immediately.
    // Packages already known to be pending restart from a prior install (across
    // window reload) are surfaced with the pending-restart badge instead.
    if (data.checking) {
      for (const pkg of data.packages) {
        // Don't clobber an install-in-progress/just-completed card with a
        // generic 'checking' spinner — e.g. the user clicking Refresh (which
        // stays enabled during installs) would otherwise fight the install
        // UI for any package currently mid-install.
        const existing = this.state.packageStates[pkg.name];
        if (this.state.inProgress && (existing === 'installing' || existing === 'installed' || existing === 'error')) {
          continue;
        }
        if (pkg.pendingRestart) {
          this.state.packageStates[pkg.name] = 'pending-restart';
        } else {
          this.state.packageStates[pkg.name] = 'checking';
        }
      }
    }

    this.displayStatusCards(data);
  }

  private displayStatusCards(data: HostToolsStatusData): void {
    const managerHtml = `
      <div class="manager-status-box ${data.managerAvailable ? 'manager-available' : 'manager-unavailable'}">
        <div class="manager-info">
          <div>
            <div class="manager-name">${escapeHtml(data.managerName)}</div>
            <div class="manager-type-label">Package Manager</div>
          </div>
          <span class="status-badge ${data.managerAvailable ? 'status-available' : 'status-missing'}">
            ${data.managerAvailable ? '✓ Available' : '✗ Not Available'}
          </span>
        </div>
        ${!data.managerAvailable ? `
          <div class="manager-actions">
            ${data.managerInstallUrl
              ? `<p>The ${escapeHtml(data.managerName)} package manager is required but not installed.</p>
                 <vscode-button data-action="openManagerInstallUrl">Install ${escapeHtml(data.managerName)}</vscode-button>`
              : `<vscode-button data-action="installPackageManager">Install ${escapeHtml(data.managerName)}</vscode-button>`
            }
          </div>` : ''}
      </div>`;

    const el = document.getElementById('manager-status');
    if (el) { el.innerHTML = managerHtml; }

    // Include packages that have been installed in this session (client state
    // 'installed') so the Available count updates immediately without waiting
    // for the next status refresh from the extension.
    const availableCount = data.packages.filter(
      p => p.available || this.state.packageStates[p.name] === 'installed'
    ).length;
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
              ? `<vscode-button class="install-inline-btn" appearance="secondary" data-action="installPackage" data-package="${escapeHtml(pkg.name)}">Install</vscode-button>`
              : ''}
          </div>
        </div>`;
    }
    packagesHtml += '</div>';

    const pkgEl = document.getElementById('packages-status');
    if (pkgEl) { pkgEl.innerHTML = packagesHtml; }

    this.updateActionButtons(actuallyMissing, data.managerAvailable);
  }

  /** Post the 'openSetupPanel' command to navigate back to the setup panel. */
  navigateToSetup(): void {
    this.vscode.postMessage({ command: 'openSetupPanel' });
  }

  private updateActionButtons(actuallyMissing: number, managerAvailable: boolean): void {
    const installAllBtn = document.getElementById('install-all-btn');
    const markCompleteBtn = document.getElementById('mark-complete-btn');

    // Are any packages still waiting for their initial availability check?
    const stillChecking = this.currentStatus?.packages.some(
      p => this.state.packageStates[p.name] === 'checking'
    ) ?? false;

    if (installAllBtn && !this.state.inProgress) {
      if (stillChecking) {
        // Checks still running — show a spinner label and keep the button disabled.
        installAllBtn.setAttribute('disabled', '');
        installAllBtn.removeAttribute('data-action');
        installAllBtn.innerHTML = `<vscode-icon slot="start-icon" name="loading" spin></vscode-icon> Checking Packages\u2026`;
      } else if (actuallyMissing === 0) {
        // All tools are available — pivot the primary action button into a CTA
        // that takes the user to the next step instead of installing nothing.
        installAllBtn.removeAttribute('disabled');
        installAllBtn.setAttribute('data-action', 'navigateToSetup');
        installAllBtn.innerHTML = `<vscode-icon slot="start-icon" name="arrow-right"></vscode-icon> Open Setup Panel`;
      } else {
        // Normal install mode — reset in case button was previously in CTA mode.
        installAllBtn.removeAttribute('data-action');
        installAllBtn.toggleAttribute('disabled', !(managerAvailable && !this.state.inProgress));
        installAllBtn.innerHTML = `<vscode-icon slot="start-icon" name="cloud-download"></vscode-icon> Install All Missing Packages`;
      }
    } else if (installAllBtn) {
      installAllBtn.setAttribute('disabled', '');
    }

    if (markCompleteBtn) {
      // Keep the skip button enabled only when there are still missing tools
      // and all checks have finished; once everything is available the primary
      // CTA above serves as forward navigation, so "Skip" would be misleading.
      markCompleteBtn.toggleAttribute('disabled', stillChecking || !(actuallyMissing > 0));
    }
  }

  private updatePackageStatus(packageName: string, newState: PackageState): void {
    this.updatePackageCard(packageName, newState);
  }

  private updatePackageCard(packageName: string, state: PackageState): void {
    const packageItem = document.querySelector(`[data-package-name="${packageName}"]`) as HTMLElement | null;
    if (!packageItem) { return; }

    const statusBadge = packageItem.querySelector('.status-badge');
    const actionButtons = packageItem.querySelector('.package-actions');
    if (!statusBadge) { return; }

    packageItem.classList.remove('available', 'missing', 'installing', 'pending-restart', 'checking');
    statusBadge.classList.remove('status-available', 'status-missing', 'status-installing', 'status-pending-restart', 'status-checking');

    switch (state) {
      case 'checking':
        packageItem.classList.add('checking');
        statusBadge.classList.add('status-checking');
        statusBadge.innerHTML = '<span class="codicon codicon-sync codicon-modifier-spin"></span> Checking';
        if (actionButtons) {
          const installBtn = actionButtons.querySelector('vscode-button') as HTMLElement | null;
          if (installBtn) { installBtn.style.display = 'none'; }
        }
        break;
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
        // Hide the inline Install button — the package is now available
        if (actionButtons) {
          const installBtn = actionButtons.querySelector('vscode-button') as HTMLElement | null;
          if (installBtn) { installBtn.style.display = 'none'; }
        }
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

}
