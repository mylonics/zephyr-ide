/*
Copyright 2026 mylonics
Author Rijesh Augustine
SPDX-License-Identifier: Apache-2.0
*/

/**
 * Memory report runner — Option A implementation.
 *
 * Invokes `cmake --build <buildFolder> --target ram_report` and `rom_report`
 * against an already-built Zephyr build directory.  These cmake targets call
 * Zephyr's size_report.py, which reads the ELF and writes
 * zephyr/ram_report.json and zephyr/rom_report.json.
 *
 * Also regenerates the zephyr.stat file using the toolchain `nm` binary
 * recorded in CMakeCache.txt so the Summary page memory bar updates without
 * requiring a full west build.
 *
 * All failures are silenced — callers should check whether the output files
 * exist after this returns.
 */

import * as fs from 'fs-extra';
import * as path from 'upath';
import { executeShellCommandInPythonEnv, executeTaskHelperInPythonEnv } from '../utilities/utils';
import type { SetupState } from '../setup_utilities/types';

// ---------------------------------------------------------------------------
// Stat file regeneration via nm
// ---------------------------------------------------------------------------

/**
 * Reads the CMAKE_NM entry from CMakeCache.txt and returns the full path to
 * the nm binary, or null if unavailable.
 */
function readCMakeNm(buildFolder: string): string | null {
  const cachePath = path.join(buildFolder, 'CMakeCache.txt');
  if (!fs.existsSync(cachePath)) { return null; }
  for (const line of fs.readFileSync(cachePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('CMAKE_NM')) { continue; }
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) { continue; }
    const val = trimmed.slice(eqIdx + 1).trim();
    if (val && fs.existsSync(val)) { return val; }
  }
  return null;
}

/**
 * Runs `nm --size-sort` on the ELF and writes the output to zephyr.stat.
 * This is equivalent to what Zephyr's build system does during a normal build.
 * Silently does nothing if nm or the ELF cannot be found.
 */
async function generateStatFile(
  buildFolder: string,
  setupState: SetupState,
  kernelBinName = 'zephyr',
): Promise<void> {
  const nmPath = readCMakeNm(buildFolder);
  if (!nmPath) { return; }

  const elfPath = path.join(buildFolder, 'zephyr', `${kernelBinName}.elf`);
  const statPath = path.join(buildFolder, 'zephyr', `${kernelBinName}.stat`);
  if (!fs.existsSync(elfPath)) { return; }

  // Run nm and capture stdout, then write to the stat file directly.
  // This avoids shell-redirect syntax differences between platforms.
  const cmd = `"${nmPath}" --size-sort "${elfPath}"`;
  const result = await executeShellCommandInPythonEnv(cmd, setupState.setupPath, setupState, false);
  if (result.exitCode === 0 && result.stdout) {
    await fs.writeFile(statPath, result.stdout, 'utf8');
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Runs the cmake `ram_report` and `rom_report` targets which write
 * `ram.json` and `rom.json` at the build root.
 * Returns an error message string on failure, or null on success.
 *
 * When `silent` is true (the default) the cmake commands run as background
 * child processes with no visible terminal.  Pass `silent = false` to keep
 * the old behaviour of showing a VS Code Task terminal (used by the explicit
 * "Run RAM/ROM Report" commands).
 */
export async function runMemoryReports(
  buildFolder: string,
  setupState: SetupState,
  projectName = 'project',
  buildName = 'build',
  silent = true,
): Promise<string | null> {
  for (const target of ['ram_report', 'rom_report']) {
    const cmd = `cmake --build "${buildFolder}" --target ${target}`;
    if (silent) {
      const result = await executeShellCommandInPythonEnv(cmd, setupState.setupPath ?? '', setupState, false);
      if (result.exitCode !== 0) {
        return `cmake --target ${target} failed.`;
      }
    } else {
      const taskName = `Zephyr IDE Memory Report: ${projectName} ${buildName}`;
      const ok = await executeTaskHelperInPythonEnv(setupState, taskName, cmd, setupState.setupPath);
      if (!ok) {
        return `cmake --target ${target} failed. Check the terminal output for details.`;
      }
    }
  }
  return null;
}

/**
 * Full memory refresh: regenerates the stat file AND runs cmake memory report
 * targets.  Call this when the user clicks the Refresh button in the dashboard.
 * Returns an error message string if the cmake step fails, or null on success.
 */
export async function runFullMemoryRefresh(
  buildFolder: string,
  setupState: SetupState,
  projectName?: string,
  buildName?: string,
): Promise<string | null> {
  // Stat file regeneration is fast and non-critical — run it in parallel with cmake.
  const [, cmakeError] = await Promise.all([
    generateStatFile(buildFolder, setupState),
    runMemoryReports(buildFolder, setupState, projectName, buildName),
  ]);
  return cmakeError;
}

/**
 * Exposed for callers (e.g. buildDashboardReport) that want to generate only
 * the stat file without running the full cmake report targets.
 */
export { generateStatFile };

