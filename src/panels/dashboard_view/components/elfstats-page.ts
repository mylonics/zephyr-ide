/*
Copyright 2026 mylonics 
Author Rijesh Augustine
SPDX-License-Identifier: Apache-2.0
*/

import { html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { ZephyrLitElement } from "../../webview_shared/lit-base";
import type { DashboardElfStats } from "../dashboard-data";

@customElement("elfstats-page")
export class ElfStatsPage extends ZephyrLitElement {
  @property({ attribute: false }) data!: DashboardElfStats;

  render() {
    if (!this.data) {
      return nothing;
    }
    return html`
      <h1>ELF Stats</h1>
      <p class="empty-state"><code>${this.data.path}</code></p>
      ${this.data.contents
        ? html`<pre class="text-viewer">${this.data.contents}</pre>`
        : html`<p class="empty-state">No ELF stats available.</p>`}
    `;
  }
}
