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

  // Canonical order and display names for Zephyr init levels.
  private static readonly LEVEL_ORDER = [
    'EARLY', 'PRE_KERNEL_1', 'PRE_KERNEL_2', 'POST_KERNEL', 'APPLICATION', 'SMP',
  ];
  private static readonly LEVEL_LABELS: Record<string, string> = {
    EARLY: 'Early',
    PRE_KERNEL_1: 'Pre-Kernel 1',
    PRE_KERNEL_2: 'Pre-Kernel 2',
    POST_KERNEL: 'Post-Kernel',
    APPLICATION: 'Application',
    SMP: 'SMP',
  };
  private static readonly LEVEL_DESCRIPTIONS: Record<string, string> = {
    EARLY: 'Before kernel services are available. Used for minimal hardware init (e.g. pinmux, clocks).',
    PRE_KERNEL_1: 'Before the kernel scheduler starts. Interrupts are disabled.',
    PRE_KERNEL_2: 'After PRE_KERNEL_1. Interrupts still disabled. Used for drivers that depend on PRE_KERNEL_1 devices.',
    POST_KERNEL: 'After the kernel scheduler starts. Interrupts are enabled. Most drivers initialize here.',
    APPLICATION: 'After all kernel and driver init. Used by application-level subsystems.',
    SMP: 'Secondary CPU cores initialization (SMP builds only).',
  };

  render() {
    if (!this.data) {
      return nothing;
    }

    const allLevels = Object.keys(this.data.levels ?? {});
    const hasAnyData = allLevels.length > 0;

    // Show all canonical levels; append any unknown levels at the end.
    const levelsToShow = [
      ...SysInitPage.LEVEL_ORDER,
      ...allLevels.filter((l) => !SysInitPage.LEVEL_ORDER.includes(l)),
    ];

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
      ${!hasAnyData
        ? html`
            <div class="empty-state">
              <span class="codicon codicon-info" style="font-size:24px;opacity:0.5"></span>
              <p>No system initialization data available.</p>
              <p style="font-size:12px">Run a build first to generate ELF and map files.</p>
            </div>
          `
        : levelsToShow.map((level) => {
          const entries = (this.data.levels[level] ?? [])
            .slice()
            .sort((a, b) => {
              const pa = Number(a.priority ?? 0), pb = Number(b.priority ?? 0);
              if (pa !== pb) { return pa - pb; }
              return Number(a.ordinal ?? 0) - Number(b.ordinal ?? 0);
            });
          const label = SysInitPage.LEVEL_LABELS[level] ?? level;
          const description = SysInitPage.LEVEL_DESCRIPTIONS[level] ?? '';
          const isEmpty = entries.length === 0;
          return html`
              <div style="margin-bottom:24px">
                <h2 style="margin-bottom:2px">
                  ${label}
                  ${isEmpty
              ? nothing
              : html`<span style="font-size:0.75em;opacity:0.6;font-weight:normal"> (${entries.length})</span>`}
                </h2>
                ${description
              ? html`<p style="margin:0 0 8px;font-size:12px;opacity:0.65">${description}</p>`
              : nothing}
                ${isEmpty
              ? html`<p style="font-size:12px;opacity:0.5;font-style:italic;margin:0">No init functions at this level.</p>`
              : html`
                    <table class="dashboard-table">
                      <thead>
                        <tr>
                          <th class="num" title="Priority / Ordinal">Pri / Ord</th>
                          <th>Type</th>
                          <th>Name</th>
                          <th>Source File</th>
                        </tr>
                      </thead>
                      <tbody>
                        ${entries.map((entry) => {
                const isDevice = entry.name.startsWith('__device_dts_ord_');
                const displayName = isDevice
                  ? `device_dts_ord_${entry.name.slice('__device_dts_ord_'.length)}`
                  : entry.name;
                const priOrd = entry.priority != null
                  ? `${entry.priority}${entry.ordinal != null ? ` / ${entry.ordinal}` : ''}`
                  : '';
                        const openFile = () => {
                          if (!entry.path) { return; }
                          this.dispatchEvent(new CustomEvent('open-symbol', {
                            detail: { path: entry.path },
                            bubbles: true,
                            composed: true,
                          }));
                        };
                        return html`
                            <tr>
                              <td class="num">${priOrd}</td>
                              <td>
                                <span style="
                                  font-size:11px;padding:1px 6px;border-radius:3px;
                                  background:${isDevice ? 'var(--vscode-badge-background)' : 'var(--vscode-editorInfo-foreground)'};
                                  color:var(--vscode-badge-foreground);
                                  white-space:nowrap
                                ">${isDevice ? 'Device' : 'SYS_INIT'}</span>
                              </td>
                              <td><code>${displayName}</code></td>
                              <td>${entry.path
                                ? html`<button
                                    class="link-button"
                                    title="Open ${entry.path}"
                                    @click=${openFile}
                                  ><code>${entry.path.replace(/\\/g, '/').split('/').pop()}</code></button>`
                                : nothing}</td>
                            </tr>
                          `;
              })}
                      </tbody>
                    </table>
                  `}
              </div>
            `;
        })}
    `;
  }
}
