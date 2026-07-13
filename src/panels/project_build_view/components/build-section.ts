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

  // --- Runner bind helpers removed: replaced by Runner Profiles (see _renderRunnerProfile). ---

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
        @click=${() => this.postCommand(action, { project: this.projectName, build: this.buildDetails.name })}>
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

  // --- Runner profile renderers ---

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
        ${hint.sysbuildImage
        ? html`
              <div class="runner-hint-row">
                <span class="runner-field-label">Sysbuild image</span>
                <span class="runner-hint-value">${hint.sysbuildImage}</span>
              </div>`
        : nothing}
        <div class="runner-hint-row">
          <span class="runner-field-label">File</span>
          <span class="runner-hint-value clickable"
            title="Open runners.yaml in editor"
            @click=${() => this.postCommand("openFile", { file: hint.runnersYamlPath })}>
            ${hint.runnersYamlPath}
          </span>
        </div>
      </div>
    `;
  }

  private _renderRunnerProfile() {
    const b = this.buildDetails;
    const activeProfile = b.activeProfile;
    const slots = b.slotBinds;
    const localSuffix = b.activeProfileScope === "local" ? html` <span class="bind-local-badge" title="Local override — not committed to zephyr-ide.json">(local)</span>` : nothing;
    const activeLabel = activeProfile
      ? html`<strong>${activeProfile}</strong>${localSuffix}`
      : html`<em>(none — using runners.yaml defaults)</em>`;
    return html`
      <div class="launch-help">
        <span class="runner-level-header">Runner Profile</span>
        <span class="runner-level-hint">
          A Runner Profile bundles three slot binds (<strong>flash</strong>, <strong>debug</strong>, <strong>attach</strong>)
          for this build. Each bind picks Auto (runners.yaml), a Zephyr runner with extra args, or a launch.json entry
          (debug / attach only). Per-build override args are appended after the profile's runner args.
        </span>
      </div>
      <div class="runner-card">
        <div class="runner-card-header">
          <span class="runner-name">
            <i class="codicon codicon-debug-alt-small"></i> Active profile: ${activeLabel}
          </span>
          <vscode-button appearance="secondary" icon="chip" title="Select a named Runner Profile (stored as local override; does not modify zephyr-ide.json)"
            @click=${() => this.postCommand("selectActiveProfile", { project: this.projectName, build: b.name })}>
            Profile…
          </vscode-button>
          <vscode-button appearance="secondary" icon="target" title="Set a local per-slot runner without using a profile (stored locally, not committed)"
            @click=${() => this.postCommand("selectLocalBind", { project: this.projectName, build: b.name })}>
            Local Bind…
          </vscode-button>
          <vscode-button appearance="secondary" icon="list-tree" title="Open Runner Profile management panel"
            @click=${() => this.postCommand("openRunnerProfilePanel")}>
            Manage…
          </vscode-button>
        </div>
        <div class="runner-binds-grid">
          ${this._renderSlotBind(slots.flash, "Flash", "zap")}
          ${slots.buildDebug
        ? this._renderSlotBind(slots.buildDebug, "Build & Debug", "run-all")
        : nothing}
          ${this._renderSlotBind(slots.debug, "Debug", "debug-alt")}
          ${this._renderSlotBind(slots.attach, "Attach", "debug-console")}
        </div>
      </div>
    `;
  }

  private _renderSlotBind(
    slot: import("../project-build-data").WebviewSlotBind,
    label: string,
    icon: string,
  ) {
    const canOverride = slot.kind === "west-flash" || slot.kind === "west-debug";
    const overrideBadge = slot.hasOverride
      ? html`<span class="bind-override-badge" title="Per-build extra args override">override</span>`
      : nothing;
    const localBadge = slot.localOverride !== undefined
      ? html`<span class="bind-local-badge" title="Local bind — not committed; use Local Bind… to change or clear">(local)</span>`
      : nothing;

    return html`
      <div class="runner-bind-row">
        <span class="runner-field-label">
          <i class="codicon codicon-${icon}"></i> ${label}
        </span>
        <span class="runner-bind-value">
          ${slot.label}
          ${localBadge}
          ${overrideBadge}
        </span>
        ${slot.localOverride !== undefined
        ? html`
              <vscode-button appearance="icon" icon="close"
                title="Clear local bind — revert ${label} to profile / runners.yaml default"
                @click=${() => this.postCommand("clearLocalBind", { slot: slot.slot, project: this.projectName, build: this.buildDetails.name })}>
              </vscode-button>`
        : nothing}
        ${canOverride
        ? html`
              <vscode-button appearance="icon"
                icon=${slot.hasOverride ? "edit" : "add"}
                title=${slot.hasOverride
            ? `Edit extra args (current: ${slot.overrideExtraArgs})`
            : "Add per-build extra args"}
                @click=${() => this._editSlotExtraArgs(slot)}>
              </vscode-button>
              ${slot.hasOverride
            ? html`
                    <vscode-button appearance="icon" icon="close"
                      title="Clear per-build override"
                      @click=${() => this._clearSlotExtraArgs(slot)}>
                    </vscode-button>`
            : nothing}`
        : nothing}
      </div>
    `;
  }

  private _editSlotExtraArgs(slot: import("../project-build-data").WebviewSlotBind) {
    // Omit `value` so the extension shows an input box pre-filled with the current value.
    this.postCommand("setBindExtraArgs", {
      project: this.projectName,
      build: this.buildDetails.name,
      slot: slot.slot,
    });
  }

  private _clearSlotExtraArgs(slot: import("../project-build-data").WebviewSlotBind) {
    this.postCommand("setBindExtraArgs", {
      project: this.projectName,
      build: this.buildDetails.name,
      slot: slot.slot,
      value: "",
    });
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
            <span class="info-item-value">${b.compilerOptimization ?? "not set"}</span>
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
          "variables",
          "Variables",
          `${Object.keys(this.buildVars ?? {}).length} set`,
          html`
              <div class="variables-section">
                <div class="section-row-header">
                  <span class="section-row-title">Build variables</span>
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
          "Runner Profile",
          b.activeProfile ?? "(none)",
          html`
            ${this._renderRunnerProfile()}
            ${this._renderRunnersYamlHint()}
          `,
        )}
        </div>
      </div>
    `;
  }
}
