/*
Copyright 2026 mylonics 
Author Rijesh Augustine
SPDX-License-Identifier: Apache-2.0
*/

import { html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { ZephyrLitElement } from "../../webview_shared/lit-base";
import type { DashboardSummary } from "../dashboard-data";

const REGION_COLORS: Record<keyof DashboardSummary["memorySummary"], string> = {
  text: "#0288d1",
  rodata: "#7e57c2",
  rwdata: "#ef6c00",
  bss: "#43a047",
  other: "#757575",
};

const REGION_LABELS: Record<keyof DashboardSummary["memorySummary"], string> = {
  text: "Text (code)",
  rodata: "Read-only data",
  rwdata: "Read/write data",
  bss: "BSS",
  other: "Other",
};

@customElement("summary-page")
export class SummaryPage extends ZephyrLitElement {
  @property({ attribute: false }) data!: DashboardSummary;

  private _renderRow(label: string, value: string | number | null | undefined) {
    if (value === null || value === undefined || value === "") {
      return nothing;
    }
    return html`<dt>${label}</dt><dd>${value}</dd>`;
  }

  private _renderMemoryBar() {
    const summary = this.data.memorySummary;
    const total = Object.values(summary).reduce((a, b) => a + b, 0);
    if (total === 0) {
      return html`<p class="text-muted" style="padding:10px 0">No symbol size data available (build may lack a .stat file).</p>`;
    }
    const regions = (Object.entries(summary) as [keyof typeof summary, number][]).filter(
      ([, sz]) => sz > 0,
    );
    return html`
      <div class="memory-bar" role="img" aria-label="Memory breakdown">
        ${regions.map(([region, size]) => {
          const pct = (size * 100) / total;
          return html`<span
            style="width:${pct}%;background-color:${REGION_COLORS[region]}"
            title="${REGION_LABELS[region]}: ${size.toLocaleString()} bytes (${pct.toFixed(1)}%)"
          >${pct >= 10 ? `${pct.toFixed(0)}%` : ""}</span>`;
        })}
      </div>
      <div class="memory-legend">
        ${(Object.entries(summary) as [keyof typeof summary, number][]).map(
          ([region, size]) => html`
            <span>
              <span class="swatch" style="background-color:${REGION_COLORS[region]}"></span>
              ${REGION_LABELS[region]}: ${size.toLocaleString()} B
            </span>
          `,
        )}
      </div>
    `;
  }

  render() {
    if (!this.data) {
      return nothing;
    }
    return html`
      <h1>Build Summary</h1>
      <dl class="summary-grid">
        ${this._renderRow("Board", this.data.board)}
        ${this._renderRow("Application", this.data.application)}
        ${this._renderRow("West command", this.data.command)}
        ${this._renderRow("Zephyr version", this.data.zephyrVersion)}
        ${this._renderRow("Toolchain", this.data.toolchain)}
        ${this._renderRow("ELF size", this.data.elfSize)}
        ${this._renderRow("BIN size", this.data.binSize)}
        ${this._renderRow("ELF date", this.data.elfDate)}
      </dl>
      <h2>Memory Breakdown (from symbol table)</h2>
      ${this._renderMemoryBar()}
    `;
  }
}
