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
  @property({ attribute: false }) data!: DashboardMemory;
  @state() private _tab: Tab = "all";

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
    const pct = total > 0 ? ((node.data.size * 100) / total).toFixed(2) : "0";
    const tags = (node.data.memoryType ?? []).map(
      (t) => html`<span class="mem-tag">${t}</span>`,
    );
    if (node.children && node.children.length) {
      return html`
        <details ?open=${node.expanded}>
          <summary>
            ${node.data.name}
            <span class="size">${node.data.displaySize} (${pct}%)</span>
            ${tags}
          </summary>
          ${node.children.map((c) => this._renderNode(c, total))}
        </details>
      `;
    }
    return html`
      <div class="leaf">
        ${node.data.name}
        <span class="size">${node.data.displaySize} (${pct}%)</span>
        ${tags}
      </div>
    `;
  }

  private _renderReport(report: DashboardMemoryReport | null) {
    if (!report) {
      return html`
        <div class="empty-state">
          <span class="codicon codicon-info" style="font-size:24px;opacity:0.5"></span>
          <p>No memory report available for this view.</p>
          <p style="font-size:12px">Run <code>Zephyr IDE: RAM/ROM Report</code> to generate one.</p>
        </div>
      `;
    }
    return html`
      <p style="font-size:13px;margin:0 0 12px">
        Total: <strong>${report.size.toLocaleString()} bytes</strong>
      </p>
      <div class="tree">${report.tree.map((n) => this._renderNode(n, report.size))}</div>
      ${this._tab === "all" ? this._renderTopTen(report) : nothing}
    `;
  }

  render() {
    if (!this.data) {
      return nothing;
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
      </div>
      ${this._renderReport(this.data[this._tab])}
    `;
  }
}
