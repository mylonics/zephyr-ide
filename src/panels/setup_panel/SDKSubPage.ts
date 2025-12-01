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
        let description: string;
        let warningSection = "";
        
        if (!hasValidSetupState) {
            description = "A west workspace is required before installing the Zephyr SDK.";
            warningSection = `
                <div class="warning-box">
                    <p style="margin: 0;">
                        <strong>⚠ Workspace Setup Required</strong><br>
                        Please set up a west workspace first before managing the SDK. 
                        Go back to the overview and configure the Workspace card.
                    </p>
                </div>`;
        } else if (globalConfig.sdkInstalled) {
            description = "Zephyr SDK is installed. You can manage additional versions or update below.";
        } else {
            description = "Install the Zephyr SDK to enable cross-compilation for supported architectures.";
        }

        return `
        <div class="sub-page-content">
            <div class="sub-page-header">
                <button class="back-button" onclick="navigateToOverview()">
                    <span class="codicon codicon-chevron-left"></span>
                    Back to Overview
                </button>
                <h2>Zephyr SDK Management</h2>
            </div>
            
            <div class="sub-page-body">
                <div class="status-banner ${globalConfig.sdkInstalled ? 'status-success' : hasValidSetupState ? 'status-warning' : 'status-error'}">
                    <span class="status-icon">${globalConfig.sdkInstalled ? '✓' : hasValidSetupState ? '⚙' : '⚠'}</span>
                    <span class="status-text">${globalConfig.sdkInstalled ? 'SDK Installed' : hasValidSetupState ? 'Setup Required' : 'Workspace Required'}</span>
                </div>
                
                <p class="description">${description}</p>
                
                ${warningSection}
                
                <div class="info-box">
                    <p style="margin: 0;">
                        <strong>Note:</strong> SDK installation uses the <code>west sdk</code> command and requires a west workspace.
                    </p>
                </div>
                
                <div class="section-container">
                    <h3>About Zephyr SDK</h3>
                    <p class="description">
                        The Zephyr SDK contains cross-compilation toolchains for ARM, x86, RISC-V, and other architectures.
                    </p>
                </div>
                
                <div class="action-section">
                    <h3>SDK Management</h3>
                    <div class="button-group">
                        <button class="button button-primary" onclick="installSDK()" ${!hasValidSetupState ? 'disabled' : ''}>
                            <span class="codicon codicon-cloud-download"></span>
                            Install / Update SDK
                        </button>
                        <button class="button button-secondary" onclick="listSDKs()" ${!hasValidSetupState ? 'disabled' : ''}>
                            <span class="codicon codicon-list-unordered"></span>
                            List Available SDKs
                        </button>
                    </div>
                </div>
                
                <div id="sdkListContainer" class="sdk-list-container"></div>
            </div>
        </div>`;
    }
}
