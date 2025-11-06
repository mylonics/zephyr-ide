// Zephyr IDE Setup Panel Client-Side Logic

const vscode = acquireVsCodeApi();

// Section Toggle Functions
function toggleSection(sectionId) {
    const content = document.getElementById(sectionId + 'Content');
    const icon = document.getElementById(sectionId + 'Icon');

    if (content.classList.contains('expanded')) {
        content.classList.remove('expanded');
        icon.classList.remove('expanded');
    } else {
        content.classList.add('expanded');
        icon.classList.add('expanded');
    }
}

// Scroll to section function
function scrollToSection(sectionId) {
    const section = document.getElementById(sectionId);
    if (section) {
        section.scrollIntoView({ behavior: 'smooth', block: 'start' });
        // Expand the section if it's collapsed
        const content = document.getElementById(sectionId + 'Content');
        const icon = document.getElementById(sectionId + 'Icon');
        if (content && icon && !content.classList.contains('expanded')) {
            content.classList.add('expanded');
            icon.classList.add('expanded');
        }
    }
}

// Host Tools Functions
function openHostToolsPanel() {
    vscode.postMessage({
        command: 'openHostToolsPanel'
    });
}

function markToolsComplete() {
    vscode.postMessage({
        command: 'markToolsComplete'
    });
}

// Command Functions
function openWingetInstall() {
    vscode.postMessage({
        command: 'openWingetLink'
    });
}

function openFolder() {
    vscode.postMessage({
        command: 'openFolder'
    });
}

function reinitializeWorkspace() {
    vscode.postMessage({
        command: 'reinitializeWorkspace'
    });
}

function installSDK() {
    vscode.postMessage({
        command: 'installSDK'
    });
}

function setupWestEnvironment() {
    vscode.postMessage({
        command: 'setupWestEnvironment'
    });
}

function westInit() {
    vscode.postMessage({
        command: 'westInit'
    });
}

function westUpdate() {
    vscode.postMessage({
        command: 'westUpdate'
    });
}

function manageWorkspace() {
    vscode.postMessage({
        command: 'manageWorkspace'
    });
}

// SDK Management Functions
function listSDKs() {
    // Show loading state
    const resultsDiv = document.getElementById('sdkListResults');
    const contentDiv = document.getElementById('sdkListContent');

    if (resultsDiv && contentDiv) {
        resultsDiv.style.display = 'block';
        contentDiv.innerHTML = '<div style="display: flex; align-items: center; gap: 8px; padding: 10px;"><div class="loading-spinner"></div><span>Loading SDK information...</span></div>';
    }

    vscode.postMessage({
        command: 'listSDKs'
    });
}

function displaySDKList(sdkData) {
    const resultsDiv = document.getElementById('sdkListResults');
    const contentDiv = document.getElementById('sdkListContent');

    if (!resultsDiv || !contentDiv) {
        return;
    }

    resultsDiv.style.display = 'block';

    if (!sdkData.success) {
        contentDiv.innerHTML = `
            <div style="padding: 15px; border: 1px solid var(--vscode-inputValidation-errorBorder); border-radius: 6px; background-color: var(--vscode-inputValidation-errorBackground); color: var(--vscode-inputValidation-errorForeground);">
                <strong>Error:</strong> ${sdkData.error || 'Failed to list SDKs'}
            </div>
        `;
        return;
    }

    if (!sdkData.versions || sdkData.versions.length === 0) {
        contentDiv.innerHTML = `
            <div style="padding: 15px; border: 1px solid var(--vscode-panel-border); border-radius: 6px; background-color: var(--vscode-editor-background); color: var(--vscode-descriptionForeground); text-align: center;">
                No SDK versions found. Try installing an SDK first.
            </div>
        `;
        return;
    }

    let html = '';
    for (const version of sdkData.versions) {
        html += `
            <div class="sdk-version-card">
                <div class="sdk-version-header">
                    <div class="sdk-version-title">Zephyr SDK ${version.version}</div>
                </div>
                <div class="sdk-path">${version.path}</div>
                
                ${version.installedToolchains && version.installedToolchains.length > 0 ? `
                    <div class="toolchain-section">
                        <div class="toolchain-section-title">Installed Toolchains (${version.installedToolchains.length}):</div>
                        <div class="toolchain-list">
                            ${version.installedToolchains.map(tc => `<span class="toolchain-tag">${tc}</span>`).join('')}
                        </div>
                    </div>
                ` : ''}
                
                ${version.availableToolchains && version.availableToolchains.length > 0 ? `
                    <div class="toolchain-section">
                        <div class="toolchain-section-title">Available Toolchains (${version.availableToolchains.length}):</div>
                        <div class="toolchain-list">
                            ${version.availableToolchains.map(tc => `<span class="toolchain-tag available">${tc}</span>`).join('')}
                        </div>
                    </div>
                ` : ''}
            </div>
        `;
    }

    contentDiv.innerHTML = html;
}

// Workspace Setup Functions - Now direct handlers
function workspaceSetupFromGit() {
    vscode.postMessage({
        command: 'workspaceSetupFromGit'
    });
}

function workspaceSetupFromWestGit() {
    vscode.postMessage({
        command: 'workspaceSetupFromWestGit'
    });
}

function workspaceSetupStandard() {
    vscode.postMessage({
        command: 'workspaceSetupStandard'
    });
}

function workspaceSetupFromCurrentDirectory() {
    vscode.postMessage({
        command: 'workspaceSetupFromCurrentDirectory'
    });
}

function workspaceSetupPicker() {
    vscode.postMessage({
        command: 'workspaceSetupPicker'
    });
}

// Copy to clipboard function from data attribute
function copyToClipboardFromData(element) {
    const text = element.getAttribute('data-command');
    if (!text) {
        console.error('No command data found');
        return;
    }
    copyToClipboard(text, element);
}

// Copy to clipboard function
function copyToClipboard(text, element) {
    // Function to handle feedback
    function showFeedback(success = true) {
        const indicator = element.nextElementSibling;
        if (!indicator || !indicator.classList.contains('copy-indicator')) {
            return;
        }

        const originalText = indicator.textContent;
        const originalColor = indicator.style.color;

        if (success) {
            indicator.textContent = 'Copied!';
            indicator.style.color = 'var(--vscode-terminal-ansiGreen)';
        } else {
            indicator.textContent = 'Failed to copy';
            indicator.style.color = 'var(--vscode-terminal-ansiRed)';
        }

        setTimeout(() => {
            indicator.textContent = originalText;
            indicator.style.color = originalColor;
        }, 2000);
    }

    // Try modern clipboard API first
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
            showFeedback(true);
        }).catch(err => {
            console.error('Clipboard API failed:', err);
            // Try fallback
            tryFallback();
        });
    } else {
        // Use fallback directly
        tryFallback();
    }

    function tryFallback() {
        try {
            const textArea = document.createElement('textarea');
            textArea.value = text;
            textArea.style.position = 'fixed';
            textArea.style.left = '-999999px';
            textArea.style.top = '-999999px';
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();

            const successful = document.execCommand('copy');
            document.body.removeChild(textArea);

            showFeedback(successful);
            if (!successful) {
                console.error('Fallback copy failed');
            }
        } catch (err) {
            console.error('Fallback copy failed:', err);
            showFeedback(false);
        }
    }
}

// Message Listener
window.addEventListener('message', event => {
    const message = event.data;

    if (message.command === 'sdkListResult') {
        displaySDKList(message.data);
    }
});
