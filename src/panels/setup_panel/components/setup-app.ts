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
import type {
  SetupPanelData,
  ActiveWorkspaceData,
  WorkspaceListItem,
  ProjectListItem,
} from "../setup-panel-data";

@customElement("setup-app")
export class SetupApp extends ZephyrLitElement {
  @state() private _data: SetupPanelData | undefined;
  // Tracks paths/project names with an in-flight destructive action so the
  // matching row can disable its trash button until the extension responds
  // (modal resolved + state refresh sent back).
  @state() private _pendingWorkspaceDeletes = new Set<string>();
  @state() private _pendingProjectRemoves = new Set<string>();
  @state() private _statusAnnouncement = "";

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
    if (msg.command === "updateContent" && msg.data) {
      this._data = msg.data;
      this._statusAnnouncement = "Overview updated";
      // A fresh data snapshot means any in-flight destructive action has
      // resolved (success or cancel) — clear pending markers so rows reset.
      if (this._pendingWorkspaceDeletes.size) { this._pendingWorkspaceDeletes = new Set(); }
      if (this._pendingProjectRemoves.size) { this._pendingProjectRemoves = new Set(); }
    }
  };

  private _cmd(command: string) {
    this.postCommand(command);
  }

  private _deleteWorkspace(path: string, name: string) {
    if (this._pendingWorkspaceDeletes.has(path)) { return; }
    this._pendingWorkspaceDeletes = new Set(this._pendingWorkspaceDeletes).add(path);
    this.vscodeApi.postMessage({ command: "deleteWorkspace", path, name });
  }

  private _reconfigureWorkspace(path: string) {
    this.vscodeApi.postMessage({ command: "reconfigureWorkspace", path });
  }

  private _removeProject(name: string) {
    if (this._pendingProjectRemoves.has(name)) { return; }
    this._pendingProjectRemoves = new Set(this._pendingProjectRemoves).add(name);
    this.vscodeApi.postMessage({ command: "removeProject", name });
  }

  private _openWorkspacePanelForPath(path: string) {
    this.vscodeApi.postMessage({ command: "openWorkspacePanelForPath", path });
  }

  private _deactivateWorkspace() {
    this.vscodeApi.postMessage({ command: "deactivateWorkspace" });
  }

  private _handleKeyboard = (e: KeyboardEvent) => {
    const isSpace = e.code === "Space" || e.key === " ";
    if (e.key !== "Enter" && !isSpace) { return; }
    const target = e.target;
    if (!(target instanceof HTMLElement)) { return; }
    const el = target.closest("[data-keyboard-command]");
    if (!(el instanceof HTMLElement)) { return; }
    if (isSpace) { e.preventDefault(); }
    el.click();
  };

  render() {
    if (!this._data) {
      return html`<div class="panel-container"><p>Loading…</p></div>`;
    }

    const d = this._data;
    const hasActiveWorkspace = d.activeWorkspace !== undefined;
    const environmentReady = d.toolsReady && d.sdkReady && d.workspaceInitialized;
    // Show workspace list when no workspace is active but known workspaces exist
    const promoteWorkspaceList = !hasActiveWorkspace && d.hasWorkspaces;

    return html`
      <div class="panel-container" @keydown=${this._handleKeyboard}>
        <div class="sr-only" role="status" aria-live="polite">${this._statusAnnouncement}</div>
        <div class="overview-section">
          <div class="walkthrough-header page-header">
            <div>
              <h1 class="walkthrough-title page-title">Zephyr IDE Overview</h1>
              <p class="walkthrough-subtitle page-subtitle">Your development environment at a glance</p>
            </div>
          </div>

          ${this._renderReadinessBanner(d)}

          ${!environmentReady ? html`<div class="setup-main-layout">${this._renderSetupSteps(d, promoteWorkspaceList)}</div>` : nothing}

          ${this._renderActiveWorkspaceHero(d.activeWorkspace)}

          ${promoteWorkspaceList ? this._renderWorkspaceList(d) : nothing}

          ${this._renderProjectList(d)}

          ${this._renderQuickActions(d)}

          ${!promoteWorkspaceList ? this._renderWorkspaceList(d) : nothing}

          <div class="docs-links-row">
            <a href="https://zephyr-ide.mylonics.com" class="external-link" target="_blank" rel="noopener noreferrer">📖 Documentation</a>
            <a href="https://docs.zephyrproject.org/latest/develop/getting_started/index.html" class="external-link" target="_blank" rel="noopener noreferrer">🚀 Getting Started</a>
            <a href="https://docs.zephyrproject.org/latest/develop/west/index.html" class="external-link" target="_blank" rel="noopener noreferrer">🔧 West Docs</a>
            <a href="https://github.com/mylonics/zephyr-ide/issues" class="external-link" target="_blank" rel="noopener noreferrer">💬 Get Help</a>
          </div>
        </div>
      </div>
    `;
  }

  // ---------------------------------------------------------------------------
  // Readiness banner
  // ---------------------------------------------------------------------------

  private _renderReadinessBanner(d: SetupPanelData) {
    const completedCount = [d.toolsReady, d.workspaceInitialized, d.sdkReady].filter(Boolean).length;

    if (completedCount === 3) {
      return html`
        <div class="status-banner status-success">
          <span class="codicon codicon-check"></span>
          <span>Environment Ready — Host tools, workspace, and SDK are configured.</span>
        </div>`;
    }

    const remaining = 3 - completedCount;
    const parts: string[] = [];
    if (!d.toolsReady) { parts.push("set up Host Tools"); }
    if (!d.workspaceInitialized) {
      parts.push(d.activeWorkspace ? "initialize Workspace" : "select a Workspace");
    }
    if (!d.sdkReady) { parts.push("install SDK"); }
    if (parts.length > 0) {
      parts[0] = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
    }

    return html`
      <div class="status-banner status-warning">
        <span class="codicon codicon-warning"></span>
        <span>${remaining} of 3 step${remaining > 1 ? "s" : ""} remaining — ${parts.join(", ")} to start building.</span>
      </div>`;
  }

  // ---------------------------------------------------------------------------
  // Setup steps (cards / pills)
  // ---------------------------------------------------------------------------

  private _renderSetupSteps(d: SetupPanelData, skipWorkspaceCard: boolean) {
    let stepNumber = 1;
    const hostToolsStep = d.toolsReady ? 0 : stepNumber++;
    // Skip workspace card when there's an active workspace (hero handles it)
    // or when skipWorkspaceCard is set (workspace list promoted)
    const skipWs = d.workspaceInitialized || d.activeWorkspace !== undefined || skipWorkspaceCard;
    const workspaceStep = skipWs ? 0 : stepNumber++;
    const sdkStep = d.sdkReady ? 0 : stepNumber++;

    const pills: unknown[] = [];
    const cards: unknown[] = [];

    // Host tools
    if (d.toolsReady) {
      pills.push(this._renderPill("Host Tools", "openHostToolsPanel"));
    } else {
      cards.push(this._renderSetupCard("🔧", "Host Tools", "⚠ Setup Required", "status-warning",
        "Install and verify build tools, compilers, and utilities required for Zephyr development.",
        "openHostToolsPanel", hostToolsStep, false));
    }

    // Workspace
    if (!skipWs) {
      const command = d.folderOpen ? "openWorkspacePanel" : "openFolder";
      const title = d.folderOpen ? "West Workspace" : "Open Folder";
      const desc = d.folderOpen
        ? "Set up a west workspace to initialize your Zephyr development environment."
        : "Open a folder to get started with Zephyr development.";
      const statusText = d.folderOpen ? "Setup Required" : "No Folder Open";
      cards.push(this._renderSetupCard("📁", title, statusText, "status-warning", desc, command, workspaceStep, false));
    }

    // SDK
    if (d.sdkReady) {
      pills.push(this._renderPill("Zephyr SDK", "openSDKPanel"));
    } else {
      const isLocked = !d.hasValidSetupState;
      const status = isLocked ? "Workspace Required" : "Setup Required";
      cards.push(this._renderSetupCard("📦", "Zephyr SDK Management", status, "status-warning",
        "Install and manage Zephyr SDK for different architectures and toolchains. Requires west workspace.",
        isLocked ? "" : "openSDKPanel", sdkStep, isLocked));
    }

    if (d.toolsReady && d.workspaceInitialized && d.sdkReady) {
      return html`<div class="setup-status-pills">${pills}</div>`;
    }

    return html`
      ${pills.length > 0 ? html`<div class="setup-status-pills">${pills}</div>` : nothing}
      ${cards.length > 0 ? html`<div class="overview-cards">${cards}</div>` : nothing}
    `;
  }

  private _renderPill(label: string, command: string) {
    return html`
      <span class="setup-status-pill status-success" @click=${() => this._cmd(command)} role="button" tabindex="0" data-keyboard-command="true" title="${label} installed and ready">
        <span class="codicon codicon-check"></span> ${label}
      </span>`;
  }

  private _renderSetupCard(icon: string, title: string, status: string, statusClass: string, description: string, command: string, stepNumber: number, locked: boolean) {
    const stepBadgeClass = locked ? "step-badge-locked" : "step-badge-active";
    const ariaLabel = locked
      ? `${title} (disabled): ${status}`
      : `Open ${title}`;
    return html`
      <div class="overview-card${locked ? " overview-card-locked" : ""}"
        @click=${command ? () => this._cmd(command) : undefined}
        role="button" tabindex="${locked ? "-1" : "0"}"
        ?aria-disabled=${locked} data-keyboard-command="true" aria-label=${ariaLabel}>
        <div class="overview-card-header">
          <span class="step-badge ${stepBadgeClass}">${stepNumber}</span>
          <span class="overview-icon">${icon}</span>
          <h3>${title}</h3>
        </div>
        <div class="status ${statusClass}">${status}</div>
        <p class="overview-description">${description}</p>
        <div class="card-arrow">→</div>
      </div>`;
  }

  // ---------------------------------------------------------------------------
  // Active workspace hero
  // ---------------------------------------------------------------------------

  private _renderActiveWorkspaceHero(ws: ActiveWorkspaceData | undefined) {
    if (!ws) { return nothing; }

    const statusBadge = ws.isInitialized
      ? html`<span class="workspace-active-badge">Active</span>`
      : html`<span class="workspace-active-badge status-warning">Setup Required</span>`;

    return html`
      <div class="active-workspace-hero" @click=${() => this._openWorkspacePanelForPath(ws.path)} role="button" tabindex="0" data-keyboard-command="true" aria-label="Open active workspace ${ws.name}">
        <div class="hero-info">
          <div class="hero-title-row">
            <span class="codicon codicon-root-folder-opened"></span>
            <h2 class="hero-workspace-name">${ws.name}</h2>
            ${statusBadge}
          </div>
          ${ws.version ? html`<span class="hero-version">Zephyr ${ws.version}</span>` : nothing}
          <span class="hero-path">${ws.path}</span>
          <div class="hero-status-badges">
            ${ws.hasPythonEnv ? html`<span class="hero-status-badge status-success">venv</span>` : nothing}
            ${ws.hasWestUpdated ? html`<span class="hero-status-badge status-success">west</span>` : nothing}
            ${ws.hasSdk ? html`<span class="hero-status-badge status-success">SDK</span>` : nothing}
          </div>
        </div>
        <div class="hero-actions">
          <vscode-button appearance="secondary" @click=${(e: Event) => { e.stopPropagation(); this._deactivateWorkspace(); }}>Deactivate Workspace</vscode-button>
        </div>
      </div>`;
  }

  // ---------------------------------------------------------------------------
  // Workspace list
  // ---------------------------------------------------------------------------

  private _renderWorkspaceList(d: SetupPanelData) {
    const showEmptyState = !d.hasWorkspaces;

    // Derive header status
    let status: string, headerStatusClass: string;
    if (d.workspaceInitialized) {
      status = "✓ Initialized"; headerStatusClass = "status-success";
    } else if (d.activeWorkspace) {
      status = "Setup Required"; headerStatusClass = "status-warning";
    } else if (d.hasWorkspaces) {
      status = "Activate Workspace"; headerStatusClass = "status-warning";
    } else if (d.folderOpen) {
      status = "Setup Workspace"; headerStatusClass = "status-warning";
    } else {
      status = "No Folder"; headerStatusClass = "status-info";
    }

    // The "New Workspace" button is always available from the workspace list
    // header so users can create/add a workspace at any time.
    const headerActions = html`
      <span class="status ${headerStatusClass}">${status}</span>
      <vscode-button appearance="secondary" @click=${() => this._cmd("createNewWestWorkspace")}>New Workspace</vscode-button>
    `;

    if (showEmptyState) {
      return html`
        <div class="workspace-list-section">
          <div class="section-header-row">
            <h3>West Workspaces</h3>
            <div class="section-header-actions">${headerActions}</div>
          </div>
          <div class="empty-state">
            <div class="empty-state-icon">📁</div>
            <h3>No Workspaces Yet</h3>
            <p>Set up a west workspace to get started with Zephyr development.</p>
            <vscode-button @click=${() => this._cmd("openWorkspacePanel")}>Set Up Workspace</vscode-button>
          </div>
        </div>`;
    }

    // When the active workspace already appears in the hero, omit it from
    // this list to avoid showing the same workspace twice on the same page.
    const visibleWorkspaces = d.activeWorkspace
      ? d.workspaces.filter(ws => !ws.isActive)
      : d.workspaces;

    if (visibleWorkspaces.length === 0) {
      // All workspaces represented by the hero — render header only with a
      // short hint instead of an empty container.
      return html`
        <div class="workspace-list-section">
          <div class="section-header-row">
            <h3>Other West Workspaces</h3>
            <div class="section-header-actions">${headerActions}</div>
          </div>
          <p class="description muted" style="margin: 8px 0 0 0;">No additional workspaces registered.</p>
        </div>`;
    }

    return html`
      <div class="workspace-list-section">
        <div class="section-header-row">
          <h3>${d.activeWorkspace ? 'Other West Workspaces' : 'West Workspaces'}</h3>
          <div class="section-header-actions">${headerActions}</div>
        </div>
        <div class="overview-scroll-container">
          <div class="workspace-list-container">
            ${visibleWorkspaces.map(ws => this._renderWorkspaceRow(ws))}
          </div>
        </div>
      </div>`;
  }

  private _renderWorkspaceRow(ws: WorkspaceListItem) {
    const pendingDelete = this._pendingWorkspaceDeletes.has(ws.path);
    return html`
      <div class="workspace-list-row${ws.isActive ? " active" : ""}" @click=${() => this._openWorkspacePanelForPath(ws.path)} role="button" tabindex="0" data-keyboard-command="true" aria-label="Open workspace ${ws.name}">
        <div class="workspace-list-info">
          <div class="workspace-list-name">
            <span class="codicon codicon-root-folder"></span>
            <strong>${ws.name}</strong>
            ${ws.isActive ? html`<span class="workspace-active-badge">Active</span>` : nothing}
          </div>
          <div class="workspace-list-detail">
            <span class="workspace-list-description">${ws.description}</span>
            <span class="workspace-list-path" title=${ws.path}>${ws.path}</span>
            <span class="workspace-list-statuses">
              ${ws.hasPythonEnv ? html`<span class="workspace-status-icon status-success" title="Python environment ready">venv</span>` : nothing}
              ${ws.hasWestUpdated ? html`<span class="workspace-status-icon status-success" title="West updated">west</span>` : nothing}
            </span>
          </div>
        </div>
        <div class="workspace-list-actions">
          <vscode-button appearance="icon" title=${pendingDelete ? 'Removing…' : 'Remove from registry'} ?disabled=${pendingDelete} @click=${(e: Event) => { e.stopPropagation(); this._deleteWorkspace(ws.path, ws.name); }}>
            <vscode-icon name=${pendingDelete ? 'sync' : 'trash'}></vscode-icon>
          </vscode-button>
        </div>
      </div>`;
  }

  // ---------------------------------------------------------------------------
  // Project list
  // ---------------------------------------------------------------------------

  private _renderProjectList(d: SetupPanelData) {
    if (d.projects.length === 0) {
      return html`
        <div class="project-list-section">
          <h3>Projects</h3>
          <div class="empty-state">
            <div class="empty-state-icon">🔨</div>
            <h3>No Projects Yet</h3>
            <p>Create a project to configure builds, flash targets, and debug settings.</p>
            <vscode-button @click=${() => this._cmd("openProjectBuildPanel")}>Create Project</vscode-button>
          </div>
        </div>`;
    }

    return html`
      <div class="project-list-section">
        <h3>Projects</h3>
        <div class="overview-scroll-container">
          <div class="workspace-list-container">
            ${d.projects.map(p => this._renderProjectRow(p))}
          </div>
        </div>
      </div>`;
  }

  private _renderProjectRow(project: ProjectListItem) {
    const buildLabel = project.buildCount > 0 ? `${project.buildCount} build${project.buildCount > 1 ? "s" : ""}` : "";
    const pendingRemove = this._pendingProjectRemoves.has(project.name);
    return html`
      <div class="project-list-row${project.isActive ? " active" : ""}" @click=${() => this._cmd("openProjectBuildPanel")} role="button" tabindex="0" data-keyboard-command="true" aria-label="Open project ${project.name}">
        <div class="workspace-list-info">
          <div class="workspace-list-name">
            <span class="codicon codicon-symbol-folder"></span>
            <strong>${project.name}</strong>
            ${project.isActive ? html`<span class="workspace-active-badge">Active</span>` : nothing}
            ${buildLabel ? html`<span class="project-build-count">${buildLabel}</span>` : nothing}
          </div>
        </div>
        <div class="workspace-list-actions">
          <vscode-button appearance="icon" title=${pendingRemove ? 'Removing…' : 'Remove project'} ?disabled=${pendingRemove} @click=${(e: Event) => { e.stopPropagation(); this._removeProject(project.name); }}>
            <vscode-icon name=${pendingRemove ? 'sync' : 'trash'}></vscode-icon>
          </vscode-button>
        </div>
      </div>`;
  }

  // ---------------------------------------------------------------------------
  // Quick actions
  // ---------------------------------------------------------------------------

  private _renderQuickActions(d: SetupPanelData) {
    return html`
      <div class="quick-actions-section">
        <h3>Quick Actions</h3>
        <div class="quick-actions-grid">
          <div class="quick-action-item" @click=${() => this._cmd("openHostToolsPanel")} role="button" tabindex="0" data-keyboard-command="true">
            <span class="codicon codicon-tools"></span>
            <div class="quick-action-content">
              <strong>Host Tools</strong>
              <span class="quick-action-status ${d.toolsReady ? "status-success" : "status-warning"}">${d.toolsReady ? "Ready" : "Setup Required"}</span>
              <p>Install and verify build tools, compilers, and utilities for Zephyr development.</p>
            </div>
          </div>

          <div class="quick-action-item" @click=${() => this._cmd("openSDKPanel")} role="button" tabindex="0" data-keyboard-command="true">
            <span class="codicon codicon-${d.sdkReady ? "package" : "cloud-download"}"></span>
            <div class="quick-action-content">
              <strong>${d.sdkReady ? "Manage SDK & Toolchains" : "Install SDK"}</strong>
              <span class="quick-action-status ${d.sdkReady ? "status-success" : "status-warning"}">${d.sdkReady ? "Installed" : "Setup Required"}</span>
              <p>${d.sdkReady ? "View installed SDK toolchains and install additional target architectures." : "Download and install Zephyr SDK toolchains for target architectures."}</p>
            </div>
          </div>

          <div class="quick-action-item" @click=${() => this._cmd("westUpdate")} role="button" tabindex="0" data-keyboard-command="true">
            <span class="codicon codicon-sync"></span>
            <div class="quick-action-content">
              <strong>West Update</strong>
              <span class="quick-action-status ${d.westUpdated ? "status-success" : "status-warning"}">${d.westUpdated ? "Updated" : "Not Updated"}</span>
              <p>Fetch and update Zephyr modules and dependencies defined in the west manifest.</p>
            </div>
          </div>

          <div class="quick-action-item" @click=${() => this._cmd("openSettingsPanel")} role="button" tabindex="0" data-keyboard-command="true">
            <span class="codicon codicon-gear"></span>
            <div class="quick-action-content">
              <strong>Settings</strong>
              <p>Configure global directory, toolchain paths, virtual environment, and extension behavior.</p>
            </div>
          </div>

          <div class="quick-action-item" @click=${() => this._cmd("openProjectBuildPanel")} role="button" tabindex="0" data-keyboard-command="true">
            <span class="codicon codicon-add"></span>
            <div class="quick-action-content">
              <strong>Add Project</strong>
              <p>Create or configure a Zephyr project with build targets and settings.</p>
            </div>
          </div>
        </div>
      </div>`;
  }
}
