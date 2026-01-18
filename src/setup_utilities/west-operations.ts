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
import * as path from "path";
import { output, executeTaskHelperInPythonEnv, executeTaskHelper, reloadEnvironmentVariables, getPlatformName, getPlatformNameAsync } from "../utilities/utils";
import { getModulePathAndVersion, getModuleVersion } from "./modules";
import { westSelector, WestLocation } from "./west_selector";
import { WorkspaceConfig, GlobalConfig, SetupState } from "./types";
import { saveSetupState, setSetupState, setWorkspaceState } from "./state-management";
import { pathdivider } from "./tools-validation";
import { getSetupState, getVenvPath } from "./workspace-config";

// Test-only override for narrow update
let forceNarrowUpdateForTest = false;

export function setForceNarrowUpdateForTest(value: boolean) {
  forceNarrowUpdateForTest = value;
}

// Python command - will be initialized on first use
let python: string | undefined;

/**
 * Get the appropriate Python command for the current platform
 * In remote environments (WSL, SSH), this detects the remote OS
 * On all platforms, respects VS Code's configured Python interpreter if available
 */
async function getPythonCommand(): Promise<string> {
  if (python === undefined) {
    // First, try to get the Python interpreter configured in VS Code settings
    const configuration = vscode.workspace.getConfiguration();
    const configuredPython = configuration.get<string>("python.defaultInterpreterPath");
    
    if (configuredPython && configuredPython.trim()) {
      // Expand environment variables in the path (e.g., ${env:HOME})
      let expandedPath = configuredPython;
      const envVarRegex = /\$\{env:(\w+)\}/g;
      expandedPath = expandedPath.replace(envVarRegex, (_, varName) => {
        return process.env[varName] || "";
      });
      
      // Check if the configured Python executable exists
      if (fs.pathExistsSync(expandedPath)) {
        python = expandedPath;
        output.appendLine(`[SETUP] Using configured Python interpreter: ${python}`);
        return python;
      } else {
        output.appendLine(`[SETUP] Configured Python interpreter not found: ${expandedPath}, falling back to default`);
      }
    }
    
    // Fall back to platform default
    const platformName = await getPlatformNameAsync();
    python = platformName === "linux" || platformName === "macos" ? "python3" : "python";
    output.appendLine(`[SETUP] Using platform default Python: ${python}`);
  }
  return python;
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
    const selection = await vscode.window.showWarningMessage('Zephyr IDE: West already initialized. Call West Update instead. If you would like to reinitialize the .west folder will be deleted', 'Reinitialize', 'Cancel');
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
    cmd = `west init -l ${westSelection.path} ${westSelection.additionalArgs}`;
  }

  setupState.zephyrDir = "";
  let westInitRes = await executeTaskHelperInPythonEnv(setupState, "Zephyr IDE: West Init", cmd, setupState.setupPath);

  if (!westInitRes) {
    vscode.window.showErrorMessage("West Init Failed. See terminal for error information.");
  } else {
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
    vscode.window.showErrorMessage("West Update Failed. See terminal for error information.");
  } else {
    setupState.westUpdated = true;
    let zephyrModuleInfo = await getModulePathAndVersion(setupState, "zephyr");
    if (zephyrModuleInfo) {
      setupState.zephyrDir = zephyrModuleInfo.path;
      setupState.zephyrVersion = await getModuleVersion(zephyrModuleInfo.path);
    } else {
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
            output.appendLine(`[SETUP] Zephyr version detected from VERSION file: ${version}`);
          } else {
            vscode.window.showErrorMessage("West Update succeeded, but Zephyr VERSION file could not be parsed.");
          }
        } catch (err) {
          vscode.window.showErrorMessage("West Update succeeded, but error reading Zephyr VERSION file.");
        }
      } else {
        vscode.window.showErrorMessage("West Update succeeded, but Zephyr module information could not be found.");
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
    vscode.window.showErrorMessage('Zephyr IDE: West is not initialized. Call West Init First');
    return false;
  }

  if (!setupState.westUpdated) {
    vscode.window.showErrorMessage('Zephyr IDE: Please call West Update First');
    return false;
  }


  setupState.packagesInstalled = false;
  saveSetupState(context, wsConfig, globalConfig);

  // Install requirements from Zephyr's requirements.txt plus additional packages needed by Zephyr IDE
  // Note: patool is already in requirements.txt, so we don't include it here to avoid conflicts
  let cmd = `pip install -r ${path.join(setupState.zephyrDir, "scripts", "requirements.txt")} -U dtsh semver tqdm`;
  let reqRes = await executeTaskHelperInPythonEnv(setupState, "Zephyr IDE: Install Python Requirements", cmd, setupState.setupPath);

  if (!reqRes) {
    vscode.window.showErrorMessage("Python Requirement Installation Failed. See terminal for error information.");
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
      westEnvironmentSetup = await vscode.window.showWarningMessage('Zephyr IDE: Python Env already exists', 'Use Existing', 'Reinitialize', 'Cancel');
    } else {
      westEnvironmentSetup = await vscode.window.showWarningMessage('Zephyr IDE: Python Env already setup', 'Reinitialize', 'Cancel');
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
          output.appendLine("[SETUP] Unable to create Python Virtual Environment");
          vscode.window.showErrorMessage("Error installing virtualenv. Check output for more info.");
          return;
        } else {
          output.appendLine("[SETUP] Python Virtual Environment created");
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
        output.appendLine("[SETUP] west installed");
      } else {
        output.appendLine("[SETUP] Unable to install west");
        vscode.window.showErrorMessage("Error installing west. Check output for more info.");
        return;
      }

      output.appendLine("[SETUP] West Python Environment Setup complete!");

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
    output.appendLine("[SETUP] Running west update...");
  }

  // Run west update first
  let westUpdateResult = await westUpdate(context, wsConfig, globalConfig, false);
  if (!westUpdateResult) {
    vscode.window.showErrorMessage("West update failed. Please check the terminal for details.");
    return false;
  }

  // Set context flag for west update completion (during workspace setup)
  if (isWorkspaceSetup) {
    await vscode.commands.executeCommand("setContext", "zephyr-ide.westUpdateComplete", true);
    output.appendLine("[SETUP] West update completed");
  }

  // Add setup-specific output messages
  if (isWorkspaceSetup) {
    output.appendLine("[SETUP] Installing Python requirements...");
  }

  // Then install Python requirements
  let pythonReqResult = await installPythonRequirements(context, wsConfig, globalConfig, false);
  if (!pythonReqResult) {
    vscode.window.showErrorMessage("Python requirements installation failed. Please check the terminal for details.");
    return false;
  }

  // Set context flag for python requirements installation completion (during workspace setup)
  if (isWorkspaceSetup) {
    await vscode.commands.executeCommand("setContext", "zephyr-ide.pythonRequirementsComplete", true);
    output.appendLine("[SETUP] Python requirements installation completed");
  }

  if (solo) {
    if (isWorkspaceSetup && setupPath) {
      // Set context flag for complete workspace setup
      await vscode.commands.executeCommand("setContext", "zephyr-ide.workspaceSetupComplete", true);
      output.appendLine("[SETUP] Workspace setup completed successfully");
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
      vscode.window.showErrorMessage("Failed to initialize west with git repository.");
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
