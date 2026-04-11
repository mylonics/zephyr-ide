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

import { getVsCodeApi } from "../webview_shared/webviewTypes";

const vscode = getVsCodeApi();

function sendCommand(command: string, data: Record<string, string> = {}): void {
  vscode.postMessage({ command, ...data });
}

// ---------------------------------------------------------------------------
// Project selector
// ---------------------------------------------------------------------------

function setupProjectSelector(): void {
  const select = document.getElementById("projectSelect") as HTMLSelectElement | null;
  if (select) {
    select.addEventListener("change", () => {
      sendCommand("switchProject", { project: select.value });
    });
  }
}

// ---------------------------------------------------------------------------
// Build / test selector
// ---------------------------------------------------------------------------

function setupBuildTestSelector(): void {
  const select = document.getElementById("buildTestSelect") as HTMLSelectElement | null;
  if (select) {
    select.addEventListener("change", () => {
      sendCommand("switchBuildOrTest", { selection: select.value });
    });
  }
}

// ---------------------------------------------------------------------------
// Collapsible sections
// ---------------------------------------------------------------------------

function setupCollapsibles(): void {
  document.querySelectorAll<HTMLElement>("[data-toggle]").forEach((header) => {
    header.addEventListener("click", () => {
      const sectionId = header.getAttribute("data-toggle");
      if (!sectionId) { return; }
      const body = document.querySelector<HTMLElement>(`[data-section="${sectionId}"]`);
      if (!body) { return; }

      const isHidden = body.style.display === "none";
      body.style.display = isHidden ? "block" : "none";

      const icon = header.querySelector<HTMLElement>(".toggle-icon");
      if (icon) {
        icon.classList.toggle("codicon-chevron-right", !isHidden);
        icon.classList.toggle("codicon-chevron-down", isHidden);
      }
    });
  });
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
  document.body.addEventListener("click", (e) => {
    const el = findCommandElement(e.target);
    if (!el) { return; }

    const command = el.getAttribute("data-command");
    if (!command) { return; }

    const data = getDataAttributes(el);
    delete data["command"]; // already extracted

    sendCommand(command, data);
  });
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
