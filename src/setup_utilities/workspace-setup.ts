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
import * as fs from "fs-extra";
import * as path from "path";
import { output, executeTaskHelper } from "../utilities/utils";
import { westSelector, WestLocation } from "./west_selector";
import { WorkspaceConfig, GlobalConfig } from "./types";
import { setSetupState, loadExternalSetupState, setWorkspaceState } from "./state-management";
import { westInit, postWorkspaceSetup, setupWestEnvironment } from "./west-operations";
import { getToolsDir, setWorkspaceSettings } from "./workspace-config";

export async function workspaceSetupFromGit(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, globalConfig: GlobalConfig) {
  // Clear all context flags at start
  await clearWorkspaceSetupContextFlags(context, wsConfig);

  const gitUrl = await vscode.window.showInputBox({
    prompt: "Enter the Git repository URL for the Zephyr IDE workspace",
    placeHolder: "https://github.com/mylonics/zephyr-ide-workspace-template.git",
    ignoreFocusOut: true,
    validateInput: (value) => {
      if (!value || value.trim() === "") {
        return "Please enter a valid Git URL";
      }
      if (!value.includes("://")) {
        return "Please enter a valid Git URL (must include protocol)";
      }
      return undefined;
    }
  });

  if (!gitUrl) {
    return false;
  }

  const currentDir = wsConfig.rootPath;
  if (!currentDir) {
    vscode.window.showErrorMessage("No workspace folder open. Please open a folder first.");
    return false;
  }

  output.show();
  output.appendLine(`[SETUP] Cloning Zephyr IDE workspace from: ${gitUrl}`);

  // Set context flag for workspace type selected
  await vscode.commands.executeCommand("setContext", "zephyr-ide.workspaceTypeSelected", true);
  output.appendLine("[SETUP] Workspace type selected: Zephyr IDE Workspace from Git");

  let cmd = `git clone "${gitUrl}" .`;
  let gitCloneRes = await executeTaskHelper("Zephyr IDE: Git Clone", cmd, currentDir);

  if (!gitCloneRes) {
    vscode.window.showErrorMessage("Git clone failed. See terminal for error information.");
    return false;
  }

  output.appendLine(`[SETUP] Git clone completed successfully`);

  // After successful clone, run workspaceSetupFromCurrentDirectory
  return await workspaceSetupFromCurrentDirectory(context, wsConfig, globalConfig);
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

export async function workspaceSetupFromWestGit(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, globalConfig: GlobalConfig) {
  // Clear all context flags at start
  await clearWorkspaceSetupContextFlags(context, wsConfig);

  const gitUrl = await vscode.window.showInputBox({
    prompt: "Enter the Git repository URL for the West workspace",
    placeHolder: "https://github.com/zephyrproject-rtos/example-application.git",
    ignoreFocusOut: true,
    validateInput: (value) => {
      if (!value || value.trim() === "") {
        return "Please enter a valid Git URL";
      }
      if (!value.includes("://")) {
        return "Please enter a valid Git URL (must include protocol)";
      }
      return undefined;
    }
  });

  if (!gitUrl) {
    return false;
  }

  const currentDir = wsConfig.rootPath;
  if (!currentDir) {
    vscode.window.showErrorMessage("No workspace folder open. Please open a folder first.");
    return false;
  }

  output.show();
  output.appendLine(`[SETUP] Setting up West workspace from: ${gitUrl}`);

  // Set context flag for workspace type selected
  await vscode.commands.executeCommand("setContext", "zephyr-ide.workspaceTypeSelected", true);
  output.appendLine("[SETUP] Workspace type selected: West Workspace from Git");

  // Set up the workspace using current directory
  await setSetupState(context, wsConfig, globalConfig, currentDir);

  if (!wsConfig.activeSetupState) {
    vscode.window.showErrorMessage("Failed to setup workspace state.");
    return false;
  }

  // Setup west environment before initialization
  await setupWestEnvironment(context, wsConfig, globalConfig, false);

  // Initialize west with the provided git URL
  let westSelection: WestLocation = {
    path: undefined,
    failed: false,
    gitRepo: gitUrl,
    additionalArgs: ""
  };

  let westInitResult = await westInit(context, wsConfig, globalConfig, false, westSelection);

  if (!westInitResult) {
    vscode.window.showErrorMessage("Failed to initialize west with git repository.");
    return false;
  }
  // Run post-setup process
  postWorkspaceSetup(context, wsConfig, globalConfig, currentDir);
  return true;
}

export async function workspaceSetupStandard(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, globalConfig: GlobalConfig) {
  // Clear all context flags at start
  await clearWorkspaceSetupContextFlags(context, wsConfig);

  const currentDir = wsConfig.rootPath;
  if (!currentDir) {
    vscode.window.showErrorMessage("No workspace folder open. Please open a folder first.");
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

  // Run west selector to create west manifest
  output.appendLine("[SETUP] Running west selector to configure workspace...");
  let westSelection = await westSelector(context, wsConfig);

  if (!westSelection || westSelection.failed) {
    vscode.window.showErrorMessage("West configuration cancelled or failed.");
    return false;
  }

  // If west selector created a manifest, we need to run west init
  if (westSelection.path || westSelection.gitRepo) {
    output.appendLine("[SETUP] Initializing west with selected configuration...");

    // Setup west environment before initialization
    await setupWestEnvironment(context, wsConfig, globalConfig, false);

    let westInitResult = await westInit(context, wsConfig, globalConfig, false, westSelection);

    if (!westInitResult) {
      vscode.window.showErrorMessage("Failed to initialize west workspace.");
      return false;
    }
  }

  // Run post-setup process (same as current directory)
  postWorkspaceSetup(context, wsConfig, globalConfig, currentDir);
  return true;
}

export async function workspaceSetupFromCurrentDirectory(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, globalConfig: GlobalConfig) {
  // Clear all context flags at start
  await clearWorkspaceSetupContextFlags(context, wsConfig);

  const currentDir = wsConfig.rootPath;
  if (!currentDir) {
    vscode.window.showErrorMessage("No workspace folder open. Please open a folder first.");
    return false;
  }

  // Set up the workspace using current directory
  await setSetupState(context, wsConfig, globalConfig, currentDir);

  output.show();
  output.appendLine(`[SETUP] Setting up current directory as Zephyr IDE workspace: ${currentDir}`);

  // Load projects from file
  await vscode.commands.executeCommand("zephyr-ide.load-projects-from-file");

  wsConfig.initialSetupComplete = true;

  // Set context flag for workspace type selected
  await vscode.commands.executeCommand("setContext", "zephyr-ide.workspaceTypeSelected", true);
  output.appendLine("[SETUP] Workspace type selected: Current Directory");



  // Check if .west folder exists
  let westPath = path.join(currentDir, ".west");
  let westExists = fs.pathExistsSync(westPath);
  let using_current_directory_for_install = westExists;
  let westYmlPath;


  if (!westExists) {
    // Look for west.yml file to determine subdirectory
    let westYmlFiles: string[] = [];
    try {
      const searchForWestYml = (dir: string, depth: number = 0): void => {
        if (depth > 3) { return; } // Limit search depth
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
      searchForWestYml(currentDir);
    } catch (error) {
      output.appendLine(`[SETUP] Error searching for west.yml: ${error}`);
    }

    // Create options for user choice
    const setupOptions: vscode.QuickPickItem[] = [];

    // Add west.yml directories found
    if (westYmlFiles.length > 0) {
      setupOptions.push({
        label: "$(folder) Use Local West Workspace",
        description: `Found ${westYmlFiles.length} west.yml file(s) in subdirectories`,
        id: "local-west"
      } as any);
    }

    // Add option to use existing Zephyr installation
    if (globalConfig.setupStateDictionary && Object.keys(globalConfig.setupStateDictionary).length > 0) {
      setupOptions.push({
        label: "$(link) Use Existing Zephyr Installation",
        description: "Use an existing Zephyr installation from another workspace",
        id: "existing-install"
      } as any);
    }


    const selectedOption = await vscode.window.showQuickPick(setupOptions, {
      placeHolder: "How would you like to set up this workspace?",
      ignoreFocusOut: true
    });

    if (!selectedOption) {
      return false;
    }

    switch ((selectedOption as any).id) {
      case "local-west":
        // Handle west.yml selection
        if (westYmlFiles.length === 1) {
          westYmlPath = westYmlFiles[0];
        } else {
          // Multiple west.yml files found
          const subdirOptions = westYmlFiles.map(dir => ({
            label: path.relative(currentDir, dir),
            description: dir
          }));

          const selectedSubdir = await vscode.window.showQuickPick(subdirOptions, {
            placeHolder: "Multiple west.yml files found. Select the west manifest:",
            ignoreFocusOut: true
          });

          if (!selectedSubdir) {
            return false;
          }

          westYmlPath = selectedSubdir.description;
        }
        using_current_directory_for_install = true;
        break;

      case "existing-install":
        // Use existing installation
        const selectedPath = await selectExistingInstallation(wsConfig, globalConfig, "Select an existing Zephyr installation to use for this workspace");
        if (!selectedPath) {
          return false;
        }

        await setSetupState(context, wsConfig, globalConfig, selectedPath);
        vscode.window.showInformationMessage(`Workspace configured to use existing Zephyr installation at: ${selectedPath}`);
        return true;

      default:
        return false;
    }

  }

  if (using_current_directory_for_install) {
    // Check if .venv folder exists - if not, setup west environment
    const venvPath = path.join(currentDir, ".venv");
    if (!fs.pathExistsSync(venvPath)) {
      output.appendLine("[SETUP] No .venv folder found, setting up west environment...");
      await setupWestEnvironment(context, wsConfig, globalConfig, false);
      output.appendLine("[SETUP] Continuing...");
    }

    // Set up the workspace using current directory
    await setSetupState(context, wsConfig, globalConfig, currentDir);
    if (westYmlPath) {
      let westSelection: WestLocation = {
        path: westYmlPath,
        failed: false,
        gitRepo: "",
        additionalArgs: ""
      };

      westInit(context, wsConfig, globalConfig, false, westSelection);
    }
  }
  // Run post-setup process
  postWorkspaceSetup(context, wsConfig, globalConfig, currentDir);
  return true;
}

export async function workspaceSetupGlobalZephyr(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, globalConfig: GlobalConfig) {
  // Clear all context flags at start
  await clearWorkspaceSetupContextFlags(context, wsConfig);

  const globalToolsDir = getToolsDir();

  output.show();
  output.appendLine(`[SETUP] Setting up workspace with global Zephyr install: ${globalToolsDir}`);

  // Set context flag for workspace type selected
  await vscode.commands.executeCommand("setContext", "zephyr-ide.workspaceTypeSelected", true);
  output.appendLine("[SETUP] Workspace type selected: Global Zephyr Installation");

  // Check if global config has a setupState for the global tools directory
  let globalSetupState = await loadExternalSetupState(context, globalConfig, globalToolsDir);

  if (!globalSetupState) {
    // Ask user if they want to create a global installation
    const createGlobal = await vscode.window.showInformationMessage(
      "No global Zephyr installation found. Would you like to create a new global installation?",
      "Yes, Create Global Installation",
      "Cancel"
    );

    if (createGlobal !== "Yes, Create Global Installation") {
      return false;
    }

    output.appendLine(`[SETUP] Creating new global Zephyr installation in: ${globalToolsDir}`);

    // Check if global tools directory contains a .west directory
    const westPath = path.join(globalToolsDir, ".west");
    if (fs.pathExistsSync(westPath)) {
      vscode.window.showErrorMessage(
        `The global tools directory already contains a .west directory. Please remove it first or select a different location.`
      );
      return false;
    }

    // Ensure the global tools directory exists
    try {
      await fs.ensureDir(globalToolsDir);
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to create global tools directory: ${error}`);
      return false;
    }

    // Set up the workspace using global tools directory
    await setSetupState(context, wsConfig, globalConfig, globalToolsDir);

    if (!wsConfig.activeSetupState) {
      vscode.window.showErrorMessage("Failed to setup workspace state.");
      return false;
    }

    // Run west selector to create west manifest
    output.appendLine("[SETUP] Running west selector to configure global installation...");
    let westSelection = await westSelector(context, wsConfig);

    if (!westSelection || westSelection.failed) {
      vscode.window.showErrorMessage("West configuration cancelled or failed.");
      return false;
    }

    // If west selector created a manifest, we need to run west init
    if (westSelection.path || westSelection.gitRepo) {
      output.appendLine("[SETUP] Initializing west with selected configuration...");

      // Setup west environment before initialization
      await setupWestEnvironment(context, wsConfig, globalConfig, false);

      let westInitResult = await westInit(context, wsConfig, globalConfig, false, westSelection);

      if (!westInitResult) {
        vscode.window.showErrorMessage("Failed to initialize west workspace.");
        return false;
      }
    }

    // Run post-setup process

    postWorkspaceSetup(context, wsConfig, globalConfig, globalToolsDir).then(
      result => {
        if (result) {
          vscode.window.showInformationMessage(`Global Zephyr installation created and workspace configured at: ${globalToolsDir}`);
        }
      }
    );
    return true;

  }

  // Global setup state exists, just configure workspace to use it
  await setSetupState(context, wsConfig, globalConfig, globalToolsDir);

  vscode.window.showInformationMessage(`Workspace configured to use existing global Zephyr installation at: ${globalToolsDir}`);
  return true;
}

export async function workspaceSetupCreateNewShared(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, globalConfig: GlobalConfig) {
  // Clear all context flags at start
  await clearWorkspaceSetupContextFlags(context, wsConfig);

  // Prompt user to select a folder for the new shared install
  const selectedFolders = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    title: "Select a folder for the new shared Zephyr installation"
  });

  if (!selectedFolders || selectedFolders.length === 0) {
    return false;
  }

  const selectedPath = selectedFolders[0].fsPath;

  output.show();
  output.appendLine(`[SETUP] Creating new shared Zephyr installation in: ${selectedPath}`);

  // Set context flag for workspace type selected
  await vscode.commands.executeCommand("setContext", "zephyr-ide.workspaceTypeSelected", true);
  output.appendLine("[SETUP] Workspace type selected: New Shared Installation");

  // Check if folder contains a .west directory
  const westPath = path.join(selectedPath, ".west");
  if (fs.pathExistsSync(westPath)) {
    vscode.window.showErrorMessage(
      `The selected folder already contains a .west directory. Please select an empty folder or a different location.`
    );
    return false;
  }

  // Check if folder is not empty (except for common files that are okay)
  try {
    const files = fs.readdirSync(selectedPath);
    const allowedFiles = ['.DS_Store', 'Thumbs.db', 'desktop.ini', '.gitignore', 'README.md'];
    const significantFiles = files.filter(file => !allowedFiles.includes(file));

    if (significantFiles.length > 0) {
      const proceed = await vscode.window.showWarningMessage(
        `The selected folder is not empty. It contains: ${significantFiles.slice(0, 3).join(', ')}${significantFiles.length > 3 ? '...' : ''}. Do you want to continue?`,
        'Continue',
        'Cancel'
      );

      if (proceed !== 'Continue') {
        return false;
      }
    }
  } catch (error) {
    // Folder might not exist, which is fine
    output.appendLine(`[SETUP] Creating directory: ${selectedPath}`);
    await fs.ensureDir(selectedPath);
  }

  // Set up the workspace using selected directory
  await setSetupState(context, wsConfig, globalConfig, selectedPath);

  if (!wsConfig.activeSetupState) {
    vscode.window.showErrorMessage("Failed to setup workspace state.");
    return false;
  }

  // Run west selector to create west manifest
  output.appendLine("[SETUP] Running west selector to configure shared installation...");
  let westSelection = await westSelector(context, wsConfig);

  if (!westSelection || westSelection.failed) {
    vscode.window.showErrorMessage("West configuration cancelled or failed.");
    return false;
  }

  // If west selector created a manifest, we need to run west init
  if (westSelection.path || westSelection.gitRepo) {
    output.appendLine("[SETUP] Initializing west with selected configuration...");

    // Setup west environment before initialization
    await setupWestEnvironment(context, wsConfig, globalConfig, false);

    let westInitResult = await westInit(context, wsConfig, globalConfig, false, westSelection);

    if (!westInitResult) {
      vscode.window.showErrorMessage("Failed to initialize west workspace.");
      return false;
    }
  }

  // Run post-setup process
  postWorkspaceSetup(context, wsConfig, globalConfig, selectedPath).then(
    result => {
      if (result) {
        vscode.window.showInformationMessage(`New shared Zephyr installation created at: ${selectedPath}`);
      }
    }
  );
  return true;
}

async function selectExistingInstallation(wsConfig: WorkspaceConfig, globalConfig: GlobalConfig, placeHolder: string = "Select an existing Zephyr installation"): Promise<string | null> {
  if (!globalConfig.setupStateDictionary) {
    vscode.window.showInformationMessage("No existing Zephyr installations found.");
    return null;
  }

  // Create list of existing installations
  const installOptions: vscode.QuickPickItem[] = [];

  for (const installPath in globalConfig.setupStateDictionary) {
    if (fs.pathExistsSync(installPath)) {
      const setupState = globalConfig.setupStateDictionary[installPath];
      let description = "";

      // Add helpful descriptions
      const versionStr = setupState.zephyrVersion ? String(setupState.zephyrVersion) : "installation";
      if (installPath === getToolsDir()) {
        description = `Global ${versionStr}`;
      } else if (installPath === wsConfig.rootPath) {
        description = `Current ${versionStr}`;
      } else if (setupState.zephyrVersion) {
        description = versionStr;
      } else {
        description = "West installation";
      }

      installOptions.push({
        label: path.basename(installPath),
        description: description,
        detail: installPath
      });
    }
  }

  if (installOptions.length === 0) {
    vscode.window.showInformationMessage("No valid existing Zephyr installations found.");
    return null;
  }

  // Let user select from existing installations
  const selectedInstall = await vscode.window.showQuickPick(installOptions, {
    placeHolder: placeHolder,
    ignoreFocusOut: true
  });

  if (!selectedInstall) {
    return null;
  }

  return selectedInstall.detail!;
}

export async function workspaceSetupUseExisting(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, globalConfig: GlobalConfig) {
  // Clear all context flags at start
  await clearWorkspaceSetupContextFlags(context, wsConfig);

  const selectedPath = await selectExistingInstallation(wsConfig, globalConfig);

  if (!selectedPath) {
    return false;
  }

  output.show();
  output.appendLine(`[SETUP] Setting up workspace with existing Zephyr installation: ${selectedPath}`);

  // Set context flag for workspace type selected
  await vscode.commands.executeCommand("setContext", "zephyr-ide.workspaceTypeSelected", true);
  output.appendLine("[SETUP] Workspace type selected: Existing Zephyr Installation");

  // Set up the workspace using selected directory
  await setSetupState(context, wsConfig, globalConfig, selectedPath);

  vscode.window.showInformationMessage(`Workspace configured to use existing Zephyr installation at: ${selectedPath}`);
  return true;
}

export async function showWorkspaceSetupPicker(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, globalConfig: GlobalConfig) {
  const setupOptions = [
    {
      label: "$(repo-clone) Zephyr IDE Workspace from Git",
      description: "Clone and import a Zephyr IDE workspace from a Git repository",
      id: "zephyr-ide-git"
    },
    {
      label: "$(git-branch) West Workspace from Git",
      description: "Clone a standard west manifest workspace from Git",
      id: "west-git"
    },
    {
      label: "$(folder-opened) Open Current Directory",
      description: "Initialize current directory as Zephyr IDE workspace",
      id: "current-directory"
    },
    {
      label: "$(package) Standard Workspace",
      description: "Create workspace with local Zephyr installation",
      id: "standard"
    },
    {
      label: "$(link) Workspace Using Global Zephyr",
      description: "Create workspace using global Zephyr installation",
      id: "global-zephyr"
    },
    {
      label: "$(folder) Workspace Using External Zephyr",
      description: "Create workspace using external Zephyr installation",
      id: "external-zephyr"
    },
    {
      label: "$(file-directory) Workspace Using Existing Zephyr",
      description: "Create workspace pointing to existing Zephyr folder",
      id: "existing-zephyr"
    }
  ];

  const selectedOption = await vscode.window.showQuickPick(setupOptions, {
    placeHolder: "Select workspace setup option",
    ignoreFocusOut: true
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
        await workspaceSetupFromCurrentDirectory(context, wsConfig, globalConfig);
        break;
      case "standard":
        await workspaceSetupStandard(context, wsConfig, globalConfig);
        break;
      case "global-zephyr":
        await workspaceSetupGlobalZephyr(context, wsConfig, globalConfig);
        break;
      case "external-zephyr":
        await workspaceSetupCreateNewShared(context, wsConfig, globalConfig);
        break;
      case "existing-zephyr":
        await workspaceSetupUseExisting(context, wsConfig, globalConfig);
        break;
      default:
        vscode.window.showErrorMessage("Unknown workspace setup option selected");
    }
  } catch (error) {
    vscode.window.showErrorMessage(`Workspace setup failed: ${error}`);
    output.appendLine(`[SETUP] Error: ${error}`);
  }
}
