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
import { resolveEffectiveBuildDir } from '../zephyr_utilities/runners-yaml';
import { parseCMakeCache } from './build-artifact-reader';

// ---------------------------------------------------------------------------
// Stat file regeneration via nm
// ---------------------------------------------------------------------------

/**
 * Reads the CMAKE_NM entry from CMakeCache.txt and returns the full path to
 * the nm binary, or null if unavailable.
 */
function readCMakeNm(buildFolder: string): string | null {
  const nm = parseCMakeCache(buildFolder)['CMAKE_NM']?.trim();
  return nm && fs.existsSync(nm) ? nm : null;
}

/**
 * Runs `nm --size-sort` on the ELF and writes the output to zephyr.stat.
 * This is equivalent to what Zephyr's build system does during a normal build.
 * Silently does nothing if nm or the ELF cannot be found.
 *
 * Automatically resolves the effective (per-image) build directory when
 * sysbuild is in use so that the correct CMakeCache.txt and ELF are used.
 */
async function generateStatFile(
  buildFolder: string,
  setupState: SetupState,
  kernelBinName = 'zephyr',
): Promise<void> {
  const effectiveFolder = resolveEffectiveBuildDir(buildFolder);
  const nmPath = readCMakeNm(effectiveFolder);
  if (!nmPath) { return; }

  const elfPath = path.join(effectiveFolder, 'zephyr', `${kernelBinName}.elf`);
  const statPath = path.join(effectiveFolder, 'zephyr', `${kernelBinName}.stat`);
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

export type MemoryReportTarget = 'ram_report' | 'rom_report';

export interface MemoryReportRunResult {
  /** Error message on failure, or null on success. */
  error: string | null;
  /**
   * Combined stdout+stderr from the underlying cmake invocation(s). Only
   * populated in silent mode — a visible Task terminal has no programmatic
   * output to capture. Callers that don't need it (e.g. runFullMemoryRefresh)
   * can ignore it.
   */
  output: string;
}

/**
 * Runs the cmake `ram_report` and/or `rom_report` targets, which write
 * `ram.json` and/or `rom.json` at the build root. This is the single
 * implementation behind both the Dashboard's "Refresh Memory" button
 * (runFullMemoryRefresh, silent) and the standalone "Run RAM/ROM Report"
 * commands (build.ts's buildRamRomReport/buildRamRomReportHeadless, one
 * target at a time, silent or visible per caller).
 *
 * When sysbuild is in use (domains.yaml present) the cmake command is run
 * against the default domain's build directory rather than the top-level
 * sysbuild directory.
 *
 * When `silent` is true (the default) the cmake commands run as background
 * child processes with no visible terminal.  Pass `silent = false` to show
 * a VS Code Task terminal instead (used by the explicit "Run RAM/ROM Report"
 * commands).
 */
export async function runMemoryReports(
  buildFolder: string,
  setupState: SetupState,
  projectName = 'project',
  buildName = 'build',
  silent = true,
  targets: ReadonlyArray<MemoryReportTarget> = ['ram_report', 'rom_report'],
): Promise<MemoryReportRunResult> {
  const effectiveFolder = resolveEffectiveBuildDir(buildFolder);
  const outputs: string[] = [];
  for (const target of targets) {
    const cmd = `cmake --build "${effectiveFolder}" --target ${target}`;
    if (silent) {
      const result = await executeShellCommandInPythonEnv(cmd, setupState.setupPath ?? '', setupState, false);
      const combined = [result.stdout, result.stderr].filter(Boolean).join('\n');
      if (combined) { outputs.push(combined); }
      if (result.exitCode !== 0) {
        return { error: `cmake --target ${target} failed.`, output: outputs.join('\n') };
      }
    } else {
      const taskName = `Zephyr IDE Memory Report: ${projectName} ${buildName}`;
      const ok = await executeTaskHelperInPythonEnv(setupState, taskName, cmd, setupState.setupPath);
      if (!ok) {
        return { error: `cmake --target ${target} failed. Check the terminal output for details.`, output: outputs.join('\n') };
      }
    }
  }
  return { error: null, output: outputs.join('\n') };
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
  const [, cmakeResult] = await Promise.all([
    generateStatFile(buildFolder, setupState),
    runMemoryReports(buildFolder, setupState, projectName, buildName),
  ]);
  return cmakeResult.error;
}

/**
 * Exposed for callers (e.g. buildDashboardReport) that want to generate only
 * the stat file without running the full cmake report targets.
 */
export { generateStatFile };

