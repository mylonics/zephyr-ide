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
import type { WebviewBindInfo, WebviewBuildDetails, WebviewRunnerInfo, WebviewVariableCommandInfo } from "../project-build-data";

import "./config-file-group";
import "./variables-table";
import "./variables-help";

type BindTarget = "flash" | "build" | "buildDebug" | "attach";
type RunnerLevel = "build" | "project";

const BIND_TARGET_LABELS: Record<BindTarget, string> = {
  flash: "Flash",
  build: "Build",
  buildDebug: "Build & Debug",
  attach: "Attach",
};

@customElement("build-section")
export class BuildSection extends ZephyrLitElement {
  @property({ type: Object }) buildDetails!: WebviewBuildDetails;
  @property({ type: Object }) buildVars: Record<string, string> = {};
  @property({ type: Boolean }) isActive = false;
  @property() projectName = "";
  @property({ type: Array }) variableCommands: WebviewVariableCommandInfo[] = [];
  /**
   * Build/flash/debug action currently in flight (or null when idle). When
   * set, the matching button shows a spinner and the rest are disabled to
   * prevent overlapping commands.
   */
  @property() activeAction: string | null = null;

  @state() private _expandedSections: Record<string, boolean> = this._loadExpandedState();
  @state() private _varsHelpVisible = false;

  private _loadExpandedState(): Record<string, boolean> {
    try {
      const raw = (this.vscodeApi.getState() as { expandedSections?: Record<string, boolean> } | undefined);
      if (raw && typeof raw.expandedSections === "object") {
        return { config: true, ...raw.expandedSections };
      }
    } catch { /* ignore */ }
    return { config: true };
  }

  private _persistExpandedState() {
    try {
      const prev = (this.vscodeApi.getState() as Record<string, unknown> | undefined) ?? {};
      this.vscodeApi.setState({ ...prev, expandedSections: this._expandedSections });
    } catch { /* ignore */ }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._saveTimer) { clearTimeout(this._saveTimer); this._saveTimer = null; }
  }

  private _toggle(sectionId: string) {
    this._expandedSections = {
      ...this._expandedSections,
      [sectionId]: !this._expandedSections[sectionId],
    };
    this._persistExpandedState();
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
        <button type="button" class="collapsible-header"
          aria-expanded=${expanded ? "true" : "false"}
          @click=${() => this._toggle(sectionId)}>
          <span class="collapsible-chevron codicon codicon-chevron-right"></span>
          <span>${title}</span>
          ${headerRight ? html`<span class="collapsible-header-right">${headerRight}</span>` : nothing}
        </button>
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
      const trimmed = input.value.trim();
      if (!trimmed) {
        this._removeBuildArg(kind, index);
      } else {
        this._upsertBuildArg(kind, index, trimmed);
      }
    }, 600);
  }

  private _onArgKeydown(e: KeyboardEvent, kind: string, index: number) {
    if (e.key !== "Enter") { return; }
    const input = e.target as HTMLInputElement;
    if (this._saveTimer) { clearTimeout(this._saveTimer); this._saveTimer = null; }
    input.classList.remove("input-dirty");
    const trimmed = input.value.trim();
    if (index < 0) {
      // Add row: only save non-empty, then clear
      if (trimmed) { this._upsertBuildArg(kind, index, trimmed); }
      input.value = "";
    } else {
      if (!trimmed) {
        this._removeBuildArg(kind, index);
      } else {
        this._upsertBuildArg(kind, index, trimmed);
      }
    }
  }

  // --- Runner bind helpers (4-bind model) ---

  private _onExtraArgsInput(e: InputEvent) {
    (e.target as HTMLInputElement).classList.add("input-dirty");
  }

  private _saveExtraArgs(level: RunnerLevel, runnerName: string, target: BindTarget, value: string) {
    const msg: Record<string, string> = {
      project: this.projectName,
      runner: runnerName,
      target,
      value,
    };
    if (level === "build") { msg.build = this.buildDetails.name; }
    this.postCommand("setBindExtraArgs", msg);
  }

  private _onExtraArgsBlur(e: FocusEvent, level: RunnerLevel, runnerName: string, target: BindTarget) {
    const input = e.target as HTMLInputElement;
    if (!input.classList.contains("input-dirty")) { return; }
    if (this._saveTimer) { clearTimeout(this._saveTimer); }
    this._saveTimer = setTimeout(() => {
      input.classList.remove("input-dirty");
      this._saveExtraArgs(level, runnerName, target, input.value);
    }, 600);
  }

  private _onExtraArgsKeydown(e: KeyboardEvent, level: RunnerLevel, runnerName: string, target: BindTarget) {
    if (e.key !== "Enter") { return; }
    const input = e.target as HTMLInputElement;
    if (this._saveTimer) { clearTimeout(this._saveTimer); this._saveTimer = null; }
    input.classList.remove("input-dirty");
    this._saveExtraArgs(level, runnerName, target, input.value);
  }

  private _pickBind(level: RunnerLevel, runnerName: string, target: BindTarget) {
    const msg: Record<string, string> = {
      project: this.projectName,
      runner: runnerName,
      target,
    };
    if (level === "build") { msg.build = this.buildDetails.name; }
    this.postCommand("pickBind", msg);
  }

  // --- Renderers ---

  /**
   * Render a build/flash/debug action button. Shows a spinner icon when this
   * action is in flight and disables the rest while another action runs.
   */
  private _renderActionButton(
    action: string,
    icon: string,
    label: string,
    title: string,
    appearance: 'primary' | 'secondary' = 'primary',
  ) {
    const isThisActive = this.activeAction === action;
    const otherActive = this.activeAction !== null && !isThisActive;
    const buttonIcon = isThisActive ? 'sync' : icon;
    const buttonTitle = isThisActive ? `${title} in progress…` : title;
    return html`
      <vscode-button
        appearance=${appearance === 'primary' ? 'primary' : 'secondary'}
        icon=${buttonIcon}
        ?disabled=${otherActive}
        title=${buttonTitle}
        @click=${() => this.postCommand(action)}>
        ${label}
      </vscode-button>`;
  }

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

  // --- Runner card renderers (unified for build- and project-level) ---

  private _bindTargets(): readonly BindTarget[] {
    return ["flash", "build", "buildDebug", "attach"];
  }

  private _renderBindRow(
    level: RunnerLevel,
    runnerName: string,
    target: BindTarget,
    bind: WebviewBindInfo,
  ) {
    const isAuto = bind.bind.kind === "auto";
    const isLaunch = bind.bind.kind === "launch";
    const showExtraArgs = bind.bind.kind === "runner" || bind.bind.kind === "variant";
    const hint = this.buildDetails.runnersYamlHint;
    const autoFallbackHint = isAuto && hint
      ? (target === "flash" ? hint.flashRunner : hint.debugRunner) ?? "—"
      : undefined;
    const missingClass = bind.missingVariant ? " bind-display-missing" : "";

    return html`
      <div class="bind-row">
        <span class="bind-label">${BIND_TARGET_LABELS[target]}</span>
        <button type="button"
          class="bind-display${missingClass}"
          title="Click to change ${BIND_TARGET_LABELS[target]} bind"
          @click=${() => this._pickBind(level, runnerName, target)}>
          <span class="bind-display-text">${bind.display}</span>
          <i class="codicon codicon-chevron-down"></i>
        </button>
        ${showExtraArgs
        ? html`
            <input class="bind-extra-args" type="text"
              placeholder="extra args (optional)"
              .value=${bind.extraArgs}
              @input=${this._onExtraArgsInput}
              @focusout=${(e: FocusEvent) => this._onExtraArgsBlur(e, level, runnerName, target)}
              @keydown=${(e: KeyboardEvent) => this._onExtraArgsKeydown(e, level, runnerName, target)} />
          `
        : html`<span class="bind-extra-args-placeholder">${isLaunch ? "(launch.json)" : ""}</span>`}
        ${autoFallbackHint
        ? html`<span class="bind-auto-hint" title="From runners.yaml">→ ${autoFallbackHint}</span>`
        : nothing}
      </div>
    `;
  }

  private _renderRunnerCard(level: RunnerLevel, r: WebviewRunnerInfo) {
    const b = this.buildDetails;
    const isActive = level === "build" && r.name === b.activeRunner;
    const icon = level === "build" ? "debug-alt-small" : "package";
    // Flash never offers the launch.json picker entries, but the four rows are
    // always rendered regardless of level — the picker filters server-side.
    return html`
      <div class="runner-card">
        <div class="runner-card-header">
          <span class="runner-name">
            <i class="codicon codicon-${icon}"></i> ${r.name}
            ${level === "build"
        ? (isActive
          ? html`<span class="runner-active-badge">active</span>`
          : html`
                  <vscode-button appearance="icon" title="Set as active runner"
                    @click=${() => this.postCommand("setActiveRunner", { project: this.projectName, build: b.name, runner: r.name })}>
                    <i class="codicon codicon-circle-outline"></i>
                  </vscode-button>`)
        : nothing}
          </span>
          <vscode-button appearance="icon" icon="trash" title="Remove"
            @click=${() => this.postCommand(
          level === "build" ? "removeRunner" : "removeProjectRunner",
          level === "build"
            ? { project: this.projectName, build: b.name, runner: r.name }
            : { project: this.projectName, runner: r.name },
        )}>
          </vscode-button>
        </div>
        <div class="runner-card-binds">
          ${this._bindTargets().map(t => this._renderBindRow(level, r.name, t, r[t]))}
        </div>
      </div>
    `;
  }

  private _renderRunners() {
    const b = this.buildDetails;
    if (b.runners.length === 0) {
      return html`
        <div class="file-list-empty">No build-level runners configured</div>
        <div class="action-row">
          <vscode-button appearance="secondary" icon="add"
            @click=${() => this.postCommand("addRunner", { project: this.projectName, build: b.name })}>
            Add Build Runner
          </vscode-button>
        </div>
      `;
    }
    return html`
      ${b.runners.map(r => this._renderRunnerCard("build", r))}
      <div class="action-row">
        <vscode-button appearance="secondary" icon="add"
          @click=${() => this.postCommand("addRunner", { project: this.projectName, build: b.name })}>
          Add Build Runner
        </vscode-button>
      </div>
    `;
  }

  private _renderProjectRunners() {
    const b = this.buildDetails;
    const projectRunners = b.projectRunners ?? [];
    return html`
      <div class="runner-level-header">Project runners <span class="runner-level-hint">(inherited by builds with same name)</span></div>
      ${projectRunners.length === 0
        ? html`<div class="file-list-empty">No project-level runners configured</div>`
        : projectRunners.map(r => this._renderRunnerCard("project", r))}
      <div class="action-row">
        <vscode-button appearance="secondary" icon="add"
          @click=${() => this.postCommand("addProjectRunner", { project: this.projectName })}>
          Add Project Runner
        </vscode-button>
      </div>
    `;
  }

  private _renderRunnersYamlHint() {
    const hint = this.buildDetails.runnersYamlHint;
    if (!hint) { return html``; }
    return html`
      <div class="runners-yaml-hint">
        <span class="runner-level-header">runners.yaml defaults <span class="runner-level-hint">(read-only, from last build)</span></span>
        <div class="runner-hint-row">
          <span class="runner-field-label">Flash</span>
          <span class="runner-hint-value">${hint.flashRunner ?? "—"}</span>
        </div>
        <div class="runner-hint-row">
          <span class="runner-field-label">Debug</span>
          <span class="runner-hint-value">${hint.debugRunner ?? "—"}</span>
        </div>
        <div class="runner-hint-row">
          <span class="runner-field-label">Available</span>
          <span class="runner-hint-value">${hint.availableRunners.join(", ") || "—"}</span>
        </div>
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
            ${this._renderActionButton('build', 'play', 'Build', 'Build')}
            ${this._renderActionButton('buildPristine', 'refresh', 'Pristine', 'Pristine Build', 'secondary')}
            ${this._renderActionButton('flash', 'zap', 'Flash', 'Flash', 'secondary')}
            ${this._renderActionButton('debug', 'debug-alt', 'Debug', 'Debug', 'secondary')}
            ${this._renderActionButton('runDashboard', 'graph', 'Report', 'Dashboard Report', 'secondary')}
            <vscode-button appearance="icon" icon="trash" title="Remove Build"
              ?disabled=${this.activeAction !== null}
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
              .overlayFiles=${b.confFiles.overlay}
              overlayAddCmd="addBuildOverlayFile"
              overlayRemoveCmd="removeBuildOverlayFile"
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

          ${this._collapsibleSection(
          "launch",
          "Launch Configurations",
          "",
          html`
              ${this._renderLaunchConfigs()}
              <div class="variables-section" style="margin-top:12px;">
                <div class="section-row-header">
                  <span class="section-row-title">Variables</span>
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

          ${this._collapsibleSection(
          "runners",
          "Runners",
          `${b.runners.length} build, ${(b.projectRunners ?? []).length} project`,
          html`
            ${this._renderRunnersYamlHint()}
            ${this._renderProjectRunners()}
            <div class="runner-level-header" style="margin-top:12px;">Build runners</div>
            ${this._renderRunners()}
          `,
        )}
        </div>
      </div>
    `;
  }
}
