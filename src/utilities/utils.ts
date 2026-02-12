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
import * as fs from "fs";
import * as os from "os";

import { SetupState, WorkspaceConfig } from "../setup_utilities/types";
import { pathdivider } from "../setup_utilities/tools-validation";
import { getToolchainDir } from "../setup_utilities/workspace-config";
import { initOutputChannel, getOutputChannel, outputCommand, outputError, outputInfo, outputRaw, outputLine, ShellCommandResult } from "./output";

// Re-export everything from the new output module so existing
// `import { … } from "../utilities/utils"` statements keep working.
export {
  initOutputChannel,
  getOutputChannel,
  outputInfo,
  outputWarning,
  outputError,
  outputCommand,
  outputRaw,
  outputLine,
  outputFileNotFound,
  outputCommandFailure,
  showOutput,
  notifyError,
  notifyWarning,
  notifyWarningWithActions,
  notifyInfo,
} from "./output";
export type { ShellCommandResult } from "./output";

// Output channel for logging
let outputChannel: vscode.OutputChannel | undefined;

/**
 * Set the output channel for dual logging
 * This should be called once during extension activation
 */
export function setOutputChannel(channel: vscode.OutputChannel): void {
  outputChannel = channel;
  // Also wire up the new centralised output module
  initOutputChannel(channel);
}

/**
 * Helper function to log messages to both output channel and console
 * Useful for messages that need to appear in both Extension Host output and test console
 */
export function logDual(message: string): void {
  if (outputChannel) {
    outputChannel.appendLine(message);
  }
  console.log(message);
}

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
      const uname = result.stdout.toString().trim().toLowerCase();
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
    if (winResult.stdout && winResult.stdout.toString().toLowerCase().includes("windows")) {
      remotePlatformCache = "win32";
      return "win32";
    }
  } catch (error) {
    // If detection fails, log and fall back to local platform
    outputInfo("Platform Detection", `Remote platform detection failed: ${error}`);
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
    // Find the workspace folder that matches the root path for proper configuration scope
    const matchingFolder = vscode.workspace.workspaceFolders?.find(
      folder => folder.uri.fsPath === wsConfig.rootPath
    );

    // Use the matching folder URI, or fall back to the first folder if no match
    const resourceUri = matchingFolder?.uri || vscode.workspace.workspaceFolders?.[0]?.uri;

    // Get launch configurations with proper workspace folder context
    // This handles both .code-workspace files and .vscode/launch.json
    const config = vscode.workspace.getConfiguration("launch", resourceUri);
    const configurations = config.get<any[]>("configurations");

    return configurations;
  }
}


export let output = vscode.window.createOutputChannel("Zephyr IDE");

// Initialize output channel for dual logging
setOutputChannel(output);

export function closeTerminals(names: string[]) {
  const terminals = vscode.window.terminals;
  for (let t in terminals) {
    if (terminals[t].name in names) {
      terminals[t].dispose();
    }
  }
}

async function executeTask(task: vscode.Task) {
  // Register the listener BEFORE executing the task to avoid a race condition
  // where the task completes before the listener is set up.
  const taskDone = new Promise<number | undefined>(resolve => {
    let disposable = vscode.tasks.onDidEndTaskProcess(e => {
      if (e.execution.task.name === task.name) {
        disposable.dispose();
        resolve(e.exitCode);
      }
    });
  });

  const execution = await vscode.tasks.executeTask(task);
  outputLine("Starting Task: " + task.name);

  return taskDone;
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
  outputCommand(taskName, cmd);
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

export async function executeShellCommandInPythonEnv(cmd: string, cwd: string, setupState: SetupState, display_error = true): Promise<ShellCommandResult> {
  // Build environment with venv PATH prepended
  const env = { ...process.env };

  if (setupState.env["PATH"]) {
    const existingPath = env["PATH"] || "";
    env["PATH"] = setupState.env["PATH"] + existingPath;
  }

  if (setupState.env["VIRTUAL_ENV"]) {
    env["VIRTUAL_ENV"] = setupState.env["VIRTUAL_ENV"];
  }

  return executeShellCommand(cmd, cwd, display_error, env);
};

export async function executeShellCommand(cmd: string, cwd: string, display_error = true, env?: NodeJS.ProcessEnv): Promise<ShellCommandResult> {
  let exec = util.promisify(cp.exec);
  const effectiveEnv = env ?? process.env;
  const execOptions: cp.ExecOptions = {
    cwd: cwd,
    encoding: 'utf8',  // Ensure stdout and stderr are strings, not Buffers
    maxBuffer: 10 * 1024 * 1024,  // 10 MB — SDK installs can produce large output
  };

  // Use provided environment or default to process.env
  if (env) {
    execOptions.env = env;
  }

  // On Windows, use PowerShell instead of the default cmd.exe. cmd.exe has
  // subtle quoting and environment-propagation issues that break Python-based
  // CLI tools like west (e.g. "manifest file not found: None"). PowerShell
  // matches the behaviour of VS Code's integrated terminal and task execution.
  // Note: commands that conflict with PowerShell aliases (e.g. wget) should
  // use the explicit .exe extension (e.g. wget.exe) to bypass aliases.
  if (os.platform() === "win32") {
    execOptions.shell = "powershell.exe";

    // process.env is case-insensitive on Windows, but spreading it into a
    // plain object can produce both "PATH" and "Path" keys.  PowerShell
    // reads "Path", so consolidate all PATH-like keys into a single "Path"
    // entry.  This also handles 7-Zip injection in the same pass.
    if (!execOptions.env) {
      execOptions.env = { ...effectiveEnv };
    }
    const envObj = execOptions.env as Record<string, string | undefined>;

    // Gather and remove all PATH-like keys, merging their values
    const pathValues: string[] = [];
    for (const key of Object.keys(envObj)) {
      if (key.toLowerCase() === "path") {
        if (envObj[key]) {
          pathValues.push(envObj[key] as string);
        }
        delete envObj[key];
      }
    }
    const consolidatedPath = pathValues.join(";");

    // Ensure 7-Zip is on PATH so that west/sdk operations that shell out to
    // 7z.exe work immediately.  The directory may be missing from PATH when
    // refreshWindowsPath() rebuilds it from the registry before the
    // post-install step has persisted the entry, or in CI environments.
    const sevenZipDir = "C:\\Program Files\\7-Zip";
    const hasSevenZip = consolidatedPath.split(";").some(
      entry => entry.toLowerCase() === sevenZipDir.toLowerCase()
    );
    if (!hasSevenZip && fs.existsSync(sevenZipDir)) {
      envObj["Path"] = `${sevenZipDir};${consolidatedPath}`;
    } else {
      envObj["Path"] = consolidatedPath;
    }
  }

  let res = await exec(cmd, execOptions).then(

    value => {
      return { stdout: value.stdout as string, stderr: value.stderr as string, cmd, cwd, env: effectiveEnv };
    },
    reason => {
      if (display_error) {
        outputError("Shell Command", `Command failed: ${cmd}`, {
          command: cmd,
          detail: `Exit code: ${reason.code ?? 'unknown'} | cwd: ${cwd || '(not set)'}`,
          stdout: reason.stdout as string | undefined,
          stderr: reason.stderr as string | undefined,
        });
      }
      return { stdout: undefined, stderr: reason.stderr as string | undefined, cmd, cwd, env: effectiveEnv };
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