/*
Copyright 2026 mylonics 
Author Rijesh Augustine
SPDX-License-Identifier: Apache-2.0
*/

import { html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
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
    return this.entries.filter((e) => {
      return (
        e.name.toLowerCase().includes(this._filter) ||
        (e.value ?? "").toLowerCase().includes(this._filter)
      );
    });
  }

  render() {
    if (!this.entries) {
      return nothing;
    }
    const filtered = this._filteredEntries();
    return html`
      <h1>Kconfig (${this.entries.length} symbols)</h1>
      <vscode-textfield
        class="kconfig-filter"
        placeholder="Filter by name or value…"
        .value=${this._filter}
        @input=${this._onFilter}
      ></vscode-textfield>
      <p class="empty-state">${filtered.length} matching</p>
      <table>
        <thead>
          <tr>
            <th>Symbol</th>
            <th>Type</th>
            <th>Value</th>
            <th>Source</th>
            <th>Location</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.map(
            (e) => html`
              <tr>
                <td><code>${e.name}</code></td>
                <td>${e.type}</td>
                <td><code>${e.value ?? ""}</code></td>
                <td>${unsafeHTML(e.srcHtml || "")}</td>
                <td>${unsafeHTML(e.locHtml || "")}</td>
              </tr>
            `,
          )}
        </tbody>
      </table>
    `;
  }
}
