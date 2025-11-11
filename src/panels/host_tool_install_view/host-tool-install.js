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
let installationInProgress = false;
let installationState = {
    total: 0,
    current: 0,
    packageStates: {} // Store state for each package
};

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
        case 'installAllStarted':
            handleInstallAllStarted(message.total);
            break;
        case 'packageInstalling':
            handlePackageInstalling(message.packageName, message.current, message.total);
            break;
        case 'packageInstalled':
            handlePackageInstalled(message.packageName, message.success, message.pendingRestart, message.current, message.total);
            break;
        case 'installAllComplete':
            handleInstallAllComplete(message.needsRestart, message.hasErrors);
            break;
    }
});

function handleInstallAllStarted(total) {
    installationInProgress = true;
    installationState.total = total;
    installationState.current = 0;
    installationState.packageStates = {};
    
    // Update button to show it's installing
    const installAllBtn = document.getElementById('install-all-btn');
    installAllBtn.disabled = true;
    installAllBtn.innerHTML = `
        <span class="codicon codicon-sync codicon-modifier-spin"></span>
        Installing Packages (0/${total})
    `;
    
    // Disable all other buttons
    disableAllButtons(true);
}

function handlePackageInstalling(packageName, current, total) {
    // Update the button text only if installing multiple packages
    if (total > 1) {
        const installAllBtn = document.getElementById('install-all-btn');
        if (installAllBtn) {
            // Ensure values are numbers to prevent XSS
            const currentNum = Number(current);
            const totalNum = Number(total);
            installAllBtn.innerHTML = `
                <span class="codicon codicon-sync codicon-modifier-spin"></span>
                Installing Packages (${currentNum}/${totalNum})
            `;
        }
    }
    
    // Update the specific package in the list to show "Installing" status
    installationState.packageStates[packageName] = 'installing';
    updatePackageStatus(packageName, 'installing');
}

function handlePackageInstalled(packageName, success, pendingRestart, current, total) {
    installationState.current = current;
    
    // Update package state
    if (!success) {
        installationState.packageStates[packageName] = 'error';
        updatePackageStatus(packageName, 'error');
    } else if (pendingRestart) {
        installationState.packageStates[packageName] = 'pending-restart';
        updatePackageStatus(packageName, 'pending-restart');
    } else {
        installationState.packageStates[packageName] = 'installed';
        updatePackageStatus(packageName, 'installed');
    }
}

function handleInstallAllComplete(needsRestart, hasErrors) {
    installationInProgress = false;
    
    const installAllBtn = document.getElementById('install-all-btn');
    
    if (needsRestart) {
        installAllBtn.innerHTML = `
            <span class="codicon codicon-warning"></span>
            Pending Restart
        `;
    } else if (hasErrors) {
        installAllBtn.innerHTML = `
            <span class="codicon codicon-error"></span>
            Installation Failed
        `;
    } else {
        installAllBtn.innerHTML = `
            <span class="codicon codicon-check"></span>
            All Packages Installed
        `;
    }
    
    // Re-enable buttons after a delay and refresh status
    // The refresh will preserve pending-restart states via installationState.packageStates
    setTimeout(() => {
        disableAllButtons(false);
        refreshStatus();
    }, 2000);
}

function updatePackageStatus(packageName, state) {
    const packageItem = document.querySelector(`[data-package-name="${packageName}"]`);
    if (!packageItem) {
        return;
    }
    
    const statusBadge = packageItem.querySelector('.status-badge');
    const actionButtons = packageItem.querySelector('.package-actions');
    
    if (!statusBadge) {
        return;
    }
    
    // Remove all status classes
    packageItem.classList.remove('available', 'missing', 'installing', 'pending-restart');
    statusBadge.classList.remove('status-available', 'status-missing', 'status-installing', 'status-pending-restart');
    
    switch (state) {
        case 'installing':
            packageItem.classList.add('installing');
            statusBadge.classList.add('status-installing');
            statusBadge.innerHTML = '<span class="codicon codicon-sync codicon-modifier-spin"></span> Installing';
            // Hide install button while installing
            const installBtn = actionButtons.querySelector('.button');
            if (installBtn) {
                installBtn.style.display = 'none';
            }
            break;
        case 'installed':
            packageItem.classList.add('available');
            statusBadge.classList.add('status-available');
            statusBadge.innerHTML = '✓ Installed';
            break;
        case 'pending-restart':
            packageItem.classList.add('pending-restart');
            statusBadge.classList.add('status-pending-restart');
            statusBadge.innerHTML = '<span class="codicon codicon-warning"></span> Not Available Pending Restart';
            break;
        case 'error':
            packageItem.classList.add('missing');
            statusBadge.classList.add('status-missing');
            statusBadge.innerHTML = '✗ Installation Failed';
            break;
        default:
            packageItem.classList.add('missing');
            statusBadge.classList.add('status-missing');
            statusBadge.innerHTML = '✗ Not Available';
            break;
    }
}

function disableAllButtons(disable) {
    document.querySelectorAll('.button').forEach(btn => {
        if (disable) {
            btn.disabled = true;
        } else {
            btn.disabled = false;
        }
    });
}

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
                    ${data.managerAvailable ? '✓ Available' : '✗ Not Available'}
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
                <div class="summary-label">Not Available</div>
            </div>
            <div class="summary-item">
                <div class="summary-count">${totalCount}</div>
                <div class="summary-label">Total</div>
            </div>
        </div>
        <div class="package-list">
    `;
    
    for (const pkg of data.packages) {
        // Check if this package has a saved pending-restart state
        const savedState = installationState.packageStates[pkg.name];
        const isPendingRestart = savedState === 'pending-restart';
        const isInstalling = savedState === 'installing';
        
        // Determine the actual state to display
        let statusClass, statusText, itemClass, showInstallButton;
        
        if (isInstalling) {
            // Package is currently being installed
            itemClass = 'installing';
            statusClass = 'status-installing';
            statusText = '<span class="codicon codicon-sync codicon-modifier-spin"></span> Installing';
            showInstallButton = false;
        } else if (isPendingRestart) {
            // Package was installed but needs restart - preserve this state
            itemClass = 'pending-restart';
            statusClass = 'status-pending-restart';
            statusText = '<span class="codicon codicon-warning"></span> Not Available Pending Restart';
            showInstallButton = false;
        } else if (pkg.available) {
            // Package is available/installed
            itemClass = 'available';
            statusClass = 'status-available';
            statusText = '✓ Installed';
            showInstallButton = false;
        } else {
            // Package is not available
            itemClass = 'missing';
            statusClass = 'status-missing';
            statusText = '✗ Not Available';
            showInstallButton = data.managerAvailable;
        }
        
        packagesHtml += `
            <div class="package-item ${itemClass}" data-package-name="${pkg.name}">
                <div class="package-info">
                    <div class="package-name">${pkg.name}</div>
                    <div class="package-package">${pkg.package}</div>
                </div>
                <div class="package-actions">
                    <span class="status-badge ${statusClass}">
                        ${statusText}
                    </span>
                    ${showInstallButton ? `
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
