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
 * Unit tests for runner profile resolution logic in runner_profiles.ts.
 *
 * Coverage:
 *   - resolveBind: all bind kinds (auto / west-flash / west-debug / cortex-debug / launch),
 *     with and without per-build overrides.
 *   - formatBindLabel / formatOverrideLabel: human-readable label helpers.
 *   - resolveRunnerArgs: every supported variable kind:
 *       ${workspaceFolder}, ${buildFolder}, ${board}, ${boardRevision},
 *       ${project}, ${build}, ${buildvar:key}, ${projectvar:key},
 *       ${cmake:KEY}, ${kconfig:VAR}, ${env:VAR}, ${config:key} (skipped –
 *       requires VS Code config API), unknown expressions (passthrough).
 *   - readCmakeCacheVar (exercised indirectly through resolveRunnerArgs):
 *       KEY:TYPE=VALUE format, KEY=VALUE format, case-insensitive lookup,
 *       comment/blank-line skipping, missing file → empty string.
 *   - readKconfigVar (exercised indirectly through resolveRunnerArgs):
 *       string values (unquoted), boolean y/n, # KEY is not set → "n",
 *       CONFIG_ prefix optional, missing file → empty string.
 */

import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  resolveBind,
  formatBindLabel,
  formatOverrideLabel,
  resolveRunnerArgs,
  FlashBind,
  DebugBind,
  BindOverride,
  RunnerVarContext,
} from "../project_utilities/runner_profiles";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a throwaway temp directory and return helpers to write files and clean up. */
function makeTmpDir(): { dir: string; write: (rel: string, content: string) => void; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zide-rpr-"));
  return {
    dir,
    write(rel: string, content: string) {
      const abs = path.join(dir, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content, "utf8");
    },
    cleanup() {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
    },
  };
}

/** Build a minimal RunnerVarContext, merging any supplied overrides. */
function makeCtx(overrides: Partial<RunnerVarContext> & { buildFolder?: string } = {}): RunnerVarContext {
  return {
    workspaceFolder: "/ws",
    buildFolder: overrides.buildFolder ?? "/ws/myproject/mybuild",
    board: "nucleo_f401re",
    boardRevision: "",
    project: "myproject",
    build: "mybuild",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// resolveBind
// ---------------------------------------------------------------------------

suite("runner-profile-resolution: resolveBind", () => {

  test("auto bind → undefined (use runners.yaml defaults)", () => {
    const result = resolveBind({ kind: "auto" });
    assert.strictEqual(result, undefined);
  });

  test("launch bind → undefined (caller routes to launch.json)", () => {
    const result = resolveBind({ kind: "launch", name: "My Config" });
    assert.strictEqual(result, undefined);
  });

  test("cortex-debug bind → runner name returned, no args", () => {
    const result = resolveBind({ kind: "cortex-debug", runner: "openocd" });
    assert.ok(result);
    assert.strictEqual(result.runner, "openocd");
    assert.strictEqual(result.args, "");
  });

  test("west-flash bind with no extraArgs → empty args string", () => {
    const result = resolveBind({ kind: "west-flash", runner: "openocd" });
    assert.ok(result);
    assert.strictEqual(result.runner, "openocd");
    assert.strictEqual(result.args, "");
  });

  test("west-flash bind with extraArgs → args forwarded", () => {
    const result = resolveBind({ kind: "west-flash", runner: "jlink", extraArgs: ["--speed=4000"] });
    assert.ok(result);
    assert.strictEqual(result.args, "--speed=4000");
  });

  test("west-flash bind + override → args concatenated", () => {
    const bind: FlashBind = { kind: "west-flash", runner: "openocd", extraArgs: ["--config", "a.cfg"] };
    const override: BindOverride = { extraArgs: ["--cmd-pre-init", "reset_config"] };
    const result = resolveBind(bind, override);
    assert.ok(result);
    assert.strictEqual(result.args, "--config a.cfg --cmd-pre-init reset_config");
  });

  test("west-flash bind with only override extraArgs → override args only", () => {
    const bind: FlashBind = { kind: "west-flash", runner: "openocd" };
    const override: BindOverride = { extraArgs: ["--speed=4000"] };
    const result = resolveBind(bind, override);
    assert.ok(result);
    assert.strictEqual(result.args, "--speed=4000");
  });

  test("west-debug bind with extraArgs → runner + args", () => {
    const bind: DebugBind = { kind: "west-debug", runner: "nrfjprog", extraArgs: ["--snr", "12345"] };
    const result = resolveBind(bind);
    assert.ok(result);
    assert.strictEqual(result.runner, "nrfjprog");
    assert.strictEqual(result.args, "--snr 12345");
  });

  test("west-flash bind with whitespace-only extraArgs → trimmed, treated as empty", () => {
    const result = resolveBind({ kind: "west-flash", runner: "jlink", extraArgs: ["   "] });
    assert.ok(result);
    assert.strictEqual(result.args, "");
  });

  test("undefined bind → undefined", () => {
    assert.strictEqual(resolveBind(undefined), undefined);
  });

  test("auto bind ignores override", () => {
    const result = resolveBind({ kind: "auto" }, { extraArgs: ["--should-be-ignored"] });
    assert.strictEqual(result, undefined);
  });
});

// ---------------------------------------------------------------------------
// formatBindLabel
// ---------------------------------------------------------------------------

suite("runner-profile-resolution: formatBindLabel", () => {

  test("undefined → Auto fallback label", () => {
    assert.strictEqual(formatBindLabel(undefined), "Auto (runners.yaml)");
  });

  test("auto → Auto label", () => {
    assert.strictEqual(formatBindLabel({ kind: "auto" }), "Auto (runners.yaml)");
  });

  test("west-flash with no args → runner name only", () => {
    assert.strictEqual(formatBindLabel({ kind: "west-flash", runner: "jlink" }), "jlink");
  });

  test("west-flash with extraArgs → runner name + args", () => {
    assert.strictEqual(
      formatBindLabel({ kind: "west-flash", runner: "openocd", extraArgs: ["--speed=4000"] }),
      "openocd --speed=4000",
    );
  });

  test("west-flash with override only → runner name + override", () => {
    assert.strictEqual(
      formatBindLabel({ kind: "west-flash", runner: "openocd" }, { extraArgs: ["--speed=4000"] }),
      "openocd --speed=4000",
    );
  });

  test("west-flash with both extraArgs and override → both appended", () => {
    assert.strictEqual(
      formatBindLabel(
        { kind: "west-flash", runner: "openocd", extraArgs: ["--config", "a.cfg"] },
        { extraArgs: ["--speed=4000"] },
      ),
      "openocd --config a.cfg --speed=4000",
    );
  });

  test("cortex-debug → runner name", () => {
    assert.strictEqual(formatBindLabel({ kind: "cortex-debug", runner: "openocd" }), "openocd");
  });

  test("cortex-debug with RTT → runner name + RTT note", () => {
    assert.strictEqual(
      formatBindLabel({ kind: "cortex-debug", runner: "openocd", enableRtt: true }),
      "openocd (RTT)",
    );
  });

  test("cortex-debug with probe → runner name + probe note", () => {
    assert.strictEqual(
      formatBindLabel({ kind: "cortex-debug", runner: "openocd", probe: "interface/stlink.cfg" }),
      "openocd (probe: interface/stlink.cfg)",
    );
  });

  test("cortex-debug with RTT + probe → both in label", () => {
    assert.strictEqual(
      formatBindLabel({ kind: "cortex-debug", runner: "openocd", enableRtt: true, probe: "interface/stlink.cfg" }),
      "openocd (RTT, probe: interface/stlink.cfg)",
    );
  });

  test("west-debug → west-debug: prefix + runner", () => {
    assert.strictEqual(
      formatBindLabel({ kind: "west-debug", runner: "nrfjprog" }),
      "west-debug: nrfjprog",
    );
  });

  test("west-debug with extraArgs → runner + args", () => {
    assert.strictEqual(
      formatBindLabel({ kind: "west-debug", runner: "nrfjprog", extraArgs: ["--snr", "12345"] }),
      "west-debug: nrfjprog --snr 12345",
    );
  });

  test("launch → launch.json label", () => {
    assert.strictEqual(formatBindLabel({ kind: "launch", name: "My Config" }), "launch.json: My Config");
  });
});

// ---------------------------------------------------------------------------
// formatOverrideLabel
// ---------------------------------------------------------------------------

suite("runner-profile-resolution: formatOverrideLabel", () => {

  test("undefined override → empty string", () => {
    assert.strictEqual(formatOverrideLabel(undefined), "");
  });

  test("override with no extraArgs → empty string", () => {
    assert.strictEqual(formatOverrideLabel({}), "");
  });

  test("override with extraArgs → parenthesised suffix", () => {
    assert.strictEqual(formatOverrideLabel({ extraArgs: ["--speed=4000"] }), "(+ --speed=4000)");
  });

  test("override with whitespace-only extraArgs → empty string", () => {
    assert.strictEqual(formatOverrideLabel({ extraArgs: ["   "] }), "");
  });
});

// ---------------------------------------------------------------------------
// resolveRunnerArgs — static context variables
// ---------------------------------------------------------------------------

suite("runner-profile-resolution: resolveRunnerArgs static variables", () => {

  test("${workspaceFolder} substituted", () => {
    const ctx = makeCtx({ workspaceFolder: "/home/user/myws" });
    assert.strictEqual(resolveRunnerArgs("--root=${workspaceFolder}", ctx), "--root=/home/user/myws");
  });

  test("${buildFolder} substituted", () => {
    const ctx = makeCtx({ buildFolder: "/home/user/myws/app/debug" });
    assert.strictEqual(resolveRunnerArgs("--build=${buildFolder}", ctx), "--build=/home/user/myws/app/debug");
  });

  test("${board} substituted", () => {
    const ctx = makeCtx({ board: "nrf52840dk/nrf52840" });
    assert.strictEqual(resolveRunnerArgs("board=${board}", ctx), "board=nrf52840dk/nrf52840");
  });

  test("${boardRevision} substituted (empty when not set)", () => {
    const ctx = makeCtx({ boardRevision: "" });
    assert.strictEqual(resolveRunnerArgs("rev=${boardRevision}", ctx), "rev=");
  });

  test("${boardRevision} substituted when set", () => {
    const ctx = makeCtx({ boardRevision: "1.0" });
    assert.strictEqual(resolveRunnerArgs("rev=${boardRevision}", ctx), "rev=1.0");
  });

  test("${project} substituted", () => {
    const ctx = makeCtx({ project: "blinky" });
    assert.strictEqual(resolveRunnerArgs("proj=${project}", ctx), "proj=blinky");
  });

  test("${build} substituted", () => {
    const ctx = makeCtx({ build: "release" });
    assert.strictEqual(resolveRunnerArgs("build=${build}", ctx), "build=release");
  });

  test("multiple variables in one string", () => {
    const ctx = makeCtx({ workspaceFolder: "/ws", board: "stm32f4", build: "debug" });
    const result = resolveRunnerArgs("--ws=${workspaceFolder} --board=${board} --build=${build}", ctx);
    assert.strictEqual(result, "--ws=/ws --board=stm32f4 --build=debug");
  });

  test("no variables → string unchanged", () => {
    assert.strictEqual(resolveRunnerArgs("--speed=4000 --gdb-init reset", makeCtx()), "--speed=4000 --gdb-init reset");
  });

  test("empty string → empty string", () => {
    assert.strictEqual(resolveRunnerArgs("", makeCtx()), "");
  });

  test("unknown expression left intact (for VS Code's own resolver)", () => {
    assert.strictEqual(resolveRunnerArgs("${command:some.unknown}", makeCtx()), "${command:some.unknown}");
  });

  test("greedy outer match: ${...} spans to last } when unclosed braces present", () => {
    // The regex \$\{([^}]+)\} is greedy — when the string is
    //   "${workspaceFolder --board=${board}"
    // the `[^}]+` group consumes everything up to the final `}`, producing
    // the capture "workspaceFolder --board=${board" which is an unknown
    // expression and is left unchanged. The ${board} inside is NOT resolved
    // separately because it is consumed by the outer match.
    const ctx = makeCtx({ workspaceFolder: "/ws", board: "nrf52" });
    const result = resolveRunnerArgs("${workspaceFolder --board=${board}", ctx);
    assert.strictEqual(result, "${workspaceFolder --board=${board}");
  });
});

// ---------------------------------------------------------------------------
// resolveRunnerArgs — ${buildvar:key} and ${projectvar:key}
// ---------------------------------------------------------------------------

suite("runner-profile-resolution: resolveRunnerArgs custom vars", () => {

  test("${buildvar:key} resolved from buildVars", () => {
    const ctx = makeCtx({ buildVars: { bmp_port: "/dev/ttyACM0" } });
    assert.strictEqual(resolveRunnerArgs("--gdb-serial=${buildvar:bmp_port}", ctx), "--gdb-serial=/dev/ttyACM0");
  });

  test("${buildvar:key} missing from buildVars → empty string", () => {
    const ctx = makeCtx({ buildVars: {} });
    assert.strictEqual(resolveRunnerArgs("--gdb-serial=${buildvar:bmp_port}", ctx), "--gdb-serial=");
  });

  test("${buildvar:key} with no buildVars at all → empty string", () => {
    const ctx = makeCtx({ buildVars: undefined });
    assert.strictEqual(resolveRunnerArgs("--gdb-serial=${buildvar:bmp_port}", ctx), "--gdb-serial=");
  });

  test("${projectvar:key} resolved from projectVars", () => {
    const ctx = makeCtx({ projectVars: { shared_port: "/dev/ttyUSB0" } });
    assert.strictEqual(resolveRunnerArgs("--port=${projectvar:shared_port}", ctx), "--port=/dev/ttyUSB0");
  });

  test("${projectvar:key} missing from projectVars → empty string", () => {
    const ctx = makeCtx({ projectVars: {} });
    assert.strictEqual(resolveRunnerArgs("--port=${projectvar:shared_port}", ctx), "--port=");
  });

  test("buildvar and projectvar both present in same string", () => {
    const ctx = makeCtx({
      buildVars: { bmp_port: "/dev/ttyACM0" },
      projectVars: { speed: "4000" },
    });
    const result = resolveRunnerArgs("--gdb-serial=${buildvar:bmp_port} --speed=${projectvar:speed}", ctx);
    assert.strictEqual(result, "--gdb-serial=/dev/ttyACM0 --speed=4000");
  });

  test("buildvar key with special characters preserved", () => {
    const ctx = makeCtx({ buildVars: { "my-key_1": "val" } });
    assert.strictEqual(resolveRunnerArgs("${buildvar:my-key_1}", ctx), "val");
  });
});

// ---------------------------------------------------------------------------
// resolveRunnerArgs — ${env:VAR}
// ---------------------------------------------------------------------------

suite("runner-profile-resolution: resolveRunnerArgs env vars", () => {

  test("${env:VAR} resolved from process.env", () => {
    process.env["__ZIDE_TEST_VAR__"] = "hello_from_env";
    try {
      const result = resolveRunnerArgs("--token=${env:__ZIDE_TEST_VAR__}", makeCtx());
      assert.strictEqual(result, "--token=hello_from_env");
    } finally {
      delete process.env["__ZIDE_TEST_VAR__"];
    }
  });

  test("${env:MISSING_VAR} → empty string when unset", () => {
    delete process.env["__ZIDE_MISSING_VAR__"];
    const result = resolveRunnerArgs("--token=${env:__ZIDE_MISSING_VAR__}", makeCtx());
    assert.strictEqual(result, "--token=");
  });
});

// ---------------------------------------------------------------------------
// resolveRunnerArgs — ${cmake:KEY} (reads CMakeCache.txt)
// ---------------------------------------------------------------------------

suite("runner-profile-resolution: resolveRunnerArgs cmake vars", () => {

  test("${cmake:KEY} resolved from CMakeCache.txt (KEY:TYPE=VALUE format)", () => {
    const tmp = makeTmpDir();
    try {
      tmp.write("CMakeCache.txt", [
        "# This is a CMake cache file.",
        "//Comment line",
        "",
        "CMAKE_GDB:FILEPATH=/sdk/arm-zephyr-eabi/bin/arm-zephyr-eabi-gdb",
        "BOARD:STRING=nucleo_f401re",
        "TEST_PORT:STRING=/dev/ttyACM1",
      ].join("\n"));
      const ctx = makeCtx({ buildFolder: tmp.dir });
      assert.strictEqual(resolveRunnerArgs("--port=${cmake:TEST_PORT}", ctx), "--port=/dev/ttyACM1");
    } finally {
      tmp.cleanup();
    }
  });

  test("${cmake:KEY} resolved (KEY=VALUE format, no type)", () => {
    const tmp = makeTmpDir();
    try {
      tmp.write("CMakeCache.txt", "MY_PORT=/dev/ttyUSB5\n");
      const ctx = makeCtx({ buildFolder: tmp.dir });
      assert.strictEqual(resolveRunnerArgs("${cmake:MY_PORT}", ctx), "/dev/ttyUSB5");
    } finally {
      tmp.cleanup();
    }
  });

  test("${cmake:KEY} lookup is case-insensitive", () => {
    const tmp = makeTmpDir();
    try {
      tmp.write("CMakeCache.txt", "BOARD:STRING=nrf52840\n");
      const ctx = makeCtx({ buildFolder: tmp.dir });
      assert.strictEqual(resolveRunnerArgs("${cmake:board}", ctx), "nrf52840");
    } finally {
      tmp.cleanup();
    }
  });

  test("${cmake:MISSING_KEY} → empty string", () => {
    const tmp = makeTmpDir();
    try {
      tmp.write("CMakeCache.txt", "BOARD:STRING=nrf52840\n");
      const ctx = makeCtx({ buildFolder: tmp.dir });
      assert.strictEqual(resolveRunnerArgs("${cmake:NO_SUCH_KEY}", ctx), "");
    } finally {
      tmp.cleanup();
    }
  });

  test("${cmake:KEY} → empty string when CMakeCache.txt is absent", () => {
    const tmp = makeTmpDir();
    try {
      const ctx = makeCtx({ buildFolder: tmp.dir });
      assert.strictEqual(resolveRunnerArgs("${cmake:BOARD}", ctx), "");
    } finally {
      tmp.cleanup();
    }
  });

  test("cmake comment and blank lines are skipped", () => {
    const tmp = makeTmpDir();
    try {
      tmp.write("CMakeCache.txt", [
        "# comment",
        "//another comment",
        "",
        "KEY:STRING=value",
      ].join("\n"));
      const ctx = makeCtx({ buildFolder: tmp.dir });
      assert.strictEqual(resolveRunnerArgs("${cmake:KEY}", ctx), "value");
    } finally {
      tmp.cleanup();
    }
  });

  test("cmake value containing = sign is preserved", () => {
    const tmp = makeTmpDir();
    try {
      tmp.write("CMakeCache.txt", "EXTRA_FLAGS:STRING=-DFOO=1 -DBAR=2\n");
      const ctx = makeCtx({ buildFolder: tmp.dir });
      assert.strictEqual(resolveRunnerArgs("${cmake:EXTRA_FLAGS}", ctx), "-DFOO=1 -DBAR=2");
    } finally {
      tmp.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// resolveRunnerArgs — ${kconfig:VAR} (reads zephyr/.config)
// ---------------------------------------------------------------------------

suite("runner-profile-resolution: resolveRunnerArgs kconfig vars", () => {

  test("${kconfig:CONFIG_VAR} with CONFIG_ prefix resolved", () => {
    const tmp = makeTmpDir();
    try {
      tmp.write(path.join("zephyr", ".config"), [
        "# Zephyr kernel configuration",
        "CONFIG_UART_SHELL_ON_DEV_NAME=\"UART_0\"",
        "CONFIG_BOARD_BMP_GDB_PORT=\"/dev/ttyACM0\"",
      ].join("\n"));
      const ctx = makeCtx({ buildFolder: tmp.dir });
      assert.strictEqual(
        resolveRunnerArgs("--gdb-serial=${kconfig:CONFIG_BOARD_BMP_GDB_PORT}", ctx),
        "--gdb-serial=/dev/ttyACM0",
      );
    } finally {
      tmp.cleanup();
    }
  });

  test("${kconfig:VAR} without CONFIG_ prefix resolved (prefix added automatically)", () => {
    const tmp = makeTmpDir();
    try {
      tmp.write(path.join("zephyr", ".config"), "CONFIG_BMP_PORT=\"/dev/ttyACM1\"\n");
      const ctx = makeCtx({ buildFolder: tmp.dir });
      assert.strictEqual(resolveRunnerArgs("${kconfig:BMP_PORT}", ctx), "/dev/ttyACM1");
    } finally {
      tmp.cleanup();
    }
  });

  test("kconfig string value has surrounding quotes stripped", () => {
    const tmp = makeTmpDir();
    try {
      tmp.write(path.join("zephyr", ".config"), "CONFIG_MY_STR=\"hello world\"\n");
      const ctx = makeCtx({ buildFolder: tmp.dir });
      assert.strictEqual(resolveRunnerArgs("${kconfig:MY_STR}", ctx), "hello world");
    } finally {
      tmp.cleanup();
    }
  });

  test("kconfig boolean y value resolved as-is", () => {
    const tmp = makeTmpDir();
    try {
      tmp.write(path.join("zephyr", ".config"), "CONFIG_USB_DEVICE_STACK=y\n");
      const ctx = makeCtx({ buildFolder: tmp.dir });
      assert.strictEqual(resolveRunnerArgs("${kconfig:USB_DEVICE_STACK}", ctx), "y");
    } finally {
      tmp.cleanup();
    }
  });

  test("kconfig '# CONFIG_X is not set' line → 'n'", () => {
    const tmp = makeTmpDir();
    try {
      tmp.write(path.join("zephyr", ".config"), "# CONFIG_USB_DEVICE_STACK is not set\n");
      const ctx = makeCtx({ buildFolder: tmp.dir });
      assert.strictEqual(resolveRunnerArgs("${kconfig:USB_DEVICE_STACK}", ctx), "n");
    } finally {
      tmp.cleanup();
    }
  });

  test("${kconfig:MISSING_VAR} → empty string when key not in .config", () => {
    const tmp = makeTmpDir();
    try {
      tmp.write(path.join("zephyr", ".config"), "CONFIG_OTHER=y\n");
      const ctx = makeCtx({ buildFolder: tmp.dir });
      assert.strictEqual(resolveRunnerArgs("${kconfig:MISSING}", ctx), "");
    } finally {
      tmp.cleanup();
    }
  });

  test("${kconfig:VAR} → empty string when .config file is absent", () => {
    const tmp = makeTmpDir();
    try {
      const ctx = makeCtx({ buildFolder: tmp.dir });
      assert.strictEqual(resolveRunnerArgs("${kconfig:BOARD}", ctx), "");
    } finally {
      tmp.cleanup();
    }
  });

  test("kconfig hex value (no quotes) resolved as-is", () => {
    const tmp = makeTmpDir();
    try {
      tmp.write(path.join("zephyr", ".config"), "CONFIG_SRAM_BASE_ADDRESS=0x20000000\n");
      const ctx = makeCtx({ buildFolder: tmp.dir });
      assert.strictEqual(resolveRunnerArgs("${kconfig:SRAM_BASE_ADDRESS}", ctx), "0x20000000");
    } finally {
      tmp.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// resolveRunnerArgs — combined real-world-style usage
// ---------------------------------------------------------------------------

suite("runner-profile-resolution: resolveRunnerArgs integration scenarios", () => {

  test("BMP serial port from buildvar: --gdb-serial=${buildvar:bmp_port}", () => {
    const ctx = makeCtx({ buildVars: { bmp_port: "/dev/ttyACM0" } });
    const result = resolveRunnerArgs("--gdb-serial=${buildvar:bmp_port}", ctx);
    assert.strictEqual(result, "--gdb-serial=/dev/ttyACM0");
  });

  test("BMP serial port from kconfig", () => {
    const tmp = makeTmpDir();
    try {
      tmp.write(path.join("zephyr", ".config"), "CONFIG_BMP_GDB_PORT=\"/dev/ttyACM2\"\n");
      const ctx = makeCtx({ buildFolder: tmp.dir });
      const result = resolveRunnerArgs("--gdb-serial=${kconfig:BMP_GDB_PORT}", ctx);
      assert.strictEqual(result, "--gdb-serial=/dev/ttyACM2");
    } finally {
      tmp.cleanup();
    }
  });

  test("BMP serial port from cmake cache variable", () => {
    const tmp = makeTmpDir();
    try {
      tmp.write("CMakeCache.txt", "BMP_GDB_SERIAL:STRING=/dev/ttyACM3\n");
      const ctx = makeCtx({ buildFolder: tmp.dir });
      const result = resolveRunnerArgs("--gdb-serial=${cmake:BMP_GDB_SERIAL}", ctx);
      assert.strictEqual(result, "--gdb-serial=/dev/ttyACM3");
    } finally {
      tmp.cleanup();
    }
  });

  test("mixed static + cmake + buildvar in single arg string", () => {
    const tmp = makeTmpDir();
    try {
      tmp.write("CMakeCache.txt", "JLINK_SPEED:STRING=4000\n");
      const ctx = makeCtx({
        buildFolder: tmp.dir,
        board: "nrf52840dk",
        buildVars: { device: "nRF52840_xxAA" },
      });
      const result = resolveRunnerArgs(
        "--device=${buildvar:device} --speed=${cmake:JLINK_SPEED} --board=${board}",
        ctx,
      );
      assert.strictEqual(result, "--device=nRF52840_xxAA --speed=4000 --board=nrf52840dk");
    } finally {
      tmp.cleanup();
    }
  });

  test("unknown VS Code variable passed through for deferred resolution", () => {
    const ctx = makeCtx();
    const result = resolveRunnerArgs("--elf=${command:zephyr-ide.get-zephyr-elf}", ctx);
    assert.strictEqual(result, "--elf=${command:zephyr-ide.get-zephyr-elf}");
  });
});
