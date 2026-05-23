/*
Copyright 2024-2026 mylonics 
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
import { getToolchainDir, resolveToolchainDirPath } from "../setup_utilities/workspace-config";
import { initOutputChannel, getOutputChannel, outputCommand, outputError, outputInfo, outputLine, type ShellCommandResult } from "./output";
import { KNOWN_RUNNERS, DEBUG_CAPABLE_RUNNERS } from "../project_utilities/runner_selector";
export type { ShellCommandResult } from "./output";

/**
 * Returns true when the resolved toolchain directory actually contains an
 * installed Zephyr SDK (a `zephyr-sdk-*` subdirectory with a `sdk_version`
 * file).  Used to gate injection of `ZEPHYR_SDK_INSTALL_DIR` into spawned
 * shells — we only want to override CMake's SDK discovery when the extension
 * has actually installed an SDK at that location.  Otherwise, users who
 * installed the Zephyr SDK manually elsewhere (and rely on CMake's
 * `~/zephyr-sdk-*` / package-registry auto-detection) would have that
 * discovery suppressed by an empty extension-managed directory.
 */
function hasInstalledSDKSync(): boolean {
  try {
    const dir = resolveToolchainDirPath();
    if (!fs.existsSync(dir)) { return false; }
    const entries = fs.readdirSync(dir);
    for (const entry of entries) {
      if (!entry.startsWith("zephyr-sdk-")) { continue; }
      if (fs.existsSync(path.join(dir, entry, "sdk_version"))) {
        return true;
      }
    }
  } catch {
    // Treat scan errors as "no SDK present" — fall back to CMake auto-detection.
  }
  return false;
}

/**
 * Populate VIRTUAL_ENV, ZEPHYR_BASE, and ZEPHYR_SDK_INSTALL_DIR on `env` from
 * the given setupState. These vars are normally exposed to integrated
 * terminals via VS Code's `environmentVariableCollection`, but that does not
 * reliably reach child_process or task shells in all environments, so we
 * inject them directly. ZEPHYR_SDK_INSTALL_DIR is only overridden when the
 * extension has actually installed an SDK at the resolved toolchain dir
 * (otherwise CMake's auto-detection of manually installed SDKs is preserved).
 */
function applyPythonShellEnv(env: { [key: string]: string | undefined }, setupState: SetupState): void {
  if (setupState.env["VIRTUAL_ENV"]) {
    env["VIRTUAL_ENV"] = setupState.env["VIRTUAL_ENV"];
  }
  if (setupState.zephyrDir) {
    env["ZEPHYR_BASE"] = setupState.zephyrDir;
  }
  if (!process.env.ZEPHYR_SDK_INSTALL_DIR && hasInstalledSDKSync()) {
    env["ZEPHYR_SDK_INSTALL_DIR"] = getToolchainDir();
  }
}

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
 * Canonicalize a filesystem path for comparison and deduplication.
 * Normalizes separators (via upath) and strips any trailing slashes so that
 * `/ws/foo` and `/ws/foo/` resolve to the same key.
 *
 * Root paths (`/` on POSIX, `C:/` on Windows) are left intact so that
 * `isWorkspaceLocal` cannot incorrectly match every path via a bare `''`
 * or drive-letter prefix (e.g. `'C:'`).
 */
export function canonicalizePath(p: string): string {
  const normalized = path.normalize(p);
  const stripped = normalized.replace(/\/+$/, '');
  // Guard: don't collapse a root path to '' (POSIX) or a bare drive letter
  // like 'C:' (Windows).  Either would make startsWith() match every sub-path.
  if (stripped === '' || /^[A-Za-z]:$/.test(stripped)) {
    return normalized;
  }
  return stripped;
}

/**
 * Returns true when `installPath` is considered "local" relative to the
 * currently open VS Code folder (`rootPath`).
 *
 * A workspace is local when:
 * - it exactly equals `rootPath`, OR
 * - `rootPath` is nested inside it (the open folder lives within the workspace).
 *
 * Both paths are canonicalized (normalized + trailing-slash stripped) before
 * comparison so platform differences and cosmetic slash variants don't matter.
 */
export function isWorkspaceLocal(rootPath: string, installPath: string): boolean {
  const normalizedRoot = canonicalizePath(rootPath);
  const normalizedInstall = canonicalizePath(installPath);
  return normalizedInstall === normalizedRoot || normalizedRoot.startsWith(normalizedInstall + '/');
}

/**
 * Compare two workspace install paths for sorting relative to the currently
 * open VS Code folder (`rootPath`).
 *
 * A path is considered "local" when:
 * - it exactly equals `rootPath`, OR
 * - `rootPath` starts with the install path followed by a separator (i.e.
 *   the open folder is *inside* that workspace directory).
 *
 * Trailing slashes are stripped after normalization so double-slash false
 * negatives cannot occur.  When both paths are local (nested workspaces),
 * the longer/more-specific path wins; when neither matches, the order is
 * preserved (return 0).
 *
 * @param rootPath - The open VS Code folder (wsConfig.rootPath)
 * @param aInstallPath - First workspace install path to compare
 * @param bInstallPath - Second workspace install path to compare
 * @returns Negative if `a` should sort before `b`, positive if `b` first, 0 if equal rank
 */
export function compareWorkspacePathsByLocality(rootPath: string, aInstallPath: string, bInstallPath: string): number {
  const aIsLocal = isWorkspaceLocal(rootPath, aInstallPath);
  const bIsLocal = isWorkspaceLocal(rootPath, bInstallPath);
  if (aIsLocal && !bIsLocal) { return -1; }
  if (!aIsLocal && bIsLocal) { return 1; }
  // Both match (nested workspaces): prefer the more specific (longer) path
  if (aIsLocal && bIsLocal) { return canonicalizePath(bInstallPath).length - canonicalizePath(aInstallPath).length; }
  return 0;
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

export function isWindows() {
  return platform === "win32";
}

/** Cached result of the LongPathsEnabled registry check. undefined = not yet read. */
let _longPathsEnabledCache: boolean | undefined = undefined;

/**
 * Check whether the Windows LongPathsEnabled registry key is set to 1.
 * The result is cached for the lifetime of the extension process to avoid
 * repeated PowerShell round-trips. The cache is cleared when
 * enableWindowsLongPaths() writes the registry key.
 * Returns false when not on Windows or when the check cannot be performed.
 */
export async function checkWindowsLongPathsEnabled(): Promise<boolean> {
  if (platform !== "win32") {
    return false;
  }
  if (_longPathsEnabledCache !== undefined) {
    return _longPathsEnabledCache;
  }
  try {
    // executeShellCommand already uses powershell.exe on Windows, so pass the
    // script directly without an extra "powershell -Command" wrapper.
    const cmd = `(Get-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\FileSystem' -Name LongPathsEnabled -ErrorAction SilentlyContinue).LongPathsEnabled`;
    const result = await executeShellCommand(cmd, "", false);
    _longPathsEnabledCache = result.stdout?.trim() === "1";
    return _longPathsEnabledCache;
  } catch {
    _longPathsEnabledCache = false;
    return false;
  }
}

/**
 * Enable Windows long path support by setting the LongPathsEnabled registry
 * key to 1.  Requires administrator privileges; the PowerShell process is
 * launched with -Verb RunAs so the user sees a UAC prompt.
 * Returns true if the registry write succeeded, false otherwise.
 */
export async function enableWindowsLongPaths(): Promise<boolean> {
  if (platform !== "win32") {
    return false;
  }
  try {
    // executeShellCommand already uses powershell.exe on Windows, so pass the
    // Start-Process command directly without an extra "powershell -Command" wrapper.
    // The key takes effect immediately for new processes — no restart needed.
    const cmd = `Start-Process powershell -Verb RunAs -Wait -ArgumentList '-Command Set-ItemProperty -Path HKLM:\\SYSTEM\\CurrentControlSet\\Control\\FileSystem -Name LongPathsEnabled -Value 1'`;
    await executeShellCommand(cmd, "", false);
    // Invalidate the cache so checkWindowsLongPathsEnabled() does a fresh read.
    _longPathsEnabledCache = undefined;
    // Verify the key was actually set (UAC deny or other failures leave it unset)
    const enabled = await checkWindowsLongPathsEnabled();
    if (!enabled) {
      outputInfo("Long Paths", "LongPathsEnabled registry write did not take effect — UAC may have been denied or the process lacked privileges.");
    }
    return enabled;
  } catch (error) {
    outputInfo("Long Paths", `Failed to enable Windows long paths: ${error}`);
    return false;
  }
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

  // When a folder is specified, require an exact name+folder match.
  // Falling back to a name-only match across folders would silently start the
  // wrong configuration in a multi-root workspace where two folders define
  // configs of the same name (issue #17).
  if (folderName) {
    for (const config of configurations) {
      if (config.name === configName && config.workspaceFolder === folderName) {
        return config;
      }
    }
    return undefined;
  }

  // No folder recorded — accept the first name match (workspace/global scope).
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
  // A "runner:xxx" target is pinned to a Zephyr runner; render it as
  // "Auto (runner: xxx)" so users don't see the raw magic prefix in the UI.
  if (targetName && targetName.startsWith(RUNNER_TARGET_PREFIX)) {
    const runnerName = targetName.slice(RUNNER_TARGET_PREFIX.length);
    return `Auto via runners.yaml — runner: ${runnerName}`;
  }
  const label = targetName || fallback;
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length <= 1 || !targetFolder) {
    return label;
  }
  return `${label} (${targetFolder})`;
}

/** Prefix used to store a runner-pinned target in a RunnerBind's `launch` slot or in the legacy launchTarget / attachTarget string. */
/** Legacy prefix, kept for backward-compat with old stored local-bind values. */
export const RUNNER_TARGET_PREFIX = "runner:";
/** Prefix for flash local-bind values (mirrors RunnerProfile "west-flash" kind). */
export const WEST_FLASH_PREFIX = "west-flash:";
/** Prefix for cortex-debug (auto-config) local-bind values. */
export const CORTEX_DEBUG_PREFIX = "cortex-debug:";
/** Prefix for west debug-server bridge local-bind values. */
export const WEST_DEBUG_PREFIX = "west-debug:";

const _RUNNER_ICON_PREFIX = "$(plug) ";
const _WEST_LABEL_SUFFIX = " (west)";

export async function selectLaunchConfiguration(
  wsConfig: WorkspaceConfig,
  defaultLabel?: string,
  /**
   * Issue #23: when supplied, runners not present in this list are demoted to
   * "(not in board's runners.yaml)" so the user understands which runners the
   * active build actually supports.
   */
  availableRunners?: string[],
  /**
   * Bind kind being picked.
   * - "flash": lists every known west runner under a "west flash" section.
   *   No launch.json (not valid for flashing).
   * - "debug" (default): shows launch.json configs first, then all
   *   debug-capable runners under both "cortex-debug (auto-config)" and
   *   "west debug-server bridge" sections — matching the Runner Profiles editor.
   */
  mode: "flash" | "debug" = "debug",
): Promise<{ name: string; workspaceFolder?: string; isDefault?: boolean; isRunner?: boolean } | undefined> {
  const configurations = mode === "flash" ? undefined : await getLaunchConfigurations(wsConfig);

  const pickOptions: vscode.QuickPickOptions = {
    ignoreFocusOut: true,
    placeHolder: mode === "flash" ? "Select Flash Runner" : "Select Launch Configuration",
  };
  const isMultiRoot = (vscode.workspace.workspaceFolders?.length ?? 0) > 1;
  const items: vscode.QuickPickItem[] = [];

  if (defaultLabel) {
    items.push({
      label: defaultLabel,
      detail: mode === "flash"
        ? "Use the default flash runner from runners.yaml"
        : "Use Zephyr IDE automatic debug configuration (runners.yaml)",
    });
  }

  const availableSet = availableRunners ? new Set(availableRunners) : undefined;

  if (mode === "flash") {
    // All west runners, categorised under "west flash".
    const sortedRunners = availableSet
      ? [...KNOWN_RUNNERS.filter(r => availableSet.has(r)), ...KNOWN_RUNNERS.filter(r => !availableSet.has(r))]
      : KNOWN_RUNNERS;
    items.push({ label: "west flash", kind: vscode.QuickPickItemKind.Separator });
    items.push(...sortedRunners.map(r => ({
      label: `${_RUNNER_ICON_PREFIX}${r}`,
      description: !availableSet || availableSet.has(r) ? "flash" : "(not in board's runners.yaml)",
      detail: `Use the ${r} runner for flashing.`,
    } as vscode.QuickPickItem)));
  } else {
    // Debug/Attach: launch.json first, then two runner sections mirroring the
    // Runner Profile editor (cortex-debug auto-config + west debug-server bridge).
    const sortedRunners = availableSet
      ? [...DEBUG_CAPABLE_RUNNERS.filter(r => availableSet.has(r)), ...DEBUG_CAPABLE_RUNNERS.filter(r => !availableSet.has(r))]
      : DEBUG_CAPABLE_RUNNERS;

    if (configurations && configurations.length > 0) {
      items.push({ label: "launch.json", kind: vscode.QuickPickItemKind.Separator });
      items.push(...configurations.map(x => ({
        label: x.name,
        description: isMultiRoot ? x.workspaceFolder : undefined,
      })));
    }

    items.push({ label: "cortex-debug (auto-config)", kind: vscode.QuickPickItemKind.Separator });
    items.push(...sortedRunners.map(r => ({
      label: `${_RUNNER_ICON_PREFIX}${r}`,
      description: !availableSet || availableSet.has(r) ? "auto-config" : "(not in board's runners.yaml)",
      detail: `Pin to the ${r} runner; cortex-debug config is generated from runners.yaml.`,
    } as vscode.QuickPickItem)));

    items.push({ label: "west debug-server bridge", kind: vscode.QuickPickItemKind.Separator });
    items.push(...sortedRunners.map(r => ({
      label: `${_RUNNER_ICON_PREFIX}${r}${_WEST_LABEL_SUFFIX}`,
      description: !availableSet || availableSet.has(r) ? "west debug-server" : "(not in board's runners.yaml)",
      detail: `Always use west debug-server bridge with the ${r} runner.`,
    } as vscode.QuickPickItem)));
  }

  const selected = await vscode.window.showQuickPick(items, pickOptions);
  if (!selected) { return undefined; }

  if (defaultLabel && selected.label === defaultLabel) {
    return { name: "", isDefault: true };
  }

  if (selected.label.startsWith(_RUNNER_ICON_PREFIX)) {
    const withoutIcon = selected.label.slice(_RUNNER_ICON_PREFIX.length);
    if (mode === "flash") {
      return { name: `${WEST_FLASH_PREFIX}${withoutIcon}`, isRunner: true };
    }
    if (withoutIcon.endsWith(_WEST_LABEL_SUFFIX)) {
      const runnerName = withoutIcon.slice(0, -_WEST_LABEL_SUFFIX.length);
      return { name: `${WEST_DEBUG_PREFIX}${runnerName}`, isRunner: true };
    }
    return { name: `${CORTEX_DEBUG_PREFIX}${withoutIcon}`, isRunner: true };
  }

  // launch.json pick — name is the label; description is the folder in multi-root.
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

export async function executeTaskHelperInPythonEnv(setupState: SetupState | undefined, taskName: string, cmd: string, cwd: string | undefined, overrideTempOnWindows: boolean = false) {
  // VS Code's environmentVariableCollection doesn't reliably propagate to task
  // shells in all environments (macOS, WSL, Windows CI/headless).  Inject the
  // required env vars directly into the task shell options instead.
  if (!setupState) {
    return await executeTaskHelper(taskName, cmd, cwd);
  }

  const win = isWindows();
  const pathSep = win ? ";" : ":";
  const pathKey = win ? "Path" : "PATH";
  const existingPath = process.env["PATH"] || process.env["Path"] || "";

  const env: { [key: string]: string } = {};

  const venvBin = await getPythonVenvBinaryFolder(setupState);
  if (venvBin) {
    env[pathKey] = venvBin + pathSep + existingPath;
  }
  applyPythonShellEnv(env, setupState);

  if (win && overrideTempOnWindows) {
    // Redirect TMPDIR/TEMP/TMP to a short path so pip build isolation
    // directories don't exceed the MAX_PATH (260 chars) limit.
    const systemDrive = process.env.SYSTEMDRIVE || "C:";
    const shortTempDir = `${systemDrive}\\Temp`;
    try {
      if (!fs.existsSync(shortTempDir)) {
        fs.mkdirSync(shortTempDir, { recursive: true });
      }
      env["TMPDIR"] = shortTempDir;
      env["TEMP"] = shortTempDir;
      env["TMP"] = shortTempDir;
    } catch {
      // Proceed without overriding TEMP; paths may be longer than ideal.
    }
  }

  return await executeTaskHelper(taskName, cmd, cwd, env);
}

export async function executeTaskHelper(taskName: string, cmd: string, cwd: string | undefined, env?: { [key: string]: string }) {
  outputCommand(taskName, cmd);
  const options: vscode.ShellExecutionOptions = {
    // Coerce empty strings to undefined — VS Code's ShellExecution rejects
    // an empty-string cwd and emits "An unknown error occurred".
    cwd: cwd || undefined,
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
    // On Windows, process.env spreads as "Path" (title-case).  Find the
    // actual key so we prepend onto the right entry; executeShellCommand's
    // Windows PATH consolidation will then merge any duplicates.
    const existingKey = Object.keys(env).find(k => k.toLowerCase() === "path") || "PATH";
    const existingPath = env[existingKey] || "";
    env[existingKey] = setupState.env["PATH"] + existingPath;
  }

  applyPythonShellEnv(env, setupState);

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
