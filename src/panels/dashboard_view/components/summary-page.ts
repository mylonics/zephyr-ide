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
  bss: "BSS (zero init)",
  other: "Other",
};

@customElement("summary-page")
export class SummaryPage extends ZephyrLitElement {
  @property({ attribute: false }) data!: DashboardSummary;
  /** True while a background memory refresh is in progress. */
  @property({ type: Boolean }) refreshing = false;

  private _formatBytes(bytes: number): string {
    if (bytes === 0) { return '0 B'; }
    if (bytes < 1024) { return `${bytes} Bytes`; }
    if (bytes < 1024 * 1024) { return `${(bytes / 1024).toFixed(1)} KB`; }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

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
      if (this.refreshing) {
        return html`
          <div style="display:flex;align-items:center;gap:8px;padding:10px 0">
            <span class="codicon codicon-loading codicon-modifier-spin" style="opacity:0.7"></span>
            <span class="text-muted">Generating symbol table…</span>
          </div>
        `;
      }
      return html`<p class="text-muted" style="padding:10px 0">No symbol size data available. Click Refresh on the Memory page to generate it.</p>`;
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
    const ms = this.data.memorySummary;
    const hasMemory = ms.text > 0 || ms.rodata > 0 || ms.rwdata > 0 || ms.bss > 0;
    const romUsed = ms.text + ms.rodata;
    const romPct = this.data.romTotal > 0 ? ((romUsed / this.data.romTotal) * 100).toFixed(1) : null;
    return html`
      <h1>Build Summary</h1>

      <h2>Build Attributes</h2>
      <dl class="summary-grid">
        ${this._renderRow("Zephyr Version", this.data.zephyrVersion)}
        ${this._renderRow("Board", this.data.board)}
        ${this._renderRow("Application", this.data.application)}
        ${this._renderRow("Date", this.data.elfDate)}
        ${this._renderRow("Toolchain", this.data.toolchain)}
      </dl>

      <h2>Build Command</h2>
      <dl class="summary-grid">
        ${this._renderRow("Output Directory", this.data.outputDir)}
        ${this._renderRow("Command", this.data.command)}
      </dl>

      <h2>Memory Summary</h2>
      <dl class="summary-grid">
        ${this._renderRow("Bin Size", this.data.binSize)}
        ${hasMemory ? html`
          ${this._renderRow("Text (Code)", this._formatBytes(ms.text))}
          ${this._renderRow("Read-Only Data", this._formatBytes(ms.rodata))}
          ${this._renderRow("Read/Write Data", this._formatBytes(ms.rwdata))}
          ${this._renderRow("BSS (Zero Init)", this._formatBytes(ms.bss))}
          ${romPct !== null ? this._renderRow("ROM Used", `${romPct}% of ${this._formatBytes(this.data.romTotal)}`) : nothing}
        ` : nothing}
      </dl>

      <h2>Memory Breakdown (from ELF sections)</h2>
      ${this._renderMemoryBar()}
    `;
  }
}
