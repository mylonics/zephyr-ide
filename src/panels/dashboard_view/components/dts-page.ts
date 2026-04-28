/*
Copyright 2026 mylonics 
Author Rijesh Augustine
SPDX-License-Identifier: Apache-2.0
*/

import { html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { ZephyrLitElement } from "../../webview_shared/lit-base";
import type { DashboardDts } from "../dashboard-data";

@customElement("dts-page")
export class DtsPage extends ZephyrLitElement {
  @property({ attribute: false }) data!: DashboardDts;

  render() {
    if (!this.data) {
      return nothing;
    }
    return html`
      <h1>Device Tree</h1>
      <p style="font-size:12px;color:var(--vscode-descriptionForeground);margin:0 0 10px">
        <code>${this.data.sourcePath}</code>
      </p>
      ${this.data.source
        ? html`<pre class="text-viewer">${this.data.source}</pre>`
        : html`<p class="text-muted">No device tree source available.</p>`}
    `;
  }
}
