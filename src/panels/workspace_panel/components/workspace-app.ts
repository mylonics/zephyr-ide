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

import { html, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { ZephyrLitElement } from '../../webview_shared/lit-base';
import type { WorkspacePanelData, SetupProgressData, SetupProgressStep } from '../workspace-panel-data';

@customElement('workspace-app')
export class WorkspaceApp extends ZephyrLitElement {
  @state() private _data?: WorkspacePanelData;
  @state() private _westYmlContent = '';
  @state() private _progressData?: SetupProgressData;
  @state() private _workspaceSetupActive = false;

  private _dismissTimer: ReturnType<typeof setTimeout> | null = null;

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener('message', this._onMessage);
    this.postCommand('ready');
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('message', this._onMessage);
    if (this._dismissTimer) { clearTimeout(this._dismissTimer); }
  }

  private _onMessage = (e: MessageEvent) => {
    const msg = e.data;
    switch (msg.command) {
      case 'updateContent':
        this._data = msg.data as WorkspacePanelData;
        // Clear the local initializing override when no setup progress is active.
        // Progress events manage their own lifecycle independently.
        if (!this._progressData ||
          this._progressData.type === 'complete' ||
          this._progressData.type === 'failed') {
          this._workspaceSetupActive = false;
        }
        break;
      case 'westYmlContent':
        this._westYmlContent = msg.content ?? '';
        break;
      case 'workspaceSetupProgress':
        this._handleProgress(msg.data as SetupProgressData);
        break;
    }
  };

  // ── Progress ──────────────────────────────────────────────

  private _handleProgress(data: SetupProgressData) {
    if (data.type === 'start' || data.type === 'step-update') {
      this._workspaceSetupActive = true;
    } else if (data.type === 'complete' || data.type === 'failed') {
      this._workspaceSetupActive = false;
    } else if (!this._workspaceSetupActive) {
      // Ignore unknown message types when no setup is active
      return;
    }
    this._progressData = data;
    if (this._dismissTimer) { clearTimeout(this._dismissTimer); this._dismissTimer = null; }
    if (data.type === 'complete') {
      this._dismissTimer = setTimeout(() => this._dismissProgress(), 2000);
    }
  }

  private _dismissProgress() {
    this._progressData = undefined;
    if (this._dismissTimer) { clearTimeout(this._dismissTimer); this._dismissTimer = null; }
  }

  // ── Commands ──────────────────────────────────────────────

  private _sendCommand(cmd: string) { this.postCommand(cmd); }

  private _sendWorkspaceSetup(cmd: string) {
    this._workspaceSetupActive = true;
    this.postCommand(cmd);
  }

  private _openWestYml() { this.postCommand('openWestYml'); }

  private _saveAndUpdateWestYml() {
    const editor = this.querySelector('#westYmlEditor') as HTMLTextAreaElement | null;
    if (editor) {
      this.vscodeApi.postMessage({ command: 'saveAndUpdateWestYml', content: editor.value });
    }
  }

  private _activateWorkspace(path: string) {
    this.vscodeApi.postMessage({ command: 'activateWorkspace', path });
  }

  // ── Keyboard ──────────────────────────────────────────────

  private _onKeydown(e: KeyboardEvent) {
    const isSpace = e.code === 'Space' || e.key === ' ' || e.key === 'Spacebar';
    if (e.key !== 'Enter' && !isSpace) { return; }
    const target = e.target;
    if (!(target instanceof HTMLElement)) { return; }
    const el = target.closest('[data-keyboard-command="true"]');
    if (!(el instanceof HTMLElement)) { return; }
    if (isSpace) { e.preventDefault(); }
    el.click();
  }

  // ── Render ────────────────────────────────────────────────

  render() {
    if (!this._data) {
      return html`<div class="container"><vscode-progress-ring></vscode-progress-ring></div>`;
    }

    const d = this._data;
    const effectiveState = this._workspaceSetupActive ? 'initializing' : d.state;

    return html`
      <div class="container" @keydown=${this._onKeydown}>
        <a class="breadcrumb-link" @click=${() => this._sendCommand('openSetupPanel')}>← Overview</a>
        <div class="page-header">
          <div style="display:flex;align-items:center;gap:12px;">
            <h1 class="page-title">Workspace Setup</h1>
            <span class="header-status-badge ${d.statusClass}">${d.statusIcon} ${d.statusLabel}</span>
          </div>
        </div>

        ${d.activationBanner ? this._renderActivationBanner(d.activationBanner) : nothing}

        <div class="ws-body" data-workspace-state="${effectiveState}">
          ${this._renderInitializingState()}
          ${this._renderReadyState(d)}
          ${this._renderSetupRequiredState(d)}
        </div>
      </div>
    `;
  }

  // ── Activation banner ─────────────────────────────────────

  private _renderActivationBanner(b: { name: string; path: string }) {
    return html`
      <div class="activation-banner" role="alert">
        <div class="activation-banner-content">
          <span class="codicon codicon-info"></span>
          <span>This workspace (<strong>${b.name}</strong>) is not currently active.</span>
        </div>
        <vscode-button @click=${() => this._activateWorkspace(b.path)}>Activate This Workspace</vscode-button>
      </div>`;
  }

  // ── Initializing state ────────────────────────────────────

  private _renderInitializingState() {
    return html`
      <div class="ws-state ws-state-initializing">
        <div class="status-banner status-info">
          <vscode-progress-ring></vscode-progress-ring>
          <span class="status-text">Initializing workspace…</span>
        </div>
        <p class="description">Follow the prompts in the VS Code dialog to configure your workspace.</p>
        ${this._progressData ? this._renderProgress(this._progressData) : nothing}
      </div>`;
  }

  // ── Progress panel ────────────────────────────────────────

  private _renderProgress(data: SetupProgressData) {
    let bannerClass: string, bannerIcon: string, bannerText: string;
    switch (data.type) {
      case 'complete':
        bannerClass = 'status-success';
        bannerIcon = 'check';
        bannerText = 'Setup Complete';
        break;
      case 'failed':
        bannerClass = 'status-error';
        bannerIcon = 'error';
        bannerText = 'Setup Failed';
        break;
      default:
        bannerClass = 'status-info';
        bannerIcon = '';
        bannerText = 'Setting Up Workspace...';
        break;
    }

    const showSpinner = data.type === 'start' || data.type === 'step-update';
    const showDismiss = data.type === 'complete' || data.type === 'failed';

    return html`
      <div class="setup-progress-panel">
        <div class="setup-progress-header ${bannerClass}">
          ${showSpinner ? html`<vscode-progress-ring></vscode-progress-ring>` : nothing}
          ${bannerIcon ? html`<span class="status-icon"><span class="codicon codicon-${bannerIcon}"></span></span>` : nothing}
          <span class="setup-progress-title">${data.operationLabel} — ${bannerText}</span>
          ${showDismiss ? html`<button class="setup-progress-dismiss" @click=${() => this._dismissProgress()} title="Dismiss"><span class="codicon codicon-close"></span></button>` : nothing}
        </div>
        <div class="setup-progress-body">
          <div class="setup-progress-steps">
            ${data.steps.map(step => this._renderProgressStep(step))}
          </div>
          ${data.message ? html`<p class="setup-progress-message">${data.message}</p>` : nothing}
        </div>
      </div>`;
  }

  private _renderProgressStep(step: SetupProgressStep) {
    const iconMap: Record<string, string> = {
      'completed': 'check',
      'in-progress': 'sync codicon-modifier-spin',
      'failed': 'error',
      'skipped': 'dash',
    };
    const iconClass = iconMap[step.status] || 'circle-outline';

    return html`
      <div class="setup-step-item ${step.status}">
        <span class="setup-step-icon ${step.status}"><span class="codicon codicon-${iconClass}"></span></span>
        <div class="setup-step-content">
          <span class="setup-step-label">${step.label}</span>
          ${step.detail ? html`<span class="setup-step-detail">${step.detail}</span>` : nothing}
        </div>
      </div>`;
  }

  // ── Ready state ───────────────────────────────────────────

  private _renderReadyState(d: WorkspacePanelData) {
    return html`
      <div class="ws-state ws-state-ready">
        <div class="status-banner status-success">
          <span class="codicon codicon-check"></span>
          <span class="status-text">Workspace Ready</span>
        </div>
        ${d.folderOpen && d.workspaceInitialized ? this._renderInitializedContent(d) : nothing}
      </div>`;
  }

  private _renderInitializedContent(d: WorkspacePanelData) {
    if (!d.workspaceInfo) { return nothing; }
    const info = d.workspaceInfo;
    const disabledAttr = d.isNonActive ? true : false;

    return html`
      <p class="description">Workspace is configured and ready for development.</p>
      
      <div class="section-container">
        <h3>Workspace Information</h3>
        <div class="info-box">
          <p><strong>Current Folder:</strong> <code>${info.currentFolderPath}</code></p>
          <p><strong>West Workspace Path:</strong> <code>${info.westWorkspacePath}</code></p>
          <p><strong>West.yml Location:</strong> <code>${info.westYmlPath}</code></p>
          <p><strong>Python .venv Location:</strong> <code>${info.venvPath}</code></p>
          <p><strong>Zephyr Version:</strong> <code>${info.zephyrVersion}</code></p>
        </div>
      </div>
      
      <div class="section-container">
        <h3>West Configuration</h3>
        <div class="west-yml-editor">
          <div class="editor-header">
            <label for="westYmlEditor">west.yml</label>
            <vscode-button appearance="secondary" @click=${this._openWestYml}>
              <vscode-icon slot="start-icon" name="go-to-file"></vscode-icon>
              Open in Editor
            </vscode-button>
          </div>
          <textarea id="westYmlEditor" class="west-yml-textarea" rows="15" placeholder="Loading west.yml..." .value=${this._westYmlContent} @keydown=${this._onTextareaKeydown}></textarea>
          <div class="editor-actions">
            <vscode-button @click=${this._saveAndUpdateWestYml} ?disabled=${disabledAttr}>
              <vscode-icon slot="start-icon" name="save"></vscode-icon>
              Save and West Update
            </vscode-button>
            <vscode-button appearance="secondary" @click=${() => this._sendCommand('westUpdate')} ?disabled=${disabledAttr}>
              <vscode-icon slot="start-icon" name="sync"></vscode-icon>
              West Update
            </vscode-button>
          </div>
        </div>
      </div>
      
      ${!d.isNonActive ? html`
        <div class="action-section">
          <h3>Workspace Management</h3>
          <div class="button-group">
            <vscode-button appearance="secondary" @click=${() => this._sendCommand('resetWorkspace')}>
              <vscode-icon slot="start-icon" name="refresh"></vscode-icon>
              Reset West Workspace
            </vscode-button>
          </div>
        </div>` : nothing}
      
      <div class="action-section">
        <h3>Advanced Commands</h3>
        <p class="description">Low-level commands for advanced workspace management and troubleshooting.</p>
        ${d.isNonActive ? html`<p class="description muted">Activate this workspace to use these commands.</p>` : nothing}
        <div class="button-group">
          <vscode-button appearance="secondary" @click=${() => this._sendCommand('westConfig')} ?disabled=${disabledAttr}>
            <vscode-icon slot="start-icon" name="settings"></vscode-icon>
            West Config
          </vscode-button>
          <vscode-button appearance="secondary" @click=${() => this._sendCommand('westInit')} ?disabled=${disabledAttr}>
            <vscode-icon slot="start-icon" name="repo-create"></vscode-icon>
            West Init
          </vscode-button>
        </div>
      </div>
    `;
  }

  // ── Tab handling in textarea ──────────────────────────────

  private _onTextareaKeydown(e: KeyboardEvent) {
    if (e.key === 'Tab') {
      e.preventDefault();
      const ta = e.target as HTMLTextAreaElement;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      ta.value = ta.value.substring(0, start) + '  ' + ta.value.substring(end);
      ta.selectionStart = ta.selectionEnd = start + 2;
    }
  }

  // ── Setup required state ──────────────────────────────────

  private _renderSetupRequiredState(d: WorkspacePanelData) {
    const bannerClass = d.folderOpen ? 'status-warning' : 'status-info';
    const bannerIcon = d.folderOpen ? 'gear' : 'folder';
    const bannerText = d.folderOpen ? 'Setup Required' : 'No Folder Opened';

    return html`
      <div class="ws-state ws-state-setup-required">
        <div class="status-banner ${bannerClass}">
          <span class="codicon codicon-${bannerIcon}"></span>
          <span class="status-text">${bannerText}</span>
        </div>
        ${d.folderOpen ? this._renderSetupOptions(d.isNonActive) : this._renderNoFolder()}
      </div>`;
  }

  private _renderNoFolder() {
    return html`
      <p class="description">Open a folder in VS Code to set up your Zephyr workspace.</p>
      <div class="section-container centered">
        <div class="empty-state">
          <div class="empty-state-icon">📁</div>
          <h3>No Folder Open</h3>
          <p>A workspace folder is required for Zephyr development.</p>
        </div>
        <div class="button-group">
          <vscode-button @click=${() => this._sendCommand('openFolder')}>
            <vscode-icon slot="start-icon" name="folder-opened"></vscode-icon>
            Open Folder
          </vscode-button>
        </div>
      </div>`;
  }

  private _renderSetupOptions(disabled: boolean) {
    return html`
      <p class="description">Select how to configure your workspace. Each option organizes projects and manages dependencies differently.</p>
      ${disabled ? html`<p class="description muted">Activate this workspace to set it up.</p>` : nothing}
      <div class="section-container">
        <h3>Initialize West Workspace</h3>
        <div class="workspace-options-grid">
          ${this._renderOptionCard('🌐', 'Import Zephyr IDE Workspace from Git',
      'Clone a complete workspace or repo with projects as subdirectories using Git.',
      'Team collaboration and shared environments',
      'workspaceSetupFromGit', disabled)}
          ${this._renderOptionCard('⚙️', 'Import West Workspace from Git',
        'Clone a west manifest repo (contains west.yml) using West Init.',
        'Upstream Zephyr projects and community examples',
        'workspaceSetupFromWestGit', disabled)}
          ${this._renderOptionCard('📦', 'New Standard Workspace',
          'Create a self-contained workspace with Zephyr installed locally.',
          'Individual projects or specific Zephyr versions',
          'workspaceSetupStandard', disabled)}
          ${this._renderOptionCard('📁', 'Initialize Current Directory',
            'Set up the current directory for Zephyr development, preserving existing files.',
            'Existing projects or external Zephyr installations',
            'workspaceSetupFromCurrentDirectory', disabled)}
        </div>
      </div>`;
  }

  private _renderOptionCard(icon: string, title: string, description: string, usage: string, command: string, disabled: boolean) {
    return html`
      <div class="workspace-option-card${disabled ? ' disabled' : ''}"
           @click=${disabled ? undefined : () => this._sendWorkspaceSetup(command)}
           role="button" tabindex="${disabled ? '-1' : '0'}" data-keyboard-command="true"
           ?aria-disabled=${disabled}
           aria-label="${title}">
        <div class="option-header">
          <span class="option-icon">${icon}</span>
          <h4>${title}</h4>
        </div>
        <p class="option-description">${description}</p>
        <p class="option-usage"><em>Best for: ${usage}</em></p>
      </div>`;
  }
}
