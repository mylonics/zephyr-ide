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

import * as vscode from "vscode";
import * as os from "os";
import * as fs from "fs-extra";
import * as path from "upath";
import { output, executeTaskHelperInPythonEnv, executeTaskHelper, reloadEnvironmentVariables, getPlatformName, getPlatformNameAsync } from "../utilities/utils";
import { outputInfo, outputWarning, notifyError, notifyWarningWithActions } from "../utilities/output";
import { getModulePathAndVersion, getModuleVersion, isVersionNumberGreaterEqual } from "./modules";
import { westSelector, WestLocation } from "./west_selector";
import { WorkspaceConfig, GlobalConfig, SetupState } from "./types";
import { saveSetupState, setSetupState, setWorkspaceState } from "./state-management";
import { pathdivider } from "./tools-validation";
import { getSetupState, getVenvPath } from "./workspace-config";
import { ensureWestConfigManifest } from "./west-config-parser";

// Test-only override for narrow update
let forceNarrowUpdateForTest = false;

export function setForceNarrowUpdateForTest(value: boolean) {
  forceNarrowUpdateForTest = value;
}

// Python command - will be initialized on first use
let python: string | undefined;

/**
 * Reset the cached Python command (for testing purposes)
 * @internal
 */
export function resetPythonCommand(): void {
  python = undefined;
}

/**
 * Get the appropriate Python command for the current platform
 * In remote environments (WSL, SSH), this detects the remote OS
 * On all platforms, respects VS Code's configured Python interpreter if available
 */
export async function getPythonCommand(): Promise<string> {
  if (python === undefined) {
    // First, try to get the Python interpreter configured in VS Code settings
    const configuration = vscode.workspace.getConfiguration();
    const configuredPython = configuration.get<string>("python.defaultInterpreterPath");
    
    if (configuredPython && configuredPython.trim()) {
      // Expand environment variables in the path (e.g., ${env:HOME})
      // Only allow common safe environment variables to prevent potential security issues
      const safeEnvVars = new Set(['HOME', 'USER', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'PATH']);
      let expandedPath = configuredPython;
      const envVarRegex = /\$\{env:(\w+)\}/g;
      let hadExpansionError = false;
      expandedPath = expandedPath.replace(envVarRegex, (match: string, varName: string) => {
        const value = process.env[varName];
        if (safeEnvVars.has(varName) && value && value.trim()) {
          return value;
        }
        hadExpansionError = true;
        outputWarning("Python Setup", `Environment variable ${varName} not found or not allowed in Python path`);
        // Preserve the original placeholder to avoid creating malformed paths
        return match;
      });
      
      // If expansion failed for any variable, skip using the configured path entirely
      if (!hadExpansionError) {
        // Check if the configured Python executable exists
        if (fs.pathExistsSync(expandedPath)) {
          python = expandedPath;
          outputInfo("Python Setup", `Using configured Python interpreter: ${python}`);
          return python as string;
        } else {
          outputWarning("Python Setup", `Configured Python interpreter not found: ${expandedPath} (original: ${configuredPython}). Falling back to platform default. Ensure the path exists or update python.defaultInterpreterPath.`);
        }
      } else {
        outputWarning("Python Setup", "Skipping configured Python interpreter due to environment variable expansion errors, falling back to default");
      }
    }
    
    // Fall back to platform default
    const platformName = await getPlatformNameAsync();
    python = platformName === "linux" || platformName === "macos" ? "python3" : "python";
    outputInfo("Python Setup", `Using platform default Python: ${python}`);
  }
  return python as string;
}

export function checkWestInit(setupState: SetupState) {
  let westPath = path.join(setupState.setupPath, ".west");
  let res = fs.pathExistsSync(westPath);
  return res;
}

export async function westInit(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, globalConfig: GlobalConfig, solo = true, westSelection?: WestLocation) {
  const setupState = await getSetupState(context, wsConfig);
  if (!setupState || !setupState.setupPath) {
    return;
  }
  let westInited = await checkWestInit(setupState);

  if (westInited) {
    const selection = await notifyWarningWithActions('West Init', 'Zephyr IDE: West already initialized. Call West Update instead. If you would like to reinitialize the .west folder will be deleted', ['Reinitialize', 'Cancel']);
    if (selection !== 'Reinitialize') {
      return true;
    }
  }

  if (westSelection === undefined) {
    westSelection = await westSelector(context, wsConfig);
    if (westSelection === undefined || westSelection.failed) {
      return false;
    }
  }

  let westPath = path.join(setupState.setupPath, ".west");

  setupState.westUpdated = false;
  saveSetupState(context, wsConfig, globalConfig);

  // Delete .west if it already exists 
  if ((await fs.pathExists(westPath))) {
    await fs.rmSync(westPath, { recursive: true, force: true });
  }

  const configuration = vscode.workspace.getConfiguration();
  const target = vscode.ConfigurationTarget.Workspace;

  configuration.update('git.enabled', false, target, false);
  configuration.update('git.path', false, target, false);
  configuration.update('git.autofetch', false, target, false);
  configuration.update('git.autorefresh', false, target, false);

  let cmd;
  if (westSelection.gitRepo) {
    cmd = `west init -m ${westSelection.gitRepo} ${westSelection.additionalArgs}`;
  } else if (westSelection.path === undefined) {
    cmd = `west init ${westSelection.additionalArgs}`;
  } else {
    cmd = `west init -l "${westSelection.path}" ${westSelection.additionalArgs}`;
  }

  setupState.zephyrDir = "";
  let westInitRes = await executeTaskHelperInPythonEnv(setupState, "Zephyr IDE: West Init", cmd, setupState.setupPath);

  if (!westInitRes) {
    notifyError("West Init", "West Init Failed. Check the Zephyr IDE output for details.", { command: cmd });
  } else {
    // Validate .west/config manifest section after init to prevent
    // "manifest file not found: None" errors during subsequent west commands.
    // west init -l can sometimes leave manifest.file or manifest.path empty/None.
    const manifestPath = westSelection.path ? path.basename(westSelection.path) : undefined;
    if (ensureWestConfigManifest(setupState.setupPath, { manifestPath })) {
      outputInfo("West Init", `Repaired .west/config manifest section (setupPath: ${setupState.setupPath})`);
    }
    if (solo) {
      vscode.window.showInformationMessage(`Successfully Completed West Init`);
    }
    saveSetupState(context, wsConfig, globalConfig);
  }

  configuration.update('git.enabled', undefined, target, false);
  configuration.update('git.path', undefined, target, false);
  configuration.update('git.autofetch', undefined, target, false);
  configuration.update('git.autorefresh', undefined, target, false);
  return westInitRes;
}

export async function westUpdate(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, globalConfig: GlobalConfig, solo = true) {
  const setupState = await getSetupState(context, wsConfig);

  // Safety check: ensure .west/config has valid manifest entries before running west update.
  // This prevents "manifest file not found: None" errors if the config was corrupted.
  if (ensureWestConfigManifest(setupState.setupPath)) {
    outputInfo("West Update", `Repaired .west/config manifest section before update (setupPath: ${setupState.setupPath})`);
  }

  setupState.westUpdated = false;
  setupState.zephyrDir = "";
  setupState.zephyrVersion = undefined;
  saveSetupState(context, wsConfig, globalConfig);

  // Read config option from settings.json, but allow test override
  const configuration = vscode.workspace.getConfiguration('zephyr-ide');
  let useNarrowUpdate = configuration.get<boolean>('westNarrowUpdate', false);
  if (forceNarrowUpdateForTest) {
    useNarrowUpdate = true;
  }
  let cmd = useNarrowUpdate ? 'west update --narrow' : 'west update';
  let westUpdateRes = await executeTaskHelperInPythonEnv(setupState, "Zephyr IDE: West Update", cmd, setupState.setupPath);

  if (!westUpdateRes) {
    notifyError("West Update", "West Update Failed. Check the Zephyr IDE output for details.", { command: cmd });
  } else {
    setupState.westUpdated = true;
    let zephyrModuleInfo = await getModulePathAndVersion(setupState, "zephyr");
    if (zephyrModuleInfo) {
      setupState.zephyrDir = zephyrModuleInfo.path;
      setupState.zephyrVersion = await getModuleVersion(zephyrModuleInfo.path);
      outputInfo("West Update", `Zephyr directory set from west list: ${setupState.zephyrDir}`);
    } else {
      outputWarning("West Update", `Could not find zephyr module via 'west list' in setupPath: ${setupState.setupPath}. Trying fallback VERSION file lookup...`);
      // Fallback: check for zephyr/VERSION file in setupPath
      const zephyrVersionFile = path.join(setupState.setupPath, "zephyr", "VERSION");
      if (fs.existsSync(zephyrVersionFile)) {
        try {
          const versionContent = fs.readFileSync(zephyrVersionFile, "utf8");
          // Parse version info
          const majorMatch = versionContent.match(/VERSION_MAJOR\s*=\s*(\d+)/);
          const minorMatch = versionContent.match(/VERSION_MINOR\s*=\s*(\d+)/);
          const patchMatch = versionContent.match(/PATCHLEVEL\s*=\s*(\d+)/);
          const tweakMatch = versionContent.match(/VERSION_TWEAK\s*=\s*(\d+)/);
          const extraMatch = versionContent.match(/EXTRAVERSION\s*=\s*(.*)/);
          let version = "";
          if (majorMatch && minorMatch && patchMatch) {
            version = `${majorMatch[1]}.${minorMatch[1]}.${patchMatch[1]}`;
            if (tweakMatch && tweakMatch[1] !== "0") {
              version += `.${tweakMatch[1]}`;
            }
            if (extraMatch && extraMatch[1].trim()) {
              version += `-${extraMatch[1].trim()}`;
            }
            setupState.zephyrDir = path.join(setupState.setupPath, "zephyr");
            // Parse version string into ZephyrVersionNumber type
            setupState.zephyrVersion = {
              major: majorMatch ? parseInt(majorMatch[1]) : 0,
              minor: minorMatch ? parseInt(minorMatch[1]) : 0,
              patch: patchMatch ? parseInt(patchMatch[1]) : 0,
              tweak: tweakMatch ? parseInt(tweakMatch[1]) : 0,
              extra: extraMatch && extraMatch[1].trim() !== "" ? parseInt(extraMatch[1].trim()) : 0
            };
            outputInfo("West Update", `Zephyr version detected from VERSION file: ${version}`);
          } else {
            notifyError("West Update", "West Update succeeded, but Zephyr VERSION file could not be parsed.");
          }
        } catch (err) {
          notifyError("West Update", "West Update succeeded, but error reading Zephyr VERSION file.");
        }
      } else {
        notifyError("West Update", "West Update succeeded, but Zephyr module information could not be found.");
      }
    }

    reloadEnvironmentVariables(context, setupState);
    saveSetupState(context, wsConfig, globalConfig);
    if (solo) {
      vscode.window.showInformationMessage(`Successfully Completed West Update`);
    }
  }
  return westUpdateRes;
}

export async function installPythonRequirements(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, globalConfig: GlobalConfig, solo = true) {
  const setupState = await getSetupState(context, wsConfig);
  if (!setupState || !setupState.setupPath) {
    return;
  }

  let westInited = await checkWestInit(setupState);

  if (!westInited) {
    notifyError('Python Requirements', 'Zephyr IDE: West is not initialized. Call West Init First');
    return false;
  }

  if (!setupState.westUpdated) {
    notifyError('Python Requirements', 'Zephyr IDE: Please call West Update First');
    return false;
  }

  if (!setupState.zephyrDir) {
    notifyError('Python Requirements', `Zephyr directory not found (setupPath: ${setupState.setupPath}). Please run West Update again.`);
    return false;
  }

  setupState.packagesInstalled = false;
  saveSetupState(context, wsConfig, globalConfig);

  // Install requirements from Zephyr's requirements.txt plus additional packages needed by Zephyr IDE
  // For Zephyr >= 3.8.0, several packages (patool, semver, tqdm) are in requirements.txt
  // For older versions (< 3.8.0), we need to explicitly install them:
  //   - patool: needed for west sdk command to extract SDK archives
  //   - semver: needed by sdk.py (Zephyr IDE's custom west SDK command)
  //   - tqdm: needed by sdk.py for progress bars during SDK downloads
  // dtsh is always needed as it's a Zephyr IDE-specific tool
  // Note: If zephyrVersion is not set, we default to newer behavior (no explicit packages)
  //       to avoid conflicts, as the version should always be set after west update
  let additionalPackages = "dtsh";
  if (setupState.zephyrVersion && !isVersionNumberGreaterEqual(setupState.zephyrVersion, 3, 8, 0)) {
    additionalPackages += " patool semver tqdm";
    outputInfo("Python Requirements", `Adding patool, semver, tqdm explicitly for Zephyr < 3.8.0`);
  }
  
  let cmd = `pip install -r "${path.join(setupState.zephyrDir, "scripts", "requirements.txt")}" -U ${additionalPackages}`;
  let reqRes = await executeTaskHelperInPythonEnv(setupState, "Zephyr IDE: Install Python Requirements", cmd, setupState.setupPath);

  if (!reqRes) {
    notifyError("Python Requirements", "Python Requirement Installation Failed. Check the Zephyr IDE output for details.", { command: cmd });
  } else {
    setupState.packagesInstalled = true;
    saveSetupState(context, wsConfig, globalConfig);
    if (solo) {
      vscode.window.showInformationMessage(`Successfully Installed Python Requirements`);
    }
  }
  return reqRes;
}

export async function setupWestEnvironment(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, globalConfig: GlobalConfig, useExisiting = false) {
  const setupState = await getSetupState(context, wsConfig);
  if (!setupState) {
    return;
  }
  let pythonenv = getVenvPath(setupState.setupPath);
  let env_exists = await fs.pathExists(pythonenv);

  let westEnvironmentSetup: string | undefined = useExisiting ? 'UseExisiting' : 'Reinitialize';
  if ((setupState.pythonEnvironmentSetup || env_exists) && !useExisiting) {
    if (env_exists) {
      westEnvironmentSetup = await notifyWarningWithActions('West Environment', 'Zephyr IDE: Python Env already exists', ['Use Existing', 'Reinitialize', 'Cancel']);
    } else {
      westEnvironmentSetup = await notifyWarningWithActions('West Environment', 'Zephyr IDE: Python Env already setup', ['Reinitialize', 'Cancel']);
    }

    if (westEnvironmentSetup !== 'Reinitialize' && westEnvironmentSetup !== 'Use Existing') {
      return;
    }
  }

  // Show setup progress..
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Setting up West Python Environment",
      cancellable: false,
    },
    async (progress, token) => {
      const currentSetupState = await getSetupState(context, wsConfig);
      if (!currentSetupState) {
        return;
      }
      currentSetupState.pythonEnvironmentSetup = false;
      currentSetupState.env = {};
      saveSetupState(context, wsConfig, globalConfig);

      if (westEnvironmentSetup === "Reinitialize") {
        // Delete python env if it already exists 
        if ((await fs.pathExists(pythonenv))) {
          await fs.rmSync(pythonenv, { recursive: true, force: true });
        }

        // Then create the virtualenv
        const pythonCmd = await getPythonCommand();
        let cmd = `${pythonCmd} -m venv "${pythonenv}"`;
        let res = await executeTaskHelper("Zephyr IDE West Environment Setup", cmd, currentSetupState.setupPath);
        if (!res) {
          notifyError("West Environment", "Unable to create Python Virtual Environment. Check the Zephyr IDE output for details.", { command: cmd });
          return;
        } else {
          outputInfo("West Environment", "Python Virtual Environment created");
        }
      }

      // Report progress
      progress.report({ increment: 5 });

      currentSetupState.env["VIRTUAL_ENV"] = pythonenv;

      // Add env/bin to path
      const platformName = await getPlatformNameAsync();
      if (platformName === "windows") {
        currentSetupState.env["PATH"] = path.join(pythonenv, 'Scripts') + ';';
      } else {
        currentSetupState.env["PATH"] = path.join(pythonenv, 'bin') + ':';
      }

      reloadEnvironmentVariables(context, currentSetupState);

      // Install `west`
      let res = await executeTaskHelperInPythonEnv(currentSetupState, "Zephyr IDE West Environment Setup", `pip install west`, currentSetupState.setupPath);
      if (res) {
        outputInfo("West Environment", "west installed");
      } else {
        notifyError("West Environment", "Unable to install west. Check the Zephyr IDE output for details.");
        return;
      }

      outputInfo("West Environment", "West Python Environment Setup complete!");

      // Setup flag complete
      currentSetupState.pythonEnvironmentSetup = true;
      saveSetupState(context, wsConfig, globalConfig);

      progress.report({ increment: 100 });
      vscode.window.showInformationMessage(`Zephyr IDE: West Python Environment Setup!`);
    }
  );
}

export async function westUpdateWithRequirements(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, globalConfig: GlobalConfig, options: {
  solo?: boolean;
  isWorkspaceSetup?: boolean;
  setupPath?: string;
} = {}) {
  const { solo = true, isWorkspaceSetup = false, setupPath } = options;

  // Add setup-specific output messages
  if (isWorkspaceSetup) {
    outputInfo("Workspace Setup", "Running west update...");
  }

  // Run west update first
  let westUpdateResult = await westUpdate(context, wsConfig, globalConfig, false);
  if (!westUpdateResult) {
    notifyError("Workspace Setup", "West update failed. Check the Zephyr IDE output for details.");
    return false;
  }

  // Set context flag for west update completion (during workspace setup)
  if (isWorkspaceSetup) {
    await vscode.commands.executeCommand("setContext", "zephyr-ide.westUpdateComplete", true);
    outputInfo("Workspace Setup", "West update completed");
  }

  // Add setup-specific output messages
  if (isWorkspaceSetup) {
    outputInfo("Workspace Setup", "Installing Python requirements...");
  }

  // Then install Python requirements
  let pythonReqResult = await installPythonRequirements(context, wsConfig, globalConfig, false);
  if (!pythonReqResult) {
    notifyError("Workspace Setup", "Python requirements installation failed. Check the Zephyr IDE output for details.");
    return false;
  }

  // Set context flag for python requirements installation completion (during workspace setup)
  if (isWorkspaceSetup) {
    await vscode.commands.executeCommand("setContext", "zephyr-ide.pythonRequirementsComplete", true);
    outputInfo("Workspace Setup", "Python requirements installation completed");
  }

  if (solo) {
    if (isWorkspaceSetup && setupPath) {
      // Set context flag for complete workspace setup
      await vscode.commands.executeCommand("setContext", "zephyr-ide.workspaceSetupComplete", true);
      outputInfo("Workspace Setup", "Workspace setup completed successfully");
      vscode.window.showInformationMessage(`Workspace setup completed successfully at: ${setupPath}`);
      // Refresh the west workspace panel to show the new workspace
      vscode.commands.executeCommand('zephyr-ide.update-web-view');
    } else {
      vscode.window.showInformationMessage("Successfully completed West Update with Python requirements installation");
    }
  }
  saveSetupState(context, wsConfig, globalConfig);

  if (!globalConfig.sdkInstalled) {
    return await vscode.commands.executeCommand("zephyr-ide.install-sdk");
  }
  return true;
}

export async function postWorkspaceSetup(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, globalConfig: GlobalConfig, setupPath: string, westSelection: WestLocation | undefined) {
  // Setup west environment before initialization
  const venvPath = getVenvPath(setupPath);
  await setupWestEnvironment(context, wsConfig, globalConfig, fs.pathExistsSync(venvPath));

  if (westSelection && !westSelection.failed) {
    let westInitResult = await westInit(context, wsConfig, globalConfig, false, westSelection);
    if (!westInitResult) {
      notifyError("Workspace Setup", "Failed to initialize west with git repository.");
      return false;
    }
  }

  saveSetupState(context, wsConfig, globalConfig);

  return westUpdateWithRequirements(context, wsConfig, globalConfig, {
    solo: true,
    isWorkspaceSetup: true,
    setupPath: setupPath
  });
}
