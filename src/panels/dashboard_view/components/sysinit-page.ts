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
            <div class="warning-box">
              <ul style="margin:0;padding-left:18px">
                ${this.data.errors.map((e) => html`<li>${e}</li>`)}
              </ul>
            </div>
          `
        : nothing}
      ${levelEntries.length === 0
        ? html`
            <div class="empty-state">
              <span class="codicon codicon-info" style="font-size:24px;opacity:0.5"></span>
              <p>No system initialization data available.</p>
              <p style="font-size:12px">
                This information requires analysis of the Zephyr ELF file.<br>
                It is not yet extracted by the standalone dashboard generator.
              </p>
            </div>
          `
        : levelEntries.map(
            ([level, entries]) => html`
              <h2>${level}</h2>
              <table class="dashboard-table">
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
