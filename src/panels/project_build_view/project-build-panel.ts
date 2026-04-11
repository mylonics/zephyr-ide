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

import '@vscode-elements/elements/dist/vscode-button/index.js';
import '@vscode-elements/elements/dist/vscode-icon/index.js';
import '@vscode-elements/elements/dist/vscode-badge/index.js';
import '@vscode-elements/elements/dist/vscode-single-select/index.js';
import '@vscode-elements/elements/dist/vscode-option/index.js';
import '@vscode-elements/elements/dist/vscode-collapsible/index.js';
import '@vscode-elements/elements/dist/vscode-divider/index.js';
import '@vscode-elements/elements/dist/vscode-table/index.js';
import '@vscode-elements/elements/dist/vscode-table-header/index.js';
import '@vscode-elements/elements/dist/vscode-table-header-cell/index.js';
import '@vscode-elements/elements/dist/vscode-table-body/index.js';
import '@vscode-elements/elements/dist/vscode-table-row/index.js';
import '@vscode-elements/elements/dist/vscode-table-cell/index.js';
import '@vscode-elements/elements/dist/vscode-button-group/index.js';
import '@vscode-elements/elements/dist/vscode-tabs/index.js';
import '@vscode-elements/elements/dist/vscode-tab-header/index.js';
import '@vscode-elements/elements/dist/vscode-tab-panel/index.js';
import '@vscode-elements/elements/dist/vscode-scrollable/index.js';

import { getVsCodeApi } from "../webview_shared/webviewTypes";

const vscode = getVsCodeApi();

function sendCommand(command: string, data: Record<string, string> = {}): void {
  vscode.postMessage({ command, ...data });
}

// ---------------------------------------------------------------------------
// Delegated change handlers (vscode-elements fire 'vsc-change')
// ---------------------------------------------------------------------------

function setupChangeHandlers(): void {
  // vscode-single-select fires non-bubbling 'change' events on the host element.
  // Use capture phase to intercept them at document level.
  document.addEventListener("change", (e: Event) => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) { return; }

    const id = target.id;
    if (id === "projectSelect") {
      sendCommand("switchProject", { project: (target as any).value });
    } else if (id === "buildTestSelect") {
      sendCommand("switchBuildOrTest", { selection: (target as any).value });
    }
  }, true); // capture phase

}

// ---------------------------------------------------------------------------
// Delegated click handlers
// ---------------------------------------------------------------------------

function getDataAttributes(el: HTMLElement): Record<string, string> {
  const data: Record<string, string> = {};
  for (const attr of Array.from(el.attributes)) {
    if (attr.name.startsWith("data-")) {
      const key = attr.name.slice(5); // strip 'data-'
      data[key] = attr.value;
    }
  }
  return data;
}

function findCommandElement(target: EventTarget | null): HTMLElement | null {
  let el = target as HTMLElement | null;
  while (el && !el.hasAttribute("data-command")) {
    el = el.parentElement;
  }
  return el;
}

function hasVariableInputClass(target: HTMLElement | null): boolean {
  if (!target) { return false; }
  return target.classList.contains("variable-key-input") || target.classList.contains("variable-value-input");
}

function hasBuildArgInputClass(target: HTMLElement | null): boolean {
  if (!target) { return false; }
  return target.classList.contains("build-arg-input");
}

function setupClickDelegation(): void {
  const eventController = new AbortController();
  const listenerOptions = { signal: eventController.signal };

  document.body.addEventListener("click", (e) => {
    const el = findCommandElement(e.target);
    if (!el) { return; }

    const command = el.getAttribute("data-command");
    if (!command) { return; }

    const data = getDataAttributes(el);
    delete data["command"]; // already extracted

    if (command === "upsertVariable") {
      const row = el.closest(".variable-row");
      const keyInput = row?.querySelector(".variable-key-input") as HTMLInputElement | null;
      const valueInput = row?.querySelector(".variable-value-input") as HTMLInputElement | null;
      data.key = keyInput?.value ?? "";
      data.value = valueInput?.value ?? "";
    } else if (command === "upsertBuildArg") {
      const row = el.closest(".build-arg-row");
      const argInput = row?.querySelector(".build-arg-input") as HTMLInputElement | null;
      data.value = argInput?.value ?? "";
    }

    sendCommand(command, data);
  }, listenerOptions);

  document.body.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") { return; }
    const target = e.target as HTMLElement | null;
    if (hasVariableInputClass(target)) {
      const row = target?.closest(".variable-row");
      const button = row?.querySelector('[data-command="upsertVariable"]') as HTMLElement | null;
      if (!button) { return; }
      e.preventDefault();
      button.click();
      return;
    }
    if (!hasBuildArgInputClass(target)) {
      return;
    }
    const row = target?.closest(".build-arg-row");
    const button = row?.querySelector('[data-command="upsertBuildArg"]') as HTMLElement | null;
    if (!button) { return; }
    e.preventDefault();
    button.click();
  }, listenerOptions);

  const handleKeyboardCommand = (e: KeyboardEvent): void => {
    const el = findCommandElement(e.target);
    if (!el || el.getAttribute("data-keyboard-command") !== "true") { return; }

    const isActivationKey = e.type === "keydown" && (e.key === "Enter" || e.key === " ");
    if (!isActivationKey) { return; }
    e.preventDefault();

    const command = el.getAttribute("data-command");
    if (!command) { return; }

    const data = getDataAttributes(el);
    delete data["command"];
    delete data["keyboard-command"];
    sendCommand(command, data);
  };

  document.body.addEventListener("keydown", handleKeyboardCommand, listenerOptions);
  window.addEventListener("unload", () => eventController.abort(), { once: true });
}

// ---------------------------------------------------------------------------
// Initialize
// ---------------------------------------------------------------------------

function init(): void {
  setupChangeHandlers();
  setupClickDelegation();
}

// Handle messages from extension
window.addEventListener("message", (event) => {
  const message = event.data;
  switch (message.command) {
    case "refresh":
      // Full content replacement handled by extension re-setting HTML
      break;
  }
});

// Run on load
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
