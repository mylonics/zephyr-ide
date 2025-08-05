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

// Host Tools Functions
function runHostToolsInstall() {
    vscode.postMessage({
        command: 'installHostTools'
    });
}

function copyHostToolsCommands(platform) {
    vscode.postMessage({
        command: 'copyHostToolsCommands',
        platform: platform
    });
}

function switchHostToolsPlatform(platform) {
    // Update button states
    document.querySelectorAll('.button-small').forEach(btn => {
        btn.classList.remove('active');
    });
    document.getElementById(`platform-${platform}`).classList.add('active');
    
    // Generate content for the selected platform
    const stepsContent = generateHostToolsStepsContent(platform);
    const commandContent = generateHostToolsCommandContent(platform);
    
    // Update the content
    document.getElementById('hostToolsStepsContent').innerHTML = stepsContent;
    
    // Update the command section
    const commandSection = document.querySelector('#hostToolsContent .button').parentElement.previousElementSibling;
    commandSection.innerHTML = commandContent;
    
    // Update the copy button
    const copyButton = document.querySelector('button[onclick*="copyHostToolsCommands"]');
    if (copyButton) {
        const platformMap = { 'win32': 'windows', 'darwin': 'macos', 'linux': 'linux' };
        copyButton.setAttribute('onclick', `copyHostToolsCommands('${platformMap[platform]}')`);
    }
}

function generateHostToolsStepsContent(platform) {
    const stepsData = {
        'win32': {
            steps: [
                {
                    number: 1,
                    title: 'Check Winget Availability',
                    desc: 'Winget package manager needs to be installed. If not available, download from <a href="https://aka.ms/getwinget" style="color: var(--vscode-textLink-foreground);">https://aka.ms/getwinget</a>'
                },
                {
                    number: 2,
                    title: 'Install Dependencies',
                    desc: 'Install required tools (CMake, Ninja, Python, Git, DTC, Wget, 7zip) using winget'
                },
                {
                    number: 3,
                    title: 'Update Environment',
                    desc: 'Ensure 7zip is available in PATH and refresh environment variables. You may need to restart VS Code'
                }
            ]
        },
        'darwin': {
            steps: [
                {
                    number: 1,
                    title: 'Install Homebrew',
                    desc: 'Download and install Homebrew package manager if not already installed'
                },
                {
                    number: 2,
                    title: 'Add Brew to PATH',
                    desc: 'Configure shell profile to include Homebrew in system PATH'
                },
                {
                    number: 3,
                    title: 'Install Dependencies',
                    desc: 'Install development tools (CMake, Ninja, Python, GCC tools, etc.) using brew'
                },
                {
                    number: 4,
                    title: 'Configure Python PATH',
                    desc: 'Add Python to PATH and restart VS Code to ensure all new terminals work correctly'
                }
            ]
        },
        'linux': {
            steps: [
                {
                    number: 1,
                    title: 'Install Dependencies',
                    desc: 'Install all required development tools and libraries using apt package manager'
                },
                {
                    number: 2,
                    title: 'Ready to Go',
                    desc: 'After installation, Zephyr IDE should be ready for development'
                }
            ]
        }
    };
    
    const data = stepsData[platform] || stepsData['win32'];
    let html = '<div class="installation-steps"><h4 style="margin: 15px 0 10px 0; font-size: 13px; font-weight: 600;">Installation Steps:</h4>';
    
    data.steps.forEach(step => {
        html += `
            <div class="step-item">
                <div class="step-number">${step.number}</div>
                <div class="step-content">
                    <div class="step-title">${step.title}</div>
                    <div class="step-desc">${step.desc}</div>
                </div>
            </div>
        `;
    });
    
    html += '</div>';
    return html;
}

function generateHostToolsCommandContent(platform) {
    const commands = {
        'win32': "winget install Kitware.CMake Ninja-build.Ninja oss-winget.gperf python Git.Git oss-winget.dtc wget 7zip.7zip; setx path '%path%;C:\\Program Files\\7-Zip'",
        'darwin': "brew install cmake ninja gperf python3 python-tk ccache qemu dtc libmagic wget openocd",
        'linux': "sudo apt install --no-install-recommends git cmake ninja-build gperf ccache dfu-util device-tree-compiler wget python3-dev python3-venv python3-tk xz-utils file make gcc gcc-multilib g++-multilib libsdl2-dev libmagic1"
    };
    
    const icons = {
        'win32': '🪟',
        'darwin': '🍎',
        'linux': '🐧'
    };
    
    const names = {
        'win32': 'Windows',
        'darwin': 'macOS',
        'linux': 'Linux'
    };
    
    return `
        <h4 style="margin: 0 0 8px 0; font-size: 13px; font-weight: 600; display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 16px;">${icons[platform]}</span>
            ${names[platform]} Installation Command
        </h4>
        <code style="display: block; padding: 10px; background-color: var(--vscode-editor-background); border: 1px solid var(--vscode-panel-border); border-radius: 4px; font-family: monospace; font-size: 11px; word-wrap: break-word; white-space: pre-wrap;">${commands[platform]}</code>
    `;
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
