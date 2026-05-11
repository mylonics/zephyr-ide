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
 * End-to-end style tests for the `zephyr-ide` DebugConfigurationProvider.
 *
 * These tests exercise the FULL pipeline used by a real Debug session:
 *   1. A real on-disk `runners.yaml` is written (sysbuild-aware path layout).
 *   2. A real `WorkspaceConfig` is assembled the way the extension would
 *      build one from `.vscode/zephyr-ide.json`.
 *   3. The production `ZephyrIdeDebugConfigurationProvider.resolveDebugConfiguration`
 *      is invoked with a `vscode.DebugConfiguration` of `{type:"zephyr-ide"}` —
 *      the same object VS Code would hand to the provider when a user
 *      presses F5 on a real workspace.
 *   4. The returned cortex-debug configuration is asserted to be COMPLETE:
 *      every field cortex-debug needs to attempt to launch the gdb server is
 *      present, so any subsequent failure could only come from real hardware
 *      being unavailable — never from missing Zephyr-IDE settings.
 *
 * When `marus25.cortex-debug` is not installed in the test VS Code instance
 * (the default for the unit-tests CI workflow), the provider correctly aborts
 * early with the marketplace-install error. We verify that path explicitly
 * and skip the per-runner completeness assertions in that environment.
 */

import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";

import { ZephyrIdeDebugConfigurationProvider } from "../zephyr_utilities/debug-provider";
import type { WorkspaceConfig } from "../setup_utilities/types";

const CORTEX_DEBUG_EXTENSION_ID = "marus25.cortex-debug";

function makeTempRoot(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "zide-dbg-prov-"));
}

function writeFileEnsureDir(p: string, content: string): void {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
}

/**
 * Build the minimal but realistic WorkspaceConfig + on-disk artifacts for a
 * single-project, single-build workspace that the provider needs to resolve.
 *
 * Returns the assembled wsConfig plus the build directory so the caller can
 * place additional files (e.g. a different runners.yaml variant).
 */
function setupRealWorkspace(opts: {
    runnersYamlContents: string;
    projectName?: string;
    buildName?: string;
}): { wsConfig: WorkspaceConfig; rootPath: string; buildDir: string; cleanup: () => void } {
    const rootPath = makeTempRoot();
    const projectName = opts.projectName ?? "blinky";
    const buildName = opts.buildName ?? "build";
    const relPath = projectName;
    const projectDir = path.join(rootPath, relPath);
    const buildDir = path.join(projectDir, buildName);
    // Lay out the build folder the way Zephyr's build system does so the
    // provider's `resolveRunnersYamlPath` finds the file.
    writeFileEnsureDir(path.join(buildDir, "zephyr", "runners.yaml"), opts.runnersYamlContents);
    // The zephyr.elf path referenced by runners.yaml does not need to be a real
    // ELF, but creating it makes the test more realistic and lets future checks
    // (e.g. cortex-debug's own existsSync) succeed.
    writeFileEnsureDir(path.join(buildDir, "zephyr", "zephyr.elf"), "");

    const wsConfig: WorkspaceConfig = {
        rootPath,
        projects: {
            [projectName]: {
                name: projectName,
                rel_path: relPath,
                buildConfigs: {
                    [buildName]: {
                        name: buildName,
                        board: "nrf52840dk/nrf52840",
                        relBoardDir: "",
                        relBoardSubDir: "",
                        debugOptimization: "Debug",
                        westBuildArgs: [],
                        westBuildCMakeArgs: [],
                        runnerConfigs: {},
                        confFiles: { config: [], extraConfig: [], overlay: [], extraOverlay: [] },
                        launchTarget: "",
                        buildDebugTarget: "",
                        attachTarget: "",
                    },
                },
                confFiles: { config: [], extraConfig: [], overlay: [], extraOverlay: [] },
                twisterConfigs: {},
                runnerConfigs: {},
            },
        },
        projectStates: {
            [projectName]: {
                activeBuildConfig: buildName,
                buildStates: { [buildName]: { runnerStates: {} } },
                twisterStates: {},
                runnerStates: {},
            },
        },
        activeProject: projectName,
        initialSetupComplete: true,
        automaticProjectSelection: false,
    } as unknown as WorkspaceConfig;

    return {
        wsConfig,
        rootPath,
        buildDir,
        cleanup: () => {
            try {
                fs.rmSync(rootPath, { recursive: true, force: true });
            } catch {
                /* best-effort cleanup */
            }
        },
    };
}

/** Minimal fake ExtensionContext exposing the `globalState` API the provider touches. */
function makeFakeContext(): vscode.ExtensionContext {
    const memory = new Map<string, unknown>();
    const globalState = {
        get: <T>(key: string) => memory.get(key) as T | undefined,
        update: (key: string, value: unknown) => {
            memory.set(key, value);
            return Promise.resolve();
        },
        keys: () => Array.from(memory.keys()),
        setKeysForSync: () => { /* noop */ },
    };
    return { globalState } as unknown as vscode.ExtensionContext;
}

suite("Debug Provider Integration Test Suite", () => {
    const isCortexDebugInstalled = !!vscode.extensions.getExtension(CORTEX_DEBUG_EXTENSION_ID);

    test("missing cortex-debug returns undefined with actionable error (no silent failure)", async function () {
        if (isCortexDebugInstalled) {
            // The marketplace-install path is only reachable when cortex-debug
            // is NOT installed. In a dev environment that already has it the
            // assertion would be the wrong polarity, so skip cleanly.
            this.skip();
        }
        const fixture = setupRealWorkspace({
            runnersYamlContents: [
                "elf_file: zephyr/zephyr.elf",
                "gdb: /sdk/arm-zephyr-eabi-gdb",
                "runners:",
                "  - jlink",
                "args:",
                "  jlink:",
                "    - --device=nRF52840_xxAA",
                "    - --speed=4000",
                "",
            ].join("\n"),
        });
        try {
            const provider = new ZephyrIdeDebugConfigurationProvider(() => fixture.wsConfig, makeFakeContext());
            const result = await provider.resolveDebugConfiguration(
                undefined,
                { name: "Zephyr IDE: Debug", type: "zephyr-ide", request: "launch" } as vscode.DebugConfiguration,
            );
            assert.strictEqual(
                result,
                undefined,
                "Provider must abort with undefined when cortex-debug is not installed (so VS Code does not start a broken session).",
            );
        } finally {
            fixture.cleanup();
        }
    });

    /**
     * The heart of the request: when the prerequisites are in place, the
     * provider must emit a cortex-debug config so complete that any debug
     * failure would be hardware-related (probe not connected, target halted,
     * gdb-server port busy) — never a missing field or stale Zephyr-IDE
     * configuration.
     */
    test("jlink: produces a launch-ready cortex-debug config from real runners.yaml", async function () {
        if (!isCortexDebugInstalled) { this.skip(); }
        const fixture = setupRealWorkspace({
            runnersYamlContents: [
                "elf_file: zephyr/zephyr.elf",
                "gdb: /sdk/arm-zephyr-eabi-gdb",
                "runners:",
                "  - jlink",
                "debug-runner: jlink",
                "args:",
                "  jlink:",
                "    - --device=nRF52840_xxAA",
                "    - --speed=4000",
                "    - --iface=swd",
                "",
            ].join("\n"),
        });
        try {
            const provider = new ZephyrIdeDebugConfigurationProvider(() => fixture.wsConfig, makeFakeContext());
            const result = await provider.resolveDebugConfiguration(
                undefined,
                { name: "Zephyr IDE: Debug", type: "zephyr-ide", request: "launch" } as vscode.DebugConfiguration,
            ) as any;

            assert.ok(result, "provider must return a resolved cortex-debug config");
            assert.strictEqual(result.type, "cortex-debug");
            assert.strictEqual(result.request, "launch");
            assert.strictEqual(result.servertype, "jlink");
            assert.strictEqual(result.device, "nRF52840_xxAA",
                "JLink device must be extracted from runners.yaml (--device=…)");
            assert.strictEqual(result.interface, "swd",
                "JLink interface must be extracted from runners.yaml (--iface=…)");
            assert.ok(result.executable, "cortex-debug needs `executable` (the ELF) to start");
            assert.ok(result.gdbPath, "cortex-debug needs `gdbPath` to start the JLink/gdb pair");
            // rtos is a Zephyr-IDE value-add: jlink supports it and we set it.
            assert.strictEqual(result.rtos, "Zephyr",
                "Zephyr rtos awareness must be enabled for jlink (cortex-debug supports it)");
        } finally {
            fixture.cleanup();
        }
    });

    test("openocd: produces a launch-ready cortex-debug config (configFiles + searchDirs lifted)", async function () {
        if (!isCortexDebugInstalled) { this.skip(); }
        const fixture = setupRealWorkspace({
            runnersYamlContents: [
                "elf_file: zephyr/zephyr.elf",
                "gdb: /sdk/arm-zephyr-eabi-gdb",
                "runners:",
                "  - openocd",
                "debug-runner: openocd",
                "args:",
                "  openocd:",
                "    - --search",
                "    - /opt/openocd/share/openocd/scripts",
                "    - --config",
                "    - interface/stlink.cfg",
                "    - --config",
                "    - target/stm32f4x.cfg",
                "",
            ].join("\n"),
        });
        try {
            const provider = new ZephyrIdeDebugConfigurationProvider(() => fixture.wsConfig, makeFakeContext());
            const result = await provider.resolveDebugConfiguration(
                undefined,
                { name: "Zephyr IDE: Debug", type: "zephyr-ide", request: "launch" } as vscode.DebugConfiguration,
            ) as any;

            assert.ok(result);
            assert.strictEqual(result.servertype, "openocd");
            assert.ok(Array.isArray(result.configFiles) && result.configFiles.length >= 2,
                "configFiles must include both --config entries from runners.yaml");
            assert.ok(result.configFiles.includes("interface/stlink.cfg"));
            assert.ok(result.configFiles.includes("target/stm32f4x.cfg"));
            assert.ok(Array.isArray(result.searchDir) && result.searchDir.length >= 1,
                "searchDir must include the --search path from runners.yaml");
            assert.ok(result.executable && result.gdbPath);
            assert.strictEqual(result.rtos, "Zephyr",
                "openocd supports rtos=Zephyr and Zephyr-IDE must set it");
        } finally {
            fixture.cleanup();
        }
    });

    test("bmp without serial port -> provider refuses with actionable error instead of silently launching a broken session", async function () {
        if (!isCortexDebugInstalled) { this.skip(); }
        // BMP requires `BMPGDBSerialPort` to drive cortex-debug. If runners.yaml
        // doesn't provide it and the user hasn't set it explicitly, launching
        // would fail deep inside cortex-debug with a confusing message. The
        // provider catches that here so the user gets a clear note.
        const fixture = setupRealWorkspace({
            runnersYamlContents: [
                "elf_file: zephyr/zephyr.elf",
                "gdb: /sdk/arm-zephyr-eabi-gdb",
                "runners:",
                "  - blackmagicprobe",
                "debug-runner: blackmagicprobe",
                "args:",
                "  blackmagicprobe: []",
                "",
            ].join("\n"),
        });
        try {
            const provider = new ZephyrIdeDebugConfigurationProvider(() => fixture.wsConfig, makeFakeContext());
            const result = await provider.resolveDebugConfiguration(
                undefined,
                { name: "Zephyr IDE: Debug", type: "zephyr-ide", request: "launch" } as vscode.DebugConfiguration,
            );
            assert.strictEqual(result, undefined,
                "BMP debug without a serial port must NOT produce a half-baked cortex-debug config");
        } finally {
            fixture.cleanup();
        }
    });

    test("bmp with --gdb-serial in runners.yaml -> launch-ready cortex-debug config", async function () {
        if (!isCortexDebugInstalled) { this.skip(); }
        const fakePort = process.platform === "win32" ? "COM3" : "/dev/ttyACM0";
        const fixture = setupRealWorkspace({
            runnersYamlContents: [
                "elf_file: zephyr/zephyr.elf",
                "gdb: /sdk/arm-zephyr-eabi-gdb",
                "runners:",
                "  - blackmagicprobe",
                "debug-runner: blackmagicprobe",
                "args:",
                "  blackmagicprobe:",
                `    - --gdb-serial=${fakePort}`,
                "",
            ].join("\n"),
        });
        try {
            const provider = new ZephyrIdeDebugConfigurationProvider(() => fixture.wsConfig, makeFakeContext());
            const result = await provider.resolveDebugConfiguration(
                undefined,
                { name: "Zephyr IDE: Debug", type: "zephyr-ide", request: "launch" } as vscode.DebugConfiguration,
            ) as any;

            assert.ok(result, "BMP with a serial port must produce a usable cortex-debug config");
            assert.strictEqual(result.servertype, "bmp");
            assert.strictEqual(result.BMPGDBSerialPort, fakePort,
                "BMPGDBSerialPort must be lifted from runners.yaml --gdb-serial= so cortex-debug can connect");
            assert.ok(result.executable && result.gdbPath);
        } finally {
            fixture.cleanup();
        }
    });

    test("missing runners.yaml -> provider refuses (suggests Build Now, never returns a half-baked config)", async function () {
        if (!isCortexDebugInstalled) { this.skip(); }
        // Set up the workspace but DELETE the runners.yaml that setupRealWorkspace wrote.
        const fixture = setupRealWorkspace({ runnersYamlContents: "runners: []" });
        try {
            fs.rmSync(path.join(fixture.buildDir, "zephyr", "runners.yaml"));
            const provider = new ZephyrIdeDebugConfigurationProvider(() => fixture.wsConfig, makeFakeContext());
            const result = await provider.resolveDebugConfiguration(
                undefined,
                { name: "Zephyr IDE: Debug", type: "zephyr-ide", request: "launch" } as vscode.DebugConfiguration,
            );
            assert.strictEqual(result, undefined,
                "Missing runners.yaml must abort the debug session cleanly, not yield a broken cortex-debug config");
        } finally {
            fixture.cleanup();
        }
    });
});
