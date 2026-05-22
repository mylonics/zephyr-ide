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

type Scope = "workspace" | "user";
type Slot = "flash" | "buildDebug" | "debug" | "attach";
type Bind = { kind: "auto" } | { kind: "launch"; name: string; workspaceFolder?: string };
interface Profile { name: string; flash: Bind; buildDebug?: Bind; debug: Bind; attach: Bind }
interface PanelState {
  userProfiles: Profile[];
  workspaceProfiles: Profile[];
  hasWorkspace: boolean;
  launchConfigNames: string[];
  activeProfileName?: string;
  activeBuildLabel?: string;
  usageByName: Record<string, string[]>;
  separateBuildDebugProfile: boolean;
}

const AUTO_BIND: Bind = { kind: "auto" };

@customElement("runner-profile-app")
export class RunnerProfileApp extends ZephyrLitElement {
  @state() private data: PanelState = {
    userProfiles: [],
    workspaceProfiles: [],
    hasWorkspace: false,
    launchConfigNames: [],
    usageByName: {},
    separateBuildDebugProfile: false,
  };
  @state() private editing: { scope: Scope; originalName: string; profile: Profile } | undefined;

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("message", this._onMessage);
    this.vscodeApi.postMessage({ command: "ready" });
  }

  disconnectedCallback() {
    window.removeEventListener("message", this._onMessage);
    super.disconnectedCallback();
  }

  private _onMessage = (event: MessageEvent) => {
    const msg = event.data;
    if (msg?.command !== "updateContent") { return; }
    this.data = msg.data as PanelState;
    if (this.editing) {
      const list = this.editing.scope === "workspace" ? this.data.workspaceProfiles : this.data.userProfiles;
      const updated = list.find(p => p.name === this.editing?.profile.name || p.name === this.editing?.originalName);
      if (updated) {
        this.editing = { ...this.editing, originalName: updated.name, profile: this._cloneProfile(updated) };
      }
    }
  };

  private _cloneBind(bind: Bind | undefined): Bind {
    if (!bind || bind.kind === "auto") { return { kind: "auto" }; }
    return { kind: "launch", name: bind.name, ...(bind.workspaceFolder ? { workspaceFolder: bind.workspaceFolder } : {}) };
  }

  private _cloneProfile(profile: Profile): Profile {
    return {
      name: profile.name,
      flash: this._cloneBind(profile.flash),
      ...(profile.buildDebug ? { buildDebug: this._cloneBind(profile.buildDebug) } : {}),
      debug: this._cloneBind(profile.debug),
      attach: this._cloneBind(profile.attach),
    };
  }

  private _beginEdit(scope: Scope, profile: Profile) {
    this.editing = { scope, originalName: profile.name, profile: this._cloneProfile(profile) };
  }

  private _saveEdit() {
    if (!this.editing) { return; }
    this.vscodeApi.postMessage({
      command: "saveProfile",
      scope: this.editing.scope,
      originalName: this.editing.originalName,
      profile: this.editing.profile,
    });
    this.editing = undefined;
  }

  private _setBind(slot: Slot, value: string) {
    if (!this.editing) { return; }
    const bind: Bind = value === "__auto__" ? { kind: "auto" } : { kind: "launch", name: value };
    this.editing = {
      ...this.editing,
      profile: { ...this.editing.profile, [slot]: bind },
    };
  }

  private _renderBindSelect(slot: Slot, label: string, bind: Bind | undefined) {
    const value = bind?.kind === "launch" ? bind.name : "__auto__";
    return html`
      <label class="profile-field">
        <span>${label}</span>
        <select .value=${value} @change=${(e: Event) => this._setBind(slot, (e.target as HTMLSelectElement).value)}>
          <option value="__auto__">Auto (runners.yaml)</option>
          ${this.data.launchConfigNames.map(name => html`<option value=${name}>launch.json: ${name}</option>`)}
        </select>
      </label>
    `;
  }

  private _renderEditor() {
    const edit = this.editing;
    if (!edit) { return nothing; }
    const p = edit.profile;
    return html`
      <section class="runner-profile-editor">
        <h2>Edit ${edit.scope} profile</h2>
        <label class="profile-field" for="runner-profile-name-input">
          <span>Name</span>
          <input id="runner-profile-name-input" aria-label="Profile name" .value=${p.name} @input=${(e: InputEvent) => {
        this.editing = { ...edit, profile: { ...p, name: (e.target as HTMLInputElement).value } };
      }} />
        </label>
        ${this._renderBindSelect("flash", "Flash", p.flash)}
        ${this.data.separateBuildDebugProfile ? this._renderBindSelect("buildDebug", "Build & Debug", p.buildDebug ?? p.debug) : nothing}
        ${this._renderBindSelect("debug", "Debug", p.debug)}
        ${this._renderBindSelect("attach", "Attach", p.attach)}
        <div class="profile-actions">
          <vscode-button appearance="primary" @click=${() => this._saveEdit()}>Save</vscode-button>
          <vscode-button appearance="secondary" @click=${() => { this.editing = undefined; }}>Cancel</vscode-button>
        </div>
      </section>
    `;
  }

  private _renderProfile(scope: Scope, profile: Profile) {
    const usage = this.data.usageByName[profile.name] ?? [];
    const active = profile.name === this.data.activeProfileName;
    return html`
      <div class="runner-profile-card ${active ? "active" : ""}">
        <div class="runner-card-header">
          <strong>${profile.name}</strong>
          ${active ? html`<span class="bind-override-badge">active</span>` : nothing}
        </div>
        <div class="runner-binds-grid">
          <span>Flash</span><span>${this._bindLabel(profile.flash)}</span>
          ${this.data.separateBuildDebugProfile ? html`<span>Build & Debug</span><span>${this._bindLabel(profile.buildDebug ?? profile.debug)}</span>` : nothing}
          <span>Debug</span><span>${this._bindLabel(profile.debug)}</span>
          <span>Attach</span><span>${this._bindLabel(profile.attach)}</span>
        </div>
        ${usage.length ? html`<p class="runner-level-hint">Used by ${usage.join(", ")}</p>` : nothing}
        <div class="profile-actions">
          <vscode-button appearance="secondary" @click=${() => this._beginEdit(scope, profile)}>Edit</vscode-button>
          <vscode-button appearance="secondary" @click=${() => this.vscodeApi.postMessage({ command: "duplicateProfile", scope, name: profile.name })}>Duplicate</vscode-button>
          <vscode-button appearance="secondary" @click=${() => this.vscodeApi.postMessage({ command: "setActiveProfile", name: profile.name })}>Use</vscode-button>
          <vscode-button appearance="secondary" @click=${() => this.vscodeApi.postMessage({ command: "deleteProfile", scope, name: profile.name })}>Delete</vscode-button>
        </div>
      </div>
    `;
  }

  private _bindLabel(bind: Bind | undefined): string {
    return bind?.kind === "launch" ? `launch.json: ${bind.name}` : "Auto (runners.yaml)";
  }

  private _renderScope(scope: Scope, profiles: Profile[]) {
    return html`
      <section>
        <div class="section-header">
          <h2>${scope === "workspace" ? "Workspace" : "User"} profiles</h2>
          <vscode-button appearance="secondary" ?disabled=${scope === "workspace" && !this.data.hasWorkspace}
            @click=${() => this.vscodeApi.postMessage({ command: "createProfile", scope })}>Create</vscode-button>
        </div>
        ${profiles.length ? profiles.map(p => this._renderProfile(scope, p)) : html`<p class="file-list-empty">No profiles.</p>`}
      </section>
    `;
  }

  render() {
    return html`
      <main class="runner-profile-view">
        <header class="panel-header">
          <h1>Runner Profiles</h1>
          <p>Profiles now point to launch.json entries. Edit runner arguments and cortex-debug fields directly in launch.json.</p>
          ${this.data.activeBuildLabel ? html`<p>Active build: ${this.data.activeBuildLabel}</p>` : nothing}
        </header>
        ${this._renderEditor()}
        ${this._renderScope("workspace", this.data.workspaceProfiles)}
        ${this._renderScope("user", this.data.userProfiles)}
      </main>
    `;
  }
}
