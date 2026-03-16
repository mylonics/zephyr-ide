/*
Copyright 2024 mylonics 
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

import { WorkspaceConfig, formatZephyrVersion } from "../../setup_utilities/types";
import * as path from "upath";
import * as fs from "fs";
import { parseWestConfigManifestPath } from "../../setup_utilities/west-config-parser";
import { getVenvPath } from "../../setup_utilities/workspace-config";

export class WorkspaceSubPage {
    /**
     * Returns the workspace sub-page state name for the current config.
     * The workspace page has three mutually exclusive visual states:
     *   - "setup-required" — no workspace configured yet (or no folder open)
     *   - "ready"          — workspace is fully set up
     *   - "initializing"   — a setup operation is in progress (set by JS only)
     */
    private static resolveState(wsConfig: WorkspaceConfig): string {
        const folderOpen = wsConfig.rootPath !== "";
        const workspaceInitialized = (wsConfig.initialSetupComplete || false)
            && (wsConfig.activeSetupState !== undefined);

        if (folderOpen && workspaceInitialized) {
            return "ready";
        }
        return "setup-required";
    }

    static getHtml(wsConfig: WorkspaceConfig): string {
        const folderOpen = wsConfig.rootPath !== "";
        const workspaceInitialized = (wsConfig.initialSetupComplete || false)
            && (wsConfig.activeSetupState !== undefined);
        const state = this.resolveState(wsConfig);

        return `
        <div class="sub-page-content">
            <div class="sub-page-header">
                <button class="back-button" onclick="navigateToOverview()">
                    <span class="codicon codicon-chevron-left"></span>
                    Back to Overview
                </button>
                <h2>Workspace Setup</h2>
            </div>
            
            <div class="sub-page-body" data-workspace-state="${state}">
                ${this.getInitializingContainer()}
                ${this.getReadyContainer(folderOpen, workspaceInitialized, wsConfig)}
                ${this.getSetupRequiredContainer(folderOpen)}
            </div>
        </div>`;
    }

    /** Initializing state — shown while a setup operation is running. */
    private static getInitializingContainer(): string {
        return `
            <div class="ws-state ws-state-initializing">
                <div class="status-banner status-info">
                    <div class="loading-spinner"></div>
                    <span class="status-text">Initializing workspace\u2026</span>
                </div>
                <p class="description">Follow the prompts in the VS Code dialog to configure your workspace.</p>
                <div id="setupProgressContainer"></div>
            </div>`;
    }

    /** Ready state — workspace is configured and operational. */
    private static getReadyContainer(folderOpen: boolean, workspaceInitialized: boolean, wsConfig: WorkspaceConfig): string {
        const content = (folderOpen && workspaceInitialized)
            ? this.getInitializedContent(wsConfig)
            : '';
        return `
            <div class="ws-state ws-state-ready">
                <div class="status-banner status-success">
                    <span class="codicon codicon-check"></span>
                    <span class="status-text">Workspace Ready</span>
                </div>
                ${content}
            </div>`;
    }

    /** Setup-required state — no workspace configured (or no folder open). */
    private static getSetupRequiredContainer(folderOpen: boolean): string {
        const content = folderOpen
            ? this.getSetupOptionsContent()
            : this.getNoFolderContent();
        const bannerClass = folderOpen ? 'status-warning' : 'status-info';
        const bannerIcon = folderOpen
            ? '<span class="codicon codicon-gear"></span>'
            : '<span class="codicon codicon-folder"></span>';
        const bannerText = folderOpen ? 'Setup Required' : 'No Folder Opened';

        return `
            <div class="ws-state ws-state-setup-required">
                <div class="status-banner ${bannerClass}">
                    ${bannerIcon}
                    <span class="status-text">${bannerText}</span>
                </div>
                ${content}
            </div>`;
    }

    private static getNoFolderContent(): string {
        return `
        <p class="description">Open a folder in VS Code to set up your Zephyr workspace.</p>
        
        <div class="section-container centered">
            <div class="empty-state">
                <div class="empty-state-icon">📁</div>
                <h3>No Folder Open</h3>
                <p>A workspace folder is required for Zephyr development.</p>
            </div>
            
            <div class="button-group">
                <button class="button button-primary" onclick="openFolder()">
                    <span class="codicon codicon-folder-opened"></span>
                    Open Folder
                </button>
            </div>
        </div>`;
    }

    private static getInitializedContent(wsConfig: WorkspaceConfig): string {
        const activeSetupPath = wsConfig.activeSetupState?.setupPath || "Not configured";
        const currentFolderPath = wsConfig.rootPath || "Not configured";
        const westYmlPath = this.getWestYmlPath(wsConfig);
        const venvPath = this.getVenvPath(wsConfig);
        const zephyrVersion = wsConfig.activeSetupState?.zephyrVersion
            ? formatZephyrVersion(wsConfig.activeSetupState.zephyrVersion)
            : "Not available";

        return `
        <p class="description">Workspace is configured and ready for development.</p>
        
        <div class="section-container">
            <h3>Workspace Information</h3>
            <div class="info-box">
                <p><strong>Current Folder:</strong> <code>${currentFolderPath}</code></p>
                <p><strong>West Workspace Path:</strong> <code>${activeSetupPath}</code></p>
                <p><strong>West.yml Location:</strong> <code>${westYmlPath}</code></p>
                <p><strong>Python .venv Location:</strong> <code>${venvPath}</code></p>
                <p><strong>Zephyr Version:</strong> <code>${zephyrVersion}</code></p>
            </div>
        </div>
        
        <div class="section-container">
            <h3>West Configuration</h3>
            <div class="west-yml-editor">
                <div class="editor-header">
                    <label for="westYmlEditor">west.yml</label>
                    <button class="button button-small button-secondary" onclick="openWestYml()">
                        <span class="codicon codicon-go-to-file"></span>
                        Open in Editor
                    </button>
                </div>
                <textarea id="westYmlEditor" class="west-yml-textarea" rows="15" placeholder="Loading west.yml..."></textarea>
                <div class="editor-actions">
                    <button class="button button-primary" onclick="saveAndUpdateWestYml()">
                        <span class="codicon codicon-save"></span>
                        Save and West Update
                    </button>
                    <button class="button button-secondary" onclick="westUpdate()">
                        <span class="codicon codicon-sync"></span>
                        West Update
                    </button>
                </div>
            </div>
        </div>
        
        <div class="action-section">
            <h3>Workspace Management</h3>
            <div class="button-group">
                <button class="button button-secondary" onclick="manageWorkspace()">
                    <span class="codicon codicon-folder-library"></span>
                    Manage West Workspaces
                </button>
                <button class="button button-secondary" onclick="reinitializeWorkspace()">
                    <span class="codicon codicon-refresh"></span>
                    Reinitialize VS Code Workspace
                </button>
            </div>
        </div>
        
        <div class="action-section">
            <h3>Advanced Commands</h3>
            <p class="description">Low-level commands for advanced workspace management and troubleshooting.</p>
            <div class="button-group">
                <button class="button button-secondary" onclick="westConfig()">
                    <span class="codicon codicon-settings"></span>
                    West Config
                </button>
                <button class="button button-secondary" onclick="setupWestEnvironment()">
                    <span class="codicon codicon-folder-opened"></span>
                    Setup West Environment
                </button>
                <button class="button button-secondary" onclick="westInit()">
                    <span class="codicon codicon-repo-create"></span>
                    West Init
                </button>
            </div>
        </div>`;
    }

    private static getWestYmlPath(wsConfig: WorkspaceConfig): string {
        if (!wsConfig.activeSetupState?.setupPath) {
            return "Not found";
        }

        const westYmlPath = parseWestConfigManifestPath(wsConfig.activeSetupState.setupPath);
        return westYmlPath || "Not found";
    }

    private static getVenvPath(wsConfig: WorkspaceConfig): string {
        if (wsConfig.activeSetupState?.setupPath) {
            return getVenvPath(wsConfig.activeSetupState.setupPath);
        }
        return "Not found";
    }

    private static getSetupOptionsContent(): string {
        return `
        <p class="description">Select how to configure your workspace. Each option organizes projects and manages dependencies differently.</p>
        
        <div class="section-container">
            <h3>Initialize West Workspace</h3>
            <div class="workspace-options-grid">
                ${this.generateWorkspaceOptionCard(
            "🌐",
            "Import Zephyr IDE Workspace from Git",
            "Clone a complete workspace or repo with projects as subdirectories using Git.",
            "Team collaboration and shared environments",
            "workspaceSetupFromGit()"
        )}
                ${this.generateWorkspaceOptionCard(
            "⚙️",
            "Import West Workspace from Git",
            "Clone a west manifest repo (contains west.yml) using West Init.",
            "Upstream Zephyr projects and community examples",
            "workspaceSetupFromWestGit()"
        )}
                ${this.generateWorkspaceOptionCard(
            "📦",
            "New Standard Workspace",
            "Create a self-contained workspace with Zephyr installed locally.",
            "Individual projects or specific Zephyr versions",
            "workspaceSetupStandard()"
        )}
                ${this.generateWorkspaceOptionCard(
            "📁",
            "Initialize Current Directory",
            "Set up the current directory for Zephyr development, preserving existing files.",
            "Existing projects or external Zephyr installations",
            "workspaceSetupFromCurrentDirectory()"
        )}
            </div>
        </div>
        
        <div class="section-container">
            <h3>Use Existing West Workspace</h3>
            <div class="workspace-options-grid">
                ${this.generateWorkspaceOptionCard(
            "🔗",
            "Link to Existing Installation",
            "Select from existing Zephyr installations to link this workspace without initializing a new one.",
            "Sharing installations across multiple projects",
            "selectExistingWestWorkspace()"
        )}
            </div>
        </div>`;
    }

    private static generateWorkspaceOptionCard(
        icon: string,
        title: string,
        description: string,
        usage: string,
        onClick: string
    ): string {
        return `
        <div class="workspace-option-card" onclick="${onClick}">
            <div class="option-header">
                <span class="option-icon">${icon}</span>
                <h4>${title}</h4>
            </div>
            <p class="option-description">${description}</p>
            <p class="option-usage"><em>Best for: ${usage}</em></p>
        </div>`;
    }
}
