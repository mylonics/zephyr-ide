// Workspace Setup Panel Client-Side Logic

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
                    title: 'Verify Winget Installation',
                    desc: 'Ensure the winget package manager is installed. If unavailable, download it from <a href="https://aka.ms/getwinget" style="color: var(--vscode-textLink-foreground);">Microsoft Store</a>'
                },
                {
                    number: 2,
                    title: 'Install Development Tools',
                    desc: 'Install required development tools including CMake, Ninja, Python, Git, and other essential utilities using winget'
                },
                {
                    number: 3,
                    title: 'Configure Environment',
                    desc: 'Update system PATH and environment variables. Restart VS Code to ensure all tools are properly configured'
                }
            ]
        },
        'darwin': {
            steps: [
                {
                    number: 1,
                    title: 'Install Homebrew',
                    desc: 'Install the Homebrew package manager if not already available on your system'
                },
                {
                    number: 2,
                    title: 'Configure Shell PATH',
                    desc: 'Update your shell profile to include Homebrew in the system PATH'
                },
                {
                    number: 3,
                    title: 'Install Development Tools',
                    desc: 'Install essential development tools including CMake, Ninja, Python, and compilation toolchain using brew'
                },
                {
                    number: 4,
                    title: 'Finalize Configuration',
                    desc: 'Ensure Python is in your PATH and restart VS Code to apply all environment changes'
                }
            ]
        },
        'linux': {
            steps: [
                {
                    number: 1,
                    title: 'Install Development Tools',
                    desc: 'Install all required development tools and libraries using the apt package manager'
                },
                {
                    number: 2,
                    title: 'Setup Complete',
                    desc: 'Once installation completes, Zephyr IDE will be ready for development'
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



// Message Listener
window.addEventListener('message', event => {
    const message = event.data;
    
    if (message.command === 'sdkListResult') {
        displaySDKList(message.data);
    }
});
