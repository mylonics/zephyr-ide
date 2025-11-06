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
    static getHtml(globalConfig: GlobalConfig): string {
        const status = globalConfig.toolsAvailable ? "✓ Ready" : "⚠ Setup Required";
        const statusClass = globalConfig.toolsAvailable ? "status-success" : "status-warning";

        return `
        <div class="overview-card" onclick="navigateToSubPage('hosttools')">
            <div class="overview-card-header">
                <span class="overview-icon">🔧</span>
                <h3>Host Tools</h3>
            </div>
            <div class="status ${statusClass}">${status}</div>
            <p class="overview-description">Install and verify build tools, compilers, and utilities required for Zephyr development.</p>
            <div class="card-arrow">→</div>
        </div>`;
    }
}

export class SDKCard {
    static getHtml(globalConfig: GlobalConfig): string {
        const status = globalConfig.sdkInstalled ? "✓ Installed" : "✗ Not Installed";
        const statusClass = globalConfig.sdkInstalled ? "status-success" : "status-error";

        return `
        <div class="overview-card" onclick="navigateToSubPage('sdk')">
            <div class="overview-card-header">
                <span class="overview-icon">📦</span>
                <h3>Zephyr SDK Management</h3>
            </div>
            <div class="status ${statusClass}">${status}</div>
            <p class="overview-description">Install and manage Zephyr SDK for different architectures and toolchains. Requires west workspace.</p>
            <div class="card-arrow">→</div>
        </div>`;
    }
}

export class WorkspaceCard {
    static getHtml(wsConfig: WorkspaceConfig, folderOpen: boolean, workspaceInitialized: boolean): string {
        const status = workspaceInitialized ? "✓ Initialized" : folderOpen ? "⚙ Setup Required" : "📁 No Folder";
        const statusClass = workspaceInitialized ? "status-success" : folderOpen ? "status-warning" : "status-info";

        return `
        <div class="overview-card" onclick="navigateToSubPage('workspace')">
            <div class="overview-card-header">
                <span class="overview-icon">🗂️</span>
                <h3>Workspace</h3>
            </div>
            <div class="status ${statusClass}">${status}</div>
            <p class="overview-description">Configure west workspace, initialize repositories, and manage Zephyr project dependencies.</p>
            <div class="card-arrow">→</div>
        </div>`;
    }
}
