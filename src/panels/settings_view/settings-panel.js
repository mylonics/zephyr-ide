// Zephyr IDE Settings Panel Client-Side Logic

const vscode = acquireVsCodeApi();

// Current settings state received from the extension
let currentSettings = [];

// Listen for messages from the extension
window.addEventListener('message', (event) => {
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

function renderSettings(settings) {
  for (const setting of settings) {
    const valEl = document.getElementById('val-' + setting.key);
    const scopeEl = document.getElementById('scope-' + setting.key);
    const targetEl = document.getElementById('target-' + setting.key);
    const resetEl = document.getElementById('reset-' + setting.key);

    if (!valEl) { continue; }

    // Update value
    if (setting.type === 'boolean') {
      valEl.checked = !!setting.currentValue;
    } else {
      valEl.value = (setting.currentValue !== null && setting.currentValue !== undefined)
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
      targetEl.value = setting.scope;
    }

    // Show/hide reset button
    if (resetEl) {
      resetEl.style.display = setting.scope === 'default' ? 'none' : '';
    }
  }
}

function onToggleChanged(key, checked) {
  const targetEl = document.getElementById('target-' + key);
  const scope = targetEl ? targetEl.value : 'workspace';
  vscode.postMessage({
    command: 'updateSetting',
    key: key,
    value: checked,
    scope: scope,
  });
}

function onStringChanged(key, value) {
  const targetEl = document.getElementById('target-' + key);
  const scope = targetEl ? targetEl.value : 'workspace';
  // Treat empty string as null (unset)
  const finalValue = value.trim() === '' ? null : value.trim();
  vscode.postMessage({
    command: 'updateSetting',
    key: key,
    value: finalValue,
    scope: scope,
  });
}

function onScopeChanged(key) {
  // Re-apply current value to the new scope
  const valEl = document.getElementById('val-' + key);
  const targetEl = document.getElementById('target-' + key);
  const row = valEl ? valEl.closest('.setting-row') : null;
  if (!valEl || !targetEl || !row) { return; }

  const type = row.getAttribute('data-type');
  const scope = targetEl.value;

  let value;
  if (type === 'boolean') {
    value = valEl.checked;
  } else {
    value = valEl.value.trim() === '' ? null : valEl.value.trim();
  }

  // Only send update if the setting has been explicitly set (not default)
  const setting = currentSettings.find(function(s) { return s.key === key; });
  if (setting && setting.scope !== 'default') {
    vscode.postMessage({
      command: 'updateSetting',
      key: key,
      value: value,
      scope: scope,
    });
  }
}

function onReset(key) {
  vscode.postMessage({
    command: 'resetSetting',
    key: key,
  });
}

function onBrowse(key) {
  vscode.postMessage({
    command: 'browseFolder',
    key: key,
  });
}

function onFolderSelected(key, folderPath) {
  const valEl = document.getElementById('val-' + key);
  if (valEl) {
    valEl.value = folderPath;
    onStringChanged(key, folderPath);
  }
}

function openVsCodeSettings() {
  vscode.postMessage({ command: 'openVsCodeSettings' });
}

function setupEventHandlers() {
  document.body.addEventListener('change', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) { return; }

    const action = target.getAttribute('data-action');
    const key = target.getAttribute('data-key');

    if (!action || !key) { return; }

    if (action === 'toggle-change' && target instanceof HTMLInputElement) {
      onToggleChanged(key, target.checked);
    } else if (action === 'string-change' && target instanceof HTMLInputElement) {
      onStringChanged(key, target.value);
    } else if (action === 'scope-change') {
      onScopeChanged(key);
    }
  });

  document.body.addEventListener('click', (event) => {
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
