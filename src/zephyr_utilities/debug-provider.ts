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
import { loadRunnerProfiles, findRunnerProfile, resolveBind, resolveRunnerArgs, splitArgs } from "../project_utilities/runner_profiles";
import { WorkspaceConfig } from "../setup_utilities/types";
import { notifyError, outputInfo } from "../utilities/output";

/** Extra fields a user may set on a `zephyr-ide` debug configuration. */
interface ZephyrIdeDebugConfig extends vscode.DebugConfiguration {
  /** Optional explicit Zephyr runner to use (e.g. "jlink", "openocd"). */
  runner?: string;
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
  // User-supplied args are appended last so they can override runners.yaml values.
  const runnerArgs = [...(runnersYaml.args[runner] || []), ...(options.userArgs ?? [])];

  switch (serverType) {
    case "openocd": {
      const configFiles: string[] = [];
      const searchDir: string[] = [];
      for (let i = 0; i < runnerArgs.length; i++) {
        const a = runnerArgs[i];
        if (a === "-f" || a === "--openocd-config") {
          const next = runnerArgs[i + 1];
          if (next) { configFiles.push(next); i++; }
        } else if (a === "-s" || a === "--openocd-search") {
          const next = runnerArgs[i + 1];
          if (next) { searchDir.push(next); i++; }
        } else if (a.startsWith("-f=")) {
          configFiles.push(a.slice(3));
        } else if (a.startsWith("--openocd-config=")) {
          configFiles.push(a.slice("--openocd-config=".length));
        } else if (a.startsWith("--openocd-search=")) {
          searchDir.push(a.slice("--openocd-search=".length));
        }
      }
      // Fallback: use the board-level openocd.cfg when runners.yaml args
      // don't carry any -f flags. Zephyr boards typically ship
      // support/openocd.cfg that sources both the interface (probe) and
      // target configs, matching what `west debug` uses at runtime.
      if (!configFiles.length && runnersYaml.boardDir) {
        const candidates = [
          path.join(runnersYaml.boardDir, "support", "openocd.cfg"),
          path.join(runnersYaml.boardDir, "openocd.cfg"),
        ];
        for (const candidate of candidates) {
          if (fs.existsSync(candidate)) {
            configFiles.push(candidate);
            break;
          }
        }
      }
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
        }
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
 *   1. The runner explicitly requested in the launch.json config.
 *   2. runners.yaml's `debug-runner` (if it is cortex-debug-capable).
 *   3. The first cortex-debug-capable runner in runners.yaml's `runners` list.
 *
 * Runners that cortex-debug cannot drive (e.g. dfu-util, nrfjprog, qemu) are
 * skipped so the user sees a clear "cannot auto-translate" message rather than
 * a silently broken session.
 * 
 * If the requested runner is not found in runners.yaml.runners or runners.yaml.args,
 * falls back to debugRunner with a warning.
 */
export function pickDebugRunner(
  runnersYaml: RunnersYaml,
  requested?: string
): string | undefined {
  if (requested) {
    // Check if requested runner is in runners.yaml
    const hasRunner = runnersYaml.runners.includes(requested) || (requested in runnersYaml.args);
    if (!hasRunner && runnersYaml.debugRunner && runnerToServerType(runnersYaml.debugRunner)) {
      outputInfo("Debug", `Requested runner "${requested}" not found in runners.yaml. Falling back to debugRunner "${runnersYaml.debugRunner}".`);
      return runnersYaml.debugRunner;
    }
    if (!hasRunner) {
      // Fall through to the first cortex-debug-capable runner; debugRunner
      // (if set) cannot be driven by cortex-debug, so prefer something usable.
      const fallback = runnersYaml.runners.find(r => runnerToServerType(r) !== undefined);
      if (fallback) {
        outputInfo("Debug", `Requested runner "${requested}" not found in runners.yaml. Falling back to cortex-debug-capable runner "${fallback}".`);
        return fallback;
      }
      // No usable runner in runners.yaml. Only return the requested name
      // when cortex-debug actually knows how to drive it (i.e. it is a known
      // runner type that just happens to be missing from this build's
      // runners.yaml). Otherwise return undefined so the caller surfaces a
      // clean "cannot auto-translate" error instead of forwarding a bogus
      // server-type to cortex-debug.
      if (runnerToServerType(requested) === undefined) {
        return undefined;
      }
    }
    return requested;
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

    // Merge user-supplied runner args from active RunnerProfile bind.
    let userArgs: string[] | undefined;
    const profileName = resolved.build.activeProfile;
    const profile = profileName ? findRunnerProfile(profileName, loadRunnerProfiles(wsConfig)) : undefined;
    if (profile) {
      // Pick the bind for this session kind: launch sessions use the unified
      // debug bind; attach sessions use the dedicated attach bind.
      const slot: "debug" | "attach" = cfg.request === "attach" ? "attach" : "debug";
      const bind = profile[slot];
      const override = resolved.build.bindOverrides?.[slot];
      if (bind.kind === "launch") {
        outputInfo("Debug", `Profile "${profileName}" has ${slot} bind set to launch.json config. Ignoring for auto-translation.`);
      } else {
        const r = resolveBind(bind, override);
        if (r && r.args.trim()) {
          const resolvedArgs = resolveRunnerArgs(r.args, {
            workspaceFolder: wsConfig.rootPath,
            buildFolder: buildDir,
            board: resolved.build.board,
            boardRevision: resolved.build.revision ?? "",
            project: resolved.projectName,
            build: resolved.buildName,
            buildVars: resolved.build.customVars,
            projectVars: resolved.project.customVars,
          });
          userArgs = splitArgs(resolvedArgs);
        }
      }
    }

    const cortexCfg = buildCortexDebugConfig(runnersYaml, runner, {
      name: cfg.name,
      request: cfg.request === "attach" ? "attach" : "launch",
      cwd: typeof (cfg as any).cwd === "string" ? (cfg as any).cwd : (folder ? folder.uri.fsPath : undefined),
      svdFile: typeof (cfg as any).svdFile === "string" ? (cfg as any).svdFile : undefined,
      userArgs,
    });

    if (!cortexCfg) {
      notifyError(
        "Debug",
        `Runner "${runner}" cannot be auto-translated to a cortex-debug configuration. Set "runner" in launch.json or use a cortex-debug config directly.`
      );
      return undefined;
    }

    // Allow user to override individual cortex-debug fields by including them
    // in their original config. User-provided keys (other than the few we
    // interpret ourselves) win over the auto-generated ones.
    const reservedKeys = new Set([
      "type", "request", "name", "runner",
    ]);
    for (const [k, v] of Object.entries(cfg)) {
      if (reservedKeys.has(k)) { continue; }
      if (v !== undefined) {
        (cortexCfg as any)[k] = v;
      }
    }

    // BMP requires a serial port (BMPGDBSerialPort) for cortex-debug to open
    // the GDB server connection. If it is still absent after merging user
    // overrides, the session will fail immediately with an unhelpful error.
    // Catch it here and surface an actionable message instead.
    if (cortexCfg.servertype === "bmp" && !(cortexCfg as any).BMPGDBSerialPort) {
      const isWindows = process.platform === "win32";
      const examplePort = isWindows ? "COM3" : "/dev/ttyACM0";
      notifyError(
        "Debug",
        `Black Magic Probe (BMP) requires a serial port. Add "BMPGDBSerialPort": "${examplePort}" ` +
        `to your launch.json zephyr-ide config, or configure it in the runner profile via ` +
        `"args": "--gdb-serial ${examplePort}".`
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

    outputInfo("Debug", `Launching cortex-debug session with runner "${runner}"`);
    return cortexCfg;
  }
}
