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
 */

import * as vscode from "vscode";
import * as path from "upath";
import * as fs from "fs";
import {
  parseRunnersYaml,
  resolveRunnersYamlPath,
  findSvdFile,
  runnerToServerType,
  RunnersYaml,
} from "./runners-yaml";
import { resolveActiveProjectBuild } from "../project_utilities/project";
import { splitArgs } from "../project_utilities/runner_profiles";
import { WorkspaceConfig } from "../setup_utilities/types";
import { notifyError, outputInfo } from "../utilities/output";

/** Extra fields a user may set on a `zephyr-ide` debug configuration. */
interface ZephyrIdeDebugConfig extends vscode.DebugConfiguration {
  /** Optional explicit Zephyr runner to use (e.g. "jlink", "openocd"). */
  runner?: string;
  /** Flash-only west arguments; ignored for debug/attach provider translation. */
  westArgs?: string[];
  /** Optional sysbuild domain override when choosing runners.yaml. */
  sysbuildDomain?: string;
}

/**
 * Re-export of {@link splitArgs} from runner_profiles for backwards
 * compatibility — debug-provider used to own a separate copy. Both call sites
 * (user input parsing and post-substitution serverArgs tokenisation) now
 * share a single POSIX-style tokeniser to avoid drift.
 */
export { splitArgs };

/**
 * Build a cortex-debug `vscode.DebugConfiguration` from a parsed runners.yaml.
 * Returns undefined when the runner cannot be mapped to a cortex-debug
 * servertype; in that case the caller should leave the config alone (or
 * notify the user).
 *
 */
export function buildCortexDebugConfig(
  runnersYaml: RunnersYaml,
  runner: string,
  options: {
    name?: string;
    request?: "launch" | "attach";
    cwd?: string;
    svdFile?: string;
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
  };

  // Only openocd and jlink support the rtos field in cortex-debug.
  // stlink, pyocd, and bmp don't support it and will error if it's set.
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
  const runnerArgs = runnersYaml.args[runner] || [];

  switch (serverType) {
    case "openocd": {
      const configFilesFromRunners: string[] = [];
      const searchDir: string[] = [];
      let enableRtt = false;
      let rttPort: number | undefined;
      const runnersYamlArgs = runnersYaml.args[runner] || [];
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
          }
        }
      };
      parseSingleArgList(runnersYamlArgs, configFilesFromRunners);
      const effectiveFromRunners = configFilesFromRunners;

      // Fallback: runners.yaml args carry no -f flags. Zephyr boards typically
      // ship support/openocd.cfg that sources both the interface (probe) and
      // target configs, matching what `west debug` uses at runtime.
      if (effectiveFromRunners.length === 0 && runnersYaml.boardDir) {
        const candidates = [
          path.join(runnersYaml.boardDir, "support", "openocd.cfg"),
          path.join(runnersYaml.boardDir, "openocd.cfg"),
        ];
        for (const candidate of candidates) {
          if (!fs.existsSync(candidate)) { continue; }
          configFilesFromRunners.push(candidate);
          break;
        }
      }

      // Final merged configFiles: OpenOCD requires interface/ files before
      // target/ files or the transport won't be selected. Sort accordingly,
      // preserving relative order within each group.
      const allConfigFiles = [...effectiveFromRunners];
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
          address: "auto",
          rtt_start_retry: 1000,
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
      for (let i = 0; i < runnerArgs.length; i++) {
        const a = runnerArgs[i];
        if (a === "--target" || a === "-t") {
          const next = runnerArgs[i + 1];
          if (next) { cfg.targetId = next; i++; }
        } else if (a.startsWith("--target=")) {
          cfg.targetId = a.slice("--target=".length);
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
    default:
      break;
  }

  return cfg;
}

/**
 * Choose which Zephyr runner to use for a debug session, in priority order:
 *   1. The runner explicitly requested by launch.json.
 *      If cortex-debug can drive it, it is used directly — no runners.yaml check.
 *   2. runners.yaml's `debug-runner` (if it is cortex-debug-capable).
 *   3. The first cortex-debug-capable runner in runners.yaml's `runners` list.
 *
 * Runners that cortex-debug cannot drive (e.g. dfu-util, nrfjprog, qemu) are
 * skipped so the user sees a clear "cannot auto-translate" message rather than
 * a silently broken session.
 */
export function pickDebugRunner(
  runnersYaml: RunnersYaml,
  requested?: string
): string | undefined {
  if (requested) {
    // If cortex-debug (or bmp-debug) can drive the requested runner, honour
    // the user's explicit choice without consulting runners.yaml at all.
    // runners.yaml may simply not list a runner the board supports — that is
    // not a reason to silently override what the user asked for.
    if (runnerToServerType(requested) !== undefined) {
      return requested;
    }
    // Requested runner is not cortex-debug-capable. Fall back to something
    // usable rather than producing an opaque error.
    outputInfo("Debug", `Requested runner "${requested}" cannot be driven by cortex-debug. Falling back to runners.yaml defaults.`);
    if (runnersYaml.debugRunner && runnerToServerType(runnersYaml.debugRunner)) {
      return runnersYaml.debugRunner;
    }
    return runnersYaml.runners.find(r => runnerToServerType(r) !== undefined);
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
  ) { }

  /**
   * Provide an initial launch configuration when the user has no launch.json
   * yet. Kept intentionally minimal — the heavy lifting happens in
   * resolveDebugConfiguration.
   */
  provideDebugConfigurations(): vscode.ProviderResult<vscode.DebugConfiguration[]> {
    return [
      {
        name: "Zephyr IDE: Debug",
        type: "zephyr-ide",
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
    const resolved = resolveActiveProjectBuild(wsConfig);
    if (!resolved) {
      notifyError("Debug", "No active project/build configured. Set one before launching the Zephyr IDE debugger.");
      return undefined;
    }

    const sysbuildImage = cfg.sysbuildDomain ?? wsConfig.projectStates?.[resolved.projectName]?.buildStates?.[resolved.buildName]?.sysbuildImage;
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

    // launch.json `runner` selects an explicit Zephyr runner; otherwise use runners.yaml auto-detection.
    const runner = pickDebugRunner(runnersYaml, cfg.runner);
    if (!runner) {
      // Issue #15: name the runners that were found but rejected so the user
      // understands why no debug session can be auto-translated.
      const all = runnersYaml.runners;
      const rejected = all.filter(r => runnerToServerType(r) === undefined);
      const reason = rejected.length
        ? `Found runner(s) [${rejected.join(", ")}] but cortex-debug cannot drive them.`
        : `runners.yaml lists no runners.`;
      notifyError(
        "Debug",
        `${reason}\nFile: "${runnersYamlPath}"\nAvailable runners: ${all.join(", ") || "(none)"}.\n` +
        `Configure a runner that cortex-debug supports (openocd, jlink, pyocd, stlink, bmp), ` +
        `or bind a hand-written launch.json entry via "Zephyr IDE: Change Debug Launch Configuration For Build".`
      );
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
    }

    // Allow user to override individual cortex-debug fields by including them
    // in their original config. User-provided keys (other than the few we
    // interpret ourselves) win over the auto-generated ones.
    const reservedKeys = new Set([
      "type", "request", "name", "runner", "westArgs", "sysbuildDomain",
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
      notifyError(
        "Debug",
        `Black Magic Probe (BMP) requires a serial port when using cortex-debug. ` +
        `Add "BMPGDBSerialPort": "${examplePort}" to your launch.json zephyr-ide config. ` +
        `Alternatively, install the BMP-Debug extension (mylonics.bmp-debug) which auto-discovers the probe.`
      );
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

    outputInfo("Debug", `Launching ${cortexCfg.type} session with runner "${runner}"\n${JSON.stringify(cortexCfg, null, 2)}`);

    // RTT auto-launch: register a one-shot listener so that after the debug
    // session starts, the RTT terminal is opened automatically.
    const rttEnabled = !!(cortexCfg as any).rttEnabled || !!(cortexCfg as any).rttConfig?.enabled;
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
}
