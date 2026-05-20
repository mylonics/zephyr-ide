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
      extraArgs: "--speed=4000",
    });
    assert.deepStrictEqual(profile.debug, { kind: "auto" });
    assert.deepStrictEqual(profile.attach, { kind: "auto" });
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

  test("buildState launch targets fold into debug + attach launch binds", () => {
    const legacy = { name: "openocd", runner: "openocd" };
    const buildState = {
      buildDebugTarget: "Zephyr GDB",
      attachTarget: "Zephyr Attach",
    };
    const profile = migrateRunnerConfig(legacy, buildState);
    assert.deepStrictEqual(profile.debug, { kind: "launch", name: "Zephyr GDB" });
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

  test("debug falls back to launchTarget when buildDebugTarget is missing", () => {
    const legacy = { name: "openocd", runner: "openocd" };
    const buildState = { launchTarget: "Custom Launch" };
    const profile = migrateRunnerConfig(legacy, buildState);
    assert.deepStrictEqual(profile.debug, { kind: "launch", name: "Custom Launch" });
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
  });

  test("already-bind shape: legacy buildDebug or build keys fold into debug", () => {
    const legacy = {
      name: "preview",
      flash: { kind: "auto" },
      buildDebug: { kind: "launch", name: "GDB" },
      attach: { kind: "launch", name: "ATTACH" },
    };
    const profile = migrateRunnerConfig(legacy, undefined);
    assert.deepStrictEqual(profile.debug, { kind: "launch", name: "GDB" });
    assert.deepStrictEqual(profile.attach, { kind: "launch", name: "ATTACH" });
  });
});
