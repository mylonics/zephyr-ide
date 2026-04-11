// Zephyr IDE Settings Panel Client-Side Logic

import '@vscode-elements/elements/dist/vscode-button/index.js';
import '@vscode-elements/elements/dist/vscode-checkbox/index.js';
import '@vscode-elements/elements/dist/vscode-textfield/index.js';
import '@vscode-elements/elements/dist/vscode-single-select/index.js';
import '@vscode-elements/elements/dist/vscode-option/index.js';
import '@vscode-elements/elements/dist/vscode-badge/index.js';
import '@vscode-elements/elements/dist/vscode-divider/index.js';
import '@vscode-elements/elements/dist/vscode-label/index.js';
import { getVsCodeApi } from '../webview_shared/webviewTypes';

const vscode = getVsCodeApi();

interface SettingState {
  key: string;
  label: string;
  description: string;
  type: 'boolean' | 'string';
  defaultValue: boolean | string | null;
  currentValue: boolean | string | null;
  scope: 'default' | 'user' | 'workspace';
  userValue: boolean | string | null;
  workspaceValue: boolean | string | null;
  hasUserValue: boolean;
  hasWorkspaceValue: boolean;
}

// Current settings state received from the extension
let currentSettings: SettingState[] = [];

// Listen for messages from the extension
window.addEventListener('message', (event: MessageEvent) => {
  const message = event.data;
  switch (message.command) {
    case 'updateSettings':
      currentSettings = message.settings;
      renderSettings(message.settings);
      break;
    case 'folderSelected':
      onFolderSelected(message.key, message.path);
      break;
  }
});

function formatValue(value: boolean | string | null): string {
  if (value === null || value === undefined) { return '(not set)'; }
  if (typeof value === 'boolean') { return value ? 'true' : 'false'; }
  return `"${value}"`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function updateOverrideWarning(setting: SettingState, targetScope: string): void {
  const warningEl = document.getElementById('override-warning-' + setting.key);
  const infoEl = document.getElementById('override-info-' + setting.key);
  const row = document.querySelector(`.setting-row[data-key="${setting.key}"]`);
  if (!warningEl || !infoEl || !row) { return; }

  const warningText = warningEl.querySelector('.override-warning-text');

  // Show warning when targeting user scope and workspace value exists
  if (targetScope === 'user' && setting.hasWorkspaceValue) {
    warningEl.style.display = '';
    if (warningText) {
      warningText.textContent = `A workspace setting (${formatValue(setting.workspaceValue)}) overrides this user value. Changes to the user setting will not take effect in this workspace.`;
    }
    row.classList.add('setting-row-overridden');
  } else {
    warningEl.style.display = 'none';
    row.classList.remove('setting-row-overridden');
  }

  // Show info about both values when both exist
  if (setting.hasUserValue && setting.hasWorkspaceValue) {
    infoEl.style.display = '';
    infoEl.innerHTML =
      `<span class="override-info-label">User:</span> <span class="override-info-value">${escapeHtml(formatValue(setting.userValue))}</span>` +
      `<span class="override-info-sep">|</span>` +
      `<span class="override-info-label">Workspace:</span> <span class="override-info-value">${escapeHtml(formatValue(setting.workspaceValue))}</span>` +
      `<span class="override-info-note">(workspace wins)</span>`;
  } else {
    infoEl.style.display = 'none';
  }
}

function renderSettings(settings: SettingState[]): void {
  for (const setting of settings) {
    const valEl = document.getElementById('val-' + setting.key) as HTMLElement | null;
    const scopeEl = document.getElementById('scope-' + setting.key) as HTMLElement | null;
    const targetEl = document.getElementById('target-' + setting.key) as HTMLElement | null;
    const resetEl = document.getElementById('reset-' + setting.key) as HTMLElement | null;

    if (!valEl) { continue; }

    // Update value
    if (setting.type === 'boolean') {
      (valEl as any).checked = !!setting.currentValue;
    } else {
      (valEl as any).value = (setting.currentValue !== null && setting.currentValue !== undefined)
        ? String(setting.currentValue)
        : '';
    }

    // Update scope badge
    if (scopeEl) {
      scopeEl.textContent = setting.scope;
      scopeEl.className = 'setting-scope-badge scope-' + setting.scope;
    }

    // Update scope selector to match current scope
    if (targetEl && setting.scope !== 'default') {
      (targetEl as any).value = setting.scope;
    }

    // Show/hide reset button
    if (resetEl) {
      resetEl.style.display = setting.scope === 'default' ? 'none' : '';
    }

    // Update override warnings based on current target scope
    const currentTargetScope = targetEl ? (targetEl as any).value : 'workspace';
    updateOverrideWarning(setting, currentTargetScope);
  }
}

function onToggleChanged(key: string, checked: boolean): void {
  const targetEl = document.getElementById('target-' + key) as HTMLElement | null;
  const scope = targetEl ? (targetEl as any).value : 'workspace';
  vscode.postMessage({
    command: 'updateSetting',
    key: key,
    value: checked,
    scope: scope,
  });
}

function onStringChanged(key: string, value: string): void {
  const targetEl = document.getElementById('target-' + key) as HTMLElement | null;
  const scope = targetEl ? (targetEl as any).value : 'workspace';
  // Treat empty string as null (unset)
  const finalValue = value.trim() === '' ? null : value.trim();
  vscode.postMessage({
    command: 'updateSetting',
    key: key,
    value: finalValue,
    scope: scope,
  });
}

function onScopeChanged(key: string): void {
  // Re-apply current value to the new scope
  const valEl = document.getElementById('val-' + key) as HTMLElement | null;
  const targetEl = document.getElementById('target-' + key) as HTMLElement | null;
  const row = valEl ? valEl.closest('.setting-row') : null;
  if (!valEl || !targetEl || !row) { return; }

  const type = row.getAttribute('data-type');
  const scope = (targetEl as any).value;

  // Update override warnings immediately when scope selector changes
  const setting = currentSettings.find((s) => s.key === key);
  if (setting) {
    updateOverrideWarning(setting, scope);
  }

  let value: boolean | string | null;
  if (type === 'boolean') {
    value = (valEl as any).checked;
  } else {
    const strVal = ((valEl as any).value as string).trim();
    value = strVal === '' ? null : strVal;
  }

  // Only send update if the setting has been explicitly set (not default)
  if (setting && setting.scope !== 'default') {
    vscode.postMessage({
      command: 'updateSetting',
      key: key,
      value: value,
      scope: scope,
    });
  }
}

function onReset(key: string): void {
  vscode.postMessage({
    command: 'resetSetting',
    key: key,
  });
}

function onBrowse(key: string): void {
  vscode.postMessage({
    command: 'browseFolder',
    key: key,
  });
}

function onFolderSelected(key: string, folderPath: string): void {
  const valEl = document.getElementById('val-' + key) as HTMLElement | null;
  if (valEl) {
    (valEl as any).value = folderPath;
    onStringChanged(key, folderPath);
  }
}

function openVsCodeSettings(): void {
  vscode.postMessage({ command: 'openVsCodeSettings' });
}

function setupEventHandlers(): void {
  // vscode-elements fire 'vsc-change' instead of native 'change'
  document.body.addEventListener('vsc-change', (event: Event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) { return; }

    const action = target.getAttribute('data-action');
    const key = target.getAttribute('data-key');

    if (!action || !key) { return; }

    if (action === 'toggle-change') {
      onToggleChanged(key, (target as any).checked);
    } else if (action === 'string-change') {
      onStringChanged(key, (target as any).value);
    } else if (action === 'scope-change') {
      onScopeChanged(key);
    }
  });

  document.body.addEventListener('click', (event: Event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) { return; }

    const actionElement = target.closest('[data-action]');
    if (!(actionElement instanceof HTMLElement)) { return; }

    const action = actionElement.getAttribute('data-action');
    const key = actionElement.getAttribute('data-key');

    if (action === 'open-vscode-settings') {
      openVsCodeSettings();
    } else if (action === 'browse' && key) {
      onBrowse(key);
    } else if (action === 'reset' && key) {
      onReset(key);
    }
  });
}

setupEventHandlers();
