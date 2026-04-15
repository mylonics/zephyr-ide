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

// Zephyr IDE Project Build Panel Client-Side Logic

import "@vscode-elements/elements/dist/vscode-button/index.js";
import "@vscode-elements/elements/dist/vscode-icon/index.js";
import "@vscode-elements/elements/dist/vscode-badge/index.js";
import "@vscode-elements/elements/dist/vscode-single-select/index.js";
import "@vscode-elements/elements/dist/vscode-option/index.js";
import "@vscode-elements/elements/dist/vscode-tabs/index.js";
import "@vscode-elements/elements/dist/vscode-tab-header/index.js";
import "@vscode-elements/elements/dist/vscode-tab-panel/index.js";
import "@vscode-elements/elements/dist/vscode-scrollable/index.js";
import "@vscode-elements/elements/dist/vscode-table/index.js";
import "@vscode-elements/elements/dist/vscode-table-header/index.js";
import "@vscode-elements/elements/dist/vscode-table-header-cell/index.js";
import "@vscode-elements/elements/dist/vscode-table-body/index.js";
import "@vscode-elements/elements/dist/vscode-table-row/index.js";
import "@vscode-elements/elements/dist/vscode-table-cell/index.js";
import { getVsCodeApi } from "../webview_shared/webviewTypes";

const vscode = getVsCodeApi();

// ---------------------------------------------------------------------------
// Element references
// ---------------------------------------------------------------------------

const projectSelect = () => document.getElementById("projectSelect") as any;
const buildTestSelect = () => document.getElementById("buildTestSelect") as any;
const projectColEl = () => document.getElementById("projectCol");
const buildTestColEl = () => document.getElementById("buildTestCol");
const noProjectArea = () => document.getElementById("noProjectArea");
const headerActions = () => document.getElementById("headerActions");
const selectorContainer = () => document.getElementById("buildTestSelectorContainer");

// ---------------------------------------------------------------------------
// Tab state preservation
// ---------------------------------------------------------------------------

interface TabState {
  [tabId: string]: number;
}

let savedTabState: TabState = {};

function captureTabState(): void {
  savedTabState = {};
  document.querySelectorAll<any>("vscode-tabs[data-tab-id]").forEach((tabs) => {
    const id = tabs.getAttribute("data-tab-id");
    if (id && typeof tabs.selectedIndex === "number") {
      savedTabState[id] = tabs.selectedIndex;
    }
  });
}

function restoreTabState(): void {
  document.querySelectorAll<any>("vscode-tabs[data-tab-id]").forEach((tabs) => {
    const id = tabs.getAttribute("data-tab-id");
    if (id && savedTabState[id] !== undefined) {
      tabs.selectedIndex = savedTabState[id];
    }
  });
}

// ---------------------------------------------------------------------------
// Collapsible section state
// ---------------------------------------------------------------------------

interface SectionState {
  [sectionId: string]: boolean;
}

let savedSectionState: SectionState = {};
let savedProjectDetailOpen = false;

function captureSectionState(): void {
  savedSectionState = {};
  document.querySelectorAll<HTMLElement>(".collapsible-section[data-section-id]").forEach((sec) => {
    const id = sec.getAttribute("data-section-id");
    if (id) {
      savedSectionState[id] = sec.getAttribute("aria-expanded") === "true";
    }
  });

  // Capture project detail panel open/close state
  const bar = document.querySelector<HTMLElement>(".project-summary-bar");
  savedProjectDetailOpen = bar ? bar.getAttribute("aria-expanded") === "true" : false;
}

function restoreSectionState(): void {
  document.querySelectorAll<HTMLElement>(".collapsible-section[data-section-id]").forEach((sec) => {
    const id = sec.getAttribute("data-section-id");
    if (id && savedSectionState[id] !== undefined) {
      sec.setAttribute("aria-expanded", savedSectionState[id] ? "true" : "false");
    }
  });

  // Restore project detail panel open/close state
  const bar = document.querySelector<HTMLElement>(".project-summary-bar");
  const panel = document.querySelector<HTMLElement>(".project-detail-panel");
  if (bar && panel) {
    bar.setAttribute("aria-expanded", savedProjectDetailOpen ? "true" : "false");
    panel.hidden = !savedProjectDetailOpen;
  }
}

function toggleSection(sectionId: string): void {
  const sec = document.querySelector<HTMLElement>(`.collapsible-section[data-section-id="${sectionId}"]`);
  if (sec) {
    const expanded = sec.getAttribute("aria-expanded") === "true";
    sec.setAttribute("aria-expanded", expanded ? "false" : "true");
  }
}

function toggleProjectDetail(): void {
  const bar = document.querySelector<HTMLElement>(".project-summary-bar");
  const panel = document.querySelector<HTMLElement>(".project-detail-panel");
  if (bar && panel) {
    const expanded = bar.getAttribute("aria-expanded") === "true";
    bar.setAttribute("aria-expanded", expanded ? "false" : "true");
    panel.hidden = !expanded ? false : true;
  }
}

// ---------------------------------------------------------------------------
// Auto-save: debounced save on blur for inputs
// ---------------------------------------------------------------------------

let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;

function setupAutoSave(): void {
  document.body.addEventListener("input", (e: Event) => {
    const target = e.target;
    if (target instanceof HTMLInputElement) {
      target.classList.add("input-dirty");
    }
  });

  document.body.addEventListener("focusout", (e: Event) => {
    const target = e.target;
    if (!(target instanceof HTMLInputElement)) {
      return;
    }
    if (!target.classList.contains("input-dirty")) {
      return;
    }
    // Skip add rows (they don't auto-save until both fields filled)
    const row = target.closest(".variable-row-add, .build-arg-row-add");
    if (row) {
      return;
    }

    if (autoSaveTimer) {
      clearTimeout(autoSaveTimer);
    }
    autoSaveTimer = setTimeout(() => {
      target.classList.remove("input-dirty");
      triggerInputSave(target);
    }, 600);
  });
}

function triggerInputSave(input: HTMLInputElement): void {
  const cmd = input.getAttribute("data-command");
  if (!cmd) {
    return;
  }

  // Gather all data-* attributes
  const msg: Record<string, string> = { command: cmd };
  for (const attr of Array.from(input.attributes)) {
    if (attr.name.startsWith("data-") && attr.name !== "data-command") {
      const key = attr.name.slice(5); // strip "data-"
      msg[key] = attr.value;
    }
  }

  // For variable rows, gather both key and value from the row
  if (cmd === "upsertVariable") {
    const row = input.closest(".variable-row");
    if (row) {
      const keyInput = row.querySelector<HTMLInputElement>('[data-field="key"]');
      const valueInput = row.querySelector<HTMLInputElement>('[data-field="value"]');
      if (keyInput && valueInput) {
        msg["key"] = keyInput.value;
        msg["value"] = valueInput.value;
        if (!msg["key"].trim()) {
          return; // Don't save empty key
        }
      }
    }
  } else if (cmd === "upsertBuildArg") {
    msg["value"] = input.value;
  } else if (cmd === "updateRunner") {
    const field = input.getAttribute("data-field");
    if (field) {
      msg[field] = input.value;
    }
  }

  vscode.postMessage(msg);
}

// ---------------------------------------------------------------------------
// Content update from extension host
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Keyed DOM patching — only replace sections whose content actually changed
// ---------------------------------------------------------------------------

// Cache the last HTML written to each container so we can skip innerHTML
// replacement when nothing has changed.
const lastHtml: Record<string, string> = {};

/**
 * Collect keyed elements from a container. Keys come from `data-key` or
 * `data-section-id` attributes. Returns a Map of key → element.
 */
function getKeyedElements(root: HTMLElement): Map<string, HTMLElement> {
  const map = new Map<string, HTMLElement>();
  root.querySelectorAll<HTMLElement>("[data-key], [data-section-id]").forEach((el) => {
    const key = el.getAttribute("data-key") || el.getAttribute("data-section-id");
    if (key) {
      map.set(key, el);
    }
  });
  return map;
}

/**
 * Patch a container's content by comparing keyed subsections individually.
 * Only subsections whose innerHTML actually changed get replaced; the rest
 * keep their existing DOM (preserving shadow DOM, focus, event listeners).
 *
 * Falls back to full innerHTML replacement when the set of keys changes
 * (structural change) or when the container has no keyed subsections.
 */
function patchContainer(container: HTMLElement, cacheKey: string, html: string): boolean {
  // Fast path: entire HTML is unchanged — skip completely
  if (lastHtml[cacheKey] === html) {
    return false;
  }
  lastHtml[cacheKey] = html;

  // Collect keyed elements from the current live DOM
  const oldKeyed = getKeyedElements(container);

  // If there are no keyed elements in the old DOM (first render, or simple
  // container like project options), fall back to full innerHTML replacement.
  if (oldKeyed.size === 0) {
    container.innerHTML = html;
    return true;
  }

  // Parse the new HTML into a temporary container
  const temp = document.createElement("div");
  temp.innerHTML = html;
  const newKeyed = getKeyedElements(temp);

  // If the set of keys changed (sections added/removed, or switched from
  // build to test), fall back to full innerHTML replacement.
  if (oldKeyed.size !== newKeyed.size || ![...newKeyed.keys()].every((k) => oldKeyed.has(k))) {
    container.innerHTML = html;
    return true;
  }

  // Compare each keyed section individually — only replace those that differ
  let anyChanged = false;
  for (const [key, newEl] of newKeyed) {
    const oldEl = oldKeyed.get(key)!;
    if (oldEl.innerHTML !== newEl.innerHTML) {
      oldEl.innerHTML = newEl.innerHTML;
      anyChanged = true;
    }
  }

  return anyChanged;
}

/** Simple innerHTML replacement with caching — for small containers without keyed sections. */
function patchInnerHTML(el: HTMLElement, key: string, html: string): boolean {
  if (lastHtml[key] === html) {
    return false; // no change — skip DOM destruction
  }
  lastHtml[key] = html;
  el.innerHTML = html;
  return true;
}

function applyContentUpdate(data: any): void {
  captureTabState();
  captureSectionState();

  // Capture scroll position before DOM replacement
  const scrollTop = document.documentElement.scrollTop || document.body.scrollTop;

  let anyChanged = false;

  const pOpts = projectSelect();
  if (pOpts && data.projectOptionsHtml !== undefined) {
    anyChanged = patchInnerHTML(pOpts, "projectOptions", data.projectOptionsHtml) || anyChanged;
  }

  const sc = selectorContainer();
  if (sc && data.selectorHtml !== undefined) {
    anyChanged = patchInnerHTML(sc, "selector", data.selectorHtml) || anyChanged;
  }

  const pc = projectColEl();
  if (pc && data.projectHtml !== undefined) {
    anyChanged = patchInnerHTML(pc, "project", data.projectHtml) || anyChanged;
  }

  const np = noProjectArea();
  if (np && data.noProjectHtml !== undefined) {
    anyChanged = patchInnerHTML(np, "noProject", data.noProjectHtml) || anyChanged;
  }

  const bt = buildTestColEl();
  if (bt && data.buildOrTestHtml !== undefined) {
    anyChanged = patchInnerHTML(bt, "buildTest", data.buildOrTestHtml) || anyChanged;
  }

  const ha = headerActions();
  if (ha) {
    ha.style.display = data.projectOptionsHtml ? "" : "none";
  }

  if (!anyChanged) {
    // Nothing in the DOM changed — skip all state restoration work.
    return;
  }

  // Suppress CSS animations during the DOM swap so restored sections don't
  // replay slide/fade animations and cause a visual flash.
  document.body.classList.add("no-animate");

  // Restore UI state synchronously — no rAF — so the browser never paints
  // an intermediate state. Custom elements are already registered so they
  // upgrade during innerHTML and accept property changes immediately.
  restoreTabState();
  restoreSectionState();
  document.documentElement.scrollTop = scrollTop;
  document.body.scrollTop = scrollTop;
  bindSelectListeners();

  // Re-enable animations after the browser has painted the restored state.
  // Using double-rAF ensures the no-animate class is removed only after one
  // full frame has been committed so the restored layout is stable.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.body.classList.remove("no-animate");
    });
  });
}

// ---------------------------------------------------------------------------
// Message handler from extension
// ---------------------------------------------------------------------------

window.addEventListener("message", (event: MessageEvent) => {
  const msg = event.data;
  if (msg.command === "updateContent") {
    applyContentUpdate(msg);
  }
});

// ---------------------------------------------------------------------------
// Click delegation
// ---------------------------------------------------------------------------

// Direct listeners for collapsible headers and project summary bar.
// These use class-based matching instead of data-command to be more robust
// against edge cases with closest() in webview environments.
document.body.addEventListener("click", (event: MouseEvent) => {
  const rawTarget = event.target;
  if (!(rawTarget instanceof HTMLElement)) {
    return;
  }

  // Collapsible section toggle
  const header = rawTarget.closest<HTMLElement>(".collapsible-header");
  if (header) {
    const section = header.closest<HTMLElement>(".collapsible-section");
    if (section) {
      const expanded = section.getAttribute("aria-expanded") === "true";
      section.setAttribute("aria-expanded", expanded ? "false" : "true");
    }
    return;
  }

  // Project summary bar toggle
  const summaryBar = rawTarget.closest<HTMLElement>(".project-summary-bar");
  if (summaryBar) {
    toggleProjectDetail();
    return;
  }

  // Variables help toggle
  const helpBtn = rawTarget.closest<HTMLElement>("[data-command='toggleHelp']");
  if (helpBtn) {
    const helpTarget = helpBtn.getAttribute("data-target");
    if (helpTarget) {
      const el = document.getElementById(helpTarget);
      if (el) {
        el.style.display = el.style.display === "none" ? "" : "none";
      }
    }
    return;
  }

  // All other data-command elements: send to extension
  // Skip inputs/textareas — they use auto-save on blur/Enter, not click.
  if (rawTarget instanceof HTMLInputElement || rawTarget instanceof HTMLTextAreaElement) {
    return;
  }
  const target = rawTarget.closest<HTMLElement>("[data-command]");
  if (!target) {
    return;
  }

  const cmd = target.getAttribute("data-command");
  if (!cmd) {
    return;
  }

  // Send to extension
  const msg: Record<string, string> = { command: cmd };
  for (const attr of Array.from(target.attributes)) {
    if (attr.name.startsWith("data-") && attr.name !== "data-command") {
      const key = attr.name.slice(5);
      msg[key] = attr.value;
    }
  }
  vscode.postMessage(msg);
});

// ---------------------------------------------------------------------------
// Select handlers — non-bubbling 'change' events from vscode-single-select
// must be listened to directly on each element, not via delegation.
// ---------------------------------------------------------------------------

function bindSelectListeners(): void {
  const ps = projectSelect();
  if (ps) {
    ps.addEventListener("change", () => {
      vscode.postMessage({ command: "switchProject", project: ps.value });
    });
  }

  const bts = buildTestSelect();
  if (bts) {
    bts.addEventListener("change", () => {
      vscode.postMessage({ command: "switchBuildOrTest", selection: bts.value });
    });
  }
}

// Bind on initial load
bindSelectListeners();

// ---------------------------------------------------------------------------
// Keyboard handlers: Enter to save on inputs
// ---------------------------------------------------------------------------

document.body.addEventListener("keydown", (event: KeyboardEvent) => {
  if (event.key !== "Enter") {
    return;
  }
  const target = event.target as HTMLElement;
  if (!(target instanceof HTMLInputElement)) {
    return;
  }
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = null;
  }
  target.classList.remove("input-dirty");
  triggerInputSave(target);
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

setupAutoSave();
