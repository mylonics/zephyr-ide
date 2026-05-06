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

import { html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { ZephyrLitElement } from "../../webview_shared/lit-base";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SDKVersion {
  version?: string;
  path?: string;
  installedToolchains?: string[];
  availableToolchains?: string[];
}

interface SDKListData {
  success: boolean;
  versions?: SDKVersion[];
  error?: string;
}

interface SetupProgressStep {
  id: string;
  label: string;
  status: string;
  detail?: string;
}

interface SetupProgressData {
  type: "start" | "step-update" | "complete" | "failed";
  operationLabel: string;
  steps: SetupProgressStep[];
  message?: string;
}

interface SDKPanelInitData {
  hasSetupState: boolean;
  sdkInstalled: boolean;
  sdkVersionMap?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Toolchain architecture grouping
// ---------------------------------------------------------------------------

interface ArchGroup {
  label: string;
  prefixes: string[];
}

const ARCH_GROUPS: ArchGroup[] = [
  { label: "ARM / AArch64", prefixes: ["arm-", "aarch64-"] },
  { label: "ARC", prefixes: ["arc-", "arc64-"] },
  { label: "RISC-V", prefixes: ["riscv64-"] },
  { label: "Xtensa", prefixes: ["xtensa-"] },
  { label: "x86", prefixes: ["x86_64-"] },
  { label: "MIPS", prefixes: ["mips-"] },
  { label: "Nios II", prefixes: ["nios2-"] },
  { label: "SPARC", prefixes: ["sparc-"] },
  { label: "MicroBlaze", prefixes: ["microblazeel-"] },
];

/** Group an array of toolchain names by architecture family. */
function groupToolchains(toolchains: string[]): Array<{ label: string; items: string[] }> {
  const buckets = new Map<string, string[]>();
  for (const tc of toolchains) {
    let matched = false;
    for (const group of ARCH_GROUPS) {
      if (group.prefixes.some(p => tc.startsWith(p))) {
        const bucket = buckets.get(group.label) ?? [];
        bucket.push(tc);
        buckets.set(group.label, bucket);
        matched = true;
        break;
      }
    }
    if (!matched) {
      // Catch-all bucket for toolchains that don't match any known architecture prefix.
      // These may be new toolchains added in a future SDK release not yet listed in ARCH_GROUPS.
      const bucket = buckets.get("Other") ?? [];
      bucket.push(tc);
      buckets.set("Other", bucket);
    }
  }
  return Array.from(buckets.entries()).map(([label, items]) => ({ label, items }));
}

/**
 * Compare two semver strings numerically, descending (newest first).
 * Falls back to locale compare for any non-semver strings.
 */
function compareSemverDesc(a: string, b: string): number {
  const parse = (v: string) => v.split(".").map(n => parseInt(n, 10));
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pb[i] ?? 0) - (pa[i] ?? 0);
    if (diff !== 0) { return diff; }
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

@customElement("sdk-app")
export class SDKApp extends ZephyrLitElement {
  @state() private _initData: SDKPanelInitData | undefined;
  @state() private _sdkList: SDKListData | undefined;
  @state() private _sdkLoading = false;
  @state() private _progressData: SetupProgressData | undefined;
  @state() private _buttonsDisabled = false;
  /** SDK versions (by string) whose "Not Installed" toolchains panel is expanded. */
  @state() private _expandedUnavailable = new Set<string>();
  /**
   * Pending toolchain changes keyed by SDK version string.
   * `adds` = toolchains the user wants to install.
   * `removes` = installed toolchains the user wants to uninstall.
   */
  @state() private _pendingAdds = new Map<string, Set<string>>();
  @state() private _pendingRemoves = new Map<string, Set<string>>();

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("message", this._onMessage);
    this.vscodeApi.postMessage({ command: "ready" });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("message", this._onMessage);
  }

  private _onMessage = (event: MessageEvent) => {
    const msg = event.data;
    switch (msg.command) {
      case "updateContent":
        this._initData = msg.data;
        break;
      case "sdkListResult":
        this._sdkLoading = false;
        this._sdkList = msg.data;
        this._buttonsDisabled = false;
        // Clear all pending changes — the list is freshly loaded from disk
        this._pendingAdds = new Map();
        this._pendingRemoves = new Map();
        // Auto-expand the "Not Installed" section for any SDK version that has no
        // installed toolchains yet, so the user can immediately see what's available.
        // Only auto-expand versions not yet tracked — preserves manual collapse state
        // so user-collapsed sections do not re-open on subsequent list refreshes.
        if (msg.data?.versions) {
          const autoExpanded = new Set<string>(this._expandedUnavailable);
          for (const v of (msg.data.versions as SDKVersion[])) {
            const ver = v.version ?? "Unknown";
            if (!autoExpanded.has(ver) &&
              (v.installedToolchains?.length ?? 0) === 0 &&
              (v.availableToolchains?.length ?? 0) > 0) {
              autoExpanded.add(ver);
            }
          }
          this._expandedUnavailable = autoExpanded;
        }
        break;
      case "sdkListLoading":
        this._sdkLoading = true;
        break;
      case "sdkInstallProgress":
        this._handleProgress(msg.data);
        break;
    }
  };

  private _handleProgress(data: SetupProgressData) {
    this._progressData = data;
    if (data.type === "complete" || data.type === "failed") {
      this._buttonsDisabled = false;
    }
  }

  private _installSDK() {
    this._buttonsDisabled = true;
    this.vscodeApi.postMessage({ command: "installSDK" });
  }

  private _listSDKs() {
    this._sdkLoading = true;
    this._buttonsDisabled = true;
    this.vscodeApi.postMessage({ command: "listSDKs" });
  }

  private _addToolchainsForVersion(version: string) {
    this._buttonsDisabled = true;
    this.vscodeApi.postMessage({ command: "addToolchainsForVersion", version });
  }

  private _dismissProgress() {
    this._progressData = undefined;
  }

  private _toggleUnavailable(version: string) {
    const next = new Set(this._expandedUnavailable);
    if (next.has(version)) {
      next.delete(version);
    } else {
      next.add(version);
    }
    this._expandedUnavailable = next;
  }

  /** Toggle a toolchain's pending state for a given SDK version. */
  private _toggleToolchain(version: string, toolchain: string, isInstalled: boolean) {
    if (isInstalled) {
      // Toggle pending-remove
      const removes = new Map(this._pendingRemoves);
      const set = new Set(removes.get(version) ?? []);
      if (set.has(toolchain)) {
        set.delete(toolchain);
      } else {
        set.add(toolchain);
      }
      removes.set(version, set);
      this._pendingRemoves = removes;
    } else {
      // Toggle pending-add
      const adds = new Map(this._pendingAdds);
      const set = new Set(adds.get(version) ?? []);
      if (set.has(toolchain)) {
        set.delete(toolchain);
      } else {
        set.add(toolchain);
      }
      adds.set(version, set);
      this._pendingAdds = adds;
    }
  }

  /** Send the pending changes for a version to the backend and clear local state. */
  private _applyChanges(version: string) {
    const toAdd = Array.from(this._pendingAdds.get(version) ?? []);
    const toRemove = Array.from(this._pendingRemoves.get(version) ?? []);
    if (toAdd.length === 0 && toRemove.length === 0) { return; }
    this._buttonsDisabled = true;
    this.vscodeApi.postMessage({ command: "applyToolchainChanges", version, toAdd, toRemove });
  }

  render() {
    if (!this._initData) {
      return html`<div class="container"><p>Loading…</p></div>`;
    }

    const d = this._initData;
    const statusIcon = d.sdkInstalled ? "✓" : d.hasSetupState ? "⚙" : "⚠";
    const statusLabel = d.sdkInstalled ? "Installed" : d.hasSetupState ? "Not Installed" : "Workspace Required";
    const statusClass = d.sdkInstalled ? "status-success" : d.hasSetupState ? "status-warning" : "status-error";

    return html`
      <div class="container">
        <div class="breadcrumb">
          <a class="breadcrumb-link" @click=${() => this.postCommand("openSetupPanel")}>← Setup & Configuration</a>
          <span class="breadcrumb-separator">/</span>
          <span class="breadcrumb-current">Zephyr SDK</span>
        </div>
        <div class="page-header">
          <div style="display:flex;align-items:center;gap:12px;">
            <h1 class="page-title">Zephyr SDK</h1>
            <span class="header-status-badge ${statusClass}">${statusIcon} ${statusLabel}</span>
          </div>
          <div class="header-actions">
            <vscode-button ?disabled=${!d.hasSetupState || this._buttonsDisabled} @click=${() => this._installSDK()}>
              <vscode-icon slot="start-icon" name="cloud-download"></vscode-icon>
              Install / Update
            </vscode-button>
            <vscode-button appearance="secondary" ?disabled=${!d.hasSetupState || this._buttonsDisabled} @click=${() => this._listSDKs()}>
              <vscode-icon slot="start-icon" name="refresh"></vscode-icon>
              Refresh
            </vscode-button>
          </div>
        </div>

        <p class="sdk-description">
          The Zephyr SDK provides GNU toolchains for cross-compiling to supported target architectures.
          Click any toolchain chip to toggle it for installation or removal, then click
          <strong>Apply Changes</strong> on the SDK version card to install or uninstall the selected toolchains.
        </p>

        ${!d.hasSetupState
        ? html`<div class="error-box">
              <p class="no-margin">
                <strong>No West Workspace Found</strong><br>
                A west workspace must be set up before SDK toolchains can be installed or managed.
                Set up a workspace first using the Setup panel.
              </p>
            </div>`
        : nothing}

        ${this._renderProgress()}
        ${this._renderSDKList()}
      </div>
    `;
  }

  private _renderProgress() {
    const data = this._progressData;
    if (!data) { return nothing; }

    let bannerClass: string, bannerIcon: string, bannerText: string;
    switch (data.type) {
      case "complete":
        bannerClass = "status-success";
        bannerIcon = '<span class="codicon codicon-check"></span>';
        bannerText = "Installation Complete";
        break;
      case "failed":
        bannerClass = "status-error";
        bannerIcon = '<span class="codicon codicon-error"></span>';
        bannerText = "Installation Failed";
        break;
      default:
        bannerClass = "status-info";
        bannerIcon = "";
        bannerText = "Installing SDK...";
        break;
    }

    const showSpinner = data.type === "start" || data.type === "step-update";
    const showDismiss = data.type === "complete" || data.type === "failed";

    return html`
      <div class="setup-progress-panel">
        <div class="setup-progress-header ${bannerClass}">
          ${showSpinner ? html`<vscode-progress-ring></vscode-progress-ring>` : nothing}
          <span class="status-icon" .innerHTML=${bannerIcon}></span>
          <span class="setup-progress-title">${data.operationLabel} — ${bannerText}</span>
          ${showDismiss
        ? html`<button class="setup-progress-dismiss" @click=${() => this._dismissProgress()} title="Dismiss"><span class="codicon codicon-close"></span></button>`
        : nothing}
        </div>
        <div class="setup-progress-body">
          <div class="setup-progress-steps">
            ${data.steps.map(step => this._renderStep(step))}
          </div>
          ${data.message ? html`<p class="setup-progress-message">${data.message}</p>` : nothing}
          ${data.type === "failed"
        ? html`<div style="margin-top: 8px;"><vscode-button appearance="secondary" @click=${() => this._installSDK()}><vscode-icon slot="start-icon" name="refresh"></vscode-icon>Retry Installation</vscode-button></div>`
        : nothing}
        </div>
      </div>
    `;
  }

  private _renderStep(step: SetupProgressStep) {
    return html`
      <div class="setup-step-item ${step.status}">
        ${this._stepIcon(step.status)}
        <div class="setup-step-content">
          <span class="setup-step-label">${step.label}</span>
          ${step.detail ? html`<span class="setup-step-detail">${step.detail}</span>` : nothing}
        </div>
      </div>
    `;
  }

  private _stepIcon(status: string) {
    switch (status) {
      case "completed":
        return html`<span class="setup-step-icon completed"><span class="codicon codicon-check"></span></span>`;
      case "in-progress":
        return html`<span class="setup-step-icon in-progress"><span class="codicon codicon-sync codicon-modifier-spin"></span></span>`;
      case "failed":
        return html`<span class="setup-step-icon failed"><span class="codicon codicon-error"></span></span>`;
      case "skipped":
        return html`<span class="setup-step-icon skipped"><span class="codicon codicon-dash"></span></span>`;
      default:
        return html`<span class="setup-step-icon pending"><span class="codicon codicon-circle-outline"></span></span>`;
    }
  }

  private _renderSDKList() {
    if (this._sdkLoading) {
      return html`<div class="sdk-list-container"><div class="sdk-loading"><vscode-progress-ring></vscode-progress-ring><span>Loading SDK information...</span></div></div>`;
    }

    const data = this._sdkList;
    if (!data) {
      return html`<div class="sdk-list-container"></div>`;
    }

    if (!data.success) {
      return html`
        <div class="sdk-list-container">
          <div class="sdk-error-box">
            <strong>Error:</strong> ${data.error || "Failed to list SDKs"}
            <div style="margin-top: 10px;">
              <vscode-button appearance="secondary" @click=${() => this._listSDKs()}>
                <vscode-icon slot="start-icon" name="refresh"></vscode-icon>
                Retry
              </vscode-button>
            </div>
          </div>
        </div>
      `;
    }

    if (!data.versions || data.versions.length === 0) {
      return html`
        <div class="sdk-list-container">
          <div class="sdk-empty-box">No SDK versions found. Try installing an SDK first.</div>
        </div>
      `;
    }

    const sorted = [...data.versions].sort((a, b) =>
      compareSemverDesc(a.version ?? "", b.version ?? "")
    );

    return html`
      <div class="sdk-list-container">
        ${this._renderSDKSummary(data.versions)}
        ${sorted.map(v => this._renderSDKVersion(v))}
      </div>
    `;
  }

  /** Top-level summary bar when at least one SDK is present. */
  private _renderSDKSummary(versions: SDKVersion[]) {
    const totalInstalled = versions.reduce((acc, v) => acc + (v.installedToolchains?.length ?? 0), 0);
    // Use a Set to deduplicate in case availableToolchains already includes installed ones
    const totalUnique = versions.reduce((acc, v) => {
      const unique = new Set([...(v.installedToolchains ?? []), ...(v.availableToolchains ?? [])]);
      return acc + unique.size;
    }, 0);

    return html`
      <div class="sdk-summary">
        <span class="sdk-summary-item">
          <span class="codicon codicon-package"></span>
          <strong>${versions.length}</strong> SDK version${versions.length !== 1 ? "s" : ""} installed
        </span>
        <span class="sdk-summary-sep">·</span>
        <span class="sdk-summary-item">
          <span class="codicon codicon-tools"></span>
          <strong>${totalInstalled}</strong> of <strong>${totalUnique}</strong> toolchains installed
        </span>
      </div>
    `;
  }

  private _renderSDKVersion(version: SDKVersion) {
    const ver = version.version ?? "Unknown";
    const installed = version.installedToolchains ?? [];
    const available = version.availableToolchains ?? [];
    const notInstalled = available.filter(tc => !installed.includes(tc));
    const total = installed.length + notInstalled.length;
    const isExpanded = this._expandedUnavailable.has(ver);
    const versionMap = this._initData?.sdkVersionMap ?? {};
    const zephyrLabel = versionMap[ver];

    const pendingAdds = this._pendingAdds.get(ver) ?? new Set<string>();
    const pendingRemoves = this._pendingRemoves.get(ver) ?? new Set<string>();
    const hasPending = pendingAdds.size > 0 || pendingRemoves.size > 0;

    return html`
      <div class="sdk-version-card">
        <!-- Card header -->
        <div class="sdk-version-header">
          <div class="sdk-version-title-row">
            <span class="sdk-version-title">Zephyr SDK ${ver}</span>
            ${zephyrLabel
        ? html`<span class="sdk-zephyr-compat">${zephyrLabel}</span>`
        : nothing}
          </div>
          <div class="sdk-card-actions">
            <span class="sdk-toolchain-count ${installed.length > 0 ? "has-toolchains" : ""}">
              ${installed.length} / ${total} toolchains
            </span>
          </div>
        </div>

        <!-- Install path -->
        <div class="sdk-path">
          <span class="codicon codicon-folder"></span>
          ${version.path ?? "—"}
        </div>

        <!-- Installed toolchains (always visible, grouped by arch) -->
        ${installed.length > 0
        ? html`
          <div class="toolchain-section">
            <div class="toolchain-section-title">
              <span class="codicon codicon-check-all"></span>
              Installed Toolchains (${installed.length})
            </div>
            ${this._renderSelectableToolchains(installed, ver, true)}
          </div>`
        : html`
          <div class="toolchain-section">
            <p class="sdk-no-toolchains">No toolchains installed yet. Select toolchains below and click <strong>Apply Changes</strong>.</p>
          </div>`}

        <!-- Available-but-not-installed toolchains (collapsible when some are installed) -->
        ${notInstalled.length > 0
        ? html`
          <div class="toolchain-section">
            ${installed.length > 0
            ? html`
              <button
                class="toolchain-toggle-btn"
                @click=${() => this._toggleUnavailable(ver)}
                aria-expanded=${isExpanded}
              >
                <span class="codicon ${isExpanded ? "codicon-chevron-down" : "codicon-chevron-right"}"></span>
                <span class="toolchain-section-title inline">Not Installed (${notInstalled.length})</span>
              </button>
              ${isExpanded
              ? html`<div class="toolchain-collapsible-body">${this._renderSelectableToolchains(notInstalled, ver, false)}</div>`
              : nothing}`
            : html`
              <div class="toolchain-section-title">
                <span class="codicon codicon-cloud-download"></span>
                Available Toolchains (${notInstalled.length})
              </div>
              ${this._renderSelectableToolchains(notInstalled, ver, false)}`}
          </div>`
        : nothing}

        <!-- Apply Changes bar -->
        ${hasPending
        ? html`
          <div class="sdk-apply-bar">
            <span class="sdk-apply-summary">
              ${pendingAdds.size > 0 ? html`<span class="tc-pending-add-badge">+${pendingAdds.size} to install</span>` : nothing}
              ${pendingRemoves.size > 0 ? html`<span class="tc-pending-remove-badge">−${pendingRemoves.size} to remove</span>` : nothing}
            </span>
            <vscode-button
              ?disabled=${this._buttonsDisabled}
              @click=${() => this._applyChanges(ver)}
            >
              <vscode-icon slot="start-icon" name="check"></vscode-icon>
              Apply Changes
            </vscode-button>
            <vscode-button
              appearance="secondary"
              ?disabled=${this._buttonsDisabled}
              @click=${() => this._discardChanges(ver)}
              title="Discard pending changes for this SDK version"
            >
              Discard
            </vscode-button>
          </div>`
        : nothing}
      </div>
    `;
  }

  /** Discard all pending changes for a version without applying them. */
  private _discardChanges(version: string) {
    const adds = new Map(this._pendingAdds);
    const removes = new Map(this._pendingRemoves);
    adds.delete(version);
    removes.delete(version);
    this._pendingAdds = adds;
    this._pendingRemoves = removes;
  }

  /** Render toolchains as selectable chips showing their install / pending state. */
  private _renderSelectableToolchains(toolchains: string[], version: string, isInstalled: boolean) {
    const pendingAdds = this._pendingAdds.get(version) ?? new Set<string>();
    const pendingRemoves = this._pendingRemoves.get(version) ?? new Set<string>();
    const groups = groupToolchains(toolchains);
    return html`
      <div class="toolchain-arch-list">
        ${groups.map(g => html`
          <div class="toolchain-arch-group">
            <div class="toolchain-arch-label">${g.label}</div>
            <div class="toolchain-list">
              ${g.items.map(tc => {
      const pendingRemove = isInstalled && pendingRemoves.has(tc);
      const pendingAdd = !isInstalled && pendingAdds.has(tc);
      let chipClass = isInstalled ? "installed" : "available";
      if (pendingRemove) { chipClass = "pending-remove"; }
      if (pendingAdd) { chipClass = "pending-add"; }
      const icon = pendingRemove ? "×" : pendingAdd ? "✓" : isInstalled ? "✓" : "+";
      return html`
                <button
                  class="toolchain-chip ${chipClass}"
                  @click=${() => this._toggleToolchain(version, tc, isInstalled)}
                  title=${isInstalled
          ? (pendingRemove ? "Click to keep this toolchain" : "Click to mark for removal")
          : (pendingAdd ? "Click to deselect" : "Click to select for installation")}
                >
                  <span class="tc-chip-icon">${icon}</span>
                  ${tc}
                </button>`;
    })}
            </div>
          </div>
        `)}
      </div>
    `;
  }
}

