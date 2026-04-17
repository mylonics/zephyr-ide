/*
Copyright 2026 mylonics 
Author Rijesh Augustine

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import { html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { ZephyrLitElement } from "../../webview_shared/lit-base";
import type { WebviewTestDetails } from "../project-build-data";

@customElement("test-section")
export class TestSection extends ZephyrLitElement {
  @property({ type: Object }) testDetails!: WebviewTestDetails;

  render() {
    const t = this.testDetails;
    if (!t) { return nothing; }

    return html`
      <div class="test-card">
        <div class="test-card-header">
          <h2 class="test-card-title">
            <i class="codicon codicon-beaker"></i>
            ${t.name}
          </h2>
        </div>
        <div class="test-card-body">
          <div class="info-row">
            <span class="info-label">Platform</span>
            <span class="info-value">${t.platform}</span>
          </div>
          ${t.board
        ? html`<div class="info-row">
                <span class="info-label">Board</span>
                <span class="info-value">${t.board}</span>
              </div>`
        : nothing}
          <div class="info-row">
            <span class="info-label">Tests</span>
            <span class="info-value">${t.tests.length > 0 ? t.tests.join(", ") : html`<em>none</em>`}</span>
          </div>
          ${t.args
        ? html`<div class="info-row">
                <span class="info-label">Arguments</span>
                <span class="info-value" style="font-family: var(--vscode-editor-font-family, monospace); font-size: 0.92em;">${t.args}</span>
              </div>`
        : nothing}
          ${t.serialPort
        ? html`<div class="info-row">
                <span class="info-label">Serial Port</span>
                <span class="info-value">${t.serialPort}</span>
              </div>`
        : nothing}
          ${t.serialBaud
        ? html`<div class="info-row">
                <span class="info-label">Serial Baud</span>
                <span class="info-value">${t.serialBaud}</span>
              </div>`
        : nothing}
        </div>
      </div>
    `;
  }
}
