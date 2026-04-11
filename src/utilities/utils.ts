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
import * as path from "upath";
import * as util from "util";
import * as cp from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as yaml from 'js-yaml';

import { SetupState, WorkspaceConfig } from "../setup_utilities/types";
import { getToolchainDir } from "../setup_utilities/workspace-config";
import { initOutputChannel, getOutputChannel, outputCommand, outputError, outputInfo, outputLine, type ShellCommandResult } from "./output";
export type { ShellCommandResult } from "./output";

/**
 * Set the output channel for dual logging
 * This should be called once during extension activation
 */
export function setOutputChannel(channel: vscode.OutputChannel): void {
  // Wire up the centralised output module
  initOutputChannel(channel);
}

/**
 * Helper function to log messages to both output channel and console
 * Useful for messages that need to appear in both Extension Host output and test console
 */
export function logDual(message: string): void {
  const channel = getOutputChannel();
  if (channel) {
    channel.appendLine(message);
  }
  console.log(message);
}

/**
 * Encode a dynamic string for use in a VS Code TreeItem `id`.
 *
 * VS Code's internal tree-handle construction splits on `/`, so any
 * forward- or back-slash inside an ID segment creates phantom
 * parent/child relationships and incorrect indentation.
 *
 * Uses underscore-based escaping instead of percent-encoding to avoid
 * any chance of VS Code decoding `%2F` back to `/` internally.
 * The escape character `_` is doubled first to keep the mapping
 * collision-free, then `/`, `\`, and `:` are replaced with two-char
 * sequences that can never appear in another encoded segment.
 */
export function sanitizeTreeId(segment: string): string {
  return segment
    .replace(/_/g, '__')
    .replace(/\//g, '_s')
    .replace(/\\/g, '_b')
    .replace(/:/g, '_c');
}

/**
 * Load and parse a YAML file if it exists.
 * Returns the parsed document, or undefined if the file does not exist.
 */
export function loadYamlFile(filePath: string): any | undefined {
  if (fs.existsSync(filePath)) {
    return yaml.load(fs.readFileSync(filePath, 'utf-8'));
  }
  return undefined;
}

// Platform
const platform: NodeJS.Platform = os.platform();

// Arch
const arch: string = os.arch();

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

/**
 * Map a Node.js process.platform string to a user-friendly platform name.
 */
function mapPlatformString(platformStr: string): string | undefined {
  switch (platformStr) {
    case "darwin":
      return "macos";
    case "linux":
      return "linux";
    case "win32":
      return "windows";
  }
  return undefined;
}

export function getPlatformName() {
  // For remote environments, use the cached value if available
  if (remotePlatformCache !== undefined) {
    return mapPlatformString(remotePlatformCache);
  }

  // Fall back to local platform
  return mapPlatformString(platform);
}

/**
 * Async version of getPlatformName that detects remote platform
 */
export async function getPlatformNameAsync(): Promise<string | undefined> {
  const remotePlatform = await detectRemotePlatform();
  if (remotePlatform !== undefined) {
    const mapped = mapPlatformString(remotePlatform);
    if (mapped) {
      return mapped;
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

export function isWSL() {
  return vscode.env.remoteName === "wsl";
}

export async function getPythonVenvBinaryFolder(setupState: SetupState) {
  if (setupState.env["VIRTUAL_ENV"]) {
    const platformName = await getPlatformNameAsync();
    if (platformName === "windows") {
      return path.join(setupState.env["VIRTUAL_ENV"], `Scripts`);
    }
    return path.join(setupState.env["VIRTUAL_ENV"], `bin`);
  }
  return '';
}

export async function getRootPathFs(first = false) {
  const rootPath = await getRootPath(first);
  if (rootPath && rootPath.fsPath) {
    return rootPath.fsPath;
  }
  return undefined;
}

export async function getRootPath(first = false) {
  const rootPaths = vscode.workspace.workspaceFolders;
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

    const selectedRoot = await vscode.window.showQuickPick(roots, pickOptions);
    if (selectedRoot && selectedRoot.description) {
      return vscode.Uri.file(selectedRoot.description);
    }
  } else {
    return rootPaths[0].uri;
  }
}

export async function getLaunchConfigurationByName(wsConfig: WorkspaceConfig, configName: string, folderName?: string) {
  const configurations = await getLaunchConfigurations(wsConfig);
  if (!configurations) {
    return;
  }

  // When a folder is specified, try an exact name+folder match first
  if (folderName) {
    for (const config of configurations) {
      if (config.name === configName && config.workspaceFolder === folderName) {
        return config;
      }
    }
  }

  // Fall back to name-only match (backward compatibility)
  for (const config of configurations) {
    if (config.name === configName) {
      return config;
    }
  }
}

/**
 * Resolve `${input:...}` variable references in a debug configuration.
 *
 * VS Code only resolves input variables for configs it looks up by name from a
 * settings source (launch.json / .code-workspace).  Configs passed as inline
 * `DebugConfiguration` objects to `startDebugging` bypass that resolution.
 * This function fills that gap by collecting the `inputs` array from the
 * appropriate launch scope and resolving each reference.  When a
 * `scopeFolderUri` is provided the folder's inputs take priority, followed
 * by workspace-level inputs and finally global inputs — mirroring VS Code's
 * own resolution order.  When no folder is given (workspace-level config)
 * only workspace and global inputs are consulted.
 *
 * Supports `command`, `promptString`, and `pickString` input types.
 *
 * Returns `undefined` if a referenced input is missing or the user cancels a
 * prompt.
 */
export async function resolveConfigInputs(
  config: vscode.DebugConfiguration,
  scopeFolderUri?: vscode.Uri
): Promise<vscode.DebugConfiguration | undefined> {
  // Collect all ${input:...} ids referenced in the config.
  const inputRefs = new Set<string>();
  (function walk(obj: any) {
    if (typeof obj === 'string') {
      for (const m of obj.matchAll(/\$\{input:([^}]+)\}/g)) {
        inputRefs.add(m[1]);
      }
    } else if (Array.isArray(obj)) {
      obj.forEach(walk);
    } else if (obj && typeof obj === 'object') {
      Object.values(obj).forEach(walk);
    }
  })(config);

  if (inputRefs.size === 0) {
    return config;
  }

  // Gather input definitions scoped the same way VS Code does:
  // folder-level first (only if a scope folder is given), then workspace, then global.
  const allInputs: any[] = [];
  if (scopeFolderUri) {
    allInputs.push(
      ...(vscode.workspace.getConfiguration("launch", scopeFolderUri)
        .inspect<any[]>("inputs")?.workspaceFolderValue ?? [])
    );
  }
  const inspect = vscode.workspace.getConfiguration("launch").inspect<any[]>("inputs");
  allInputs.push(...(inspect?.workspaceValue ?? []), ...(inspect?.globalValue ?? []));

  // First-wins: higher-priority scopes (folder) shadow lower ones (workspace/global).
  const inputById = new Map<string, any>();
  for (const i of allInputs) {
    if (i?.id && !inputById.has(i.id)) {
      inputById.set(i.id, i);
    }
  }

  // Resolve each referenced input to a concrete value.
  const resolved = new Map<string, string>();
  for (const id of inputRefs) {
    const def = inputById.get(id);
    if (!def) {
      vscode.window.showErrorMessage(
        `Undefined input variable '${id}' in launch configuration.`
      );
      return undefined;
    }

    let value: string | undefined;
    switch (def.type) {
      case 'command':
        value = await vscode.commands.executeCommand<string>(def.command, def.args);
        break;
      case 'promptString':
        value = await vscode.window.showInputBox({
          prompt: def.description,
          value: def.default,
          password: def.password,
        });
        break;
      case 'pickString': {
        const rawOptions: any[] = def.options ?? [];
        const items: vscode.QuickPickItem[] = rawOptions.map((opt: any) =>
          typeof opt === 'string'
            ? { label: opt }
            : { label: opt.label ?? opt.value, description: opt.label ? opt.value : undefined }
        );
        const picked = await new Promise<vscode.QuickPickItem | undefined>(resolve => {
          const qp = vscode.window.createQuickPick();
          qp.items = items;
          qp.placeholder = def.description;
          if (def.default) {
            const defaultItem = items.find(item => item.label === def.default || item.description === def.default);
            if (defaultItem) {
              qp.activeItems = [defaultItem];
            }
          }
          qp.onDidAccept(() => { resolve(qp.activeItems[0]); qp.dispose(); });
          qp.onDidHide(() => { resolve(undefined); qp.dispose(); });
          qp.show();
        });
        if (picked) {
          const match = rawOptions.find((opt: any) =>
            typeof opt === 'string'
              ? opt === picked.label
              : (opt.label ?? opt.value) === picked.label
          );
          value = typeof match === 'string' ? match : match?.value;
        }
        break;
      }
      default:
        vscode.window.showWarningMessage(
          `Unsupported input type '${def.type}' for input '${id}' in launch configuration.`
        );
        return undefined;
    }

    if (value === undefined) {
      return undefined; // user cancelled or command returned nothing
    }
    resolved.set(id, value);
  }

  // Substitute resolved values into all string properties.
  function substitute(obj: any): any {
    if (typeof obj === 'string') {
      return obj.replace(
        /\$\{input:([^}]+)\}/g,
        (_match, id) => resolved.get(id) ?? _match
      );
    }
    if (Array.isArray(obj)) {
      return obj.map(substitute);
    }
    if (obj && typeof obj === 'object') {
      const out: any = {};
      for (const [k, v] of Object.entries(obj)) {
        out[k] = substitute(v);
      }
      return out;
    }
    return obj;
  }

  return substitute(config);
}

/**
 * Format a launch target name for display.  In multi-root workspaces the
 * originating workspace folder is appended so the user can distinguish
 * identically-named configurations from different folders.
 */
export function getLaunchTargetDisplayName(targetName: string, targetFolder: string | undefined, fallback: string): string {
  const label = targetName || fallback;
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length <= 1 || !targetFolder) {
    return label;
  }
  return `${label} (${targetFolder})`;
}

export async function selectLaunchConfiguration(wsConfig: WorkspaceConfig): Promise<{ name: string; workspaceFolder?: string } | undefined> {
  const configurations = await getLaunchConfigurations(wsConfig);
  if (!configurations) {
    return;
  }

  const pickOptions: vscode.QuickPickOptions = {
    ignoreFocusOut: true,
    placeHolder: "Select Launch Configuration",
  };
  const isMultiRoot = (vscode.workspace.workspaceFolders?.length ?? 0) > 1;
  const items: vscode.QuickPickItem[] = configurations.map(x => ({
    label: x.name,
    description: isMultiRoot ? x.workspaceFolder : undefined,
  }));

  const selected = await vscode.window.showQuickPick(items, pickOptions);
  if (!selected) {
    return undefined;
  }
  return { name: selected.label, workspaceFolder: selected.description };
}

export async function getLaunchConfigurations(wsConfig: WorkspaceConfig) {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return;
  }

  const allConfigurations: any[] = [];

  // Step 1: Collect per-folder configs (.vscode/launch.json), tagged with the folder name.
  // Process these first so that in a single-folder workspace (where WorkspaceFolder-scoped
  // settings also appear in workspaceValue) folder entries always win over workspace entries.
  const folderLevelNames = new Set<string>();
  const seenFolderConfigs = new Set<string>();
  for (const folder of folders) {
    const folderConfigs = vscode.workspace.getConfiguration("launch", folder.uri)
      .inspect<any[]>("configurations")?.workspaceFolderValue ?? [];
    for (const cfg of folderConfigs) {
      const key = `${folder.name}\0${cfg.name}`;
      if (cfg.name && !seenFolderConfigs.has(key)) {
        seenFolderConfigs.add(key);
        folderLevelNames.add(cfg.name);
        allConfigurations.push({ ...cfg, workspaceFolder: folder.name });
      }
    }
  }

  // Step 2: Collect workspace-level (.code-workspace) then global (user settings) configs.
  // Skip any entry whose name was already collected from a folder scope — this prevents
  // duplicates in a single-folder workspace where both scopes read the same settings file.
  const inspect = vscode.workspace.getConfiguration("launch").inspect<any[]>("configurations");
  const seenNonFolderNames = new Set<string>();
  for (const cfg of [...(inspect?.workspaceValue ?? []), ...(inspect?.globalValue ?? [])]) {
    if (cfg.name && !seenNonFolderNames.has(cfg.name) && !folderLevelNames.has(cfg.name)) {
      seenNonFolderNames.add(cfg.name);
      allConfigurations.push({ ...cfg });
    }
  }

  return allConfigurations.length > 0 ? allConfigurations : undefined;
}


export const output = vscode.window.createOutputChannel("Zephyr IDE");

// Initialize output channel for dual logging
setOutputChannel(output);

export function closeTerminals(names: string[]) {
  const terminals = vscode.window.terminals;
  for (const terminal of terminals) {
    if (names.includes(terminal.name)) {
      terminal.dispose();
    }
  }
}

async function executeTask(task: vscode.Task) {
  // Register the listener BEFORE executing the task to avoid a race condition
  // where the task completes before the listener is set up.
  // Match by task definition (type + command) rather than name to avoid
  // conflicts when multiple tasks share the same display name.
  const taskType = (task.definition as any).type;
  const taskCommand = (task.definition as any).command;
  const taskDone = new Promise<number | undefined>(resolve => {
    const disposable = vscode.tasks.onDidEndTaskProcess(e => {
      const def = e.execution.task.definition as any;
      if (def.type === taskType && def.command === taskCommand) {
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
  if (setupState && (isMacOS() || isWSL())) {
    // On macOS and WSL, VS Code's environmentVariableCollection doesn't
    // reliably propagate to task shells.  Instead of rewriting the command
    // string (which corrupts URLs via path.join), prepend the venv bin
    // directory to PATH in the task's own environment — mirroring what
    // executeShellCommandInPythonEnv already does for child_process calls.
    const env: { [key: string]: string } = {};
    const venvBin = await getPythonVenvBinaryFolder(setupState);
    if (venvBin) {
      env["PATH"] = venvBin + ":" + (process.env["PATH"] || "");
    }
    if (setupState.env["VIRTUAL_ENV"]) {
      env["VIRTUAL_ENV"] = setupState.env["VIRTUAL_ENV"];
    }
    return await executeTaskHelper(taskName, cmd, cwd, env);
  } else {
    return await executeTaskHelper(taskName, cmd, cwd);
  }
}

export async function executeTaskHelper(taskName: string, cmd: string, cwd: string | undefined, env?: { [key: string]: string }) {
  outputCommand(taskName, cmd);
  const options: vscode.ShellExecutionOptions = {
    cwd: cwd,
    ...(env && { env }),
  };

  const exec = new vscode.ShellExecution(cmd, options);

  // Task
  const task = new vscode.Task(
    { type: "zephyr-ide:" + taskName, command: taskName },
    vscode.TaskScope.Workspace,
    taskName,
    "zephyr-ide",
    exec
  );

  const res = await executeTask(task);
  return (res !== undefined && res === 0);
}

export async function executeShellCommandInPythonEnv(cmd: string, cwd: string, setupState: SetupState, display_error = true): Promise<ShellCommandResult> {
  // Build environment with venv PATH prepended
  const env = { ...process.env };

  if (setupState.env["PATH"]) {
    // On Windows, process.env spreads as "Path" (title-case).  We must
    // prepend the venv directory onto the *same* key that already exists,
    // otherwise executeShellCommand's PATH consolidation will see two
    // separate keys and may order the system PATH before the venv PATH,
    // causing the system Python to shadow the venv Python.
    const existingKey = Object.keys(env).find(k => k.toLowerCase() === "path") || "PATH";
    const existingPath = env[existingKey] || "";
    env[existingKey] = setupState.env["PATH"] + existingPath;
  }

  if (setupState.env["VIRTUAL_ENV"]) {
    env["VIRTUAL_ENV"] = setupState.env["VIRTUAL_ENV"];
  }

  return executeShellCommand(cmd, cwd, display_error, env);
};

export async function executeShellCommand(cmd: string, cwd: string, display_error = true, env?: NodeJS.ProcessEnv): Promise<ShellCommandResult> {
  const exec = util.promisify(cp.exec);
  const effectiveEnv = env ?? process.env;
  const execOptions: cp.ExecOptions = {
    cwd: cwd,
    encoding: 'utf8',  // Ensure stdout and stderr are strings, not Buffers
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

  const res = await exec(cmd, execOptions).then(

    value => {
      return { stdout: value.stdout as string, stderr: value.stderr as string, cmd, cwd, env: effectiveEnv, exitCode: 0 };
    },
    reason => {
      const exitCode: number | undefined = reason.code ?? undefined;
      if (display_error) {
        outputError("Shell Command", `Command failed: ${cmd}`, {
          command: cmd,
          detail: `Exit code: ${exitCode ?? 'unknown'} | cwd: ${cwd || '(not set)'}`,
          stdout: reason.stdout as string | undefined,
          stderr: reason.stderr as string | undefined,
        });
      }
      return { stdout: undefined, stderr: reason.stderr as string | undefined, cmd, cwd, env: effectiveEnv, exitCode };
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
