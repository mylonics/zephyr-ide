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

  test("pre-bind shape (runner + args) becomes a flash runner bind with extraArgs; debug/attach are auto", () => {
    const legacy = { name: "openocd-fast", runner: "openocd", args: "--speed=4000" };
    const profile = migrateRunnerConfig(legacy);
    assert.strictEqual(profile.name, "openocd-fast");
    assert.deepStrictEqual(profile.flash, {
      kind: "west-flash",
      runner: "openocd",
      extraArgs: ["--speed=4000"],
    });
    assert.deepStrictEqual(profile.debug, { kind: "auto" });
    assert.deepStrictEqual(profile.attach, { kind: "auto" });
    assert.strictEqual(profile.buildDebug, undefined);
  });

  test("pre-bind shape with no args omits extraArgs on the flash bind", () => {
    const legacy = { name: "jlink", runner: "jlink" };
    const profile = migrateRunnerConfig(legacy);
    assert.deepStrictEqual(profile.flash, { kind: "west-flash", runner: "jlink" });
    assert.deepStrictEqual(profile.debug, { kind: "auto" });
    assert.deepStrictEqual(profile.attach, { kind: "auto" });
  });

  test("missing runner falls back to auto flash bind", () => {
    const legacy = { name: "blank" };
    const profile = migrateRunnerConfig(legacy);
    assert.deepStrictEqual(profile.flash, { kind: "auto" });
    assert.deepStrictEqual(profile.debug, { kind: "auto" });
    assert.deepStrictEqual(profile.attach, { kind: "auto" });
    assert.strictEqual(profile.buildDebug, undefined);
  });

  test("null / undefined input produces an all-auto profile", () => {
    const profile = migrateRunnerConfig(undefined);
    assert.deepStrictEqual(profile.flash, { kind: "auto" });
    assert.deepStrictEqual(profile.debug, { kind: "auto" });
    assert.deepStrictEqual(profile.attach, { kind: "auto" });
  });
});

