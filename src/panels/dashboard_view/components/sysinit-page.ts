/*
Copyright 2026 mylonics 
Author Rijesh Augustine
SPDX-License-Identifier: Apache-2.0
*/

import { html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { ZephyrLitElement } from "../../webview_shared/lit-base";
import type { DashboardSysInit } from "../dashboard-data";

@customElement("sysinit-page")
export class SysInitPage extends ZephyrLitElement {
  @property({ attribute: false }) data!: DashboardSysInit;

  render() {
    if (!this.data) {
      return nothing;
    }
    const levelEntries = Object.entries(this.data.levels ?? {});
    return html`
      <h1>System Initialization</h1>
      ${this.data.errors?.length
        ? html`
            <h2>Validation Errors</h2>
            <ul>
              ${this.data.errors.map((e) => html`<li class="error-state">${e}</li>`)}
            </ul>
          `
        : nothing}
      ${levelEntries.length === 0
        ? html`<p class="empty-state">No sys-init levels available.</p>`
        : levelEntries.map(
            ([level, entries]) => html`
              <h2>${level}</h2>
              <table>
                <thead>
                  <tr>
                    <th class="num">Priority</th>
                    <th>Function</th>
                    <th>Path</th>
                  </tr>
                </thead>
                <tbody>
                  ${entries.map(
                    (entry) => html`
                      <tr>
                        <td class="num">${entry.priority ?? ""}</td>
                        <td><code>${entry.name}</code></td>
                        <td><code>${entry.path ?? ""}</code></td>
                      </tr>
                    `,
                  )}
                </tbody>
              </table>
            `,
          )}
    `;
  }
}
