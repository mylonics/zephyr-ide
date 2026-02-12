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
import { executeTaskHelper, getPlatformArch, getPlatformName, getPlatformNameAsync, executeShellCommand, logDual } from "../utilities/utils";
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
 * Get the package manager for the current platform
 */
export function getPackageManagerForPlatform(): { name: string; config: PackageManager } | null {
  const manifest = loadHostToolsManifest();
  const platformName = getPlatformName();
  
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
  const manifest = loadHostToolsManifest();
  const platformName = await getPlatformNameAsync();
  
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
    return result.stdout !== null && result.stdout !== undefined;
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
async function checkPythonVersion(pythonCommand: string): Promise<{valid: boolean, version?: string, error?: string}> {
  try {
    // Try to get Python version
    const result = await executeShellCommand(`${pythonCommand} --version`, "", false);
    if (!result.stdout) {
      return {valid: false, error: "Could not determine Python version"};
    }
    
    // Parse version from output like "Python 3.x.y"
    const versionMatch = result.stdout.match(/Python\s+(\d+)\.(\d+)\.(\d+)/i);
    if (!versionMatch) {
      return {valid: false, error: "Could not parse Python version"};
    }
    
    const major = parseInt(versionMatch[1]);
    const minor = parseInt(versionMatch[2]);
    const versionStr = `${major}.${minor}.${versionMatch[3]}`;
    
    // Check minimum version: Python >= 3.10
    if (major < 3 || (major === 3 && minor < 10)) {
      return {
        valid: false,
        version: versionStr,
        error: `Python ${versionStr} found, but version >= 3.10 is required`
      };
    }
    
    return {valid: true, version: versionStr};
  } catch (error) {
    return {valid: false, error: String(error)};
  }
}

/**
 * Check if a single package is available
 */
export async function checkPackageAvailable(pkg: PlatformPackage): Promise<PackageStatus> {
  try {
    const result = await executeShellCommand(pkg.check_command, "", false);
    // Command succeeded if stdout is not undefined (even if empty)
    // Note: We also check stderr is not a rejection indicator
    const available = result.stdout !== null && result.stdout !== undefined;
    
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
            error: versionCheck.error || "Python version < 3.10"
          };
        } else {
          outputInfo("Host Tools", `${pkg.name} version ${versionCheck.version} detected (>= 3.10 required)`);
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
 * Check all platform packages
 */
export async function checkAllPackages(): Promise<PackageStatus[]> {
  const packages = await getPlatformPackages();
  const statuses: PackageStatus[] = [];
  
  for (const pkg of packages) {
    const status = await checkPackageAvailable(pkg);
    statuses.push(status);
  }
  
  return statuses;
}

/**
 * Install a single package
 */
export async function installPackage(pkg: PlatformPackage): Promise<boolean> {
  const manager = await getPackageManagerForPlatformAsync();
  if (!manager) {
    outputWarning("Host Tools", "No package manager found for this platform");
    return false;
  }

  let installCommand: string;
  switch (manager.name) {
    case "homebrew":
      installCommand = `brew install ${pkg.package}`;
      break;
    case "apt":
      installCommand = `sudo apt install --no-install-recommends ${pkg.package}`;
      break;
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
  let allSuccess = true;
  
  for (const status of missingPackages) {
    const pkg = packages.find(p => p.name === status.name);
    if (pkg) {
      const success = await installPackage(pkg);
      if (!success) {
        allSuccess = false;
      }
    }
  }
  
  if (allSuccess) {
    outputInfo("Host Tools", "All missing packages installed successfully");
    vscode.window.showInformationMessage(
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
  
  // Install missing packages with cleaner logging
  const missingPackages = statuses.filter(s => !s.available);
  const packages = await getPlatformPackages();
  
  let packagesWereInstalled = false;
  
  for (const status of statuses) {
    if (status.available) {
      logDual(`✅ ${status.name} found`);
    } else {
      logDual(`⚠️  ${status.name} not found`);
      
      const pkg = packages.find(p => p.name === status.name);
      if (pkg) {
        const success = await installPackage(pkg);
        if (success) {
          logDual(`✅ Installed ${status.name}`);
          packagesWereInstalled = true;
        } else {
          logDual(`❌ Failed to install ${status.name}`);
        }
      }
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
  
  // First check if package manager is available
  const pmAvailable = await checkPackageManagerAvailable();
  if (!pmAvailable) {
    outputInfo("Host Tools", "Package manager not available, attempting to install...");
    const pmSuccess = await installPackageManager();
    if (!pmSuccess) {
      outputWarning("Host Tools", "Failed to install package manager");
      return false;
    }
    outputInfo("Host Tools", "Package manager installed successfully - restart may be needed for PATH updates");
    // Return false to indicate VS Code may need restart for package manager to be in PATH
    return false;
  }
  
  outputInfo("Host Tools", "Package manager is available");
  
  // Check if all packages are already available
  const statuses = await checkAllPackages();
  const allAvailable = statuses.every(s => s.available);
  
  if (allAvailable) {
    outputInfo("Host Tools", "All packages are already available on PATH");
    return true;
  }
  
  // Install missing packages
  const installSuccess = await installAllMissingPackages();
  if (!installSuccess) {
    outputWarning("Host Tools", "Some packages failed to install");
    return false;
  }
  
  // Verify all packages are now available on PATH
  const finalStatuses = await checkAllPackages();
  const finalAllAvailable = finalStatuses.every(s => s.available);
  
  if (finalAllAvailable) {
    outputInfo("Host Tools", "All packages are now available on PATH");
    return true;
  } else {
    const unavailable = finalStatuses.filter(s => !s.available).map(s => s.name);
    outputWarning("Host Tools", `Packages installed but not yet available on PATH${unavailable.length > 0 ? ': ' + unavailable.join(', ') : ''}`);
    outputInfo("Host Tools", "A restart may be needed for PATH updates to take effect");
    return false;
  }
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