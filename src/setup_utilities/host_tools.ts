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
import { output, executeTaskHelper, getPlatformArch, getPlatformName, executeShellCommand } from "../utilities/utils";
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
  error?: string;
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
    output.appendLine(`[HOST TOOLS] Error loading manifest: ${error}`);
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
 * Check if a package manager is available
 */
export async function checkPackageManagerAvailable(): Promise<boolean> {
  const manager = getPackageManagerForPlatform();
  if (!manager) {
    return false;
  }

  try {
    const result = await executeShellCommand(manager.config.check_command, "", true);
    return result.stdout !== null && result.stdout !== undefined && result.stdout.length > 0;
  } catch (error) {
    return false;
  }
}

/**
 * Install the package manager
 */
export async function installPackageManager(): Promise<boolean> {
  const manager = getPackageManagerForPlatform();
  if (!manager) {
    output.appendLine("[HOST TOOLS] No package manager found for this platform");
    return false;
  }

  if (!manager.config.install_command) {
    output.appendLine(`[HOST TOOLS] ${manager.name} requires manual installation`);
    if (manager.config.install_url) {
      output.appendLine(`[HOST TOOLS] Please install from: ${manager.config.install_url}`);
    }
    return false;
  }

  output.appendLine(`[HOST TOOLS] Installing ${manager.name}...`);
  const result = await executeTaskHelper(
    `Install ${manager.name}`,
    manager.config.install_command,
    ""
  );

  if (!result) {
    output.appendLine(`[HOST TOOLS] Failed to install ${manager.name}`);
    return false;
  }

  // Run post-install setup if needed
  if (manager.config.post_install_setup) {
    const arch = getPlatformArch();
    for (const setup of manager.config.post_install_setup) {
      if (setup.architectures.includes(arch)) {
        output.appendLine(`[HOST TOOLS] Running post-install setup: ${setup.notes}`);
        const setupResult = await executeTaskHelper(
          `Setup ${manager.name}`,
          setup.command,
          ""
        );
        if (!setupResult) {
          output.appendLine(`[HOST TOOLS] Warning: Post-install setup failed`);
        }
      }
    }
  }

  return true;
}

/**
 * Get platform packages for the current platform
 */
export function getPlatformPackages(): PlatformPackage[] {
  const manifest = loadHostToolsManifest();
  const manager = getPackageManagerForPlatform();
  
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
 * Check if a single package is available
 */
export async function checkPackageAvailable(pkg: PlatformPackage): Promise<PackageStatus> {
  try {
    const result = await executeShellCommand(pkg.check_command, "", true);
    const available = result.stdout !== null && result.stdout !== undefined && result.stdout.length > 0;
    
    return {
      name: pkg.name,
      package: pkg.package,
      available,
      error: available ? undefined : "Package not found"
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
  const packages = getPlatformPackages();
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
  const manager = getPackageManagerForPlatform();
  if (!manager) {
    output.appendLine("[HOST TOOLS] No package manager found for this platform");
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
      output.appendLine(`[HOST TOOLS] Unknown package manager: ${manager.name}`);
      return false;
  }

  output.appendLine(`[HOST TOOLS] Installing ${pkg.name}...`);
  const result = await executeTaskHelper(
    `Install ${pkg.name}`,
    installCommand,
    ""
  );

  if (!result) {
    output.appendLine(`[HOST TOOLS] Failed to install ${pkg.name}`);
    return false;
  }

  // Run post-install step if specified
  if (pkg.post_install_step) {
    output.appendLine(`[HOST TOOLS] Running post-install step for ${pkg.name}...`);
    const postInstallResult = await executeTaskHelper(
      `Post-install ${pkg.name}`,
      pkg.post_install_step,
      ""
    );
    if (!postInstallResult) {
      output.appendLine(`[HOST TOOLS] Warning: Post-install step failed for ${pkg.name}`);
    }
  }

  output.appendLine(`[HOST TOOLS] Successfully installed ${pkg.name}`);
  return true;
}

/**
 * Install all missing packages
 */
export async function installAllMissingPackages(): Promise<boolean> {
  const statuses = await checkAllPackages();
  const missingPackages = statuses.filter(s => !s.available);
  
  if (missingPackages.length === 0) {
    output.appendLine("[HOST TOOLS] All packages are already installed");
    return true;
  }

  output.appendLine(`[HOST TOOLS] Found ${missingPackages.length} missing packages`);
  
  const packages = getPlatformPackages();
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
    output.appendLine("[HOST TOOLS] All missing packages installed successfully");
    vscode.window.showInformationMessage(
      "Host tools installed successfully. You may need to restart VS Code for changes to take effect."
    );
  } else {
    output.appendLine("[HOST TOOLS] Some packages failed to install");
    vscode.window.showWarningMessage(
      "Some host tools failed to install. Check the output for details."
    );
  }
  
  return allSuccess;
}