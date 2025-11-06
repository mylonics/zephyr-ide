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

/* eslint-disable no-undef */
/* global acquireVsCodeApi */

const vscode = acquireVsCodeApi();

let currentStatus = null;

// Handle messages from the extension
window.addEventListener('message', event => {
    const message = event.data;
    
    switch (message.command) {
        case 'updateStatus':
            if (message.error) {
                displayError(message.error);
            } else {
                currentStatus = message.data;
                displayStatus(message.data);
            }
            break;
        case 'installProgress':
            showProgress(message.message);
            break;
        case 'installComplete':
            hideProgress();
            break;
    }
});

function displayError(error) {
    document.getElementById('manager-status').innerHTML = `
        <div style="padding: 20px; text-align: center; color: var(--vscode-errorForeground);">
            Error: ${error}
        </div>
    `;
    document.getElementById('packages-status').innerHTML = '';
}

function displayStatus(data) {
    // Display package manager status
    const managerHtml = `
        <div class="manager-status-box ${data.managerAvailable ? 'manager-available' : 'manager-unavailable'}">
            <div class="manager-info">
                <div>
                    <div class="manager-name">${data.managerName}</div>
                    <div style="font-size: 12px; color: var(--vscode-descriptionForeground);">
                        Package Manager
                    </div>
                </div>
                <span class="status-badge ${data.managerAvailable ? 'status-available' : 'status-missing'}">
                    ${data.managerAvailable ? '✓ Available' : '✗ Not Found'}
                </span>
            </div>
            ${!data.managerAvailable ? `
                <div style="margin-top: 10px;">
                    ${data.managerInstallUrl ? `
                        <p style="margin-bottom: 10px; font-size: 12px;">
                            The ${data.managerName} package manager is required but not installed.
                        </p>
                        <button class="button button-primary" onclick="openManagerInstallUrl()">
                            📥 Install ${data.managerName}
                        </button>
                    ` : `
                        <button class="button button-primary" onclick="installPackageManager()">
                            📥 Install ${data.managerName}
                        </button>
                    `}
                </div>
            ` : ''}
        </div>
    `;
    
    document.getElementById('manager-status').innerHTML = managerHtml;
    
    // Display packages status
    const availableCount = data.packages.filter(p => p.available).length;
    const missingCount = data.packages.filter(p => !p.available).length;
    const totalCount = data.packages.length;
    
    let packagesHtml = `
        <div class="summary-box">
            <div class="summary-item">
                <div class="summary-count available">${availableCount}</div>
                <div class="summary-label">Available</div>
            </div>
            <div class="summary-item">
                <div class="summary-count missing">${missingCount}</div>
                <div class="summary-label">Not Found</div>
            </div>
            <div class="summary-item">
                <div class="summary-count">${totalCount}</div>
                <div class="summary-label">Total</div>
            </div>
        </div>
        <div class="package-list">
    `;
    
    for (const pkg of data.packages) {
        packagesHtml += `
            <div class="package-item ${pkg.available ? 'available' : 'missing'}">
                <div class="package-info">
                    <div class="package-name">${pkg.name}</div>
                    <div class="package-package">${pkg.package}</div>
                </div>
                <div class="package-actions">
                    <span class="status-badge ${pkg.available ? 'status-available' : 'status-missing'}">
                        ${pkg.available ? '✓ Installed' : '✗ Not Found'}
                    </span>
                    ${!pkg.available && data.managerAvailable ? `
                        <button class="button button-small" onclick="installPackage('${pkg.name}')">
                            Install
                        </button>
                    ` : ''}
                </div>
            </div>
        `;
    }
    
    packagesHtml += '</div>';
    
    document.getElementById('packages-status').innerHTML = packagesHtml;
    
    // Update action buttons
    const installAllBtn = document.getElementById('install-all-btn');
    const markCompleteBtn = document.getElementById('mark-complete-btn');
    
    if (missingCount > 0 && data.managerAvailable) {
        installAllBtn.disabled = false;
    } else {
        installAllBtn.disabled = true;
    }
    
    // Enable "Skip & Mark as Complete" only if there are missing packages
    if (missingCount > 0) {
        markCompleteBtn.disabled = false;
    } else {
        markCompleteBtn.disabled = true;
    }
}

function showProgress(message) {
    const progressSection = document.getElementById('progress-section');
    const progressMessage = document.getElementById('progress-message');
    progressMessage.textContent = message;
    progressSection.style.display = 'block';
    
    // Disable all buttons
    document.querySelectorAll('.button').forEach(btn => {
        btn.disabled = true;
    });
}

function hideProgress() {
    const progressSection = document.getElementById('progress-section');
    progressSection.style.display = 'none';
    
    // Re-enable buttons
    document.querySelectorAll('.button').forEach(btn => {
        btn.disabled = false;
    });
    
    // Refresh status after installation
    refreshStatus();
}

function refreshStatus() {
    vscode.postMessage({ command: 'checkStatus' });
}

function installPackageManager() {
    vscode.postMessage({ command: 'installPackageManager' });
}

function installPackage(packageName) {
    vscode.postMessage({ 
        command: 'installPackage',
        packageName: packageName
    });
}

function installAllMissing() {
    vscode.postMessage({ command: 'installAllMissing' });
}

function markComplete() {
    vscode.postMessage({ command: 'markComplete' });
}

function openManagerInstallUrl() {
    vscode.postMessage({ command: 'openManagerInstallUrl' });
}

// Initial check on load
refreshStatus();
