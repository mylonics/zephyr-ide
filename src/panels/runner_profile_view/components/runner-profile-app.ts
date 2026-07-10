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
          <span>Available variable substitutions</span>
          <vscode-button appearance="icon" icon="close"
            @click=${() => this._closeVarHelp(scope, originalName, slot)}>
          </vscode-button>
        </div>
        <table class="var-help-table">
          <thead><tr><th>Expression</th><th>Resolves to</th></tr></thead>
          <tbody>
            <tr><td><code>\${workspaceFolder}</code></td><td>Workspace root path</td></tr>
            <tr><td><code>\${buildFolder}</code></td><td>Build output directory</td></tr>
            <tr><td><code>\${board}</code></td><td>Board name (e.g. <code>nucleo_f401re</code>)</td></tr>
            <tr><td><code>\${boardRevision}</code></td><td>Board revision, or <code>""</code> when not set</td></tr>
            <tr><td><code>\${project}</code></td><td>Project name</td></tr>
            <tr><td><code>\${build}</code></td><td>Build configuration name</td></tr>
            <tr><td><code>\${buildvar:<em>key</em>}</code></td><td>Per-build custom variable (<code>BuildConfig.customVars</code>)</td></tr>
            <tr><td><code>\${projectvar:<em>key</em>}</code></td><td>Per-project custom variable (<code>ProjectConfig.customVars</code>)</td></tr>
            <tr><td><code>\${cmake:<em>VAR</em>}</code></td><td>Value from <code>CMakeCache.txt</code> (case-insensitive)</td></tr>
            <tr><td><code>\${kconfig:<em>VAR</em>}</code></td><td>Kconfig value from <code>zephyr/.config</code> (strings unquoted; <code>CONFIG_</code> prefix optional)</td></tr>
            <tr><td><code>\${env:<em>VAR</em>}</code></td><td><code>process.env</code> value, or <code>""</code> when unset</td></tr>
            <tr><td><code>\${config:<em>some.key</em>}</code></td><td>VS Code workspace/user configuration value</td></tr>
            <tr class="var-help-row-muted"><td><em>anything else</em></td><td>Left unchanged (VS Code resolves later)</td></tr>
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
              placeholder="argument"
              @change=${(e: Event) => this._onArgItemChange(scope, originalName, slot, realIdx, e)}>
            </vscode-textfield>
            <vscode-button appearance="icon" icon="close"
              title="Remove argument"
              @click=${() => this._onArgItemDelete(scope, originalName, slot, realIdx)}>
            </vscode-button>
          </div>
        `)}
        <div class="arg-row arg-row-new">
          <vscode-textfield class="arg-row-input"
            .value=${""}
            placeholder="Add argument…"
            @change=${(e: Event) => this._onNewArgCommit(scope, originalName, slot, e)}>
          </vscode-textfield>
          <vscode-button appearance="icon" icon="question"
            title="Variable substitution reference"
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
            Enable RTT
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
                <vscode-option value=${currentProbe} ?selected=${true}>${currentProbe} (custom)</vscode-option>
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
      return html`<div class="panel-container"><p>Loading…</p></div>`;
    }
    const d = this._data;

    return html`
      <div class="panel-container">
        <div class="page-header">
          <div>
            <h1 class="page-title">
              <i class="codicon codicon-debug-alt-small"></i> Runner Profiles
            </h1>
            <p class="page-subtitle">
              Reusable bundles of <strong>flash</strong>,
              ${d.separateBuildDebugProfile ? html`<strong>build &amp; debug</strong>, ` : nothing}<strong>debug</strong>, and <strong>attach</strong> binds.
              Workspace profiles live in <code>.vscode/zephyr-ide.json</code>; user profiles live in
              <code>zephyr-ide.runnerProfiles</code> settings. Workspace overrides user on name collision.
              ${d.separateBuildDebugProfile ? nothing : html`
                <br><span class="scope-section-hint">Tip: enable <code>zephyr-ide.separateBuildDebugProfile</code> to configure Build&#8202;&amp;&#8202;Debug separately from Debug.</span>`}
            </p>
          </div>
        </div>

        ${d.activeProfileName || d.activeBuildLabel
        ? html`
              <div class="active-build-banner">
                <i class="codicon codicon-pin"></i>
                <span>
                  ${d.activeBuildLabel
            ? html`Active build: <strong>${d.activeBuildLabel}</strong>`
            : html`No active build`}
                  ${d.activeProfileName
            ? html` &mdash; using profile <strong>${d.activeProfileName}</strong>${d.activeProfileScope === "local"
              ? html` <span class="scope-local-badge" title="Local override — not committed to zephyr-ide.json">(local)</span>`
              : nothing}`
            : html` &mdash; <em>no profile selected (auto / runners.yaml defaults)</em>`}
                </span>
                <vscode-button appearance="secondary" icon="settings-gear"
                  @click=${() => this._onSelectActiveProfile()}
                  ?disabled=${!d.activeBuildLabel}>
                  Change active profile
                </vscode-button>
                ${d.activeProfileName
            ? html`<vscode-button appearance="icon" icon="close"
                title="Clear active profile (revert to runners.yaml defaults)"
                @click=${() => this._onClearActiveBuildProfile()}></vscode-button>`
            : nothing}
                ${d.activeProfileScope === "local"
            ? html`
                    <vscode-button appearance="icon" icon="save"
                      title="Save local override to workspace (.vscode/zephyr-ide.json)"
                      @click=${() => this._onSaveActiveProfileToWorkspace()}></vscode-button>
                    <vscode-button appearance="icon" icon="discard"
                      title="Reset to workspace default (discard local override)"
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
              <i class="codicon codicon-folder"></i> Workspace
            </h2>
            <span class="scope-section-hint">Open a workspace to add workspace-scoped profiles.</span>
          </div>
        </section>`;
    }

    const heading = scope === "workspace"
      ? html`<i class="codicon codicon-folder"></i> Workspace`
      : html`<i class="codicon codicon-account"></i> User`;
    const hint = scope === "workspace"
      ? html`Saved to <code>.vscode/zephyr-ide.json</code>. Shared with anyone who clones the repo.`
      : html`Saved to <code>zephyr-ide.runnerProfiles</code> user setting. Available across all workspaces.`;

    return html`
      <section class="scope-section">
        <div class="scope-section-header">
          <h2 class="scope-section-title">${heading}</h2>
          <span class="scope-section-hint">${hint}</span>
          <vscode-button appearance="primary" icon="add"
            @click=${() => this._onCreate(scope)}>
            New profile
          </vscode-button>
        </div>
        ${profiles.length === 0
        ? html`<div class="scope-section-empty">
              No ${scope} profiles yet. Click <strong>New profile</strong> to add one.
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
            placeholder="Profile name"
            @change=${(e: Event) => this._onNameInput(scope, original.name, e)}
            @input=${(e: Event) => this._onNameInput(scope, original.name, e)}>
          </vscode-textfield>
          ${isActive ? html`<span class="profile-active-badge" title="Active profile for the current build"><i class="codicon codicon-pin"></i> active</span>` : nothing}
          ${usage.length > 0
        ? html`<span class="profile-usage-badge"
              title=${`Used by ${usage.length} build${usage.length === 1 ? "" : "s"}:\n${usage.join("\n")}`}>
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
          ${dirty ? html`<span class="dirty-hint">Unsaved changes</span>` : nothing}
          ${!dirty && hasActiveBuild && !isActive
        ? html`<vscode-button appearance="secondary" icon="pin"
              title="Set as active profile for the current build"
              @click=${() => this._onUseForActiveBuild(original.name)}>
              Use for active build
            </vscode-button>`
        : nothing}
          ${dirty ? html`
            <vscode-button appearance="secondary" icon="discard"
              @click=${() => this._onRevert(scope, original.name)}>
              Revert
            </vscode-button>
            <vscode-button appearance="primary" icon="save"
              @click=${() => this._onSave(scope, original.name)}>
              Save
            </vscode-button>
          ` : nothing}
          <vscode-button appearance="icon" icon="copy" title="Duplicate profile"
            @click=${() => this._onDuplicate(scope, original.name)}>
          </vscode-button>
          <vscode-button appearance="icon" icon="trash" title="Delete profile"
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
            <vscode-option value="auto" ?selected=${bind.kind === "auto"}>Auto (runners.yaml)</vscode-option>
            <vscode-option value="" disabled>─── West Flash ───</vscode-option>
            ${knownRunners.map(r => html`
              <vscode-option
                value=${"west-flash:" + r}
                ?selected=${bind.kind === "west-flash" && bind.runner === r}>${r}</vscode-option>
            `)}
            ${bind.kind === "west-flash" && bind.runner && !knownRunners.includes(bind.runner) ? html`
              <vscode-option value=${"west-flash:" + bind.runner} ?selected=${true}>${bind.runner} (custom)</vscode-option>
            ` : nothing}
          </vscode-single-select>
          ${bind.kind === "west-flash" && bind.runner
        ? this._renderArgEditor(scope, originalName, slot, bind, bind.runner)
        : nothing}
          ${bind.kind === "auto"
        ? html`<span class="scope-section-hint">Uses runners.yaml defaults.</span>`
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
              title="Copy Debug → Attach"
              @click=${() => this._copySlot(scope, originalName, "debug", "attach", draft)}>
            </vscode-button>` : nothing}
          ${slot === "attach" ? html`
            <vscode-button appearance="icon" icon="arrow-up"
              title="Copy Attach → Debug"
              @click=${() => this._copySlot(scope, originalName, "attach", "debug", draft)}>
            </vscode-button>` : nothing}
        </div>
        <div class="profile-slot-body">
          <vscode-single-select class="profile-slot-select"
            .value=${currentValue}
            @change=${(e: Event) => this._onBindSelectChange(scope, originalName, slot, e)}>
            <vscode-option value="auto" ?selected=${bind.kind === "auto"}>Auto (runners.yaml)</vscode-option>
            <vscode-option value="" disabled>─── launch.json ───</vscode-option>
            ${launchConfigNames.map(n => html`
              <vscode-option
                value=${"launch:" + n}
                ?selected=${bind.kind === "launch" && bind.name === n}>${n}</vscode-option>
            `)}
            ${syntheticLaunch ? html`
              <vscode-option
                value=${"launch:" + bind.name}
                ?selected=${true}>${bind.name} (not found)</vscode-option>
            ` : nothing}
            <vscode-option value="" disabled>─── cortex-debug (auto-config) ───</vscode-option>
            ${cortexRunners.map(r => html`
              <vscode-option
                value=${"cortex-debug:" + r}
                ?selected=${bind.kind === "cortex-debug" && bind.runner === r}>${r}</vscode-option>
            `)}
            ${bind.kind === "cortex-debug" && bind.runner && !cortexRunners.includes(bind.runner) ? html`
              <vscode-option value=${"cortex-debug:" + bind.runner} ?selected=${true}>${bind.runner} (custom)</vscode-option>
            ` : nothing}
            <vscode-option value="" disabled>─── west debugserver bridge ───</vscode-option>
            ${westRunners.map(r => html`
              <vscode-option
                value=${"west-debug:" + r}
                ?selected=${bind.kind === "west-debug" && bind.runner === r}>${r} (west)</vscode-option>
            `)}
            ${bind.kind === "west-debug" && bind.runner && !westRunners.includes(bind.runner) ? html`
              <vscode-option value=${"west-debug:" + bind.runner} ?selected=${true}>${bind.runner} (custom, west)</vscode-option>
            ` : nothing}
          </vscode-single-select>
          ${bind.kind === "cortex-debug" && bind.runner
        ? this._renderCortexDebugOptions(scope, originalName, slot, bind)
        : nothing}
          ${bind.kind === "west-debug" && bind.runner
        ? this._renderArgEditor(scope, originalName, slot, bind, bind.runner)
        : nothing}
          ${bind.kind === "auto" && slot === "buildDebug"
        ? html`<span class="scope-section-hint">Falls back to the <strong>Debug</strong> slot.</span>`
        : bind.kind === "auto" && slot === "debug" && !d.separateBuildDebugProfile
          ? html`<span class="scope-section-hint">Uses runners.yaml defaults. Drives both Debug and Build&#8202;&amp;&#8202;Debug.</span>`
          : bind.kind === "auto"
            ? html`<span class="scope-section-hint">Uses runners.yaml defaults.</span>`
            : bind.kind === "launch" && launchConfigNames.length === 0 && !syntheticLaunch
              ? html`<span class="no-launch-warning">No launch.json configs detected.</span>`
              : bind.kind === "cortex-debug"
                ? html`<span class="scope-section-hint">elf, gdb, and target auto-resolved from runners.yaml. RTT and probe selections are structured fields applied on top.</span>`
                : bind.kind === "west-debug"
                  ? html`<span class="scope-section-hint">Always uses <code>west debugserver</code> bridge — connects cortex-debug as external GDB server.</span>`
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
      label: "Interface / Probe",
      hint: "OpenOCD interface config. Leave blank if runners.yaml already specifies one.",
      required: false,
      placeholder: "runners.yaml / auto-detect",
      options: [
        { value: "interface/stlink.cfg", label: "ST-LINK v2/v3", description: "Most common for STM32 / nRF52 with SWD" },
        { value: "interface/cmsis-dap.cfg", label: "CMSIS-DAP", description: "DAPLink, ULINK2, MCU-Link, …" },
        { value: "interface/jlink.cfg", label: "SEGGER J-Link", description: "J-Link via OpenOCD" },
        { value: "interface/ftdi.cfg", label: "FTDI", description: "FTDI-based probe (generic)" },
        { value: "interface/picoprobe.cfg", label: "Raspberry Pi Pico (probe)", description: "RP2040 Pico used as SWD/JTAG probe" },
        { value: "interface/raspberrypi-swd.cfg", label: "Raspberry Pi GPIO SWD", description: "Bit-banged SWD via RPi GPIO" },
        { value: "interface/buspirate.cfg", label: "Bus Pirate", description: "Bus Pirate USB probe" },
      ],
    },
  ],
  pyocd: [
    {
      label: "Probe / Interface",
      hint: "pyOCD probe selection. Specify the probe type or leave blank to auto-detect the first available.",
      required: true,
      placeholder: "— select probe (required) —",
      options: [
        { value: "cmsis_dap", label: "CMSIS-DAP (generic)", description: "Any CMSIS-DAP probe — DAPLink, MCU-Link, ULINK2, …" },
        { value: "stlink", label: "ST-Link (v2/v3)", description: "STMicroelectronics ST-Link v2 or v3 (libusb)" },
        { value: "jlink", label: "SEGGER J-Link", description: "First J-Link probe (requires pyocd-jlink plugin)" },
        { value: "picoprobe", label: "Raspberry Pi Pico (picoprobe)", description: "RP2040 Pico running picoprobe firmware" },
        { value: "xds110", label: "TI XDS110", description: "Texas Instruments XDS110 debug probe" },
        { value: "cmsisdap", label: "cmsisdap (alternate ID)", description: "Alternate CMSIS-DAP probe ID for some targets" },
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
