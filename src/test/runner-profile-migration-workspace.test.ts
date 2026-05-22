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
 * Integration tests for the workspace-level `migrateLegacyRunnersToProfiles`
 * orchestrator. The per-RunnerConfig conversion is covered by the sibling
 * `runner-profile-migration.test.ts`; this suite focuses on the multi-project
 * fan-out, name-collision avoidance with pre-existing profiles, and the
 * `runnerProfilesMigrationVersion` idempotency flag that prevents duplicate
 * `runner-2` / `runner-3` profiles from being appended on every load.
 */

import * as assert from "assert";
import * as fs from "fs-extra";
import * as os from "os";
import * as path from "upath";
import * as vscode from "vscode";

import {
  migrateLegacyRunnersToProfiles,
  RUNNER_PROFILES_MIGRATION_VERSION,
} from "../setup_utilities/state-management";
import { WorkspaceConfig } from "../setup_utilities/types";

/**
 * Minimal fake `vscode.ExtensionContext` that implements the only API
 * `setWorkspaceState` calls (`workspaceState.update`). We intentionally do not
 * stub the full surface — anything else the production code might reach for
 * should surface as a test failure rather than be silently masked.
 */
function makeFakeContext(): vscode.ExtensionContext {
  const memento: any = {
    get: () => undefined,
    update: async () => { /* no-op */ },
    keys: () => [] as readonly string[],
    setKeysForSync: () => { /* no-op */ },
  };
  return { workspaceState: memento } as unknown as vscode.ExtensionContext;
}

function makeWorkspaceConfig(rootPath: string, projects: Record<string, any>): WorkspaceConfig {
  return {
    rootPath,
    projects,
    activeSetupState: { initialized: true, setupPath: rootPath } as any,
    projectStates: {},
  } as unknown as WorkspaceConfig;
}

async function setup(legacyJson: Record<string, any>, projects: Record<string, any>) {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zephyr-ide-runprof-migr-"));
  const configDir = path.join(tmpRoot, ".vscode");
  await fs.ensureDir(configDir);
  await fs.writeJson(path.join(configDir, "zephyr-ide.json"), legacyJson);
  return { tmpRoot, ws: makeWorkspaceConfig(tmpRoot, projects) };
}

suite("Runner Profile Workspace Migration", () => {

  test("multi-project workspace: each build's activeRunner becomes its activeProfile and profiles are deduped", async () => {
    const { tmpRoot, ws } = await setup({}, {
      app1: {
        name: "app1",
        buildConfigs: {
          dbg: {
            name: "dbg",
            runnerConfigs: { openocd: { name: "openocd", runner: "openocd", args: "--speed=4000" } },
          },
        },
      },
      app2: {
        name: "app2",
        buildConfigs: {
          rel: {
            name: "rel",
            // Same name+runner+args as app1/dbg → should map to the same profile.
            runnerConfigs: { openocd: { name: "openocd", runner: "openocd", args: "--speed=4000" } },
          },
          dbg: {
            name: "dbg",
            runnerConfigs: { jlink: { name: "jlink", runner: "jlink" } },
          },
        },
      },
    });
    (ws.projects.app1.buildConfigs.dbg as any).activeRunner = "openocd";
    (ws.projects.app2.buildConfigs.rel as any).activeRunner = "openocd";
    (ws.projects.app2.buildConfigs.dbg as any).activeRunner = "jlink";

    try {
      await migrateLegacyRunnersToProfiles(makeFakeContext(), ws);

      const written = await fs.readJson(path.join(tmpRoot, ".vscode", "zephyr-ide.json"));
      assert.strictEqual(written.runnerProfilesMigrationVersion, RUNNER_PROFILES_MIGRATION_VERSION);

      const profiles: any[] = written.runnerProfiles ?? [];
      // Two distinct profiles: openocd (shared across three builds) and jlink.
      const names = profiles.map(p => p.name).sort();
      assert.deepStrictEqual(names, ["jlink", "openocd"]);

      assert.strictEqual(ws.projects.app1.buildConfigs.dbg.activeProfile, "openocd");
      assert.strictEqual(ws.projects.app2.buildConfigs.rel.activeProfile, "openocd");
      assert.strictEqual(ws.projects.app2.buildConfigs.dbg.activeProfile, "jlink");

      // Legacy fields stripped from in-memory shape.
      for (const proj of Object.values(ws.projects) as any[]) {
        for (const b of Object.values(proj.buildConfigs) as any[]) {
          assert.strictEqual(b.runnerConfigs, undefined, "legacy runnerConfigs should be stripped");
          assert.strictEqual(b.activeRunner, undefined, "legacy activeRunner should be stripped");
        }
      }
    } finally {
      await fs.remove(tmpRoot);
    }
  });

  test("pre-existing workspace profile with same name forces a unique suggestion", async () => {
    const { tmpRoot, ws } = await setup({
      runnerProfiles: [
        { name: "openocd", flash: { kind: "runner", runner: "openocd" }, debug: { kind: "auto" }, attach: { kind: "auto" } },
      ],
    }, {
      app: {
        name: "app",
        buildConfigs: {
          dbg: {
            name: "dbg",
            runnerConfigs: { openocd: { name: "openocd", runner: "openocd", args: "--speed=2000" } },
          },
        },
      },
    });
    (ws.projects.app.buildConfigs.dbg as any).activeRunner = "openocd";

    try {
      await migrateLegacyRunnersToProfiles(makeFakeContext(), ws);

      const written = await fs.readJson(path.join(tmpRoot, ".vscode", "zephyr-ide.json"));
      const names = (written.runnerProfiles as any[]).map(p => p.name).sort();
      // Pre-existing "openocd" preserved; new one renamed to avoid collision.
      assert.ok(names.includes("openocd"), `expected "openocd" preserved, got ${JSON.stringify(names)}`);
      assert.ok(names.some(n => n !== "openocd"), `expected a renamed duplicate, got ${JSON.stringify(names)}`);

      const renamed = names.find(n => n !== "openocd")!;
      assert.strictEqual(ws.projects.app.buildConfigs.dbg.activeProfile, renamed);
    } finally {
      await fs.remove(tmpRoot);
    }
  });

  test("build-only debug bindings still migrate into a bound auto profile", async () => {
    const { tmpRoot, ws } = await setup({}, {
      app: {
        name: "app",
        buildConfigs: {
          dbg: {
            name: "dbg",
            launchTarget: "Debug Config",
            buildDebugTarget: "Build Debug Config",
            attachTarget: "Attach Config",
          },
        },
      },
    });

    try {
      await migrateLegacyRunnersToProfiles(makeFakeContext(), ws);

      const written = await fs.readJson(path.join(tmpRoot, ".vscode", "zephyr-ide.json"));
      const profiles: any[] = written.runnerProfiles ?? [];
      assert.strictEqual(profiles.length, 1, `expected one migrated profile, got ${JSON.stringify(profiles)}`);
      assert.deepStrictEqual(profiles[0], {
        name: profiles[0].name,
        flash: { kind: "auto" },
        buildDebug: { kind: "launch", name: "Build Debug Config" },
        debug: { kind: "launch", name: "Debug Config" },
        attach: { kind: "launch", name: "Attach Config" },
      });
      assert.strictEqual(ws.projects.app.buildConfigs.dbg.activeProfile, profiles[0].name);
      assert.strictEqual((ws.projects.app.buildConfigs.dbg as any).launchTarget, undefined);
      assert.strictEqual((ws.projects.app.buildConfigs.dbg as any).buildDebugTarget, undefined);
      assert.strictEqual((ws.projects.app.buildConfigs.dbg as any).attachTarget, undefined);
    } finally {
      await fs.remove(tmpRoot);
    }
  });

  test("duplicate migrated profiles are combined by content even when legacy names differ", async () => {
    const { tmpRoot, ws } = await setup({}, {
      app1: {
        name: "app1",
        buildConfigs: {
          dbg: {
            name: "dbg",
            runnerConfigs: { probeA: { name: "probeA", runner: "openocd", args: "--speed=4000" } },
            activeRunner: "probeA",
          },
        },
      },
      app2: {
        name: "app2",
        buildConfigs: {
          dbg: {
            name: "dbg",
            runnerConfigs: { probeB: { name: "probeB", runner: "openocd", args: "--speed=4000" } },
            activeRunner: "probeB",
          },
        },
      },
    });

    try {
      await migrateLegacyRunnersToProfiles(makeFakeContext(), ws);

      const written = await fs.readJson(path.join(tmpRoot, ".vscode", "zephyr-ide.json"));
      const profiles: any[] = written.runnerProfiles ?? [];
      assert.strictEqual(profiles.length, 1, `expected one deduped profile, got ${JSON.stringify(profiles)}`);
      assert.strictEqual(ws.projects.app1.buildConfigs.dbg.activeProfile, profiles[0].name);
      assert.strictEqual(ws.projects.app2.buildConfigs.dbg.activeProfile, profiles[0].name);
    } finally {
      await fs.remove(tmpRoot);
    }
  });

  test("idempotent: a second migration after the version flag is set is a no-op", async () => {
    const { tmpRoot, ws } = await setup({}, {
      app: {
        name: "app",
        buildConfigs: {
          dbg: {
            name: "dbg",
            runnerConfigs: { openocd: { name: "openocd", runner: "openocd" } },
          },
        },
      },
    });
    (ws.projects.app.buildConfigs.dbg as any).activeRunner = "openocd";

    try {
      await migrateLegacyRunnersToProfiles(makeFakeContext(), ws);

      const after1 = await fs.readJson(path.join(tmpRoot, ".vscode", "zephyr-ide.json"));
      assert.strictEqual(after1.runnerProfilesMigrationVersion, RUNNER_PROFILES_MIGRATION_VERSION);
      assert.strictEqual((after1.runnerProfiles as any[]).length, 1);

      // Simulate a stale legacy field reappearing on the in-memory config
      // (e.g. user re-imported old data). With the version flag set, the
      // migration should short-circuit and NOT touch the file or create a
      // `runner-2` duplicate.
      (ws.projects.app.buildConfigs.dbg as any).runnerConfigs = { openocd: { name: "openocd", runner: "openocd" } };
      (ws.projects.app.buildConfigs.dbg as any).activeRunner = "openocd";
      await migrateLegacyRunnersToProfiles(makeFakeContext(), ws);

      const after2 = await fs.readJson(path.join(tmpRoot, ".vscode", "zephyr-ide.json"));
      assert.deepStrictEqual(after2.runnerProfiles, after1.runnerProfiles);
      // The in-memory legacy fields are also left as-is — the migration is gated.
      assert.notStrictEqual((ws.projects.app.buildConfigs.dbg as any).runnerConfigs, undefined);
    } finally {
      await fs.remove(tmpRoot);
    }
  });

  test("no-op migration on a clean workspace still stamps the version flag", async () => {
    const { tmpRoot, ws } = await setup({}, {
      app: { name: "app", buildConfigs: { dbg: { name: "dbg" } } },
    });
    try {
      await migrateLegacyRunnersToProfiles(makeFakeContext(), ws);
      const written = await fs.readJson(path.join(tmpRoot, ".vscode", "zephyr-ide.json"));
      assert.strictEqual(written.runnerProfilesMigrationVersion, RUNNER_PROFILES_MIGRATION_VERSION);
      assert.ok(!written.runnerProfiles || (written.runnerProfiles as any[]).length === 0);
    } finally {
      await fs.remove(tmpRoot);
    }
  });

  test("uninitialized workspace is skipped (no file written)", async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zephyr-ide-runprof-migr-uninit-"));
    try {
      const ws = {
        rootPath: tmpRoot,
        projects: {},
        // No activeSetupState → isActiveWorkspaceInitialized() === false
        projectStates: {},
      } as unknown as WorkspaceConfig;

      await migrateLegacyRunnersToProfiles(makeFakeContext(), ws);

      assert.strictEqual(
        fs.pathExistsSync(path.join(tmpRoot, ".vscode", "zephyr-ide.json")),
        false,
        "uninitialized workspace should not have zephyr-ide.json created",
      );
    } finally {
      await fs.remove(tmpRoot);
    }
  });
});
