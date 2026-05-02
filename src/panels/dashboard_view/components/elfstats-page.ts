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
      <p style="font-size:12px;color:var(--vscode-descriptionForeground);margin:0 0 12px">
        <code>${this.data.path}</code>
      </p>
      ${this.data.contents
        ? html`<pre class="text-viewer">${this.data.contents}</pre>`
        : html`
            <div class="empty-state">
              <span class="codicon codicon-file-binary" style="font-size:24px;opacity:0.5"></span>
              <p>No ELF stats available.</p>
              <p style="font-size:12px">The <code>zephyr.stat</code> file is generated during a normal build.</p>
            </div>
          `}
    `;
  }
}
