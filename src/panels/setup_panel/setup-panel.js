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

// Host Tools Functions
function runHostToolsInstall() {
    vscode.postMessage({
        command: 'installHostTools'
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

    // Update the content
    document.getElementById('hostToolsStepsContent').innerHTML = stepsContent;
}

function generateHostToolsStepsContent(platform) {
    const stepsData = {
        'win32': {
            steps: [
                {
                    number: 1,
                    title: 'Verify Winget Installation',
                    desc: 'Ensure the winget package manager is installed. If unavailable, download it from <a href="https://aka.ms/getwinget" style="color: var(--vscode-textLink-foreground);">Microsoft Store</a>',
                    command: 'winget --version'
                },
                {
                    number: 2,
                    title: 'Install Development Tools',
                    desc: 'Install required development tools including CMake, Ninja, Python, Git, and other essential utilities using winget',
                    command: 'winget install Kitware.CMake Ninja-build.Ninja oss-winget.gperf python Git.Git oss-winget.dtc wget 7zip.7zip'
                },
                {
                    number: 3,
                    title: 'Configure Environment',
                    desc: 'Update system PATH and environment variables. Restart VS Code to ensure all tools are properly configured',
                    command: "[System.Environment]::SetEnvironmentVariable('Path', [System.Environment]::GetEnvironmentVariable('Path', 'Machine') + ';C:\\Program Files\\7-Zip', 'Machine')"
                }
            ]
        },
        'darwin': {
            steps: [
                {
                    number: 1,
                    title: 'Install Homebrew',
                    desc: 'Install the Homebrew package manager if not already available on your system',
                    command: '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'
                },
                {
                    number: 2,
                    title: 'Add Brew to Shell PATH',
                    desc: 'Add Homebrew to your shell PATH. Choose the command based on your Mac type:',
                    options: [
                        {
                            title: 'Apple Silicon Macs (M1/M2/M3)',
                            command: '(echo; echo \'eval "$(/opt/homebrew/bin/brew shellenv)"\') >> ~/.zprofile && source ~/.zprofile'
                        },
                        {
                            title: 'Intel Macs',
                            command: '(echo; echo \'eval "$(/usr/local/bin/brew shellenv)"\') >> ~/.zprofile && source ~/.zprofile'
                        }
                    ]
                },
                {
                    number: 3,
                    title: 'Install Development Tools',
                    desc: 'Install essential development tools including CMake, Ninja, Python, and compilation toolchain using brew',
                    command: 'brew install cmake ninja gperf python3 python-tk ccache qemu dtc libmagic wget openocd'
                },
                {
                    number: 4,
                    title: 'Add Python to PATH',
                    desc: 'Ensure Python is in your PATH and restart VS Code to apply all environment changes',
                    command: '(echo; echo \'export PATH="\'$(brew --prefix)\'/opt/python/libexec/bin:$PATH"\') >> ~/.zprofile && source ~/.zprofile'
                }
            ]
        },
        'linux': {
            steps: [
                {
                    number: 1,
                    title: 'Update Package Lists',
                    desc: 'Update the package lists for upgrades and new installations',
                    command: 'sudo apt update'
                },
                {
                    number: 2,
                    title: 'Install Development Tools',
                    desc: 'Install all required development tools and libraries using the apt package manager',
                    command: 'sudo apt install --no-install-recommends git cmake ninja-build gperf ccache dfu-util device-tree-compiler wget python3-dev python3-venv python3-tk xz-utils file make gcc gcc-multilib g++-multilib libsdl2-dev libmagic1'
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
                    ${step.command ? `
                        <div class="step-command">
                            <code class="copyable-command" data-command="${step.command.replace(/"/g, '&quot;')}" onclick="copyToClipboardFromData(this)">${step.command}</code>
                            <span class="copy-indicator">Click to copy</span>
                        </div>
                    ` : ''}
                    ${step.options ? `
                        <div class="step-options">
                            ${step.options.map(option => `
                                <div class="step-option">
                                    <div class="step-option-title">${option.title}</div>
                                    <div class="step-command">
                                        <code class="copyable-command" data-command="${option.command.replace(/"/g, '&quot;')}" onclick="copyToClipboardFromData(this)">${option.command}</code>
                                        <span class="copy-indicator">Click to copy</span>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    ` : ''}
                </div>
            </div>
        `;
    });

    html += '</div>';
    return html;
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

// Initialize host tools content on page load
document.addEventListener('DOMContentLoaded', function () {
    // Get the current platform and initialize content
    const platform = window.navigator.platform.toLowerCase().includes('win') ? 'win32' :
        window.navigator.platform.toLowerCase().includes('mac') ? 'darwin' : 'linux';

    // Initialize steps content
    const stepsContent = generateHostToolsStepsContent(platform);

    const stepsContainer = document.getElementById('hostToolsStepsContent');

    if (stepsContainer) {
        stepsContainer.innerHTML = stepsContent;
    }
});
