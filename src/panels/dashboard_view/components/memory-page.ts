/*
Copyright 2026 mylonics
Author Rijesh Augustine
SPDX-License-Identifier: Apache-2.0
*/

import { html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { ZephyrLitElement } from "../../webview_shared/lit-base";
import type { DashboardMemory, DashboardMemoryReport, DashboardMemoryNode } from "../dashboard-data";

import "./memory/sunburst-chart";
import "./memory/memory-tree-table";
import { filterKeys } from "./memory/memory-utils";

type Tab = "all" | "ram" | "rom";

@customElement("memory-page")
export class MemoryPage extends ZephyrLitElement {
  @property({ attribute: false }) data: DashboardMemory | undefined;
  @property({ type: Boolean }) refreshing = false;
  @property({ type: String }) errorMessage: string | undefined;

  @state() private _tab: Tab = "ram";
  @state() private _query = "";
  @state() private _selectedKey = "";
  @state() private _hideSunburst = false;

  // Cache the synthetic root per report reference.  When the same report
  // object is rendered again (e.g. refreshing spinner clears but data didn't
  // change) the sunburst receives the same root reference, so Lit's dirty
  // check skips the update and _focusKey / tree expansion are preserved.
  private _rootCache = new WeakMap<DashboardMemoryReport, DashboardMemoryNode>();

  private _getRoot(report: DashboardMemoryReport): DashboardMemoryNode {
    if (this._rootCache.has(report)) { return this._rootCache.get(report)!; }
    const root: DashboardMemoryNode = report.tree.length === 1
      ? report.tree[0]
      : {
        expanded: true,
        data: { name: "All", size: report.size, displaySize: `${report.size} B` },
        children: report.tree,
      };
    this._rootCache.set(report, root);
    return root;
  }

  private _selectTab(tab: Tab) {
    if (this._tab === tab) { return; }
    this._tab = tab;
    this._selectedKey = "";
    this._query = "";
  }

  private _onSearchInput(e: Event) {
    const t = e.target as HTMLInputElement | { value?: string };
    this._query = (t.value ?? "").trim();
  }

  private _onClearSearch() {
    this._query = "";
  }

  private _onRefreshClick() {
    this.dispatchEvent(new CustomEvent("refresh-memory", { bubbles: true, composed: true }));
  }

  private _onTreeSelect = (e: Event) => {
    const ev = e as CustomEvent<{ key: string }>;
    this._selectedKey = ev.detail.key;
  };

  private _onArcSelect = (e: Event) => {
    const ev = e as CustomEvent<{ key: string }>;
    this._selectedKey = ev.detail.key;
  };

  private _onRowDrill = (e: Event) => {
    const ev = e as CustomEvent<{ key: string }>;
    const key = ev.detail?.key;
    if (!key) { return; }
    this._selectedKey = key;
    const sunburst = this.querySelector("memory-sunburst") as (HTMLElement & { focusKey(k: string): void }) | null;
    sunburst?.focusKey(key);
  };

  private _onOpenSymbol = (e: Event) => {
    const ev = e as CustomEvent<{ identifier: string }>;
    if (ev.detail?.identifier) {
      this.dispatchEvent(new CustomEvent("open-symbol", {
        detail: { path: ev.detail.identifier },
        bubbles: true,
        composed: true,
      }));
    }
  };

  private _renderToolbar(disabled: boolean) {
    const tabs: { id: Tab; label: string; title: string }[] = [
      { id: "all", label: "Total", title: "Total: combined RAM + ROM usage (all memory regions)" },
      { id: "ram", label: "RAM", title: "RAM: read-write memory in SRAM — BSS (zero-init globals), data (initialized globals), and stack/heap" },
      { id: "rom", label: "ROM", title: "ROM: read-only memory in Flash — text (code), rodata (const data), and other non-volatile sections" },
    ];
    const tabDescriptions: Record<Tab, string> = {
      all: "All memory regions combined",
      ram: "SRAM — BSS, data, stack/heap",
      rom: "Flash — text, rodata, const sections",
    };
    return html`
      <div class="memory-toolbar">
        <div class="memory-tabs" role="tablist">
          ${tabs.map(
      (t) => html`
              <button
                class="memory-tab ${this._tab === t.id ? "is-active" : ""}"
                role="tab"
                aria-selected=${this._tab === t.id}
                title=${t.title}
                ?disabled=${disabled}
                @click=${() => this._selectTab(t.id)}
              >${t.label}</button>
            `,
    )}
        </div>
        <span class="memory-tab-desc">${tabDescriptions[this._tab]}</span>
        <div class="memory-search">
          <span class="codicon codicon-search memory-search-icon" aria-hidden="true"></span>
          <input
            type="text"
            class="memory-search-input"
            placeholder="Search symbols…"
            .value=${this._query}
            ?disabled=${disabled}
            @input=${this._onSearchInput}
          />
          ${this._query
        ? html`<button
                class="memory-search-clear codicon codicon-close"
                aria-label="Clear search"
                @click=${this._onClearSearch}
              ></button>`
        : nothing}
        </div>
        <button
          class="memory-icon-btn"
          title=${this._hideSunburst ? "Show sunburst diagram" : "Hide sunburst diagram"}
          @click=${() => (this._hideSunburst = !this._hideSunburst)}
        >
          <span class="codicon ${this._hideSunburst ? "codicon-pie-chart" : "codicon-layout-sidebar-left-off"}"></span>
        </button>
        <button
          class="memory-icon-btn"
          title="Re-run RAM/ROM report"
          ?disabled=${this.refreshing}
          @click=${this._onRefreshClick}
        >
          <span class="codicon ${this.refreshing ? "codicon-loading codicon-modifier-spin" : "codicon-refresh"}"></span>
        </button>
      </div>
    `;
  }

  private _renderEmpty() {
    if (this.refreshing) {
      return html`
        <div class="memory-empty">
          <span class="codicon codicon-loading codicon-modifier-spin" style="font-size:28px;opacity:0.7"></span>
          <p>Generating memory report…</p>
        </div>
      `;
    }
    if (this.errorMessage) {
      return html`
        <div class="memory-empty">
          <span class="codicon codicon-warning" style="font-size:28px;color:var(--vscode-notificationsWarningIcon-foreground)"></span>
          <p>${this.errorMessage}</p>
          <button class="memory-cta" @click=${this._onRefreshClick}>
            <span class="codicon codicon-refresh"></span> Retry
          </button>
        </div>
      `;
    }
    return html`
      <div class="memory-empty">
        <span class="codicon codicon-graph" style="font-size:28px;opacity:0.4"></span>
        <p>No memory report available for this view.</p>
        <button class="memory-cta" @click=${this._onRefreshClick}>
          <span class="codicon codicon-refresh"></span> Generate report
        </button>
      </div>
    `;
  }

  private _renderReport(report: DashboardMemoryReport) {
    const root = this._getRoot(report);
    const tree = report.tree;
    const visible = this._query ? filterKeys(tree, this._query) : undefined;

    return html`
      <div class="memory-layout ${this._hideSunburst ? "no-sunburst" : ""}">
        ${this._hideSunburst
        ? nothing
        : html`
              <div class="sunburst-card">
                <memory-sunburst
                  .root=${root}
                  .selectedKey=${this._selectedKey}
                  .visibleKeys=${visible}
                  regionLabel=${this._tab === "ram" ? "RAM" : this._tab === "rom" ? "ROM" : "All"}
                  @arc-select=${this._onArcSelect}
                  @arc-open=${this._onOpenSymbol}
                ></memory-sunburst>
              </div>
            `}
        <div class="tree-card">
          <memory-tree-table
            .tree=${tree}
            .total=${report.size}
            .selectedKey=${this._selectedKey}
            .query=${this._query}
            @row-select=${this._onTreeSelect}
            @row-drill=${this._onRowDrill}
            @row-open=${this._onOpenSymbol}
          ></memory-tree-table>
        </div>
      </div>
    `;
  }

  render() {
    const report = this.data ? this.data[this._tab] : null;
    const disabled = !this.data;
    return html`
      <h1>Memory Report</h1>
      ${this._renderToolbar(disabled)}
      ${report ? this._renderReport(report) : this._renderEmpty()}
    `;
  }
}
