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

import { panelText, panelParts } from "../../webview_shared/panel-text";
import { html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { ZephyrLitElement } from "../../webview_shared/lit-base";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type BindKind = "auto" | "west-flash" | "launch" | "cortex-debug" | "west-debug";

interface ProfileBind {
  kind: BindKind;
  runner?: string;
  extraArgs?: string[];   // west-flash and west-debug only
  name?: string;         // launch only
  enableRtt?: boolean;   // cortex-debug only
  probe?: string;        // cortex-debug only
}

interface Profile {
  name: string;
  flash: ProfileBind;
  buildDebug?: ProfileBind;
  debug: ProfileBind;
  attach: ProfileBind;
}

type Scope = "user" | "workspace";

interface PanelData {
  userProfiles: Profile[];
  workspaceProfiles: Profile[];
  hasWorkspace: boolean;
  knownRunners: string[];
  knownCortexDebugRunners: string[];
  knownWestDebugRunners: string[];
  /** All launch.json config names (any type); shown in a combined dropdown for the "launch" bind kind. */
  launchConfigNames: string[];
  activeProfileName?: string;
  /** "local" = BuildState override wins; "workspace" = JSON value; "none" = no profile set. */
  activeProfileScope?: "local" | "workspace" | "none";
  activeBuildLabel?: string;
  /** profile name -> list of "<project> / <build>" strings using it */
  usageByName?: Record<string, string[]>;
  /** Mirror of `zephyr-ide.separateBuildDebugProfile` setting. */
  separateBuildDebugProfile?: boolean;
  /**
   * When set, the webview should scroll the named profile card into view after
   * the next render. Typically set after profile creation or duplication.
   */
  scrollToProfile?: string;
}

/**
 * Single-page editor for Runner Profiles. Profiles are listed grouped by
 * scope (workspace + user); each card has an inline editor that posts a
 * `saveProfile` message on demand. Deletes and creates round-trip through
 * the extension host which prompts for confirmation when destructive.
 */
@customElement("runner-profile-app")
export class RunnerProfileApp extends ZephyrLitElement {
  @state() private _data: PanelData | undefined;

  /** Local working copy of every profile keyed by `<scope>:<originalName>`.
   *  Drives "Save" / "Revert" affordances and lets users abandon edits. */
  @state() private _drafts: Map<string, Profile> = new Map();

  /** Tracks which arg editors are showing the variable substitution help.
   *  Key: `<scope>:<originalName>:<slot>` */
  @state() private _showVarHelp: Set<string> = new Set();

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("message", this._onMessage);
    this.vscodeApi.postMessage({ command: "ready" });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("message", this._onMessage);
  }

  private _onMessage = (event: MessageEvent) => {
    const msg = event.data;
    if (msg?.command === "updateContent" && msg.data) {
      this._data = msg.data as PanelData;
      // Drop drafts whose original profile no longer exists in the new payload,
      // and drop drafts that now match the saved server state (e.g. after a
      // successful save the panel should revert to clean).
      const next = new Map<string, Profile>();
      for (const [k, v] of this._drafts) {
        const [scopeStr, ...nameParts] = k.split(":");
        const pName = nameParts.join(":");
        const serverList = scopeStr === "user"
          ? this._data.userProfiles
          : this._data.workspaceProfiles;
        const serverProfile = serverList.find(p => p.name === pName);
        // Keep draft only if profile still exists AND the draft differs from server.
        if (serverProfile && !profilesEqual(v, serverProfile)) {
          next.set(k, v);
        }
      }
      this._drafts = next;
      // Scroll newly created / duplicated profile into view after render.
      const scrollTo = this._data.scrollToProfile;
      if (scrollTo) {
        this.updateComplete.then(() => {
          const id = "profile-card--" + CSS.escape(scrollTo);
          const el = this.renderRoot?.querySelector(`#${id}`) as HTMLElement | null;
          el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
          el?.focus();
        });
      }
    }
  };

  // -- Draft helpers --

  private _key(scope: Scope, originalName: string): string {
    return `${scope}:${originalName}`;
  }

  private _draftFor(scope: Scope, original: Profile): Profile {
    const key = this._key(scope, original.name);
    return this._drafts.get(key) ?? original;
  }

  private _updateDraft(scope: Scope, originalName: string, patch: (p: Profile) => Profile) {
    const key = this._key(scope, originalName);
    const original = this._findOriginal(scope, originalName);
    if (!original) { return; }
    const base = this._drafts.get(key) ?? cloneProfile(original);
    const updated = patch(cloneProfile(base));
    const next = new Map(this._drafts);
    if (profilesEqual(updated, original)) {
      next.delete(key);
    } else {
      next.set(key, updated);
    }
    this._drafts = next;
  }

  private _findOriginal(scope: Scope, name: string): Profile | undefined {
    const list = scope === "user"
      ? this._data?.userProfiles ?? []
      : this._data?.workspaceProfiles ?? [];
    return list.find(p => p.name === name);
  }

  private _isDirty(scope: Scope, originalName: string): boolean {
    return this._drafts.has(this._key(scope, originalName));
  }

  // -- Action handlers --

  private _onCreate(scope: Scope) {
    this.postCommand("createProfile", { scope });
  }

  private _onSave(scope: Scope, originalName: string) {
    const draft = this._drafts.get(this._key(scope, originalName));
    if (!draft) { return; }
    // Posting a non-string nested object is fine via raw postMessage.
    this.vscodeApi.postMessage({
      command: "saveProfile",
      scope,
      originalName,
      profile: draft,
    });
  }

  private _onRevert(scope: Scope, originalName: string) {
    const next = new Map(this._drafts);
    next.delete(this._key(scope, originalName));
    this._drafts = next;
  }

  private _onDelete(scope: Scope, name: string) {
    this.vscodeApi.postMessage({ command: "deleteProfile", scope, name });
  }

  private _onDuplicate(scope: Scope, name: string) {
    this.vscodeApi.postMessage({ command: "duplicateProfile", scope, name });
  }

  private _onSelectActiveProfile() {
    // Omit `name` -> host opens the QuickPick.
    this.vscodeApi.postMessage({ command: "setActiveProfile" });
  }

  private _onUseForActiveBuild(name: string) {
    this.vscodeApi.postMessage({ command: "setActiveProfile", name });
  }

  private _onClearActiveBuildProfile() {
    this.vscodeApi.postMessage({ command: "setActiveProfile", name: null });
  }

  private _onSaveActiveProfileToWorkspace() {
    this.vscodeApi.postMessage({ command: "saveActiveProfileToWorkspace" });
  }

  private _onResetActiveProfileToWorkspace() {
    this.vscodeApi.postMessage({ command: "resetActiveProfileToWorkspace" });
  }

  // -- Field editors --

  private _onNameInput(scope: Scope, originalName: string, e: Event) {
    const value = stringFromEvent(e);
    this._updateDraft(scope, originalName, (p) => ({ ...p, name: value }));
  }

  private _onBindSelectChange(
    scope: Scope, originalName: string,
    slot: "flash" | "buildDebug" | "debug" | "attach", e: Event,
  ) {
    const value = stringFromEvent(e);
    this._updateDraft(scope, originalName, (p) => {
      const existingBind: ProfileBind = p[slot] ?? { kind: "auto" };
      let newBind: ProfileBind;
      if (value === "auto") {
        newBind = { kind: "auto" };
      } else if (value.startsWith("launch:")) {
        newBind = { kind: "launch", name: value.slice(7) };
      } else if (value.startsWith("west-flash:")) {
        const runnerName = value.slice("west-flash:".length);
        const extraArgs = existingBind.kind === "west-flash" ? (existingBind.extraArgs ?? []) : [];
        newBind = { kind: "west-flash", runner: runnerName, extraArgs };
      } else if (value.startsWith("cortex-debug:")) {
        const runnerName = value.slice("cortex-debug:".length);
        // Preserve RTT and probe when switching between runners of the same kind.
        const prevEnableRtt = existingBind.kind === "cortex-debug" ? existingBind.enableRtt : undefined;
        const prevProbe = existingBind.kind === "cortex-debug" ? existingBind.probe : undefined;
        newBind = { kind: "cortex-debug", runner: runnerName };
        if (prevEnableRtt) { newBind.enableRtt = true; }
        if (prevProbe) { newBind.probe = prevProbe; }
      } else if (value.startsWith("west-debug:")) {
        const runnerName = value.slice("west-debug:".length);
        const extraArgs = existingBind.kind === "west-debug" ? (existingBind.extraArgs ?? []) : [];
        newBind = { kind: "west-debug", runner: runnerName, extraArgs };
      } else {
        newBind = { kind: "auto" };
      }
      return { ...p, [slot]: newBind };
    });
  }

  private _onArgItemChange(
    scope: Scope, originalName: string,
    slot: "flash" | "buildDebug" | "debug" | "attach", index: number, e: Event,
  ) {
    const value = stringFromEvent(e);
    this._updateDraft(scope, originalName, (p) => {
      const current: ProfileBind = p[slot] ?? { kind: "auto" };
      const args = [...(current.extraArgs ?? [])];
      if (value.trim()) {
        args[index] = value.trim();
      } else {
        args.splice(index, 1);
      }
      return { ...p, [slot]: { ...current, extraArgs: args } };
    });
  }

  private _onArgItemDelete(
    scope: Scope, originalName: string,
    slot: "flash" | "buildDebug" | "debug" | "attach", index: number,
  ) {
    this._updateDraft(scope, originalName, (p) => {
      const current: ProfileBind = p[slot] ?? { kind: "auto" };
      const args = [...(current.extraArgs ?? [])];
      args.splice(index, 1);
      return { ...p, [slot]: { ...current, extraArgs: args } };
    });
  }

  private _onNewArgCommit(
    scope: Scope, originalName: string,
    slot: "flash" | "buildDebug" | "debug" | "attach", e: Event,
  ) {
    const value = stringFromEvent(e).trim();
    if (!value) { return; }
    this._updateDraft(scope, originalName, (p) => {
      const current: ProfileBind = p[slot] ?? { kind: "auto" };
      const args = [...(current.extraArgs ?? [])];
      args.push(value);
      return { ...p, [slot]: { ...current, extraArgs: args } };
    });
  }

  // -- Arg picker helpers --

  private _argPickerKey(scope: Scope, originalName: string, slot: string): string {
    return `${scope}:${originalName}:${slot}`;
  }

  private _toggleVarHelp(scope: Scope, originalName: string, slot: string) {
    const key = this._argPickerKey(scope, originalName, slot);
    const next = new Set(this._showVarHelp);
    if (next.has(key)) { next.delete(key); } else { next.add(key); }
    this._showVarHelp = next;
  }

  private _closeVarHelp(scope: Scope, originalName: string, slot: string) {
    const key = this._argPickerKey(scope, originalName, slot);
    const next = new Set(this._showVarHelp);
    next.delete(key);
    this._showVarHelp = next;
  }

  private _copySlot(
    scope: Scope, originalName: string,
    fromSlot: "flash" | "buildDebug" | "debug" | "attach",
    toSlot: "flash" | "buildDebug" | "debug" | "attach",
    draft: Profile,
  ) {
    const sourceBind = (draft[fromSlot] as ProfileBind | undefined) ?? { kind: "auto" as const };
    this._updateDraft(scope, originalName, (p) => ({
      ...p,
      [toSlot]: JSON.parse(JSON.stringify(sourceBind)),
    }));
  }

  private _onRttToggle(
    scope: Scope, originalName: string,
    slot: "flash" | "buildDebug" | "debug" | "attach",
    checked: boolean,
  ) {
    this._updateDraft(scope, originalName, (p) => {
      const current: ProfileBind = p[slot] ?? { kind: "auto" };
      // enableRtt is a structured field on cortex-debug bind only.
      if (current.kind === "cortex-debug") {
        const updated = { ...current };
        if (checked) { updated.enableRtt = true; } else { delete updated.enableRtt; }
        return { ...p, [slot]: updated };
      }
      return p;
    });
  }

  private _onProbeChange(
    scope: Scope, originalName: string,
    slot: "flash" | "buildDebug" | "debug" | "attach",
    e: Event,
  ) {
    const value = stringFromEvent(e);
    this._updateDraft(scope, originalName, (p) => {
      const current: ProfileBind = p[slot] ?? { kind: "auto" };
      if (current.kind === "cortex-debug") {
        const updated = { ...current };
        if (value) { updated.probe = value; } else { delete updated.probe; }
        return { ...p, [slot]: updated };
      }
      return p;
    });
  }

  private _renderVarHelpPanel(scope: Scope, originalName: string, slot: string) {
    return html`
      <div class="var-help-panel">
        <div class="arg-picker-header">
          <span>${panelText("Available variable substitutions")}</span>
          <vscode-button appearance="icon" icon="close"
            @click=${() => this._closeVarHelp(scope, originalName, slot)}>
          </vscode-button>
        </div>
        <table class="var-help-table">
          <thead><tr><th>${panelText("Expression")}</th><th>${panelText("Resolves to")}</th></tr></thead>
          <tbody>
            <tr><td><code>\${workspaceFolder}</code></td><td>${panelText("Workspace root path")}</td></tr>
            <tr><td><code>\${buildFolder}</code></td><td>${panelText("Build output directory")}</td></tr>
            <tr><td><code>\${board}</code></td><td>${panelText("Board name (e.g.")} <code>nucleo_f401re</code>)</td></tr>
            <tr><td><code>\${boardRevision}</code></td><td>${panelText("Board revision, or")} <code>""</code> ${panelText("when not set")}</td></tr>
            <tr><td><code>\${project}</code></td><td>${panelText("Project name")}</td></tr>
            <tr><td><code>\${build}</code></td><td>${panelText("Build configuration name")}</td></tr>
            <tr><td><code>\${buildvar:<em>key</em>}</code></td><td>${panelText("Per-build custom variable (")}<code>BuildConfig.customVars</code>)</td></tr>
            <tr><td><code>\${projectvar:<em>key</em>}</code></td><td>${panelText("Per-project custom variable (")}<code>ProjectConfig.customVars</code>)</td></tr>
            <tr><td><code>\${cmake:<em>VAR</em>}</code></td><td>${panelText("Value from")} <code>CMakeCache.txt</code> ${panelText("(case-insensitive)")}</td></tr>
            <tr><td><code>\${kconfig:<em>VAR</em>}</code></td><td>${panelText("Kconfig value from")} <code>zephyr/.config</code> ${panelText("(strings unquoted;")} <code>CONFIG_</code> ${panelText("prefix optional)")}</td></tr>
            <tr><td><code>\${env:<em>VAR</em>}</code></td><td><code>process.env</code> ${panelText("value, or")} <code>""</code> ${panelText("when unset")}</td></tr>
            <tr><td><code>\${config:<em>some.key</em>}</code></td><td>${panelText("VS Code workspace/user configuration value")}</td></tr>
            <tr class="var-help-row-muted"><td><em>${panelText("anything else")}</em></td><td>${panelText("Left unchanged (VS Code resolves later)")}</td></tr>
          </tbody>
        </table>
      </div>
    `;
  }

  /** Render per-arg rows + add-argument row for west-flash / west-debug binds. */
  private _renderArgEditor(
    scope: Scope, originalName: string,
    slot: "flash" | "buildDebug" | "debug" | "attach",
    bind: ProfileBind,
    _currentRunner: string,
  ) {
    const key = this._argPickerKey(scope, originalName, slot);
    const varHelpOpen = this._showVarHelp.has(key);
    const allArgs = bind.extraArgs ?? [];

    return html`
      <div class="arg-editor">
        ${allArgs.map((arg, realIdx) => html`
          <div class="arg-row">
            <vscode-textfield class="arg-row-input"
              .value=${arg}
              placeholder="${panelText("argument")}"
              @change=${(e: Event) => this._onArgItemChange(scope, originalName, slot, realIdx, e)}>
            </vscode-textfield>
            <vscode-button appearance="icon" icon="close"
              title="${panelText("Remove argument")}"
              @click=${() => this._onArgItemDelete(scope, originalName, slot, realIdx)}>
            </vscode-button>
          </div>
        `)}
        <div class="arg-row arg-row-new">
          <vscode-textfield class="arg-row-input"
            .value=${""}
            placeholder="${panelText("Add argument…")}"
            @change=${(e: Event) => this._onNewArgCommit(scope, originalName, slot, e)}>
          </vscode-textfield>
          <vscode-button appearance="icon" icon="question"
            title="${panelText("Variable substitution reference")}"
            @click=${() => this._toggleVarHelp(scope, originalName, slot)}>
          </vscode-button>
        </div>
        ${varHelpOpen ? this._renderVarHelpPanel(scope, originalName, slot) : nothing}
      </div>
    `;
  }

  /** Render RTT checkbox + probe dropdown for a cortex-debug bind. */
  private _renderCortexDebugOptions(
    scope: Scope, originalName: string,
    slot: "flash" | "buildDebug" | "debug" | "attach",
    bind: ProfileBind,
  ) {
    if (bind.kind !== "cortex-debug" || !bind.runner) { return nothing; }
    const runner = bind.runner;
    const rttEnabled = bind.enableRtt === true;
    const currentProbe = bind.probe ?? "";
    const probeCfgs = RUNNER_SECONDARY_SELECTS[runner];
    const isCustomProbe = !!currentProbe && probeCfgs && !probeCfgs[0].options.some(o => o.value === currentProbe);

    return html`
      <div class="arg-editor">
        ${RTT_CAPABLE_RUNNERS.has(runner) ? html`
        <div class="arg-row arg-row--rtt">
          <vscode-checkbox
            ?checked=${rttEnabled}
            @change=${(e: Event) => this._onRttToggle(scope, originalName, slot, (e.target as HTMLInputElement).checked)}>
            ${panelText("Enable RTT")}
          </vscode-checkbox>
        </div>` : nothing}
        ${probeCfgs ? probeCfgs.map(cfg => html`
          <div class="slot-secondary-select">
            <span class="slot-secondary-label" title=${cfg.hint}>
              ${cfg.label}
              ${cfg.required && !currentProbe
          ? html`<i class="codicon codicon-warning slot-secondary-req-icon"></i>`
          : nothing}
            </span>
            <vscode-single-select class="profile-slot-select slot-secondary-dropdown"
              .value=${currentProbe}
              @change=${(e: Event) => this._onProbeChange(scope, originalName, slot, e)}>
              <vscode-option value="" ?selected=${!currentProbe}>${cfg.placeholder}</vscode-option>
              ${cfg.options.map(o => html`
                <vscode-option
                  value=${o.value}
                  ?selected=${currentProbe === o.value}
                  title=${o.description ?? o.label}>${o.label}</vscode-option>
              `)}
              ${isCustomProbe ? html`
                <vscode-option value=${currentProbe} ?selected=${true}>${currentProbe} ${panelText("(custom)")}</vscode-option>
              ` : nothing}
            </vscode-single-select>
          </div>
        `) : nothing}
      </div>
    `;
  }

  // -- Render --

  render() {
    if (!this._data) {
      return html`<div class="panel-container"><p>${panelText("Loading…")}</p></div>`;
    }
    const d = this._data;

    return html`
      <div class="panel-container">
        <div class="page-header">
          <div>
            <h1 class="page-title">
              <i class="codicon codicon-debug-alt-small"></i> ${panelText("Runner Profiles")}
            </h1>
            <p class="page-subtitle">
              ${panelText("Reusable bundles of")} <strong>${panelText("flash")}</strong>,
              ${d.separateBuildDebugProfile ? html`<strong>${panelText("build & debug")}</strong>, ` : nothing}<strong>${panelText("debug")}</strong>${panelText(", and")} <strong>${panelText("attach")}</strong> ${panelText("binds. Workspace profiles live in")} <code>.vscode/zephyr-ide.json</code>${panelText("; user profiles live in")}
              <code>zephyr-ide.runnerProfiles</code> ${panelText("settings. Workspace overrides user on name collision.")}
              ${d.separateBuildDebugProfile ? nothing : html`
                <br><span class="scope-section-hint">${panelText("Tip: enable")} <code>zephyr-ide.separateBuildDebugProfile</code> ${panelText("to configure Build & Debug separately from Debug.")}</span>`}
            </p>
          </div>
        </div>

        ${d.activeProfileName || d.activeBuildLabel
        ? html`
              <div class="active-build-banner">
                <i class="codicon codicon-pin"></i>
                <span>
                  ${d.activeBuildLabel
            ? html`${panelText("Active build:")} <strong>${d.activeBuildLabel}</strong>`
            : html`${panelText("No active build")}`}
                  ${d.activeProfileName
            ? html` ${panelText("— using profile")} <strong>${d.activeProfileName}</strong>${d.activeProfileScope === "local"
              ? html` <span class="scope-local-badge" title="${panelText("Local override — not committed to zephyr-ide.json")}">${panelText("(local)")}</span>`
              : nothing}`
            : html` ${panelText("—")} <em>${panelText("no profile selected (auto / runners.yaml defaults)")}</em>`}
                </span>
                <vscode-button appearance="secondary" icon="settings-gear"
                  @click=${() => this._onSelectActiveProfile()}
                  ?disabled=${!d.activeBuildLabel}>
                  ${panelText("Change active profile")}
                </vscode-button>
                ${d.activeProfileName
            ? html`<vscode-button appearance="icon" icon="close"
                title="${panelText("Clear active profile (revert to runners.yaml defaults)")}"
                @click=${() => this._onClearActiveBuildProfile()}></vscode-button>`
            : nothing}
                ${d.activeProfileScope === "local"
            ? html`
                    <vscode-button appearance="icon" icon="save"
                      title="${panelText("Save local override to workspace (.vscode/zephyr-ide.json)")}"
                      @click=${() => this._onSaveActiveProfileToWorkspace()}></vscode-button>
                    <vscode-button appearance="icon" icon="discard"
                      title="${panelText("Reset to workspace default (discard local override)")}"
                      @click=${() => this._onResetActiveProfileToWorkspace()}></vscode-button>`
            : nothing}
              </div>`
        : nothing}

        ${this._renderScope("workspace", d.workspaceProfiles)}
        ${this._renderScope("user", d.userProfiles)}
      </div>
    `;
  }

  private _renderScope(scope: Scope, profiles: Profile[]) {
    const d = this._data!;
    if (scope === "workspace" && !d.hasWorkspace) {
      return html`
        <section class="scope-section">
          <div class="scope-section-header">
            <h2 class="scope-section-title">
              <i class="codicon codicon-folder"></i> ${panelText("Workspace")}
            </h2>
            <span class="scope-section-hint">${panelText("Open a workspace to add workspace-scoped profiles.")}</span>
          </div>
        </section>`;
    }

    const heading = scope === "workspace"
      ? html`<i class="codicon codicon-folder"></i> ${panelText("Workspace")}`
      : html`<i class="codicon codicon-account"></i> ${panelText("User")}`;
    const hint = scope === "workspace"
      ? html`${panelText("Saved to")} <code>.vscode/zephyr-ide.json</code>${panelText(". Shared with anyone who clones the repo.")}`
      : html`${panelText("Saved to")} <code>zephyr-ide.runnerProfiles</code> ${panelText("user setting. Available across all workspaces.")}`;

    return html`
      <section class="scope-section">
        <div class="scope-section-header">
          <h2 class="scope-section-title">${heading}</h2>
          <span class="scope-section-hint">${hint}</span>
          <vscode-button appearance="primary" icon="add"
            @click=${() => this._onCreate(scope)}>
            ${panelText("New profile")}
          </vscode-button>
        </div>
        ${profiles.length === 0
        ? html`<div class="scope-section-empty">
              ${panelParts(scope === "workspace" ? panelText("No workspace profiles yet. Click {0} to add one.") : panelText("No user profiles yet. Click {0} to add one."), html`<strong>${panelText("New profile")}</strong>`)}
            </div>`
        : html`<div class="profile-list">
              ${profiles.map(p => this._renderProfileCard(scope, p))}
            </div>`}
      </section>
    `;
  }

  private _renderProfileCard(scope: Scope, original: Profile) {
    const draft = this._draftFor(scope, original);
    const dirty = this._isDirty(scope, original.name);
    const isActive = !!this._data?.activeProfileName && this._data.activeProfileName === original.name;
    const usage = this._data?.usageByName?.[original.name] ?? [];
    const hasActiveBuild = !!this._data?.activeBuildLabel;

    return html`
      <div class="profile-card ${isActive ? "active" : ""}"
        id=${"profile-card--" + original.name}
        tabindex="-1">
        <div class="profile-card-header">
          <vscode-textfield class="profile-card-name"
            .value=${draft.name}
            placeholder="${panelText("Profile name")}"
            @change=${(e: Event) => this._onNameInput(scope, original.name, e)}
            @input=${(e: Event) => this._onNameInput(scope, original.name, e)}>
          </vscode-textfield>
          ${isActive ? html`<span class="profile-active-badge" title="${panelText("Active profile for the current build")}"><i class="codicon codicon-pin"></i> ${panelText("active")}</span>` : nothing}
          ${usage.length > 0
        ? html`<span class="profile-usage-badge"
              title=${usage.length === 1 ? panelText("Used by 1 build:\n{0}", usage[0]) : panelText("Used by {0} builds:\n{1}", usage.length, usage.join("\n"))}>
              <i class="codicon codicon-link"></i> ${usage.length}
            </span>`
        : nothing}
        </div>

        <div class="profile-slots">
          ${this._renderSlot(scope, original.name, draft, "flash", "zap")}
          ${this._data?.separateBuildDebugProfile
        ? this._renderSlot(scope, original.name, draft, "buildDebug", "debug-all",
          draft.buildDebug ?? { kind: "auto" })
        : nothing}
          ${this._renderSlot(scope, original.name, draft, "debug", "debug-alt")}
          ${this._renderSlot(scope, original.name, draft, "attach", "debug-console")}
        </div>

        <div class="profile-card-actions">
          ${dirty ? html`<span class="dirty-hint">${panelText("Unsaved changes")}</span>` : nothing}
          ${!dirty && hasActiveBuild && !isActive
        ? html`<vscode-button appearance="secondary" icon="pin"
              title="${panelText("Set as active profile for the current build")}"
              @click=${() => this._onUseForActiveBuild(original.name)}>
              ${panelText("Use for active build")}
            </vscode-button>`
        : nothing}
          ${dirty ? html`
            <vscode-button appearance="secondary" icon="discard"
              @click=${() => this._onRevert(scope, original.name)}>
              ${panelText("Revert")}
            </vscode-button>
            <vscode-button appearance="primary" icon="save"
              @click=${() => this._onSave(scope, original.name)}>
              ${panelText("Save")}
            </vscode-button>
          ` : nothing}
          <vscode-button appearance="icon" icon="copy" title="${panelText("Duplicate profile")}"
            @click=${() => this._onDuplicate(scope, original.name)}>
          </vscode-button>
          <vscode-button appearance="icon" icon="trash" title="${panelText("Delete profile")}"
            @click=${() => this._onDelete(scope, original.name)}>
          </vscode-button>
        </div>
      </div>
    `;
  }

  private _renderSlot(
    scope: Scope, originalName: string, draft: Profile,
    slot: "flash" | "buildDebug" | "debug" | "attach", icon: string,
    bindOverride?: ProfileBind,
  ) {
    const bind = bindOverride ?? (draft[slot] as ProfileBind | undefined) ?? { kind: "auto" as const };
    const labelMap: Record<string, string> = {
      flash: "Flash",
      buildDebug: "Build & Debug",
      debug: "Debug",
      attach: "Attach",
    };
    const label = labelMap[slot] ?? (slot.charAt(0).toUpperCase() + slot.slice(1));
    const isFlashSlot = slot === "flash";
    return isFlashSlot
      ? this._renderFlashSlotBody(scope, originalName, draft, slot, icon, label, bind)
      : this._renderDebugSlotBody(scope, originalName, draft, slot, icon, label, bind);
  }

  private _renderFlashSlotBody(
    scope: Scope, originalName: string, _draft: Profile,
    slot: "flash", icon: string, label: string, bind: ProfileBind,
  ) {
    const d = this._data!;
    const knownRunners = d.knownRunners.length > 0 ? d.knownRunners : ["openocd"];
    const currentValue = bindToSelectValue(bind);

    return html`
      <div class="profile-slot-section">
        <div class="profile-slot-header">
          <i class="codicon codicon-${icon}"></i>
          <span class="profile-slot-title">${label}</span>
        </div>
        <div class="profile-slot-body">
          <vscode-single-select class="profile-slot-select"
            .value=${currentValue}
            @change=${(e: Event) => this._onBindSelectChange(scope, originalName, slot, e)}>
            <vscode-option value="auto" ?selected=${bind.kind === "auto"}>${panelText("Auto (runners.yaml)")}</vscode-option>
            <vscode-option value="" disabled>${panelText("─── West Flash ───")}</vscode-option>
            ${knownRunners.map(r => html`
              <vscode-option
                value=${"west-flash:" + r}
                ?selected=${bind.kind === "west-flash" && bind.runner === r}>${r}</vscode-option>
            `)}
            ${bind.kind === "west-flash" && bind.runner && !knownRunners.includes(bind.runner) ? html`
              <vscode-option value=${"west-flash:" + bind.runner} ?selected=${true}>${bind.runner} ${panelText("(custom)")}</vscode-option>
            ` : nothing}
          </vscode-single-select>
          ${bind.kind === "west-flash" && bind.runner
        ? this._renderArgEditor(scope, originalName, slot, bind, bind.runner)
        : nothing}
          ${bind.kind === "auto"
        ? html`<span class="scope-section-hint">${panelText("Uses runners.yaml defaults.")}</span>`
        : nothing}
        </div>
      </div>
    `;
  }

  private _renderDebugSlotBody(
    scope: Scope, originalName: string, draft: Profile,
    slot: "buildDebug" | "debug" | "attach", icon: string, label: string, bind: ProfileBind,
  ) {
    const d = this._data!;
    const cortexRunners = (d.knownCortexDebugRunners ?? d.knownRunners).length > 0
      ? (d.knownCortexDebugRunners ?? d.knownRunners)
      : ["openocd"];
    const westRunners = (d.knownWestDebugRunners ?? []).length > 0
      ? (d.knownWestDebugRunners ?? [])
      : [];
    const currentValue = bindToSelectValue(bind);
    const launchConfigNames = d.launchConfigNames ?? [];

    // When the saved bind is a launch config not in the known list, keep it selectable.
    const syntheticLaunch = bind.kind === "launch" && bind.name
      && !launchConfigNames.includes(bind.name);

    return html`
      <div class="profile-slot-section">
        <div class="profile-slot-header">
          <i class="codicon codicon-${icon}"></i>
          <span class="profile-slot-title">${label}</span>
          ${slot === "debug" ? html`
            <vscode-button appearance="icon" icon="arrow-down"
              title="${panelText("Copy Debug → Attach")}"
              @click=${() => this._copySlot(scope, originalName, "debug", "attach", draft)}>
            </vscode-button>` : nothing}
          ${slot === "attach" ? html`
            <vscode-button appearance="icon" icon="arrow-up"
              title="${panelText("Copy Attach → Debug")}"
              @click=${() => this._copySlot(scope, originalName, "attach", "debug", draft)}>
            </vscode-button>` : nothing}
        </div>
        <div class="profile-slot-body">
          <vscode-single-select class="profile-slot-select"
            .value=${currentValue}
            @change=${(e: Event) => this._onBindSelectChange(scope, originalName, slot, e)}>
            <vscode-option value="auto" ?selected=${bind.kind === "auto"}>${panelText("Auto (runners.yaml)")}</vscode-option>
            <vscode-option value="" disabled>${panelText("─── launch.json ───")}</vscode-option>
            ${launchConfigNames.map(n => html`
              <vscode-option
                value=${"launch:" + n}
                ?selected=${bind.kind === "launch" && bind.name === n}>${n}</vscode-option>
            `)}
            ${syntheticLaunch ? html`
              <vscode-option
                value=${"launch:" + bind.name}
                ?selected=${true}>${bind.name} ${panelText("(not found)")}</vscode-option>
            ` : nothing}
            <vscode-option value="" disabled>${panelText("─── cortex-debug (auto-config) ───")}</vscode-option>
            ${cortexRunners.map(r => html`
              <vscode-option
                value=${"cortex-debug:" + r}
                ?selected=${bind.kind === "cortex-debug" && bind.runner === r}>${r}</vscode-option>
            `)}
            ${bind.kind === "cortex-debug" && bind.runner && !cortexRunners.includes(bind.runner) ? html`
              <vscode-option value=${"cortex-debug:" + bind.runner} ?selected=${true}>${bind.runner} ${panelText("(custom)")}</vscode-option>
            ` : nothing}
            <vscode-option value="" disabled>${panelText("─── west debugserver bridge ───")}</vscode-option>
            ${westRunners.map(r => html`
              <vscode-option
                value=${"west-debug:" + r}
                ?selected=${bind.kind === "west-debug" && bind.runner === r}>${r} ${panelText("(west)")}</vscode-option>
            `)}
            ${bind.kind === "west-debug" && bind.runner && !westRunners.includes(bind.runner) ? html`
              <vscode-option value=${"west-debug:" + bind.runner} ?selected=${true}>${bind.runner} ${panelText("(custom, west)")}</vscode-option>
            ` : nothing}
          </vscode-single-select>
          ${bind.kind === "cortex-debug" && bind.runner
        ? this._renderCortexDebugOptions(scope, originalName, slot, bind)
        : nothing}
          ${bind.kind === "west-debug" && bind.runner
        ? this._renderArgEditor(scope, originalName, slot, bind, bind.runner)
        : nothing}
          ${bind.kind === "auto" && slot === "buildDebug"
        ? html`<span class="scope-section-hint">${panelParts(panelText("Falls back to the {0} slot."), html`<strong>${panelText("Debug")}</strong>`)}</span>`
        : bind.kind === "auto" && slot === "debug" && !d.separateBuildDebugProfile
          ? html`<span class="scope-section-hint">${panelText("Uses runners.yaml defaults. Drives both Debug and Build & Debug.")}</span>`
          : bind.kind === "auto"
            ? html`<span class="scope-section-hint">${panelText("Uses runners.yaml defaults.")}</span>`
            : bind.kind === "launch" && launchConfigNames.length === 0 && !syntheticLaunch
              ? html`<span class="no-launch-warning">${panelText("No launch.json configs detected.")}</span>`
              : bind.kind === "cortex-debug"
                ? html`<span class="scope-section-hint">${panelText("elf, gdb, and target auto-resolved from runners.yaml. RTT and probe selections are structured fields applied on top.")}</span>`
                : bind.kind === "west-debug"
                  ? html`<span class="scope-section-hint">${panelText("Always uses")} <code>west debugserver</code> ${panelText("bridge — connects cortex-debug as external GDB server.")}</span>`
                  : nothing}
        </div>
      </div>
    `;
  }
}

// ---------------------------------------------------------------------------
// Runner secondary selects (interface / probe / target dropdowns)
// ---------------------------------------------------------------------------

interface SecondarySelectOption {
  value: string;
  label: string;
  description?: string;
}

interface SecondarySelectConfig {
  /** Label shown to the left of the dropdown. */
  label: string;
  /** Tooltip shown on the label. */
  hint: string;
  /** When true, a warning icon appears if nothing is selected. */
  required: boolean;
  /** Label for the empty / "none" option. */
  placeholder: string;
  options: SecondarySelectOption[];
}

/**
 * Runners that support RTT via `--enable-rtt` (translated to cortex-debug's
 * `rttConfig` or `rttEnabled`). JLink, stlink, qemu, and others are NOT
 * included because their debug-provider cases do not handle the flag.
 */
const RTT_CAPABLE_RUNNERS = new Set(["openocd", "pyocd", "bmp", "blackmagicprobe"]);

const RUNNER_SECONDARY_SELECTS: Partial<Record<string, SecondarySelectConfig[]>> = {
  openocd: [
    {
      label: panelText("Interface / Probe"),
      hint: "OpenOCD interface config. Leave blank if runners.yaml already specifies one.",
      required: false,
      placeholder: panelText("runners.yaml / auto-detect"),
      options: [
        { value: "interface/stlink.cfg", label: "ST-LINK v2/v3", description: panelText("Most common for STM32 / nRF52 with SWD") },
        { value: "interface/cmsis-dap.cfg", label: "CMSIS-DAP", description: panelText("DAPLink, ULINK2, MCU-Link, …") },
        { value: "interface/jlink.cfg", label: "SEGGER J-Link", description: panelText("J-Link via OpenOCD") },
        { value: "interface/ftdi.cfg", label: "FTDI", description: panelText("FTDI-based probe (generic)") },
        { value: "interface/picoprobe.cfg", label: panelText("Raspberry Pi Pico (probe)"), description: panelText("RP2040 Pico used as SWD/JTAG probe") },
        { value: "interface/raspberrypi-swd.cfg", label: panelText("Raspberry Pi GPIO SWD"), description: panelText("Bit-banged SWD via RPi GPIO") },
        { value: "interface/buspirate.cfg", label: "Bus Pirate", description: panelText("Bus Pirate USB probe") },
      ],
    },
  ],
  pyocd: [
    {
      label: panelText("Probe / Interface"),
      hint: "pyOCD probe selection. Specify the probe type or leave blank to auto-detect the first available.",
      required: true,
      placeholder: panelText("— select probe (required) —"),
      options: [
        { value: "cmsis_dap", label: panelText("CMSIS-DAP (generic)"), description: panelText("Any CMSIS-DAP probe — DAPLink, MCU-Link, ULINK2, …") },
        { value: "stlink", label: panelText("ST-Link (v2/v3)"), description: panelText("STMicroelectronics ST-Link v2 or v3 (libusb)") },
        { value: "jlink", label: "SEGGER J-Link", description: panelText("First J-Link probe (requires pyocd-jlink plugin)") },
        { value: "picoprobe", label: panelText("Raspberry Pi Pico (picoprobe)"), description: panelText("RP2040 Pico running picoprobe firmware") },
        { value: "xds110", label: "TI XDS110", description: panelText("Texas Instruments XDS110 debug probe") },
        { value: "cmsisdap", label: panelText("cmsisdap (alternate ID)"), description: panelText("Alternate CMSIS-DAP probe ID for some targets") },
      ],
    },
  ],
};
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stringFromEvent(e: Event): string {
  const target = e.target as { value?: unknown } | null;
  if (target && typeof target.value === "string") { return target.value; }
  return "";
}

function bindToSelectValue(bind: ProfileBind): string {
  if (bind.kind === "auto") { return "auto"; }
  if (bind.kind === "launch") { return `launch:${bind.name ?? ""}`; }
  if (bind.kind === "west-flash") { return `west-flash:${bind.runner ?? ""}`; }
  if (bind.kind === "cortex-debug") { return `cortex-debug:${bind.runner ?? ""}`; }
  if (bind.kind === "west-debug") { return `west-debug:${bind.runner ?? ""}`; }
  return "auto";
}

function cloneProfile(p: Profile): Profile {
  const out: Profile = {
    name: p.name,
    flash: { ...p.flash },
    debug: { ...p.debug },
    attach: { ...p.attach },
  };
  if (p.buildDebug) { out.buildDebug = { ...p.buildDebug }; }
  return out;
}

function bindsEqual(a: ProfileBind, b: ProfileBind): boolean {
  if (a.kind !== b.kind) { return false; }
  if (a.kind === "auto") { return true; }
  if (a.kind === "launch") {
    return (a.name ?? "") === (b.name ?? "");
  }
  if (a.kind === "west-flash" || a.kind === "west-debug") {
    return (a.runner ?? "") === (b.runner ?? "")
      && JSON.stringify(a.extraArgs ?? []) === JSON.stringify(b.extraArgs ?? []);
  }
  if (a.kind === "cortex-debug") {
    return (a.runner ?? "") === (b.runner ?? "")
      && !!a.enableRtt === !!b.enableRtt
      && (a.probe ?? "") === (b.probe ?? "");
  }
  return false;
}

function profilesEqual(a: Profile, b: Profile): boolean {
  // Both having undefined buildDebug counts as equal; treat undefined as auto for comparison.
  const aBuildDebug = a.buildDebug ?? { kind: "auto" as const };
  const bBuildDebug = b.buildDebug ?? { kind: "auto" as const };
  // Profiles with no buildDebug are equal regardless of whether one is auto.
  const buildDebugEqual = (!a.buildDebug && !b.buildDebug) || bindsEqual(aBuildDebug, bBuildDebug);
  return a.name === b.name
    && bindsEqual(a.flash, b.flash)
    && buildDebugEqual
    && bindsEqual(a.debug, b.debug)
    && bindsEqual(a.attach, b.attach);
}
