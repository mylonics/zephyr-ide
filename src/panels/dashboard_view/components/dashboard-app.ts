/*
Copyright 2026 mylonics 
Author Rijesh Augustine
SPDX-License-Identifier: Apache-2.0
*/

import { html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { ZephyrLitElement } from "../../webview_shared/lit-base";
import type {
  DashboardData,
  DashboardDts,
  DashboardElfStats,
  DashboardKconfigEntry,
  DashboardMemory,
  DashboardSummary,
  DashboardSysInit,
} from "../dashboard-data";

import "./summary-page";
import "./memory-page";
import "./kconfig-page";
import "./sysinit-page";
import "./dts-page";
import "./elfstats-page";

type PageId = "summary" | "memory" | "kconfig" | "sysinit" | "dts" | "elfstats";

const PAGES: { id: PageId; label: string; icon: string }[] = [
  { id: "summary", label: "Build Summary", icon: "codicon-info" },
  { id: "memory", label: "Memory Report", icon: "codicon-graph" },
  { id: "kconfig", label: "Kconfig", icon: "codicon-settings" },
  { id: "sysinit", label: "Sys Init", icon: "codicon-list-ordered" },
  { id: "dts", label: "Device Tree", icon: "codicon-circuit-board" },
  { id: "elfstats", label: "ELF Stats", icon: "codicon-symbol-file" },
];

@customElement("dashboard-app")
export class DashboardApp extends ZephyrLitElement {
  // ---------------------------------------------------------------------------
  // Granular reactive state — Lit only re-renders the components bound to the
  // slice that changed.  A memory refresh touches _memory and _summary only.
  // ---------------------------------------------------------------------------
  @state() private _meta: DashboardData["meta"] | undefined;
  @state() private _summary: DashboardSummary | undefined;
  @state() private _memory: DashboardMemory | undefined;
  @state() private _kconfig: DashboardKconfigEntry[] | undefined;
  @state() private _sysInit: DashboardSysInit | undefined;
  @state() private _dts: DashboardDts | undefined;
  @state() private _elfStats: DashboardElfStats | undefined;

  @state() private _error: string | undefined;
  @state() private _activePage: PageId = "summary";
  // Start true so the Memory page shows a spinner immediately, before the
  // first memoryRefreshing message arrives from the extension host.
  @state() private _memoryRefreshing = true;
  @state() private _memoryError: string | undefined;
  private _memoryRefreshTimeout: ReturnType<typeof setTimeout> | undefined;

  // Start true so the Kconfig nav item shows a spinner immediately; cleared
  // when the extension signals the session is ready (or failed to start).
  @state() private _kconfigLoading = true;

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("message", this._onMessage);
    this.vscodeApi.postMessage({ command: "ready" });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("message", this._onMessage);
  }

  // ---------------------------------------------------------------------------
  // Message handler — assigns only the slices that changed so Lit's dirty
  // checking skips unchanged components.
  // ---------------------------------------------------------------------------
  private _onMessage = (event: MessageEvent) => {
    const msg = event.data;
    if (msg?.command === "updateContent" && msg.data) {
      const d = msg.data as DashboardData;
      this._meta = d.meta;
      this._summary = d.summary;
      this._memory = d.memory;
      this._kconfig = d.kconfig;
      this._sysInit = d.sysInit;
      this._dts = d.dts;
      this._elfStats = d.elfStats;
      this._error = undefined;
      // Do NOT clear _memoryRefreshing — a background refresh starts right
      // after updateContent; keep spinner visible until updateMemory arrives.
    } else if (msg?.command === "memoryRefreshing") {
      // Extension host has started a memory refresh — show spinner and arm
      // a safety-net timer so the UI never stays stuck if the response is lost.
      this._memoryError = undefined;
      this._memoryRefreshing = true;
      clearTimeout(this._memoryRefreshTimeout);
      this._memoryRefreshTimeout = window.setTimeout(() => {
        if (this._memoryRefreshing) {
          this._memoryRefreshing = false;
          this._memoryError = "Memory refresh timed out.";
        }
      }, 5 * 60 * 1000) as unknown as ReturnType<typeof setTimeout>;
    } else if (msg?.command === "updateMemory") {
      // Only the memory slice and the summary bar update — all other pages
      // are unaffected by this state change.
      const newMemory = msg.memory as DashboardMemory;
      // Skip re-render if the data is structurally identical — avoids resetting
      // the user's sunburst focus and tree expansion while they are interacting.
      if (JSON.stringify(newMemory) !== JSON.stringify(this._memory)) {
        this._memory = newMemory;
      }
      if (msg.memorySummary && this._summary) {
        this._summary = {
          ...this._summary,
          memorySummary: msg.memorySummary as DashboardSummary["memorySummary"],
        };
      }
      // Preserve the error from the message, if any; clear the safety-net timer.
      this._memoryError = typeof msg.error === "string" ? msg.error : undefined;
      this._memoryRefreshing = false;
      clearTimeout(this._memoryRefreshTimeout);
    } else if (msg?.command === "memoryRefreshFailed") {
      this._memoryError = typeof msg.error === "string" ? msg.error : "Memory refresh failed.";
      this._memoryRefreshing = false;
      clearTimeout(this._memoryRefreshTimeout);
    } else if (msg?.command === "kconfigPreloading") {
      this._kconfigLoading = true;
    } else if (msg?.command === "kconfigReady" || msg?.command === "kconfigPreloadFailed") {
      this._kconfigLoading = false;
    } else if (msg?.command === "navigateTo" && typeof msg.page === "string") {
      const pages = PAGES.map(p => p.id as string);
      if (pages.includes(msg.page)) {
        this._selectPage(msg.page as PageId);
      }
    } else if (msg?.command === "error" && typeof msg.message === "string") {
      this._error = msg.message;
    }
  };

  // ---------------------------------------------------------------------------
  // Navigation helpers
  // ---------------------------------------------------------------------------
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
      const el = this.querySelector<HTMLElement>(`[data-page-id="${next.id}"]`);
      el?.focus();
    }
  }

  private _onRefreshMemory() {
    this.postCommand("refreshMemory");
  }

  private _onOpenSymbol = (e: Event) => {
    const ev = e as CustomEvent<{ path?: string; line?: number }>;
    if (!ev.detail?.path) { return; }
    this.vscodeApi.postMessage({
      command: "openMemorySymbol",
      path: ev.detail.path,
      ...(typeof ev.detail.line === "number" ? { line: ev.detail.line } : {}),
    });
  };

  // ---------------------------------------------------------------------------
  // Page content — each child receives only its own data slice.
  // ---------------------------------------------------------------------------
  private _renderPage() {
    switch (this._activePage) {
      case "summary":
        return this._summary
          ? html`<summary-page
              .data=${this._summary}
              .refreshing=${this._memoryRefreshing}
            ></summary-page>`
          : nothing;

      case "memory":
        return html`<memory-page
          .data=${this._memory}
          .refreshing=${this._memoryRefreshing}
          .errorMessage=${this._memoryError}
          @refresh-memory=${this._onRefreshMemory}
          @open-symbol=${this._onOpenSymbol}
        ></memory-page>`;

      case "kconfig":
        // Always render kconfig-page: it boots its own kconfiglib session and
        // falls back to the static `entries` table only if the helper fails.
        // Pass .preloaded so the page can skip the loading-screen flicker when
        // the session was warmed up in the background before the user arrived.
        return html`<kconfig-page .entries=${this._kconfig} .preloaded=${!this._kconfigLoading}></kconfig-page>`;

      case "sysinit":
        return this._sysInit
          ? html`<sysinit-page
              .data=${this._sysInit}
              @open-symbol=${this._onOpenSymbol}
            ></sysinit-page>`
          : nothing;

      case "dts":
        return this._dts
          ? html`<dts-page .data=${this._dts} @open-symbol=${this._onOpenSymbol}></dts-page>`
          : nothing;

      case "elfstats":
        return this._elfStats
          ? html`<elfstats-page .data=${this._elfStats}></elfstats-page>`
          : nothing;

      default:
        return nothing;
    }
  }

  // ---------------------------------------------------------------------------
  // Root render
  // ---------------------------------------------------------------------------
  render() {
    if (this._error) {
      return html`
        <div class="dashboard-error" role="alert">
          <span class="codicon codicon-error" style="font-size:32px"></span>
          <p>${this._error}</p>
        </div>
      `;
    }

    if (!this._meta) {
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
            ${this._meta.projectName} / ${this._meta.buildName}
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
                  ${p.id === "memory" && this._memoryRefreshing
          ? html`<span class="codicon codicon-loading codicon-modifier-spin" style="margin-left:auto;font-size:11px" aria-label="Refreshing…"></span>`
          : nothing}
                  ${p.id === "kconfig" && this._kconfigLoading
          ? html`<span class="codicon codicon-loading codicon-modifier-spin" style="margin-left:auto;font-size:11px" aria-label="Loading…"></span>`
          : nothing}
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

