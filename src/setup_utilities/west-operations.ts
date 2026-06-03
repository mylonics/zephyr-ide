/*
Copyright 2025-2026 mylonics 
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
import { output, executeTaskHelperInPythonEnv, executeTaskHelper, reloadEnvironmentVariables, getPythonVenvBinaryFolder, getPlatformNameAsync } from "../utilities/utils";
import { outputInfo, outputWarning, notifyError, notifyWarningWithActions } from "../utilities/output";
import { getModulePathAndVersion, getModuleVersion } from "./modules";
import { westSelector, WestLocation } from "./west_selector";
import { WorkspaceConfig, GlobalConfig, SetupState, formatZephyrVersion } from "./types";
import { saveSetupState, setSetupState, setWorkspaceState } from "./state-management";
import { getSetupState, getSetupStateOrNotify, getVenvPath } from "./workspace-config";
import { ensureWestConfigManifest } from "./west-config-parser";
import { SetupProgressTracker } from "./setup-progress";
import { getDefaultPythonExecutable, loadVendorHostToolsManifest, confirmVendorToolsInstall, installPackagesBatch } from "./host_tools";
import { installZephyrIdeRequirements } from "./zephyr_ide_install";
import { getZephyrIdePipPackages } from "./zephyr_ide_json";

// Test-only override for narrow update
let forceNarrowUpdateForTest = false;

export function setForceNarrowUpdateForTest(value: boolean) {
  forceNarrowUpdateForTest = value;
}

export function isDangerousVenvResetTarget(setupPath: string, venvPath: string): boolean {
  const normalizedSetupPath = path.toUnix(path.resolve(setupPath));
  const normalizedVenvPath = path.toUnix(path.resolve(venvPath));
  const venvPrefix = normalizedVenvPath.endsWith("/") ? normalizedVenvPath : `${normalizedVenvPath}/`;
  const isFilesystemRoot = normalizedVenvPath === path.toUnix(path.parse(normalizedVenvPath).root);
  const isWorkspaceRoot = normalizedSetupPath === normalizedVenvPath;
  const containsWorkspace = normalizedSetupPath.startsWith(venvPrefix);

  return isFilesystemRoot || isWorkspaceRoot || containsWorkspace;
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
 * Compute the Python command to use, given an optional override.
 * Reads VS Code's `python.defaultInterpreterPath` when no override is supplied.
 * Falls back to probing manifest candidates via getDefaultPythonExecutable() so the
 * venv is created with the required version (e.g. python3.12) rather than whatever
 * generic python3/python resolves to on PATH.
 */
async function computePythonCommand(configOverride: string | null | undefined): Promise<string> {
  const configuredPython = configOverride !== undefined
    ? configOverride
    : vscode.workspace.getConfiguration().get<string>("python.defaultInterpreterPath");

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
        outputInfo("Python Setup", `Using configured Python interpreter: ${expandedPath}`);
        return expandedPath;
      } else {
        outputWarning("Python Setup", `Configured Python interpreter not found: ${expandedPath} (original: ${configuredPython}). Falling back to platform default. Ensure the path exists or update python.defaultInterpreterPath.`);
      }
    } else {
      outputWarning("Python Setup", "Skipping configured Python interpreter due to environment variable expansion errors, falling back to default");
    }
  }

  // Fall back to platform default — probe manifest candidates so the venv
  // is created with the required version (e.g. python3.12) rather than
  // whatever generic python3/python resolves to on PATH.
  const defaultCmd = await getDefaultPythonExecutable();
  outputInfo("Python Setup", `Using platform default Python: ${defaultCmd}`);
  return defaultCmd;
}

/**
 * Get the appropriate Python command for the current platform.
 * Always enforces the minimum required version (3.12+) by probing the
 * platform manifest candidate list via getDefaultPythonExecutable().
 * VS Code's python.defaultInterpreterPath is intentionally ignored on the
 * default/cached path — the user may have configured a project venv that
 * predates 3.12.
 *
 * When called without arguments the result is cached for the lifetime of the
 * extension host so repeated calls are cheap.  When an explicit `configOverride`
 * is supplied the cache is bypassed and a fresh determination is always made —
 * this keeps test helpers predictable regardless of cached state.
 *
 * @param configOverride Optional override for the configured Python path.
 *   Pass `null` to explicitly skip VS Code settings and use the platform default.
 */
export async function getPythonCommand(configOverride?: string | null): Promise<string> {
  // When an explicit override is provided, always compute fresh (no cache).
  // This ensures test helpers always observe the expected result without being
  // affected by cached state set by the extension host or a previous call.
  if (configOverride !== undefined) {
    return computePythonCommand(configOverride);
  }

  if (python === undefined) {
    // Always probe for the minimum required version (3.12+) via
    // getDefaultPythonExecutable() so that whatever python3/python resolves to
    // on PATH doesn't accidentally select an older interpreter.
    // VS Code's python.defaultInterpreterPath is intentionally ignored here —
    // the user may have configured a project-specific venv that predates 3.12.
    python = await getDefaultPythonExecutable();
    outputInfo("Python Setup", `Using platform default Python: ${python}`);
  }
  return python as string;
}

export function checkWestInit(setupState: SetupState) {
  const westPath = path.join(setupState.setupPath, ".west");
  const res = fs.pathExistsSync(westPath);
  return res;
}

export async function westInit(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, globalConfig: GlobalConfig, solo = true, westSelection?: WestLocation) {
  const setupState = await getSetupState(context, wsConfig);
  if (!setupState || !setupState.setupPath) {
    return;
  }
  const westInited = await checkWestInit(setupState);

  if (westInited) {
    const selection = await notifyWarningWithActions('West Init', 'Zephyr IDE: West already initialized. Call West Update instead. If you would like to reinitialize the .west folder will be deleted', ['Reinitialize', 'Cancel']);
    if (selection !== 'Reinitialize') {
      return true;
    }
  }

  if (westSelection === undefined) {
    westSelection = await westSelector(context, wsConfig);
    if (westSelection === undefined || westSelection.userAbandoned || westSelection.failed) {
      return false;
    }
  }

  const westPath = path.join(setupState.setupPath, ".west");

  setupState.westUpdated = false;
  await saveSetupState(context, wsConfig, globalConfig);

  // Delete .west if it already exists 
  if ((await fs.pathExists(westPath))) {
    fs.rmSync(westPath, { recursive: true, force: true });
  }

  const configuration = vscode.workspace.getConfiguration();
  const target = vscode.ConfigurationTarget.Workspace;

  await configuration.update('git.enabled', false, target, false);
  await configuration.update('git.autofetch', false, target, false);
  await configuration.update('git.autorefresh', false, target, false);

  let westInitRes: boolean | undefined;
  try {
    let cmd;
    if (westSelection.gitRepo) {
      cmd = `west init -m ${westSelection.gitRepo} ${westSelection.additionalArgs}`;
    } else if (westSelection.path === undefined) {
      cmd = `west init ${westSelection.additionalArgs}`;
    } else {
      cmd = `west init -l "${westSelection.path}" ${westSelection.additionalArgs}`;
    }

    setupState.zephyrDir = "";
    westInitRes = await executeTaskHelperInPythonEnv(setupState, "Zephyr IDE: West Init", cmd, setupState.setupPath);

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
        void vscode.window.showInformationMessage(`West workspace initialized`);
      }
      await saveSetupState(context, wsConfig, globalConfig);
    }
  } finally {
    await configuration.update('git.enabled', undefined, target, false);
    await configuration.update('git.autofetch', undefined, target, false);
    await configuration.update('git.autorefresh', undefined, target, false);
  }
  return westInitRes;
}

export async function westUpdate(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, globalConfig: GlobalConfig, solo = true) {
  const setupState = await getSetupStateOrNotify(context, wsConfig, "West Update");
  if (!setupState) {
    return;
  }

  // Safety check: ensure .west/config has valid manifest entries before running west update.
  // This prevents "manifest file not found: None" errors if the config was corrupted.
  if (ensureWestConfigManifest(setupState.setupPath)) {
    outputInfo("West Update", `Repaired .west/config manifest section before update (setupPath: ${setupState.setupPath})`);
  }

  setupState.westUpdated = false;
  setupState.zephyrDir = "";
  setupState.zephyrVersion = undefined;
  await saveSetupState(context, wsConfig, globalConfig);

  // Read config option from settings.json, but allow test override
  const configuration = vscode.workspace.getConfiguration('zephyr-ide');
  let useNarrowUpdate = configuration.get<boolean>('westNarrowUpdate', false);
  if (forceNarrowUpdateForTest) {
    useNarrowUpdate = true;
  }
  const useKeepDescendants = configuration.get<boolean>('westKeepDescendants', false);
  let cmd = 'west update';
  if (useNarrowUpdate) {
    cmd += ' --narrow';
  }
  if (useKeepDescendants) {
    cmd += ' --keep-descendants';
  }
  const westUpdateRes = await executeTaskHelperInPythonEnv(setupState, "Zephyr IDE: West Update", cmd, setupState.setupPath, true);

  if (!westUpdateRes) {
    notifyError("West Update", "West Update Failed. Check the Zephyr IDE output for details.", { command: cmd });
  } else {
    setupState.westUpdated = true;
    const zephyrModuleInfo = await getModulePathAndVersion(setupState, "zephyr");
    if (zephyrModuleInfo) {
      setupState.zephyrDir = zephyrModuleInfo.path;
      setupState.zephyrVersion = await getModuleVersion(zephyrModuleInfo.path);
      outputInfo("West Update", `Zephyr directory set from west list: ${setupState.zephyrDir}`);
    } else {
      outputWarning("West Update", `Could not find zephyr module via 'west list' in setupPath: ${setupState.setupPath}. Trying fallback VERSION file lookup...`);
      // Fallback: check for zephyr/VERSION file in setupPath
      const zephyrFallbackDir = path.join(setupState.setupPath, "zephyr");
      const fallbackVersion = await getModuleVersion(zephyrFallbackDir);
      if (fallbackVersion) {
        setupState.zephyrDir = zephyrFallbackDir;
        setupState.zephyrVersion = fallbackVersion;
        outputInfo("West Update", `Zephyr version detected from VERSION file: ${formatZephyrVersion(fallbackVersion)}`);
      } else if (fs.existsSync(path.join(zephyrFallbackDir, "VERSION"))) {
        notifyError("West Update", "West Update succeeded, but Zephyr VERSION file could not be parsed.");
      } else {
        notifyError("West Update", "West Update succeeded, but Zephyr module information could not be found.");
      }
    }

    reloadEnvironmentVariables(context, setupState);
    await saveSetupState(context, wsConfig, globalConfig);
    if (solo) {
      void vscode.window.showInformationMessage(`West update complete`);
    }
  }
  return westUpdateRes;
}

export async function installPythonRequirements(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, globalConfig: GlobalConfig, solo = true) {
  const setupState = await getSetupState(context, wsConfig);
  if (!setupState || !setupState.setupPath) {
    return;
  }

  const westInited = await checkWestInit(setupState);

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
  await saveSetupState(context, wsConfig, globalConfig);

  // Install requirements using west packages --pip install (preferred), falling back
  // to direct pip install of Zephyr's requirements.txt plus additional packages.
  // dtsh and pyocd are Zephyr IDE-specific tools always installed. Additional pip
  // packages can be declared in zephyr-ide.json under "pipPackages".
  const additionalPackages = "dtsh pyocd";
  const extraPackages = getZephyrIdePipPackages(wsConfig);
  const allPackages = extraPackages.length > 0
    ? `${additionalPackages} ${extraPackages.join(" ")}`
    : additionalPackages;
  const requirementsTxt = path.join(setupState.zephyrDir, "scripts", "requirements.txt");

  // Try west packages --pip install first
  let reqRes = await executeTaskHelperInPythonEnv(setupState, "Zephyr IDE: Install Python Requirements", "west packages --pip install", setupState.setupPath, true);

  // Fall back to direct pip install if west packages --pip install fails
  if (!reqRes) {
    outputInfo("Python Requirements", "west packages --pip install failed, falling back to pip install -r requirements.txt");
    reqRes = await executeTaskHelperInPythonEnv(setupState, "Zephyr IDE: Install Python Requirements", `pip install -r "${requirementsTxt}" -U ${allPackages}`, setupState.setupPath, true);
  } else {
    // west packages --pip install succeeded, but additional packages are not in
    // requirements.txt, so install them separately
    const additionalRes = await executeTaskHelperInPythonEnv(setupState, "Zephyr IDE: Install pip packages", `pip install ${allPackages}`, setupState.setupPath, true);
    if (!additionalRes) {
      notifyError("Python Requirements", `Failed to install pip packages: ${allPackages}. Check the Zephyr IDE output for details.`);
    }
  }

  if (!reqRes) {
    notifyError("Python Requirements", "Python Requirement Installation Failed. Check the Zephyr IDE output for details.", { command: `west packages --pip install || pip install -r "${requirementsTxt}" -U ${allPackages}` });
  } else {
    setupState.packagesInstalled = true;
    await saveSetupState(context, wsConfig, globalConfig);
    if (solo) {
      void vscode.window.showInformationMessage(`Python requirements installed`);
    }
  }
  return reqRes;
}

export async function setupWestEnvironment(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, globalConfig: GlobalConfig, useExisting = false) {
  const setupState = await getSetupState(context, wsConfig);
  if (!setupState) {
    return;
  }
  let pythonenv = getVenvPath(setupState.setupPath);
  const env_exists = await fs.pathExists(pythonenv);

  let westEnvironmentSetup: string | undefined = useExisting ? 'Use Existing' : 'Reinitialize';
  if ((setupState.pythonEnvironmentSetup || env_exists) && !useExisting) {
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
      await saveSetupState(context, wsConfig, globalConfig);

      if (westEnvironmentSetup === "Reinitialize") {
        // Recompute pythonenv from currentSetupState to avoid stale path
        pythonenv = getVenvPath(currentSetupState.setupPath);

        // Delete python env if it already exists 
        if ((await fs.pathExists(pythonenv))) {
          if (isDangerousVenvResetTarget(currentSetupState.setupPath, pythonenv)) {
            notifyError("West Environment", `Refusing to delete configured Python environment "${pythonenv}" because it is the workspace setup path or one of its parents.`);
            return;
          }
          fs.rmSync(pythonenv, { recursive: true, force: true });
        }

        // Then create the virtualenv
        const pythonCmd = await getPythonCommand();
        const cmd = `${pythonCmd} -m venv "${pythonenv}"`;
        const res = await executeTaskHelper("Zephyr IDE West Environment Setup", cmd, currentSetupState.setupPath);
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

      // Add venv binary folder to PATH
      const venvBin = await getPythonVenvBinaryFolder(currentSetupState);
      if (venvBin) {
        const platformName = await getPlatformNameAsync();
        const separator = platformName === "windows" ? ';' : ':';
        currentSetupState.env["PATH"] = venvBin + separator;
      }

      reloadEnvironmentVariables(context, currentSetupState);

      // Install `west`
      const res = await executeTaskHelperInPythonEnv(currentSetupState, "Zephyr IDE West Environment Setup", `pip install west`, currentSetupState.setupPath);
      if (res) {
        outputInfo("West Environment", "west installed");
      } else {
        notifyError("West Environment", "Unable to install west. Check the Zephyr IDE output for details.");
        return;
      }

      outputInfo("West Environment", "West Python Environment Setup complete!");

      // Setup flag complete
      currentSetupState.pythonEnvironmentSetup = true;
      await saveSetupState(context, wsConfig, globalConfig);

      progress.report({ increment: 100 });
      void vscode.window.showInformationMessage(`Python environment configured`);
    }
  );
}

export async function westUpdateWithRequirements(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, globalConfig: GlobalConfig, options: {
  solo?: boolean;
  isWorkspaceSetup?: boolean;
  setupPath?: string;
} = {}, progressTracker?: SetupProgressTracker) {
  const { solo = true, isWorkspaceSetup = false, setupPath } = options;
  const operationTitle = isWorkspaceSetup ? "Workspace Setup" : "West Update";
  const operationName = isWorkspaceSetup ? "Workspace setup" : "West update";
  try {
    // Add setup-specific output messages
    if (isWorkspaceSetup) {
      outputInfo("Workspace Setup", "Running west update...");
    }

    // Run west update first
    progressTracker?.startStep('west-update');
    const westUpdateResult = await westUpdate(context, wsConfig, globalConfig, false);
    if (!westUpdateResult) {
      progressTracker?.failStep('west-update', 'West update failed');
      notifyError(operationTitle, "West update failed. Check the Zephyr IDE output for details.");
      return false;
    }
    progressTracker?.completeStep('west-update');

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
    progressTracker?.startStep('python-req');
    const pythonReqResult = await installPythonRequirements(context, wsConfig, globalConfig, false);
    if (!pythonReqResult) {
      progressTracker?.failStep('python-req', 'Installation failed');
      notifyError(operationTitle, "Python requirements installation failed. Check the Zephyr IDE output for details.");
      return false;
    }
    progressTracker?.completeStep('python-req');

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
        void vscode.window.showInformationMessage(`Workspace setup completed successfully at: ${setupPath}`);
        // Refresh the west workspace panel to show the new workspace
        void vscode.commands.executeCommand('zephyr-ide.update-web-view');
      } else {
        void vscode.window.showInformationMessage("West update and Python requirements installed");
      }
    }
    await saveSetupState(context, wsConfig, globalConfig);

    progressTracker?.complete('Workspace setup completed successfully!');

    // Install any toolchains/blobs declared in zephyr-ide.json. When
    // toolchains are declared but no SDK is installed yet,
    // installZephyrIdeRequirements bootstraps an SDK install internally.
    try {
      await installZephyrIdeRequirements(wsConfig, globalConfig, context);
    } catch (error) {
      outputWarning("Workspace Setup", `Failed to install zephyr-ide.json requirements: ${error}`);
    }

    // Fall back to the global install-sdk flow only if no SDK is present after
    // installZephyrIdeRequirements has run (e.g. workspace declared no
    // toolchains, so the bootstrap path didn't trigger).
    if (!globalConfig.sdkInstalled) {
      return await vscode.commands.executeCommand("zephyr-ide.install-sdk");
    }
    return true;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (!progressTracker?.failInProgressSteps(detail)) {
      progressTracker?.fail(`${operationName} failed: ${detail}`);
    }
    notifyError(operationTitle, `${operationName} failed unexpectedly: ${detail}`);
    return false;
  }
}

export async function postWorkspaceSetup(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, globalConfig: GlobalConfig, setupPath: string, westSelection: WestLocation | undefined, progressTracker?: SetupProgressTracker) {
  // Create progress tracker if not provided
  const progress = progressTracker || new SetupProgressTracker("Workspace Setup", [
    { id: 'python-env', label: 'Setting up Python environment' },
    { id: 'west-init', label: 'Initializing West workspace' },
    { id: 'west-update', label: 'Running West update' },
    { id: 'python-req', label: 'Installing Python requirements' },
  ]);

  // Setup west environment before initialization
  progress.startStep('python-env');
  const venvPath = getVenvPath(setupPath);
  await setupWestEnvironment(context, wsConfig, globalConfig, fs.pathExistsSync(venvPath));
  progress.completeStep('python-env');

  // Vendor host-tools consent & install — runs after the Python environment is
  // ready (so the platform can be detected) but before west init so any
  // required build tools are present when west first runs.
  if (westSelection && !westSelection.failed && westSelection.vendorHostToolsPath) {
    const vendorPackages = await loadVendorHostToolsManifest(westSelection.vendorHostToolsPath);
    if (vendorPackages.length > 0) {
      const confirmed = await confirmVendorToolsInstall(vendorPackages);
      if (confirmed) {
        outputInfo("Workspace Setup", `Installing ${vendorPackages.length} vendor tool(s)...`);
        await installPackagesBatch(vendorPackages);
      }
    }
  }

  if (westSelection && !westSelection.failed) {
    progress.startStep('west-init');
    const westInitResult = await westInit(context, wsConfig, globalConfig, false, westSelection);
    if (!westInitResult) {
      progress.failStep('west-init', 'West init failed');
      notifyError("Workspace Setup", "Failed to initialize west with git repository.");
      return false;
    }
    progress.completeStep('west-init');

    // `west init` succeeded \u2014 a `.west/` directory now exists at the setup path.
    // Mark the workspace as structurally initialized so subsequent readiness
    // failures (e.g. a flaky `west update`) don't return the user to the
    // Initial Setup page. Readiness is tracked separately via westUpdated.
    if (wsConfig.activeSetupState) {
      wsConfig.activeSetupState.initialized = true;
    }
  } else {
    progress.skipStep('west-init');
  }

  await saveSetupState(context, wsConfig, globalConfig);

  return westUpdateWithRequirements(context, wsConfig, globalConfig, {
    solo: true,
    isWorkspaceSetup: true,
    setupPath: setupPath
  }, progress);
}
