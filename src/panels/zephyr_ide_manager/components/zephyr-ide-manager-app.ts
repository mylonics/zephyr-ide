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

import { moduleMatcher, moduleSearchBox } from "../../webview_shared/module-search";
import { repeat } from "lit/directives/repeat.js";
import { changeSelection, westSelectionPane, westSelectionToolbar } from "../../webview_shared/west-selection";
import { live } from "lit/directives/live.js";
import { panelText } from "../../webview_shared/panel-text";
import { html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { ZephyrLitElement } from "../../webview_shared/lit-base";

interface BlobModuleInfo {
  moduleName: string;
  isFetched: boolean;
  path?: string;
}

interface SampleProjectInfo {
  name: string;
  relPath: string;
}

interface ZephyrIdeCommandsInfo {
  linux?: string[];
  windows?: string[];
  mac?: string[];
}

interface ManagerData {
  toolchains: string[];
  blobs: string[];
  pipPackages: string[];
  pipRequirements: string[];
  sampleProjects: SampleProjectInfo[];
  commands: ZephyrIdeCommandsInfo;
}

@customElement("zephyr-ide-manager-app")
export class ZephyrIDEManagerApp extends ZephyrLitElement {
  @state() private _data: ManagerData | undefined;
  @state() private _blobModules: BlobModuleInfo[] = [];
  @state() private blobQuery = "";
  @state() private blobRegex = false;
  @state() private _blobLoading = false;
  @state() private _selectedBlobs = new Set<string>();
  @state() private _blobInstalling = false;
  @state() private _blobProgress = "";

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("message", this._onMessage);
    this.postCommand("ready");
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("message", this._onMessage);
  }

  private _onMessage = (event: MessageEvent) => {
    const msg = event.data;
    switch (msg.command) {
      case "updateContent":
        this._data = msg.data;
        break;
      case "blobListLoading":
        this._blobLoading = true;
        break;
      case "blobListResult":
        this._blobLoading = false;
        this._blobModules = Array.isArray(msg.data) ? msg.data : [];
        this._selectedBlobs = new Set(Array.from(this._selectedBlobs).filter(s => this._blobModules.some(m => m.moduleName === s && !m.isFetched)));
        break;
      case "blobInstallProgress":
        this._blobProgress = String(msg.data ?? "");
        break;
      case "blobInstallResult":
        this._blobInstalling = false;
        this._selectedBlobs = new Set();
        this._blobProgress = msg.data ? "Blob installation completed." : "Blob installation failed.";
        break;
    }
  };

  private _refresh() {
    this._blobLoading = true;
    this.postCommand("refresh");
  }

  private _installSelectedBlobs() {
    const modules = Array.from(this._selectedBlobs);
    if (modules.length === 0) { return; }
    this._blobInstalling = true;
    this._blobProgress = "";
    this.vscodeApi.postMessage({ command: "installBlobModules", modules });
  }

  private _renderCommandsSection(commands: ZephyrIdeCommandsInfo) {
    const platforms: Array<{ key: keyof ZephyrIdeCommandsInfo; label: string }> = [
      { key: "linux", label: "Linux" },
      { key: "windows", label: "Windows" },
      { key: "mac", label: "macOS" },
    ];
    const hasAny = platforms.some(p => (commands[p.key]?.length ?? 0) > 0);
    if (!hasAny) {
      return html`<div class="info-box">No commands declared in zephyr-ide.json.</div>`;
    }
    return html`
      ${platforms.map(({ key, label }) => {
        const cmds = commands[key];
        if (!cmds || cmds.length === 0) { return html``; }
        return html`
          <div class="commands-platform">
            <span class="commands-platform-label">${label}</span>
            <div class="token-list">
              ${cmds.map(cmd => html`
                <button
                  class="command-chip"
                  title="Run this command"
                  @click=${() => this.postCommand("runSingleCommand", { platform: String(key), commandText: cmd })}
                >
                  ${cmd}
                </button>
              `)}
            </div>
          </div>
        `;
      })}
    `;
  }

  private blobRows(modules: BlobModuleInfo[], empty = "") {
    if (!modules.length) { return html`<p class="wp-empty">${empty}</p>`; }
    return html`${repeat(modules, m => m.moduleName, m => html`
      <label class="blob-row west-choice" title=${m.path ?? m.moduleName}>
        <input type="checkbox" .checked=${live(this._selectedBlobs.has(m.moduleName) || m.isFetched)}
          aria-label=${m.isFetched ? panelText("{0} (fetched)", m.moduleName) : m.moduleName}
          ?disabled=${m.isFetched || this._blobInstalling}
          @change=${() => { this._selectedBlobs = changeSelection(this._selectedBlobs, [m.moduleName], "invert"); }}>
        <span><strong>${m.moduleName}</strong>${m.path ? html`<small>${m.path}</small>` : nothing}</span>
      </label>`)}`;
  }

  render() {
    if (!this._data) {
      return html`<div class="container"><p>Loading…</p></div>`;
    }

    const fetchedCount = this._blobModules.filter(m => m.isFetched).length;
    const selectedCount = this._selectedBlobs.size;
    const { matches, invalid } = moduleMatcher(this.blobQuery, this.blobRegex);
    const modules = [...this._blobModules].sort((a, b) => a.moduleName.localeCompare(b.moduleName, "en"));
    const pathQuery = this.blobQuery.trim().toLowerCase();
    const matched = modules.filter(m => matches(m.moduleName) ||
      (!this.blobRegex && pathQuery.includes("/") && m.path?.toLowerCase().includes(pathQuery)));
    const actionable = matched.filter(m => !m.isFetched);
    const pending = actionable.filter(m => !this._selectedBlobs.has(m.moduleName));
    const selected = modules.filter(m => this._selectedBlobs.has(m.moduleName));
    const fetched = matched.filter(m => m.isFetched);

    return html`
      <div class="container">
        <div class="breadcrumb">
          <a class="breadcrumb-link" @click=${() => this.postCommand("openSetupPanel")}>← Setup & Configuration</a>
          <span class="breadcrumb-separator">/</span>
          <span class="breadcrumb-current">Zephyr IDE Manager</span>
        </div>

        <div class="page-header">
          <h1 class="page-title">Zephyr IDE Manager</h1>
          <div class="header-actions">
            <vscode-button appearance="secondary" @click=${() => this.postCommand("openSdkPanel")}>
              <vscode-icon slot="start-icon" name="tools"></vscode-icon>
              Open SDK Panel
            </vscode-button>
            <vscode-button appearance="secondary" @click=${() => this._refresh()}>
              <vscode-icon slot="start-icon" name="refresh"></vscode-icon>
              Refresh
            </vscode-button>
          </div>
        </div>

        <p class="manager-subtext">
          Manage zephyr-ide.json requirements and install workflows for toolchains, west blobs, Python packages,
          host tools, and sample projects in one place.
        </p>

        <div class="manager-grid">
          <section class="manager-card">
            <div class="manager-card-header">
              <h2 class="manager-title">SDK Toolchains</h2>
              <div class="manager-actions">
                <vscode-button appearance="secondary" @click=${() => this.postCommand("modifyToolchains")}>Modify</vscode-button>
                <vscode-button @click=${() => this.postCommand("installToolchains")}>Install</vscode-button>
              </div>
            </div>
            ${this._data.toolchains.length > 0
              ? html`<div class="token-list">${this._data.toolchains.map(t => html`<span class="token">${t}</span>`)}</div>`
              : html`<div class="info-box">No toolchains declared in zephyr-ide.json.</div>`}
          </section>

          <section class="manager-card">
            <div class="manager-card-header">
              <h2 class="manager-title">Pip Packages &amp; Requirements</h2>
              <div class="manager-actions">
                <vscode-button appearance="secondary" @click=${() => this.postCommand("modifyPipPackages")}>Modify Packages</vscode-button>
                <vscode-button appearance="secondary" @click=${() => this.postCommand("modifyPipRequirements")}>Modify Requirements</vscode-button>
                <vscode-button @click=${() => this.postCommand("installPipPackages")}>Install All</vscode-button>
              </div>
            </div>
            ${this._data.pipPackages.length > 0
              ? html`<div class="token-list">${this._data.pipPackages.map(p => html`<span class="token">${p}</span>`)}</div>`
              : html`<div class="info-box">No pip packages declared in zephyr-ide.json.</div>`}
            ${this._data.pipRequirements.length > 0
              ? html`<div class="token-list">${this._data.pipRequirements.map(r => html`<span class="token">${r}</span>`)}</div>`
              : html`<div class="info-box">No requirements files declared in zephyr-ide.json.</div>`}
          </section>

          <section class="manager-card full-width">
            <div class="manager-card-header">
              <h2 class="manager-title">West Blobs</h2>
              <div class="manager-actions">
                <vscode-button secondary @click=${() => this.postCommand("modifyBlobs")}>${panelText("Modify JSON List")}</vscode-button>
                <vscode-button secondary @click=${() => this.postCommand("installBlobsFromJson")}>${panelText("Install from JSON")}</vscode-button>
                <vscode-button ?disabled=${selectedCount === 0 || this._blobInstalling} @click=${() => this._installSelectedBlobs()}>
                  Fetch Selected (${selectedCount})
                </vscode-button>
              </div>
            </div>
            <p class="manager-subtext">Fetched: ${fetchedCount} / ${this._blobModules.length}</p>
            ${this._blobLoading
              ? html`<div class="inline-status"><vscode-progress-ring></vscode-progress-ring><span>Loading blob modules…</span></div>`
              : this._blobModules.length > 0
                ? html`${moduleSearchBox(this.blobQuery, this.blobRegex, value => { this.blobQuery = value; }, () => { this.blobRegex = !this.blobRegex; })}
                  ${invalid ? html`<p role="alert">${panelText("Invalid regular expression")}</p>` : nothing}
                  ${westSelectionToolbar(this._blobInstalling || !actionable.length, action => {
                    this._selectedBlobs = changeSelection(this._selectedBlobs, actionable.map(m => m.moduleName), action);
                  })}
                  <div class="west-panes">
                    ${westSelectionPane("blob-selected-title", panelText("Selected modules"), selected.length,
                      this.blobRows(selected, panelText("No modules selected")))}
                    ${westSelectionPane("blob-available-title", panelText("Available modules"), pending.length,
                      this.blobRows(pending, panelText("No available modules")))}
                    ${fetched.length ? westSelectionPane("blob-fetched-title", panelText("Fetched modules"), fetched.length,
                      this.blobRows(fetched)) : nothing}
                  </div>`
                : html`<div class="info-box">${panelText("No west blob modules discovered. Run west update and refresh.")}</div>`}
            ${this._blobProgress ? html`<div class="inline-status">${this._blobInstalling ? html`<vscode-progress-ring></vscode-progress-ring>` : nothing}<span>${this._blobProgress}</span></div>` : nothing}
          </section>

          <section class="manager-card">
            <div class="manager-card-header">
              <h2 class="manager-title">Host/Vendor Tools</h2>
              <div class="manager-actions">
                <vscode-button @click=${() => this.postCommand("openHostToolsPanel")}>Open Host Tools</vscode-button>
              </div>
            </div>
            <p class="manager-subtext">Install platform package manager dependencies and vendor tools via the Host Tools workflow.</p>
          </section>

          <section class="manager-card">
            <div class="manager-card-header">
              <h2 class="manager-title">Sample Projects</h2>
              <div class="manager-actions">
                <vscode-button appearance="secondary" @click=${() => this.postCommand("modifySampleProjects")}>Modify</vscode-button>
              </div>
            </div>
            ${this._data.sampleProjects.length > 0
              ? html`<div class="token-list">${this._data.sampleProjects.map(p => html`<span class="token warning">${p.name}: ${p.relPath}</span>`)}</div>`
              : html`<div class="info-box">No sample projects declared in zephyr-ide.json.</div>`}
          </section>

          <section class="manager-card full-width">
            <div class="manager-card-header">
              <h2 class="manager-title">Terminal Commands</h2>
              <div class="manager-actions">
                <vscode-button appearance="secondary" @click=${() => this.postCommand("modifyCommands")}>Add/Modify/Delete</vscode-button>
                <vscode-button @click=${() => this.postCommand("runCommands")}>Run Commands</vscode-button>
              </div>
            </div>
            <p class="manager-subtext">Click an individual command to run it. Use Add/Modify/Delete to choose target OS and edit commands one at a time.</p>
            ${this._renderCommandsSection(this._data.commands)}
          </section>
        </div>
      </div>
    `;
  }
}
