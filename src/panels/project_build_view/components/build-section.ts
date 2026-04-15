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
import type { WebviewBuildDetails, WebviewVariableCommandInfo } from "../project-build-data";

import "./config-file-group";
import "./variables-table";
import "./variables-help";

@customElement("build-section")
export class BuildSection extends ZephyrLitElement {
  @property({ type: Object }) buildDetails!: WebviewBuildDetails;
  @property({ type: Object }) buildVars: Record<string, string> = {};
  @property({ type: Boolean }) isActive = false;
  @property() projectName = "";
  @property({ type: Array }) variableCommands: WebviewVariableCommandInfo[] = [];

  @state() private _expandedSections: Record<string, boolean> = { config: true };
  @state() private _varsHelpVisible = false;

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._saveTimer) { clearTimeout(this._saveTimer); this._saveTimer = null; }
  }

  private _toggle(sectionId: string) {
    this._expandedSections = {
      ...this._expandedSections,
      [sectionId]: !this._expandedSections[sectionId],
    };
  }

  private _isExpanded(sectionId: string): boolean {
    return !!this._expandedSections[sectionId];
  }

  private _collapsibleSection(
    sectionId: string,
    title: string,
    headerRight: string,
    body: unknown,
  ) {
    const expanded = this._isExpanded(sectionId);
    return html`
      <div class="collapsible-section" aria-expanded=${expanded ? "true" : "false"}>
        <div class="collapsible-header" @click=${() => this._toggle(sectionId)}>
          <span class="collapsible-chevron codicon codicon-chevron-right"></span>
          <span>${title}</span>
          ${headerRight ? html`<span class="collapsible-header-right">${headerRight}</span>` : nothing}
        </div>
        ${expanded ? html`<div class="collapsible-body">${body}</div>` : nothing}
      </div>
    `;
  }

  // --- Build arg helpers ---

  private _saveTimer: ReturnType<typeof setTimeout> | null = null;

  private _upsertBuildArg(kind: string, index: number, value: string) {
    this.postCommand("upsertBuildArg", {
      project: this.projectName,
      build: this.buildDetails.name,
      kind,
      index: String(index),
      value,
    });
  }

  private _removeBuildArg(kind: string, index: number) {
    this.postCommand("removeBuildArg", {
      project: this.projectName,
      build: this.buildDetails.name,
      kind,
      index: String(index),
    });
  }

  private _onArgInput(e: InputEvent) {
    (e.target as HTMLInputElement).classList.add("input-dirty");
  }

  private _onArgBlur(e: FocusEvent, kind: string, index: number) {
    const input = e.target as HTMLInputElement;
    if (!input.classList.contains("input-dirty")) { return; }
    if (index < 0) { return; } // add row — skip auto-save on blur
    if (this._saveTimer) { clearTimeout(this._saveTimer); }
    this._saveTimer = setTimeout(() => {
      input.classList.remove("input-dirty");
      this._upsertBuildArg(kind, index, input.value);
    }, 600);
  }

  private _onArgKeydown(e: KeyboardEvent, kind: string, index: number) {
    if (e.key !== "Enter") { return; }
    const input = e.target as HTMLInputElement;
    if (this._saveTimer) { clearTimeout(this._saveTimer); this._saveTimer = null; }
    input.classList.remove("input-dirty");
    this._upsertBuildArg(kind, index, input.value);
    if (index < 0) { input.value = ""; } // clear add row after submit
  }

  // --- Runner helpers ---

  private _onRunnerBlur(e: FocusEvent, runnerName: string, field: string) {
    const input = e.target as HTMLInputElement;
    if (!input.classList.contains("input-dirty")) { return; }
    if (this._saveTimer) { clearTimeout(this._saveTimer); }
    this._saveTimer = setTimeout(() => {
      input.classList.remove("input-dirty");
      const msg: Record<string, string> = {
        project: this.projectName,
        build: this.buildDetails.name,
        runner: runnerName,
      };
      msg[field] = input.value;
      this.postCommand("updateRunner", msg);
    }, 600);
  }

  private _onRunnerKeydown(e: KeyboardEvent, runnerName: string, field: string) {
    if (e.key !== "Enter") { return; }
    const input = e.target as HTMLInputElement;
    if (this._saveTimer) { clearTimeout(this._saveTimer); this._saveTimer = null; }
    input.classList.remove("input-dirty");
    const msg: Record<string, string> = {
      project: this.projectName,
      build: this.buildDetails.name,
      runner: runnerName,
    };
    msg[field] = input.value;
    this.postCommand("updateRunner", msg);
  }

  // --- Renderers ---

  private _renderBuildArgs(args: string[], kind: string) {
    const kindLabel = kind === "cmake" ? "CMake" : "west";
    return html`
      ${args.length === 0
        ? html`<div class="file-list-empty">No ${kindLabel} arguments</div>`
        : args.map(
          (arg, i) => html`
              <div class="build-arg-row">
                <input class="build-arg-input" type="text" .value=${arg}
                  @input=${this._onArgInput}
                  @focusout=${(e: FocusEvent) => this._onArgBlur(e, kind, i)}
                  @keydown=${(e: KeyboardEvent) => this._onArgKeydown(e, kind, i)} />
                <vscode-button appearance="icon" icon="trash" title="Remove"
                  @click=${() => this._removeBuildArg(kind, i)}>
                </vscode-button>
              </div>
            `,
        )}
      <div class="build-arg-row">
        <input class="build-arg-input" type="text" placeholder="Add ${kindLabel} argument…"
          @input=${this._onArgInput}
          @keydown=${(e: KeyboardEvent) => this._onArgKeydown(e, kind, -1)} />
      </div>
    `;
  }

  private _renderRunners() {
    const b = this.buildDetails;
    if (b.runners.length === 0) {
      return html`
        <div class="file-list-empty">No runners configured</div>
        <div style="margin-top:8px;">
          <vscode-button appearance="secondary" icon="add"
            @click=${() => this.postCommand("addRunner", { project: this.projectName, build: b.name })}>
            Add Runner
          </vscode-button>
        </div>
      `;
    }

    return html`
      ${b.runners.map(
      (r) => html`
          <div class="runner-row">
            <span class="runner-name"><i class="codicon codicon-debug-alt-small"></i> ${r.name}</span>
            <div class="runner-fields">
              <div class="runner-field-row">
                <span class="runner-field-label">Type</span>
                <input class="runner-input" type="text" .value=${r.runner}
                  @input=${this._onArgInput}
                  @focusout=${(e: FocusEvent) => this._onRunnerBlur(e, r.name, "runner-type")}
                  @keydown=${(e: KeyboardEvent) => this._onRunnerKeydown(e, r.name, "runner-type")} />
              </div>
              <div class="runner-field-row">
                <span class="runner-field-label">Args</span>
                <input class="runner-input" type="text" .value=${r.args}
                  @input=${this._onArgInput}
                  @focusout=${(e: FocusEvent) => this._onRunnerBlur(e, r.name, "runner-args")}
                  @keydown=${(e: KeyboardEvent) => this._onRunnerKeydown(e, r.name, "runner-args")} />
              </div>
            </div>
            <div class="runner-actions">
              <vscode-button appearance="icon" icon="trash" title="Remove"
                @click=${() => this.postCommand("removeRunner", { project: this.projectName, build: b.name, runner: r.name })}>
              </vscode-button>
            </div>
          </div>
        `,
    )}
      <div class="action-row">
        <vscode-button appearance="secondary" icon="add"
          @click=${() => this.postCommand("addRunner", { project: this.projectName, build: b.name })}>
          Add Runner
        </vscode-button>
      </div>
    `;
  }

  private _renderLaunchConfigs() {
    const b = this.buildDetails;
    return html`
      <div class="launch-row">
        <span class="launch-label">Debug</span>
        <span class="launch-value">${b.debugDisplay}</span>
        <vscode-button appearance="icon" icon="edit" title="Change"
          @click=${() => this.postCommand("changeLaunchTarget", { type: "debug" })}>
        </vscode-button>
      </div>
      <div class="launch-row">
        <span class="launch-label">Build + Debug</span>
        <span class="launch-value">${b.buildDebugDisplay}</span>
        <vscode-button appearance="icon" icon="edit" title="Change"
          @click=${() => this.postCommand("changeLaunchTarget", { type: "buildDebug" })}>
        </vscode-button>
      </div>
      <div class="launch-row">
        <span class="launch-label">Attach</span>
        <span class="launch-value">${b.attachDisplay}</span>
        <vscode-button appearance="icon" icon="edit" title="Change"
          @click=${() => this.postCommand("changeLaunchTarget", { type: "attach" })}>
        </vscode-button>
      </div>
    `;
  }

  render() {
    const b = this.buildDetails;
    if (!b) { return nothing; }

    const statusClass = this.isActive ? "status-built" : "status-not-built";
    const statusLabel = this.isActive ? "Active" : "Inactive";
    const kconfigCount = b.confFiles.config.length;
    const overlayCount = b.confFiles.overlay.length;
    const westArgCount = b.westBuildArgs.length;
    const cmakeArgCount = b.westBuildCMakeArgs.length;
    const varEntries = Object.keys(this.buildVars).length;

    const boardDir = b.relBoardDir || b.relBoardSubDir || "";

    return html`
      <div class="build-card">
        <div class="build-card-header">
          <h2 class="build-card-title">
            <i class="codicon codicon-tools"></i>
            ${b.name}
          </h2>
          <div class="build-card-badges">
            <span class="build-status-badge ${statusClass}">${statusLabel}</span>
          </div>
          <div class="build-card-actions">
            <vscode-button icon="play" @click=${() => this.postCommand("build")} title="Build">Build</vscode-button>
            <vscode-button appearance="secondary" icon="refresh" @click=${() => this.postCommand("buildPristine")} title="Pristine Build">Pristine</vscode-button>
            <vscode-button appearance="secondary" icon="zap" @click=${() => this.postCommand("flash")} title="Flash">Flash</vscode-button>
            <vscode-button appearance="secondary" icon="debug-alt" @click=${() => this.postCommand("debug")} title="Debug">Debug</vscode-button>
            <vscode-button appearance="icon" icon="trash" title="Remove Build"
              @click=${() => this.postCommand("removeBuild", { project: this.projectName, build: b.name })}>
            </vscode-button>
          </div>
        </div>

        <div class="build-info-strip">
          <span class="info-item">
            <span class="info-item-label">Board:</span>
            <span class="info-item-value">${b.boardDisplayName}</span>
          </span>
          ${boardDir
        ? html`
                <span class="info-item">
                  <span class="info-item-label">Dir:</span>
                  <span class="info-item-value clickable"
                    @click=${() => this.postCommand("openFolder", { file: b.resolvedBoardPath ?? boardDir })}>${boardDir}</span>
                </span>
              `
        : nothing}
          <span class="info-item">
            <span class="info-item-label">Optimization:</span>
            <span class="info-item-value">${b.debugOptimization}</span>
          </span>
        </div>

        <div class="build-card-body">
          ${this._collapsibleSection(
          "config",
          "Configuration Files",
          `${kconfigCount} kconfig, ${overlayCount} overlay`,
          html`<config-file-group
              idPrefix="build-${b.name}"
              .kconfigFiles=${b.confFiles.config}
              kconfigAddCmd="addBuildConfigFile"
              kconfigRemoveCmd="removeBuildConfigFile"
              kconfigToggleCmd="toggleBuildConfigFileExtra"
              .overlayFiles=${b.confFiles.overlay}
              overlayAddCmd="addBuildOverlayFile"
              overlayRemoveCmd="removeBuildOverlayFile"
              overlayToggleCmd="toggleBuildOverlayFileExtra"
            ></config-file-group>`,
        )}

          ${this._collapsibleSection(
          "args",
          "Build Arguments",
          `${westArgCount} west, ${cmakeArgCount} cmake`,
          html`
              <div class="variables-section">
                <div class="section-row-header">
                  <span class="section-row-title">West Build Arguments</span>
                </div>
                ${this._renderBuildArgs(b.westBuildArgs, "west")}
              </div>
              <div class="variables-section">
                <div class="section-row-header">
                  <span class="section-row-title">CMake Arguments</span>
                </div>
                ${this._renderBuildArgs(b.westBuildCMakeArgs, "cmake")}
              </div>
            `,
        )}

          ${this._collapsibleSection("launch", "Launch Configurations", "", this._renderLaunchConfigs())}

          ${this._collapsibleSection(
          "runners",
          "Runners",
          `${b.runners.length} runner${b.runners.length !== 1 ? "s" : ""}`,
          this._renderRunners(),
        )}

          ${this._collapsibleSection(
          "vars",
          "Variables",
          `${varEntries} var${varEntries !== 1 ? "s" : ""}`,
          html`
              <div class="variables-section">
                <div class="section-row-header">
                  <span class="section-row-title">Build Variables</span>
                  <vscode-button appearance="icon" icon="question" title="Variable help"
                    @click=${() => { this._varsHelpVisible = !this._varsHelpVisible; }}>
                  </vscode-button>
                </div>
                ${this._varsHelpVisible
              ? html`<variables-help .commands=${this.variableCommands}></variables-help>`
              : nothing}
                <variables-table
                  level="build"
                  .projectName=${this.projectName}
                  .buildName=${b.name}
                  .vars=${this.buildVars}
                ></variables-table>
              </div>
            `,
        )}
        </div>
      </div>
    `;
  }
}
