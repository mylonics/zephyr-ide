/*
Copyright 2026 mylonics 
Author Rijesh Augustine
SPDX-License-Identifier: Apache-2.0
*/

import { html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { ZephyrLitElement } from "../../webview_shared/lit-base";
import type { DashboardMemory, DashboardMemoryNode, DashboardMemoryReport } from "../dashboard-data";

type Tab = "all" | "ram" | "rom";

@customElement("memory-page")
export class MemoryPage extends ZephyrLitElement {
  @property({ attribute: false }) data: DashboardMemory | undefined;
  @property({ type: Boolean }) refreshing = false;
  @property({ type: String }) errorMessage: string | undefined;
  @state() private _tab: Tab = "ram";

  private _selectTab(tab: Tab) {
    this._tab = tab;
  }

  private _renderTopTen(report: DashboardMemoryReport | null) {
    if (!report) {
      return nothing;
    }
    const flat: { name: string; size: number; loc: string[] }[] = [];
    const walk = (nodes: DashboardMemoryNode[] | undefined, prefix: string[]) => {
      if (!nodes) { return; }
      for (const n of nodes) {
        if (n.children && n.children.length) {
          walk(n.children, [...prefix, n.data.name]);
        } else if (n.data.name && !n.data.name.startsWith("(")) {
          flat.push({
            name: [...prefix, n.data.name].slice(1).join("/"),
            size: n.data.size,
            loc: n.data.memoryType ?? [],
          });
        }
      }
    };
    walk(report.tree, []);
    flat.sort((a, b) => b.size - a.size);
    const top = flat.slice(0, 10);
    if (!top.length) {
      return nothing;
    }
    return html`
      <h2>Top Ten Symbols by Size</h2>
      <table class="dashboard-table">
        <thead>
          <tr>
            <th>Symbol</th>
            <th class="num">Size (B)</th>
            <th class="num">% of total</th>
            <th>Region</th>
          </tr>
        </thead>
        <tbody>
          ${top.map(
      (s) => html`
              <tr>
                <td>${s.name}</td>
                <td class="num">${s.size.toLocaleString()}</td>
                <td class="num">${((s.size * 100) / report.size).toFixed(2)}%</td>
                <td>${s.loc.map((l) => html`<span class="badge">${l}</span>`)}</td>
              </tr>
            `,
    )}
        </tbody>
      </table>
    `;
  }

  private _renderNode(node: DashboardMemoryNode, total: number): unknown {
    const pct = total > 0 ? (node.data.size * 100) / total : 0;
    const pctStr = pct < 0.1 ? "<0.1%" : `${pct.toFixed(1)}%`;
    const barPct = Math.min(100, Math.max(0.5, pct)).toFixed(1);
    const tags = (node.data.memoryType ?? []).map(
      (t) => html`<span class="mem-tag">${t}</span>`,
    );
    const meta = html`
      <span class="tree-meta">
        <span class="tree-bar-wrap"><span class="tree-bar" style="width:${barPct}%"></span></span>
        <span class="tree-size">${node.data.displaySize}</span>
        <span class="tree-pct">${pctStr}</span>
      </span>
    `;
    if (node.children && node.children.length) {
      return html`
        <details class="tree-branch" ?open=${node.expanded}>
          <summary>
            <span class="tree-toggle codicon codicon-chevron-right"></span>
            <span class="tree-name">${node.data.name}</span>
            ${tags}
            ${meta}
          </summary>
          <div class="tree-children">
            ${node.children.map((c) => this._renderNode(c, total))}
          </div>
        </details>
      `;
    }
    return html`
      <div class="tree-leaf">
        <span class="tree-leaf-indent"></span>
        <span class="tree-name">${node.data.name}</span>
        ${tags}
        ${meta}
      </div>
    `;
  }

  private _onRefreshClick() {
    this.dispatchEvent(new CustomEvent("refresh-memory", { bubbles: true, composed: true }));
  }

  private _renderReport(report: DashboardMemoryReport | null | undefined) {
    if (!report) {
      if (this.refreshing) {
        return html`
          <div class="empty-state">
            <span class="codicon codicon-loading codicon-modifier-spin" style="font-size:24px;opacity:0.7"></span>
            <p>Generating memory report…</p>
          </div>
        `;
      }
      if (this.errorMessage) {
        return html`
          <div class="empty-state">
            <span class="codicon codicon-warning" style="font-size:24px;color:var(--vscode-notificationsWarningIcon-foreground)"></span>
            <p>${this.errorMessage}</p>
          </div>
        `;
      }
      return html`
        <div class="empty-state">
          <span class="codicon codicon-graph" style="font-size:24px;opacity:0.4"></span>
          <p>No data for this view.</p>
          <p style="font-size:12px;opacity:0.7">Click <strong>Refresh</strong> to generate the report.</p>
        </div>
      `;
    }
    const size = typeof report.size === "number" ? report.size : 0;
    const tree = Array.isArray(report.tree) ? report.tree : [];
    return html`
      <p style="font-size:13px;margin:0 0 12px">
        Total: <strong>${size.toLocaleString()} bytes</strong>
      </p>
      <div class="tree">${tree.map((n) => this._renderNode(n, size))}</div>
      ${this._tab === "all" ? this._renderTopTen(report) : nothing}
    `;
  }

  render() {
    if (!this.data) {
      return html`
        <h1>Memory Report</h1>
        <div class="memory-toolbar">
          <vscode-button appearance="secondary" ?disabled=${true}>Total</vscode-button>
          <vscode-button appearance="secondary" ?disabled=${true}>RAM</vscode-button>
          <vscode-button appearance="secondary" ?disabled=${true}>ROM</vscode-button>
          <vscode-button appearance="secondary" ?disabled=${true} style="margin-left:auto">
            <span class="codicon codicon-loading codicon-modifier-spin" style="margin-right:4px"></span>
            Refreshing…
          </vscode-button>
        </div>
        <div class="empty-state">
          <span class="codicon codicon-loading codicon-modifier-spin" style="font-size:24px;opacity:0.7"></span>
          <p>Generating memory report…</p>
        </div>
      `;
    }
    const tabs: { id: Tab; label: string }[] = [
      { id: "all", label: "Total" },
      { id: "ram", label: "RAM" },
      { id: "rom", label: "ROM" },
    ];
    return html`
      <h1>Memory Report</h1>
      <div class="memory-toolbar">
        ${tabs.map(
      (t) => html`
            <vscode-button
              appearance=${this._tab === t.id ? "primary" : "secondary"}
              @click=${() => this._selectTab(t.id)}
            >
              ${t.label}
            </vscode-button>
          `,
    )}
        <vscode-button
          appearance="secondary"
          title="Re-run RAM/ROM report"
          ?disabled=${this.refreshing}
          style="margin-left:auto"
          @click=${this._onRefreshClick}
        >
          <span class="codicon ${this.refreshing ? "codicon-loading codicon-modifier-spin" : "codicon-refresh"}" style="margin-right:4px"></span>
          ${this.refreshing ? "Refreshing…" : "Refresh"}
        </vscode-button>
      </div>
      ${this._renderReport(this.data![this._tab])}
    `;
  }
}
