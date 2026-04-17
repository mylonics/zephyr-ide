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
import type {
  WorkspacePanelData,
  SetupProgressData,
  SetupProgressStep,
  WorkspacePanelCommand,
} from '../workspace-panel-data';

@customElement('workspace-app')
export class WorkspaceApp extends ZephyrLitElement {
  @state() private _data?: WorkspacePanelData;
  @state() private _westYmlContent = '';
  @state() private _westYmlDirty = false;
  @state() private _progressData?: SetupProgressData;
  @state() private _workspaceSetupActive = false;

  private _dismissTimer: ReturnType<typeof setTimeout> | null = null;

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener('message', this._onMessage);
    this._send('ready');
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
        if (!this._progressData ||
          this._progressData.type === 'complete' ||
          this._progressData.type === 'failed') {
          this._workspaceSetupActive = false;
        }
        break;
      case 'westYmlContent':
        this._westYmlContent = msg.content ?? '';
        this._westYmlDirty = false;
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

  private _send(cmd: WorkspacePanelCommand, extras?: Record<string, unknown>) {
    this.vscodeApi.postMessage({ command: cmd, ...(extras ?? {}) });
  }

  private _sendWorkspaceSetup(cmd: WorkspacePanelCommand) {
    // "Mark as complete" completes synchronously on the extension side and
    // doesn't emit setup-progress events; don't show the initializing overlay.
    if (cmd !== 'markWorkspaceComplete' && cmd !== 'markWorkspaceCompleteExternal') {
      this._workspaceSetupActive = true;
    }
    this._send(cmd);
  }

  private _saveAndUpdateWestYml() {
    const editor = this.querySelector('#westYmlEditor') as HTMLTextAreaElement | null;
    if (!editor) { return; }
    this._send('saveAndUpdateWestYml', { content: editor.value });
    this._westYmlDirty = false;
  }

  private _activateWorkspace(path: string) {
    this._send('activateWorkspace', { path });
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
    const showInitializing = this._workspaceSetupActive;
    const mode = d.panelMode;
    const showChoice = !showInitializing && mode === 'choice';
    const showNewCurrent = !showInitializing && mode === 'new-current';
    const showNewExternal = !showInitializing && mode === 'new-external';
    const showWorkspaceView = mode === 'workspace-view';
    const showReadyContent = !showInitializing && showWorkspaceView && d.folderOpen && d.workspaceInitialized;
    const showNoFolder = !showInitializing && showWorkspaceView && !d.folderOpen;
    // When an active workspace exists but hasn't been initialized yet, show
    // the current-folder setup tiles so the user can complete the setup.
    const showWorkspaceViewSetup = !showInitializing && showWorkspaceView && d.folderOpen && !d.workspaceInitialized && !d.isNonActive;

    return html`
      <div class="container" @keydown=${this._onKeydown}>
        <a class="breadcrumb-link" @click=${() => this._send('openSetupPanel')}>← Overview</a>
        <div class="page-header">
          <div style="display:flex;align-items:center;gap:12px;">
            <h1 class="page-title">Workspace Setup</h1>
            <span class="header-status-badge ${d.statusClass}">${d.statusIcon} ${d.statusLabel}</span>
          </div>
          ${d.targetDirectory ? html`
            <div class="header-directory">
              <span class="codicon codicon-folder-opened"></span>
              <code>${d.targetDirectory}</code>
            </div>` : nothing}
        </div>

        ${d.activationBanner ? this._renderActivationBanner(d.activationBanner) : nothing}

        ${showInitializing ? this._renderInitializing() : nothing}
        ${showNoFolder ? this._renderNoFolder() : nothing}
        ${showChoice ? this._renderChoiceScreen(d) : nothing}
        ${showNewCurrent ? this._renderCurrentTiles(d) : nothing}
        ${showNewExternal ? this._renderExternalTiles(d) : nothing}
        ${showWorkspaceViewSetup ? this._renderCurrentTiles(d) : nothing}
        ${showReadyContent ? this._renderReadyContent(d) : nothing}

        ${d.isNonActive && !showInitializing ? this._renderNonActiveNotice() : nothing}
      </div>
    `;
  }

  // ── Activation banner ─────────────────────────────────────

  private _renderActivationBanner(b: { name: string; path: string }) {
    return html`
      <div class="activation-banner" role="alert">
        <div class="activation-banner-content">
          <span class="codicon codicon-info"></span>
          <span>
            You are viewing <strong>${b.name}</strong>, which is not bound to
            the current folder. Actions below operate on the open VS Code
            folder, not on this workspace. Activate it to bring it forward.
          </span>
        </div>
        <vscode-button @click=${() => this._activateWorkspace(b.path)}>Activate</vscode-button>
      </div>`;
  }

  private _renderNonActiveNotice() {
    return html`
      <div class="ws-state">
        <p class="description muted">
          Setup and management actions are hidden while viewing a non-active
          workspace. Use the banner above to activate it.
        </p>
      </div>`;
  }

  // ── Initializing state ────────────────────────────────────

  private _renderInitializing() {
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

  private _renderProgress(data: SetupProgressData) {
    let bannerClass: string, bannerIcon: string, bannerText: string;
    switch (data.type) {
      case 'complete':
        bannerClass = 'status-success'; bannerIcon = 'check'; bannerText = 'Setup Complete'; break;
      case 'failed':
        bannerClass = 'status-error'; bannerIcon = 'error'; bannerText = 'Setup Failed'; break;
      default:
        bannerClass = 'status-info'; bannerIcon = ''; bannerText = 'Setting Up Workspace...'; break;
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

  // ── No-folder state ───────────────────────────────────────

  private _renderNoFolder() {
    return html`
      <div class="ws-state ws-state-setup-required">
        <div class="status-banner status-info">
          <span class="codicon codicon-folder"></span>
          <span class="status-text">No Folder Opened</span>
        </div>
        <p class="description">Open a folder in VS Code to set up your Zephyr workspace.</p>
        <div class="section-container centered">
          <div class="empty-state">
            <div class="empty-state-icon">📁</div>
            <h3>No Folder Open</h3>
            <p>A workspace folder is required for Zephyr development.</p>
          </div>
          <div class="button-group">
            <vscode-button @click=${() => this._send('openFolder')}>
              <vscode-icon slot="start-icon" name="folder-opened"></vscode-icon>
              Open Folder
            </vscode-button>
          </div>
        </div>
      </div>`;
  }

  // ── Ready content (initialized workspace) ─────────────────

  private _renderReadyContent(d: WorkspacePanelData) {
    const info = d.workspaceInfo;
    if (!info) { return nothing; }
    const disabled = d.isNonActive;

    // Readiness-aware banner. When fully ready: success. When initialized
    // but west/python still pending: info banner inviting the user to finish.
    let readyBanner;
    if (d.readiness === 'ready') {
      readyBanner = html`
        <div class="status-banner status-success">
          <span class="codicon codicon-check"></span>
          <span class="status-text">Workspace Ready</span>
        </div>`;
    } else {
      const missing: string[] = [];
      if (!d.pythonEnvReady) { missing.push('python environment'); }
      if (!d.westUpdated) { missing.push('west update'); }
      readyBanner = html`
        <div class="status-banner status-info">
          <span class="codicon codicon-info"></span>
          <span class="status-text">Workspace initialized — pending: ${missing.join(', ')}</span>
        </div>`;
    }

    return html`
      <div class="ws-state ws-state-ready">
        ${readyBanner}

        <div class="section-container">
          <h3>Workspace Information</h3>
          <div class="info-box">
            <p><strong>Current Folder:</strong> <code>${info.currentFolderPath}</code></p>
            <p><strong>West Workspace Path:</strong> <code>${info.westWorkspacePath}</code></p>
            <p><strong>West.yml Location:</strong> <code>${info.westYmlPath}</code></p>
            <p><strong>Python .venv Location:</strong> <code>${info.venvPath}</code></p>
            <p><strong>Zephyr Version:</strong> <code>${info.zephyrVersion}</code></p>
          </div>
          ${d.readiness === 'ready' ? html`
            <div class="button-group" style="margin-top:12px;">
              <vscode-button appearance="secondary" @click=${() => this._send('openProjectPanel')}>
                <vscode-icon slot="start-icon" name="rocket"></vscode-icon>
                Open Projects
              </vscode-button>
            </div>` : html`
            <div class="button-group" style="margin-top:12px;">
              <vscode-button @click=${() => this._send('rerunWestSetup')} ?disabled=${disabled}>
                <vscode-icon slot="start-icon" name="sync"></vscode-icon>
                Finish West Setup
              </vscode-button>
            </div>`}
        </div>

        <div class="section-container">
          <h3>West Configuration</h3>
          <div class="west-yml-editor">
            <div class="editor-header">
              <label for="westYmlEditor">west.yml${this._westYmlDirty ? ' •' : ''}</label>
              <vscode-button appearance="secondary" @click=${() => this._send('openWestYml')}>
                <vscode-icon slot="start-icon" name="go-to-file"></vscode-icon>
                Open in Editor
              </vscode-button>
            </div>
            <textarea id="westYmlEditor" class="west-yml-textarea" rows="15"
              placeholder="Loading west.yml..."
              .value=${this._westYmlContent}
              @input=${this._onWestYmlInput}
              @keydown=${this._onTextareaKeydown}></textarea>
            <div class="editor-actions">
              <vscode-button @click=${this._saveAndUpdateWestYml}
                ?disabled=${disabled || !this._westYmlDirty}
                title=${this._westYmlDirty ? 'Save edits and run west update' : 'No pending changes'}>
                <vscode-icon slot="start-icon" name="save"></vscode-icon>
                Save and West Update
              </vscode-button>
            </div>
          </div>
        </div>

        ${!d.isNonActive ? this._renderWorkspaceManagement() : nothing}
      </div>`;
  }

  private _onWestYmlInput(e: Event) {
    const ta = e.target as HTMLTextAreaElement;
    this._westYmlDirty = ta.value !== this._westYmlContent;
  }

  private _renderWorkspaceManagement() {
    return html`
      <div class="action-section">
        <h3>Workspace Management</h3>
        <p class="description">
          Scope each action carefully — they affect how this workspace is tracked.
        </p>
        <div class="button-group">
          <vscode-button appearance="secondary" @click=${() => this._send('westUpdate')}
            title="Run 'west update' to pull manifest dependencies.">
            <vscode-icon slot="start-icon" name="sync"></vscode-icon>
            West Update
          </vscode-button>
          <vscode-button appearance="secondary" @click=${() => this._send('rerunWestSetup')}
            title="Clear python-env and west-update state, then re-run setup. Keeps the workspace initialized.">
            <vscode-icon slot="start-icon" name="debug-restart"></vscode-icon>
            Re-run West Setup
          </vscode-button>
          <vscode-button appearance="secondary" @click=${() => this._send('resetWorkspace')}
            title="Mark this workspace as uninitialized. .west/ is preserved on disk; next setup flow can re-adopt it.">
            <vscode-icon slot="start-icon" name="refresh"></vscode-icon>
            Reset Workspace
          </vscode-button>
          <vscode-button appearance="secondary" @click=${() => this._send('deactivateWorkspace')}
            title="Unbind this folder from its active workspace. The workspace stays in the registry.">
            <vscode-icon slot="start-icon" name="debug-disconnect"></vscode-icon>
            Deactivate
          </vscode-button>
          <vscode-button appearance="secondary" @click=${() => this._send('unregisterWorkspace')}
            title="Remove this workspace from Zephyr IDE's registry. Files on disk are not deleted.">
            <vscode-icon slot="start-icon" name="trash"></vscode-icon>
            Unregister
          </vscode-button>
        </div>
      </div>

      <div class="action-section">
        <h3>Advanced Commands</h3>
        <p class="description">Low-level commands for troubleshooting.</p>
        <div class="button-group">
          <vscode-button appearance="secondary" @click=${() => this._send('westConfig')}>
            <vscode-icon slot="start-icon" name="settings"></vscode-icon>
            West Config
          </vscode-button>
          <vscode-button appearance="secondary" @click=${() => this._send('westInit')}>
            <vscode-icon slot="start-icon" name="repo-create"></vscode-icon>
            West Init
          </vscode-button>
        </div>
      </div>`;
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
      this._westYmlDirty = ta.value !== this._westYmlContent;
    }
  }

  private _renderOptionCard(
    icon: string,
    title: string,
    description: string,
    usage: string,
    command: WorkspacePanelCommand,
  ) {
    return html`
      <div class="workspace-option-card"
           @click=${() => this._sendWorkspaceSetup(command)}
           role="button" tabindex="0" data-keyboard-command="true"
           aria-label="${title}">
        <div class="option-header">
          <span class="option-icon">${icon}</span>
          <h4>${title}</h4>
        </div>
        <p class="option-description">${description}</p>
        <p class="option-usage"><em>Best for: ${usage}</em></p>
      </div>`;
  }

  // ── Choice screen ─────────────────────────────────────────
  // Shown when no workspace is active and no specific workspace path was
  // passed to the panel. Offers two primary paths: operate in the current
  // VS Code folder, or pick an external directory.
  private _renderChoiceScreen(d: WorkspacePanelData) {
    const rootPath = d.workspaceInfo?.currentFolderPath || '';
    const hasFolder = d.folderOpen;
    const firstButtonLabel = d.preexistingWorkspaceDetected
      ? 'Activate Preexisting Workspace in Current Folder'
      : 'Create New Workspace in Current Folder';
    const firstButtonDesc = d.preexistingWorkspaceDetected
      ? 'A .west/ directory was detected. Register it with Zephyr IDE and activate it.'
      : 'Configure the currently open folder as a new Zephyr workspace.';
    const firstCommand: WorkspacePanelCommand = d.preexistingWorkspaceDetected
      ? 'activatePreexisting'
      : 'chooseNewInCurrent';

    return html`
      <div class="ws-state ws-state-choice">
        <div class="section-container">
          <h3>No Active Workspace</h3>
          <p class="description">
            Choose how to proceed. You can work in the currently open folder
            ${hasFolder && rootPath ? html`(<code>${rootPath}</code>)` : nothing}
            or set up a workspace in an external directory.
          </p>
          <div class="choice-grid">
            <div class="choice-card${hasFolder ? '' : ' disabled'}"
                 @click=${() => { if (hasFolder) { this._send(firstCommand); } }}
                 role="button" tabindex=${hasFolder ? '0' : '-1'}
                 data-keyboard-command=${hasFolder ? 'true' : 'false'}
                 aria-label=${firstButtonLabel}>
              <div class="choice-icon">📂</div>
              <h4>${firstButtonLabel}</h4>
              <p>${firstButtonDesc}</p>
              ${!hasFolder ? html`<p class="muted"><em>Open a folder first.</em></p>` : nothing}
            </div>
            <div class="choice-card"
                 @click=${() => this._send('chooseNewInExternal')}
                 role="button" tabindex="0" data-keyboard-command="true"
                 aria-label="Activate new workspace in external directory">
              <div class="choice-icon">🔗</div>
              <h4>Create New Workspace in External Directory</h4>
              <p>Pick any directory outside the current folder and configure it as a Zephyr workspace.</p>
            </div>
          </div>
        </div>
      </div>`;
  }

  // ── New-in-current tiles ──────────────────────────────────
  private _renderCurrentTiles(d: WorkspacePanelData) {
    const rootPath = d.workspaceInfo?.currentFolderPath || '';
    return html`
      <div class="ws-state ws-state-setup-options">
        ${rootPath ? html`
          <div class="external-dir-banner">
            <span class="codicon codicon-folder-opened"></span>
            <div>
              <div class="muted">Target folder</div>
              <code>${rootPath}</code>
            </div>
          </div>` : nothing}
        <div class="section-container">
          <h3>New Workspace in Current Folder</h3>
          <div class="workspace-options-grid">
            ${this._renderOptionCard('🌐', 'Workspace from Zephyr IDE',
      'Clone a complete Zephyr IDE workspace or repo with projects as subdirectories using Git.',
      'Team collaboration and shared environments',
      'workspaceSetupFromGit')}
            ${this._renderOptionCard('⚙️', 'Workspace from Git',
        'Clone a west manifest repo (contains west.yml) using West Init.',
        'Upstream Zephyr projects and community examples',
        'workspaceSetupFromWestGit')}
            ${this._renderOptionCard('📦', 'New Workspace',
          'Create a self-contained workspace with Zephyr installed locally.',
          'Individual projects or specific Zephyr versions',
          'workspaceSetupStandard')}
            ${this._renderOptionCard('📁', 'From Workspace Directory',
            'Set up the current directory for Zephyr development, preserving existing files.',
            'Existing projects with west.yml or .west folder',
            'workspaceSetupFromCurrentDirectory')}
            ${this._renderOptionCard('✅', 'Mark as Complete',
              'Register the current directory as an already-set-up workspace without running setup.',
              'Already-configured Zephyr installations',
              'markWorkspaceComplete')}
          </div>
        </div>
      </div>`;
  }

  // ── New-in-external tiles ─────────────────────────────────
  private _renderExternalTiles(d: WorkspacePanelData) {
    const extPath = d.externalDirectoryPath || '';
    return html`
      <div class="ws-state ws-state-setup-options">
        ${extPath ? html`
          <div class="external-dir-banner">
            <span class="codicon codicon-folder-opened"></span>
            <div>
              <div class="muted">Target folder</div>
              <code>${extPath}</code>
            </div>
          </div>` : nothing}
        <div class="section-container">
          <h3>New Workspace in External Directory</h3>
          <div class="workspace-options-grid">
            ${this._renderOptionCard('⚙️', 'Workspace from Git',
      'Clone a west manifest repo (contains west.yml) using West Init.',
      'Upstream Zephyr projects and community examples',
      'workspaceSetupFromWestGitExternal')}
            ${this._renderOptionCard('📦', 'New Workspace',
        'Create a self-contained workspace with Zephyr installed locally.',
        'Individual projects or specific Zephyr versions',
        'workspaceSetupStandardExternal')}
            ${this._renderOptionCard('📁', 'From Workspace Directory',
          'Set up the external directory for Zephyr development, preserving existing files.',
          'Existing projects with west.yml or .west folder',
          'workspaceSetupFromDirectoryExternal')}
            ${this._renderOptionCard('✅', 'Mark as Complete',
            'Register the external directory as an already-set-up workspace without running setup.',
            'Already-configured Zephyr installations',
            'markWorkspaceCompleteExternal')}
          </div>
        </div>
      </div>`;
  }
}
