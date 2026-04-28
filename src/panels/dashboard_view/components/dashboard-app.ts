/*
Copyright 2026 mylonics 
Author Rijesh Augustine
SPDX-License-Identifier: Apache-2.0
*/

import { html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { ZephyrLitElement } from "../../webview_shared/lit-base";
import type { DashboardData } from "../dashboard-data";

import "./summary-page";
import "./memory-page";
import "./kconfig-page";
import "./sysinit-page";
import "./dts-page";
import "./elfstats-page";

type PageId = "summary" | "memory" | "kconfig" | "sysinit" | "dts" | "elfstats";

const PAGES: { id: PageId; label: string; icon: string }[] = [
  { id: "summary",  label: "Build Summary",   icon: "codicon-info" },
  { id: "memory",   label: "Memory Report",   icon: "codicon-graph" },
  { id: "kconfig",  label: "Kconfig",          icon: "codicon-settings" },
  { id: "sysinit",  label: "Sys Init",         icon: "codicon-list-ordered" },
  { id: "dts",      label: "Device Tree",      icon: "codicon-circuit-board" },
  { id: "elfstats", label: "ELF Stats",        icon: "codicon-symbol-file" },
];

@customElement("dashboard-app")
export class DashboardApp extends ZephyrLitElement {
  @state() private _data: DashboardData | undefined;
  @state() private _error: string | undefined;
  @state() private _activePage: PageId = "summary";

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("message", this._onMessage);
    this.vscodeApi.postMessage({ command: "ready" });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("message", this._onMessage);
  }

  private _onMessage = (event: MessageEvent) => {
    const msg = event.data;
    if (msg?.command === "updateContent" && msg.data) {
      this._data = msg.data as DashboardData;
      this._error = undefined;
    } else if (msg?.command === "error" && typeof msg.message === "string") {
      this._error = msg.message;
    }
  };

  private _selectPage(id: PageId) {
    this._activePage = id;
  }

  private _onNavKeydown(e: KeyboardEvent, id: PageId) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      this._selectPage(id);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const idx = PAGES.findIndex((p) => p.id === id);
      const next = e.key === "ArrowDown"
        ? PAGES[(idx + 1) % PAGES.length]
        : PAGES[(idx - 1 + PAGES.length) % PAGES.length];
      this._selectPage(next.id);
      // Move focus to the newly selected item
      const el = this.querySelector<HTMLElement>(`[data-page-id="${next.id}"]`);
      el?.focus();
    }
  }

  private _renderPage() {
    if (!this._data) {
      return nothing;
    }
    switch (this._activePage) {
      case "summary":
        return html`<summary-page .data=${this._data.summary}></summary-page>`;
      case "memory":
        return html`<memory-page .data=${this._data.memory}></memory-page>`;
      case "kconfig":
        return html`<kconfig-page .entries=${this._data.kconfig}></kconfig-page>`;
      case "sysinit":
        return html`<sysinit-page .data=${this._data.sysInit}></sysinit-page>`;
      case "dts":
        return html`<dts-page .data=${this._data.dts}></dts-page>`;
      case "elfstats":
        return html`<elfstats-page .data=${this._data.elfStats}></elfstats-page>`;
      default:
        return nothing;
    }
  }

  render() {
    if (this._error) {
      return html`
        <div class="dashboard-error" role="alert">
          <span class="codicon codicon-error" style="font-size:32px"></span>
          <p>${this._error}</p>
        </div>
      `;
    }

    if (!this._data) {
      return html`
        <div class="dashboard-loading" aria-live="polite" aria-busy="true">
          <span class="codicon codicon-loading codicon-modifier-spin" style="font-size:28px"></span>
          <p>Loading dashboard data…</p>
        </div>
      `;
    }

    return html`
      <div class="dashboard-layout">
        <nav class="dashboard-sidebar" aria-label="Dashboard sections">
          <p class="dashboard-sidebar-heading">
            ${this._data.meta.projectName} / ${this._data.meta.buildName}
          </p>
          <ul class="dashboard-nav" role="tablist" aria-orientation="vertical">
            ${PAGES.map(
              (p) => html`
                <li
                  class="dashboard-nav-item"
                  role="tab"
                  tabindex=${this._activePage === p.id ? "0" : "-1"}
                  aria-selected=${this._activePage === p.id ? "true" : "false"}
                  data-page-id=${p.id}
                  @click=${() => this._selectPage(p.id)}
                  @keydown=${(e: KeyboardEvent) => this._onNavKeydown(e, p.id)}
                >
                  <span class="codicon ${p.icon}" aria-hidden="true"></span>
                  ${p.label}
                </li>
              `,
            )}
          </ul>
        </nav>
        <main class="dashboard-content" role="tabpanel">${this._renderPage()}</main>
      </div>
    `;
  }
}
