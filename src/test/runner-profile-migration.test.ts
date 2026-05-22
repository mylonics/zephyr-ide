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

import * as assert from "assert";

import { migrateRunnerConfig } from "../setup_utilities/state-management";

suite("Runner Profile Migration Test Suite", () => {

  test("pre-bind shape (runner + args) becomes a flash runner bind with extraArgs", () => {
    const legacy = { name: "openocd-fast", runner: "openocd", args: "--speed=4000" };
    const profile = migrateRunnerConfig(legacy, undefined);
    assert.strictEqual(profile.name, "openocd-fast");
    assert.deepStrictEqual(profile.flash, {
      kind: "runner",
      runner: "openocd",
      extraArgs: ["--speed=4000"],
    });
    assert.deepStrictEqual(profile.debug, { kind: "auto" });
    assert.deepStrictEqual(profile.attach, { kind: "auto" });
    assert.strictEqual(profile.buildDebug, undefined);
  });

  test("pre-bind shape with no args omits extraArgs on the flash bind", () => {
    const legacy = { name: "jlink", runner: "jlink" };
    const profile = migrateRunnerConfig(legacy, undefined);
    assert.deepStrictEqual(profile.flash, { kind: "runner", runner: "jlink" });
  });

  test("missing runner falls back to auto flash bind", () => {
    const legacy = { name: "blank" };
    const profile = migrateRunnerConfig(legacy, undefined);
    assert.deepStrictEqual(profile.flash, { kind: "auto" });
  });

  test("buildState buildDebugTarget becomes buildDebug slot; launchTarget becomes debug slot", () => {
    const legacy = { name: "openocd", runner: "openocd" };
    const buildState = {
      buildDebugTarget: "Zephyr GDB",
      launchTarget: "Zephyr Debug",
      attachTarget: "Zephyr Attach",
    };
    const profile = migrateRunnerConfig(legacy, buildState);
    assert.deepStrictEqual(profile.buildDebug, { kind: "launch", name: "Zephyr GDB" });
    assert.deepStrictEqual(profile.debug, { kind: "launch", name: "Zephyr Debug" });
    assert.deepStrictEqual(profile.attach, { kind: "launch", name: "Zephyr Attach" });
  });

  test("buildState with only buildDebugTarget: debug defaults to auto", () => {
    const legacy = { name: "openocd", runner: "openocd" };
    const buildState = {
      buildDebugTarget: "Zephyr GDB",
      attachTarget: "Zephyr Attach",
    };
    const profile = migrateRunnerConfig(legacy, buildState);
    assert.deepStrictEqual(profile.buildDebug, { kind: "launch", name: "Zephyr GDB" });
    assert.deepStrictEqual(profile.debug, { kind: "auto" });
    assert.deepStrictEqual(profile.attach, { kind: "launch", name: "Zephyr Attach" });
  });

  test("legacy Auto:/Zephyr IDE: Debug placeholders map back to auto", () => {
    const legacy = { name: "openocd", runner: "openocd" };
    const buildState = {
      launchTarget: "Auto: openocd",
      attachTarget: "Zephyr IDE: Debug",
    };
    const profile = migrateRunnerConfig(legacy, buildState);
    assert.deepStrictEqual(profile.debug, { kind: "auto" });
    assert.deepStrictEqual(profile.attach, { kind: "auto" });
  });

  test("debug slot comes from launchTarget when buildDebugTarget is missing", () => {
    const legacy = { name: "openocd", runner: "openocd" };
    const buildState = { launchTarget: "Custom Launch" };
    const profile = migrateRunnerConfig(legacy, buildState);
    assert.deepStrictEqual(profile.debug, { kind: "launch", name: "Custom Launch" });
    assert.strictEqual(profile.buildDebug, undefined);
  });

  test("already-bind shape is normalised: missing slots default to auto", () => {
    const legacy = {
      name: "preview",
      flash: { kind: "runner", runner: "pyocd" },
    };
    const profile = migrateRunnerConfig(legacy, undefined);
    assert.deepStrictEqual(profile.flash, { kind: "runner", runner: "pyocd" });
    assert.deepStrictEqual(profile.debug, { kind: "auto" });
    assert.deepStrictEqual(profile.attach, { kind: "auto" });
    assert.strictEqual(profile.buildDebug, undefined);
  });

  test("already-bind shape: legacy buildDebug key is preserved as separate buildDebug slot", () => {
    const legacy = {
      name: "preview",
      flash: { kind: "auto" },
      buildDebug: { kind: "launch", name: "GDB" },
      attach: { kind: "launch", name: "ATTACH" },
    };
    const profile = migrateRunnerConfig(legacy, undefined);
    // buildDebug is preserved separately; debug defaults to auto (no separate debug key was set)
    assert.deepStrictEqual(profile.buildDebug, { kind: "launch", name: "GDB" });
    assert.deepStrictEqual(profile.debug, { kind: "auto" });
    assert.deepStrictEqual(profile.attach, { kind: "launch", name: "ATTACH" });
  });

  test("already-bind shape: explicit debug key is preserved as debug slot", () => {
    const legacy = {
      name: "preview",
      flash: { kind: "auto" },
      buildDebug: { kind: "launch", name: "Build GDB" },
      debug: { kind: "launch", name: "Debug Only" },
      attach: { kind: "launch", name: "ATTACH" },
    };
    const profile = migrateRunnerConfig(legacy, undefined);
    assert.deepStrictEqual(profile.buildDebug, { kind: "launch", name: "Build GDB" });
    assert.deepStrictEqual(profile.debug, { kind: "launch", name: "Debug Only" });
    assert.deepStrictEqual(profile.attach, { kind: "launch", name: "ATTACH" });
  });

  test("already-bind shape: legacy build key is preserved as buildDebug slot", () => {
    const legacy = {
      name: "preview",
      flash: { kind: "auto" },
      build: { kind: "launch", name: "Build GDB" },
      attach: { kind: "launch", name: "ATTACH" },
    };
    const profile = migrateRunnerConfig(legacy, undefined);
    assert.deepStrictEqual(profile.buildDebug, { kind: "launch", name: "Build GDB" });
    assert.deepStrictEqual(profile.debug, { kind: "auto" });
  });
});

suite("Runner Profile Migration v2 launch-entry translation", () => {
  test("openocd configs, unknown flags, jlink device, and bmp serial are translated", () => {
    const { legacyBindToLaunchConfig } = require("../setup_utilities/state-management") as typeof import("../setup_utilities/state-management");

    const openocd: any = legacyBindToLaunchConfig("Profile", "debug", {
      runner: "openocd",
      extraArgs: ["-f", "interface/jlink.cfg", "--mystery", "1", "--enable-rtt"],
    });
    assert.deepStrictEqual(openocd.configFiles, ["interface/jlink.cfg"]);
    assert.deepStrictEqual(openocd.westArgs, ["--mystery", "1"]);
    assert.strictEqual(openocd.rttConfig.enabled, true);

    const jlink: any = legacyBindToLaunchConfig("Profile", "debug", {
      runner: "jlink",
      extraArgs: ["--device=nrf", "--speed", "4000"],
    });
    assert.strictEqual(jlink.device, "nrf");
    assert.deepStrictEqual(jlink.serverArgs, ["-speed", "4000"]);

    const bmp: any = legacyBindToLaunchConfig("Profile", "attach", {
      runner: "blackmagicprobe",
      extraArgs: ["--gdb-serial", "/dev/ttyACM0"],
    });
    assert.strictEqual(bmp.BMPGDBSerialPort, "/dev/ttyACM0");
  });

  test("flash entries preserve legacy args as westArgs", () => {
    const { legacyBindToLaunchConfig } = require("../setup_utilities/state-management") as typeof import("../setup_utilities/state-management");
    const flash: any = legacyBindToLaunchConfig("Profile", "flash", {
      runner: "jlink",
      extraArgs: ["--erase"],
      args: { raw: ["--reset"] },
    });
    assert.strictEqual(flash.request, "flash");
    assert.strictEqual(flash.runner, "jlink");
    assert.deepStrictEqual(flash.westArgs, ["--erase", "--reset"]);
  });
});
