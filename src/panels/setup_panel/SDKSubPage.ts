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

import { GlobalConfig } from "../../setup_utilities/types";

export class SDKSubPage {
    static getHtml(globalConfig: GlobalConfig, hasValidSetupState: boolean): string {
        const statusIcon = globalConfig.sdkInstalled ? '✓' : hasValidSetupState ? '⚙' : '⚠';
        const statusLabel = globalConfig.sdkInstalled ? 'Installed' : hasValidSetupState ? 'Not Installed' : 'Workspace Required';
        const statusClass = globalConfig.sdkInstalled ? 'status-success' : hasValidSetupState ? 'status-warning' : 'status-error';

        const warningSection = !hasValidSetupState ? `
                <div class="error-box">
                    <p class="no-margin">
                        <strong>No West Workspace Found</strong><br>
                        A west workspace must be set up before SDK toolchains can be installed or managed.
                        Go back to the overview and configure the <strong>Workspace</strong> card first.
                    </p>
                </div>` : '';

        return `
        <div class="sub-page-content">
            <div class="sub-page-header page-header">
                <div class="sub-page-title-group">
                    <h2 class="page-title">Zephyr SDK</h2>
                    <span class="header-status-badge ${statusClass}">${statusIcon} ${statusLabel}</span>
                </div>
                <div class="sub-page-actions">
                    <vscode-button id="sdkInstallBtn" onclick="installSDK()" ${!hasValidSetupState ? 'disabled' : ''}>
                        <vscode-icon slot="start-icon" name="cloud-download"></vscode-icon>
                        Install / Update
                    </vscode-button>
                    <vscode-button id="sdkListBtn" appearance="secondary" onclick="listSDKs()" ${!hasValidSetupState ? 'disabled' : ''}>
                        <vscode-icon slot="start-icon" name="refresh"></vscode-icon>
                        Refresh
                    </vscode-button>
                    <vscode-button class="sub-page-back-button" appearance="secondary" onclick="navigateToOverview()">
                        <vscode-icon slot="start-icon" name="chevron-left"></vscode-icon>
                        Back
                    </vscode-button>
                </div>
            </div>
            
            <div class="sub-page-body">
                <p class="sdk-description">The Zephyr SDK provides GNU toolchains for cross-compiling to supported target architectures. Install or update toolchains below, then refresh to see what's available.</p>

                ${warningSection}
                
                <div id="sdkProgressContainer"></div>
                
                <div id="sdkListContainer" class="sdk-list-container"></div>
            </div>
        </div>`;
    }
}
