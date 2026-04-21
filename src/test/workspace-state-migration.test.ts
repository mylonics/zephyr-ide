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
import * as fs from "fs-extra";
import * as os from "os";
import * as path from "upath";

import { backfillInitializedFlags } from "../setup_utilities/state-management";
import { SetupState } from "../setup_utilities/types";

function makeEntry(overrides: Partial<SetupState> = {}): SetupState {
  return {
    pythonEnvironmentSetup: false,
    westUpdated: false,
    packagesInstalled: false,
    zephyrDir: "",
    env: {},
    setupPath: "",
    ...overrides,
  };
}

suite("Workspace State Migration Test Suite", () => {

  test("backfillInitializedFlags sets initialized=true when .west/ exists on disk", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "zephyr-ide-bfill-true-"));
    try {
      await fs.ensureDir(path.join(tmpDir, ".west"));

      const entry = makeEntry({ initialized: undefined });
      const dict: Record<string, SetupState> = { [tmpDir]: entry };

      const changed = backfillInitializedFlags(dict);

      assert.strictEqual(changed, true, "should report a change");
      assert.strictEqual(dict[tmpDir].initialized, true, "initialized should be true when .west/ exists");
    } finally {
      await fs.remove(tmpDir);
    }
  });

  test("backfillInitializedFlags sets initialized=false when .west/ does not exist", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "zephyr-ide-bfill-false-"));
    try {
      // Do NOT create .west/
      const entry = makeEntry({ initialized: undefined });
      const dict: Record<string, SetupState> = { [tmpDir]: entry };

      const changed = backfillInitializedFlags(dict);

      assert.strictEqual(changed, true, "should report a change");
      assert.strictEqual(dict[tmpDir].initialized, false, "initialized should be false when .west/ is absent");
    } finally {
      await fs.remove(tmpDir);
    }
  });

  test("backfillInitializedFlags does not overwrite an already-true initialized flag", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "zephyr-ide-bfill-keep-true-"));
    try {
      // No .west/ on disk — but initialized is already explicitly true
      const entry = makeEntry({ initialized: true });
      const dict: Record<string, SetupState> = { [tmpDir]: entry };

      const changed = backfillInitializedFlags(dict);

      assert.strictEqual(changed, false, "should report no change");
      assert.strictEqual(dict[tmpDir].initialized, true, "pre-set true value must not be overwritten");
    } finally {
      await fs.remove(tmpDir);
    }
  });

  test("backfillInitializedFlags does not overwrite an already-false initialized flag", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "zephyr-ide-bfill-keep-false-"));
    try {
      await fs.ensureDir(path.join(tmpDir, ".west"));
      // .west/ exists on disk but initialized is already explicitly false (reset by user)
      const entry = makeEntry({ initialized: false });
      const dict: Record<string, SetupState> = { [tmpDir]: entry };

      const changed = backfillInitializedFlags(dict);

      assert.strictEqual(changed, false, "should report no change");
      assert.strictEqual(dict[tmpDir].initialized, false, "pre-set false value must not be overwritten");
    } finally {
      await fs.remove(tmpDir);
    }
  });

  test("backfillInitializedFlags handles multiple entries correctly", async () => {
    const tmpWithWest = await fs.mkdtemp(path.join(os.tmpdir(), "zephyr-ide-bfill-multi-a-"));
    const tmpNoWest = await fs.mkdtemp(path.join(os.tmpdir(), "zephyr-ide-bfill-multi-b-"));
    try {
      await fs.ensureDir(path.join(tmpWithWest, ".west"));

      const entryWithWest = makeEntry({ initialized: undefined });
      const entryNoWest = makeEntry({ initialized: undefined });
      const entryAlreadySet = makeEntry({ initialized: true });

      const dict: Record<string, SetupState> = {
        [tmpWithWest]: entryWithWest,
        [tmpNoWest]: entryNoWest,
        "/some/already/set/path": entryAlreadySet,
      };

      const changed = backfillInitializedFlags(dict);

      assert.strictEqual(changed, true, "should report change because two entries were backfilled");
      assert.strictEqual(dict[tmpWithWest].initialized, true, "entry with .west/ → true");
      assert.strictEqual(dict[tmpNoWest].initialized, false, "entry without .west/ → false");
      assert.strictEqual(dict["/some/already/set/path"].initialized, true, "pre-set entry is unchanged");
    } finally {
      await fs.remove(tmpWithWest);
      await fs.remove(tmpNoWest);
    }
  });

  test("backfillInitializedFlags returns false and leaves empty dictionary unchanged", () => {
    const dict: Record<string, SetupState> = {};
    const changed = backfillInitializedFlags(dict);
    assert.strictEqual(changed, false, "empty dictionary should produce no change");
  });
});
