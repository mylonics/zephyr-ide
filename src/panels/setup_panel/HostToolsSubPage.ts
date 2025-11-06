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

export class HostToolsSubPage {
    static getHtml(globalConfig: GlobalConfig): string {
        const description = globalConfig.toolsAvailable
            ? "Host development tools are installed and available. You can manage or update tools as needed."
            : "Host development tools (CMake, Ninja, Python, etc.) are required for building Zephyr applications. Install them to proceed.";

        return `
        <div class="sub-page-content">
            <div class="sub-page-header">
                <button class="back-button" onclick="navigateToOverview()">
                    <span class="codicon codicon-chevron-left"></span>
                    Back to Overview
                </button>
                <h2>Host Tools Installation</h2>
            </div>
            
            <div class="sub-page-body">
                <div class="status-banner ${globalConfig.toolsAvailable ? 'status-success' : 'status-warning'}">
                    <span class="status-icon">${globalConfig.toolsAvailable ? '✓' : '⚠'}</span>
                    <span class="status-text">${globalConfig.toolsAvailable ? 'Tools Available' : 'Setup Required'}</span>
                </div>
                
                <p class="description">${description}</p>
                
                <div class="section-container">
                    <h3>Required Tools</h3>
                    <p class="description">The following tools are required for Zephyr development:</p>
                    <ul class="tools-list">
                        <li><strong>CMake</strong> - Build system generator</li>
                        <li><strong>Ninja</strong> - Build tool for fast compilation</li>
                        <li><strong>Python 3.8+</strong> - Scripting and build dependencies</li>
                        <li><strong>Git</strong> - Version control system</li>
                        <li><strong>DTC</strong> - Device Tree Compiler</li>
                        <li><strong>GPerf</strong> - Perfect hash function generator</li>
                    </ul>
                </div>
                
                <div class="action-section">
                    <h3>Installation Options</h3>
                    <div class="button-group">
                        <button class="button button-primary" onclick="openHostToolsPanel()">
                            <span class="codicon codicon-tools"></span>
                            Open Advanced Host Tools Manager
                        </button>
                        <button class="button button-secondary" onclick="markToolsComplete()">
                            <span class="codicon codicon-check"></span>
                            Mark Tools as Installed
                        </button>
                    </div>
                    <p class="help-text">
                        The Advanced Host Tools Manager provides detailed installation guidance for your platform.
                        If you've already installed the tools manually, you can mark them as complete.
                    </p>
                </div>
            </div>
        </div>`;
    }
}
