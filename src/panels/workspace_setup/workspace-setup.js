// Workspace Setup Panel Client-Side Logic

const vscode = acquireVsCodeApi();
let selectedWorkspaceType = null;
let selectedZephyrInstall = null;
let selectedImportSource = null;

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

// Workspace Selection Functions
function hideWorkspaceOptions() {
    selectedWorkspaceType = null;
    selectedZephyrInstall = null;
    selectedImportSource = null;
    updateButtonStates();
}

function selectWorkspaceType(type) {
    selectedWorkspaceType = type;
    selectedImportSource = null; // Clear import selection
    selectedZephyrInstall = null; // Clear external selection
    
    // Update UI - clear all selections first
    document.querySelectorAll('.option-card').forEach(card => {
        card.classList.remove('selected');
    });
    document.querySelectorAll('.external-option').forEach(option => {
        option.classList.remove('selected');
    });
    event.target.closest('.option-card').classList.add('selected');
    
    updateButtonStates();
}

function selectZephyrInstall(installType) {
    selectedZephyrInstall = installType;
    selectedWorkspaceType = 'external'; // Set workspace type to external
    selectedImportSource = null; // Clear import selection
    
    // Stop event propagation to prevent card selection
    event.stopPropagation();
    
    // Update UI - clear all selections first
    document.querySelectorAll('.option-card').forEach(card => {
        card.classList.remove('selected');
    });
    document.querySelectorAll('.external-option').forEach(option => {
        option.classList.remove('selected');
    });
    
    // Select the external workspace card and the clicked external option
    document.querySelector('.external-zephyr-card').classList.add('selected');
    event.target.closest('.external-option').classList.add('selected');
    
    updateButtonStates();
}

function selectImportSource(source) {
    selectedImportSource = source;
    selectedWorkspaceType = null; // Clear workspace type selection
    
    // Update UI - clear all selections first
    document.querySelectorAll('.option-card').forEach(card => {
        card.classList.remove('selected');
    });
    event.target.closest('.option-card').classList.add('selected');
    
    updateButtonStates();
}

function updateButtonStates() {
    const createButton = document.getElementById('createWorkspaceButton');
    const createExternalButton = document.getElementById('createExternalWorkspaceButton');
    const importButton = document.getElementById('importWorkspaceButton');
    
    // Hide all buttons first
    createButton.classList.add('hidden');
    createExternalButton.classList.add('hidden');
    importButton.classList.add('hidden');
    
    // Show appropriate button based on selection
    if (selectedWorkspaceType === 'standard') {
        createButton.classList.remove('hidden');
    } else if (selectedWorkspaceType === 'external' && selectedZephyrInstall) {
        createExternalButton.classList.remove('hidden');
    } else if (selectedImportSource) {
        importButton.classList.remove('hidden');
    }
}

function createWorkspace() {
    if (selectedWorkspaceType === 'standard') {
        vscode.postMessage({
            command: 'createWorkspace',
            type: 'standard'
        });
    }
}

function createExternalWorkspace() {
    if (selectedWorkspaceType === 'external' && selectedZephyrInstall) {
        vscode.postMessage({
            command: 'createWorkspace',
            type: 'external',
            zephyrInstall: selectedZephyrInstall
        });
    }
}

function importWorkspace() {
    if (selectedImportSource) {
        vscode.postMessage({
            command: 'importWorkspace',
            source: selectedImportSource
        });
    }
}

// Message Listener
window.addEventListener('message', event => {
    const message = event.data;
    
    if (message.command === 'sdkListResult') {
        displaySDKList(message.data);
    }
});
