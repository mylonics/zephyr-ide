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
import { executeTaskHelper, getPlatformArch, getPlatformNameAsync, executeShellCommand, logDual } from "../utilities/utils";
import { outputInfo, outputWarning, outputError, notifyWarning } from "../utilities/output";
import manifestData from "./host-tools-manifest.json";

// Interfaces for the manifest structure
export interface PackageManager {
  check_command: string;
  install_command?: string;
  post_install_setup?: Array<{
    architectures: string[];
    command: string;
    notes: string;
  }>;
  install_url?: string;
}

export interface PlatformPackage {
  name: string;
  package: string;
  check_command: string;
  architectures?: string[];
  post_install_step?: string;
}

export interface HostToolsManifest {
  supported_architectures: string[];
  package_managers: { [key: string]: PackageManager };
  platforms: { [key: string]: { manager: string } };
  platform_packages: { [key: string]: PlatformPackage[] };
}

export interface PackageStatus {
  name: string;
  package: string;
  available: boolean;
  installing?: boolean;
  pendingRestart?: boolean;
  error?: string;
}



/**
 * Refresh PATH environment variable on Windows to pick up newly installed tools
 * This updates the current process's PATH with the latest from the registry
 */
async function refreshWindowsPath(): Promise<void> {
  if (process.platform !== 'win32') {
    return;
  }

  try {
    logDual("[HOST TOOLS] Refreshing Windows PATH environment variable...");

    // Get Machine and User PATH from registry
    const machinePathCmd = `powershell -Command "[System.Environment]::GetEnvironmentVariable('Path','Machine')"`;
    const userPathCmd = `powershell -Command "[System.Environment]::GetEnvironmentVariable('Path','User')"`;

    const machinePathResult = await executeShellCommand(machinePathCmd, '', false);
    const userPathResult = await executeShellCommand(userPathCmd, '', false);

    const machinePath = machinePathResult.stdout?.trim() || '';
    const userPath = userPathResult.stdout?.trim() || '';

    // Combine Machine and User paths
    const registryPath = machinePath + (userPath ? ';' + userPath : '');

    if (registryPath) {
      // Merge registry paths with existing process PATH to preserve any
      // paths added at the process level (e.g. GITHUB_PATH in CI, or
      // paths added by the VS Code extension host).
      const registryEntries = registryPath.split(';').filter(Boolean);
      const currentEntries = (process.env.PATH || '').split(';').filter(Boolean);

      // Build a set of registry entries (lowercased) for deduplication
      const registrySet = new Set(registryEntries.map(e => e.toLowerCase()));

      // Keep any current PATH entries that are NOT in the registry
      // (these were added at the process level and should be preserved)
      const extraEntries = currentEntries.filter(e => !registrySet.has(e.toLowerCase()));

      // Final PATH: registry paths first, then any extra process-level paths
      const mergedPath = [...registryEntries, ...extraEntries].join(';');
      process.env.PATH = mergedPath;
      logDual("[HOST TOOLS] ✅ Windows PATH refreshed successfully");
      if (extraEntries.length > 0) {
        logDual(`[HOST TOOLS]    Preserved ${extraEntries.length} process-level PATH entries`);
      }
    }
  } catch (error) {
    logDual(`[HOST TOOLS] Warning: Failed to refresh Windows PATH: ${error}`);
  }
}

let manifestCache: HostToolsManifest | null = null;

/**
 * Load and parse the host tools manifest file
 */
export function loadHostToolsManifest(): HostToolsManifest {
  if (manifestCache) {
    return manifestCache;
  }

  try {
    // Use the imported manifest data directly
    manifestCache = manifestData as HostToolsManifest;

    if (!manifestCache) {
      throw new Error("Host tools manifest is empty or invalid");
    }

    return manifestCache;
  } catch (error) {
    outputError("Host Tools", `Error loading manifest: ${error}`);
    throw new Error(`Failed to load host tools manifest: ${error}`);
  }
}

/**
 * Resolve a package manager from a platform name string
 */
function getPackageManagerFromPlatformName(platformName: string | undefined): { name: string; config: PackageManager } | null {
  const manifest = loadHostToolsManifest();

  let platformKey: string;
  switch (platformName) {
    case "linux":
      platformKey = "linux";
      break;
    case "macos":
      platformKey = "mac";
      break;
    case "windows":
      platformKey = "windows";
      break;
    default:
      return null;
  }

  const platformConfig = manifest.platforms[platformKey];
  if (!platformConfig) {
    return null;
  }

  const managerName = platformConfig.manager;
  const managerConfig = manifest.package_managers[managerName];

  if (!managerConfig) {
    return null;
  }

  return { name: managerName, config: managerConfig };
}

/**
 * Get the package manager for the current platform (async version with remote detection)
 */
export async function getPackageManagerForPlatformAsync(): Promise<{ name: string; config: PackageManager } | null> {
  return getPackageManagerFromPlatformName(await getPlatformNameAsync());
}

/**
 * Check if a package manager is available
 */
export async function checkPackageManagerAvailable(): Promise<boolean> {
  const manager = await getPackageManagerForPlatformAsync();
  if (!manager) {
    return false;
  }

  try {
    const result = await executeShellCommand(manager.config.check_command, "", true);
    // Command succeeded if stdout is not undefined (even if empty)
    return result.stdout !== undefined;
  } catch (error) {
    return false;
  }
}

/**
 * Install the package manager
 */
export async function installPackageManager(): Promise<boolean> {
  const manager = await getPackageManagerForPlatformAsync();
  if (!manager) {
    outputInfo("Host Tools", "No package manager found for this platform");
    return false;
  }

  if (!manager.config.install_command) {
    outputInfo("Host Tools", `${manager.name} requires manual installation`);
    if (manager.config.install_url) {
      outputInfo("Host Tools", `Please install from: ${manager.config.install_url}`);
    }
    return false;
  }

  outputInfo("Host Tools", `Installing ${manager.name}...`);
  const result = await executeTaskHelper(
    `Install ${manager.name}`,
    manager.config.install_command,
    ""
  );

  if (!result) {
    outputError("Host Tools", `Failed to install ${manager.name}`);
    return false;
  }

  // Run post-install setup if needed
  if (manager.config.post_install_setup) {
    const arch = getPlatformArch();
    for (const setup of manager.config.post_install_setup) {
      if (setup.architectures.includes(arch)) {
        outputInfo("Host Tools", `Running post-install setup: ${setup.notes}`);
        const setupResult = await executeTaskHelper(
          `Setup ${manager.name}`,
          setup.command,
          ""
        );
        if (!setupResult) {
          outputWarning("Host Tools", `Post-install setup failed`);
        }
      }
    }
  }

  return true;
}

/**
 * Detect the active python3 minor version and return the matching
 * `python3.X-venv` apt package name (e.g. "python3.12-venv"). Returns
 * undefined if python3 is not available or the version cannot be parsed.
 */
async function detectVersionedPythonVenvPackage(): Promise<string | undefined> {
  const minor = await detectPython3MinorVersion();
  if (minor === undefined) { return undefined; }
  return `python3.${minor}-venv`;
}

/**
 * Return the active python3 minor version number (e.g. 12 for 3.12).
 * Returns undefined if python3 is unavailable or the version cannot be parsed.
 */
async function detectPython3MinorVersion(): Promise<number | undefined> {
  try {
    const result = await executeShellCommand(
      `python3 -c "import sys; print(sys.version_info.minor)"`,
      "",
      false
    );
    const out = (result.stdout || "").trim();
    const n = parseInt(out, 10);
    return isNaN(n) ? undefined : n;
  } catch {
    return undefined;
  }
}

/**
 * On distros where Python 3.12 is not in the default apt repositories
 * (e.g. Ubuntu 22.04 Jammy Jellyfish) add the deadsnakes PPA and refresh
 * the package cache so that `python3.12` and its supporting packages become
 * available for installation.
 *
 * The function is a no-op when python3.12 is already known to apt.
 * Returns true on success (PPA already present or successfully added).
 */
async function addDeadsnakesPPAIfNeeded(): Promise<boolean> {
  // Quick check: is python3.12 already in the apt package index?
  const probe = await executeShellCommand("apt-cache show python3.12", "", true);
  if (probe.stdout !== undefined) {
    // python3.12 is already available — nothing to do.
    return true;
  }

  outputInfo("Host Tools", "python3.12 not found in default apt repos — adding deadsnakes PPA...");

  // Keep this in one task so sudo prompts at most once for this PPA flow.
  const ppaOk = await executeTaskHelper(
    "Configure deadsnakes PPA for Python 3.12",
    "sudo apt install -y --no-install-recommends software-properties-common && sudo add-apt-repository -y ppa:deadsnakes/ppa && sudo apt-get update -qq",
    ""
  );
  if (!ppaOk) {
    outputError("Host Tools", "Failed to configure deadsnakes/ppa");
    return false;
  }

  outputInfo("Host Tools", "deadsnakes PPA added — python3.12 packages are now available");
  return true;
}

/**
 * Cache sudo credentials up-front by running `sudo -v` in an interactive task
 * terminal. Subsequent sudo calls may reuse cached credentials depending on
 * sudoers policy and terminal reuse.
 *
 * No-op on non-Linux platforms. Returns true if credentials are now cached
 * (or platform doesn't need sudo), false if the user dismissed the prompt or
 * sudo is unavailable.
 */
export async function cacheSudoCredentials(): Promise<boolean> {
  const platform = await getPlatformNameAsync();
  if (platform !== "linux") {
    return true;
  }

  // First check whether sudo is already cached (`sudo -n -v` returns 0 if so).
  try {
    const probe = await executeShellCommand("sudo -n -v", "", true);
    if (probe.stdout !== undefined) {
      return true;
    }
  } catch {
    // fall through to interactive prompt
  }

  outputInfo("Host Tools", "Caching sudo credentials for batch package install...");
  const ok = await executeTaskHelper("Cache sudo credentials", "sudo -v", "");
  if (!ok) {
    outputWarning("Host Tools", "Could not cache sudo credentials; package installs may prompt for password individually.");
    return false;
  }
  return true;
}

/**
 * Get platform packages for the current platform
 */
export async function getPlatformPackages(): Promise<PlatformPackage[]> {
  const manifest = loadHostToolsManifest();
  const manager = await getPackageManagerForPlatformAsync();

  if (!manager) {
    return [];
  }

  const packages = manifest.platform_packages[manager.name] || [];
  const arch = getPlatformArch();

  // Filter packages by architecture if specified
  return packages.filter(pkg => {
    if (!pkg.architectures) {
      return true;
    }
    return pkg.architectures.includes(arch);
  });
}

/**
 * Check Python version and ensure it meets minimum requirements (>= 3.10)
 */
async function checkPythonVersion(pythonCommand: string): Promise<{ valid: boolean, version?: string, error?: string }> {
  try {
    // Try to get Python version
    const result = await executeShellCommand(`${pythonCommand} --version`, "", false);

    // Some Python builds (especially older Windows ones) write to stderr instead of stdout.
    const rawOutput = result.stdout || result.stderr || '';
    if (!rawOutput) {
      return { valid: false, error: "Could not determine Python version" };
    }

    // Parse version from output like "Python 3.x.y"
    const versionMatch = rawOutput.match(/Python\s+(\d+)\.(\d+)\.(\d+)/i);
    if (!versionMatch) {
      return { valid: false, error: "Could not parse Python version" };
    }

    const major = parseInt(versionMatch[1]);
    const minor = parseInt(versionMatch[2]);
    const versionStr = `${major}.${minor}.${versionMatch[3]}`;

    // Check minimum version: Python >= 3.12
    if (major < 3 || (major === 3 && minor < 12)) {
      return {
        valid: false,
        version: versionStr,
        error: `Python ${versionStr} found, but version >= 3.12 is required`
      };
    }

    return { valid: true, version: versionStr };
  } catch (error) {
    return { valid: false, error: String(error) };
  }
}

/**
 * Check if a single package is available
 */
export async function checkPackageAvailable(pkg: PlatformPackage): Promise<PackageStatus> {
  try {
    const result = await executeShellCommand(pkg.check_command, "", false);
    // Command succeeded if stdout is not undefined (even if empty)
    const available = result.stdout !== undefined;

    // Special handling for Python packages - check version
    if (available && pkg.name.toLowerCase().includes("python")) {
      // Extract the python command from check_command (e.g., "python3 --version" -> "python3")
      const pythonCmdMatch = pkg.check_command.match(/^(python\d*)\s/);
      if (pythonCmdMatch) {
        const pythonCmd = pythonCmdMatch[1];
        const versionCheck = await checkPythonVersion(pythonCmd);

        if (!versionCheck.valid) {
          outputWarning("Host Tools", `${pkg.name}: ${versionCheck.error || "Version check failed"}`);
          return {
            name: pkg.name,
            package: pkg.package,
            available: false,
            error: versionCheck.error || "Python version < 3.12"
          };
        } else {
          outputInfo("Host Tools", `${pkg.name} version ${versionCheck.version} detected (>= 3.12 required)`);
        }
      }
    }

    return {
      name: pkg.name,
      package: pkg.package,
      available,
      error: available ? undefined : "Not found"
    };
  } catch (error) {
    return {
      name: pkg.name,
      package: pkg.package,
      available: false,
      error: String(error)
    };
  }
}

/**
 * Check all platform packages (runs checks in parallel)
 */
export async function checkAllPackages(): Promise<PackageStatus[]> {
  const packages = await getPlatformPackages();
  return Promise.all(packages.map(pkg => checkPackageAvailable(pkg)));
}

interface AptInstallPlan {
  aptPackages: string[];
  postAptSteps: Array<{ label: string; command: string }>;
}

/**
 * Resolve apt install targets and post-install actions for a package.
 * Keeps Python 3.12/deadsnakes behavior consistent across single and batch installs.
 *
 * @param pkg - The package to resolve.
 * @param minorVersionOverride - When set, used as the Python minor version for
 *   version-matched packages (python3-venv, python3-tk) instead of detecting
 *   the currently installed version. Pass this in batch installs where
 *   python3-dev (which installs 3.12) is resolved before venv/tk packages.
 */
async function resolveAptInstallPlan(pkg: PlatformPackage, minorVersionOverride?: number): Promise<AptInstallPlan> {
  let aptPackages = [pkg.package];
  const postAptSteps: Array<{ label: string; command: string }> = [];

  if (pkg.package === "python3-dev") {
    // Ensure python3.12 is reachable via apt (adds deadsnakes PPA on 22.04).
    const ppaOk = await addDeadsnakesPPAIfNeeded();
    if (!ppaOk) {
      outputWarning("Host Tools", "Could not ensure python3.12 apt availability; falling back to python3-dev");
    } else {
      aptPackages = ["python3.12", "python3.12-dev"];
      // After install, make `python3` point to the new 3.12 binary.
      postAptSteps.push({
        label: "Register python3.12 as default python3",
        command: "sudo update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.12 1",
      });
    }
  } else if (pkg.package === "python3-venv") {
    // Plain `python3-venv` may not include ensurepip on all distros; use
    // the version-matched package to be safe.
    const minor = minorVersionOverride ?? await detectPython3MinorVersion();
    if (minor !== undefined) {
      aptPackages = [pkg.package, `python3.${minor}-venv`];
    }
  } else if (pkg.package === "python3-tk") {
    // Install the version-matched tkinter so it works with the active
    // python3.12 interpreter set up by the python3-dev step.
    const minor = minorVersionOverride ?? await detectPython3MinorVersion();
    if (minor !== undefined) {
      aptPackages = [pkg.package, `python3.${minor}-tk`];
    }
  }

  return { aptPackages, postAptSteps };
}

/**
 * Install a single package.
 * @param pkg - The package to install.
 * @param resolvedManager - Pre-resolved package manager; if omitted, looked up from the platform.
 *   Callers that install multiple packages in a loop should resolve this once and pass it in to
 *   avoid repeated async platform-detection calls.
 */
export async function installPackage(pkg: PlatformPackage, resolvedManager?: { name: string; config: PackageManager }): Promise<boolean> {
  const manager = resolvedManager ?? await getPackageManagerForPlatformAsync();
  if (!manager) {
    outputWarning("Host Tools", "No package manager found for this platform");
    return false;
  }

  let installCommand: string;
  const postAptSteps: Array<{ label: string; command: string }> = [];
  switch (manager.name) {
    case "homebrew":
      installCommand = `brew install ${pkg.package}`;
      break;
    case "apt": {
      const plan = await resolveAptInstallPlan(pkg);
      postAptSteps.push(...plan.postAptSteps);
      // Use interactive sudo so password prompts work on Ubuntu setups that
      // scope sudo timestamp credentials per terminal/TTY.
      installCommand = `sudo apt install -y --no-install-recommends ${plan.aptPackages.join(" ")}`;
      break;
    }
    case "winget":
      installCommand = `winget install --accept-package-agreements --accept-source-agreements ${pkg.package}`;
      break;
    default:
      outputWarning("Host Tools", `Unknown package manager: ${manager.name}`);
      return false;
  }

  outputInfo("Host Tools", `Installing ${pkg.name}...`);
  const result = await executeTaskHelper(
    `Install ${pkg.name}`,
    installCommand,
    ""
  );

  if (!result) {
    outputError("Host Tools", `Failed to install ${pkg.name}`);
    return false;
  }

  // Run any post-apt steps (e.g. update-alternatives after python3.12 install)
  for (const step of postAptSteps) {
    outputInfo("Host Tools", `Running: ${step.label}...`);
    const stepOk = await executeTaskHelper(step.label, step.command, "");
    if (!stepOk) {
      outputWarning("Host Tools", `${step.label} failed — manual configuration may be required`);
    }
  }

  // Run post-install step if specified
  if (pkg.post_install_step) {
    outputInfo("Host Tools", `Running post-install step for ${pkg.name}...`);
    const postInstallResult = await executeTaskHelper(
      `Post-install ${pkg.name}`,
      pkg.post_install_step,
      ""
    );
    if (!postInstallResult) {
      outputWarning("Host Tools", `Post-install step failed for ${pkg.name}`);
    }
  }

  outputInfo("Host Tools", `Successfully installed ${pkg.name}`);

  // Verify the package is now available
  const status = await checkPackageAvailable(pkg);
  if (!status.available) {
    outputWarning("Host Tools", `${pkg.name} was installed but is not yet available. A VS Code restart may be required.`);
  }

  return true;
}

/**
 * Install multiple packages with a single apt invocation when possible.
 * This reduces repeated sudo password prompts during bulk installs.
 */
export async function installPackagesBatch(packages: PlatformPackage[], resolvedManager?: { name: string; config: PackageManager }): Promise<boolean> {
  if (packages.length === 0) {
    return true;
  }

  const manager = resolvedManager ?? await getPackageManagerForPlatformAsync();
  if (!manager) {
    outputWarning("Host Tools", "No package manager found for this platform");
    return false;
  }

  if (manager.name !== "apt") {
    let ok = true;
    for (const pkg of packages) {
      const success = await installPackage(pkg, manager);
      if (!success) {
        ok = false;
      }
    }
    return ok;
  }

  const aptPackageSet = new Set<string>();
  const postAptSteps: Array<{ label: string; command: string }> = [];
  // Tracks the Python minor version selected by the python3-dev step so that
  // subsequent python3-venv / python3-tk resolutions use the same version
  // rather than the pre-install system Python (which may be older on 22.04).
  let resolvedPythonMinor: number | undefined;

  for (const pkg of packages) {
    const plan = await resolveAptInstallPlan(pkg, resolvedPythonMinor);
    // If python3-dev resolved to python3.12-dev, track version for venv/tk.
    if (pkg.package === "python3-dev" && plan.aptPackages.includes("python3.12-dev")) {
      resolvedPythonMinor = 12;
    }
    for (const aptPkg of plan.aptPackages) {
      aptPackageSet.add(aptPkg);
    }
    postAptSteps.push(...plan.postAptSteps);
  }

  const aptPackages = Array.from(aptPackageSet);
  if (aptPackages.length === 0) {
    return true;
  }

  outputInfo("Host Tools", `Installing ${packages.length} package(s) in a single apt command...`);
  const installCommand = `sudo apt install -y --no-install-recommends ${aptPackages.join(" ")}`;
  const installOk = await executeTaskHelper("Install missing host tools (apt)", installCommand, "");

  if (!installOk) {
    outputError("Host Tools", "Batch apt install failed");
    return false;
  }

  const seenStepCommands = new Set<string>();
  for (const step of postAptSteps) {
    if (seenStepCommands.has(step.command)) {
      continue;
    }
    seenStepCommands.add(step.command);
    outputInfo("Host Tools", `Running: ${step.label}...`);
    const stepOk = await executeTaskHelper(step.label, step.command, "");
    if (!stepOk) {
      outputWarning("Host Tools", `${step.label} failed — manual configuration may be required`);
    }
  }

  for (const pkg of packages) {
    if (!pkg.post_install_step) {
      continue;
    }
    outputInfo("Host Tools", `Running post-install step for ${pkg.name}...`);
    const postInstallResult = await executeTaskHelper(
      `Post-install ${pkg.name}`,
      pkg.post_install_step,
      ""
    );
    if (!postInstallResult) {
      outputWarning("Host Tools", `Post-install step failed for ${pkg.name}`);
    }
  }

  return true;
}

/**
 * Install all missing packages
 */
export async function installAllMissingPackages(): Promise<boolean> {
  const statuses = await checkAllPackages();
  const missingPackages = statuses.filter(s => !s.available);

  if (missingPackages.length === 0) {
    outputInfo("Host Tools", "All packages are already installed");
    return true;
  }

  outputInfo("Host Tools", `Found ${missingPackages.length} missing packages`);

  const packages = await getPlatformPackages();
  const manager = await getPackageManagerForPlatformAsync();

  const missingPkgs = missingPackages
    .map(s => packages.find(p => p.name === s.name))
    .filter((p): p is PlatformPackage => !!p);

  const allSuccess = await installPackagesBatch(missingPkgs, manager ?? undefined);

  if (allSuccess) {
    outputInfo("Host Tools", "All missing packages installed successfully");
    void vscode.window.showInformationMessage(
      "Host tools installed successfully. You may need to restart VS Code for changes to take effect."
    );
  } else {
    outputWarning("Host Tools", "Some packages failed to install");
    notifyWarning("Host Tools",
      "Some host tools failed to install. Check the output for details."
    );
  }

  return allSuccess;
}

/**
 * Install package manager only (for multi-step CI workflows)
 * Returns true if package manager is available, false if it was installed and needs restart
 */
export async function installPackageManagerHeadless(): Promise<boolean> {
  const manager = await getPackageManagerForPlatformAsync();
  if (!manager) {
    logDual("[HOST TOOLS] No package manager configuration found for this platform");
    return false;
  }

  const pmAvailable = await checkPackageManagerAvailable();
  if (pmAvailable) {
    logDual(`✅ ${manager.name} found`);
    return true;
  }

  logDual(`⚠️  ${manager.name} not found`);

  const pmSuccess = await installPackageManager();
  if (!pmSuccess) {
    logDual(`❌ Failed to install ${manager.name}`);
    return false;
  }

  logDual(`✅ Installed ${manager.name}`);

  // On Windows, refresh PATH after installing package manager
  if (process.platform === 'win32') {
    await refreshWindowsPath();

    // Check if package manager is now available after PATH refresh
    const pmNowAvailable = await checkPackageManagerAvailable();
    if (pmNowAvailable) {
      logDual(`✅ ${manager.name} is now available`);
      return true;
    }
  }

  // Return false on non-Windows or if PATH refresh didn't make package manager available
  return false; // macOS/Linux may need restart for PATH updates
}

/**
 * Install host packages only (assumes package manager is available)
 * Returns true if all packages are available, false if they were installed and need restart
 */
export async function installHostPackagesHeadless(): Promise<boolean> {
  // First verify package manager is available
  const pmAvailable = await checkPackageManagerAvailable();
  if (!pmAvailable) {
    logDual("[HOST TOOLS] Package manager not available - run install-package-manager-headless first");
    return false;
  }

  // Check all packages and log status
  const statuses = await checkAllPackages();
  const allAvailable = statuses.every(s => s.available);

  if (allAvailable) {
    // All packages already available - log each one
    for (const status of statuses) {
      logDual(`✅ ${status.name} found`);
    }
    return true;
  }

  // Log available packages and collect missing ones for batch install.
  const packages = await getPlatformPackages();
  const manager = await getPackageManagerForPlatformAsync();

  const missingPkgs: PlatformPackage[] = [];
  for (const status of statuses) {
    if (status.available) {
      logDual(`✅ ${status.name} found`);
    } else {
      logDual(`⚠️  ${status.name} not found`);
      const pkg = packages.find(p => p.name === status.name);
      if (pkg) {
        missingPkgs.push(pkg);
      }
    }
  }

  const batchOk = await installPackagesBatch(missingPkgs, manager ?? undefined);
  const packagesWereInstalled = batchOk;

  if (!batchOk) {
    logDual(`❌ Some packages failed to install`);
  } else {
    for (const pkg of missingPkgs) {
      logDual(`✅ Installed ${pkg.name}`);
    }
  }

  // On Windows, refresh PATH after installing packages so they become available immediately
  if (packagesWereInstalled && process.platform === 'win32') {
    await refreshWindowsPath();
  }

  // Verify all packages are now available on PATH
  const finalStatuses = await checkAllPackages();
  const finalAllAvailable = finalStatuses.every(s => s.available);

  if (finalAllAvailable) {
    return true;
  } else {
    return false; // Return false to indicate restart needed for PATH updates
  }
}

/**
 * Install host tools (package manager + packages)
 * Returns true only when ALL packages are available on PATH
 * Returns false when package manager was installed or packages were installed but not yet available
 */
export async function installHostToolsHeadless(): Promise<boolean> {
  outputInfo("Host Tools", "Starting headless host tools installation...");

  // Ensure package manager is available first
  const pmReady = await installPackageManagerHeadless();
  if (!pmReady) {
    outputWarning("Host Tools", "Package manager not available after install attempt — restart may be needed");
    return false;
  }

  // Delegate to installHostPackagesHeadless which handles check → install → verify
  return installHostPackagesHeadless();
}

/**
 * Check if all host tools are available (for Step 3 verification)
 * Logs the status of each tool
 */
export async function checkHostToolsHeadless(): Promise<boolean> {
  const statuses = await checkAllPackages();

  // Log each package status
  for (const status of statuses) {
    if (status.available) {
      logDual(`✅ ${status.name} found`);
    } else {
      logDual(`❌ ${status.name} not found`);
    }
  }

  return statuses.every(s => s.available);
}