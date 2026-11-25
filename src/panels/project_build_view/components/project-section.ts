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

import { panelText } from "../../webview_shared/panel-text";
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
      <div class="project-summary-card" aria-expanded=${this._expanded ? "true" : "false"}>
        <div class="project-summary-header">
          <span class="project-summary-title">
            <i class="codicon codicon-folder"></i>
            ${info.name}
          </span>
        </div>
        <div class="project-summary-details">
          <div class="project-detail-grid">
            <span class="detail-label">${panelText("Path")}</span>
            <span class="detail-value clickable"
              @click=${() => this._openFolder(info.absPath)}
              title=${info.absPath}>${info.relPath}</span>

            <span class="detail-label">${panelText("Main Source")}</span>
            <span class="detail-value">${info.mainSourceFile
        ? html`<span class="clickable" @click=${() => this._openFile(info.mainSourceFile!)}>${info.mainSourceFile}</span>`
        : html`<em>${panelText("not found")}</em>`}</span>

            ${info.cmakeFile
        ? html`
              <span class="detail-label">${panelText("CMakeLists.txt")}</span>
              <span class="detail-value clickable" @click=${() => this._openFile(info.cmakeFile!)}>${info.cmakeFile}</span>`
        : nothing}

            <span class="detail-label">${panelText("Builds")}</span>
            <span class="detail-value">${info.buildNames.length > 0 ? info.buildNames.join(", ") : html`<em>${panelText("none")}</em>`}</span>

            <span class="detail-label">${panelText("Tests")}</span>
            <span class="detail-value">${info.testNames.length > 0 ? info.testNames.join(", ") : html`<em>${panelText("none")}</em>`}</span>
          </div>
          <div class="project-summary-badges">
            <span class="summary-badge" title="${panelText("Kconfig files")}"><i class="codicon codicon-settings-gear"></i> ${kconfigCount} ${panelText("kconfig")}</span>
            <span class="summary-badge" title="${panelText("Devicetree overlays")}"><i class="codicon codicon-file-code"></i> ${overlayCount} ${panelText("overlay")}</span>
            <span class="summary-badge" title="${panelText("Project variables")}"><i class="codicon codicon-symbol-variable"></i> ${varCount === 1 ? panelText("1 var") : panelText("{0} vars", varCount)}</span>
          </div>
        </div>

        ${this._expanded
        ? html`
            <div class="project-detail-panel">
              <config-file-group
                idPrefix="project-${info.name}"
                ?isProject=${true}
                .kconfigFiles=${info.confFiles.config}
                kconfigAddCmd="addProjectConfigFile"
                kconfigRemoveCmd="removeProjectConfigFile"
                .overlayFiles=${info.confFiles.overlay}
                overlayAddCmd="addProjectOverlayFile"
                overlayRemoveCmd="removeProjectOverlayFile"
              ></config-file-group>

              <div class="variables-section">
                <div class="section-row-header">
                  <span class="section-row-title">${panelText("Project Variables")}</span>
                  <vscode-button appearance="icon" icon="question" title="${panelText("Variable help")}"
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

        <div class="project-summary-toggle" @click=${this._toggleExpand}
          title=${this._expanded ? panelText("Collapse") : panelText("Expand")}>
          <span class="project-summary-expand codicon codicon-chevron-down"></span>
        </div>
      </div>
    `;
  }
}
