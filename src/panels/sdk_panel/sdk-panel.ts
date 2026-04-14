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

// SDK Panel Client-Side Logic

import '@vscode-elements/elements/dist/vscode-button/index.js';
import '@vscode-elements/elements/dist/vscode-icon/index.js';
import '@vscode-elements/elements/dist/vscode-progress-ring/index.js';
import { getVsCodeApi, escapeHtml } from '../webview_shared/webviewTypes';

const vscode = getVsCodeApi();

// ---------------------------------------------------------------------------
// SDK Management
// ---------------------------------------------------------------------------

function listSDKs(): void {
  const containerDiv = document.getElementById('sdkListContainer');
  if (containerDiv) {
    containerDiv.innerHTML = '<div class="sdk-loading"><vscode-progress-ring></vscode-progress-ring><span>Loading SDK information...</span></div>';
  }
  setSDKButtonsDisabled(true);
  vscode.postMessage({ command: 'listSDKs' });
}

function installSDK(): void {
  setSDKButtonsDisabled(true);
  vscode.postMessage({ command: 'installSDK' });
}

function setSDKButtonsDisabled(disabled: boolean): void {
  const installBtn = document.getElementById('sdkInstallBtn');
  const listBtn = document.getElementById('sdkListBtn');
  if (installBtn) { (installBtn as any).disabled = disabled; }
  if (listBtn) { (listBtn as any).disabled = disabled; }
}

function showSDKListLoading(): void {
  const containerDiv = document.getElementById('sdkListContainer');
  if (containerDiv) {
    containerDiv.innerHTML = '<div class="sdk-loading"><vscode-progress-ring></vscode-progress-ring><span>Loading SDK information...</span></div>';
  }
}

// ---------------------------------------------------------------------------
// SDK list display
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

function displaySDKList(sdkData: SDKListData): void {
  const containerDiv = document.getElementById('sdkListContainer');
  if (!containerDiv) { return; }

  setSDKButtonsDisabled(false);

  if (!sdkData.success) {
    containerDiv.innerHTML = `
      <div class="sdk-error-box">
        <strong>Error:</strong> ${escapeHtml(sdkData.error || 'Failed to list SDKs')}
        <div style="margin-top: 10px;">
          <vscode-button appearance="secondary" onclick="listSDKs()">
            <vscode-icon slot="start-icon" name="refresh"></vscode-icon>
            Retry
          </vscode-button>
        </div>
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
// SDK install progress
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

function handleSDKInstallProgress(data: SetupProgressData): void {
  const container = document.getElementById('sdkProgressContainer');
  if (!container) { return; }

  if (data.type === 'complete' || data.type === 'failed') {
    setSDKButtonsDisabled(false);
  }

  let bannerClass: string, bannerIcon: string, bannerText: string;
  switch (data.type) {
    case 'complete':
      bannerClass = 'status-success';
      bannerIcon = '<span class="codicon codicon-check"></span>';
      bannerText = 'Installation Complete';
      break;
    case 'failed':
      bannerClass = 'status-error';
      bannerIcon = '<span class="codicon codicon-error"></span>';
      bannerText = 'Installation Failed';
      break;
    default:
      bannerClass = 'status-info';
      bannerIcon = '';
      bannerText = 'Installing SDK...';
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
    ? '<button class="setup-progress-dismiss" onclick="dismissSDKProgress()" title="Dismiss"><span class="codicon codicon-close"></span></button>'
    : '';

  const retryBtn = data.type === 'failed'
    ? '<div style="margin-top: 8px;"><vscode-button appearance="secondary" onclick="installSDK()"><vscode-icon slot="start-icon" name="refresh"></vscode-icon>Retry Installation</vscode-button></div>'
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
        ${retryBtn}
      </div>
    </div>`;
}

function dismissSDKProgress(): void {
  const container = document.getElementById('sdkProgressContainer');
  if (container) { container.innerHTML = ''; }
}

// ---------------------------------------------------------------------------
// Message handling
// ---------------------------------------------------------------------------

window.addEventListener('message', event => {
  const message = event.data;

  switch (message.command) {
    case 'sdkListResult':
      displaySDKList(message.data);
      break;
    case 'sdkListLoading':
      showSDKListLoading();
      break;
    case 'sdkInstallProgress':
      handleSDKInstallProgress(message.data);
      break;
  }
});

// ---------------------------------------------------------------------------
// Expose onclick handler functions on window
// ---------------------------------------------------------------------------

function sendCommand(cmd: string): void {
  vscode.postMessage({ command: cmd });
}

const w = window as any;
w.listSDKs = listSDKs;
w.installSDK = installSDK;
w.dismissSDKProgress = dismissSDKProgress;
w.sendCommand = sendCommand;
