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

interface BlobModuleInfo {
  moduleName: string;
  isFetched: boolean;
  path?: string;
}

interface SampleProjectInfo {
  name: string;
  rel_path: string;
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

  private _toggleBlob(moduleName: string) {
    const next = new Set(this._selectedBlobs);
    if (next.has(moduleName)) {
      next.delete(moduleName);
    } else {
      next.add(moduleName);
    }
    this._selectedBlobs = next;
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

  render() {
    if (!this._data) {
      return html`<div class="container"><p>Loading…</p></div>`;
    }

    const fetchedCount = this._blobModules.filter(m => m.isFetched).length;
    const selectedCount = this._selectedBlobs.size;

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
                <vscode-button appearance="secondary" @click=${() => this.postCommand("modifyBlobs")}>Modify JSON List</vscode-button>
                <vscode-button appearance="secondary" @click=${() => this.postCommand("installBlobsFromJson")}>Install from JSON</vscode-button>
                <vscode-button ?disabled=${selectedCount === 0 || this._blobInstalling} @click=${() => this._installSelectedBlobs()}>
                  Fetch Selected (${selectedCount})
                </vscode-button>
              </div>
            </div>
            <p class="manager-subtext">Fetched: ${fetchedCount} / ${this._blobModules.length}</p>
            ${this._blobLoading
              ? html`<div class="inline-status"><vscode-progress-ring></vscode-progress-ring><span>Loading blob modules…</span></div>`
              : this._blobModules.length > 0
                ? html`<div class="blob-chip-list">${this._blobModules.map(m => {
                  const selected = this._selectedBlobs.has(m.moduleName);
                  const classes = `blob-chip ${m.isFetched ? "fetched" : selected ? "selected" : ""}`;
                  return html`
                    <button
                      class=${classes}
                      ?disabled=${m.isFetched || this._blobInstalling}
                      @click=${() => this._toggleBlob(m.moduleName)}
                      title=${m.path ?? m.moduleName}
                    >
                      ${m.moduleName}
                    </button>
                  `;
                })}</div>`
                : html`<div class="info-box">No west blob modules discovered. Run west update and refresh.</div>`}
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
              ? html`<div class="token-list">${this._data.sampleProjects.map(p => html`<span class="token warning">${p.name}: ${p.rel_path}</span>`)}</div>`
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
