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

import { html } from 'lit';
import { customElement } from 'lit/decorators.js';
import { ZephyrLitElement } from '../../webview_shared/lit-base';
import { HostToolsClient } from '../../webview_shared/hostToolsClient';

@customElement('host-tools-app')
export class HostToolsApp extends ZephyrLitElement {
  private _client!: HostToolsClient;

  connectedCallback() {
    super.connectedCallback();
    this._client = new HostToolsClient(this.vscodeApi, 'cards');
    (window as any).hostToolsClient = this._client;
    window.addEventListener('message', this._onMessage);
    this.postCommand('ready');
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('message', this._onMessage);
  }

  private _onMessage = (e: MessageEvent) => {
    this._client.handleMessage(e.data);
  };

  firstUpdated() {
    // Trigger initial status check now that the DOM IDs are available
    this._client.refreshStatus();
  }

  private _sendCommand(cmd: string) { this.postCommand(cmd); }
  private _markComplete() { this.vscodeApi.postMessage({ command: 'markComplete' }); }

  render() {
    return html`
      <div class="container">
        <div class="breadcrumb">
          <a class="breadcrumb-link" @click=${() => this._sendCommand('openSetupPanel')}>← Setup &amp; Configuration</a>
          <span class="breadcrumb-separator">/</span>
          <span class="breadcrumb-current">Host Tools</span>
        </div>
        <div class="page-header">
          <div>
            <h1 class="page-title">Host Tools Installation</h1>
            <p class="page-subtitle">Install and maintain local system dependencies for Zephyr development.</p>
          </div>
        </div>

        <div class="host-tools-manager">
          <div class="info-box">
            <p>
              This tool helps you install and manage development tools required for Zephyr RTOS development.
              The tools will be installed using your platform's package manager.
            </p>
            <p class="host-tools-note">
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
              <vscode-button id="refresh-btn" appearance="secondary" @click=${() => this._client.refreshStatus()}>
                <vscode-icon slot="start-icon" name="refresh"></vscode-icon>
                Refresh Status
              </vscode-button>
              <vscode-button id="install-all-btn" @click=${() => this._client.installAllMissing()} disabled>
                <vscode-icon slot="start-icon" name="cloud-download"></vscode-icon>
                Install All Missing Packages
              </vscode-button>
            </div>
          </div>
        </div>

        <div class="manager-section">
          <div class="button-group">
            <vscode-button id="mark-complete-btn" appearance="secondary" @click=${this._markComplete}>
              <vscode-icon slot="start-icon" name="check"></vscode-icon>
              Skip &amp; Mark as Complete
            </vscode-button>
          </div>
        </div>
      </div>
    `;
  }
}
