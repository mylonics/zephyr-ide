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
import * as path from "path";
import * as util from "util";
import * as cp from "child_process";
import * as os from "os";

import { SetupState, WorkspaceConfig } from "../setup_utilities/types";
import { pathdivider } from "../setup_utilities/tools-validation";
import { getToolchainDir } from "../setup_utilities/workspace-config";

// Platform
let platform: NodeJS.Platform = os.platform();

// Arch
let arch: string = os.arch();

// Cache for remote platform detection
let remotePlatformCache: string | undefined = undefined;
let remotePlatformDetected = false;

/**
 * Detect the actual platform when running in a remote environment (WSL, SSH, etc.)
 * This is necessary because os.platform() returns the local OS, not the remote OS
 */
async function detectRemotePlatform(): Promise<string | undefined> {
  if (remotePlatformDetected) {
    return remotePlatformCache;
  }

  remotePlatformDetected = true;

  try {
    // Check if we're in a remote environment
    const remoteName = vscode.env.remoteName;
    if (!remoteName) {
      // Not in a remote environment, use local platform
      remotePlatformCache = undefined;
      return undefined;
    }

    // We're in a remote environment, detect the actual OS
    // Run uname to detect the OS (works on Linux/macOS)
    const result = await executeShellCommand("uname -s", "", false);
    if (result.stdout) {
      const uname = result.stdout.trim().toLowerCase();
      if (uname === "linux") {
        remotePlatformCache = "linux";
        return "linux";
      } else if (uname === "darwin") {
        remotePlatformCache = "darwin";
        return "darwin";
      }
    }

    // If uname fails, try to detect Windows (though unlikely in remote)
    const winResult = await executeShellCommand("ver", "", false);
    if (winResult.stdout && winResult.stdout.toLowerCase().includes("windows")) {
      remotePlatformCache = "win32";
      return "win32";
    }
  } catch (error) {
    // If detection fails, log and fall back to local platform
    output.appendLine(`[PLATFORM] Remote platform detection failed: ${error}`);
  }

  remotePlatformCache = undefined;
  return undefined;
}

export function getPlatformName() {
  // For remote environments, we need to detect asynchronously
  // This synchronous function will return the cached value if available
  if (remotePlatformCache !== undefined) {
    switch (remotePlatformCache) {
      case "darwin":
        return "macos";
      case "linux":
        return "linux";
      case "win32":
        return "windows";
    }
  }

  // Fall back to local platform
  switch (platform) {
    case "darwin":
      return "macos";
    case "linux":
      return "linux";
    case "win32":
      return "windows";
  }
  return;
}

/**
 * Async version of getPlatformName that detects remote platform
 */
export async function getPlatformNameAsync(): Promise<string | undefined> {
  const remotePlatform = await detectRemotePlatform();
  if (remotePlatform !== undefined) {
    switch (remotePlatform) {
      case "darwin":
        return "macos";
      case "linux":
        return "linux";
      case "win32":
        return "windows";
    }
  }

  // Fall back to local platform
  return getPlatformName();
}

export function getPlatformArch() {
  switch (arch) {
    case "x64":
      return "x86_64";
    case "arm64":
      return "aarch64";
  }
  return arch;
}

export function isMacOS() {
  return platform === "darwin";
}

export function getPythonVenvBinaryFolder(setupState: SetupState) {
  if (setupState.env["VIRTUAL_ENV"]) {
    switch (platform) {
      case "win32":
        return path.join(setupState.env["VIRTUAL_ENV"], `Scripts`);
      default:
        return path.join(setupState.env["VIRTUAL_ENV"], `bin`);
    }
  }
  return '';
}

function generatePythonModuleCmdString(setupState: SetupState, cmd: string) {
  return path.join(getPythonVenvBinaryFolder(setupState), "python -m " + cmd);
}

export async function getRootPathFs(first = false) {
  let rootPath = await getRootPath(first);
  if (rootPath && rootPath.fsPath) {
    return rootPath.fsPath;
  }
  return "";
}

export async function getRootPath(first = false) {
  let rootPaths = vscode.workspace.workspaceFolders;
  if (rootPaths === undefined) {
    return;
  } else if (rootPaths.length > 1) {
    if (first) {
      return rootPaths[0].uri;
    }

    const pickOptions: vscode.QuickPickOptions = {
      ignoreFocusOut: true,
      placeHolder: "Select Workspace Root",
    };
    const roots: vscode.QuickPickItem[] = rootPaths.map(x => ({ label: x.name, description: x.uri.fsPath }));

    console.log(rootPaths);
    let selectedRoot = await vscode.window.showQuickPick(roots, pickOptions);
    if (selectedRoot && selectedRoot.description) {
      return vscode.Uri.file(selectedRoot.description);
    }
  } else {
    return rootPaths[0].uri;
  }
}

export async function getLaunchConfigurationByName(wsConfig: WorkspaceConfig, configName: string) {
  let configurations = await getLaunchConfigurations(wsConfig);
  if (!configurations) {
    return;
  }

  for (var config of configurations) {
    if (config.name === configName) {
      return config;
    }
  }
}

export async function selectLaunchConfiguration(wsConfig: WorkspaceConfig) {
  let configurations = await getLaunchConfigurations(wsConfig);
  if (!configurations) {
    return;
  }

  const pickOptions: vscode.QuickPickOptions = {
    ignoreFocusOut: true,
    placeHolder: "Select Launch Configuration",
  };
  let names = configurations.map(x => (x.name));

  return await vscode.window.showQuickPick(names, pickOptions);
}

export async function getLaunchConfigurations(wsConfig: WorkspaceConfig) {
  if (wsConfig.rootPath !== "") {
    let allConfigurations: any[] = [];
    const seenNames = new Set<string>();
    
    // Check if we have a workspace file (.code-workspace)
    if (vscode.workspace.workspaceFile) {
      // Get workspace-level configurations from .code-workspace file
      const workspaceConfig = vscode.workspace.getConfiguration("launch");
      const workspaceConfigurations = workspaceConfig.get<any[]>("configurations") || [];
      for (const config of workspaceConfigurations) {
        allConfigurations.push(config);
        if (config.name) {
          seenNames.add(config.name);
        }
      }
    }
    
    // Also check folder-level configurations from .vscode/launch.json
    if (vscode.workspace.workspaceFolders) {
      for (const folder of vscode.workspace.workspaceFolders) {
        const folderConfig = vscode.workspace.getConfiguration("launch", folder.uri);
        const folderConfigurations = folderConfig.get<any[]>("configurations") || [];
        
        // Add folder configurations, avoiding duplicates based on name
        for (const config of folderConfigurations) {
          if (config.name && !seenNames.has(config.name)) {
            allConfigurations.push(config);
            seenNames.add(config.name);
          } else if (!config.name) {
            // Add configurations without names (though they're technically invalid)
            allConfigurations.push(config);
          }
        }
      }
    }
    
    return allConfigurations.length > 0 ? allConfigurations : undefined;
  }
}


export let output = vscode.window.createOutputChannel("Zephyr IDE");

export function closeTerminals(names: string[]) {
  const terminals = vscode.window.terminals;
  for (let t in terminals) {
    if (terminals[t].name in names) {
      terminals[t].dispose();
    }
  }
}

async function executeTask(task: vscode.Task) {
  const execution = await vscode.tasks.executeTask(task);
  output.appendLine("Starting Task: " + task.name);

  return new Promise<number | undefined>(resolve => {
    let disposable = vscode.tasks.onDidEndTaskProcess(e => {
      if (e.execution.task.name === task.name) {
        disposable.dispose();
        resolve(e.exitCode);
      }
    });
  });
}

export async function executeTaskHelperInPythonEnv(setupState: SetupState | undefined, taskName: string, cmd: string, cwd: string | undefined) {
  if (setupState && isMacOS()) {
    let newCmd = path.join(getPythonVenvBinaryFolder(setupState), cmd);
    return await executeTaskHelper(taskName, newCmd, cwd);
  } else {
    return await executeTaskHelper(taskName, cmd, cwd);
  }
}

export async function executeTaskHelper(taskName: string, cmd: string, cwd: string | undefined) {
  output.appendLine(`Running cmd: ${cmd}`);
  let options: vscode.ShellExecutionOptions = {
    cwd: cwd,
  };

  let exec = new vscode.ShellExecution(cmd, options);

  // Task
  let task = new vscode.Task(
    { type: "zephyr-ide:" + taskName, command: taskName },
    vscode.TaskScope.Workspace,
    taskName,
    "zephyr-ide",
    exec
  );

  let res = await executeTask(task);
  return (res !== undefined && res === 0);
}

export async function executeShellCommandInPythonEnv(cmd: string, cwd: string, setupState: SetupState, display_error = true) {
  let newCmd = generatePythonModuleCmdString(setupState, cmd);
  return executeShellCommand(newCmd, cwd, display_error);
};

export async function executeShellCommand(cmd: string, cwd: string, display_error = true) {
  let exec = util.promisify(cp.exec);
  let res = await exec(cmd, { cwd: cwd }).then(

    value => {
      return { stdout: value.stdout, stderr: value.stderr };
    },
    reason => {
      if (display_error) {
        output.append(reason);
      }
      console.log(JSON.stringify(reason));
      return { stdout: undefined, stderr: reason.stderr };
    }
  );
  return res;
};

export function reloadEnvironmentVariables(context: vscode.ExtensionContext, setupState: SetupState | undefined) {
  context.environmentVariableCollection.persistent = false;
  context.environmentVariableCollection.clear();

  // If no setup state, use system environment variables
  if (!setupState) {
    context.environmentVariableCollection.description = "Using system environment variables";
    return;
  }

  // If setup state exists, IDE will always manage environment variables (no distinction between IDE-managed and external setups)
  // Only set ZEPHYR_SDK_INSTALL_DIR if not already set by user
  if (process.env.ZEPHYR_SDK_INSTALL_DIR) {
    context.environmentVariableCollection.description = "Using user-defined `ZEPHYR_SDK_INSTALL_DIR`";
  } else {
    context.environmentVariableCollection.description = "Zephyr IDE adds `ZEPHYR_SDK_INSTALL_DIR`";
    context.environmentVariableCollection.replace("ZEPHYR_SDK_INSTALL_DIR", getToolchainDir(), { applyAtProcessCreation: true, applyAtShellIntegration: true });
  }

  if (setupState.env["VIRTUAL_ENV"]) {
    context.environmentVariableCollection.description += ", `VIRTUAL_ENV`";
    context.environmentVariableCollection.replace("VIRTUAL_ENV", setupState.env["VIRTUAL_ENV"], { applyAtProcessCreation: true, applyAtShellIntegration: true });
  }

  if (setupState.env["PATH"]) {
    context.environmentVariableCollection.description += ", `Python .venv PATH`";
    context.environmentVariableCollection.prepend("PATH", setupState.env["PATH"], { applyAtProcessCreation: true, applyAtShellIntegration: true });
    context.environmentVariableCollection.description += ", `ZEPHYR_BASE`";
    context.environmentVariableCollection.replace("ZEPHYR_BASE", setupState.zephyrDir, { applyAtProcessCreation: true, applyAtShellIntegration: true });
  }
}

/**
 * Validates if a string is a valid Git URL
 * Supports HTTP/HTTPS URLs and SSH URLs (both git@host:path and ssh://git@host/path formats)
 */
export function validateGitUrl(value: string): string | undefined {
  if (!value || value.trim() === "") {
    return "Please enter a valid Git URL";
  }

  const trimmedValue = value.trim();
  
  // Check for HTTP/HTTPS/SSH with protocol (contains ://)
  if (trimmedValue.includes("://")) {
    // Additional validation for protocol-based URLs
    if (trimmedValue.startsWith("http://") || 
        trimmedValue.startsWith("https://") || 
        trimmedValue.startsWith("ssh://") ||
        trimmedValue.startsWith("git://")) {
      return undefined;
    }
    return "Please enter a valid Git URL (supported protocols: http, https, ssh, git)";
  }
  
  // Check for SSH format: user@host:path (without protocol)
  const sshPattern = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+:[a-zA-Z0-9._/-]+$/;
  if (sshPattern.test(trimmedValue)) {
    return undefined;
  }
  
  return "Please enter a valid Git URL (e.g., https://github.com/user/repo.git or git@github.com:user/repo.git)";
}