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
import { output } from "../utilities/utils";
import { westSelector, WestLocation } from "./west_selector";
import { WorkspaceConfig, GlobalConfig } from "./types";
import { setSetupState, loadExternalSetupState } from "./state-management";
import { westInit, postWorkspaceSetup, setupWestEnvironment } from "./west-operations";
import { getToolsDir } from "./workspace-config";

export async function workspaceSetupFromGit(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, globalConfig: GlobalConfig) {
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

  // TODO: Implement git clone and workspace import logic
  vscode.window.showInformationMessage("Zephyr IDE workspace from Git setup is not yet implemented");
  return false;
}

async function clearWorkspaceSetupContextFlags(wsConfig: WorkspaceConfig) {
  wsConfig.initialSetupComplete = false;
  if (wsConfig.activeSetupState) {
    wsConfig.activeSetupState.packagesInstalled = false;
    wsConfig.activeSetupState.pythonEnvironmentSetup = false;
    wsConfig.activeSetupState.westUpdated = false;
  }

}

export async function workspaceSetupFromWestGit(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, globalConfig: GlobalConfig) {
  // Clear all context flags at start
  await clearWorkspaceSetupContextFlags(wsConfig);

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
  await clearWorkspaceSetupContextFlags(wsConfig);

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
  await clearWorkspaceSetupContextFlags(wsConfig);

  const currentDir = wsConfig.rootPath;
  if (!currentDir) {
    vscode.window.showErrorMessage("No workspace folder open. Please open a folder first.");
    return false;
  }

  output.show();
  output.appendLine(`[SETUP] Setting up current directory as Zephyr IDE workspace: ${currentDir}`);

  // Set context flag for workspace type selected
  await vscode.commands.executeCommand("setContext", "zephyr-ide.workspaceTypeSelected", true);
  output.appendLine("[SETUP] Workspace type selected: Current Directory");

  // Check if .west folder exists
  let westPath = path.join(currentDir, ".west");
  let westExists = fs.pathExistsSync(westPath);

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

    if (westYmlFiles.length === 0) {
      const proceed = await vscode.window.showWarningMessage(
        "No .west folder detected and no west.yml found. This directory may not be a west workspace.",
        "Continue Anyway",
        "Cancel"
      );
      if (proceed !== "Continue Anyway") {
        return false;
      }
    } else if (westYmlFiles.length === 1) {
      const useSubdir = await vscode.window.showInformationMessage(
        `Found west.yml in subdirectory: ${path.relative(currentDir, westYmlFiles[0])}. Use this as the workspace root?`,
        "Yes",
        "Use Current Directory",
        "Cancel"
      );
      if (useSubdir === "Cancel") {
        return false;
      } else if (useSubdir === "Yes") {
        // Update workspace config to use subdirectory
        const subdirPath = westYmlFiles[0];
        await setSetupState(context, wsConfig, globalConfig, subdirPath);
        postWorkspaceSetup(context, wsConfig, globalConfig, subdirPath);
        return true;
      }
    } else {
      // Multiple west.yml files found
      const subdirOptions = westYmlFiles.map(dir => ({
        label: path.relative(currentDir, dir),
        description: dir
      }));
      subdirOptions.push({ label: "Use Current Directory", description: currentDir });

      const selectedSubdir = await vscode.window.showQuickPick(subdirOptions, {
        placeHolder: "Multiple west.yml files found. Select the workspace root:",
        ignoreFocusOut: true
      });

      if (!selectedSubdir) {
        return false;
      }

      const selectedPath = selectedSubdir.description;
      await setSetupState(context, wsConfig, globalConfig, selectedPath);
      postWorkspaceSetup(context, wsConfig, globalConfig, selectedPath);
      return true;
    }
  }

  // Set up the workspace using current directory
  await setSetupState(context, wsConfig, globalConfig, currentDir);

  // Run post-setup process
  postWorkspaceSetup(context, wsConfig, globalConfig, currentDir);
  return true;
}

export async function workspaceSetupGlobalZephyr(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, globalConfig: GlobalConfig) {
  // Clear all context flags at start
  await clearWorkspaceSetupContextFlags(wsConfig);

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
  await clearWorkspaceSetupContextFlags(wsConfig);

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

export async function workspaceSetupUseExisting(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, globalConfig: GlobalConfig) {
  // Clear all context flags at start
  await clearWorkspaceSetupContextFlags(wsConfig);

  if (!globalConfig.setupStateDictionary) {
    vscode.window.showInformationMessage("No existing Zephyr installations found.");
    return false;
  }

  // Create list of existing installations
  const installOptions: vscode.QuickPickItem[] = [];

  for (const installPath in globalConfig.setupStateDictionary) {
    if (fs.pathExistsSync(installPath)) {
      const setupState = globalConfig.setupStateDictionary[installPath];
      let description = "";

      // Add helpful descriptions
      if (installPath === getToolsDir()) {
        description = "Global installation";
      } else if (installPath === wsConfig.rootPath) {
        description = "Current workspace";
      } else if (setupState.zephyrVersion) {
        description = `Zephyr ${setupState.zephyrVersion}`;
      } else {
        description = "Zephyr installation";
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
    return false;
  }

  // Let user select from existing installations
  const selectedInstall = await vscode.window.showQuickPick(installOptions, {
    placeHolder: "Select an existing Zephyr installation",
    ignoreFocusOut: true
  });

  if (!selectedInstall) {
    return false;
  }

  const selectedPath = selectedInstall.detail!;

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
