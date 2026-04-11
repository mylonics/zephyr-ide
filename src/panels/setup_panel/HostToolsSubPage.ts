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
import { HostToolInstallView } from "../host_tool_install_view/HostToolInstallView";

export class HostToolsSubPage {
    static getHtml(globalConfig: GlobalConfig): string {
        const description = globalConfig.toolsAvailable
            ? "Host tools are installed. You can manage or update them below."
            : "Install CMake, Ninja, Python, Git, and other tools required for building Zephyr applications.";

        const hostToolsManagerContent = HostToolInstallView.getContentHtml();

        return `
        <div class="sub-page-content">
            <div class="sub-page-header page-header">
                <div class="sub-page-title-group">
                    <h2 class="page-title">Host Tools</h2>
                </div>
                <div class="sub-page-actions">
                    <vscode-button class="sub-page-back-button" appearance="secondary" onclick="navigateToOverview()">
                        <vscode-icon slot="start-icon" name="chevron-left"></vscode-icon>
                        Back to Overview
                    </vscode-button>
                </div>
            </div>
            
            <div class="sub-page-body">
                <div class="status-banner ${globalConfig.toolsAvailable ? 'status-success' : 'status-warning'}">
                    <span class="status-icon">${globalConfig.toolsAvailable ? '✓' : '⚠'}</span>
                    <span class="status-text">${globalConfig.toolsAvailable ? 'Tools Available' : 'Setup Required'}</span>
                </div>
                
                <p class="description">${description}</p>
                
                <div class="section-container">
                    <h3>Installation Manager</h3>
                    ${hostToolsManagerContent}
                </div>
                
                <div class="action-section">
                    <h3>Quick Actions</h3>
                    <div class="button-group">
                        <vscode-button appearance="secondary" onclick="markToolsComplete()">
                            <vscode-icon slot="start-icon" name="check"></vscode-icon>
                            Mark Tools as Installed
                        </vscode-button>
                    </div>
                    <p class="help-text">
                        If you've already installed all required tools manually, you can mark them as complete to skip this step.
                    </p>
                </div>
            </div>
        </div>`;
    }
}
