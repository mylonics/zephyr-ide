/*
Copyright 2026 mylonics
Author Rijesh Augustine
SPDX-License-Identifier: Apache-2.0
*/

/**
 * KconfigSession - extension-side wrapper around resources/kconfig_helper.py.
 *
 * Spawns one long-running Python subprocess per session and exposes the
 * helper's JSON-RPC methods as typed async functions.  Lifetime is owned by
 * the caller (typically a DashboardPanel); call `dispose()` on panel close to
 * terminate the helper.
 *
 * Build environment derivation
 * ----------------------------
 * Zephyr's Kconfig tree relies on a number of environment variables (BOARD,
 * ARCH, ZEPHYR_BASE, SOC_DIR, ...) that are normally injected by Zephyr's
 * CMake during a build.  We re-derive these by parsing CMakeCache.txt of an
 * already-built Zephyr application; see `buildEnvFromCMakeCache`.  The Python
 * helper takes the resulting env map at `init` time and applies it to its own
 * `os.environ` before parsing Kconfig.
 *
 * Failure modes
 * -------------
 * - kconfiglib not importable -> `init` rejects with a clear message.
 * - Helper script missing or python missing -> `start()` rejects.
 * - Helper crashes mid-stream -> in-flight requests reject with the
 *   subprocess's exit information; further calls reject immediately.
 */

import * as fs from "fs-extra";
import * as path from "upath";
import { ChildProcessWithoutNullStreams, spawn } from "child_process";
import type { SetupState, WorkspaceConfig } from "../setup_utilities/types";
import { resolveActiveProjectBuild, getBuildFolder } from "../project_utilities/project";
import { resolveEffectiveBuildDir } from "../zephyr_utilities/runners-yaml";
import { parseCMakeCache } from "./build-artifact-reader";

// ---------------------------------------------------------------------------
// Public types - kept loose; the helper is the source of truth for shape.
// ---------------------------------------------------------------------------

export interface KconfigInitParams {
  /** Absolute path to the root Kconfig file (defaults to ${ZEPHYR_BASE}/Kconfig). */
  kconfigRoot: string;
  /** Env map merged into the helper's os.environ before parse. */
  env: Record<string, string>;
  /** Optional .config to load on top of defaults. */
  dotConfig?: string;
  /** Optional srctree override (defaults to dirname(kconfigRoot)). */
  srctree?: string;
}

export interface KconfigInitResult {
  symbols: number;
  menus: number;
  top_menu: KconfigNode;
  kconfig_root: string;
  dot_config_loaded: boolean;
  /** True when the board defconfig file was found and loaded. */
  board_defconfig_loaded?: boolean;
}

export interface KconfigNode {
  id: number;
  prompt: string;
  name: string;
  type: string;
  value: string;
  visible: boolean;
  is_menu: boolean;
  is_choice: boolean;
  is_symbol: boolean;
  children?: KconfigNode[];
  /** Immediate `depends on` expression for choice/menu nodes.  Present only
   * when the dependency is non-trivial (not "y").  Used by the UI to
   * auto-enable guarding symbols when the user interacts with a hidden node. */
  direct_dep?: string;
}

export interface KconfigSymbolDetail {
  name: string;
  type: string;
  prompt: string;
  help: string;
  value: string;
  user_value: string | number | null;
  visible: boolean;
  assignable_values: number[];
  direct_dependencies: string;
  defaults: { value: string; cond: string }[];
  ranges: { low: string; high: string; cond: string }[];
  defining_files: { filename: string; linenr: number; prompt: string }[];
  is_constant: boolean;
  choice: string | null;
}

export interface KconfigChange {
  name: string;
  old: string;
  new: string;
}

export interface KconfigSearchHit {
  name: string;
  prompt: string;
  type: string;
  value: string;
  visible: boolean;
  matched_help: boolean;
  rank: number;
}

export interface KconfigSearchResult {
  hits: KconfigSearchHit[];
  truncated?: boolean;
}

// ---------------------------------------------------------------------------
// Helper script discovery
// ---------------------------------------------------------------------------

/**
 * Returns the absolute path to resources/kconfig_helper.py.
 * `extensionPath` should be the value passed to Activate() (i.e.
 * `context.extensionPath`).
 */
export function getKconfigHelperPath(extensionPath: string): string {
  return path.join(extensionPath, "resources", "kconfig_helper.py");
}

// ---------------------------------------------------------------------------
// Env derivation from CMakeCache.txt
// ---------------------------------------------------------------------------

/**
 * Subset of CMakeCache keys whose values map directly to env vars expected by
 * Zephyr's Kconfig tree.  See ${ZEPHYR_BASE}/cmake/modules/kconfig.cmake for
 * the canonical list.
 */
const CMAKE_TO_ENV: Array<[cacheKey: string, envName: string]> = [
  ["ZEPHYR_BASE", "ZEPHYR_BASE"],
  ["BOARD", "BOARD"],
  ["BOARD_QUALIFIERS", "BOARD_QUALIFIERS"],
  ["BOARD_DIR", "BOARD_DIR"],
  ["BOARD_REVISION", "BOARD_REVISION"],
  ["ARCH", "ARCH"],
  ["ARCH_DIR", "ARCH_DIR"],
  ["SOC", "SOC"],
  ["SOC_DIR", "SOC_DIR"],
  ["SOC_FAMILY", "SOC_FAMILY"],
  ["SOC_NAME", "SOC_NAME"],
  ["SOC_SERIES", "SOC_SERIES"],
  ["SOC_TOOLCHAIN_NAME", "SOC_TOOLCHAIN_NAME"],
  ["KCONFIG_BINARY_DIR", "KCONFIG_BINARY_DIR"],
  ["KCONFIG_ROOT", "KCONFIG_ROOT"],
  ["APPLICATION_SOURCE_DIR", "APPLICATION_SOURCE_DIR"],
  ["APPLICATION_BINARY_DIR", "APPLICATION_BINARY_DIR"],
  ["EDT_PICKLE", "EDT_PICKLE"],
  ["ZEPHYR_TOOLCHAIN_VARIANT", "ZEPHYR_TOOLCHAIN_VARIANT"],
  // Semicolon-separated list of module root dirs.  CMake stores this as a
  // CACHE INTERNAL variable so it IS present in CMakeCache.txt.  The Python
  // helper uses it to resolve ZEPHYR_*_KCONFIG paths before seeding sentinels.
  ["ZEPHYR_MODULES", "ZEPHYR_MODULES"],
  ["ZEPHYR_EXTRA_MODULES", "ZEPHYR_EXTRA_MODULES"],
];

/**
 * Reads CMakeCache.txt and returns env vars Zephyr's Kconfig parser expects.
 *
 * Returns at minimum {ZEPHYR_BASE, BOARD, ARCH, ...} when those keys are in
 * the cache.  Missing keys are simply omitted - kconfiglib will fall back to
 * defaults defined in the Kconfig source.
 */
export function buildEnvFromCMakeCache(buildFolder: string): Record<string, string> {
  if (!fs.existsSync(path.join(buildFolder, "CMakeCache.txt"))) { return {}; }
  const cache = parseCMakeCache(buildFolder);
  const env: Record<string, string> = {};
  for (const [cacheKey, envName] of CMAKE_TO_ENV) {
    const v = cache[cacheKey];
    if (v && v.length > 0) { env[envName] = v; }
  }

  // KCONFIG_BINARY_DIR is a regular (non-cache) CMake variable in Zephyr:
  //   set(KCONFIG_BINARY_DIR ${CMAKE_BINARY_DIR}/Kconfig)
  // It is never written to CMakeCache.txt, so we derive it from buildFolder.
  // Without it, Kconfig `source "$(KCONFIG_BINARY_DIR)/soc/Kconfig.defconfig"`
  // expands to an empty prefix and kconfiglib cannot find the generated files.
  if (!env["KCONFIG_BINARY_DIR"]) {
    env["KCONFIG_BINARY_DIR"] = path.join(buildFolder, "Kconfig");
  }

  // KCONFIG_BOARD_DIR is a regular (non-cache) CMake variable in Zephyr:
  //   set(KCONFIG_BOARD_DIR ${KCONFIG_BINARY_DIR}/boards)
  // It is never written to CMakeCache.txt.  Without it the statement
  //   osource "$(KCONFIG_BOARD_DIR)/Kconfig.$(BOARD)"
  // (in ${ZEPHYR_BASE}/boards/Kconfig.v2) expands to an empty prefix, so the
  // generated board Kconfig is never sourced.  That leaves promptless,
  // select-driven symbols (BOARD_*, SOC_*, CPU_*, ARM/ARM64/RISCV, ...) at
  // their default 'n', because kconfiglib ignores `.config` values for
  // promptless symbols.  The arch "... Options" menus then all evaluate as
  // hidden, breaking the architecture-specific menu filtering.
  if (!env["KCONFIG_BOARD_DIR"]) {
    env["KCONFIG_BOARD_DIR"] = path.join(env["KCONFIG_BINARY_DIR"], "boards");
  }

  // CMakeCache stores BOARD as the full board target, which Zephyr formats as
  //   <name>[@<revision>][/<qualifiers>]
  // e.g. "myl_rp_usb/rp2350a/m33" or "stm32f411e_disco@D/stm32f411xe".
  // Zephyr's kconfig.cmake passes the components as SEPARATE env vars:
  //   BOARD=stm32f411e_disco  BOARD_REVISION=D  BOARD_QUALIFIERS=stm32f411xe
  // boards/Kconfig.v2 builds the board symbol name from $(BOARD) via
  //   config BOARD_$(normalize_upper,$(BOARD))
  // so a combined value would yield an invalid symbol name containing '/' or
  // '@' (e.g. BOARD_STM32F411E_DISCO@D) and the board symbol would never be
  // defined, breaking the BOARD -> SOC -> CPU -> ARM select chain.  Decompose
  // the target: qualifiers follow the first '/', the revision follows '@'.
  if (env["BOARD"]) {
    let board = env["BOARD"];
    const slash = board.indexOf("/");
    if (slash !== -1) {
      const qualifiers = board.slice(slash + 1);
      board = board.slice(0, slash);
      if (!env["BOARD_QUALIFIERS"]) {
        env["BOARD_QUALIFIERS"] = qualifiers;
      }
    }
    const at = board.indexOf("@");
    if (at !== -1) {
      const revision = board.slice(at + 1);
      board = board.slice(0, at);
      if (!env["BOARD_REVISION"]) {
        env["BOARD_REVISION"] = revision;
      }
    }
    env["BOARD"] = board;
  }

  // EDT_PICKLE is set by Zephyr's dts.cmake but is NOT a CACHE variable, so
  // it never appears in CMakeCache.txt.  Without it kconfiglib cannot load the
  // devicetree state, causing all DT_HAS_*_ENABLED symbols to evaluate false
  // and hiding any symbol whose `depends on` includes a DT_HAS_* condition.
  if (!env["EDT_PICKLE"]) {
    const edtPickle = path.join(buildFolder, "zephyr", "edt.pickle");
    if (fs.existsSync(edtPickle)) {
      env["EDT_PICKLE"] = edtPickle;
    }
  }

  return env;
}

/**
 * Convenience: derive `kconfigRoot` for a build.  Prefers the cache value
 * KCONFIG_ROOT if present, otherwise `${ZEPHYR_BASE}/Kconfig`.
 */
export function resolveKconfigRoot(env: Record<string, string>): string | undefined {
  if (env["KCONFIG_ROOT"]) { return env["KCONFIG_ROOT"]; }
  if (env["ZEPHYR_BASE"]) { return path.join(env["ZEPHYR_BASE"], "Kconfig"); }
  return undefined;
}

/**
 * Convenience: returns the `.config` path for a Zephyr build.
 */
export function resolveDotConfig(buildFolder: string): string {
  return path.join(buildFolder, "zephyr", ".config");
}

/**
 * Resolve the build directory fed into the Kconfig editor session for a build
 * (defaults to the active project/build). Mirrors the same resolution used by
 * the Kconfig editor's lazy session factory (extension.ts) before handing the
 * build folder to buildEnvFromCMakeCache/resolveDotConfig — including
 * resolving sysbuild domains via resolveEffectiveBuildDir, so a sysbuild
 * build's session reads/writes the per-image CMakeCache.txt/.config rather
 * than the top-level sysbuild directory's own (different) files.
 */
export function resolveKconfigBuildDir(
  wsConfig: WorkspaceConfig,
  projectName?: string,
  buildName?: string
): string | undefined {
  const resolved = resolveActiveProjectBuild(wsConfig, { projectName, buildName });
  if (!resolved) { return undefined; }
  return resolveEffectiveBuildDir(getBuildFolder(wsConfig, resolved.project, resolved.build));
}

// ---------------------------------------------------------------------------
// Python executable resolution
// ---------------------------------------------------------------------------

/**
 * Returns the path to the venv's Python interpreter (or "python3"/"python"
 * when no venv is configured).  Mirrors the layout assumed by
 * `getPythonVenvBinaryFolder` in utils.ts.
 */
export function resolveVenvPython(setupState: SetupState | undefined): string {
  const venv = setupState?.env?.["VIRTUAL_ENV"];
  if (venv) {
    if (process.platform === "win32") {
      return path.join(venv, "Scripts", "python.exe");
    }
    return path.join(venv, "bin", "python");
  }
  return process.platform === "win32" ? "python" : "python3";
}

// ---------------------------------------------------------------------------
// JSON-RPC pump
// ---------------------------------------------------------------------------

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  method: string;
}

export type KconfigSessionLogListener = (
  level: "info" | "warn" | "error",
  message: string,
) => void;

export interface KconfigSessionOptions {
  helperScript: string;
  pythonExecutable: string;
  /** Extra env applied to the spawned python process (PATH from venv etc.). */
  spawnEnv?: NodeJS.ProcessEnv;
  /** Working directory for the spawned helper. Defaults to cwd of caller. */
  cwd?: string;
  /** Optional log sink for the helper's notifications (and our own warnings). */
  onLog?: KconfigSessionLogListener;
}

export class KconfigSession {
  private readonly _opts: KconfigSessionOptions;
  private _proc: ChildProcessWithoutNullStreams | undefined;
  private _stdoutBuf = "";
  private _stderrBuf = "";
  private _nextId = 1;
  private readonly _pending = new Map<number, PendingRequest>();
  private _disposed = false;
  private _exitInfo: { code: number | null; signal: NodeJS.Signals | null } | undefined;

  constructor(options: KconfigSessionOptions) {
    this._opts = options;
  }

  /**
   * Spawns the helper.  Resolves immediately once spawn succeeds; the helper
   * stays alive until `shutdown()` or `dispose()`.  Throws if the helper
   * script does not exist.
   */
  start(): void {
    if (this._proc) { return; }
    if (!fs.existsSync(this._opts.helperScript)) {
      throw new Error(`kconfig helper script not found: ${this._opts.helperScript}`);
    }

    // Important: -u (unbuffered) so we get line-by-line stdout from the helper
    // without waiting for buffers to fill.  The helper itself flushes after
    // every response but Python may still buffer if it thinks stdout is a pipe.
    this._proc = spawn(
      this._opts.pythonExecutable,
      ["-u", this._opts.helperScript],
      {
        cwd: this._opts.cwd,
        env: this._opts.spawnEnv ?? process.env,
        stdio: ["pipe", "pipe", "pipe"],
      },
    ) as ChildProcessWithoutNullStreams;

    this._proc.stdout.setEncoding("utf8");
    this._proc.stderr.setEncoding("utf8");
    this._proc.stdout.on("data", (chunk: string) => this._onStdout(chunk));
    this._proc.stderr.on("data", (chunk: string) => this._onStderr(chunk));
    this._proc.on("exit", (code, signal) => this._onExit(code, signal));
    this._proc.on("error", (err) => this._failAll(err));
  }

  // -- High-level API ---------------------------------------------------

  init(params: KconfigInitParams): Promise<KconfigInitResult> {
    return this._call<KconfigInitResult>("init", {
      kconfig_root: params.kconfigRoot,
      env: params.env,
      dot_config: params.dotConfig,
      srctree: params.srctree,
    });
  }

  reload(): Promise<KconfigInitResult> {
    return this._call<KconfigInitResult>("reload", {});
  }

  tree(): Promise<{ top_menu: KconfigNode }> {
    return this._call<{ top_menu: KconfigNode }>("tree", {});
  }

  symbol(name: string): Promise<KconfigSymbolDetail> {
    return this._call<KconfigSymbolDetail>("symbol", { name });
  }

  set(name: string, value: string): Promise<{ changed: KconfigChange[] }> {
    return this._call<{ changed: KconfigChange[] }>("set", { name, value });
  }

  diff(): Promise<{ changes: KconfigChange[] }> {
    return this._call<{ changes: KconfigChange[] }>("diff", {});
  }

  save(filePath: string, minimal = true): Promise<{ path: string }> {
    return this._call<{ path: string }>("save", { path: filePath, minimal });
  }

  search(
    query: string,
    opts: { include_help?: boolean; include_hidden?: boolean; limit?: number } = {},
  ): Promise<KconfigSearchResult> {
    return this._call<KconfigSearchResult>("search", {
      query,
      include_help: opts.include_help ?? true,
      include_hidden: opts.include_hidden ?? false,
      limit: opts.limit ?? 200,
    });
  }

  /**
   * Politely asks the helper to exit, then waits for the process to close.
   * Safe to call multiple times.
   */
  async shutdown(): Promise<void> {
    if (!this._proc || this._disposed) { return; }
    try {
      await this._call<{ ok: true }>("shutdown", {});
    } catch {
      // ignore - we're tearing down
    }
    this.dispose();
  }

  /**
   * Force-kills the helper if still running.  Rejects every in-flight request.
   * Idempotent.
   */
  dispose(): void {
    if (this._disposed) { return; }
    this._disposed = true;
    if (this._proc && this._proc.exitCode === null) {
      try {
        this._proc.kill();
      } catch {
        // ignore
      }
    }
    this._failAll(new Error("KconfigSession disposed"));
  }

  // -- Internals --------------------------------------------------------

  private _call<T>(method: string, params: Record<string, unknown>): Promise<T> {
    if (this._disposed) {
      return Promise.reject(new Error(`KconfigSession is disposed`));
    }
    if (!this._proc) {
      return Promise.reject(new Error(`KconfigSession not started`));
    }
    if (this._proc.exitCode !== null) {
      return Promise.reject(
        new Error(
          `KconfigSession helper has already exited (code=${this._proc.exitCode}). stderr=${this._stderrBuf.trim()}`,
        ),
      );
    }
    const id = this._nextId++;
    return new Promise<T>((resolve, reject) => {
      this._pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        method,
      });
      const payload = JSON.stringify({ id, method, params }) + "\n";
      try {
        this._proc!.stdin.write(payload);
      } catch (err) {
        this._pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  private _onStdout(chunk: string): void {
    this._stdoutBuf += chunk;
    let nlIdx: number;
    while ((nlIdx = this._stdoutBuf.indexOf("\n")) !== -1) {
      const line = this._stdoutBuf.slice(0, nlIdx).trim();
      this._stdoutBuf = this._stdoutBuf.slice(nlIdx + 1);
      if (!line) { continue; }
      this._handleLine(line);
    }
  }

  private _handleLine(line: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(line);
    } catch {
      this._opts.onLog?.("warn", `kconfig_helper: unparseable line: ${line}`);
      return;
    }
    if (typeof msg.event === "string") {
      // Unsolicited notification (log).
      const level = (msg.level as KconfigSessionLogListener extends (l: infer L, m: string) => void
        ? L
        : never) ?? "info";
      this._opts.onLog?.(
        level as "info" | "warn" | "error",
        typeof msg.message === "string" ? msg.message : "",
      );
      return;
    }
    if (typeof msg.id !== "number") { return; }
    const pending = this._pending.get(msg.id);
    if (!pending) { return; }
    this._pending.delete(msg.id);
    if (msg.error) {
      const err = msg.error as { message?: string };
      pending.reject(
        new Error(
          `kconfig_helper.${pending.method} failed: ${err.message ?? "unknown error"}`,
        ),
      );
      return;
    }
    pending.resolve(msg.result);
  }

  private _onStderr(chunk: string): void {
    this._stderrBuf += chunk;
    // Forward stderr lines verbatim - the helper itself does not write to
    // stderr in normal operation, so any output is significant.
    this._opts.onLog?.("warn", `kconfig_helper stderr: ${chunk.trim()}`);
  }

  private _onExit(code: number | null, signal: NodeJS.Signals | null): void {
    this._exitInfo = { code, signal };
    if (this._pending.size > 0) {
      this._failAll(
        new Error(
          `kconfig_helper exited unexpectedly (code=${code}, signal=${signal}). stderr=${this._stderrBuf.trim()}`,
        ),
      );
    }
  }

  private _failAll(err: Error): void {
    for (const pending of this._pending.values()) {
      pending.reject(err);
    }
    this._pending.clear();
  }

  /** Exposed for tests / status displays. */
  get exitInfo(): { code: number | null; signal: NodeJS.Signals | null } | undefined {
    return this._exitInfo;
  }
}
