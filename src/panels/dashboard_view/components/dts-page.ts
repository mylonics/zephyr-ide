/*
Copyright 2026 mylonics 
Author Rijesh Augustine
SPDX-License-Identifier: Apache-2.0
*/

import { html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { ZephyrLitElement } from "../../webview_shared/lit-base";
import type { DashboardDts, DashboardEdtNode } from "../dashboard-data";

@customElement("dts-page")
export class DtsPage extends ZephyrLitElement {
  @property({ attribute: false }) data!: DashboardDts;

  private _renderNode(node: DashboardEdtNode): unknown {
    const isProperty = node.edtNode.isProperty;
    const label = isProperty
      ? html`<span><code>${node.edtNode.name}</code> = <code>${node.edtNode.value ?? ""}</code></span>`
      : html`<span><strong>${node.edtNode.name}</strong>${
          node.edtNode.labels?.length
            ? html` <span class="size">[${node.edtNode.labels.join(", ")}]</span>`
            : nothing
        }</span>`;

    if (node.children && node.children.length) {
      return html`
        <details ?open=${node.expanded}>
          <summary>${label}</summary>
          ${node.children.map((c) => this._renderNode(c))}
        </details>
      `;
    }
    return html`<div class="leaf">${label}</div>`;
  }

  render() {
    if (!this.data) {
      return nothing;
    }
    const tree = this.data.tree?.tree ?? [];
    const treeError = this.data.tree?.error;
    return html`
      <h1>Device Tree</h1>
      <p class="empty-state"><code>${this.data.sourcePath}</code></p>
      <div class="dts-layout">
        <div>
          <h2>EDT Tree</h2>
          ${treeError
            ? html`<p class="error-state">${treeError}</p>`
            : tree.length
              ? html`<div class="tree">${tree.map((n) => this._renderNode(n))}</div>`
              : html`<p class="empty-state">No device tree data.</p>`}
        </div>
        <div>
          <h2>Source</h2>
          ${this.data.source
            ? html`<pre class="text-viewer">${this.data.source}</pre>`
            : html`<p class="empty-state">No source available.</p>`}
        </div>
      </div>
    `;
  }
}
