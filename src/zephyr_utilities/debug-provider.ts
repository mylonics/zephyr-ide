/*
Copyright 2026 mylonics 
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

/**
 * `vscode.DebugConfigurationProvider` for the `zephyr-ide` debugger type.
 *
 * The provider takes a minimal user-supplied configuration (which may be no
 * more than `{ type: "zephyr-ide", request: "launch" }`) and translates it
 * into a fully-formed `cortex-debug` configuration by reading the active
 * build's `runners.yaml`. This eliminates the need for users to maintain
 * runner-specific cortex-debug launch.json entries by hand.
 *
 * # Runner → servertype mapping
 *
 * - **Native** (jlink, openocd, pyocd, stlink, stm32cubeprogrammer-stlink,
 *   blackmagicprobe/bmp, qemu) — cortex-debug's built-in server is used;
 *   per-runner argument parsing lifts `runners.yaml` flags into the
 *   matching cortex-debug fields.
 * - **External bridge** (nrfjprog, linkserver, esp32, stm32cubeprogrammer)
 *   — Zephyr IDE spawns `west debugserver`, parses the listening port
 *   from its output (see `debug-server-bridge.ts`), and configures
 *   cortex-debug with `servertype: "external"` + `gdbTarget`. The server
 *   is terminated on `onDidTerminateDebugSession`.
 * - **Unsupported** (dfu-util, uf2, bossac, teensy, …) — the provider
 *   surfaces an actionable error listing the rejected runners.
 *
 * # Field precedence (last wins)
 *
 *   1. Defaults from `runners.yaml` (build-system source of truth).
 *   2. Active runner profile's `extraArgs`.
 *   3. Per-build `bindOverrides[debug/attach].extraArgs`.
 *   4. User's `launch.json` entry — overrides ALL of the above except for
 *      the reserved keys: `type`, `request`, `name`, `runner`, `rtos`
 *      (Zephyr IDE controls these to avoid invalid configurations).
 *
 * # Probe overrides
 *
 * The runner-profile editor lets users pin a specific probe for `openocd`
 * (writes `--openocd-config interface/<probe>.cfg`) and `pyocd` (writes
 * `--probe=<type>`). Any conflicting `interface/*.cfg` from `runners.yaml`
 * is filtered out so the chosen probe is not double-loaded. See
 * `RUNNER_SECONDARY_SELECTS` in `runner-profile-app.ts` for the dropdown
 * data and the openocd/pyocd switch arms in `buildCortexDebugConfig`
 * below for the override semantics.
 */

import * as vscode from "vscode";
import * as path from "upath";
import * as fs from "fs";
import {
  parseRunnersYaml,
  resolveRunnersYamlPath,
  findSvdFile,
  runnerToServerType,
  serverTypeToRunner,
  runnerNeedsBridge,
  resolveCanonicalRunner,
  RunnersYaml,
} from "./runners-yaml";
import { startWestDebugServer, disposeOnSessionEnd } from "./debug-server-bridge";
import { resolveActiveProjectBuild, askUserForProject, askUserForBuild, getEffectiveActiveProfileName, getEffectiveBuildDebugBind } from "../project_utilities/project";
import { loadRunnerProfiles, findRunnerProfile, resolveRunnerArgs } from "../project_utilities/runner_profiles";
import { WorkspaceConfig } from "../setup_utilities/types";
import { getVenvPath } from "../setup_utilities/workspace-config";
import { notifyError, outputInfo, outputWarning } from "../utilities/output";
import { RUNNER_TARGET_PREFIX, CORTEX_DEBUG_PREFIX, WEST_DEBUG_PREFIX } from "../utilities/utils";

export const ZEPHYR_IDE_CORTEX_DEBUG_TYPE = "zephyr-ide-cortex";
export const ZEPHYR_IDE_WEST_DEBUG_TYPE = "zephyr-ide-west";

/**
 * Controls whether the provider asks the user to pick a project/build at
 * session start, or silently uses the currently active ones.
 *
 * - `"auto"` (default) — use the active project and active build, no prompt.
 * - `"askBoth"` — prompt for project first, then prompt for build.
 * - `"askProject"` — prompt for project; use that project's active build.
 * - `"askBuild"` — use the active project; prompt for which build to debug.
 */
type AskMode = "auto" | "askBoth" | "askProject" | "askBuild";

/** Extra fields a user may set on a `zephyr-ide` debug configuration. */
interface ZephyrIdeDebugConfig extends vscode.DebugConfiguration {
  /** Optional explicit Zephyr runner to use (e.g. "jlink", "openocd"). */
  runner?: string;
  /**
   * Internal flag set by `startDebugSession` for Build-and-Debug sessions
   * whose active profile has an explicit (non-"auto") `buildDebug` slot.
   * When true, userArgs/enableRtt/probe/bindOverrides are derived from the
   * profile's `buildDebug` slot (via `getEffectiveBuildDebugBind`) instead of
   * `debug`. Not intended to be set by hand in launch.json.
   */
  zephyrIdeBuildDebug?: boolean;
  /**
   * Pin the debug session to a specific project by name. When set together
   * with `build`, Zephyr IDE skips the active-project/build look-up
   * entirely. When set alone, the project's active build is used.
   */
  project?: string;
  /**
   * Pin the debug session to a specific build configuration name. When set
   * together with `project`, both are used as-is. When set alone (without
   * `project`), the active project is used with this build name.
   */
  build?: string;
  /**
   * Whether to ask the user to choose a project and/or build at launch time.
   * Has no effect when `project` or `build` are already specified.
   * Defaults to `"auto"`.
   */
  ask?: AskMode;
  /**
   * When true, skip the auto-translation pipeline entirely and spawn
   * `west debugserver --runner <runner> [westArgs]` directly. cortex-debug
   * connects as `servertype: "external"`. ELF and GDB path are still read from
   * runners.yaml. Only `runner` and `westArgs` are consumed in this mode; all
   * runner-specific translation fields (configFiles, serverArgs, etc.) are ignored.
   */
  useWestDebugServer?: boolean;
  /**
   * Raw arguments appended verbatim to `west debugserver` when
   * `useWestDebugServer` is true. Inserted after
   * `--runner <runner> --build-dir <buildDir>`, so runner-specific flags go
   * here (e.g. `["--dev-id", "12345"]` for nrfjprog).
   */
  westArgs?: string[];
  toolOpt?: string[];
  domain?: string;
  file?: string;
  elfFile?: string;
  hexFile?: string;
  binFile?: string;
  gdbPort?: number;
  tclPort?: number;
  telnetPort?: number;
  noLoad?: boolean;
  noReset?: boolean;
  rebuild?: boolean;
  noRebuild?: boolean;
  westExtraServerArgs?: string[];
  devId?: string;
  serial?: string;
  interface?: string;
  frequency?: string | number;
  port?: string | number;
  connectUnderReset?: boolean;
  erase?: boolean;
  noErase?: boolean;
  reset?: boolean;
  rttAddress?: string;
  tui?: boolean;
  config?: string[];
  flashAddress?: string | number;
  verify?: boolean;
  verifyOnly?: boolean;
  noHalt?: boolean;
  noInit?: boolean;
  noTargets?: boolean;
  targetHandle?: string;
  rttPort?: number;
  rttServer?: boolean;
  gdbHost?: string;
  gdbClientPort?: number;
  gdbInit?: string[];
  chip?: string;
  protocol?: string;
  speed?: string | number;
  batch?: boolean;
  device?: string;
  loader?: string;
  dtFlash?: boolean;
  resetType?: string;
}

type ProviderMode = "cortex" | "west";

/**
 * Build a cortex-debug `vscode.DebugConfiguration` from a parsed runners.yaml.
 * Returns undefined when the runner cannot be mapped to a cortex-debug
 * servertype; in that case the caller should leave the config alone (or
 * notify the user).
 *
 * @param options.userArgs  Extra runner arguments supplied by the user's
 *   `RunnerConfig` bind. These are appended after the runners.yaml args so
 *   that user-supplied values take precedence when a flag can appear multiple
 *   times (last wins).
 */
export function buildCortexDebugConfig(
  runnersYaml: RunnersYaml,
  runner: string,
  options: {
    name?: string;
    request?: "launch" | "attach";
    cwd?: string;
    svdFile?: string;
    /** Extra args from the user's RunnerConfig, merged after runners.yaml args. */
    userArgs?: string[];
    /** Workspace venv setup path, used to resolve tool executables (e.g. pyocd). */
    setupPath?: string;
  } = {}
): vscode.DebugConfiguration | undefined {
  const serverType = runnerToServerType(runner);
  if (!serverType) {
    return undefined;
  }

  const cfg: any = {
    name: options.name || `Zephyr IDE: ${options.request === "attach" ? "Attach" : "Debug"} (${runner})`,
    type: "cortex-debug",
    request: options.request || "launch",
    cwd: options.cwd || "${workspaceFolder}",
    servertype: serverType,
    showDevDebugOutput: "raw",
  };

  // Only openocd and jlink support the rtos field in cortex-debug.
  // stlink, pyocd, bmp, qemu, and external don't support it and will error if it's set.
  // (For the BMP path, `rtos: "zephyr"` is set later by resolveDebugConfiguration
  //  when the mylonics.bmp-debug fork is installed — that fork *does* accept it.)
  if (serverType === "openocd" || serverType === "jlink") {
    cfg.rtos = "Zephyr";
  }

  if (runnersYaml.elfFile) {
    cfg.executable = runnersYaml.elfFile;
  }
  if (runnersYaml.gdb) {
    cfg.gdbPath = runnersYaml.gdb;
  }
  // Issue #20: prefer SVDs whose filename matches the board name so
  // multi-SoC board folders pick the right one.
  const boardHint = runnersYaml.boardDir ? path.basename(runnersYaml.boardDir) : undefined;
  const svdFile = options.svdFile || findSvdFile(runnersYaml.boardDir, boardHint);
  if (svdFile) {
    cfg.svdFile = svdFile;
  }

  // Per-runner argument extraction. runners.yaml stores command-line argv
  // arrays; we lift the bits cortex-debug needs into the equivalent config
  // properties when we recognize them, and fall back to a passthrough.
  // User-supplied args are appended last so they can override runners.yaml values.
  const runnerArgs = [...(runnersYaml.args[runner] || []), ...(options.userArgs ?? [])];

  switch (serverType) {
    case "openocd": {
      const configFilesFromRunners: string[] = [];
      const configFilesFromUser: string[] = [];
      const searchDir: string[] = [];
      let enableRtt = false;
      let rttPort: number | undefined;
      let rttAddress: string | undefined;
      let rttSearchSize: number | undefined;
      // Parse runners.yaml args first, then user args, keeping them separate
      // so the board-level fallback can be applied correctly when userArgs
      // override just the interface (probe) but runners.yaml has no -f flags.
      const runnersYamlArgs = runnersYaml.args[runner] || [];
      const userArgsList = options.userArgs ?? [];
      const parseSingleArgList = (args: string[], dest: string[]) => {
        for (let i = 0; i < args.length; i++) {
          const a = args[i];
          if (a === "-f" || a === "--openocd-config") {
            const next = args[i + 1];
            if (next) { dest.push(next); i++; }
          } else if (a === "-s" || a === "--openocd-search") {
            const next = args[i + 1];
            if (next) { searchDir.push(next); i++; }
          } else if (a.startsWith("-f=")) {
            dest.push(a.slice(3));
          } else if (a.startsWith("--openocd-config=")) {
            dest.push(a.slice("--openocd-config=".length));
          } else if (a.startsWith("--openocd-search=")) {
            searchDir.push(a.slice("--openocd-search=".length));
          } else if (a === "--cmd-pre-init") {
            // Zephyr boards often load cfg files via:
            //   --cmd-pre-init "source [find interface/jlink.cfg]"
            // Extract those cfg paths so they become cortex-debug configFiles.
            const next = args[i + 1];
            if (next) {
              const m = next.match(/^source\s+\[find\s+([^\]\s]+\.cfg)\]$/i);
              if (m) { dest.push(m[1]); }
              i++;
            }
          } else if (a.startsWith("--cmd-pre-init=")) {
            const val = a.slice("--cmd-pre-init=".length);
            const m = val.match(/^source\s+\[find\s+([^\]\s]+\.cfg)\]$/i);
            if (m) { dest.push(m[1]); }
          } else if (a === "--enable-rtt") {
            enableRtt = true;
          } else if (a === "--rtt-port") {
            const next = args[i + 1];
            if (next) { rttPort = parseInt(next, 10); i++; }
          } else if (a.startsWith("--rtt-port=")) {
            rttPort = parseInt(a.slice("--rtt-port=".length), 10);
          } else if (a === "--rtt-address") {
            const next = args[i + 1];
            if (next) { rttAddress = next; i++; }
          } else if (a.startsWith("--rtt-address=")) {
            rttAddress = a.slice("--rtt-address=".length);
          } else if (a === "--rtt-search-size") {
            const next = args[i + 1];
            if (next) { rttSearchSize = parseInt(next, 10); i++; }
          } else if (a.startsWith("--rtt-search-size=")) {
            rttSearchSize = parseInt(a.slice("--rtt-search-size=".length), 10);
          }
        }
      };
      parseSingleArgList(runnersYamlArgs, configFilesFromRunners);
      parseSingleArgList(userArgsList, configFilesFromUser);

      // If the user provided their own interface config (e.g. switching from the
      // board-default interface/jlink.cfg to interface/stlink.cfg), remove any
      // interface/ entries that came from runners.yaml so the probe is not
      // double-loaded. Non-interface entries (target/, board/, …) are kept.
      const userHasInterface = configFilesFromUser.some(f => f.startsWith("interface/"));
      const effectiveFromRunners = userHasInterface
        ? configFilesFromRunners.filter(f => !f.startsWith("interface/"))
        : configFilesFromRunners;

      // Fallback: runners.yaml args carry no -f flags. Zephyr boards typically
      // ship support/openocd.cfg that sources both the interface (probe) and
      // target configs, matching what `west debug` uses at runtime.
      //
      // When the user has NOT provided their own interface override we use the
      // monolithic support/openocd.cfg as-is (original behaviour).
      //
      // When the user HAS provided interface config(s) (e.g. interface/stlink.cfg
      // via a runner profile extraArg), we must NOT load the monolithic file again
      // (it would source the same interface twice). Instead we parse it for any
      // `source [find target/xxx.cfg]` lines and add those target configs so the
      // user only needs to specify the probe interface, not the chip target.
      if (effectiveFromRunners.length === 0 && runnersYaml.boardDir) {
        const candidates = [
          path.join(runnersYaml.boardDir, "support", "openocd.cfg"),
          path.join(runnersYaml.boardDir, "openocd.cfg"),
        ];
        for (const candidate of candidates) {
          if (!fs.existsSync(candidate)) { continue; }
          if (configFilesFromUser.length === 0) {
            // No user override: use the monolithic board config directly.
            configFilesFromRunners.push(candidate);
          } else {
            // User supplied an interface config (e.g. interface/stlink.cfg).
            // Parse the board config for any `source [find xxx.cfg]` lines that
            // are NOT interface/ files — these are the target/chip configs the
            // user should not have to specify manually.
            // Matches patterns like:
            //   source [find target/nrf52.cfg]
            //   source [find board/nordic_nrf52_dk.cfg]
            try {
              const content = fs.readFileSync(candidate, "utf-8");
              const extracted: string[] = [];
              for (const m of content.matchAll(/source\s+\[find\s+((?!interface\/)[^\]\s]+\.cfg)\]/gi)) {
                if (!effectiveFromRunners.includes(m[1])) {
                  extracted.push(m[1]);
                }
              }
              if (extracted.length > 0) {
                // Found target/board cfg references — use them.
                effectiveFromRunners.push(...extracted);
              } else {
                // Parsing yielded nothing (empty cfg, unusual format, etc.) —
                // fall back to the monolithic board config. The user's interface
                // file will follow and OpenOCD will re-use the already-selected
                // transport, so this is safe for most setups.
                effectiveFromRunners.push(candidate);
              }
            } catch {
              // Unreadable — fall back to monolithic.
              effectiveFromRunners.push(candidate);
            }
          }
          break;
        }
      }

      // Final merged configFiles: OpenOCD requires interface/ files before
      // target/ files or the transport won't be selected. Sort accordingly,
      // preserving relative order within each group.
      const allConfigFiles = [...effectiveFromRunners, ...configFilesFromUser];
      const configFiles = [
        ...allConfigFiles.filter(f => f.startsWith("interface/")),
        ...allConfigFiles.filter(f => !f.startsWith("interface/")),
      ];
      if (configFiles.length) { cfg.configFiles = configFiles; }
      // Merge args-derived and runners.yaml-derived search directories,
      // deduping while preserving first-seen order.
      const mergedSearch = [
        ...searchDir,
        ...(runnersYaml.openocdSearch ?? []),
      ];
      if (mergedSearch.length) {
        const seen = new Set<string>();
        cfg.searchDir = mergedSearch.filter(s => {
          if (seen.has(s)) { return false; }
          seen.add(s);
          return true;
        });
      }
      if (runnersYaml.openocd) { cfg.serverpath = runnersYaml.openocd; }
      if (enableRtt) {
        // cortex-debug uses the rttConfig object for openocd RTT (unlike bmp-debug
        // which uses the flat `rttEnabled` boolean).
        // rtt_start_retry: 1000 gives OpenOCD up to 1 s to find the RTT block.
        cfg.rttConfig = {
          enabled: true,
          address: rttAddress ?? "auto",
          rtt_start_retry: 1000,
          ...(rttSearchSize !== undefined ? { searchSize: rttSearchSize } : {}),
          decoders: [{ port: rttPort ?? 0, type: "console", label: "RTT Channel 0" }],
        };
      }
      break;
    }
    case "jlink": {
      // Look for --device / --speed / --interface in the args array.
      // Speed is appended additively to any existing serverArgs so a
      // user-supplied serverArgs is preserved (issue #11).
      const extraServerArgs: string[] = [];
      for (let i = 0; i < runnerArgs.length; i++) {
        const a = runnerArgs[i];
        const eq = (key: string): string | undefined => {
          if (a === key) { return runnerArgs[i + 1]; }
          if (a.startsWith(`${key}=`)) { return a.slice(key.length + 1); }
          return undefined;
        };
        const dev = eq("--device") ?? eq("-device");
        if (dev !== undefined && !cfg.device) { cfg.device = dev; if (a === "--device" || a === "-device") { i++; } continue; }
        const speed = eq("--speed");
        if (speed !== undefined) { extraServerArgs.push("-speed", speed); if (a === "--speed") { i++; } continue; }
        const iface = eq("--iface") ?? eq("--interface");
        if (iface !== undefined && !cfg.interface) { cfg.interface = iface; if (a === "--iface" || a === "--interface") { i++; } continue; }
      }
      if (extraServerArgs.length) {
        cfg.serverArgs = Array.isArray(cfg.serverArgs)
          ? [...cfg.serverArgs, ...extraServerArgs]
          : extraServerArgs;
      }
      break;
    }
    case "pyocd": {
      // Args consumed here (mapped to cortex-debug fields or dropped as
      // west-runner-specific) — everything else is forwarded to serverArgs.
      const WEST_PYOCD_META = new Set([
        "--dt-flash", "--skip-rebuild", "--runner", "--build-dir",
      ]);
      const extraServerArgs: string[] = [];
      let enableRtt = false;
      let rttPort: number | undefined;
      let rttAddress: string | undefined;
      let rttSearchSize: number | undefined;
      for (let i = 0; i < runnerArgs.length; i++) {
        const a = runnerArgs[i];
        const eq = (key: string): string | undefined => {
          if (a === key) { return runnerArgs[i + 1]; }
          if (a.startsWith(`${key}=`)) { return a.slice(key.length + 1); }
          return undefined;
        };
        const target = eq("--target") ?? eq("-t");
        if (target !== undefined) {
          cfg.targetId = target;
          if (a === "--target" || a === "-t") { i++; }
          continue;
        }
        // Zephyr IDE RTT flags — translate to rttConfig, not serverArgs.
        if (a === "--enable-rtt") { enableRtt = true; continue; }
        const rttPortVal = eq("--rtt-port");
        if (rttPortVal !== undefined) {
          rttPort = parseInt(rttPortVal, 10);
          if (a === "--rtt-port") { i++; }
          continue;
        }
        const rttAddrVal = eq("--rtt-address");
        if (rttAddrVal !== undefined) {
          rttAddress = rttAddrVal;
          if (a === "--rtt-address") { i++; }
          continue;
        }
        const rttSearchVal = eq("--rtt-search-size");
        if (rttSearchVal !== undefined) {
          rttSearchSize = parseInt(rttSearchVal, 10);
          if (a === "--rtt-search-size") { i++; }
          continue;
        }
        // Normalize --probe <type> → --probe <type>: so pyocd selects by probe
        // type rather than treating the value as a UID filter. pyocd's probe URL
        // syntax requires a trailing colon to indicate a type selector
        // (e.g. "stlink:" vs "stlink"). Only append the colon when the value
        // looks like a type name (all-lowercase letters / digits / underscores);
        // raw UIDs are uppercase hex and are left untouched.
        const probeVal = eq("--probe");
        if (probeVal !== undefined) {
          const normalized = /^[a-z][a-z0-9_]*$/.test(probeVal) ? `${probeVal}:` : probeVal;
          extraServerArgs.push(`--probe=${normalized}`);
          if (a === "--probe") { i++; }
          continue;
        }
        // Drop west-only flags (with optional =value or separate value token).
        if (WEST_PYOCD_META.has(a.split("=")[0])) {
          if (a.indexOf("=") === -1 && i + 1 < runnerArgs.length && !runnerArgs[i + 1].startsWith("-")) { i++; }
          continue;
        }
        // Forward everything else to pyocd gdbserver as-is.
        extraServerArgs.push(a);
      }
      if (extraServerArgs.length) {
        cfg.serverArgs = Array.isArray(cfg.serverArgs)
          ? [...cfg.serverArgs, ...extraServerArgs]
          : extraServerArgs;
      }
      if (enableRtt) {
        cfg.rttConfig = {
          enabled: true,
          address: rttAddress ?? "auto",
          rtt_start_retry: 1000,
          ...(rttSearchSize !== undefined ? { searchSize: rttSearchSize } : {}),
          decoders: [{ port: rttPort ?? 0, type: "console", label: "RTT Channel 0" }],
        };
      }
      // Resolve pyocd executable from the workspace venv so cortex-debug can
      // find it without requiring it on the system PATH.
      if (options.setupPath) {
        const venvPath = getVenvPath(options.setupPath);
        const isWin = process.platform === "win32";
        const pyocdExe = path.join(venvPath, isWin ? "Scripts" : "bin", isWin ? "pyocd.exe" : "pyocd");
        if (fs.existsSync(pyocdExe)) {
          cfg.serverpath = pyocdExe;
        }
      }
      break;
    }
    case "stlink": {
      // Zephyr's stlink runner args rarely carry a --device flag, but a
      // sibling jlink runner often does (e.g. --device=STM32F103C8).
      // Fall back to that so cortex-debug can pass the target to ST-LINK GDB server.
      const allArgs = [
        ...runnerArgs,
        ...(runnersYaml.args["jlink"] ?? []),
      ];
      for (let i = 0; i < allArgs.length; i++) {
        const a = allArgs[i];
        const dev =
          a === "--device" ? allArgs[i + 1] :
            a.startsWith("--device=") ? a.slice("--device=".length) :
              undefined;
        if (dev !== undefined && !cfg.device) { cfg.device = dev; if (a === "--device") { i++; } continue; }
      }
      break;
    }
    case "bmp": {
      // SWD is the overwhelmingly common interface for Black Magic Probe;
      // default it here so cortex-debug doesn't have to guess.
      cfg.interface = "swd";
      // --enable-rtt / --rtt-port are Zephyr IDE-specific flags that are
      // translated to cortex-debug / bmp-debug rttConfig here.  They have no
      // effect on west flash (the debug slot arg editor only shows them for
      // debug / attach / buildDebug slots).
      let enableRtt = false;
      let rttPort: number | undefined;
      for (let i = 0; i < runnerArgs.length; i++) {
        const a = runnerArgs[i];
        if (a === "--gdb-serial") {
          const next = runnerArgs[i + 1];
          if (next) { cfg.BMPGDBSerialPort = next; i++; }
        } else if (a.startsWith("--gdb-serial=")) {
          cfg.BMPGDBSerialPort = a.slice("--gdb-serial=".length);
        } else if (a === "--iface" || a === "--interface") {
          const next = runnerArgs[i + 1];
          if (next) { cfg.interface = next; i++; }
        } else if (a.startsWith("--iface=")) {
          cfg.interface = a.slice("--iface=".length);
        } else if (a.startsWith("--interface=")) {
          cfg.interface = a.slice("--interface=".length);
        } else if (a === "--enable-rtt") {
          enableRtt = true;
        } else if (a === "--rtt-port") {
          const next = runnerArgs[i + 1];
          if (next) { rttPort = parseInt(next, 10); i++; }
        } else if (a.startsWith("--rtt-port=")) {
          rttPort = parseInt(a.slice("--rtt-port=".length), 10);
        }
      }
      if (enableRtt) {
        // bmp-debug uses a flat `rttEnabled` boolean, not the rttConfig object
        // used by cortex-debug for openocd/jlink.
        cfg.rttEnabled = true;
      }
      break;
    }
    case "qemu": {
      // QEMU's built-in GDB stub speaks the remote protocol. cortex-debug's
      // "qemu" servertype expects `cpu` and `machine` to be supplied; these
      // are board-specific and cannot be inferred from runners.yaml, so we
      // leave them empty and let the user fill them via launch.json. Any
      // runner args are forwarded to QEMU verbatim via serverArgs.
      if (runnerArgs.length) {
        cfg.serverArgs = Array.isArray(cfg.serverArgs)
          ? [...cfg.serverArgs, ...runnerArgs]
          : [...runnerArgs];
      }
      break;
    }
    case "external": {
      // The actual `gdbTarget` is filled in by the provider after spawning
      // `west debugserver` (see `runnerNeedsBridge` / `startWestDebugServer`).
      // Forward any runner args to the bridge command line via a hidden field
      // that resolveDebugConfiguration consumes — these are bridge args, NOT
      // cortex-debug serverArgs.
      if (runnerArgs.length) {
        (cfg as any).__zephyrIdeBridgeArgs = runnerArgs;
      }
      break;
    }
    default:
      break;
  }

  return cfg;
}

/**
 * Choose which Zephyr runner to use for a debug session, in priority order:
 *   1. The runner explicitly requested by the user (via launch.json or runner profile).
 *      If cortex-debug can drive it, it is used directly — no runners.yaml check.
 *   2. runners.yaml's `debug-runner` (if it is cortex-debug-capable).
 *   3. The first cortex-debug-capable runner in runners.yaml's `runners` list.
 *
 * Runners that cortex-debug cannot drive (e.g. dfu-util, nrfjprog, qemu) are
 * skipped so the user sees a clear "cannot auto-translate" message rather than
 * a silently broken session.
 */
/** True when `runner` can serve as a fallback target when the explicitly
 * requested runner is not available in runners.yaml. QEMU is excluded because
 * debugging via QEMU requires fundamentally different configuration from
 * hardware JTAG/SWD runners and must always be opted into explicitly. */
function isFallbackEligibleRunner(runner: string): boolean {
  return runnerToServerType(runner) !== undefined && runner !== "qemu";
}

export function pickDebugRunner(
  runnersYaml: RunnersYaml,
  requested?: string
): string | undefined {
  if (requested) {
    // Resolve canonical name → actual variant present in runners.yaml.
    // e.g. "stlink" → "stlink_gdbserver" when only the latter is available.
    const resolved = resolveCanonicalRunner(requested, runnersYaml.runners);

    // Happy path: resolved runner is listed in runners.yaml and cortex-debug can drive it.
    if (runnersYaml.runners.includes(resolved) && runnerToServerType(resolved) !== undefined) {
      return resolved;
    }

    // If the requested runner is cortex-debug-capable, honour the explicit user
    // choice even when it is not listed in runners.yaml. The build may have been
    // compiled with a different default runner but the hardware probe the user
    // has attached (e.g. ST-LINK when the board defaults to JLink) still works
    // at the debug level without a rebuild. Show a warning so the user is
    // aware, but do not swap it out for a different runner behind their back.
    if (runnerToServerType(resolved) !== undefined) {
      outputWarning(
        "Debug",
        `Runner "${requested}" is not listed in runners.yaml for this build ` +
        `(available: ${runnersYaml.runners.join(", ")}). ` +
        `The debug session may fail. Rebuild with the correct runner or update the Runner Profile.`
      );
      return resolved;
    }

    // requested is NOT cortex-debug-capable (e.g. nrfjprog, dfu-util).
    // Fall back to a cortex-debug-capable runner from runners.yaml so the
    // user still gets a debug session rather than a silent failure.
    const fallback =
      (runnersYaml.debugRunner && isFallbackEligibleRunner(runnersYaml.debugRunner)
        ? runnersYaml.debugRunner
        : runnersYaml.runners.find(r => isFallbackEligibleRunner(r)));

    if (fallback) {
      outputInfo("Debug", `Requested runner "${requested}" cannot be driven by cortex-debug. Falling back to runners.yaml defaults.`);
      return fallback;
    }

    return undefined;
  }
  if (runnersYaml.debugRunner && runnerToServerType(runnersYaml.debugRunner)) {
    return runnersYaml.debugRunner;
  }
  // Fall back to the first runner that cortex-debug can actually drive.
  return runnersYaml.runners.find(r => runnerToServerType(r) !== undefined);
}

/**
 * VS Code marketplace + open-vsx URLs for the cortex-debug extension we
 * synthesize configurations for.
 */
const CORTEX_DEBUG_EXTENSION_ID = "marus25.cortex-debug";
const CORTEX_DEBUG_MARKETPLACE_URL =
  "https://marketplace.visualstudio.com/items?itemName=marus25.cortex-debug";
const CORTEX_DEBUG_OPEN_VSX_URL =
  "https://open-vsx.org/extension/marus25/cortex-debug";

/**
 * BMP-Debug is a Zephyr-aware fork of cortex-debug published by mylonics
 * that adds Zephyr RTOS thread awareness when debugging via Black Magic Probe.
 * We recommend it once on the first BMP debug session.
 */
const BMP_DEBUG_EXTENSION_ID = "mylonics.bmp-debug";
const BMP_DEBUG_MARKETPLACE_URL =
  "https://marketplace.visualstudio.com/items?itemName=mylonics.bmp-debug";
const BMP_DEBUG_OPEN_VSX_URL =
  "https://open-vsx.org/extension/mylonics/bmp-debug";

/** globalState key recording that we already recommended bmp-debug. */
const BMP_DEBUG_RECOMMENDED_KEY = "zephyr-ide.bmpDebugRecommended";

/**
 * VS Code DebugConfigurationProvider implementation. Hands back a translated
 * cortex-debug configuration when the user launches a `zephyr-ide` config.
 */
export class ZephyrIdeDebugConfigurationProvider
  implements vscode.DebugConfigurationProvider {

  constructor(
    private readonly getWorkspaceConfig: () => WorkspaceConfig,
    private readonly context?: vscode.ExtensionContext,
    private readonly mode: ProviderMode = "cortex",
  ) { }

  /**
   * Provide an initial launch configuration when the user has no launch.json
   * yet. Kept intentionally minimal — the heavy lifting happens in
   * resolveDebugConfiguration.
   */
  provideDebugConfigurations(): vscode.ProviderResult<vscode.DebugConfiguration[]> {
    const debuggerType = this.mode === "west"
      ? ZEPHYR_IDE_WEST_DEBUG_TYPE
      : ZEPHYR_IDE_CORTEX_DEBUG_TYPE;
    const name = this.mode === "west"
      ? "Zephyr IDE: Debug (west debugserver)"
      : "Zephyr IDE: Debug";
    return [
      {
        name,
        type: debuggerType,
        request: "launch",
      },
    ];
  }

  /**
   * Translate the `zephyr-ide` config into a cortex-debug config by parsing
   * runners.yaml. Implemented in resolveDebugConfiguration (before variable
   * substitution) so that VS Code re-runs the full cortex-debug resolver chain
   * on the returned config — cortex-debug's own resolveDebugConfiguration sets
   * extensionPath, gdbServerConsolePort, pvtAvoidPorts and validates the config,
   * and its resolveDebugConfigurationWithSubstitutedVariables normalises paths.
   * This means we don't need to fake any cortex-debug internal fields ourselves.
   */
  async resolveDebugConfiguration(
    folder: vscode.WorkspaceFolder | undefined,
    debugConfig: vscode.DebugConfiguration,
  ): Promise<vscode.DebugConfiguration | undefined> {
    if (this.mode === "west") {
      return this.resolveWestDebugConfiguration(folder, debugConfig);
    }

    const wsConfig = this.getWorkspaceConfig();
    if (!wsConfig) {
      notifyError("Debug", "Zephyr IDE workspace is not initialized.");
      return undefined;
    }

    // The zephyr-ide debugger type synthesizes a cortex-debug config, so
    // cortex-debug (or a compatible fork such as mylonics.bmp-debug, which
    // registers the same debugger type and is Zephyr-RTOS aware) must be
    // installed for the session to actually start. Surface an actionable
    // error with marketplace + open-vsx install links before we do any
    // further work.
    if (
      !vscode.extensions.getExtension(CORTEX_DEBUG_EXTENSION_ID) &&
      !vscode.extensions.getExtension(BMP_DEBUG_EXTENSION_ID)
    ) {
      void vscode.window.showErrorMessage(
        "Zephyr IDE debug sessions require the cortex-debug extension. " +
        "Install it from your editor's marketplace and try again.",
        "Open VS Code Marketplace",
        "Open Open VSX",
      ).then(choice => {
        if (choice === "Open VS Code Marketplace") {
          void vscode.env.openExternal(vscode.Uri.parse(CORTEX_DEBUG_MARKETPLACE_URL));
        } else if (choice === "Open Open VSX") {
          void vscode.env.openExternal(vscode.Uri.parse(CORTEX_DEBUG_OPEN_VSX_URL));
        }
      });
      return undefined;
    }

    const cfg = debugConfig as ZephyrIdeDebugConfig;

    // -------------------------------------------------------------------------
    // Project / build selection
    // -------------------------------------------------------------------------
    // Priority:
    //   1. Explicit `project` / `build` fields in launch.json — used as-is.
    //   2. `ask` mode — prompt the user interactively (askBoth / askProject /
    //      askBuild).
    //   3. "auto" (default) — silently use the active project and active build.
    // -------------------------------------------------------------------------
    let resolved: Awaited<ReturnType<typeof resolveActiveProjectBuild>>;

    if (cfg.project !== undefined || cfg.build !== undefined) {
      // Explicit override: at least one of project/build is pinned.
      const r = resolveActiveProjectBuild(wsConfig, {
        projectName: cfg.project,
        buildName: cfg.build,
      });
      if (!r) {
        notifyError("Debug",
          `Cannot resolve project "${cfg.project ?? "(active)"}" / build "${cfg.build ?? "(active)"}"` +
          `. Check that both exist in the workspace.`);
        return undefined;
      }
      resolved = r;
    } else {
      const askMode: AskMode = cfg.ask ?? "auto";
      let projectName: string | undefined;
      let buildName: string | undefined;

      if (askMode === "askBoth" || askMode === "askProject") {
        projectName = await askUserForProject(wsConfig);
        if (projectName === undefined) { return undefined; } // user cancelled
      } else {
        // "auto" or "askBuild" — use the active project.
        projectName = wsConfig.activeProject;
      }

      if (askMode === "askBoth" || askMode === "askBuild") {
        if (projectName === undefined) {
          notifyError("Debug", "No active project configured. Set one before launching the Zephyr IDE debugger.");
          return undefined;
        }
        buildName = await askUserForBuild(wsConfig, projectName);
        if (buildName === undefined) { return undefined; } // user cancelled
      }

      const r = resolveActiveProjectBuild(wsConfig, { projectName, buildName });
      if (!r) {
        notifyError("Debug", "No active project/build configured. Set one before launching the Zephyr IDE debugger.");
        return undefined;
      }
      resolved = r;
    }

    // B7: Use the active sysbuild image (if any) when resolving runners.yaml.
    const sysbuildImage = wsConfig.projectStates?.[resolved.projectName]?.buildStates?.[resolved.buildName]?.sysbuildImage;
    const buildDir = path.join(wsConfig.rootPath, resolved.project.rel_path, resolved.buildName);
    const runnersYamlPath = resolveRunnersYamlPath(buildDir, sysbuildImage);
    const runnersYaml = parseRunnersYaml(runnersYamlPath);
    if (!runnersYaml) {
      // Issue #19: offer an actionable "Build Now" button instead of just a
      // dead-end notification.
      void vscode.window.showErrorMessage(
        `runners.yaml not found at "${runnersYamlPath}". Build the project first so the Zephyr build system can generate it.`,
        "Build Now"
      ).then(choice => {
        if (choice === "Build Now") {
          void vscode.commands.executeCommand("zephyr-ide.build");
        }
      });
      return undefined;
    }

    // useWestDebugServer mode: skip the runner-translation pipeline entirely.
    // Spawn `west debugserver --runner <runner> [westArgs]` and connect
    // cortex-debug as servertype "external". ELF and GDB path are read from
    // runners.yaml so the user only needs to specify the runner and any
    // runner-specific flags via westArgs.
    if (cfg.useWestDebugServer === true) {
      if (!cfg.runner) {
        notifyError("Debug",
          `"useWestDebugServer" is only supported by the ${ZEPHYR_IDE_WEST_DEBUG_TYPE} debugger type. ` +
          `Change your launch config type and retry.`);
        return undefined;
      }
      notifyError("Debug",
        `"useWestDebugServer" is only supported by the ${ZEPHYR_IDE_WEST_DEBUG_TYPE} debugger type. ` +
        `Change your launch config type and retry.`);
      return undefined;
    }

    // Resolve the active runner profile's debug/attach bind first so its
    // runner name can be passed to pickDebugRunner.  launch.json's explicit
    // `runner` field always takes precedence over the profile bind's runner.
    // This lets Flash and Debug slots carry different runners AND different
    // args (e.g. flash: jlink, debug: openocd --enable-rtt).
    let userArgs: string[] | undefined;
    let profileRunner: string | undefined;
    let forceWestDebugBridge = false;

    // Pick the bind for this session kind: launch sessions use the unified
    // debug bind; attach sessions use the dedicated attach bind.
    const slot: "debug" | "attach" = cfg.request === "attach" ? "attach" : "debug";

    // Per-developer local bind has the highest priority, above any profile.
    const buildState = wsConfig.projectStates?.[resolved.projectName]?.buildStates?.[resolved.buildName];
    const localSlotRunner = buildState?.localBinds?.[slot];
    if (localSlotRunner !== null && localSlotRunner !== undefined) {
      // Local bind: launch-config binds are intercepted upstream in startDebugSession before
      // reaching here, so only runner-prefixed binds arrive at this point.
      const [runnerStr, queryStr] = localSlotRunner.split('?');
      let localProbe: string | undefined;
      if (queryStr) {
        const parts = queryStr.split('&');
        for (const p of parts) {
          const [k, v] = p.split('=');
          if (k === "probe") {
            localProbe = decodeURIComponent(v);
          }
        }
      }

      if (runnerStr.startsWith(CORTEX_DEBUG_PREFIX)) {
        // Cortex-debug (auto-config): use native cortex-debug server; runnerNeedsBridge() at
        // line 1107 still handles naturally-bridged runners (nrfjprog, linkserver, …) automatically.
        profileRunner = runnerStr.slice(CORTEX_DEBUG_PREFIX.length);
        // forceWestDebugBridge stays false
      } else if (runnerStr.startsWith(WEST_DEBUG_PREFIX)) {
        // West debugserver bridge: force bridge regardless of runner type.
        profileRunner = runnerStr.slice(WEST_DEBUG_PREFIX.length);
        forceWestDebugBridge = true;
      } else {
        // Legacy "runner:X" or bare runner name (old local bind storage) → treat as forced bridge.
        profileRunner = runnerStr.startsWith(RUNNER_TARGET_PREFIX)
          ? runnerStr.slice(RUNNER_TARGET_PREFIX.length)
          : runnerStr;
        forceWestDebugBridge = true;
      }

      if (localProbe && profileRunner === "openocd") {
        userArgs = ["--openocd-config", localProbe];
      }
    } else {
      const profileName = getEffectiveActiveProfileName(wsConfig, resolved).name;
      const profile = profileName ? findRunnerProfile(profileName, loadRunnerProfiles(wsConfig)) : undefined;
      if (profile) {
        // Build-and-Debug sessions with an explicit `buildDebug` slot derive
        // their bind/override from that slot (with its own auto-fallback to
        // `debug`) instead of the plain `debug` slot used for regular Debug.
        const { bind, override } = cfg.zephyrIdeBuildDebug === true
          ? getEffectiveBuildDebugBind(profile, resolved.build)
          : { bind: profile[slot], override: resolved.build.bindOverrides?.[slot] };
        if (bind.kind === "launch") {
          outputInfo("Debug", `Profile "${profileName}" has ${slot} bind set to launch.json config "${bind.name}". Starting it directly.`);
        } else if (bind.kind === "cortex-debug") {
          profileRunner = bind.runner;
          // Convert structured fields (enableRtt, probe) to the userArgs token
          // list that buildCortexDebugConfig parses internally.
          const injected: string[] = [];
          if (bind.enableRtt) { injected.push("--enable-rtt"); }
          if (bind.probe) {
            const stype = runnerToServerType(bind.runner);
            if (stype === "openocd") {
              injected.push("--openocd-config", bind.probe);
            } else if (stype === "pyocd") {
              injected.push(`--probe=${bind.probe}`);
            }
          }
          userArgs = injected.length > 0 ? injected : undefined;
        } else if (bind.kind === "west-debug") {
          profileRunner = bind.runner;
          forceWestDebugBridge = true;
          // Resolve extraArgs per-token so variables expanding to paths with
          // spaces remain as single tokens.
          const varCtx = {
            workspaceFolder: wsConfig.rootPath,
            buildFolder: buildDir,
            board: resolved.build.board,
            boardRevision: resolved.build.revision ?? "",
            project: resolved.projectName,
            build: resolved.buildName,
            buildVars: resolved.build.customVars,
            projectVars: resolved.project.customVars,
          };
          const allTokens = [
            ...(bind.extraArgs ?? []),
            ...(override?.extraArgs ?? []),
          ];
          if (allTokens.length > 0) {
            userArgs = allTokens
              .map(token => resolveRunnerArgs(token, varCtx))
              .filter(t => t.trim().length > 0);
          }
        }
      }
    }

    // launch.json `runner` wins over a `servertype`-derived runner, which wins
    // over the profile bind's runner, which wins over runners.yaml auto-detection.
    // `servertype` lets a config name the cortex-debug server directly; we map it
    // back to the canonical runner so the right arg-extraction branch runs and the
    // matching runners.yaml args are read.
    const requestedRunner = cfg.runner ?? serverTypeToRunner((cfg as any).servertype) ?? profileRunner;
    const runner = pickDebugRunner(runnersYaml, requestedRunner);
    if (!runner) {
      // Issue #15: name the runners that were found but rejected so the user
      // understands why no debug session can be auto-translated.
      const all = runnersYaml.runners;
      const rejected = all.filter(r => runnerToServerType(r) === undefined);
      const reason = rejected.length
        ? `Found runner(s) [${rejected.join(", ")}] but cortex-debug cannot drive them.`
        : `runners.yaml lists no runners.`;
      void vscode.window.showErrorMessage(
        `${reason} File: "${runnersYamlPath}" — Available runners: ${all.join(", ") || "(none)"}.`,
        "Select Runner Profile"
      ).then(choice => {
        if (choice === "Select Runner Profile") {
          void vscode.commands.executeCommand("zephyr-ide.set-active-profile");
        }
      });
      return undefined;
    }

    // Fast-fail when runners.yaml is missing the fields cortex-debug needs.
    // cortex-debug would otherwise fail mid-launch with an opaque error.
    const missing: string[] = [];
    if (!runnersYaml.elfFile) { missing.push("elf_file"); }
    if (!runnersYaml.gdb) { missing.push("gdb"); }
    if (missing.length) {
      void vscode.window.showErrorMessage(
        `runners.yaml is missing required field(s) [${missing.join(", ")}] at "${runnersYamlPath}".` +
        ` This usually means the build did not complete successfully. Try a pristine rebuild.`,
        "Pristine Build"
      ).then(choice => {
        if (choice === "Pristine Build") {
          void vscode.commands.executeCommand("zephyr-ide.build-pristine");
        }
      });
      return undefined;
    }

    const cortexCfg = buildCortexDebugConfig(runnersYaml, runner, {
      name: cfg.name,
      request: cfg.request === "attach" ? "attach" : "launch",
      cwd: typeof (cfg as any).cwd === "string" ? (cfg as any).cwd : (folder ? folder.uri.fsPath : undefined),
      svdFile: typeof (cfg as any).svdFile === "string" ? (cfg as any).svdFile : undefined,
      // Pass userArgs from the extraArgs path.
      userArgs: userArgs,
      setupPath: wsConfig.activeSetupState?.setupPath,
    });

    if (!cortexCfg) {
      notifyError(
        "Debug",
        `Runner "${runner}" cannot be auto-translated to a cortex-debug configuration. Set "runner" in launch.json or use a cortex-debug config directly.`
      );
      return undefined;
    }

    // When bmp-debug (mylonics.bmp-debug) is installed and the runner is BMP,
    // route the session to bmp-debug instead of cortex-debug so that Zephyr
    // RTOS thread awareness is enabled automatically.
    // bmp-debug supports the rtos field (unlike marus25.cortex-debug for BMP,
    // which errors if rtos is set), so enable it here for thread awareness.
    if (cortexCfg.servertype === "bmp" && vscode.extensions.getExtension(BMP_DEBUG_EXTENSION_ID)) {
      cortexCfg.type = "bmp-debug";
      cortexCfg.rtos = "zephyr";
      // bmp-debug sources zephyr_gdb.py for RTOS thread awareness and therefore
      // requires the Python-enabled GDB variant (arm-zephyr-eabi-gdb-py).
      // runners.yaml typically records the plain arm-zephyr-eabi-gdb; upgrade
      // it here if the -py sibling exists on disk.
      if (cortexCfg.gdbPath && typeof cortexCfg.gdbPath === "string") {
        const pyGdbPath = cortexCfg.gdbPath.replace(/gdb(?!-py)(\.exe)?$/i, "gdb-py$1");
        if (pyGdbPath !== cortexCfg.gdbPath && fs.existsSync(pyGdbPath)) {
          cortexCfg.gdbPath = pyGdbPath;
          // bmp-debug derives objdump/nm paths from gdbPath by substituting
          // "gdb" → "objdump" / "nm". Upgrading to gdb-py would cause it to
          // look for non-existent *-py binaries, so pin the plain variants.
          cortexCfg.objdumpPath = pyGdbPath.replace(/gdb-py(\.exe)?$/i, "objdump$1");
          cortexCfg.nmPath = pyGdbPath.replace(/gdb-py(\.exe)?$/i, "nm$1");
        }
      }
      // Populate pythonPath from the workspace venv so bmp-debug can configure
      // gdb-py's embedded Python runtime (sets PYTHONHOME and, on Windows, adds
      // the correct pythonXY.dll directory to the DLL search path before GDB
      // starts). Override with "pythonPath" in launch.json if a different Python
      // interpreter is needed (e.g. when the SDK gdb-py was compiled against a
      // Python version that differs from the workspace venv).
      const setupPath = wsConfig.activeSetupState?.setupPath;
      if (setupPath) {
        const venvPath = getVenvPath(setupPath);
        const isWin = process.platform === "win32";
        const pyExe = path.join(venvPath, isWin ? "Scripts/python.exe" : "bin/python");
        if (fs.existsSync(pyExe)) {
          cortexCfg.pythonPath = pyExe;
        }
      }
    }

    // Allow user to override individual cortex-debug fields by including them
    // in their original config. User-provided keys (other than the few we
    // interpret ourselves) win over the auto-generated ones.
    //
    // `rtos` is reserved because:
    //   - For openocd/jlink we hard-set `"Zephyr"` (the only value cortex-debug
    //     accepts for Zephyr); allowing override would let users typo it.
    //   - For pyocd/stlink/bmp/qemu/external it is unsupported and would cause
    //     cortex-debug to error out at session start.
    //   - For the bmp-debug fork, we set `"zephyr"` ourselves on the BMP path.
    const reservedKeys = new Set([
      "type", "request", "name", "runner", "rtos",
      // Project/build selection fields — consumed above, not forwarded to cortex-debug.
      "project", "build", "ask",
      // Internal bridge hand-off; never exposed in launch.json.
      "__zephyrIdeBridgeArgs",
    ]);
    for (const [k, v] of Object.entries(cfg)) {
      if (reservedKeys.has(k)) { continue; }
      if (v !== undefined) {
        (cortexCfg as any)[k] = v;
      }
    }

    // cortex-debug (marus25) requires BMPGDBSerialPort to connect to the GDB
    // server; bmp-debug (mylonics) auto-discovers the probe so the field is
    // optional there. Only surface the hard error when cortex-debug is the
    // active extension — i.e. bmp-debug is not installed.
    if (
      cortexCfg.servertype === "bmp" &&
      !(cortexCfg as any).BMPGDBSerialPort &&
      !vscode.extensions.getExtension(BMP_DEBUG_EXTENSION_ID)
    ) {
      const isWindows = process.platform === "win32";
      const examplePort = isWindows ? "COM3" : "/dev/ttyACM0";
      void vscode.window.showErrorMessage(
        `Black Magic Probe (BMP) requires a serial port. ` +
        `Add "BMPGDBSerialPort": "${examplePort}" to your launch.json config, ` +
        `or install BMP-Debug which auto-discovers the probe.`,
        "Install BMP-Debug (VS Code)",
        "Install BMP-Debug (Open VSX)",
        "Open launch.json",
      ).then(choice => {
        if (choice === "Install BMP-Debug (VS Code)") {
          void vscode.env.openExternal(vscode.Uri.parse(BMP_DEBUG_MARKETPLACE_URL));
        } else if (choice === "Install BMP-Debug (Open VSX)") {
          void vscode.env.openExternal(vscode.Uri.parse(BMP_DEBUG_OPEN_VSX_URL));
        } else if (choice === "Open launch.json") {
          void vscode.commands.executeCommand("workbench.action.debug.configure");
        }
      });
      return undefined;
    }

    // First-time BMP debug: recommend bmp-debug (Zephyr-aware cortex-debug
    // fork) for RTOS thread awareness. Only fires once (gated by globalState),
    // only for debug sessions (this provider isn't used for flash), and only
    // when bmp-debug isn't already installed.
    if (
      cortexCfg.servertype === "bmp" &&
      this.context &&
      !this.context.globalState.get<boolean>(BMP_DEBUG_RECOMMENDED_KEY) &&
      !vscode.extensions.getExtension(BMP_DEBUG_EXTENSION_ID)
    ) {
      void this.context.globalState.update(BMP_DEBUG_RECOMMENDED_KEY, true);
      void vscode.window.showInformationMessage(
        "Tip: install BMP-Debug for Zephyr RTOS thread awareness when debugging " +
        "with Black Magic Probe. It is a Zephyr-aware fork of cortex-debug.",
        "Open VS Code Marketplace",
        "Open Open VSX",
      ).then(choice => {
        if (choice === "Open VS Code Marketplace") {
          void vscode.env.openExternal(vscode.Uri.parse(BMP_DEBUG_MARKETPLACE_URL));
        } else if (choice === "Open Open VSX") {
          void vscode.env.openExternal(vscode.Uri.parse(BMP_DEBUG_OPEN_VSX_URL));
        }
      });
    }

    // The cortex provider handles cortex-debug / bmp-debug only.
    // Runners requiring west debugserver are handled by zephyr-ide-west.
    if (forceWestDebugBridge || runnerNeedsBridge(runner)) {
      notifyError(
        "Debug",
        `Runner "${runner}" requires the ${ZEPHYR_IDE_WEST_DEBUG_TYPE} debugger type. ` +
        `Use the west debug provider for this configuration.`
      );
      delete (cortexCfg as any).__zephyrIdeBridgeArgs;
      return undefined;
    }

    outputInfo("Debug", `Launching ${cortexCfg.type} session with runner "${runner}"\n${JSON.stringify(cortexCfg, null, 2)}`);

    // RTT auto-launch: register a one-shot listener so that after the debug
    // session starts, the RTT terminal is opened automatically.
    // Triggered when --enable-rtt is in extraArgs (parsed by buildCortexDebugConfig).
    const rttEnabled = !!(cortexCfg.rttConfig || (cortexCfg as any).rttEnabled);
    if (rttEnabled && this.context) {
      const disposable = vscode.debug.onDidStartDebugSession(session => {
        // Match by name to avoid auto-launching RTT for unrelated sessions.
        if (session.name !== cortexCfg.name) { return; }
        disposable.dispose(); // one-shot
        // cortex-debug exposes an RTT terminal command. bmp-debug uses the same API.
        setTimeout(() => {
          void vscode.commands.executeCommand("cortex-debug.rttTerminal", {
            source: "tcp",
            port: (cortexCfg.rttConfig as any)?.decoders?.[0]?.port ?? 0,
          }).then(undefined, () => {
            // Command not available (e.g. older cortex-debug version) — ignore silently.
          });
        }, 1000); // brief delay to let the GDB server start the RTT session
      });
      this.context.subscriptions.push(disposable);
    }

    return cortexCfg;
  }

  /**
   * Spawn `west debugserver`, write the resulting `host:port` into
   * `targetCfg.gdbTarget`, and register the session-end lifecycle cleanup.
   * Shared by the `useWestDebugServer` launch-config path and the runner
   * bridge path so the server spawn logic lives in exactly one place.
   *
   * @returns `true` on success; `false` when the server failed to start
   *   (the error has already been surfaced to the user via notifyError).
   */
  private async spawnAndAttachDebugServer(
    options: Parameters<typeof startWestDebugServer>[0],
    targetCfg: any,
    sessionName: string,
  ): Promise<boolean> {
    try {
      const handle = await startWestDebugServer(options);
      targetCfg.gdbTarget = `${handle.host}:${handle.port}`;
      if (!handle.portDetected) {
        outputWarning("Debug",
          `west debugserver did not announce its listening port; using default ` +
          `${handle.host}:${handle.port}. ` +
          `If the session fails to connect, set "gdbTarget" explicitly in launch.json.`);
      }
      const sub = disposeOnSessionEnd(handle, sessionName);
      if (this.context) { this.context.subscriptions.push(sub); }
      const orphanTimeout = setTimeout(() => {
        const started = vscode.debug.activeDebugSession?.name === sessionName;
        if (!started) { void handle.dispose(); }
      }, 60_000);
      const startSub = vscode.debug.onDidStartDebugSession(s => {
        if (s.name !== sessionName) { return; }
        clearTimeout(orphanTimeout);
        startSub.dispose();
      });
      if (this.context) { this.context.subscriptions.push(startSub); }
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/unknown command/i.test(msg)) {
        // west debugserver is not available — show a notification with a
        // direct action to switch to the native cortex-debug mode.
        void vscode.window.showErrorMessage(
          `"west debugserver" is not available in this Zephyr installation. ` +
          `Switch the debug bind to "cortex-debug (auto-config)" so the session ` +
          `connects directly to ${options.runner} without the west bridge.`,
          "Change Debug Bind"
        ).then(choice => {
          if (choice === "Change Debug Bind") {
            void vscode.commands.executeCommand("zephyr-ide.set-active-profile");
          }
        });
      } else {
        notifyError("Debug",
          `Failed to start west debugserver for runner "${options.runner}": ${msg}`);
      }
      return false;
    }
  }

  private async resolveWestDebugConfiguration(
    folder: vscode.WorkspaceFolder | undefined,
    debugConfig: vscode.DebugConfiguration,
  ): Promise<vscode.DebugConfiguration | undefined> {
    const wsConfig = this.getWorkspaceConfig();
    if (!wsConfig) {
      notifyError("Debug", "Zephyr IDE workspace is not initialized.");
      return undefined;
    }

    if (
      !vscode.extensions.getExtension(CORTEX_DEBUG_EXTENSION_ID) &&
      !vscode.extensions.getExtension(BMP_DEBUG_EXTENSION_ID)
    ) {
      void vscode.window.showErrorMessage(
        "Zephyr IDE debug sessions require the cortex-debug extension. " +
        "Install it from your editor's marketplace and try again.",
        "Open VS Code Marketplace",
        "Open Open VSX",
      ).then(choice => {
        if (choice === "Open VS Code Marketplace") {
          void vscode.env.openExternal(vscode.Uri.parse(CORTEX_DEBUG_MARKETPLACE_URL));
        } else if (choice === "Open Open VSX") {
          void vscode.env.openExternal(vscode.Uri.parse(CORTEX_DEBUG_OPEN_VSX_URL));
        }
      });
      return undefined;
    }

    const cfg = debugConfig as ZephyrIdeDebugConfig;
    let resolved: Awaited<ReturnType<typeof resolveActiveProjectBuild>>;

    if (cfg.project !== undefined || cfg.build !== undefined) {
      const r = resolveActiveProjectBuild(wsConfig, {
        projectName: cfg.project,
        buildName: cfg.build,
      });
      if (!r) {
        notifyError("Debug",
          `Cannot resolve project "${cfg.project ?? "(active)"}" / build "${cfg.build ?? "(active)"}".` +
          ` Check that both exist in the workspace.`);
        return undefined;
      }
      resolved = r;
    } else {
      const askMode: AskMode = cfg.ask ?? "auto";
      let projectName: string | undefined;
      let buildName: string | undefined;

      if (askMode === "askBoth" || askMode === "askProject") {
        projectName = await askUserForProject(wsConfig);
        if (projectName === undefined) { return undefined; }
      } else {
        projectName = wsConfig.activeProject;
      }

      if (askMode === "askBoth" || askMode === "askBuild") {
        if (projectName === undefined) {
          notifyError("Debug", "No active project configured. Set one before launching the Zephyr IDE debugger.");
          return undefined;
        }
        buildName = await askUserForBuild(wsConfig, projectName);
        if (buildName === undefined) { return undefined; }
      }

      const r = resolveActiveProjectBuild(wsConfig, { projectName, buildName });
      if (!r) {
        notifyError("Debug", "No active project/build configured. Set one before launching the Zephyr IDE debugger.");
        return undefined;
      }
      resolved = r;
    }

    const sysbuildImage = wsConfig.projectStates?.[resolved.projectName]?.buildStates?.[resolved.buildName]?.sysbuildImage;
    const buildDir = path.join(wsConfig.rootPath, resolved.project.rel_path, resolved.buildName);
    const runnersYamlPath = resolveRunnersYamlPath(buildDir, sysbuildImage);
    const runnersYaml = parseRunnersYaml(runnersYamlPath);
    if (!runnersYaml) {
      void vscode.window.showErrorMessage(
        `runners.yaml not found at "${runnersYamlPath}". Build the project first so the Zephyr build system can generate it.`,
        "Build Now"
      ).then(choice => {
        if (choice === "Build Now") {
          void vscode.commands.executeCommand("zephyr-ide.build");
        }
      });
      return undefined;
    }

    const requestedRunner = cfg.runner ?? runnersYaml.debugRunner ?? runnersYaml.runners[0];
    if (!requestedRunner) {
      notifyError("Debug", `No runner is available in "${runnersYamlPath}".`);
      return undefined;
    }

    const missing: string[] = [];
    if (!runnersYaml.elfFile) { missing.push("elf_file"); }
    if (!runnersYaml.gdb) { missing.push("gdb"); }
    if (missing.length) {
      void vscode.window.showErrorMessage(
        `runners.yaml is missing required field(s) [${missing.join(", ")}] at "${runnersYamlPath}".` +
        ` This usually means the build did not complete successfully. Try a pristine rebuild.`,
        "Pristine Build"
      ).then(choice => {
        if (choice === "Pristine Build") {
          void vscode.commands.executeCommand("zephyr-ide.build-pristine");
        }
      });
      return undefined;
    }

    const setupState = wsConfig.activeSetupState;
    if (!setupState) {
      notifyError("Debug",
        `${ZEPHYR_IDE_WEST_DEBUG_TYPE} requires an active Zephyr IDE setup. ` +
        `Complete workspace setup (Zephyr IDE: Setup Workspace) and try again.`);
      return undefined;
    }

    const westArgs: string[] = [];
    if (cfg.domain) {
      westArgs.push("--domain", cfg.domain);
    }
    if (cfg.file) {
      westArgs.push("--file", cfg.file);
    }
    if (cfg.elfFile) {
      westArgs.push("--elf-file", cfg.elfFile);
    }
    if (cfg.hexFile) {
      westArgs.push("--hex-file", cfg.hexFile);
    }
    if (cfg.binFile) {
      westArgs.push("--bin-file", cfg.binFile);
    }
    if (cfg.gdbPort !== undefined) {
      westArgs.push("--gdb-port", String(cfg.gdbPort));
    }
    if (cfg.tclPort !== undefined) {
      westArgs.push("--tcl-port", String(cfg.tclPort));
    }
    if (cfg.telnetPort !== undefined) {
      westArgs.push("--telnet-port", String(cfg.telnetPort));
    }
    if (cfg.noLoad) {
      westArgs.push("--no-load");
    }
    if (cfg.noReset) {
      westArgs.push("--no-reset");
    }
    // west --rebuild/--no-rebuild are mutually exclusive.
    const hasRebuild = cfg.rebuild === true;
    const hasNoRebuild = cfg.noRebuild === true;
    const rebuildFlagsSet = [hasRebuild, hasNoRebuild].filter(Boolean).length;
    if (rebuildFlagsSet > 1) {
      notifyError("Debug",
        "Conflicting west rebuild options: choose only one of rebuild or noRebuild.");
      return undefined;
    }
    if (hasRebuild) {
      westArgs.push("--rebuild");
    } else if (hasNoRebuild) {
      westArgs.push("--no-rebuild");
    }
    if (cfg.westExtraServerArgs?.length) {
      westArgs.push(...cfg.westExtraServerArgs);
    }
    if (cfg.toolOpt?.length) {
      for (const t of cfg.toolOpt) {
        westArgs.push("--tool-opt", t);
      }
    }
    if (cfg.devId) {
      westArgs.push("--dev-id", cfg.devId);
    }
    if (cfg.serial) {
      westArgs.push("--serial", cfg.serial);
    }
    if (cfg.interface) {
      westArgs.push("--iface", cfg.interface);
    }
    if (cfg.frequency !== undefined) {
      westArgs.push("--frequency", String(cfg.frequency));
    }
    if (cfg.port !== undefined) {
      westArgs.push("--port", String(cfg.port));
    }
    if (cfg.connectUnderReset) {
      westArgs.push("--connect-under-reset");
    }
    if (cfg.erase) {
      westArgs.push("--erase");
    }
    if (cfg.noErase) {
      westArgs.push("--no-erase");
    }
    if (cfg.reset) {
      westArgs.push("--reset");
    }
    if (cfg.rttAddress) {
      westArgs.push("--rtt-address", cfg.rttAddress);
    }
    if (cfg.tui) {
      westArgs.push("--tui");
    }
    if (cfg.config?.length) {
      for (const c of cfg.config) {
        westArgs.push("--config", c);
      }
    }
    if (cfg.flashAddress !== undefined) {
      westArgs.push("--flash-address", String(cfg.flashAddress));
    }
    if (cfg.verify) {
      westArgs.push("--verify");
    }
    if (cfg.verifyOnly) {
      westArgs.push("--verify-only");
    }
    if (cfg.noHalt) {
      westArgs.push("--no-halt");
    }
    if (cfg.noInit) {
      westArgs.push("--no-init");
    }
    if (cfg.noTargets) {
      westArgs.push("--no-targets");
    }
    if (cfg.targetHandle) {
      westArgs.push("--target-handle", cfg.targetHandle);
    }
    if (cfg.rttPort !== undefined) {
      westArgs.push("--rtt-port", String(cfg.rttPort));
    }
    if (cfg.rttServer) {
      westArgs.push("--rtt-server");
    }
    if (cfg.gdbHost) {
      westArgs.push("--gdb-host", cfg.gdbHost);
    }
    if (cfg.gdbClientPort !== undefined) {
      westArgs.push("--gdb-client-port", String(cfg.gdbClientPort));
    }
    if (cfg.gdbInit?.length) {
      for (const g of cfg.gdbInit) {
        westArgs.push("--gdb-init", g);
      }
    }
    if (cfg.chip) {
      westArgs.push("--chip", cfg.chip);
    }
    if (cfg.protocol) {
      westArgs.push("--protocol", cfg.protocol);
    }
    if (cfg.speed !== undefined) {
      westArgs.push("--speed", String(cfg.speed));
    }
    if (cfg.batch) {
      westArgs.push("--batch");
    }
    if (cfg.device) {
      westArgs.push("--device", cfg.device);
    }
    if (cfg.loader) {
      westArgs.push("--loader", cfg.loader);
    }
    if (cfg.dtFlash) {
      westArgs.push("--dt-flash", "y");
    }
    if (cfg.resetType) {
      westArgs.push("--reset-type", cfg.resetType);
    }
    if (cfg.westArgs) {
      westArgs.push(...cfg.westArgs);
    }

    const westDebugCfg: any = {
      type: "cortex-debug",
      request: cfg.request === "attach" ? "attach" : "launch",
      name: cfg.name,
      servertype: "external",
      executable: runnersYaml.elfFile,
      gdbPath: runnersYaml.gdb,
      cwd: typeof (cfg as any).cwd === "string"
        ? (cfg as any).cwd
        : (folder ? folder.uri.fsPath : undefined),
    };
    if (typeof (cfg as any).svdFile === "string") {
      westDebugCfg.svdFile = (cfg as any).svdFile;
    }

    const userSuppliedTarget = typeof (cfg as any).gdbTarget === "string" && (cfg as any).gdbTarget.length > 0;
    if (userSuppliedTarget) {
      westDebugCfg.gdbTarget = (cfg as any).gdbTarget;
    } else {
      const spawnOk = await this.spawnAndAttachDebugServer(
        {
          setupState,
          cwd: path.join(wsConfig.rootPath, resolved.project.rel_path),
          buildDir,
          runner: requestedRunner,
          extraArgs: westArgs,
        },
        westDebugCfg,
        cfg.name,
      );
      if (!spawnOk) { return undefined; }
    }

    const reservedKeys = new Set([
      "type", "request", "name", "runner", "project", "build", "ask",
      "useWestDebugServer",
      "westArgs", "toolOpt", "domain",
      "file", "elfFile", "hexFile", "binFile", "gdbPort",
      "tclPort", "telnetPort", "noLoad", "noReset",
      "rebuild", "noRebuild",
      "westExtraServerArgs", "devId", "port",
      "serial", "interface", "frequency",
      "connectUnderReset", "erase", "noErase", "reset",
      "rttAddress", "tui", "config", "flashAddress",
      "verify", "verifyOnly", "noHalt", "noInit", "noTargets",
      "targetHandle", "rttPort", "rttServer", "gdbHost",
      "gdbClientPort", "gdbInit", "chip", "protocol", "speed",
      "batch", "device", "loader", "dtFlash", "resetType",
    ]);
    for (const [k, v] of Object.entries(cfg)) {
      if (reservedKeys.has(k)) { continue; }
      if (v !== undefined) {
        (westDebugCfg as any)[k] = v;
      }
    }

    outputInfo("Debug",
      `Launching external session via west debugserver (runner "${requestedRunner}")\n` +
      `${JSON.stringify(westDebugCfg, null, 2)}`);
    return westDebugCfg as vscode.DebugConfiguration;
  }
}

export class ZephyrIdeCortexDebugConfigurationProvider extends ZephyrIdeDebugConfigurationProvider {
  constructor(
    getWorkspaceConfig: () => WorkspaceConfig,
    context?: vscode.ExtensionContext,
  ) {
    super(getWorkspaceConfig, context, "cortex");
  }
}

export class ZephyrIdeWestDebugConfigurationProvider extends ZephyrIdeDebugConfigurationProvider {
  constructor(
    getWorkspaceConfig: () => WorkspaceConfig,
    context?: vscode.ExtensionContext,
  ) {
    super(getWorkspaceConfig, context, "west");
  }
}
