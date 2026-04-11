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

// Zephyr IDE Setup Panel Client-Side Logic

import '@vscode-elements/elements/dist/vscode-button/index.js';
import '@vscode-elements/elements/dist/vscode-icon/index.js';
import '@vscode-elements/elements/dist/vscode-progress-ring/index.js';
import { getVsCodeApi, escapeHtml } from '../webview_shared/webviewTypes';
import { HostToolsClient } from '../webview_shared/hostToolsClient';

const vscode = getVsCodeApi();

// ---------------------------------------------------------------------------
// Host Tools – delegated to shared HostToolsClient
// ---------------------------------------------------------------------------

const hostToolsClient = new HostToolsClient(vscode, 'table');

// Expose on window for onclick handlers in HTML
(window as any).hostToolsClient = hostToolsClient;

// ---------------------------------------------------------------------------
// Workspace setup progress state
// ---------------------------------------------------------------------------

/** True while a workspace setup operation is actively in progress. */
let _workspaceSetupActive = false;
/** Timer handle used to auto-dismiss the completed progress banner. */
let _setupProgressDismissTimer: ReturnType<typeof setTimeout> | null = null;

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

/** Send a simple command to the extension with no extra data. */
function sendCommand(cmd: string): void {
  vscode.postMessage({ command: cmd });
}

function navigateToSubPage(page: string): void {
  vscode.postMessage({ command: 'navigateToPage', page });
}

function navigateToOverview(): void {
  vscode.postMessage({ command: 'navigateToPage', page: 'overview' });
}

function handleKeyboardCommand(event: KeyboardEvent): void {
  const isSpaceKey = event.code === 'Space' || event.key === ' ' || event.key === 'Spacebar';
  if (event.key !== 'Enter' && !isSpaceKey) {
    return;
  }

  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const actionElement = target.closest('[data-keyboard-command="true"]');
  if (!(actionElement instanceof HTMLElement)) {
    return;
  }

  if (isSpaceKey) {
    event.preventDefault();
  }
  actionElement.click();
}

document.body.addEventListener('keydown', handleKeyboardCommand);

// Auto-navigate if the extension requested it
(function autoNavigate() {
  const page = document.body.getAttribute('data-auto-navigate');
  if (page) {
    navigateToSubPage(page);
  }
})();

// ---------------------------------------------------------------------------
// Message handling
// ---------------------------------------------------------------------------

window.addEventListener('message', event => {
  const message = event.data;

  // Let host tools client handle its messages first
  if (hostToolsClient.handleMessage(message)) {
    return;
  }

  switch (message.command) {
    case 'showSubPage':
      showSubPage(message.content, message.page);
      break;
    case 'showOverview':
      showOverview();
      break;
    case 'sdkListResult':
      displaySDKList(message.data);
      break;
    case 'westYmlContent':
      loadWestYmlContent(message.content);
      break;
    case 'workspaceSetupProgress':
      handleWorkspaceSetupProgress(message.data);
      break;
  }
});

// ---------------------------------------------------------------------------
// Sub-page navigation
// ---------------------------------------------------------------------------

function showSubPage(content: string, page: string): void {
  const overviewContainer = document.getElementById('overviewContainer');
  const subPageContainer = document.getElementById('subPageContainer');

  if (overviewContainer && subPageContainer) {
    overviewContainer.classList.add('hidden');
    subPageContainer.innerHTML = content;
    subPageContainer.classList.add('visible');

    if (page === 'workspace' && _workspaceSetupActive) {
      setWorkspaceState('initializing');
    }
  }
}

function hideSubPage(): void {
  const overviewContainer = document.getElementById('overviewContainer');
  const subPageContainer = document.getElementById('subPageContainer');

  if (overviewContainer && subPageContainer) {
    subPageContainer.classList.remove('visible');
    overviewContainer.classList.remove('hidden');
    _workspaceSetupActive = false;

    setTimeout(() => {
      subPageContainer.innerHTML = '';
    }, 300);
  }
}

function showOverview(): void {
  hideSubPage();
}

// ---------------------------------------------------------------------------
// Section toggle (collapsible sections)
// ---------------------------------------------------------------------------

function toggleSection(sectionId: string): void {
  const content = document.getElementById(sectionId + 'Content');
  const icon = document.getElementById(sectionId + 'Icon');
  if (content && icon) {
    content.classList.toggle('expanded');
    icon.classList.toggle('expanded');
  }
}

function scrollToSection(sectionId: string): void {
  const section = document.getElementById(sectionId);
  if (section) {
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const content = document.getElementById(sectionId + 'Content');
    const icon = document.getElementById(sectionId + 'Icon');
    if (content && icon && !content.classList.contains('expanded')) {
      content.classList.add('expanded');
      icon.classList.add('expanded');
    }
  }
}

// ---------------------------------------------------------------------------
// Simple command passthrough functions (called from onclick in HTML)
// ---------------------------------------------------------------------------

function markToolsComplete(): void { sendCommand('markToolsComplete'); }
function openWestYml(): void { sendCommand('openWestYml'); }

function selectExistingWestWorkspace(): void {
  setWorkspaceState('initializing');
  sendCommand('selectExistingWestWorkspace');
}

// ---------------------------------------------------------------------------
// SDK Management
// ---------------------------------------------------------------------------

function listSDKs(): void {
  const containerDiv = document.getElementById('sdkListContainer');
  if (containerDiv) {
    containerDiv.innerHTML = '<div class="sdk-loading"><vscode-progress-ring></vscode-progress-ring><span>Loading SDK information...</span></div>';
  }
  vscode.postMessage({ command: 'listSDKs' });
}

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

function displaySDKList(sdkData: SDKListData): void {
  const containerDiv = document.getElementById('sdkListContainer');
  if (!containerDiv) { return; }

  if (!sdkData.success) {
    containerDiv.innerHTML = `
      <div class="sdk-error-box">
        <strong>Error:</strong> ${escapeHtml(sdkData.error || 'Failed to list SDKs')}
      </div>`;
    return;
  }

  if (!sdkData.versions || sdkData.versions.length === 0) {
    containerDiv.innerHTML = `
      <div class="sdk-empty-box">
        No SDK versions found. Try installing an SDK first.
      </div>`;
    return;
  }

  let html = '';
  for (const version of sdkData.versions) {
    const escapedVersion = escapeHtml(version.version || '');
    const escapedPath = escapeHtml(version.path || '');

    html += `
      <div class="sdk-version-card">
        <div class="sdk-version-header">
          <div class="sdk-version-title">Zephyr SDK ${escapedVersion}</div>
        </div>
        <div class="sdk-path">${escapedPath}</div>
        ${version.installedToolchains && version.installedToolchains.length > 0 ? `
          <div class="toolchain-section">
            <div class="toolchain-section-title">Installed Toolchains (${version.installedToolchains.length}):</div>
            <div class="toolchain-list">
              ${version.installedToolchains.map(tc => `<span class="toolchain-tag">${escapeHtml(tc)}</span>`).join('')}
            </div>
          </div>` : ''}
        ${version.availableToolchains && version.availableToolchains.length > 0 ? `
          <div class="toolchain-section">
            <div class="toolchain-section-title">Available Toolchains (${version.availableToolchains.length}):</div>
            <div class="toolchain-list">
              ${version.availableToolchains.map(tc => `<span class="toolchain-tag available">${escapeHtml(tc)}</span>`).join('')}
            </div>
          </div>` : ''}
      </div>`;
  }
  containerDiv.innerHTML = html;
}

// ---------------------------------------------------------------------------
// Workspace state management
// ---------------------------------------------------------------------------

function setWorkspaceState(state: string): void {
  const body = document.querySelector('.sub-page-body[data-workspace-state]');
  if (body) {
    body.setAttribute('data-workspace-state', state);
  }
}

function updateWorkspaceCardStatus(state: 'initializing' | 'ready' | 'failed'): void {
  const el = document.getElementById('workspaceCardStatus');
  if (!el) { return; }
  el.className = 'status';
  switch (state) {
    case 'initializing':
      el.classList.add('status-info');
      el.innerHTML = '<vscode-progress-ring></vscode-progress-ring> Initializing\u2026';
      break;
    case 'ready':
      el.classList.add('status-success');
      el.textContent = '\u2713 Initialized';
      break;
    case 'failed':
      el.classList.add('status-error');
      el.textContent = '\u2717 Setup Failed';
      break;
  }
}

function showWorkspaceInitializing(): void {
  _workspaceSetupActive = true;
  const body = document.querySelector('.sub-page-body[data-workspace-state]');
  if (body) {
    body.setAttribute('data-workspace-state', 'initializing');
  }
  updateWorkspaceCardStatus('initializing');
}

/** Send a workspace setup command with the initializing UI state. */
function sendWorkspaceSetup(cmd: string): void {
  showWorkspaceInitializing();
  sendCommand(cmd);
}

// ---------------------------------------------------------------------------
// West.yml editor
// ---------------------------------------------------------------------------

function saveAndUpdateWestYml(): void {
  const editor = document.getElementById('westYmlEditor') as HTMLTextAreaElement | null;
  if (editor) {
    vscode.postMessage({ command: 'saveAndUpdateWestYml', content: editor.value });
  }
}

function loadWestYmlContent(content: string): void {
  const editor = document.getElementById('westYmlEditor') as HTMLTextAreaElement | null;
  if (!editor) { return; }

  editor.value = content || '';

  if (!editor.dataset.tabHandlerAdded) {
    editor.addEventListener('keydown', function (this: HTMLTextAreaElement, e: KeyboardEvent) {
      if (e.key === 'Tab') {
        e.preventDefault();
        const start = this.selectionStart;
        const end = this.selectionEnd;
        const value = this.value;
        this.value = value.substring(0, start) + '  ' + value.substring(end);
        this.selectionStart = this.selectionEnd = start + 2;
      }
    });
    editor.dataset.tabHandlerAdded = 'true';
  }
}

// ---------------------------------------------------------------------------
// Clipboard
// ---------------------------------------------------------------------------

function copyToClipboardFromData(element: HTMLElement): void {
  const text = element.getAttribute('data-command');
  if (!text) {
    console.error('No command data found');
    return;
  }
  copyToClipboard(text, element);
}

function copyToClipboard(text: string, element: HTMLElement): void {
  function showFeedback(success = true): void {
    const indicator = element.nextElementSibling as HTMLElement | null;
    if (!indicator || !indicator.classList.contains('copy-indicator')) { return; }

    const originalText = indicator.textContent;
    const originalColor = indicator.style.color;
    indicator.textContent = success ? 'Copied!' : 'Failed to copy';
    indicator.style.color = success ? 'var(--vscode-terminal-ansiGreen)' : 'var(--vscode-terminal-ansiRed)';

    setTimeout(() => {
      indicator.textContent = originalText;
      indicator.style.color = originalColor;
    }, 2000);
  }

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(
      () => showFeedback(true),
      () => tryFallback(),
    );
  } else {
    tryFallback();
  }

  function tryFallback(): void {
    try {
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.left = '-999999px';
      textArea.style.top = '-999999px';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      const successful = document.execCommand('copy');
      document.body.removeChild(textArea);
      showFeedback(successful);
    } catch (err) {
      console.error('Fallback copy failed:', err);
      showFeedback(false);
    }
  }
}

// ---------------------------------------------------------------------------
// Workspace setup progress
// ---------------------------------------------------------------------------

interface SetupProgressStep {
  id: string;
  label: string;
  status: string;
  detail?: string;
}

interface SetupProgressData {
  type: 'start' | 'step-update' | 'complete' | 'failed';
  operationLabel: string;
  steps: SetupProgressStep[];
  message?: string;
}

function handleWorkspaceSetupProgress(data: SetupProgressData): void {
  if (data.type === 'start' || data.type === 'step-update') {
    _workspaceSetupActive = true;
    updateWorkspaceCardStatus('initializing');
  }

  if (data.type === 'complete' || data.type === 'failed') {
    _workspaceSetupActive = false;
    updateWorkspaceCardStatus(data.type === 'complete' ? 'ready' : 'failed');
  }

  if (!_workspaceSetupActive && data.type !== 'complete' && data.type !== 'failed') {
    return;
  }

  const subPageContainer = document.getElementById('subPageContainer');
  if (!subPageContainer || !subPageContainer.classList.contains('visible')) {
    return;
  }

  setWorkspaceState('initializing');

  const container = document.getElementById('setupProgressContainer');
  if (!container) { return; }

  if (_setupProgressDismissTimer) {
    clearTimeout(_setupProgressDismissTimer);
    _setupProgressDismissTimer = null;
  }

  if (data.type === 'complete') {
    _setupProgressDismissTimer = setTimeout(() => dismissSetupProgress(), 8000);
  }

  let bannerClass: string, bannerIcon: string, bannerText: string;
  switch (data.type) {
    case 'complete':
      bannerClass = 'status-success';
      bannerIcon = '<span class="codicon codicon-check"></span>';
      bannerText = 'Setup Complete';
      break;
    case 'failed':
      bannerClass = 'status-error';
      bannerIcon = '<span class="codicon codicon-error"></span>';
      bannerText = 'Setup Failed';
      break;
    default:
      bannerClass = 'status-info';
      bannerIcon = '';
      bannerText = 'Setting Up Workspace...';
      break;
  }

  function getStepIcon(status: string): string {
    switch (status) {
      case 'completed':
        return '<span class="setup-step-icon completed"><span class="codicon codicon-check"></span></span>';
      case 'in-progress':
        return '<span class="setup-step-icon in-progress"><span class="codicon codicon-sync codicon-modifier-spin"></span></span>';
      case 'failed':
        return '<span class="setup-step-icon failed"><span class="codicon codicon-error"></span></span>';
      case 'skipped':
        return '<span class="setup-step-icon skipped"><span class="codicon codicon-dash"></span></span>';
      default:
        return '<span class="setup-step-icon pending"><span class="codicon codicon-circle-outline"></span></span>';
    }
  }

  const stepsHtml = data.steps.map(step => {
    const detail = step.detail ? `<span class="setup-step-detail">${escapeHtml(step.detail)}</span>` : '';
    return `<div class="setup-step-item ${step.status}">
      ${getStepIcon(step.status)}
      <div class="setup-step-content">
        <span class="setup-step-label">${escapeHtml(step.label)}</span>
        ${detail}
      </div>
    </div>`;
  }).join('');

  const bannerSpinner = (data.type === 'start' || data.type === 'step-update')
    ? '<vscode-progress-ring></vscode-progress-ring>'
    : '';

  const messageHtml = data.message
    ? `<p class="setup-progress-message">${escapeHtml(data.message)}</p>`
    : '';

  const dismissBtn = (data.type === 'complete' || data.type === 'failed')
    ? '<button class="setup-progress-dismiss" onclick="dismissSetupProgress()" title="Dismiss"><span class="codicon codicon-close"></span></button>'
    : '';

  container.innerHTML = `
    <div class="setup-progress-panel">
      <div class="setup-progress-header ${bannerClass}">
        ${bannerSpinner}
        <span class="status-icon">${bannerIcon}</span>
        <span class="setup-progress-title">${escapeHtml(data.operationLabel)} \u2014 ${bannerText}</span>
        ${dismissBtn}
      </div>
      <div class="setup-progress-body">
        <div class="setup-progress-steps">${stepsHtml}</div>
        ${messageHtml}
      </div>
    </div>`;
}

function dismissSetupProgress(): void {
  const container = document.getElementById('setupProgressContainer');
  if (container) { container.innerHTML = ''; }
  if (_setupProgressDismissTimer) {
    clearTimeout(_setupProgressDismissTimer);
    _setupProgressDismissTimer = null;
  }
}

// ---------------------------------------------------------------------------
// Expose all onclick handler functions on window
// ---------------------------------------------------------------------------

const w = window as any;
w.sendCommand = sendCommand;
w.sendWorkspaceSetup = sendWorkspaceSetup;
w.navigateToSubPage = navigateToSubPage;
w.navigateToOverview = navigateToOverview;
w.showOverview = showOverview;
w.toggleSection = toggleSection;
w.scrollToSection = scrollToSection;
w.markToolsComplete = markToolsComplete;
w.selectExistingWestWorkspace = selectExistingWestWorkspace;
w.listSDKs = listSDKs;
w.openWestYml = openWestYml;
w.saveAndUpdateWestYml = saveAndUpdateWestYml;
w.hostToolsClient = hostToolsClient;
w.copyToClipboardFromData = copyToClipboardFromData;
w.copyToClipboard = copyToClipboard;
w.dismissSetupProgress = dismissSetupProgress;
