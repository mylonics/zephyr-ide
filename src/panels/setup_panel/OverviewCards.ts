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

import { GlobalConfig, WorkspaceConfig } from "../../setup_utilities/types";

export class HostToolsCard {
    static getHtml(globalConfig: GlobalConfig, stepNumber: number): string {
        const isReady = globalConfig.toolsAvailable ?? false;

        if (isReady) {
            return `
            <span class="setup-status-pill status-success" onclick="sendCommand('openHostToolsPanel')" role="button" tabindex="0" title="Host tools are installed and ready">
                <span class="codicon codicon-check"></span> Host Tools
            </span>`;
        }

        return `
        <div class="overview-card" onclick="sendCommand('openHostToolsPanel')" role="button" tabindex="0" data-keyboard-command="true" aria-label="Open Host Tools setup">
            <div class="overview-card-header">
                <span class="step-badge step-badge-active">${stepNumber}</span>
                <span class="overview-icon">🔧</span>
                <h3>Host Tools</h3>
            </div>
            <div class="status status-warning">⚠ Setup Required</div>
            <p class="overview-description">Install and verify build tools, compilers, and utilities required for Zephyr development.</p>
            <div class="card-arrow">→</div>
        </div>`;
    }
}

export class SDKCard {
    static getHtml(globalConfig: GlobalConfig, hasValidSetupState: boolean, stepNumber: number): string {
        const isComplete = globalConfig.sdkInstalled ?? false;
        const isLocked = !hasValidSetupState;

        if (isComplete) {
            return `
            <span class="setup-status-pill status-success" onclick="sendCommand('openSDKPanel')" role="button" tabindex="0" title="Zephyr SDK is installed">
                <span class="codicon codicon-check"></span> Zephyr SDK
            </span>`;
        }

        let status: string;
        let statusClass: string;
        if (isLocked) {
            status = "⚠ Workspace Required";
            statusClass = "status-warning";
        } else {
            status = "⚙ Setup Required";
            statusClass = "status-warning";
        }

        const stepBadgeClass = isLocked ? "step-badge-locked" : "step-badge-active";

        return `
        <div class="overview-card${isLocked ? ' overview-card-locked' : ''}" ${isLocked ? '' : 'onclick="sendCommand(\'openSDKPanel\')"'} role="button" tabindex="${isLocked ? '-1' : '0'}" ${isLocked ? 'aria-disabled="true"' : ''} data-keyboard-command="true" aria-label="Open Zephyr SDK management">
            <div class="overview-card-header">
                <span class="step-badge ${stepBadgeClass}">${stepNumber}</span>
                <span class="overview-icon">📦</span>
                <h3>Zephyr SDK Management</h3>
            </div>
            <div class="status ${statusClass}">${status}</div>
            <p class="overview-description">Install and manage Zephyr SDK for different architectures and toolchains. Requires west workspace.</p>
            <div class="card-arrow">→</div>
        </div>`;
    }
}

export class WorkspaceSetupCard {
    static getHtml(folderOpen: boolean, stepNumber: number): string {
        const command = folderOpen ? 'openWorkspacePanel' : 'openFolder';
        const title = folderOpen ? 'West Workspace' : 'Open Folder';
        const description = folderOpen
            ? 'Set up a west workspace to initialize your Zephyr development environment.'
            : 'Open a folder to get started with Zephyr development.';
        const statusText = folderOpen ? '⚙ Setup Required' : '📁 No Folder Open';

        return `
        <div class="overview-card" onclick="sendCommand('${command}')" role="button" tabindex="0" data-keyboard-command="true" aria-label="${title}">
            <div class="overview-card-header">
                <span class="step-badge step-badge-active">${stepNumber}</span>
                <span class="overview-icon">📁</span>
                <h3>${title}</h3>
            </div>
            <div class="status status-warning">${statusText}</div>
            <p class="overview-description">${description}</p>
            <div class="card-arrow">→</div>
        </div>`;
    }
}

export class WorkspaceCard {
    static getSectionHeaderHtml(wsConfig: WorkspaceConfig, folderOpen: boolean, workspaceInitialized: boolean, hasWorkspaces: boolean): string {
        let status: string;
        let statusClass: string;

        if (workspaceInitialized) {
            status = "✓ Initialized";
            statusClass = "status-success";
        } else if (hasWorkspaces && wsConfig.initialSetupComplete) {
            status = "⚠ Activate Workspace";
            statusClass = "status-warning";
        } else if (hasWorkspaces || folderOpen) {
            status = "⚙ Setup Workspace";
            statusClass = "status-warning";
        } else {
            status = "📁 No Folder";
            statusClass = "status-info";
        }

        return `
        <div class="section-header-row">
            <h3>West Workspaces</h3>
            <div class="section-header-actions">
                <span class="status ${statusClass}">${status}</span>
            </div>
        </div>`;
    }
}
