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
    } else if (command === "updateRunner") {
      const row = el.closest(".runner-row");
      const runnerInput = row?.querySelector(".runner-runner-input") as HTMLInputElement | null;
      const argsInput = row?.querySelector(".runner-args-input") as HTMLInputElement | null;
      data["runner-type"] = runnerInput?.value ?? "";
      data["runner-args"] = argsInput?.value ?? "";
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
    if (hasBuildArgInputClass(target)) {
      const row = target?.closest(".build-arg-row");
      const button = row?.querySelector('[data-command="upsertBuildArg"]') as HTMLElement | null;
      if (!button) { return; }
      e.preventDefault();
      button.click();
      return;
    }
    if (target?.classList.contains("runner-input")) {
      const row = target?.closest(".runner-row");
      const button = row?.querySelector('[data-command="updateRunner"]') as HTMLElement | null;
      if (!button) { return; }
      e.preventDefault();
      button.click();
      return;
    }
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
// Tab state preservation
// ---------------------------------------------------------------------------

type TabState = Record<string, number>;

function captureTabState(): TabState {
  const state: TabState = {};
  document.querySelectorAll<HTMLElement>("vscode-tabs[data-tab-id]").forEach((tabs) => {
    const id = tabs.getAttribute("data-tab-id");
    if (id) {
      state[id] = (tabs as any).selectedIndex ?? 0;
    }
  });
  return state;
}

function restoreTabState(state: TabState): void {
  document.querySelectorAll<HTMLElement>("vscode-tabs[data-tab-id]").forEach((tabs) => {
    const id = tabs.getAttribute("data-tab-id");
    if (id && state[id] !== undefined) {
      (tabs as any).selectedIndex = state[id];
    }
  });
}

function saveTabStateToPersistent(): void {
  const tabState = captureTabState();
  const existing = vscode.getState() ?? {};
  vscode.setState({ ...existing, tabState });
}

function restoreTabStateFromPersistent(): void {
  const saved = vscode.getState() as Record<string, unknown> | undefined;
  if (saved?.tabState) {
    restoreTabState(saved.tabState as TabState);
  }
}

// ---------------------------------------------------------------------------
// DOM content update (in-place, preserving tab state)
// ---------------------------------------------------------------------------

function applyContentUpdate(message: any): void {
  const tabState = captureTabState();

  const projectCol = document.getElementById("projectCol");
  const buildTestCol = document.getElementById("buildTestCol");
  const calculatedArea = document.getElementById("calculatedArea");
  const noProjectArea = document.getElementById("noProjectArea");
  const selectorContainer = document.getElementById("buildTestSelectorContainer");
  const headerActions = document.getElementById("headerActions");

  if (projectCol && message.projectHtml !== undefined) {
    projectCol.innerHTML = message.projectHtml;
  }
  if (buildTestCol && message.buildOrTestHtml !== undefined) {
    buildTestCol.innerHTML = message.buildOrTestHtml;
  }
  if (calculatedArea && message.calculatedHtml !== undefined) {
    calculatedArea.innerHTML = message.calculatedHtml;
  }
  if (noProjectArea && message.noProjectHtml !== undefined) {
    noProjectArea.innerHTML = message.noProjectHtml;
  }
  if (selectorContainer && message.selectorHtml !== undefined) {
    selectorContainer.innerHTML = message.selectorHtml;
  }

  // Update header action button disabled states
  if (headerActions) {
    const buttons = headerActions.querySelectorAll<HTMLElement>("vscode-button");
    buttons.forEach((btn) => {
      if (message.hasBuildSelected) {
        btn.removeAttribute("disabled");
      } else {
        btn.setAttribute("disabled", "");
      }
    });
  }

  // Update project selector options
  const projectSelect = document.getElementById("projectSelect");
  if (projectSelect && message.projectOptionsHtml !== undefined) {
    (projectSelect as HTMLElement).innerHTML = message.projectOptionsHtml;
  }

  // Restore tab state after a microtask to let custom elements render
  requestAnimationFrame(() => {
    restoreTabState(tabState);
    saveTabStateToPersistent();
  });
}

// ---------------------------------------------------------------------------
// Initialize
// ---------------------------------------------------------------------------

function init(): void {
  setupChangeHandlers();
  setupClickDelegation();

  // Monitor tab changes to persist state
  document.addEventListener("click", (e) => {
    const target = e.target as HTMLElement | null;
    if (target?.tagName?.toLowerCase() === "vscode-tab-header") {
      // Delay slightly so the tab selection updates first
      requestAnimationFrame(() => saveTabStateToPersistent());
    }
  });

  // Restore tabs from persisted state on initial load
  requestAnimationFrame(() => restoreTabStateFromPersistent());
}

// Handle messages from extension
window.addEventListener("message", (event) => {
  const message = event.data;
  switch (message.command) {
    case "updateContent":
      applyContentUpdate(message);
      break;
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
