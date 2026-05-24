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
 * orchestrator.  The per-RunnerConfig conversion is covered by the sibling
 * `runner-profile-migration.test.ts`; this suite focuses on:
 *
 *   - Multi-project fan-out and name-collision avoidance with pre-existing profiles.
 *   - `launchTarget` / `attachTarget` migrating to `localBinds` (not into the profile).
 *   - Already-bind (pre-release) runner configs being silently skipped.
 *   - Natural idempotency — the second call is a no-op because legacy fields are gone.
 */

import * as assert from "assert";
import * as fs from "fs-extra";
import * as os from "os";
import * as path from "upath";
import * as vscode from "vscode";

import {
  migrateLegacyRunnersToProfiles,
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
      // No version flag in the new design.
      assert.strictEqual(written.runnerProfilesMigrationVersion, undefined);

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

  test("launchTarget and attachTarget migrate to localBinds, not into the runner profile", async () => {
    const { tmpRoot, ws } = await setup({}, {
      app: {
        name: "app",
        buildConfigs: {
          dbg: {
            name: "dbg",
            runnerConfigs: { openocd: { name: "openocd", runner: "openocd" } },
            activeRunner: "openocd",
            launchTarget: "My Debug Config",
            attachTarget: "My Attach Config",
          },
        },
      },
    });

    try {
      await migrateLegacyRunnersToProfiles(makeFakeContext(), ws);

      const written = await fs.readJson(path.join(tmpRoot, ".vscode", "zephyr-ide.json"));
      const profiles: any[] = written.runnerProfiles ?? [];
      assert.strictEqual(profiles.length, 1, `expected one migrated profile, got ${JSON.stringify(profiles)}`);

      // Profile's debug and attach slots are auto — not populated from launchTarget/attachTarget.
      assert.deepStrictEqual(profiles[0].debug, { kind: "auto" });
      assert.deepStrictEqual(profiles[0].attach, { kind: "auto" });

      // launchTarget and attachTarget become localBinds in the project state.
      const localBinds = (ws as any).projectStates?.app?.buildStates?.dbg?.localBinds;
      assert.ok(localBinds, "expected localBinds to be set");
      assert.strictEqual(localBinds.debug, "My Debug Config");
      assert.strictEqual(localBinds.attach, "My Attach Config");

      // Legacy fields stripped from in-memory build.
      assert.strictEqual((ws.projects.app.buildConfigs.dbg as any).launchTarget, undefined);
      assert.strictEqual((ws.projects.app.buildConfigs.dbg as any).attachTarget, undefined);
    } finally {
      await fs.remove(tmpRoot);
    }
  });

  test("Auto/Zephyr IDE default and pinned launch/attach placeholders are NOT stored in localBinds", async () => {
    const { tmpRoot, ws } = await setup({}, {
      app: {
        name: "app",
        buildConfigs: {
          dbg: {
            name: "dbg",
            runnerConfigs: { openocd: { name: "openocd", runner: "openocd" } },
            activeRunner: "openocd",
            launchTarget: "Zephyr IDE: Debug",
            attachTarget: "Zephyr IDE: Attach",
          },
          dbgPinned: {
            name: "dbgPinned",
            runnerConfigs: { openocd: { name: "openocd", runner: "openocd" } },
            activeRunner: "openocd",
            launchTarget: "Zephyr IDE: Debug (openocd)",
            attachTarget: "Zephyr IDE: Attach (openocd)",
          },
          dbgAuto: {
            name: "dbgAuto",
            runnerConfigs: { openocd: { name: "openocd", runner: "openocd" } },
            activeRunner: "openocd",
            launchTarget: "Auto: openocd",
            attachTarget: "Auto: openocd",
          },
        },
      },
    });

    try {
      await migrateLegacyRunnersToProfiles(makeFakeContext(), ws);

      const localBinds = (ws as any).projectStates?.app?.buildStates?.dbg?.localBinds;
      const localBindsPinned = (ws as any).projectStates?.app?.buildStates?.dbgPinned?.localBinds;
      const localBindsAuto = (ws as any).projectStates?.app?.buildStates?.dbgAuto?.localBinds;
      // Auto-like placeholders must not be stored in localBinds — undefined is correct.
      assert.ok(!localBinds?.debug, `expected no localBinds.debug, got ${localBinds?.debug}`);
      assert.ok(!localBinds?.attach, `expected no localBinds.attach, got ${localBinds?.attach}`);
      assert.ok(!localBindsPinned?.debug, `expected no localBindsPinned.debug, got ${localBindsPinned?.debug}`);
      assert.ok(!localBindsPinned?.attach, `expected no localBindsPinned.attach, got ${localBindsPinned?.attach}`);
      assert.ok(!localBindsAuto?.debug, `expected no localBindsAuto.debug, got ${localBindsAuto?.debug}`);
      assert.ok(!localBindsAuto?.attach, `expected no localBindsAuto.attach, got ${localBindsAuto?.attach}`);
    } finally {
      await fs.remove(tmpRoot);
    }
  });

  test("build-only legacy target bindings (no runnerConfigs) migrate to localBinds", async () => {
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
      // One auto-flash profile is created because there are legacy target bindings.
      assert.strictEqual(profiles.length, 1, `expected one migrated profile, got ${JSON.stringify(profiles)}`);
      assert.deepStrictEqual(profiles[0].flash, { kind: "auto" });
      assert.deepStrictEqual(profiles[0].debug, { kind: "auto" });
      assert.deepStrictEqual(profiles[0].attach, { kind: "auto" });

      // launchTarget/attachTarget become localBinds.
      const localBinds = (ws as any).projectStates?.app?.buildStates?.dbg?.localBinds;
      assert.ok(localBinds, "expected localBinds");
      assert.strictEqual(localBinds.debug, "Debug Config");
      assert.strictEqual(localBinds.attach, "Attach Config");

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

  test("already-bind (pre-release) runner configs are silently skipped — no profile created", async () => {
    const { tmpRoot, ws } = await setup({}, {
      app: {
        name: "app",
        buildConfigs: {
          dbg: {
            name: "dbg",
            // Already-bind shape — pre-release format; must NOT be migrated.
            runnerConfigs: {
              openocd: {
                name: "openocd",
                flash: { kind: "west-flash", runner: "openocd" },
                debug: { kind: "auto" },
                attach: { kind: "auto" },
              },
            },
            activeRunner: "openocd",
          },
        },
      },
    });

    try {
      await migrateLegacyRunnersToProfiles(makeFakeContext(), ws);

      // File should not have been written (no new profiles, no version flag).
      const jsonPath = path.join(tmpRoot, ".vscode", "zephyr-ide.json");
      if (fs.pathExistsSync(jsonPath)) {
        const written = await fs.readJson(jsonPath);
        const profiles: any[] = written.runnerProfiles ?? [];
        assert.strictEqual(profiles.length, 0, "pre-release data should not produce profiles");
      }

      // In-memory shape left untouched.
      assert.ok(
        (ws.projects.app.buildConfigs.dbg as any).runnerConfigs,
        "already-bind runnerConfigs should not be stripped",
      );
      assert.strictEqual(ws.projects.app.buildConfigs.dbg.activeProfile, undefined);
    } finally {
      await fs.remove(tmpRoot);
    }
  });

  test("idempotent: second call with no legacy fields is a no-op (no duplicate profiles)", async () => {
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
      assert.strictEqual((after1.runnerProfiles as any[]).length, 1);

      // Call again — legacy fields were stripped, so no new profiles should appear.
      await migrateLegacyRunnersToProfiles(makeFakeContext(), ws);

      const after2 = await fs.readJson(path.join(tmpRoot, ".vscode", "zephyr-ide.json"));
      assert.deepStrictEqual(after2.runnerProfiles, after1.runnerProfiles,
        "second migration must not add duplicate profiles");
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
