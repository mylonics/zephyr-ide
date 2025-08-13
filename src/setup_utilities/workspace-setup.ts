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

/*

How workspace file works
Low Level Functions:
Post Workspace setup
 - Create venv if needed.
 - Run west init if west selection is not undefined
 - West update with packages

WorkspaceSetupFromCurrentDirectory
  - loadProjectsFromFile
  - Performs a west discovery for west.yml file or .west folder existing.
  - Ask if the user want to use the results from the west Discovery or use existing zephyr installation if the existingZephyrInstallFlag was set
  - If use Existing Install Do WorkspaceSetupOutOfTree
  - Otherwise do a postWorkspaceSetup from the results of the west discovery or a west selection

WorkspaceSetupFromOutofTree
  - Ask User to pick from list of installations
  - Then either call WorkspaceSetupFromCurrentDirectory (with useExternalFlag Disabled and passing in the installDir) if the installation is not initialized.

WorkspaceSetupStandard
 - select current folder
 - WorkspaceSetupFromCurrentDirectory with useExternalInstallFlag Disabled

WorkspaceSetupFromGit
 - Git clone
 - WorkspaceSetupFromCurrentDirectory

WorkspaceSetupFromWestGit
 - Get git url
 - Post Workspace setup with west selection and git url
 */

import * as vscode from "vscode";
import * as fs from "fs-extra";
import * as path from "path";
import { output, executeTaskHelper } from "../utilities/utils";
import { westSelector, WestLocation } from "./west_selector";
import { WorkspaceConfig, GlobalConfig } from "./types";
import { setSetupState, loadExternalSetupState, setWorkspaceState, setGlobalState } from "./state-management";
import { postWorkspaceSetup, } from "./west-operations";
import { getToolsDir } from "./workspace-config";

interface WestDiscoveryResult {
  hasWestFolder: boolean;
  westYmlFiles: string[];
  selectedWestPath?: string;
}

async function discoverWestConfiguration(baseDir: string): Promise<WestDiscoveryResult> {
  // Check if .west folder exists
  const westPath = path.join(baseDir, ".west");
  const hasWestFolder = fs.pathExistsSync(westPath);

  if (hasWestFolder) {
    return { hasWestFolder: true, westYmlFiles: [] };
  }

  // Look for west.yml files in subdirectories
  const westYmlFiles: string[] = [];
  try {
    const searchForWestYml = (dir: string, depth: number = 0): void => {
      if (depth > 1) {
        return;
      } // Limit search depth
      const files = fs.readdirSync(dir);
      for (const file of files) {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory() && depth < 3) {
          searchForWestYml(fullPath, depth + 1);
        } else if (file === "west.yml") {
          westYmlFiles.push(path.dirname(fullPath));
        }
      }
    };
    searchForWestYml(baseDir);
  } catch (error) {
    output.appendLine(`[SETUP] Error searching for west.yml: ${error}`);
  }

  return { hasWestFolder: false, westYmlFiles };
}

async function selectWestConfiguration(baseDir: string, westYmlFiles: string[]) {
  // Check if selected directory directly contains west.yml
  const directWestYml = path.join(baseDir, "west.yml");
  if (fs.pathExistsSync(directWestYml)) {
    vscode.window.showErrorMessage("The selected folder contains a west.yml file directly. Please select a parent directory or a different location.");
    return;
  }

  if (westYmlFiles.length === 0) {
    return; // No west.yml files found, caller should handle west selector
  } else if (westYmlFiles.length === 1) {
    return westYmlFiles[0];
  } else {
    // Multiple west.yml files found
    const subdirOptions = westYmlFiles.map((dir) => ({
      label: path.relative(baseDir, dir),
      description: dir,
    }));

    const selectedSubdir = await vscode.window.showQuickPick(subdirOptions, {
      placeHolder: "Multiple west.yml files found. Select the west manifest:",
      ignoreFocusOut: true,
    });

    if (!selectedSubdir) {
      return;
    }

    return selectedSubdir.description!;
  }
}

async function clearWorkspaceSetupContextFlags(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig) {
  wsConfig.initialSetupComplete = false;
  if (wsConfig.activeSetupState) {
    wsConfig.activeSetupState.packagesInstalled = false;
    wsConfig.activeSetupState.pythonEnvironmentSetup = false;
    wsConfig.activeSetupState.westUpdated = false;
  }
  setWorkspaceState(context, wsConfig);
}

export async function workspaceSetupFromGit(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, globalConfig: GlobalConfig) {
  // Clear all context flags at start
  await clearWorkspaceSetupContextFlags(context, wsConfig);

  const gitUrl = await vscode.window.showInputBox({
    prompt: "Enter the Git repository URL/clone string",
    placeHolder:
      "https://github.com/mylonics/zephyr-ide-workspace-template.git",
    ignoreFocusOut: true,
    validateInput: (value) => {
      if (!value || value.trim() === "") {
        return "Please enter a valid Git URL";
      }
      if (!value.includes("://")) {
        return "Please enter a valid Git URL (must include protocol)";
      }
      return undefined;
    },
  });

  if (!gitUrl) {
    return false;
  }

  const currentDir = wsConfig.rootPath;
  if (!currentDir) {
    vscode.window.showErrorMessage(
      "No workspace folder open. Please open a folder first."
    );
    return false;
  }

  output.show();
  output.appendLine(`[SETUP] Cloning Zephyr IDE workspace from: ${gitUrl}`);

  // Set context flag for workspace type selected
  await vscode.commands.executeCommand(
    "setContext",
    "zephyr-ide.workspaceTypeSelected",
    true
  );
  output.appendLine(
    "[SETUP] Workspace type selected: Zephyr IDE Workspace from Git"
  );

  let cmd = `git clone ${gitUrl} .`;
  let gitCloneRes = await executeTaskHelper("Zephyr IDE: Git Clone", cmd, currentDir);

  if (!gitCloneRes) {
    vscode.window.showErrorMessage("Git clone failed. See terminal for error information.");
    return false;
  }

  output.appendLine(`[SETUP] Git clone completed successfully`);

  // After successful clone, run workspaceSetupFromCurrentDirectory
  return await workspaceSetupFromCurrentDirectory(context, wsConfig, globalConfig, true);
}

export async function workspaceSetupFromWestGit(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, globalConfig: GlobalConfig) {
  // Clear all context flags at start
  await clearWorkspaceSetupContextFlags(context, wsConfig);

  const gitUrl = await vscode.window.showInputBox({
    prompt: "Enter the Git repository URL for the West workspace",
    placeHolder:
      "https://github.com/zephyrproject-rtos/example-application",
    ignoreFocusOut: true,
    validateInput: (value) => {
      if (!value || value.trim() === "") {
        return "Please enter a valid Git URL";
      }
      if (!value.includes("://")) {
        return "Please enter a valid Git URL (must include protocol)";
      }
      return undefined;
    },
  });

  if (!gitUrl) {
    return false;
  }

  // Second quick input for additional west arguments
  const additionalArgs = await vscode.window.showInputBox({
    prompt: "Enter any additional arguments for west init/update (optional)",
    placeHolder: "-mr main",
    ignoreFocusOut: true,
  });

  const currentDir = wsConfig.rootPath;
  if (!currentDir) {
    vscode.window.showErrorMessage(
      "No workspace folder open. Please open a folder first."
    );
    return false;
  }

  output.show();
  output.appendLine(`[SETUP] Setting up West workspace from: ${gitUrl}`);

  // Set context flag for workspace type selected
  await vscode.commands.executeCommand(
    "setContext",
    "zephyr-ide.workspaceTypeSelected",
    true
  );
  output.appendLine("[SETUP] Workspace type selected: West Workspace from Git");

  // Set up the workspace using current directory
  await setSetupState(context, wsConfig, globalConfig, currentDir);

  if (!wsConfig.activeSetupState) {
    vscode.window.showErrorMessage("Failed to setup workspace state.");
    return false;
  }

  // Initialize west with the provided git URL and additional arguments
  let westSelection: WestLocation = {
    path: undefined,
    failed: false,
    gitRepo: gitUrl,
    additionalArgs: additionalArgs || "",
  };

  // Run post-setup process
  postWorkspaceSetup(
    context,
    wsConfig,
    globalConfig,
    currentDir,
    westSelection
  );
  return true;
}

export async function workspaceSetupStandard(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, globalConfig: GlobalConfig) {
  // Clear all context flags at start
  await clearWorkspaceSetupContextFlags(context, wsConfig);

  const currentDir = wsConfig.rootPath;
  if (!currentDir) {
    vscode.window.showErrorMessage(
      "No workspace folder open. Please open a folder first."
    );
    return false;
  }

  output.show();
  output.appendLine(`[SETUP] Creating standard workspace in: ${currentDir}`);

  // Set up the workspace using current directory
  await setSetupState(context, wsConfig, globalConfig, currentDir);

  if (!wsConfig.activeSetupState) {
    vscode.window.showErrorMessage("Failed to setup workspace state.");
    return false;
  }

  workspaceSetupFromCurrentDirectory(context, wsConfig, globalConfig, false);
  return true;
}

/**
 * Handle external installation configuration and setup
 */
async function handleExternalInstallation(
  context: vscode.ExtensionContext,
  wsConfig: WorkspaceConfig,
  globalConfig: GlobalConfig,
  westConfigResult: WestConfigResult
): Promise<boolean> {
  const externalPath = westConfigResult.externalInstallPath!;
  const needsSetup = westConfigResult.externalInstallNeedsSetup;
  output.appendLine(`[SETUP] Using external installation: ${externalPath} (needsSetup=${needsSetup})`);

  await setSetupState(context, wsConfig, globalConfig, externalPath);

  if (needsSetup) {
    const extWestSelection = await westSelector(context, wsConfig);
    if (!extWestSelection || extWestSelection.failed) {
      vscode.window.showErrorMessage("External installation configuration cancelled or failed.");
      return false;
    }
    postWorkspaceSetup(context, wsConfig, globalConfig, externalPath, extWestSelection);
  } else {
    vscode.window.showInformationMessage(`Workspace linked to external Zephyr installation at: ${externalPath}`);
  }

  return true;
}

export async function workspaceSetupFromCurrentDirectory(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, globalConfig: GlobalConfig, giveExternalInstallOption: boolean, installDir?: string) {
  // Clear all context flags at start
  await clearWorkspaceSetupContextFlags(context, wsConfig);

  if (!installDir) {
    installDir = wsConfig.rootPath;
  }
  if (!installDir) {
    vscode.window.showErrorMessage(
      "No workspace folder open. Please open a folder first."
    );
    return false;
  }

  output.show();
  output.appendLine(
    `[SETUP] Setting up current directory as Zephyr IDE workspace: ${installDir}`
  );

  // Load projects from file
  await vscode.commands.executeCommand("zephyr-ide.load-projects-from-file");

  wsConfig.initialSetupComplete = true;

  // Set context flag for workspace type selected
  await vscode.commands.executeCommand("setContext", "zephyr-ide.workspaceTypeSelected", true);
  output.appendLine("[SETUP] Workspace type selected: Current Directory");

  // Use westConfig to handle configuration selection
  const configOptions: WestConfigOptions = {
    showUseWestFolder: true,
    showUseWestYml: true,
    showCreateNewWestYml: true,
    showUseExternalInstallation: giveExternalInstallOption
  };

  const westConfigResult = await westConfig(context, wsConfig, globalConfig, configOptions);

  if (westConfigResult.cancelled) {
    return false;
  }

  // Handle external installation case
  if (westConfigResult.useExternalInstallation) {
    return await handleExternalInstallation(context, wsConfig, globalConfig, westConfigResult);
  }

  // Handle local workspace setup
  await setSetupState(context, wsConfig, globalConfig, installDir);
  postWorkspaceSetup(context, wsConfig, globalConfig, installDir, westConfigResult.westSelection);
  return true;
}

async function getExistingInstallationPicks(wsConfig: WorkspaceConfig, globalConfig: GlobalConfig) {
  if (!globalConfig.setupStateDictionary) {
    vscode.window.showInformationMessage(
      "No existing Zephyr installations found."
    );
    return;
  }

  // Create list of existing installations
  const installOptions: vscode.QuickPickItem[] = [];

  for (const installPath in globalConfig.setupStateDictionary) {
    if (fs.pathExistsSync(installPath)) {
      const setupState = globalConfig.setupStateDictionary[installPath];
      let description = "";

      // Add helpful descriptionsconst
      let versionStr = setupState.zephyrVersion
        ? setupState.zephyrVersion.major +
        "." +
        setupState.zephyrVersion.minor +
        "." +
        setupState.zephyrVersion.patch
        : "installation";
      if (installPath === getToolsDir()) {
        description = `Global Zephyr ${versionStr}`;
      } else if (installPath === wsConfig.rootPath) {
        description = `Current Zephyr ${versionStr}`;
      } else if (setupState.zephyrVersion) {
        description = `Zephyr ` + versionStr;
      } else {
        description = "West installation";
      }

      installOptions.push({
        label: path.basename(installPath),
        description: description,
        detail: installPath,
      });
    }
  }

  if (installOptions.length === 0) {
    vscode.window.showInformationMessage(
      "No valid existing Zephyr installations found."
    );
    return;
  }

  return installOptions;
}


export async function manageWorkspaces(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, globalConfig: GlobalConfig) {
  // Use existing function to get installation options
  const installOptions = await getExistingInstallationPicks(wsConfig, globalConfig);

  if (!installOptions || installOptions.length === 0) {
    return; // getExistingInstallationPicks already shows appropriate message
  }

  // Also add invalid/missing installations for cleanup
  const invalidInstallations: vscode.QuickPickItem[] = [];
  if (globalConfig.setupStateDictionary) {
    for (const installPath in globalConfig.setupStateDictionary) {
      if (!fs.pathExistsSync(installPath)) {
        invalidInstallations.push({
          label: `$(error) ${path.basename(installPath)}`,
          description: "Installation path no longer exists",
          detail: installPath,
        });
      }
    }
  }

  const allOptions = [...installOptions, ...invalidInstallations];

  const selectedInstall = await vscode.window.showQuickPick(allOptions, {
    placeHolder: "Select an installation to manage",
    ignoreFocusOut: true,
  });

  if (!selectedInstall) {
    return;
  }

  const installPath = selectedInstall.detail!;
  const installName = path.basename(installPath);
  const isValidPath = fs.pathExistsSync(installPath);

  // Second quick pick for action selection
  const actionOptions: vscode.QuickPickItem[] = [];

  if (isValidPath) {
    actionOptions.push({
      label: "$(tools) Reconfigure",
      description: "Reconfigure this installation",
      detail: "reconfigure"
    });

    actionOptions.push({
      label: "$(tools) West Update",
      description: "Reinitialze this installation",
      detail: "reinitialize"
    });
  }

  actionOptions.push({
    label: "$(trash) Delete",
    description: "Remove this installation from the registry",
    detail: "delete"
  });

  const selectedAction = await vscode.window.showQuickPick(actionOptions, {
    placeHolder: `What would you like to do with "${installName}"?`,
    ignoreFocusOut: true,
  });

  if (!selectedAction) {
    return;
  }

  if (selectedAction.detail === "reconfigure") {
    await handleReconfigureInstallation(context, wsConfig, globalConfig, installPath);
  } else if (selectedAction.detail === "reinitialize") {
    await postWorkspaceSetup(context, wsConfig, globalConfig, installPath, undefined);
  } else if (selectedAction.detail === "delete") {
    await handleDeleteInstallation(context, globalConfig, installPath, installName);
  }
}

async function handleReconfigureInstallation(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, globalConfig: GlobalConfig, installPath: string) {
  // Set the setup state to the selected installation
  await setSetupState(context, wsConfig, globalConfig, installPath);

  if (!wsConfig.activeSetupState) {
    vscode.window.showErrorMessage("Failed to load installation state for reconfiguration.");
    return;
  }

  // Run west selector to reconfigure
  output.show();
  output.appendLine(`[MANAGE] Reconfiguring installation: ${installPath}`);

  const westSelection = await westSelector(context, wsConfig);

  if (!westSelection || westSelection.failed) {
    vscode.window.showErrorMessage("Reconfiguration cancelled or failed.");
    return;
  }

  // Run post-setup process to apply the reconfiguration
  postWorkspaceSetup(context, wsConfig, globalConfig, installPath, westSelection).then(
    result => {
      if (result) {
        vscode.window.showInformationMessage(`Installation "${path.basename(installPath)}" has been reconfigured successfully.`);
      }
    }
  );
}

async function handleDeleteInstallation(context: vscode.ExtensionContext, globalConfig: GlobalConfig, installPath: string, installName: string) {
  // Confirm deletion
  const confirm = await vscode.window.showWarningMessage(
    `Are you sure you want to remove "${installName}" from the installation registry?\n\nPath: ${installPath}\n\nNote: This will only remove it from the registry, not delete the files.`,
    "Remove from Registry",
    "Cancel"
  );

  if (confirm !== "Remove from Registry") {
    return;
  }

  // Remove from setupStateDictionary
  if (globalConfig.setupStateDictionary) {
    delete globalConfig.setupStateDictionary[installPath];

    // Save updated global config
    await setGlobalState(context, globalConfig);

    vscode.window.showInformationMessage(`Installation "${installName}" has been removed from the registry.`);
    output.appendLine(`[MANAGE] Removed installation from registry: ${installPath}`);
  }
}



export async function showWorkspaceSetupPicker(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, globalConfig: GlobalConfig) {
  const setupOptions = [
    {
      label: "$(repo-clone) Zephyr IDE Workspace from Git",
      description:
        "Clone and import a Zephyr IDE workspace from a Git repository",
      id: "zephyr-ide-git",
    },
    {
      label: "$(git-branch) West Workspace from Git",
      description: "Clone a standard west manifest workspace from Git",
      id: "west-git",
    },
    {
      label: "$(folder-opened) Open Current Directory",
      description: "Initialize current directory as Zephyr IDE workspace",
      id: "current-directory",
    },
    {
      label: "$(package) Standard Workspace",
      description: "Create workspace with local Zephyr installation",
      id: "standard",
    },
  ];

  const selectedOption = await vscode.window.showQuickPick(setupOptions, {
    placeHolder: "Select workspace setup option",
    ignoreFocusOut: true,
  });

  if (!selectedOption) {
    return;
  }

  output.show();

  try {
    switch (selectedOption.id) {
      case "zephyr-ide-git":
        await workspaceSetupFromGit(context, wsConfig, globalConfig);
        break;
      case "west-git":
        await workspaceSetupFromWestGit(context, wsConfig, globalConfig);
        break;
      case "current-directory":
        await workspaceSetupFromCurrentDirectory(
          context,
          wsConfig,
          globalConfig, true
        );
        break;
      case "standard":
        await workspaceSetupStandard(context, wsConfig, globalConfig);
        break;
      default:
        vscode.window.showErrorMessage(
          "Unknown workspace setup option selected"
        );
    }
  } catch (error) {
    vscode.window.showErrorMessage(`Workspace setup failed: ${error}`);
    output.appendLine(`[SETUP] Error: ${error}`);
  }
}

export interface WestConfigOptions {
  showUseWestFolder: boolean;
  showUseWestYml: boolean;
  showCreateNewWestYml: boolean;
  showUseExternalInstallation: boolean;
}

export interface WestConfigResult {
  cancelled: boolean;
  option: 'use-west-folder' | 'use-west-yml' | 'create-new-west-yml' | 'use-external-installation' | null;
  selectedWestPath?: string;
  westSelection?: WestLocation;
  externalInstallPath?: string;
  useExternalInstallation?: boolean;
  externalInstallNeedsSetup?: boolean;
}

/**
 * West Configuration selector that analyzes the current directory for .west folder and west.yml files,
 * then prompts the user with configurable options.
 * 
 * @param context VS Code extension context
 * @param wsConfig Current workspace configuration
 * @param globalConfig Global configuration
 * @param options Configuration options to control which choices are presented to the user
 * @returns Promise resolving to WestConfigResult with user's selection
 */
export async function westConfig(
  context: vscode.ExtensionContext,
  wsConfig: WorkspaceConfig,
  globalConfig: GlobalConfig,
  options?: WestConfigOptions
): Promise<WestConfigResult> {
  // Default options if not provided
  const configOptions: WestConfigOptions = options || {
    showUseWestFolder: true,
    showUseWestYml: true,
    showCreateNewWestYml: true,
    showUseExternalInstallation: true
  };

  const baseDir = wsConfig.rootPath;
  if (!baseDir) {
    vscode.window.showErrorMessage(
      "No workspace folder open. Please open a folder first."
    );
    return { cancelled: true, option: null };
  }

  output.show();
  output.appendLine(`[WEST CONFIG] Analyzing directory: ${baseDir}`);

  // Discover west configuration in the current directory
  const westDiscovery = await discoverWestConfiguration(baseDir);

  // Build list of available options based on discovery and configuration
  const setupOptions: vscode.QuickPickItem[] = [];

  // Option 1: Use .west folder (if it exists and option is enabled)
  if (westDiscovery.hasWestFolder && configOptions.showUseWestFolder) {
    setupOptions.push({
      label: "$(folder) Use .west folder (Recommended)",
      description: "Found existing .west folder in current directory",
      id: "use-west-folder",
    } as any);
  }

  // Option 2: Use west.yml file (if files found and option is enabled)
  if (westDiscovery.westYmlFiles.length > 0 && configOptions.showUseWestYml) {
    const fileCount = westDiscovery.westYmlFiles.length;
    const subDirStr = fileCount === 1
      ? path.relative(baseDir, westDiscovery.westYmlFiles[0])
      : "subdirectories";

    setupOptions.push({
      label: "$(file-code) Use west.yml file",
      description: `Found ${fileCount} west.yml file(s) in ${subDirStr}`,
      id: "use-west-yml",
    } as any);
  }

  // Option 3: Create new west.yml from template (if option is enabled)
  if (configOptions.showCreateNewWestYml) {
    setupOptions.push({
      label: "$(new-file) Create new west.yml",
      description: "Create west.yml from template using west selector",
      id: "create-new-west-yml",
    } as any);
  }

  // Option 4: Use external Zephyr installation (if available and option is enabled)
  if (configOptions.showUseExternalInstallation) { // always allow; submenu will handle availability
    setupOptions.push({
      label: "$(link) Use external Zephyr installation",
      description: "Use an existing Zephyr installation from another workspace",
      id: "use-external-installation",
    } as any);
  }

  // If no options are available, show error
  if (setupOptions.length === 0) {
    vscode.window.showErrorMessage(
      "No west configuration options available. Consider creating a new west.yml file or opening a different directory."
    );
    return { cancelled: true, option: null };
  }

  // Show options to user
  const selectedOption = await vscode.window.showQuickPick(setupOptions, {
    placeHolder: "How would you like to configure west for this workspace?",
    ignoreFocusOut: true,
  });

  if (!selectedOption) {
    return { cancelled: true, option: null };
  }

  const optionId = (selectedOption as any).id;
  output.appendLine(`[WEST CONFIG] User selected: ${optionId}`);

  // Handle the selected option
  const result: WestConfigResult = { cancelled: false, option: optionId };

  switch (optionId) {
    case 'use-west-folder':
      // .west folder already exists, nothing more to do
      result.option = 'use-west-folder';
      result.westSelection = undefined; // No west selection needed for existing .west folder
      output.appendLine(`[WEST CONFIG] Using existing .west folder`);
      break;

    case 'use-west-yml':
      // Select from available west.yml files
      const selectedWestPath = await selectWestConfiguration(baseDir, westDiscovery.westYmlFiles);
      if (!selectedWestPath) {
        return { cancelled: true, option: null };
      }
      result.selectedWestPath = selectedWestPath;
      result.option = 'use-west-yml';
      result.westSelection = {
        path: selectedWestPath,
        failed: false,
        gitRepo: "",
        additionalArgs: "",
      };
      output.appendLine(`[WEST CONFIG] Selected west.yml from: ${selectedWestPath}`);
      break;

    case 'create-new-west-yml':
      // Run west selector to create new west.yml
      output.appendLine(`[WEST CONFIG] Running west selector to create new west.yml...`);
      // Ensure setup state is initialized so westSelector has a valid destination path
      if (!wsConfig.activeSetupState || !wsConfig.activeSetupState.setupPath) {
        await setSetupState(context, wsConfig, globalConfig, baseDir);
      }
      const westSelection = await westSelector(context, wsConfig);
      if (!westSelection || westSelection.failed) {
        return { cancelled: true, option: null };
      }
      result.westSelection = westSelection;
      result.option = 'create-new-west-yml';
      output.appendLine(`[WEST CONFIG] West selector completed successfully`);
      break;

    case 'use-external-installation':
      // Build external installation submenu: New, Global, Existing
      const externalOptions: vscode.QuickPickItem[] = [];

      externalOptions.push({
        label: "$(folder-opened) New Installation",
        description: "Create a new Zephyr installation in a chosen folder",
        detail: "new-install"
      });

      const globalPath = getToolsDir();
      externalOptions.push({
        label: "$(link) Global Installation",
        description: "Use or create the global Zephyr installation",
        detail: globalPath
      });

      const existingInstalls = await getExistingInstallationPicks(wsConfig, globalConfig);
      if (existingInstalls && existingInstalls.length > 0) {
        externalOptions.push({
          label: "──────── Existing Installations ────────",
          description: "",
          detail: "__separator__"
        });
        for (const opt of existingInstalls) {
          externalOptions.push({
            label: `$(file-directory) ${opt.label}`,
            description: opt.description,
            detail: opt.detail
          });
        }
      }

      const pickedExternal = await vscode.window.showQuickPick(
        externalOptions.filter(o => o.detail !== "__separator__"),
        { placeHolder: "Select or create an external Zephyr installation", ignoreFocusOut: true }
      );

      if (!pickedExternal) {
        return { cancelled: true, option: null };
      }

      let chosenPath = pickedExternal.detail!;
      let needsSetup = false;
      if (chosenPath === "new-install") {
        const folderUris = await vscode.window.showOpenDialog({
          openLabel: "Select Folder for New Zephyr Installation",
          canSelectFiles: false,
          canSelectFolders: true,
          canSelectMany: false
        });
        if (!folderUris || folderUris.length === 0) {
          return { cancelled: true, option: null };
        }
        chosenPath = folderUris[0].fsPath;
        needsSetup = true;
      } else if (chosenPath === globalPath) {
        needsSetup = !(globalConfig.setupStateDictionary && globalConfig.setupStateDictionary[chosenPath]);
      } else {
        needsSetup = !(globalConfig.setupStateDictionary && globalConfig.setupStateDictionary[chosenPath]);
      }

      result.externalInstallPath = chosenPath;
      result.option = 'use-external-installation';
      result.useExternalInstallation = true;
      result.externalInstallNeedsSetup = needsSetup;
      output.appendLine(`[WEST CONFIG] Selected external installation: ${chosenPath} (needsSetup=${needsSetup})`);
      break;

    default:
      vscode.window.showErrorMessage("Unknown west configuration option selected");
      return { cancelled: true, option: null };
  }

  output.appendLine(`[WEST CONFIG] Configuration completed successfully`);
  return result;
}
