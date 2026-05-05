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
import * as vscode from "vscode";

import { backfillInitializedFlags, getPlatformStateKey, loadGlobalState } from "../setup_utilities/state-management";
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

/**
 * Minimal in-memory mock for `vscode.ExtensionContext` that is sufficient for
 * testing `loadGlobalState` / `setGlobalState`.  Only `globalState.get` and
 * `globalState.update` are used by those functions.
 *
 * The state is deep-copied via JSON round-trip (intentional: VS Code's
 * globalState persists data as JSON, so this mock accurately reflects the
 * real serialization boundary and would surface issues with non-serializable
 * values just as the real implementation would).
 */
function makeMockContext(initialState?: Record<string, any>): vscode.ExtensionContext {
  let stored: any = initialState !== undefined ? JSON.parse(JSON.stringify(initialState)) : undefined;
  return {
    globalState: {
      get: (_key: string) => stored,
      update: (_key: string, value: any) => {
        stored = JSON.parse(JSON.stringify(value));
        return Promise.resolve();
      },
      setKeysForSync: () => { },
      keys: () => [],
    },
  } as any as vscode.ExtensionContext;
}

/**
 * Read back the value that was last written to globalState via the mock.
 * Accesses the stored value through a fresh `get()` call so the assertion
 * reflects exactly what would be persisted between sessions.
 */
function getStoredState(ctx: vscode.ExtensionContext): any {
  return (ctx.globalState as any).get("zephyr-ide.state");
}

suite("Workspace State Migration Test Suite", () => {

  // ---------------------------------------------------------------------------
  // getPlatformStateKey
  // ---------------------------------------------------------------------------

  test("getPlatformStateKey returns a known platform identifier", () => {
    const key = getPlatformStateKey();
    const basePlatforms = ["windows", "linux", "macos", "unknown"];
    // Key is either "wsl", a plain base platform, or "<remoteName>-<platform>".
    // In the local test environment vscode.env.remoteName is undefined, so
    // the key should be exactly one of the base platforms (no prefix).
    // In a remote CI environment the key will have the "<remoteName>-<base>"
    // form — we validate the suffix matches a known platform in that case.
    const isValid =
      key === "wsl" ||
      basePlatforms.includes(key) ||
      basePlatforms.some(p => key.endsWith(`-${p}`) && key.length > p.length + 1);
    assert.ok(isValid, `Expected a valid platform state key, got: ${key}`);
  });

  test("getPlatformStateKey returns a consistent value on repeated calls", () => {
    const key1 = getPlatformStateKey();
    const key2 = getPlatformStateKey();
    assert.strictEqual(key1, key2, "getPlatformStateKey must be stable within the same process");
  });

  // ---------------------------------------------------------------------------
  // loadGlobalState – backward-compatibility migration
  // ---------------------------------------------------------------------------

  test("loadGlobalState migrates legacy flat fields into per-platform bucket", async () => {
    const platformKey = getPlatformStateKey();

    const ctx = makeMockContext({
      toolsAvailable: true,
      sdkInstalled: true,
      sdkVersion: "0.17.0",
      setupStateDictionary: {},
    });

    const config = await loadGlobalState(ctx);

    // Flat convenience fields on the returned config should reflect the legacy values.
    assert.strictEqual(config.toolsAvailable, true, "toolsAvailable should be migrated");
    assert.strictEqual(config.sdkInstalled, true, "sdkInstalled should be migrated");
    assert.strictEqual(config.sdkVersion, "0.17.0", "sdkVersion should be migrated");

    // The per-platform bucket must contain the migrated values.
    assert.ok(config.platformStates?.[platformKey], `platformStates["${platformKey}"] should exist`);
    assert.strictEqual(config.platformStates![platformKey].toolsAvailable, true);
    assert.strictEqual(config.platformStates![platformKey].sdkInstalled, true);
    assert.strictEqual(config.platformStates![platformKey].sdkVersion, "0.17.0");

    // The persisted state must NOT have legacy flat fields at the top level.
    const persisted = getStoredState(ctx) as any;
    assert.strictEqual(persisted.toolsAvailable, undefined, "top-level toolsAvailable must be removed after migration");
    assert.strictEqual(persisted.sdkInstalled, undefined, "top-level sdkInstalled must be removed after migration");
    assert.strictEqual(persisted.sdkVersion, undefined, "top-level sdkVersion must be removed after migration");
    assert.ok(persisted.platformStates?.[platformKey], "migrated bucket must be persisted");
  });

  test("loadGlobalState preserves other platforms' state when loading", async () => {
    const platformKey = getPlatformStateKey();
    // Pick a key that is guaranteed to differ from the current platform.
    const otherKey = platformKey === "windows" ? "linux" : "windows";

    const ctx = makeMockContext({
      setupStateDictionary: {},
      platformStates: {
        [otherKey]: {
          toolsAvailable: true,
          sdkInstalled: true,
          sdkVersion: "0.16.0",
        },
        [platformKey]: {
          toolsAvailable: false,
          sdkInstalled: false,
          sdkVersion: "0.17.0",
        },
      },
    });

    const config = await loadGlobalState(ctx);

    // Current platform's values should be loaded into the flat convenience fields.
    assert.strictEqual(config.toolsAvailable, false, "current platform toolsAvailable should be read");
    assert.strictEqual(config.sdkVersion, "0.17.0", "current platform sdkVersion should be read");

    // The other platform's bucket must be preserved intact.
    assert.strictEqual(
      config.platformStates?.[otherKey]?.toolsAvailable, true,
      "other platform toolsAvailable must not be modified"
    );
    assert.strictEqual(
      config.platformStates?.[otherKey]?.sdkVersion, "0.16.0",
      "other platform sdkVersion must not be modified"
    );

    // The persisted state must also retain the other platform's bucket.
    const persisted = getStoredState(ctx) as any;
    assert.strictEqual(persisted.platformStates?.[otherKey]?.toolsAvailable, true);
    assert.strictEqual(persisted.platformStates?.[otherKey]?.sdkVersion, "0.16.0");
  });

  test("loadGlobalState starts with empty platform state on first WSL/remote run", async () => {
    // Simulate a globalState that only has Windows data (no current-platform bucket).
    const platformKey = getPlatformStateKey();
    const differentKey = platformKey === "windows" ? "linux" : "windows";

    const ctx = makeMockContext({
      setupStateDictionary: {},
      platformStates: {
        [differentKey]: {
          toolsAvailable: true,
          sdkInstalled: true,
          sdkVersion: "0.17.0",
        },
      },
    });

    const config = await loadGlobalState(ctx);

    // The current platform bucket doesn't exist yet — all flags should be undefined.
    assert.strictEqual(config.toolsAvailable, undefined, "toolsAvailable should be undefined on first run");
    assert.strictEqual(config.sdkInstalled, undefined, "sdkInstalled should be undefined on first run");
    assert.strictEqual(config.sdkVersion, undefined, "sdkVersion should be undefined on first run");

    // The other platform's data must be untouched.
    assert.strictEqual(config.platformStates?.[differentKey]?.toolsAvailable, true);
  });

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
