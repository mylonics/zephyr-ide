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

  let value: boolean | string | null;
  if (type === 'boolean') {
    value = (valEl as any).checked;
  } else {
    const strVal = ((valEl as any).value as string).trim();
    value = strVal === '' ? null : strVal;
  }

  // Only send update if the setting has been explicitly set (not default)
  const setting = currentSettings.find((s) => s.key === key);
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
