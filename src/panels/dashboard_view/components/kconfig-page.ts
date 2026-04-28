/*
Copyright 2026 mylonics 
Author Rijesh Augustine
SPDX-License-Identifier: Apache-2.0
*/

import { html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { ZephyrLitElement } from "../../webview_shared/lit-base";
import type { DashboardKconfigEntry } from "../dashboard-data";

@customElement("kconfig-page")
export class KconfigPage extends ZephyrLitElement {
  @property({ attribute: false }) entries!: DashboardKconfigEntry[];
  @state() private _filter = "";

  private _onFilter(e: Event) {
    const target = e.currentTarget as { value?: string } | null;
    this._filter = (target?.value ?? "").trim().toLowerCase();
  }

  private _filteredEntries() {
    if (!this._filter) {
      return this.entries;
    }
    const f = this._filter;
    return this.entries.filter(
      (e) =>
        e.name.toLowerCase().includes(f) ||
        e.value.toLowerCase().includes(f),
    );
  }

  render() {
    if (!this.entries) {
      return nothing;
    }
    const filtered = this._filteredEntries();
    return html`
      <h1>Kconfig <span style="font-weight:400;font-size:0.75em;opacity:0.7">(${this.entries.length} symbols)</span></h1>
      <vscode-textfield
        class="kconfig-filter"
        placeholder="Filter by name or value…"
        .value=${this._filter}
        @input=${this._onFilter}
      ></vscode-textfield>
      <p class="kconfig-count">${filtered.length} of ${this.entries.length} symbols</p>
      <table class="dashboard-table">
        <thead>
          <tr>
            <th>Symbol</th>
            <th>Type</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.map(
            (e) => html`
              <tr>
                <td><code>${e.name}</code></td>
                <td><span class="badge">${e.type ?? ""}</span></td>
                <td><code>${e.value}</code></td>
              </tr>
            `,
          )}
        </tbody>
      </table>
    `;
  }
}
