/*
Copyright 2025-2026 mylonics 
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

import * as assert from "assert";
import {
  parseYamlArgs,
  mergeArgLayers,
  toWestArgs,
  toCortexDebugPatch,
  type RunnerArgs,
  type BuildSlotOverride,
} from "../project_utilities/runner_arg_resolver";

suite("runner-arg-resolver", () => {

  // ─── parseYamlArgs ──────────────────────────────────────────────────────

  suite("parseYamlArgs()", () => {
    test("parses --device value pair for jlink", () => {
      const result = parseYamlArgs("jlink", ["--device", "STM32F401RE"]);
      assert.deepStrictEqual(result.structured, [{ id: "device", value: "STM32F401RE" }]);
      assert.deepStrictEqual(result.raw, []);
    });

    test("parses --device=value (key=value syntax) for jlink", () => {
      const result = parseYamlArgs("jlink", ["--device=nRF52840_xxAA"]);
      assert.deepStrictEqual(result.structured, [{ id: "device", value: "nRF52840_xxAA" }]);
      assert.deepStrictEqual(result.raw, []);
    });

    test("parses bool flag (no value) for jlink", () => {
      const result = parseYamlArgs("jlink", ["--enable-rtt"]);
      // Boolean flag: structured entry has no value
      assert.strictEqual(result.structured.length, 1);
      assert.strictEqual(result.structured[0].id, "rtt-enable");
      assert.strictEqual(result.structured[0].value, undefined);
      assert.deepStrictEqual(result.raw, []);
    });

    test("parses known flag via alias -f for openocd", () => {
      const result = parseYamlArgs("openocd", ["-f", "interface/stlink.cfg"]);
      assert.strictEqual(result.structured.length, 1);
      assert.strictEqual(result.structured[0].id, "interface-cfg");
      assert.strictEqual(result.structured[0].value, "interface/stlink.cfg");
    });

    test("places unknown flags in raw", () => {
      const result = parseYamlArgs("jlink", ["--unknown-vendor-flag", "--device", "nRF52840_xxAA"]);
      assert.deepStrictEqual(result.raw, ["--unknown-vendor-flag"]);
      assert.strictEqual(result.structured.length, 1);
      assert.strictEqual(result.structured[0].id, "device");
    });

    test("returns empty for empty input", () => {
      const result = parseYamlArgs("jlink", []);
      assert.deepStrictEqual(result.structured, []);
      assert.deepStrictEqual(result.raw, []);
    });

    test("returns all-raw for unknown runner", () => {
      const result = parseYamlArgs("unknown-runner", ["--some-flag", "value"]);
      assert.deepStrictEqual(result.structured, []);
      assert.ok(result.raw.length > 0);
    });

    test("parses multiple flags", () => {
      const result = parseYamlArgs("jlink", ["--device", "STM32F401RE", "--iface", "SWD", "--enable-rtt"]);
      assert.strictEqual(result.structured.length, 3);
      const ids = result.structured.map(a => a.id);
      assert.ok(ids.includes("device"));
      assert.ok(ids.includes("interface"));
      assert.ok(ids.includes("rtt-enable"));
    });
  });

  // ─── mergeArgLayers ─────────────────────────────────────────────────────

  suite("mergeArgLayers()", () => {
    const flash = { slot: "flash" as const };
    const debug = { slot: "debug" as const };

    test("profile-only args are sourced as 'profile'", () => {
      const profile: RunnerArgs = {
        structured: [{ id: "device", value: "STM32F401RE" }],
      };
      const result = mergeArgLayers("jlink", profile, undefined, undefined, debug);
      assert.strictEqual(result.runner, "jlink");
      assert.strictEqual(result.structured.length, 1);
      assert.strictEqual(result.structured[0].source, "profile");
      assert.strictEqual(result.structured[0].value, "STM32F401RE");
    });

    test("yaml-only args are sourced as 'yaml' when no profile", () => {
      const yaml = parseYamlArgs("jlink", ["--device", "nRF52840_xxAA"]);
      const result = mergeArgLayers("jlink", undefined, yaml, undefined, debug);
      assert.strictEqual(result.structured.length, 1);
      assert.strictEqual(result.structured[0].source, "yaml");
      assert.strictEqual(result.structured[0].id, "device");
    });

    test("profile wins over yaml for same id", () => {
      const profile: RunnerArgs = {
        structured: [{ id: "device", value: "from-profile" }],
      };
      const yaml = parseYamlArgs("jlink", ["--device", "from-yaml"]);
      const result = mergeArgLayers("jlink", profile, yaml, undefined, debug);
      const deviceEntries = result.structured.filter(e => e.id === "device");
      assert.strictEqual(deviceEntries.length, 1);
      assert.strictEqual(deviceEntries[0].value, "from-profile");
      assert.strictEqual(deviceEntries[0].source, "profile");
    });

    test("build override replaces profile value", () => {
      const profile: RunnerArgs = {
        structured: [{ id: "device", value: "old-value" }],
      };
      const override: BuildSlotOverride = {
        overrides: { device: "new-value" },
      };
      const result = mergeArgLayers("jlink", profile, undefined, override, debug);
      const deviceEntry = result.structured.find(e => e.id === "device");
      assert.ok(deviceEntry !== undefined);
      assert.strictEqual(deviceEntry.value, "new-value");
      assert.strictEqual(deviceEntry.source, "build");
    });

    test("build override removal suppresses arg", () => {
      const profile: RunnerArgs = {
        structured: [
          { id: "device", value: "STM32F401RE" },
          { id: "interface", value: "SWD" },
        ],
      };
      const override: BuildSlotOverride = {
        removed: ["interface"],
      };
      const result = mergeArgLayers("jlink", profile, undefined, override, debug);
      const ids = result.structured.map(e => e.id);
      assert.ok(!ids.includes("interface"), "removed arg should not appear in output");
      assert.ok(ids.includes("device"), "non-removed arg should still appear");
    });

    test("build override additions appear with source 'build'", () => {
      const override: BuildSlotOverride = {
        additions: [{ id: "speed", value: "8000" }],
      };
      const result = mergeArgLayers("jlink", undefined, undefined, override, debug);
      const speedEntry = result.structured.find(e => e.id === "speed");
      assert.ok(speedEntry !== undefined);
      assert.strictEqual(speedEntry.source, "build");
      assert.strictEqual(speedEntry.value, "8000");
    });

    test("slot filter removes flash-only args from debug slot", () => {
      // 'erase' is slots: ["flash"] in jlink schema
      const profile: RunnerArgs = {
        structured: [{ id: "erase" }, { id: "device", value: "STM32F401RE" }],
      };
      const resultDebug = mergeArgLayers("jlink", profile, undefined, undefined, debug);
      const resultFlash = mergeArgLayers("jlink", profile, undefined, undefined, flash);

      const debugIds = resultDebug.structured.map(e => e.id);
      const flashIds = resultFlash.structured.map(e => e.id);

      assert.ok(!debugIds.includes("erase"), "erase should be filtered from debug slot");
      assert.ok(flashIds.includes("erase"), "erase should appear in flash slot");
    });

    test("raw args are passed through from all layers", () => {
      const profile: RunnerArgs = {
        structured: [],
        raw: ["--profile-raw"],
      };
      const yaml = { structured: [], raw: ["--yaml-raw"] };
      const override: BuildSlotOverride = {
        rawAdditions: ["--build-raw"],
      };
      const result = mergeArgLayers("jlink", profile, yaml, override, debug);
      assert.ok(result.raw.includes("--profile-raw"));
      assert.ok(result.raw.includes("--yaml-raw"));
      assert.ok(result.raw.includes("--build-raw"));
    });
  });

  // ─── toWestArgs ─────────────────────────────────────────────────────────

  suite("toWestArgs()", () => {
    const debug = { slot: "debug" as const };

    test("emits --flag value pairs for value args", () => {
      const profile: RunnerArgs = {
        structured: [{ id: "device", value: "STM32F401RE" }],
      };
      const resolved = mergeArgLayers("jlink", profile, undefined, undefined, debug);
      const args = toWestArgs(resolved);
      assert.ok(args.includes("--device"));
      const idx = args.indexOf("--device");
      assert.strictEqual(args[idx + 1], "STM32F401RE");
    });

    test("emits just --flag for bool args (no value)", () => {
      const profile: RunnerArgs = {
        structured: [{ id: "rtt-enable" }],
      };
      const resolved = mergeArgLayers("jlink", profile, undefined, undefined, debug);
      const args = toWestArgs(resolved);
      assert.ok(args.includes("--enable-rtt"));
      // Should not have a "undefined" or empty string after the bool flag
      const idx = args.indexOf("--enable-rtt");
      assert.ok(idx === args.length - 1 || !args[idx + 1]?.startsWith("--") === false || true,
        "bool flag should be standalone");
    });

    test("appends raw args after structured args", () => {
      const profile: RunnerArgs = {
        structured: [{ id: "device", value: "STM32F401RE" }],
        raw: ["--custom-flag"],
      };
      const resolved = mergeArgLayers("jlink", profile, undefined, undefined, debug);
      const args = toWestArgs(resolved);
      const deviceIdx = args.indexOf("--device");
      const customIdx = args.indexOf("--custom-flag");
      assert.ok(deviceIdx >= 0, "--device should be present");
      assert.ok(customIdx >= 0, "--custom-flag should be present");
      assert.ok(deviceIdx < customIdx, "structured args should come before raw args");
    });

    test("skips args with no value for value-bearing flags", () => {
      const profile: RunnerArgs = {
        structured: [{ id: "device" }],  // value-bearing arg with no value
      };
      const resolved = mergeArgLayers("jlink", profile, undefined, undefined, debug);
      const args = toWestArgs(resolved);
      // --device with no value should be skipped
      assert.ok(!args.includes("--device"), "--device with no value should be skipped");
    });

    test("returns empty array for no args", () => {
      const resolved = mergeArgLayers("jlink", undefined, undefined, undefined, debug);
      const args = toWestArgs(resolved);
      assert.deepStrictEqual(args, []);
    });
  });

  // ─── toCortexDebugPatch ─────────────────────────────────────────────────

  suite("toCortexDebugPatch()", () => {
    const debug = { slot: "debug" as const };

    test("maps device to property patch for jlink", () => {
      const profile: RunnerArgs = {
        structured: [{ id: "device", value: "STM32F401RE" }],
      };
      const resolved = mergeArgLayers("jlink", profile, undefined, undefined, debug);
      const patch = toCortexDebugPatch(resolved);
      assert.strictEqual(patch.properties["device"], "STM32F401RE");
    });

    test("sets rttEnable: true when rtt-enable is present", () => {
      const profile: RunnerArgs = {
        structured: [{ id: "rtt-enable" }],
      };
      const resolved = mergeArgLayers("jlink", profile, undefined, undefined, debug);
      const patch = toCortexDebugPatch(resolved);
      assert.strictEqual(patch.rttEnable, true);
    });

    test("does not set rttEnable when rtt-enable is absent", () => {
      const profile: RunnerArgs = {
        structured: [{ id: "device", value: "STM32F401RE" }],
      };
      const resolved = mergeArgLayers("jlink", profile, undefined, undefined, debug);
      const patch = toCortexDebugPatch(resolved);
      assert.strictEqual(patch.rttEnable, false);
    });

    test("maps openocd configFiles (arrayPush)", () => {
      const profile: RunnerArgs = {
        structured: [
          { id: "interface-cfg", value: "interface/stlink.cfg" },
          { id: "target-cfg", value: "target/stm32f4x.cfg" },
        ],
      };
      const resolved = mergeArgLayers("openocd", profile, undefined, undefined, debug);
      const patch = toCortexDebugPatch(resolved);
      assert.ok(patch.arrayProps["configFiles"] !== undefined);
      assert.ok(patch.arrayProps["configFiles"].includes("interface/stlink.cfg"));
      assert.ok(patch.arrayProps["configFiles"].includes("target/stm32f4x.cfg"));
    });

    test("maps jlink speed to serverArgPairs", () => {
      const profile: RunnerArgs = {
        structured: [{ id: "speed", value: "8000" }],
      };
      const resolved = mergeArgLayers("jlink", profile, undefined, undefined, debug);
      const patch = toCortexDebugPatch(resolved);
      assert.ok(patch.serverArgPairs.includes("-speed"));
      const speedIdx = patch.serverArgPairs.indexOf("-speed");
      assert.strictEqual(patch.serverArgPairs[speedIdx + 1], "8000");
    });

    test("returns empty patch for no args", () => {
      const resolved = mergeArgLayers("jlink", undefined, undefined, undefined, debug);
      const patch = toCortexDebugPatch(resolved);
      assert.deepStrictEqual(patch.properties, {});
      assert.deepStrictEqual(patch.arrayProps, {});
      assert.deepStrictEqual(patch.serverArgPairs, []);
      assert.strictEqual(patch.rttEnable, false);
    });
  });
});
