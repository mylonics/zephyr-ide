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

// Workspace Panel Client-Side Logic

import '@vscode-elements/elements/dist/vscode-button/index.js';
import '@vscode-elements/elements/dist/vscode-icon/index.js';
import '@vscode-elements/elements/dist/vscode-progress-ring/index.js';
import { getVsCodeApi, escapeHtml } from '../webview_shared/webviewTypes';

const vscode = getVsCodeApi();

// ---------------------------------------------------------------------------
// Workspace setup progress state
// ---------------------------------------------------------------------------

let _workspaceSetupActive = false;
let _setupProgressDismissTimer: ReturnType<typeof setTimeout> | null = null;

// ---------------------------------------------------------------------------
// Simple command passthrough
// ---------------------------------------------------------------------------

function sendCommand(cmd: string): void {
  vscode.postMessage({ command: cmd });
}

function showWorkspaceInitializing(): void {
  _workspaceSetupActive = true;
  const body = document.querySelector('.ws-body[data-workspace-state]');
  if (body) {
    body.setAttribute('data-workspace-state', 'initializing');
  }
}

function sendWorkspaceSetup(cmd: string): void {
  showWorkspaceInitializing();
  sendCommand(cmd);
}

function openWestYml(): void { sendCommand('openWestYml'); }

function saveAndUpdateWestYml(): void {
  const editor = document.getElementById('westYmlEditor') as HTMLTextAreaElement | null;
  if (editor) {
    vscode.postMessage({ command: 'saveAndUpdateWestYml', content: editor.value });
  }
}

// ---------------------------------------------------------------------------
// West.yml editor
// ---------------------------------------------------------------------------

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
// Workspace state management
// ---------------------------------------------------------------------------

function setWorkspaceState(state: string): void {
  const body = document.querySelector('.ws-body[data-workspace-state]');
  if (body) {
    body.setAttribute('data-workspace-state', state);
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
  }

  if (data.type === 'complete' || data.type === 'failed') {
    _workspaceSetupActive = false;
  }

  if (!_workspaceSetupActive && data.type !== 'complete' && data.type !== 'failed') {
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
// Keyboard handling
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Message handling
// ---------------------------------------------------------------------------

window.addEventListener('message', event => {
  const message = event.data;

  switch (message.command) {
    case 'westYmlContent':
      loadWestYmlContent(message.content);
      break;
    case 'workspaceSetupProgress':
      handleWorkspaceSetupProgress(message.data);
      break;
  }
});

// ---------------------------------------------------------------------------
// Expose onclick handler functions on window
// ---------------------------------------------------------------------------

const w = window as any;
w.sendCommand = sendCommand;
w.sendWorkspaceSetup = sendWorkspaceSetup;
w.openWestYml = openWestYml;
w.saveAndUpdateWestYml = saveAndUpdateWestYml;
w.dismissSetupProgress = dismissSetupProgress;
