/*
Copyright 2026 mylonics
Author Rijesh Augustine
SPDX-License-Identifier: Apache-2.0
*/

import * as assert from "assert";
import * as fs from "fs-extra";
import * as os from "os";
import * as path from "upath";

import { listSaveTargets } from "../panels/dashboard_view/kconfig-fragment";
import type { ProjectConfig } from "../project_utilities/project";
import type { BuildConfig } from "../project_utilities/build_selector";
import type { WorkspaceConfig } from "../setup_utilities/types";

// Minimal stub helpers so the test file does not need to construct full
// WorkspaceConfig / ProjectConfig / BuildConfig objects.

function makeWs(rootPath: string): WorkspaceConfig {
  return { rootPath } as unknown as WorkspaceConfig;
}

function makeProject(confFiles: ProjectConfig["confFiles"]): ProjectConfig {
  return {
    name: "app",
    rel_path: "app",
    buildConfigs: {},
    confFiles,
    twisterConfigs: {},
  };
}

function makeBuild(confFiles: BuildConfig["confFiles"]): BuildConfig {
  return {
    name: "build/debug",
    confFiles,
  } as unknown as BuildConfig;
}

suite("Kconfig Save Targets Test Suite", () => {
  test("listSaveTargets returns only extra .conf entries", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "zephyr-ide-save-targets-"));
    try {
      const ws = makeWs(tmp);
      const proj = makeProject({ config: [], overlay: [] });
      const bld = makeBuild({
        config: [
          { path: "app/prj.conf", extra: false },
          { path: "app/extra/dbg.conf", extra: true },
          { path: "app/foo.overlay", extra: true },
        ],
        overlay: [],
      });
      // Create one of the files so we can verify the `exists` flag.
      await fs.outputFile(path.join(tmp, "app/extra/dbg.conf"), "");

      const targets = listSaveTargets(ws, proj, bld);
      assert.strictEqual(targets.length, 1, "only extra .conf entries are kept");
      assert.strictEqual(targets[0].path, "app/extra/dbg.conf");
      assert.strictEqual(targets[0].scope, "build");
      assert.strictEqual(targets[0].exists, true);
      assert.strictEqual(
        path.normalize(targets[0].absPath),
        path.normalize(path.join(tmp, "app/extra/dbg.conf")),
      );
    } finally {
      await fs.remove(tmp);
    }
  });

  test("build-scope entries shadow project-scope entries with same path", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "zephyr-ide-save-targets-"));
    try {
      const ws = makeWs(tmp);
      const proj = makeProject({
        config: [
          { path: "app/extras/dashboard.conf", extra: true },
          { path: "app/extras/proj-only.conf", extra: true },
        ],
        overlay: [],
      });
      const bld = makeBuild({
        config: [
          { path: "app/extras/dashboard.conf", extra: true },
          { path: "app/extras/build-only.conf", extra: true },
        ],
        overlay: [],
      });

      const targets = listSaveTargets(ws, proj, bld);
      // build first, then de-dup'd project, then project-only.
      assert.deepStrictEqual(
        targets.map((t) => `${t.scope}:${t.path}`),
        [
          "build:app/extras/dashboard.conf",
          "build:app/extras/build-only.conf",
          "project:app/extras/proj-only.conf",
        ],
        "shared paths take the build scope",
      );
      // None of these files exist yet on disk.
      assert.ok(targets.every((t) => t.exists === false));
    } finally {
      await fs.remove(tmp);
    }
  });

  test("listSaveTargets returns empty array when no extras are attached", () => {
    const ws = makeWs("/no/such/dir");
    const proj = makeProject({
      config: [{ path: "app/prj.conf", extra: false }],
      overlay: [],
    });
    const bld = makeBuild({
      config: [{ path: "app/prj.conf", extra: false }],
      overlay: [],
    });
    const targets = listSaveTargets(ws, proj, bld);
    assert.strictEqual(targets.length, 0);
  });
});
