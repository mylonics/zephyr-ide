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

type BindKind = "auto" | "runner" | "launch";

interface ProfileBind {
  kind: BindKind;
  runner?: string;
  extraArgs?: string;
  name?: string; // launch.json configuration name
}

interface Profile {
  name: string;
  flash: ProfileBind;
  debug: ProfileBind;
  attach: ProfileBind;
}

type Scope = "user" | "workspace";

interface PanelData {
  userProfiles: Profile[];
  workspaceProfiles: Profile[];
  hasWorkspace: boolean;
  knownRunners: string[];
  launchConfigNames: string[];
  activeProfileName?: string;
  activeBuildLabel?: string;
  /** profile name -> list of "<project> / <build>" strings using it */
  usageByName?: Record<string, string[]>;
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
      // Drop drafts whose original profile no longer exists in the new payload.
      const seen = new Set<string>();
      for (const p of this._data.userProfiles) { seen.add(`user:${p.name}`); }
      for (const p of this._data.workspaceProfiles) { seen.add(`workspace:${p.name}`); }
      const next = new Map<string, Profile>();
      for (const [k, v] of this._drafts) {
        if (seen.has(k)) { next.set(k, v); }
      }
      this._drafts = next;
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

  // -- Field editors --

  private _onNameInput(scope: Scope, originalName: string, e: Event) {
    const value = stringFromEvent(e);
    this._updateDraft(scope, originalName, (p) => ({ ...p, name: value }));
  }

  private _onKindChange(
    scope: Scope, originalName: string,
    slot: "flash" | "debug" | "attach", e: Event,
  ) {
    const newKind = stringFromEvent(e) as BindKind;
    this._updateDraft(scope, originalName, (p) => {
      const nextBind: ProfileBind = newKind === "auto"
        ? { kind: "auto" }
        : newKind === "runner"
          ? { kind: "runner", runner: p[slot]?.runner || (this._data?.knownRunners[0] ?? "openocd"), extraArgs: "" }
          : { kind: "launch", name: p[slot]?.name || (this._data?.launchConfigNames[0] ?? "") };
      return { ...p, [slot]: nextBind };
    });
  }

  private _onRunnerChange(
    scope: Scope, originalName: string,
    slot: "flash" | "debug" | "attach", e: Event,
  ) {
    const value = stringFromEvent(e);
    this._updateDraft(scope, originalName, (p) => ({
      ...p, [slot]: { ...p[slot], kind: "runner", runner: value },
    }));
  }

  private _onExtraArgsInput(
    scope: Scope, originalName: string,
    slot: "flash" | "debug" | "attach", e: Event,
  ) {
    const value = stringFromEvent(e);
    this._updateDraft(scope, originalName, (p) => ({
      ...p, [slot]: { ...p[slot], kind: "runner", runner: p[slot].runner ?? "", extraArgs: value },
    }));
  }

  private _onLaunchNameChange(
    scope: Scope, originalName: string,
    slot: "debug" | "attach", e: Event,
  ) {
    const value = stringFromEvent(e);
    this._updateDraft(scope, originalName, (p) => ({
      ...p, [slot]: { kind: "launch", name: value },
    }));
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
              Reusable bundles of <strong>flash</strong>, <strong>debug</strong>, and <strong>attach</strong> binds.
              Workspace profiles live in <code>.vscode/zephyr-ide.json</code>; user profiles live in
              <code>zephyr-ide.runnerProfiles</code> settings. Workspace overrides user on name collision.
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
            ? html` &mdash; using profile <strong>${d.activeProfileName}</strong>`
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
      <div class="profile-card ${isActive ? "active" : ""}">
        <div class="profile-card-header">
          <vscode-textfield class="profile-card-name"
            .value=${draft.name}
            placeholder="Profile name"
            @vsc-change=${(e: Event) => this._onNameInput(scope, original.name, e)}
            @vsc-input=${(e: Event) => this._onNameInput(scope, original.name, e)}>
          </vscode-textfield>
          ${isActive ? html`<span class="profile-active-badge" title="Active profile for the current build"><i class="codicon codicon-pin"></i> active</span>` : nothing}
          ${usage.length > 0
        ? html`<span class="profile-usage-badge"
              title=${`Used by ${usage.length} build${usage.length === 1 ? "" : "s"}:\n${usage.join("\n")}`}>
              <i class="codicon codicon-link"></i> ${usage.length}
            </span>`
        : nothing}
        </div>

        <div class="profile-slot-grid">
          ${this._renderSlot(scope, original.name, draft, "flash", "zap")}
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
          <vscode-button appearance="icon" icon="trash" title="Delete profile"
            @click=${() => this._onDelete(scope, original.name)}>
          </vscode-button>
        </div>
      </div>
    `;
  }

  private _renderSlot(
    scope: Scope, originalName: string, draft: Profile,
    slot: "flash" | "debug" | "attach", icon: string,
  ) {
    const bind = draft[slot];
    const label = slot.charAt(0).toUpperCase() + slot.slice(1);
    const allowLaunch = slot !== "flash";

    return html`
      <div class="profile-slot-label">
        <i class="codicon codicon-${icon}"></i> ${label}
      </div>
      <vscode-single-select
        .value=${bind.kind}
        @vsc-change=${(e: Event) => this._onKindChange(scope, originalName, slot, e)}>
        <vscode-option value="auto" ?selected=${bind.kind === "auto"}>Auto (runners.yaml)</vscode-option>
        <vscode-option value="runner" ?selected=${bind.kind === "runner"}>Runner</vscode-option>
        ${allowLaunch ? html`<vscode-option value="launch" ?selected=${bind.kind === "launch"}>launch.json</vscode-option>` : nothing}
      </vscode-single-select>
      <div class="profile-slot-payload">
        ${this._renderSlotPayload(scope, originalName, slot, bind)}
      </div>
    `;
  }

  private _renderSlotPayload(
    scope: Scope, originalName: string,
    slot: "flash" | "debug" | "attach", bind: ProfileBind,
  ) {
    const d = this._data!;
    if (bind.kind === "auto") {
      return html`<span class="scope-section-hint">Uses runners.yaml defaults.</span>`;
    }
    if (bind.kind === "runner") {
      const knownRunners = d.knownRunners.length > 0 ? d.knownRunners : [bind.runner ?? "openocd"];
      const currentRunner = bind.runner ?? knownRunners[0];
      return html`
        <vscode-single-select
          .value=${currentRunner}
          @vsc-change=${(e: Event) => this._onRunnerChange(scope, originalName, slot, e)}>
          ${knownRunners.map(r => html`<vscode-option value=${r} ?selected=${r === currentRunner}>${r}</vscode-option>`)}
        </vscode-single-select>
        <vscode-textfield
          .value=${bind.extraArgs ?? ""}
          placeholder="extra args (optional)"
          @vsc-change=${(e: Event) => this._onExtraArgsInput(scope, originalName, slot, e)}
          @vsc-input=${(e: Event) => this._onExtraArgsInput(scope, originalName, slot, e)}>
        </vscode-textfield>
      `;
    }
    // launch
    if (slot === "flash") {
      // shouldn't happen — guarded by select options — but render auto fallback
      return html`<span class="scope-section-hint">launch.json is invalid for flash.</span>`;
    }
    if (d.launchConfigNames.length === 0) {
      return html`
        <vscode-textfield
          .value=${bind.name ?? ""}
          placeholder="launch.json config name"
          @vsc-change=${(e: Event) => this._onLaunchNameChange(scope, originalName, slot as "debug" | "attach", e)}
          @vsc-input=${(e: Event) => this._onLaunchNameChange(scope, originalName, slot as "debug" | "attach", e)}>
        </vscode-textfield>
        <span class="no-launch-warning">No launch.json configs detected.</span>
      `;
    }
    return html`
      <vscode-single-select
        .value=${bind.name ?? d.launchConfigNames[0]}
        @vsc-change=${(e: Event) => this._onLaunchNameChange(scope, originalName, slot as "debug" | "attach", e)}>
        ${d.launchConfigNames.map(n => html`<vscode-option value=${n} ?selected=${n === bind.name}>${n}</vscode-option>`)}
      </vscode-single-select>
    `;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stringFromEvent(e: Event): string {
  const target = e.target as { value?: unknown } | null;
  if (target && typeof target.value === "string") { return target.value; }
  return "";
}

function cloneProfile(p: Profile): Profile {
  return {
    name: p.name,
    flash: { ...p.flash },
    debug: { ...p.debug },
    attach: { ...p.attach },
  };
}

function bindsEqual(a: ProfileBind, b: ProfileBind): boolean {
  if (a.kind !== b.kind) { return false; }
  if (a.kind === "auto") { return true; }
  if (a.kind === "runner") {
    return (a.runner ?? "") === (b.runner ?? "")
      && (a.extraArgs ?? "") === (b.extraArgs ?? "");
  }
  return (a.name ?? "") === (b.name ?? "");
}

function profilesEqual(a: Profile, b: Profile): boolean {
  return a.name === b.name
    && bindsEqual(a.flash, b.flash)
    && bindsEqual(a.debug, b.debug)
    && bindsEqual(a.attach, b.attach);
}
