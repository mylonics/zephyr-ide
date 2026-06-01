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
import * as fs from "fs-extra";
import * as path from "upath";

import { executeShellCommandInPythonEnv, loadYamlFile } from "../utilities/utils";
import { outputInfo, outputError, outputCommandFailure, showOutput } from "../utilities/output";
import { SetupState, formatZephyrVersion } from "./types";
import { parseWestConfigManifest } from "./west-config-parser";


export interface ZephyrVersionNumber {
  major: number;
  minor: number;
  patch: number;
  tweak: number;
  extra: number;
}

/**
 * Result returned by {@link executeWestList}.
 *
 * On success `ok` is `true` and `lines` contains the raw output lines.
 * On failure `ok` is `false` and `needsWestUpdate` indicates whether the
 * west error message suggests running `west update` (e.g. deleted module
 * files that need to be re-cloned).
 */
type WestListOutcome =
  | { ok: true; lines: string[] }
  | { ok: false; needsWestUpdate: boolean };

async function executeWestList(setupState: SetupState): Promise<WestListOutcome> {
  // Verify .west/config and manifest file exist before invoking west.
  // Uses the shared west-config-parser to avoid duplicating INI parsing logic.
  const manifest = parseWestConfigManifest(setupState.setupPath);
  if (!manifest || !manifest.path) {
    outputError("West List", `.west/config not found or manifest section missing at: ${setupState.setupPath}. West is not initialized.`);
    return { ok: false, needsWestUpdate: false };
  }

  const manifestFile = manifest.file ?? "west.yml";
  const fullManifestPath = path.join(setupState.setupPath, manifest.path, manifestFile);

  if (!fs.existsSync(fullManifestPath)) {
    outputError("West List", `Manifest file not found at: ${fullManifestPath}. West list will fail.`);
    return { ok: false, needsWestUpdate: false };
  }

  // Use pipe separator to avoid paths with spaces being split incorrectly.
  // On Windows, use PowerShell instead of the default cmd.exe to avoid
  // quoting / environment issues that cause west to fail with
  // "manifest file not found: None".
  const cmd = `west list -f "{name}|{abspath}|{revision}|{url}"`;
  const res = await executeShellCommandInPythonEnv(cmd, setupState.setupPath, setupState, false);

  if (!res.stdout) {
    outputCommandFailure("West List", res);
    // Detect whether the west error message advises running `west update`
    // (e.g. a module repo was manually deleted).
    const needsWestUpdate = typeof res.stderr === 'string' && res.stderr.includes("west update");
    return { ok: false, needsWestUpdate };
  }

  return { ok: true, lines: res.stdout.split(/\r?\n/) };
}

/**
 * Show an actionable error notification after a `west list` failure.
 *
 * When `needsWestUpdate` is true (detected from west's own stderr hint),
 * offer a "Run West Update" button so the user can restore deleted module
 * files with a single click.  Always include "Show Output" so the user can
 * inspect the full error details logged by {@link outputCommandFailure}.
 */
function notifyWestListFailure(needsWestUpdate: boolean): void {
  const message = needsWestUpdate
    ? "West module files are missing or outdated. Run 'west update' to restore them."
    : "West list failed. Check the Zephyr IDE output for details.";

  const actions: string[] = needsWestUpdate
    ? ["Run West Update", "Show Output"]
    : ["Show Output"];

  void vscode.window.showErrorMessage(message, ...actions).then(selection => {
    if (selection === "Run West Update") {
      void vscode.commands.executeCommand("zephyr-ide.west-update");
    } else if (selection === "Show Output") {
      showOutput();
    }
  });
}

/**
 * Check if a directory is a Zephyr repository by looking for VERSION file
 */
function isZephyrRepository(dirPath: string): boolean {
  const versionFile = path.join(dirPath, "VERSION");
  return fs.existsSync(versionFile);
}

export async function getModuleList(setupState: SetupState) {

  const outputList: Array<string[]> = [];
  const outcome = await executeWestList(setupState);

  if (!outcome.ok) {
    notifyWestListFailure(outcome.needsWestUpdate);
    return outputList;
  }

  for (const line of outcome.lines) {
    if (!line.trim()) {
      continue;
    }
    const data = line.split('|').map(s => s.trim());
    if (data[0] !== "manifest" && data[0] !== "") {
      outputList.push(data);
    }
  }
  return outputList;
}

export function getModuleVersion(modulePath: string): ZephyrVersionNumber | undefined {
  const filePath = path.join(modulePath, "VERSION");

  if (fs.existsSync(filePath)) {
    const file = fs.readFileSync(filePath, 'utf8');
    const majorMatch = file.match(/VERSION_MAJOR\s*=\s*(\d+)/);
    const minorMatch = file.match(/VERSION_MINOR\s*=\s*(\d+)/);
    const patchMatch = file.match(/PATCHLEVEL\s*=\s*(\d+)/);
    const tweakMatch = file.match(/VERSION_TWEAK\s*=\s*(\d+)/);
    const extraMatch = file.match(/EXTRAVERSION\s*=\s*(\S*)/);

    if (!majorMatch || !minorMatch || !patchMatch) {
      outputInfo("Modules", `Could not parse VERSION file at: ${filePath}`);
      return undefined;
    }

    const versionNumber: ZephyrVersionNumber = {
      major: parseInt(majorMatch[1]),
      minor: parseInt(minorMatch[1]),
      patch: parseInt(patchMatch[1]),
      tweak: tweakMatch ? parseInt(tweakMatch[1]) : 0,
      extra: extraMatch && extraMatch[1].trim() !== "" ? (Number.isNaN(parseInt(extraMatch[1].trim())) ? 0 : parseInt(extraMatch[1].trim())) : 0,
    };
    outputInfo("Modules", `Version: ${formatZephyrVersion(versionNumber)}`);
    return versionNumber;
  }
}

function compareVersion(version: ZephyrVersionNumber, major: number, minor: number, patch: number): number {
  if (version.major !== major) { return version.major - major; }
  if (version.minor !== minor) { return version.minor - minor; }
  return version.patch - patch;
}

export function isVersionNumberGreaterEqual(version: ZephyrVersionNumber, major: number, minor: number, patch: number) {
  return compareVersion(version, major, minor, patch) >= 0;
}

export function isVersionNumberGreater(version: ZephyrVersionNumber, major: number, minor: number, patch: number) {
  return compareVersion(version, major, minor, patch) > 0;
}

export function getModuleYamlFile(moduleAbsPath: string): any {
  const filePath = path.join(moduleAbsPath, "zephyr", "module.yml");
  return loadYamlFile(filePath);
}

export async function getDtsIncludes(setupState: SetupState) {
  const modules = await getModuleList(setupState);
  const dtsIncludeArray: string[] = [];
  for (const module of modules) {
    const yamlFile = await getModuleYamlFile(module[1]);
    if (yamlFile && yamlFile.build && yamlFile.build.settings && yamlFile.build.settings.dts_root) {
      dtsIncludeArray.push(path.join(module[1], yamlFile.build.settings.dts_root, "dts"));
    }
  }
  return dtsIncludeArray;
}

export async function getModulePathAndVersion(setupState: SetupState, moduleName: string) {
  const outcome = await executeWestList(setupState);

  if (!outcome.ok) {
    notifyWestListFailure(outcome.needsWestUpdate);
    return;
  }

  let manifestEntry: string[] | undefined;

  for (const line of outcome.lines) {
    if (!line.trim()) {
      continue;
    }
    const data = line.split('|').map(s => s.trim());
    if (data[0] === moduleName) {
      return { path: data[1], version: data[2] };
    }
    if (data[0] === "manifest") {
      manifestEntry = data;
    }
  }

  // Check if the requested module is the manifest repository
  if (moduleName === "zephyr" && manifestEntry && manifestEntry[1] && isZephyrRepository(manifestEntry[1])) {
    return { path: manifestEntry[1], version: manifestEntry[2] };
  }

  return;
}

export async function getModuleSampleFolders(setupState: SetupState) {
  const outcome = await executeWestList(setupState);
  const samplefolders: [string, string][] = [];

  if (!outcome.ok) {
    notifyWestListFailure(outcome.needsWestUpdate);
    return samplefolders;
  }

  const modules: string[][] = [];
  let manifestEntry: string[] | undefined;

  for (const line of outcome.lines) {
    if (!line.trim()) {
      continue;
    }
    const data = line.split('|').map(s => s.trim());
    if (data[0] === "manifest") {
      manifestEntry = data;
    } else if (data[0] !== "") {
      modules.push(data);
    }
  }

  // Add zephyr samples if zephyrDir is set
  if (setupState.zephyrDir) {
    samplefolders.push(["zephyr", path.join(setupState.zephyrDir, 'samples')]);
  } else if (manifestEntry && manifestEntry[1] && isZephyrRepository(manifestEntry[1])) {
    // Check if zephyr is the manifest repository
    samplefolders.push(["zephyr", path.join(manifestEntry[1], 'samples')]);
  }

  // Scan all non-Zephyr entries for module.yml sample declarations.
  // Include the manifest when it is a custom module repo (e.g. a board library used as the
  // west manifest).  West always reports the manifest project name as the literal string
  // "manifest", so use path.basename to recover the real name for display.
  const entriesToCheck: string[][] = [...modules];
  if (manifestEntry && manifestEntry[1] && !isZephyrRepository(manifestEntry[1])) {
    entriesToCheck.push([path.basename(manifestEntry[1]), manifestEntry[1]]);
  }

  for (const entry of entriesToCheck) {
    const yamlFile = getModuleYamlFile(entry[1]);
    const moduleSamples: string[] | undefined = yamlFile?.build?.samples ?? yamlFile?.samples;
    if (moduleSamples) {
      for (const samplePath of moduleSamples) {
        samplefolders.push([entry[0], path.join(entry[1], samplePath)]);
      }
    }
  }
  return samplefolders;
}

/**
 * Recursively walk the sample folder tree gathering (module, sample name, description, path).
 * Previous implementation mixed sync FS calls inside an async function and relied on implicit
 * synchronous execution. That could appear to "hang" if a directory cycle (via symlink) existed
 * or an exceptionally large tree was traversed. This version:
 *  - Is fully synchronous (no needless async/await overhead)
 *  - Guards against directory cycles / symlinks
 *  - Skips very common non-source dirs (build, .git, node_modules)
 *  - Catches and logs (once) filesystem errors instead of aborting the whole traversal
 */
function getSampleRecursive(
  dir: string,
  moduleName: string,
  sampleList: [string, string, string, string][],
  visited: Set<string>,
  logErrors: boolean = true,
  depth: number = 0,
  maxDepth: number = 8
) {
  if (depth > maxDepth) {
    return;
  }
  let realDir: string;
  try {
    realDir = fs.realpathSync(dir);
  } catch (e) {
    if (logErrors) {
      outputInfo("West Modules", `Skipping unreadable path: ${dir} -> ${(e as Error).message}`);
    }
    return;
  }

  if (visited.has(realDir)) {
    return; // cycle / already processed
  }
  visited.add(realDir);

  const tentativePath = path.join(realDir, "sample.yaml");
  try {
    const yamlFile: any = loadYamlFile(tentativePath);
    if (yamlFile) {
      if (yamlFile.sample && yamlFile.sample.name) {
        const description = yamlFile.sample.description ? yamlFile.sample.description : "";
        sampleList.push([moduleName, yamlFile.sample.name, description, realDir]);
      }
      // Either way, do not recurse further below a folder that declares a sample.yaml
      return;
    }
  } catch (e) {
    if (logErrors) {
      outputInfo("West Modules", `Error reading sample.yaml in ${realDir}: ${(e as Error).message}`);
    }
    // continue to try to descend
  }

  let entries: string[] = [];
  try {
    entries = fs.readdirSync(realDir);
  } catch (e) {
    if (logErrors) {
      outputInfo("West Modules", `Cannot read directory ${realDir}: ${(e as Error).message}`);
    }
    return;
  }

  for (const name of entries) {
    // Skip some common large / irrelevant directories
    if (name === 'build' || name === '.git' || name === 'node_modules') {
      continue;
    }
    const childPath = path.join(realDir, name);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(childPath);
    } catch (e) {
      if (logErrors) {
        outputInfo("West Modules", `stat failed for ${childPath}: ${(e as Error).message}`);
      }
      continue;
    }
    // Follow directories (cycle protection is handled by the visited set via realpathSync)
    if (stat.isDirectory()) {
      getSampleRecursive(childPath, moduleName, sampleList, visited, logErrors, depth + 1, maxDepth);
    }
  }
}

export async function getSamples(setupState: SetupState) {
  const samplefolders = await getModuleSampleFolders(setupState);
  const sampleList: [string, string, string, string][] = [];
  const visited = new Set<string>();
  const maxDepth = 3;
  for (const folder of samplefolders) {
    getSampleRecursive(folder[1], folder[0], sampleList, visited, true, 0, maxDepth);
  }
  return sampleList;
}


