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
 * Tests for the per-developer local runner profile override layer.
 *
 * Coverage:
 *  - `getEffectiveActiveProfileName` resolution precedence:
 *      local string > JSON / undefined means "use JSON"
 *      local null   = explicit "(none)" — suppresses workspace value
 *      absent field = fall through to BuildConfig.activeProfile
 *  - `setActiveProfile` writes to BuildState (workspace state) only; the
 *    build config (JSON-side) must remain unchanged.
 *  - `saveActiveProfileToWorkspace` copies effective name into BuildConfig
 *    and clears localActiveProfile.
 *  - `resetActiveProfileToWorkspace` deletes localActiveProfile; effective
 *    reverts to BuildConfig.activeProfile (JSON value).
 *  - `setWorkspaceActiveProfile` (workspace-direct path) writes BuildConfig
 *    and clears any stale local override.
 */

import * as assert from "assert";
import * as vscode from "vscode";
import {
  getEffectiveActiveProfileName,
  setActiveProfile,
  saveActiveProfileToWorkspace,
  resetActiveProfileToWorkspace,
  setWorkspaceActiveProfile,
} from "../project_utilities/project";
import { WorkspaceConfig } from "../setup_utilities/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFakeContext(): vscode.ExtensionContext {
  const store = new Map<string, unknown>();
  const memento: any = {
    get: (k: string, def?: unknown) => store.has(k) ? store.get(k) : def,
    update: async (k: string, v: unknown) => { store.set(k, v); },
    keys: () => Array.from(store.keys()) as readonly string[],
    setKeysForSync: () => { /* no-op */ },
  };
  return { workspaceState: memento, subscriptions: [] } as unknown as vscode.ExtensionContext;
}

/** Minimal WorkspaceConfig with one project, one build. */
function makeWsConfig(opts: {
  workspaceProfile?: string;
  localProfile?: string | null;
  /** Pass `false` to omit localActiveProfile entirely (no override field). */
  hasLocalField?: boolean;
}): WorkspaceConfig {
  const build: any = {
    name: "debug",
    board: "native_sim",
    relBoardDir: "",
    relBoardSubDir: "",
    debugOptimization: "Debug",
    westBuildArgs: [],
    westBuildCMakeArgs: [],
    confFiles: { extraConfig: [], extraOverlay: [] },
    activeProfile: opts.workspaceProfile,
  };

  const buildState: any = { viewOpen: true };
  if (opts.hasLocalField !== false) {
    // Only add the field when explicitly set or when a value is provided.
    if (opts.localProfile !== undefined) {
      buildState.localActiveProfile = opts.localProfile;
    }
    // If hasLocalField is explicitly true but no value, add undefined-keyed field.
    else if (opts.hasLocalField === true) {
      buildState.localActiveProfile = undefined;
    }
  }

  return {
    rootPath: "",
    activeProject: "myApp",
    activeSetupState: { initialized: true, setupPath: "" } as any,
    projects: {
      myApp: {
        name: "myApp",
        relPath: "app",
        buildConfigs: { debug: build },
        twisterConfigs: {},
        confFiles: { extraConfig: [], extraOverlay: [] },
        customVars: {},
      },
    },
    projectStates: {
      myApp: {
        activeBuildConfig: "debug",
        buildStates: { debug: buildState },
        twisterStates: {},
      },
    },
  } as unknown as WorkspaceConfig;
}

function makeResolved(wsConfig: WorkspaceConfig) {
  const project = wsConfig.projects["myApp"];
  const build = project.buildConfigs["debug"];
  return {
    projectName: "myApp",
    buildName: "debug",
    project,
    build,
  };
}

// ---------------------------------------------------------------------------
// getEffectiveActiveProfileName — resolution precedence
// ---------------------------------------------------------------------------

suite("runner-profile-local-override", () => {
  test("no override and no workspace profile → scope none, name undefined", () => {
    const ws = makeWsConfig({});
    const r = makeResolved(ws);
    const { name, scope } = getEffectiveActiveProfileName(ws, r);
    assert.strictEqual(name, undefined);
    assert.strictEqual(scope, "none");
  });

  test("workspace profile set, no local override → scope workspace", () => {
    const ws = makeWsConfig({ workspaceProfile: "jlink" });
    const r = makeResolved(ws);
    const { name, scope } = getEffectiveActiveProfileName(ws, r);
    assert.strictEqual(name, "jlink");
    assert.strictEqual(scope, "workspace");
  });

  test("local string override wins over workspace profile", () => {
    const ws = makeWsConfig({ workspaceProfile: "jlink", localProfile: "openocd" });
    const r = makeResolved(ws);
    const { name, scope } = getEffectiveActiveProfileName(ws, r);
    assert.strictEqual(name, "openocd");
    assert.strictEqual(scope, "local");
  });

  test("local null override suppresses workspace profile → scope local, name undefined", () => {
    const ws = makeWsConfig({ workspaceProfile: "jlink", localProfile: null });
    const r = makeResolved(ws);
    const { name, scope } = getEffectiveActiveProfileName(ws, r);
    assert.strictEqual(name, undefined);
    assert.strictEqual(scope, "local");
  });

  test("local string override with no workspace profile → scope local", () => {
    const ws = makeWsConfig({ localProfile: "pyocd" });
    const r = makeResolved(ws);
    const { name, scope } = getEffectiveActiveProfileName(ws, r);
    assert.strictEqual(name, "pyocd");
    assert.strictEqual(scope, "local");
  });

  // ---------------------------------------------------------------------------
  // setActiveProfile — writes BuildState only, JSON unchanged
  // ---------------------------------------------------------------------------

  test("setActiveProfile(name) writes localActiveProfile; BuildConfig.activeProfile unchanged", async () => {
    const ctx = makeFakeContext();
    const ws = makeWsConfig({ workspaceProfile: "jlink" });
    const buildConfig = ws.projects["myApp"].buildConfigs["debug"];
    await setActiveProfile(ctx, ws, "openocd");
    // BuildState should have the local override.
    const buildState = ws.projectStates["myApp"].buildStates["debug"] as any;
    assert.strictEqual(buildState.localActiveProfile, "openocd");
    // BuildConfig (JSON-side) must NOT have changed.
    assert.strictEqual(buildConfig.activeProfile, "jlink");
  });

  test("setActiveProfile(null) sets localActiveProfile to null (explicit none)", async () => {
    const ctx = makeFakeContext();
    const ws = makeWsConfig({ workspaceProfile: "jlink", localProfile: "openocd" });
    await setActiveProfile(ctx, ws, null);
    const buildState = ws.projectStates["myApp"].buildStates["debug"] as any;
    assert.strictEqual(buildState.localActiveProfile, null);
    // Workspace profile still set in JSON.
    assert.strictEqual(ws.projects["myApp"].buildConfigs["debug"].activeProfile, "jlink");
  });

  // ---------------------------------------------------------------------------
  // saveActiveProfileToWorkspace — promotes local → JSON, clears local
  // ---------------------------------------------------------------------------

  test("saveActiveProfileToWorkspace promotes local override into JSON and clears localActiveProfile", async () => {
    const ctx = makeFakeContext();
    const ws = makeWsConfig({ workspaceProfile: "jlink", localProfile: "openocd" });
    const buildConfig = ws.projects["myApp"].buildConfigs["debug"];
    await saveActiveProfileToWorkspace(ctx, ws);
    // JSON should now reflect the local choice.
    assert.strictEqual(buildConfig.activeProfile, "openocd");
    // Local override should be cleared.
    const buildState = ws.projectStates["myApp"].buildStates["debug"] as any;
    assert.strictEqual("localActiveProfile" in buildState, false);
  });

  test("saveActiveProfileToWorkspace with local null sets JSON to undefined", async () => {
    const ctx = makeFakeContext();
    const ws = makeWsConfig({ workspaceProfile: "jlink", localProfile: null });
    const buildConfig = ws.projects["myApp"].buildConfigs["debug"];
    await saveActiveProfileToWorkspace(ctx, ws);
    assert.strictEqual(buildConfig.activeProfile, undefined);
    const buildState = ws.projectStates["myApp"].buildStates["debug"] as any;
    assert.strictEqual("localActiveProfile" in buildState, false);
  });

  // ---------------------------------------------------------------------------
  // resetActiveProfileToWorkspace — clears local, effective reverts to JSON
  // ---------------------------------------------------------------------------

  test("resetActiveProfileToWorkspace clears localActiveProfile", async () => {
    const ctx = makeFakeContext();
    const ws = makeWsConfig({ workspaceProfile: "jlink", localProfile: "openocd" });
    await resetActiveProfileToWorkspace(ctx, ws);
    const buildState = ws.projectStates["myApp"].buildStates["debug"] as any;
    assert.strictEqual("localActiveProfile" in buildState, false);
    // Effective profile now comes from workspace JSON.
    const r = makeResolved(ws);
    const { name, scope } = getEffectiveActiveProfileName(ws, r);
    assert.strictEqual(name, "jlink");
    assert.strictEqual(scope, "workspace");
  });

  // ---------------------------------------------------------------------------
  // setWorkspaceActiveProfile — direct JSON write, clears stale local
  // ---------------------------------------------------------------------------

  test("setWorkspaceActiveProfile(name) writes BuildConfig.activeProfile and clears localActiveProfile", async () => {
    const ctx = makeFakeContext();
    const ws = makeWsConfig({ workspaceProfile: "jlink", localProfile: "openocd" });
    const buildConfig = ws.projects["myApp"].buildConfigs["debug"];
    await setWorkspaceActiveProfile(ctx, ws, "pyocd");
    assert.strictEqual(buildConfig.activeProfile, "pyocd");
    const buildState = ws.projectStates["myApp"].buildStates["debug"] as any;
    assert.strictEqual("localActiveProfile" in buildState, false);
  });

  test("setWorkspaceActiveProfile(null) clears JSON profile and local override", async () => {
    const ctx = makeFakeContext();
    const ws = makeWsConfig({ workspaceProfile: "jlink", localProfile: "openocd" });
    const buildConfig = ws.projects["myApp"].buildConfigs["debug"];
    await setWorkspaceActiveProfile(ctx, ws, null);
    assert.strictEqual(buildConfig.activeProfile, undefined);
    const buildState = ws.projectStates["myApp"].buildStates["debug"] as any;
    assert.strictEqual("localActiveProfile" in buildState, false);
  });

  // ---------------------------------------------------------------------------
  // Round-trip: setActiveProfile → resolution → saveActiveProfileToWorkspace
  // ---------------------------------------------------------------------------

  test("round-trip: set local, verify resolution, then save to workspace", async () => {
    const ctx = makeFakeContext();
    const ws = makeWsConfig({ workspaceProfile: "jlink" });
    const r = makeResolved(ws);

    // Step 1: select a local override.
    await setActiveProfile(ctx, ws, "nrfjprog");
    assert.strictEqual(getEffectiveActiveProfileName(ws, r).name, "nrfjprog");
    assert.strictEqual(getEffectiveActiveProfileName(ws, r).scope, "local");

    // Step 2: workspace JSON is still the old value.
    assert.strictEqual(ws.projects["myApp"].buildConfigs["debug"].activeProfile, "jlink");

    // Step 3: promote to workspace.
    await saveActiveProfileToWorkspace(ctx, ws);
    assert.strictEqual(ws.projects["myApp"].buildConfigs["debug"].activeProfile, "nrfjprog");
    assert.strictEqual(getEffectiveActiveProfileName(ws, r).scope, "workspace");
  });
});
