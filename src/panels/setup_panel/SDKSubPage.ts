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
    static getHtml(globalConfig: GlobalConfig): string {
        const description = globalConfig.sdkInstalled
            ? "The Zephyr SDK is installed and ready to use. You can manage additional SDK versions or update to the latest release."
            : "The Zephyr SDK is required for building Zephyr applications. Install it to enable cross-compilation for supported architectures.";

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
                <div class="status-banner ${globalConfig.sdkInstalled ? 'status-success' : 'status-error'}">
                    <span class="status-icon">${globalConfig.sdkInstalled ? '✓' : '✗'}</span>
                    <span class="status-text">${globalConfig.sdkInstalled ? 'SDK Installed' : 'SDK Not Installed'}</span>
                </div>
                
                <p class="description">${description}</p>
                
                <div class="info-box">
                    <p style="margin: 0;">
                        <strong>Note:</strong> SDK installation uses the <code>west sdk</code> command. 
                        A west installation is required in order to install the Zephyr SDK. 
                        Please ensure west is set up before proceeding with SDK installation.
                    </p>
                </div>
                
                <div class="section-container">
                    <h3>About Zephyr SDK</h3>
                    <p class="description">
                        The Zephyr SDK contains cross-compilation toolchains for multiple architectures including ARM, x86, RISC-V, and more.
                        It provides everything needed to build Zephyr applications for various target platforms.
                    </p>
                </div>
                
                <div class="action-section">
                    <h3>SDK Management</h3>
                    <div class="button-group">
                        <button class="button button-primary" onclick="installSDK()">
                            <span class="codicon codicon-cloud-download"></span>
                            Install / Update SDK
                        </button>
                        <button class="button button-secondary" onclick="listSDKs()">
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
