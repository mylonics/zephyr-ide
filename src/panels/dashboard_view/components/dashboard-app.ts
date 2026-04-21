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

const PAGES: { id: PageId; label: string }[] = [
  { id: "summary", label: "Build Summary" },
  { id: "memory", label: "Memory Report" },
  { id: "kconfig", label: "Kconfig" },
  { id: "sysinit", label: "Sys Init" },
  { id: "dts", label: "Device Tree" },
  { id: "elfstats", label: "ELF Stats" },
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
        <div class="dashboard-content">
          <h1>Dashboard</h1>
          <p class="error-state">${this._error}</p>
        </div>
      `;
    }

    if (!this._data) {
      return html`
        <div class="dashboard-content">
          <p class="empty-state">Loading dashboard data…</p>
        </div>
      `;
    }

    return html`
      <div class="dashboard-layout">
        <nav class="dashboard-sidebar">
          <h2>${this._data.meta.projectName} / ${this._data.meta.buildName}</h2>
          <ul>
            ${PAGES.map(
              (p) => html`
                <li
                  class=${this._activePage === p.id ? "active" : ""}
                  @click=${() => this._selectPage(p.id)}
                >
                  ${p.label}
                </li>
              `,
            )}
          </ul>
        </nav>
        <main class="dashboard-content">${this._renderPage()}</main>
      </div>
    `;
  }
}
