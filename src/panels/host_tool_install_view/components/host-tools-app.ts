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

import { panelText } from "../../webview_shared/panel-text";
import { html } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { ZephyrLitElement } from '../../webview_shared/lit-base';
import { HostToolsClient } from '../../webview_shared/hostToolsClient';

@customElement('host-tools-app')
export class HostToolsApp extends ZephyrLitElement {
  private _client!: HostToolsClient;

  /**
   * Windows long paths status.
   * undefined  = not Windows (banner hidden)
   * false      = Windows, long paths NOT enabled (banner shown)
   * true       = Windows, long paths ARE enabled (banner hidden)
   */
  @state() private _windowsLongPathsEnabled: boolean | undefined = undefined;

  /**
   * Optional 7-Zip status on Windows.
   * undefined  = not Windows (section hidden)
   * false      = Windows, 7-Zip NOT installed
   * true       = Windows, 7-Zip IS installed
   */
  @state() private _sevenZipAvailable: boolean | undefined = undefined;
  @state() private _sevenZipInstalling = false;

  connectedCallback() {
    super.connectedCallback();
    this._client = new HostToolsClient(this.vscodeApi);
    window.addEventListener('message', this._onMessage);
    // No 'ready' post here — firstUpdated() calls refreshStatus() once the
    // DOM IDs exist, avoiding a duplicate parallel status check on startup.
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('message', this._onMessage);
  }

  private _onMessage = (e: MessageEvent) => {
    const msg = e.data as Record<string, any>;
    // Extract Windows long paths status from updateStatus payloads before
    // delegating to the shared client, which handles package card rendering.
    if (msg.command === 'hostToolsUpdateStatus' && msg.data) {
      const enabled = msg.data.windowsLongPathsEnabled;
      if (typeof enabled === 'boolean') {
        this._windowsLongPathsEnabled = enabled;
      }
      const sevenZip = msg.data.sevenZipAvailable;
      if (typeof sevenZip === 'boolean') {
        this._sevenZipAvailable = sevenZip;
      } else if (sevenZip === null) {
        // null = explicitly not-Windows, keep undefined to hide the section
      }
    }
    if (msg.command === 'sevenZipInstalling') {
      this._sevenZipInstalling = true;
    }
    if (msg.command === 'sevenZipInstalled') {
      this._sevenZipInstalling = false;
      if (typeof msg.available === 'boolean') {
        this._sevenZipAvailable = msg.available;
      }
    }
    this._client.handleMessage(msg);
  };

  firstUpdated() {
    // Trigger initial status check now that the DOM IDs are available
    this._client.refreshStatus();
  }

  private _sendCommand(cmd: string) { this.postCommand(cmd); }
  private _markComplete() { this.vscodeApi.postMessage({ command: 'markComplete' }); }
  private _enableLongPaths() { this.vscodeApi.postMessage({ command: 'enableWindowsLongPaths' }); }
  private _install7Zip() { this.vscodeApi.postMessage({ command: 'install7zip' }); }

  private _render7ZipSection() {
    if (this._sevenZipAvailable === undefined) { return ''; }
    const installed = this._sevenZipAvailable;
    return html`
      <div class="manager-section">
        <h3>${panelText("Optional: 7-Zip")}</h3>
        <div class="info-box">
          <p>
            <strong>${panelText("7-Zip is no longer required")}</strong> ${panelText("for Zephyr IDE SDK installation. Windows 11's built-in")} <code>tar.exe</code> ${panelText("(libarchive) can extract")}
            <code>.7z</code> ${panelText("archives natively, so the extension uses it by default.")}
          </p>
          <p>
            ${panelText("If you plan to use the")} <code>west sdk</code> ${panelText("command-line tool directly, you may want 7-Zip available on your PATH.")}
            <strong>${panelText("For most users, we recommend using the Zephyr IDE SDK panel (")}<em>${panelText("SDK & Toolchains")}</em>${panelText(") instead — no 7-Zip required.")}</strong>
          </p>
          <div style="display:flex;align-items:center;gap:10px;margin-top:8px;">
            ${installed
              ? html`<vscode-icon name="check" style="color:var(--vscode-terminal-ansiGreen)"></vscode-icon>
                     <span>${panelText("7-Zip is installed and available.")}</span>`
              : html`<vscode-icon name="circle-slash" style="color:var(--vscode-descriptionForeground)"></vscode-icon>
                     <span>${panelText("7-Zip is not installed.")}</span>`}
          </div>
        </div>
        ${!installed ? html`
          <div class="button-group" style="margin-top:8px;">
            <vscode-button appearance="secondary"
              ?disabled=${this._sevenZipInstalling}
              @click=${this._install7Zip}>
              <vscode-icon slot="start-icon" name="cloud-download"></vscode-icon>
              ${this._sevenZipInstalling ? 'Installing…' : panelText("Install 7-Zip (optional)")}
            </vscode-button>
          </div>
        ` : ''}
      </div>
    `;
  }

  render() {
    const showLongPathsBanner = this._windowsLongPathsEnabled === false;
    return html`
      <div class="container">
        <div class="breadcrumb">
          <a class="breadcrumb-link" @click=${() => this._sendCommand('openSetupPanel')}>${panelText("← Setup & Configuration")}</a>
          <span class="breadcrumb-separator">/</span>
          <span class="breadcrumb-current">${panelText("Host Tools")}</span>
        </div>
        <div class="page-header">
          <div>
            <h1 class="page-title">${panelText("Host Tools Installation")}</h1>
            <p class="page-subtitle">${panelText("Install and maintain local system dependencies for Zephyr development.")}</p>
          </div>
        </div>

        ${showLongPathsBanner ? html`
          <div class="warning-box">
            <p><strong>${panelText("⚠ Windows Long Path Support is not enabled.")}</strong></p>
            <p>
              ${panelText("Without long path support, building Python packages from source (such as")}
              <code>hidapi</code>${panelText(") may fail because the build directories created by pip can exceed Windows' default 260-character path limit.")}
            </p>
            <p>
              ${panelText("Click the button below to enable long path support system-wide. This requires administrator privileges and takes effect immediately — no restart is needed.")}
            </p>
            <vscode-button @click=${this._enableLongPaths}>
              ${panelText("Enable Windows Long Path Support")}
            </vscode-button>
          </div>
        ` : ''}

        <div class="host-tools-manager">
          <div class="info-box">
            <p>
              ${panelText("This tool helps you install and manage development tools required for Zephyr RTOS development. The tools will be installed using your platform's package manager.")}
            </p>
            <p class="host-tools-note">
              <strong>${panelText("Note:")}</strong> ${panelText("VS Code may need to be restarted after installation for tools to be available in the PATH.")}
            </p>
          </div>

          <div id="package-manager-section" class="manager-section">
            <h3>${panelText("Package Manager Status")}</h3>
            <div id="manager-status" class="status-area">
              <div class="loading">${panelText("Checking package manager...")}</div>
            </div>
          </div>

          <div id="packages-section" class="manager-section">
            <h3>${panelText("Required Development Tools")}</h3>
            <div id="packages-status" class="status-area">
              <div class="loading">${panelText("Checking packages...")}</div>
            </div>
          </div>

          <div id="actions-section" class="manager-section">
            <div class="button-group">
              <vscode-button id="refresh-btn" appearance="secondary" @click=${() => this._client.refreshStatus()}>
                <vscode-icon slot="start-icon" name="refresh"></vscode-icon>
                ${panelText("Refresh Status")}
              </vscode-button>
              <vscode-button id="install-all-btn" @click=${() => this._client.installAllMissing()} disabled>
                <vscode-icon slot="start-icon" name="cloud-download"></vscode-icon>
                ${panelText("Install All Missing Packages")}
              </vscode-button>
            </div>
          </div>
        </div>

        ${this._render7ZipSection()}

        <div class="manager-section">
          <div class="button-group">
            <vscode-button id="mark-complete-btn" appearance="secondary" @click=${this._markComplete}>
              <vscode-icon slot="start-icon" name="check"></vscode-icon>
              ${panelText("Skip & Mark as Complete")}
            </vscode-button>
          </div>
        </div>
      </div>
    `;
  }
}
