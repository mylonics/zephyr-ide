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
import { customElement, property, state } from "lit/decorators.js";
import { ZephyrLitElement } from "../../webview_shared/lit-base";
import type { WebviewProjectInfo, WebviewVariableCommandInfo } from "../project-build-data";

import "./config-file-group";
import "./variables-table";
import "./variables-help";

@customElement("project-section")
export class ProjectSection extends ZephyrLitElement {
  @property({ type: Object }) projectInfo!: WebviewProjectInfo;
  @property({ type: Object }) projectVars: Record<string, string> = {};
  @property({ type: Array }) variableCommands: WebviewVariableCommandInfo[] = [];

  @state() private _expanded = false;
  @state() private _helpVisible = false;

  private _toggleExpand() {
    this._expanded = !this._expanded;
  }

  private _openFolder(path: string) {
    this.postCommand("openFolder", { file: path });
  }

  private _openFile(path: string) {
    this.postCommand("openFile", { file: path });
  }

  render() {
    const info = this.projectInfo;
    if (!info) { return nothing; }

    const kconfigCount = info.confFiles.config.length;
    const overlayCount = info.confFiles.overlay.length;
    const varCount = Object.keys(this.projectVars).length;

    return html`
      <div class="project-summary-bar" aria-expanded=${this._expanded ? "true" : "false"} @click=${this._toggleExpand}>
        <span class="project-summary-title">
          <i class="codicon codicon-folder"></i>
          ${info.name}
        </span>
        <span class="project-summary-meta">
          <span class="meta-item clickable"
            @click=${(e: Event) => { e.stopPropagation(); this._openFolder(info.absPath); }}
            title=${info.absPath}>${info.relPath}</span>
          <span class="meta-item">main: ${info.mainSourceFile
        ? html`<span class="clickable" @click=${(e: Event) => { e.stopPropagation(); this._openFile(info.mainSourceFile!); }}>${info.mainSourceFile}</span>`
        : html`<em>not found</em>`}</span>
          <span class="meta-item">${kconfigCount} kconfig</span>
          <span class="meta-item">${overlayCount} overlay</span>
          <span class="meta-item">${varCount} var${varCount !== 1 ? "s" : ""}</span>
        </span>
        <span class="project-summary-expand codicon codicon-chevron-right"></span>
      </div>

      ${this._expanded
        ? html`
            <div class="project-detail-panel">
              <div class="info-row">
                <span class="info-label">Path</span>
                <span class="info-value clickable" @click=${() => this._openFolder(info.absPath)}>${info.absPath}</span>
              </div>
              <div class="info-row">
                <span class="info-label">Relative Path</span>
                <span class="info-value">${info.relPath}</span>
              </div>
              <div class="info-row">
                <span class="info-label">Main Source</span>
                <span class="info-value">${info.mainSourceFile
            ? html`<span class="clickable" @click=${() => this._openFile(info.mainSourceFile!)}>${info.mainSourceFile}</span>`
            : html`<em>not found</em>`}</span>
              </div>
              ${info.cmakeFile
            ? html`<div class="info-row">
                    <span class="info-label">CMakeLists.txt</span>
                    <span class="info-value clickable" @click=${() => this._openFile(info.cmakeFile!)}>${info.cmakeFile}</span>
                  </div>`
            : nothing}
              <div class="info-row">
                <span class="info-label">Builds</span>
                <span class="info-value">${info.buildNames.length > 0 ? info.buildNames.join(", ") : html`<em>none</em>`}</span>
              </div>
              <div class="info-row">
                <span class="info-label">Tests</span>
                <span class="info-value">${info.testNames.length > 0 ? info.testNames.join(", ") : html`<em>none</em>`}</span>
              </div>

              <config-file-group
                idPrefix="project-${info.name}"
                .kconfigFiles=${info.confFiles.config}
                kconfigAddCmd="addProjectConfigFile"
                kconfigRemoveCmd="removeProjectConfigFile"
                kconfigToggleCmd="toggleProjectConfigFileExtra"
                .overlayFiles=${info.confFiles.overlay}
                overlayAddCmd="addProjectOverlayFile"
                overlayRemoveCmd="removeProjectOverlayFile"
                overlayToggleCmd="toggleProjectOverlayFileExtra"
              ></config-file-group>

              <div class="variables-section">
                <div class="section-row-header">
                  <span class="section-row-title">Project Variables</span>
                  <vscode-button appearance="icon" icon="question" title="Variable help"
                    @click=${() => { this._helpVisible = !this._helpVisible; }}>
                  </vscode-button>
                </div>
                ${this._helpVisible
            ? html`<variables-help .commands=${this.variableCommands}></variables-help>`
            : nothing}
                <variables-table
                  level="project"
                  .projectName=${info.name}
                  .vars=${this.projectVars}
                ></variables-table>
              </div>
            </div>
          `
        : nothing}
    `;
  }
}
