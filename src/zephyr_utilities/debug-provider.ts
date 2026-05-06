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
import {
  parseRunnersYaml,
  resolveRunnersYamlPath,
  findSvdFile,
  runnerToServerType,
  RunnersYaml,
} from "./runners-yaml";
import { resolveActiveProjectBuild } from "../project_utilities/project";
import { resolveEffectiveRunner, parseShellArgs } from "../project_utilities/runner_selector";
import { WorkspaceConfig } from "../setup_utilities/types";
import { notifyError } from "../utilities/output";

/** Extra fields a user may set on a `zephyr-ide` debug configuration. */
interface ZephyrIdeDebugConfig extends vscode.DebugConfiguration {
  /** Optional explicit Zephyr runner to use (e.g. "jlink", "openocd"). */
  runner?: string;
  /** Optional override for project name. */
  project?: string;
  /** Optional override for build name. */
  build?: string;
}

/**
 * Build a cortex-debug `vscode.DebugConfiguration` from a parsed runners.yaml.
 * Returns undefined when the runner cannot be mapped to a cortex-debug
 * servertype; in that case the caller should leave the config alone (or
 * notify the user).
 *
 * @param options.userArgs  Extra runner arguments supplied by the user's
 *   `RunnerConfig.args` (after cascading global→project→build). These are
 *   appended after the runners.yaml args so that user-supplied values take
 *   precedence when a flag can appear multiple times (last wins).
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
    rtos: "Zephyr",
  };

  if (runnersYaml.elfFile) {
    cfg.executable = runnersYaml.elfFile;
  }
  if (runnersYaml.gdb) {
    cfg.gdbPath = runnersYaml.gdb;
  }
  const svdFile = options.svdFile || findSvdFile(runnersYaml.boardDir);
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
      if (configFiles.length) { cfg.configFiles = configFiles; }
      if (searchDir.length) { cfg.searchDir = searchDir; }
      if (runnersYaml.openocdSearch?.length) {
        cfg.searchDir = (cfg.searchDir || []).concat(runnersYaml.openocdSearch);
      }
      if (runnersYaml.openocd) { cfg.serverpath = runnersYaml.openocd; }
      break;
    }
    case "jlink": {
      // Look for --device / --speed / --interface in the args array.
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
        if (speed !== undefined && !cfg.serverArgs) { cfg.serverArgs = ["-speed", speed]; if (a === "--speed") { i++; } continue; }
        const iface = eq("--iface") ?? eq("--interface");
        if (iface !== undefined && !cfg.interface) { cfg.interface = iface; if (a === "--iface" || a === "--interface") { i++; } continue; }
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
    case "bmp": {
      for (let i = 0; i < runnerArgs.length; i++) {
        const a = runnerArgs[i];
        if (a === "--gdb-serial") {
          const next = runnerArgs[i + 1];
          if (next) { cfg.BMPGDBSerialPort = next; i++; }
        } else if (a.startsWith("--gdb-serial=")) {
          cfg.BMPGDBSerialPort = a.slice("--gdb-serial=".length);
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
 */
export function pickDebugRunner(
  runnersYaml: RunnersYaml,
  requested?: string
): string | undefined {
  if (requested) { return requested; }
  if (runnersYaml.debugRunner && runnerToServerType(runnersYaml.debugRunner)) {
    return runnersYaml.debugRunner;
  }
  // Fall back to the first runner that cortex-debug can actually drive.
  return runnersYaml.runners.find(r => runnerToServerType(r) !== undefined);
}

/**
 * VS Code DebugConfigurationProvider implementation. Hands back a translated
 * cortex-debug configuration when the user launches a `zephyr-ide` config.
 */
export class ZephyrIdeDebugConfigurationProvider
  implements vscode.DebugConfigurationProvider {

  constructor(private readonly getWorkspaceConfig: () => WorkspaceConfig) {}

  /**
   * Provide an initial launch configuration when the user has no launch.json
   * yet. Kept intentionally minimal — the heavy lifting happens in
   * resolveDebugConfigurationWithSubstitutedVariables.
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
   * Translate the (already variable-substituted) `zephyr-ide` config into a
   * cortex-debug config by parsing runners.yaml. We use the
   * "WithSubstitutedVariables" variant so any `${command:...}` / `${input:...}`
   * are already resolved by VS Code before we run.
   */
  resolveDebugConfigurationWithSubstitutedVariables(
    folder: vscode.WorkspaceFolder | undefined,
    debugConfig: vscode.DebugConfiguration,
  ): vscode.ProviderResult<vscode.DebugConfiguration> {
    const wsConfig = this.getWorkspaceConfig();
    if (!wsConfig) {
      notifyError("Debug", "Zephyr IDE workspace is not initialized.");
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
      notifyError(
        "Debug",
        `runners.yaml not found at "${runnersYamlPath}". Build the project first so the Zephyr build system can generate it.`
      );
      return undefined;
    }

    const runner = pickDebugRunner(runnersYaml, cfg.runner);
    if (!runner) {
      notifyError("Debug", `No debug-capable runner found in "${runnersYamlPath}".\nAvailable runners: ${runnersYaml.runners.join(", ") || "(none)"}. Configure a runner that cortex-debug supports (openocd, jlink, pyocd, stlink, bmp).`);
      return undefined;
    }

    // B6: Merge user-supplied runner args (from active RunnerConfig, cascaded
    // global→project→build) into the debug config so that settings like
    // --speed or custom OpenOCD config files are honoured by the debugger too.
    let userArgs: string[] | undefined;
    const activeRunnerName = wsConfig.projectStates?.[resolved.projectName]?.buildStates?.[resolved.buildName]?.activeRunner;
    if (activeRunnerName && resolved.build.runnerConfigs?.[activeRunnerName]) {
      const eff = resolveEffectiveRunner(
        resolved.project.runnerConfigs ?? {},
        resolved.build.runnerConfigs,
        activeRunnerName,
      );
      const parsed = parseShellArgs(eff.args ?? "");
      if (parsed.length > 0) { userArgs = parsed; }
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
      "type", "request", "name", "runner", "project", "build",
    ]);
    for (const [k, v] of Object.entries(cfg)) {
      if (reservedKeys.has(k)) { continue; }
      if (v !== undefined) {
        (cortexCfg as any)[k] = v;
      }
    }

    return cortexCfg;
  }
}
