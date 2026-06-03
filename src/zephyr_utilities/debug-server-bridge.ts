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
 * West-debug-server lifecycle for the `zephyr-ide` debug provider's
 * **external bridge**. See {@link WEST_DEBUG_RUNNERS} in `runner_selector.ts`.
 *
 * A bridged runner (nrfjprog, linkserver, esp32, stm32cubeprogrammer, probe-rs, …) has
 * no native cortex-debug `servertype` but can be launched as a GDB-remote
 * server by `west debugserver`. The debug provider:
 *
 *   1. Calls {@link startWestDebugServer} to spawn the server child process,
 *      parse its stdout for the listening `host:port`, and resolve a handle
 *      with a `dispose()` killer.
 *   2. Hands cortex-debug a `servertype: "external"` + `gdbTarget` config
 *      pointing at that port.
 *   3. Registers `dispose()` on `vscode.debug.onDidTerminateDebugSession`
 *      so the server child dies when the user stops the debug session.
 *
 * The spawn waits up to {@link DEFAULT_LISTEN_TIMEOUT_MS} for a recognised
 * port-announcement line in stdout/stderr. If no port is detected within
 * the timeout, a runner-specific default port is used and a warning is
 * emitted to the Zephyr IDE output channel — cortex-debug will still
 * attempt to connect and surface a clear error if the port is wrong.
 */

import * as path from "upath";
import { spawn, ChildProcess } from "child_process";
import * as vscode from "vscode";

import { SetupState } from "../setup_utilities/types";
import { getPythonVenvBinaryFolder } from "../utilities/utils";
import { outputInfo, outputWarning, outputError } from "../utilities/output";

/** Maximum wall-clock time to wait for the GDB server to print its port. */
export const DEFAULT_LISTEN_TIMEOUT_MS = 10_000;

/** Default GDB ports per Zephyr runner when stdout parsing fails. These
 *  match the defaults used by the underlying tooling so cortex-debug has a
 *  reasonable chance of connecting even if the announcement line is missed. */
const RUNNER_DEFAULT_PORTS: Record<string, number> = {
  nrfjprog: 2331,            // JLinkGDBServerCL default
  linkserver: 3333,          // NXP LinkServer GDB default
  esp32: 3333,               // OpenOCD (esp32 uses openocd under the hood)
  stm32cubeprogrammer: 61234, // STM32_Programmer_CLI gdbserver default
  "probe-rs": 1337,          // probe-rs GDB stub default
};

/**
 * Per-runner regex(es) used to extract `host` and `port` from the server's
 * stdout/stderr stream. Capture group 1 is the port; capture group 2, if
 * present, is the host. Patterns are tried in order until one matches.
 *
 * Most GDB servers print one of:
 *   - `Listening on TCP/IP port 2331`            (JLinkGDBServer / nrfjprog)
 *   - `GDB server listening on port 3333`        (LinkServer)
 *   - `Info : Listening on port 3333 for gdb …`  (OpenOCD / esp32)
 *   - `GDB server listening at 127.0.0.1:61234`  (STM32CubeProgrammer)
 */
const PORT_PATTERNS: Record<string, RegExp[]> = {
  "probe-rs": [
    // Emitted by probe-rs when the GDB stub is actually listening.
    // "Firing up GDB stub for Armv7em cores at [[::1]:1337, 127.0.0.1:1337]"
    // We extract only the port; host defaults to "localhost" so GDB connects
    // correctly on Windows systems where 127.0.0.1 fails with error 138.
    /Firing up GDB stub.*\d{1,3}(?:\.\d{1,3}){3}:(\d{2,5})/i,
  ],
  nrfjprog: [
    /Listening on TCP\/IP port\s+(\d{2,5})/i,
    /port[:\s]+(\d{2,5})/i,
  ],
  linkserver: [
    /(?:GDB server|gdbserver).*?listening on (?:port|:)\s*(\d{2,5})/i,
    /Listening on.*?:(\d{2,5})/i,
  ],
  esp32: [
    /Listening on port\s+(\d{2,5})\s+for gdb/i,
    /Info\s*:\s*Listening on port\s+(\d{2,5})/i,
  ],
  stm32cubeprogrammer: [
    /listening (?:on|at)\s+(?:([\w.]+):)?(\d{2,5})/i,
  ],
};

/** Fallback pattern used when no runner-specific pattern matches. */
const GENERIC_PATTERN = /(?:listening|started|gdbserver|server\s+started).*?(?:port|:)\s*(\d{2,5})/i;

/** Handle returned by {@link startWestDebugServer}. */
export interface WestDebugServerHandle {
  /** Host the GDB server is listening on. Defaults to `127.0.0.1`. */
  host: string;
  /** TCP port the GDB server is listening on. */
  port: number;
  /** True when `port` came from stdout; false when it fell back to a default. */
  portDetected: boolean;
  /** Kill the child process and any subprocess group. Idempotent. */
  dispose(): Promise<void>;
  /** The underlying child for tests / advanced callers. */
  child: ChildProcess;
}

/** Options for {@link startWestDebugServer}. */
export interface StartWestDebugServerOptions {
  setupState: SetupState;
  /** Working directory (typically the project directory). */
  cwd: string;
  /** Absolute path to the build directory passed to `west --build-dir`. */
  buildDir: string;
  /** Zephyr runner name (must be a bridged runner; see `WEST_DEBUG_RUNNERS`). */
  runner: string;
  /** Extra args appended to `west debugserver` after the runner name. */
  extraArgs?: string[];
  /** Override the default listen timeout (test hook). */
  listenTimeoutMs?: number;
  /**
   * Test hook: replace the spawned child with a pre-made one. When supplied,
   * `west debugserver` is NOT invoked — useful for unit testing the stdout
   * parsing without a real Zephyr install.
   */
  spawnOverride?: () => ChildProcess;
}

/**
 * Match a single line of server output against the configured patterns for
 * `runner` and the generic fallback. Returns `{host, port}` on the first hit.
 */
export function matchPortAnnouncement(
  runner: string,
  line: string,
): { host: string; port: number } | undefined {
  const patterns = [...(PORT_PATTERNS[runner] ?? []), GENERIC_PATTERN];
  for (const re of patterns) {
    const m = line.match(re);
    if (!m) { continue; }
    // Patterns either capture (port) or (host, port). Detect by group count.
    const portStr = m[2] ?? m[1];
    const hostStr = m[2] ? m[1] : undefined;
    const port = parseInt(portStr, 10);
    if (Number.isFinite(port) && port > 0 && port < 65536) {
      return { host: hostStr || "localhost", port };
    }
  }
  return undefined;
}

/**
 * Spawn `west debugserver --runner <runner> --build-dir <buildDir> [extraArgs]`
 * and resolve once a listening port is detected on stdout/stderr, or once
 * `listenTimeoutMs` elapses (resolving with a runner-default port and
 * `portDetected: false`).
 *
 * Rejects if the spawn itself fails or the child exits before any port is
 * announced. On success the caller MUST call `dispose()` on the returned
 * handle when the debug session ends, otherwise the server child outlives
 * the IDE.
 */
export async function startWestDebugServer(
  options: StartWestDebugServerOptions,
): Promise<WestDebugServerHandle> {
  const { setupState, cwd, buildDir, runner } = options;
  const timeoutMs = options.listenTimeoutMs ?? DEFAULT_LISTEN_TIMEOUT_MS;

  const args = [
    "debugserver",
    "--runner", runner,
    "--build-dir", buildDir,
    ...(options.extraArgs ?? []),
  ];

  // Build environment: prepend venv bin so `west` (and any tooling it shells
  // out to: JLinkGDBServerCL, LinkServer, openocd, STM32_Programmer_CLI) is
  // discoverable without requiring it on the system PATH.
  const env: NodeJS.ProcessEnv = { ...process.env };
  const venvBin = await getPythonVenvBinaryFolder(setupState);
  if (venvBin) {
    const pathKey = process.platform === "win32"
      ? (Object.keys(env).find(k => k.toLowerCase() === "path") || "Path")
      : "PATH";
    env[pathKey] = `${venvBin}${path.delimiter}${env[pathKey] ?? ""}`;
  }
  if (setupState.env["VIRTUAL_ENV"]) { env.VIRTUAL_ENV = setupState.env["VIRTUAL_ENV"]; }
  if (setupState.zephyrDir) { env.ZEPHYR_BASE = setupState.zephyrDir; }
  if (setupState.env["ZEPHYR_SDK_INSTALL_DIR"] && !process.env.ZEPHYR_SDK_INSTALL_DIR) {
    env.ZEPHYR_SDK_INSTALL_DIR = setupState.env["ZEPHYR_SDK_INSTALL_DIR"];
  }

  outputInfo("Debug", `Starting west debugserver for runner "${runner}"\n  cwd: ${cwd}\n  args: ${args.join(" ")}`);

  const child = options.spawnOverride
    ? options.spawnOverride()
    : spawn("west", args, {
      cwd,
      env,
      // Detached on POSIX so we can kill the entire process group on dispose.
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32", // resolve `west.cmd` on Windows
    });

  return new Promise<WestDebugServerHandle>((resolve, reject) => {
    let resolved = false;
    let stdoutBuffer = "";
    let stderrBuffer = "";
    /** Full stderr/stdout accumulated for use in the exit-error message. */
    let fullOutput = "";

    const settle = (host: string, port: number, portDetected: boolean): void => {
      if (resolved) { return; }
      resolved = true;
      clearTimeout(timeoutHandle);
      outputInfo(
        "Debug",
        portDetected
          ? `west debugserver listening on ${host}:${port}`
          : `west debugserver port not detected within ${timeoutMs}ms; falling back to default ${host}:${port}. ` +
          `If cortex-debug fails to connect, supply "gdbTarget" explicitly in launch.json.`,
      );
      resolve({ host, port, portDetected, dispose, child });
    };

    const dispose = async (): Promise<void> => {
      if (child.killed || child.exitCode !== null) { return; }
      try {
        if (process.platform === "win32") {
          // Kill child + descendants by PID tree.
          await new Promise<void>(r => {
            const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
            killer.on("exit", () => r());
            killer.on("error", () => r());
          });
        } else if (child.pid !== undefined) {
          // Negative PID kills the whole process group (we spawned detached).
          try { process.kill(-child.pid, "SIGTERM"); } catch { /* already dead */ }
          // Allow a short grace period, then force.
          await new Promise<void>(r => setTimeout(r, 500));
          if (child.exitCode === null) {
            try { process.kill(-child.pid, "SIGKILL"); } catch { /* ignore */ }
          }
        }
      } catch (e) {
        outputWarning("Debug", `Failed to terminate west debugserver child: ${String(e)}`);
      }
    };

    const consumeChunk = (chunk: Buffer | string, isStderr: boolean) => {
      const text = chunk.toString();
      fullOutput += text;
      if (isStderr) { stderrBuffer += text; } else { stdoutBuffer += text; }
      const buffer = isStderr ? stderrBuffer : stdoutBuffer;
      const lines = buffer.split(/\r?\n/);
      // Keep the last (possibly-incomplete) line in the buffer.
      const lastLine = lines.pop() ?? "";
      if (isStderr) { stderrBuffer = lastLine; } else { stdoutBuffer = lastLine; }
      for (const line of lines) {
        if (line.trim()) {
          outputInfo("Debug", `[debug-server] ${line}`);
        }
        if (resolved) { continue; }
        const hit = matchPortAnnouncement(runner, line);
        if (hit) { settle(hit.host, hit.port, true); }
      }
    };

    child.stdout?.on("data", c => consumeChunk(c, false));
    child.stderr?.on("data", c => consumeChunk(c, true));

    child.on("error", err => {
      if (resolved) { return; }
      resolved = true;
      clearTimeout(timeoutHandle);
      outputError("Debug", `Failed to spawn west debugserver: ${err.message}`);
      reject(err);
    });

    child.on("exit", (code, signal) => {
      if (resolved) { return; }
      resolved = true;
      clearTimeout(timeoutHandle);
      // The full accumulated output is logged to the output channel; the Error
      // message is kept short so VS Code's notification popup is not bloated.
      // The caller in debug-provider.ts shows a "Show Output" button for details.
      const detail = fullOutput.trim() || "(no output)";
      if (code !== 0 && /unknown command/i.test(detail)) {
        // west does not know "debugserver" — the command was added in Zephyr 3.6.
        // Older releases (including some nRF Connect SDK versions) don't have it.
        outputError("Debug",
          `"west debugserver" is not available in this Zephyr installation. ` +
          `The command was introduced in Zephyr 3.6; older releases (including some ` +
          `nRF Connect SDK versions) do not have it.\n` +
          `To debug with openocd or jlink natively via cortex-debug (no west bridge needed), ` +
          `change the debug slot bind to "cortex-debug (auto-config)" in the ` +
          `Zephyr IDE Active Project view.\n` +
          `west output: ${detail}`);
        // "unknown command" in the message is the detection key for debug-provider.ts.
        reject(new Error("west debugserver: unknown command"));
      } else {
        const shortMsg = `west debugserver exited before announcing a port (code=${code}, signal=${signal})`;
        outputError("Debug", `${shortMsg}\n${detail}`);
        reject(new Error(shortMsg));
      }
    });

    const timeoutHandle = setTimeout(() => {
      if (resolved) { return; }
      const fallbackPort = RUNNER_DEFAULT_PORTS[runner];
      if (fallbackPort !== undefined) {
        settle("127.0.0.1", fallbackPort, false);
      } else {
        resolved = true;
        outputError("Debug", `west debugserver did not announce a port within ${timeoutMs}ms and no default is known for runner "${runner}".`);
        void dispose();
        reject(new Error(`Timed out waiting for west debugserver (runner: ${runner}) to start.`));
      }
    }, timeoutMs);
  });
}

/**
 * Register a one-shot listener that disposes `handle` when the named debug
 * session ends. Returns the disposable for ownership by the caller.
 */
export function disposeOnSessionEnd(
  handle: WestDebugServerHandle,
  sessionName: string,
): vscode.Disposable {
  const disposable = vscode.debug.onDidTerminateDebugSession(session => {
    if (session.name !== sessionName) { return; }
    disposable.dispose();
    void handle.dispose();
  });
  return disposable;
}
