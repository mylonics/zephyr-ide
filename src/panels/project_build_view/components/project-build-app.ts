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
import { customElement, state } from "lit/decorators.js";
import { ZephyrLitElement } from "../../webview_shared/lit-base";
import type { ProjectBuildPanelData } from "../project-build-data";

import "./project-section";
import "./build-section";
import "./test-section";

@customElement("project-build-app")
export class ProjectBuildApp extends ZephyrLitElement {
  @state() private _data: ProjectBuildPanelData | undefined;
  /** Build/flash/debug action currently in flight, or null when idle. */
  @state() private _activeBuildAction: string | null = null;
  @state() private _statusAnnouncement = "";

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("message", this._onMessage);
    // Tell the extension host we are ready to receive data.
    this.vscodeApi.postMessage({ command: "ready" });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("message", this._onMessage);
  }

  private _onMessage = (event: MessageEvent) => {
    const msg = event.data;
    if (msg.command === "updateContent" && msg.data) {
      this._data = msg.data;
      this._statusAnnouncement = "Project details updated";
    } else if (msg.command === "buildActionStatus") {
      if (msg.state === "started") {
        this._activeBuildAction = msg.action ?? null;
      } else if (msg.state === "finished") {
        // Only clear if the finished action matches the active one — guards
        // against late finished events from a previous click.
        if (!msg.action || this._activeBuildAction === msg.action) {
          this._activeBuildAction = null;
        }
      }
    }
  };

  private _onProjectChange(e: Event) {
    const select = e.currentTarget as { value?: string } | null;
    if (typeof select?.value !== "string") {
      return;
    }
    this.postCommand("switchProject", { project: select.value });
  }

  private _onBuildTestChange(e: Event) {
    const select = e.currentTarget as { value?: string } | null;
    if (typeof select?.value !== "string") {
      return;
    }
    this.postCommand("switchBuildOrTest", { selection: select.value });
  }

  render() {
    if (!this._data) {
      return html`<div class="container panel-container"><p>Loading…</p></div>`;
    }

    const d = this._data;
    const hasProjects = d.projectOptions.length > 0;
    const hasBuildTestOptions = d.buildTestOptions.length > 0;
    const hasBuild = !!d.buildDetails;
    const hasTest = !!d.testDetails;
    const noBuildOrTest = !hasBuild && !hasTest;

    return html`
      <div class="container panel-container">
        <div class="sr-only" role="status" aria-live="polite">${this._statusAnnouncement}</div>
        <div class="page-header">
          <div>
            <h1 class="page-title"><i class="codicon codicon-project"></i> Project Details</h1>
          </div>
          <div class="page-header-selectors">
            <div class="project-selector">
              <label>Project:</label>
              <vscode-single-select @vsc-change=${this._onProjectChange}>
                ${d.projectOptions.map(
      (opt) => html`<vscode-option value=${opt.name} ?selected=${opt.selected}>${opt.name}</vscode-option>`,
    )}
              </vscode-single-select>
            </div>
            ${hasBuildTestOptions
        ? html`
                  <div class="build-test-selector">
                    <label>Build / Test:</label>
                    <vscode-single-select @vsc-change=${this._onBuildTestChange}>
                      ${d.buildTestOptions.map(
          (opt) => html`<vscode-option value=${opt.value} ?selected=${opt.selected}>${opt.label}</vscode-option>`,
        )}
                    </vscode-single-select>
                  </div>
                `
        : nothing}
          </div>
        </div>

        ${!hasProjects
        ? html`
              <div class="no-project-notice">
                <i class="codicon codicon-info"></i>
                <p>No projects configured. Use the command palette to add a project.</p>
              </div>
            `
        : html`
              ${d.projectInfo
            ? html`<project-section
                    .projectInfo=${d.projectInfo}
                    .projectVars=${d.projectVars}
                    .variableCommands=${d.variableCommands}
                  ></project-section>`
            : nothing}

              ${d.selectedProject
            ? html`
                    <div class="project-actions-row">
                      <vscode-button appearance="secondary" icon="add"
                        @click=${() => this.postCommand("addBuild", { project: d.selectedProject! })}>
                        Add Build
                      </vscode-button>
                      <vscode-button appearance="secondary" icon="beaker"
                        @click=${() => this.postCommand("addTest", { project: d.selectedProject! })}>
                        Add Test
                      </vscode-button>
                    </div>
                  `
            : nothing}

              ${hasBuild
            ? html`<build-section
                    .buildDetails=${d.buildDetails!}
                    .buildVars=${d.buildVars}
                    .isActive=${d.isBuildActive}
                    .projectName=${d.selectedProject!}
                    .variableCommands=${d.variableCommands}
                    .activeAction=${this._activeBuildAction}
                  ></build-section>`
            : nothing}

              ${hasTest
            ? html`<test-section .testDetails=${d.testDetails!}></test-section>`
            : nothing}

              ${noBuildOrTest && d.selectedProject && d.buildTestOptions.length === 0
            ? html`
                    <div class="build-placeholder">
                      <div class="build-placeholder-content">
                        <i class="codicon codicon-add"></i>
                        <p>No builds or tests configured yet.</p>
                        <div class="build-placeholder-actions">
                          <vscode-button icon="add"
                            @click=${() => this.postCommand("addBuild", { project: d.selectedProject! })}>
                            Add Build
                          </vscode-button>
                          <vscode-button appearance="secondary" icon="beaker"
                            @click=${() => this.postCommand("addTest", { project: d.selectedProject! })}>
                            Add Test
                          </vscode-button>
                        </div>
                      </div>
                    </div>
                  `
            : nothing}

              ${noBuildOrTest && d.selectedProject && d.buildTestOptions.length > 0
            ? html`
                    <div class="build-placeholder">
                      <div class="build-placeholder-content">
                        <i class="codicon codicon-arrow-left"></i>
                        <p>Select a build or test to view details.</p>
                      </div>
                    </div>
                  `
            : nothing}
            `}
      </div>
    `;
  }
}
