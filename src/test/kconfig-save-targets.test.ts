/*
Copyright 2026 mylonics
Author Rijesh Augustine
SPDX-License-Identifier: Apache-2.0
*/

import * as assert from "assert";
import * as fs from "fs-extra";
import * as os from "os";
import * as path from "upath";

import { listSaveTargets, mergeFragmentContent } from "../panels/dashboard_view/kconfig-fragment";
import type { KconfigChange } from "../panels/dashboard_view/DashboardPanel";
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

function makeBuild(confFiles: BuildConfig["confFiles"], name = "build/debug"): BuildConfig {
  return {
    name,
    confFiles,
  } as unknown as BuildConfig;
}

suite("Kconfig Save Targets Test Suite", () => {
  // ── listSaveTargets ──────────────────────────────────────────────────────

  test("listSaveTargets includes override (extra=false) .conf entries", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "zephyr-ide-save-targets-"));
    try {
      const ws = makeWs(tmp);
      const proj = makeProject({ config: [], overlay: [] });
      const bld = makeBuild({
        config: [
          { path: "app/prj.conf", extra: false },
          { path: "app/extra/dbg.conf", extra: true },
          { path: "app/foo.overlay", extra: true }, // excluded — not .conf
        ],
        overlay: [],
      });
      // Create one of the files so we can verify the `exists` flag.
      await fs.outputFile(path.join(tmp, "app/extra/dbg.conf"), "");

      const targets = listSaveTargets(ws, proj, bld);
      // Both .conf files returned (prj.conf override + dbg.conf extra); overlay excluded.
      assert.strictEqual(targets.length, 2, "both .conf entries are included");

      const override = targets.find((t) => t.path === "app/prj.conf");
      assert.ok(override, "prj.conf override entry present");
      assert.strictEqual(override?.kind, "override");
      assert.strictEqual(override?.attached, true);
      assert.strictEqual(override?.scope, "build");
      assert.strictEqual(override?.exists, false);

      const extra = targets.find((t) => t.path === "app/extra/dbg.conf");
      assert.ok(extra, "dbg.conf extra entry present");
      assert.strictEqual(extra?.kind, "extra");
      assert.strictEqual(extra?.attached, true);
      assert.strictEqual(extra?.scope, "build");
      assert.strictEqual(extra?.exists, true);
      assert.strictEqual(
        path.normalize(extra!.absPath),
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
      // All are `extra` kind with `attached: true`
      assert.ok(targets.every((t) => t.kind === "extra"));
      assert.ok(targets.every((t) => t.attached === true));
    } finally {
      await fs.remove(tmp);
    }
  });

  test("listSaveTargets returns override when only non-extra conf is attached", () => {
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
    // prj.conf (extra=false) is now returned as override — NOT 0.
    assert.strictEqual(targets.length, 1);
    assert.strictEqual(targets[0].path, "app/prj.conf");
    assert.strictEqual(targets[0].kind, "override");
    assert.strictEqual(targets[0].attached, true);
  });

  test("listSaveTargets excludes paths outside workspace root", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "zephyr-ide-save-targets-"));
    try {
      const ws = makeWs(tmp);
      const proj = makeProject({ config: [], overlay: [] });
      const bld = makeBuild({
        config: [
          // absolute path inside workspace
          { path: "app/frag.conf", extra: true },
        ],
        overlay: [],
      });

      // Write a build_info.yml that references a file OUTSIDE the workspace
      // root (e.g., a board .conf from the Zephyr tree).
      const buildFolder = path.join(tmp, "app/build/debug");
      await fs.ensureDir(buildFolder);
      await fs.writeFile(
        path.join(buildFolder, "build_info.yml"),
        `cmake:\n  kconfig:\n    files:\n      - /some/external/path/board.conf\n    user-files: []\n`,
      );

      const targets = listSaveTargets(ws, proj, bld);
      // Only the workspace-relative frag.conf; the external board.conf is excluded.
      assert.strictEqual(targets.length, 1);
      assert.strictEqual(targets[0].path, "app/frag.conf");
    } finally {
      await fs.remove(tmp);
    }
  });

  test("listSaveTargets excludes paths inside the build folder", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "zephyr-ide-save-targets-"));
    try {
      const ws = makeWs(tmp);
      const proj = makeProject({ config: [], overlay: [] });
      const bld = makeBuild({ config: [], overlay: [] });

      const buildFolder = path.join(tmp, "app/build/debug");
      await fs.ensureDir(buildFolder);
      // File inside the build folder — should be excluded
      const insideBuild = path.join(buildFolder, "autoconf.conf");
      await fs.outputFile(insideBuild, "");
      // Write build_info.yml referencing a file inside and outside the build folder
      await fs.outputFile(
        path.join(buildFolder, "build_info.yml"),
        `cmake:\n  kconfig:\n    files:\n      - ${insideBuild.replace(/\\/g, "/")}\n      - ${path.join(tmp, "app/prj.conf").replace(/\\/g, "/")}\n    user-files: []\n`,
      );

      const targets = listSaveTargets(ws, proj, bld);
      // autoconf.conf (inside build) excluded; only prj.conf (auto-detected, outside build).
      assert.strictEqual(targets.length, 1, "only conf files outside the build folder");
      assert.strictEqual(targets[0].kind, "auto");
      assert.strictEqual(targets[0].attached, false);
    } finally {
      await fs.remove(tmp);
    }
  });

  test("listSaveTargets marks build_info.yml paths as auto when not in confFiles", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "zephyr-ide-save-targets-"));
    try {
      const ws = makeWs(tmp);
      const proj = makeProject({ config: [], overlay: [] });
      const bld = makeBuild({ config: [], overlay: [] });

      const buildFolder = path.join(tmp, "app/build/debug");
      await fs.ensureDir(buildFolder);
      const autoConf = path.join(tmp, "app/prj.conf");
      await fs.outputFile(
        path.join(buildFolder, "build_info.yml"),
        `cmake:\n  kconfig:\n    files:\n      - ${autoConf.replace(/\\/g, "/")}\n    user-files: []\n`,
      );

      const targets = listSaveTargets(ws, proj, bld);
      assert.strictEqual(targets.length, 1);
      assert.strictEqual(targets[0].kind, "auto");
      assert.strictEqual(targets[0].attached, false);
      assert.ok(targets[0].path.endsWith("prj.conf"), "should use workspace-relative path");
    } finally {
      await fs.remove(tmp);
    }
  });

  // ── mergeFragmentContent ─────────────────────────────────────────────────

  test("mergeFragmentContent replaces existing symbols in-place", () => {
    const existing = [
      "CONFIG_FOO=y",
      "CONFIG_BAR=5",
      "CONFIG_BAZ=\"hello\"",
      "",
    ].join("\n");

    const changes: KconfigChange[] = [
      { name: "CONFIG_FOO", value: "n", type: "bool" },
      { name: "CONFIG_BAZ", value: "world", type: "string" },
    ];

    const result = mergeFragmentContent(existing, changes);
    const lines = result.split("\n").filter((l) => l !== "");
    assert.ok(lines.includes("# CONFIG_FOO is not set"), "FOO updated in-place (disabled bool)");
    assert.ok(lines.includes("CONFIG_BAZ=\"world\""), "BAZ updated in-place");
    assert.ok(lines.includes("CONFIG_BAR=5"), "BAR preserved unchanged");
    // Check order: FOO before BAR before BAZ (original order preserved)
    const idxFoo = lines.indexOf("# CONFIG_FOO is not set");
    const idxBar = lines.indexOf("CONFIG_BAR=5");
    const idxBaz = lines.indexOf("CONFIG_BAZ=\"world\"");
    assert.ok(idxFoo < idxBar, "FOO before BAR");
    assert.ok(idxBar < idxBaz, "BAR before BAZ");
  });

  test("mergeFragmentContent appends new symbols at end", () => {
    const existing = "CONFIG_EXISTING=y\n";
    const changes: KconfigChange[] = [
      { name: "CONFIG_NEW", value: "42", type: "int" },
    ];

    const result = mergeFragmentContent(existing, changes);
    const lines = result.split("\n").filter((l) => l !== "");
    assert.ok(lines.includes("CONFIG_EXISTING=y"), "existing line preserved");
    assert.ok(lines.includes("CONFIG_NEW=42"), "new line appended");
    // Order: existing before new
    assert.ok(
      lines.indexOf("CONFIG_EXISTING=y") < lines.indexOf("CONFIG_NEW=42"),
      "existing line comes before appended line",
    );
  });

  test("mergeFragmentContent handles 'is not set' comments", () => {
    const existing = "# CONFIG_DEBUG is not set\nCONFIG_FOO=y\n";
    const changes: KconfigChange[] = [
      { name: "CONFIG_DEBUG", value: "y", type: "bool" },
    ];

    const result = mergeFragmentContent(existing, changes);
    const lines = result.split("\n").filter((l) => l !== "");
    assert.ok(lines.includes("CONFIG_DEBUG=y"), "# not set line replaced with assignment");
    assert.ok(lines.includes("CONFIG_FOO=y"), "FOO preserved");
  });
});
