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

import { WorkspaceConfig } from "../../setup_utilities/types";

export class WorkspaceSubPage {
    static getHtml(wsConfig: WorkspaceConfig): string {
        const folderOpen = wsConfig.rootPath !== "";
        const workspaceInitialized = wsConfig.initialSetupComplete || false;

        let statusClass = "status-info";
        let statusIcon = "📁";
        let statusText = "No Folder Opened";

        if (folderOpen) {
            if (workspaceInitialized) {
                statusClass = "status-success";
                statusIcon = "✓";
                statusText = "Workspace Ready";
            } else {
                statusClass = "status-warning";
                statusIcon = "⚙";
                statusText = "Setup Required";
            }
        }

        return `
        <div class="sub-page-content">
            <div class="sub-page-header">
                <button class="back-button" onclick="navigateToOverview()">
                    <span class="codicon codicon-chevron-left"></span>
                    Back to Overview
                </button>
                <h2>Workspace Setup</h2>
            </div>
            
            <div class="sub-page-body">
                <div class="status-banner ${statusClass}">
                    <span class="status-icon">${statusIcon}</span>
                    <span class="status-text">${statusText}</span>
                </div>
                
                ${this.getWorkspaceContent(folderOpen, workspaceInitialized)}
            </div>
        </div>`;
    }

    private static getWorkspaceContent(folderOpen: boolean, workspaceInitialized: boolean): string {
        if (!folderOpen) {
            return this.getNoFolderContent();
        } else if (workspaceInitialized) {
            return this.getInitializedContent();
        } else {
            return this.getSetupOptionsContent();
        }
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
                <button class="button button-secondary" onclick="workspaceSetupPicker()">
                    <span class="codicon codicon-settings-gear"></span>
                    Workspace Setup Options
                </button>
            </div>
        </div>`;
    }

    private static getInitializedContent(): string {
        return `
        <p class="description">Workspace is configured and ready for development.</p>
        
        <div class="section-container">
            <h3>Workspace Information</h3>
            <div class="info-box">
                <p>✅ Workspace initialized</p>
                <p>You can now create projects and build applications.</p>
            </div>
        </div>
        
        <div class="action-section">
            <h3>Workspace Management</h3>
            <div class="button-group">
                <button class="button button-secondary" onclick="manageWorkspace()">
                    <span class="codicon codicon-folder-library"></span>
                    Manage Workspaces
                </button>
                <button class="button button-secondary" onclick="reinitializeWorkspace()">
                    <span class="codicon codicon-refresh"></span>
                    Reinitialize Workspace
                </button>
            </div>
        </div>`;
    }

    private static getSetupOptionsContent(): string {
        return `
        <p class="description">Select how to configure your workspace. Each option organizes projects and manages dependencies differently.</p>
        
        <div class="section-container">
            <h3>Workspace Setup Options</h3>
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
            <h3>Advanced Options</h3>
            <div class="button-group">
                <button class="button button-secondary" onclick="westConfig()">
                    <span class="codicon codicon-settings"></span>
                    West Configuration
                </button>
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
