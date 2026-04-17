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

  private _dismissProgress() {
    this._progressData = undefined;
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

        <p class="sdk-description">The Zephyr SDK provides GNU toolchains for cross-compiling to supported target architectures. Install or update toolchains below, then refresh to see what's available.</p>

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

    return html`
      <div class="sdk-list-container">
        ${data.versions.map(v => this._renderSDKVersion(v))}
      </div>
    `;
  }

  private _renderSDKVersion(version: SDKVersion) {
    return html`
      <div class="sdk-version-card">
        <div class="sdk-version-header">
          <div class="sdk-version-title">Zephyr SDK ${version.version}</div>
        </div>
        <div class="sdk-path">${version.path}</div>
        ${version.installedToolchains && version.installedToolchains.length > 0
        ? html`<div class="toolchain-section">
              <div class="toolchain-section-title">Installed Toolchains (${version.installedToolchains.length}):</div>
              <div class="toolchain-list">
                ${version.installedToolchains.map(tc => html`<span class="toolchain-tag">${tc}</span>`)}
              </div>
            </div>`
        : nothing}
        ${version.availableToolchains && version.availableToolchains.length > 0
        ? html`<div class="toolchain-section">
              <div class="toolchain-section-title">Available Toolchains (${version.availableToolchains.length}):</div>
              <div class="toolchain-list">
                ${version.availableToolchains.map(tc => html`<span class="toolchain-tag available">${tc}</span>`)}
              </div>
            </div>`
        : nothing}
      </div>
    `;
  }
}
