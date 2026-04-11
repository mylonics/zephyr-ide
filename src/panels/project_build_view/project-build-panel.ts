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

import { getVsCodeApi } from "../webview_shared/webviewTypes";

const vscode = getVsCodeApi();

function sendCommand(command: string, data: Record<string, string> = {}): void {
  vscode.postMessage({ command, ...data });
}

// ---------------------------------------------------------------------------
// Project selector
// ---------------------------------------------------------------------------

function setupProjectSelector(): void {
  const select = document.getElementById("projectSelect") as HTMLElement | null;
  if (select) {
    select.addEventListener("vsc-change", (e: Event) => {
      const value = (e.target as any).value;
      sendCommand("switchProject", { project: value });
    });
  }
}

// ---------------------------------------------------------------------------
// Build / test selector
// ---------------------------------------------------------------------------

function setupBuildTestSelector(): void {
  const select = document.getElementById("buildTestSelect") as HTMLElement | null;
  if (select) {
    select.addEventListener("vsc-change", (e: Event) => {
      const value = (e.target as any).value;
      sendCommand("switchBuildOrTest", { selection: value });
    });
  }
}

// ---------------------------------------------------------------------------
// Collapsible sections
// ---------------------------------------------------------------------------

function setupCollapsibles(): void {
  // vscode-collapsible handles its own open/close natively; no manual toggle needed.
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

    sendCommand(command, data);
  }, listenerOptions);

  const handleKeyboardCommand = (e: KeyboardEvent): void => {
    const el = findCommandElement(e.target);
    if (!el || el.getAttribute("data-keyboard-command") !== "true") { return; }

    const isEnter = e.key === "Enter" && e.type === "keydown";
    const isSpace = e.key === " " && e.type === "keyup";
    if (!isEnter && !isSpace) { return; }
    e.preventDefault();

    const command = el.getAttribute("data-command");
    if (!command) { return; }

    const data = getDataAttributes(el);
    delete data["command"];
    delete data["keyboard-command"];
    sendCommand(command, data);
  };

  document.body.addEventListener("keydown", handleKeyboardCommand, listenerOptions);
  document.body.addEventListener("keyup", handleKeyboardCommand, listenerOptions);
  window.addEventListener("unload", () => eventController.abort(), { once: true });
}

// ---------------------------------------------------------------------------
// Initialize
// ---------------------------------------------------------------------------

function init(): void {
  setupProjectSelector();
  setupBuildTestSelector();
  setupCollapsibles();
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
