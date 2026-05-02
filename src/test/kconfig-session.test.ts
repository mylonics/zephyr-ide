/*
Copyright 2026 mylonics
Author Rijesh Augustine
SPDX-License-Identifier: Apache-2.0
*/

/**
 * Tests for the KconfigSession (extension-side wrapper around the
 * resources/kconfig_helper.py JSON-RPC subprocess) and the env-derivation
 * helpers in src/build_data/kconfig-session.ts.
 *
 * The pure-TS tests (CMakeCache parsing, resolveKconfigRoot, ...) always run.
 * The end-to-end subprocess tests require Python with `kconfiglib` available
 * on PATH; if the import fails the whole suite is skipped with a console
 * notice so CI environments without a Zephyr venv still pass.
 */

import * as assert from "assert";
import * as fs from "fs-extra";
import * as os from "os";
import * as path from "path";
import { spawnSync } from "child_process";
import {
  KconfigSession,
  buildEnvFromCMakeCache,
  getKconfigHelperPath,
  resolveDotConfig,
  resolveKconfigRoot,
  resolveVenvPython,
} from "../build_data/kconfig-session";

// ---------------------------------------------------------------------------
// Synthetic Kconfig fixture
// ---------------------------------------------------------------------------

const SYNTHETIC_KCONFIG = `
mainmenu "Test"

config FOO
\tbool "Foo prompt"
\tdefault y

config BAR
\tbool "Bar prompt"
\tdefault n

config BAZ
\tbool "Baz prompt"
\tdefault n
\tdepends on FOO

config STR
\tstring "A string"
\tdefault "hello"

config NUM
\tint "An int"
\tdefault 42
\trange 0 100
`;

function writeFixture(): { dir: string; kconfig: string; dotConfig: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zephyr-ide-kconfig-"));
  const kconfig = path.join(dir, "Kconfig");
  fs.writeFileSync(kconfig, SYNTHETIC_KCONFIG, "utf8");
  // Pre-populate a .config that flips BAR to y and STR to "world".
  const dotConfig = path.join(dir, ".config");
  fs.writeFileSync(
    dotConfig,
    [
      "CONFIG_FOO=y",
      "CONFIG_BAR=y",
      "# CONFIG_BAZ is not set",
      'CONFIG_STR="world"',
      "CONFIG_NUM=7",
      "",
    ].join("\n"),
    "utf8",
  );
  return { dir, kconfig, dotConfig };
}

// ---------------------------------------------------------------------------
// Detect a working python+kconfiglib so we can skip cleanly in CI without it.
// ---------------------------------------------------------------------------

function detectKconfiglibPython(): string | undefined {
  const candidates = process.platform === "win32"
    ? ["python", "python3", "py"]
    : ["python3", "python"];
  for (const exe of candidates) {
    try {
      const r = spawnSync(exe, ["-c", "import kconfiglib"], { encoding: "utf8" });
      if (r.status === 0) { return exe; }
    } catch {
      // try next
    }
  }
  return undefined;
}

// Resolve the helper script path relative to the compiled test file.  Tests
// run from out/test/, so the workspace root is two levels up.
function helperScript(): string {
  return getKconfigHelperPath(path.resolve(__dirname, "..", ".."));
}

// ---------------------------------------------------------------------------
// Pure-TS suite (always runs)
// ---------------------------------------------------------------------------

suite("KconfigSession - env derivation", () => {
  let tmpDir: string;
  setup(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "zephyr-ide-kc-env-"));
  });
  teardown(() => {
    try { fs.removeSync(tmpDir); } catch { /* ignore */ }
  });

  test("buildEnvFromCMakeCache returns {} when CMakeCache.txt is missing", () => {
    const env = buildEnvFromCMakeCache(tmpDir);
    assert.deepStrictEqual(env, {});
  });

  test("buildEnvFromCMakeCache extracts known cache keys", () => {
    const cache = [
      "// header comment",
      "ZEPHYR_BASE:PATH=/opt/zephyr",
      "BOARD:STRING=nrf52dk_nrf52832",
      "ARCH:STRING=arm",
      "SOC:STRING=nrf52832",
      "SOC_DIR:PATH=/opt/zephyr/soc",
      "KCONFIG_ROOT:FILEPATH=/opt/zephyr/Kconfig",
      "UNRELATED_KEY:STRING=ignore",
      "",
    ].join("\n");
    fs.writeFileSync(path.join(tmpDir, "CMakeCache.txt"), cache, "utf8");
    const env = buildEnvFromCMakeCache(tmpDir);
    assert.strictEqual(env["ZEPHYR_BASE"], "/opt/zephyr");
    assert.strictEqual(env["BOARD"], "nrf52dk_nrf52832");
    assert.strictEqual(env["ARCH"], "arm");
    assert.strictEqual(env["SOC"], "nrf52832");
    assert.strictEqual(env["SOC_DIR"], "/opt/zephyr/soc");
    assert.strictEqual(env["KCONFIG_ROOT"], "/opt/zephyr/Kconfig");
    assert.strictEqual(env["UNRELATED_KEY"], undefined);
  });

  test("buildEnvFromCMakeCache ignores comments, blank lines, and missing keys", () => {
    const cache = [
      "# hash comment",
      "// slash comment",
      "",
      "BOARD:STRING=qemu_x86",
      "no_equals_here",
      "",
    ].join("\r\n");
    fs.writeFileSync(path.join(tmpDir, "CMakeCache.txt"), cache, "utf8");
    const env = buildEnvFromCMakeCache(tmpDir);
    assert.strictEqual(env["BOARD"], "qemu_x86");
    assert.strictEqual(env["ARCH"], undefined);
  });

  test("resolveKconfigRoot prefers KCONFIG_ROOT, falls back to ZEPHYR_BASE/Kconfig", () => {
    assert.strictEqual(
      resolveKconfigRoot({ KCONFIG_ROOT: "/explicit/Kconfig" }),
      "/explicit/Kconfig",
    );
    assert.strictEqual(
      resolveKconfigRoot({ ZEPHYR_BASE: "/opt/zephyr" }),
      "/opt/zephyr/Kconfig",
    );
    assert.strictEqual(resolveKconfigRoot({}), undefined);
  });

  test("resolveDotConfig returns <build>/zephyr/.config", () => {
    const got = resolveDotConfig("/build");
    assert.strictEqual(got.replace(/\\/g, "/"), "/build/zephyr/.config");
  });

  test("resolveVenvPython returns the venv binary when VIRTUAL_ENV is set", () => {
    const venv = process.platform === "win32" ? "C:/v" : "/v";
    const expected = process.platform === "win32"
      ? "C:/v/Scripts/python.exe"
      : "/v/bin/python";
    const got = resolveVenvPython({
      env: { VIRTUAL_ENV: venv },
    } as unknown as Parameters<typeof resolveVenvPython>[0]);
    assert.strictEqual(got.replace(/\\/g, "/"), expected);
  });

  test("resolveVenvPython falls back to system python when no venv", () => {
    const got = resolveVenvPython(undefined);
    const expected = process.platform === "win32" ? "python" : "python3";
    assert.strictEqual(got, expected);
  });
});

suite("KconfigSession - error handling without spawn", () => {
  test("rejects calls before start()", async () => {
    const session = new KconfigSession({
      helperScript: helperScript(),
      pythonExecutable: "python3",
    });
    await assert.rejects(
      session.tree(),
      /not started/,
    );
  });

  test("start() throws if helper script does not exist", () => {
    const session = new KconfigSession({
      helperScript: path.join(os.tmpdir(), "definitely-missing-kconfig-helper.py"),
      pythonExecutable: "python3",
    });
    assert.throws(() => session.start(), /not found/);
  });

  test("rejects calls after dispose()", async () => {
    const session = new KconfigSession({
      helperScript: helperScript(),
      pythonExecutable: "python3",
    });
    session.dispose();
    await assert.rejects(session.tree(), /disposed/);
  });
});

// ---------------------------------------------------------------------------
// End-to-end subprocess suite (skipped if kconfiglib is unavailable)
// ---------------------------------------------------------------------------

const py = detectKconfiglibPython();

suite("KconfigSession - end-to-end via kconfig_helper.py", function () {
  if (!py) {
    test("(skipped: no python with kconfiglib on PATH)", function () {
      this.skip();
    });
    return;
  }
  let session: KconfigSession;
  let fixture: ReturnType<typeof writeFixture>;

  setup(async () => {
    fixture = writeFixture();
    session = new KconfigSession({
      helperScript: helperScript(),
      pythonExecutable: py!,
    });
    session.start();
    const init = await session.init({
      kconfigRoot: fixture.kconfig,
      env: {},
      dotConfig: fixture.dotConfig,
      srctree: fixture.dir,
    });
    assert.ok(init.symbols >= 5, `expected at least 5 symbols, got ${init.symbols}`);
    assert.strictEqual(init.dot_config_loaded, true);
  });

  teardown(async () => {
    await session.shutdown();
    try { fs.removeSync(fixture.dir); } catch { /* ignore */ }
  });

  test("tree() returns the menu hierarchy with our symbols", async () => {
    const t = await session.tree();
    const flat: string[] = [];
    const walk = (n: { name: string; children?: { name: string; children?: unknown }[] }) => {
      if (n.name) { flat.push(n.name); }
      for (const c of n.children ?? []) { walk(c as never); }
    };
    walk(t.top_menu as never);
    for (const expected of ["FOO", "BAR", "BAZ", "STR", "NUM"]) {
      assert.ok(flat.includes(expected), `tree missing ${expected}, got ${flat.join(",")}`);
    }
  });

  test("symbol() exposes prompt, type, value, and dependency info", async () => {
    const baz = await session.symbol("BAZ");
    assert.strictEqual(baz.name, "BAZ");
    assert.strictEqual(baz.type, "bool");
    assert.strictEqual(baz.prompt, "Baz prompt");
    assert.strictEqual(baz.value, "n");
    assert.match(baz.direct_dependencies, /FOO/);
  });

  test("set() flips a bool and reports cascading visibility changes", async () => {
    // BAZ depends on FOO. Setting FOO=n hides BAZ; the set() result should
    // include FOO in `changed`.
    const result = await session.set("FOO", "n");
    const names = result.changed.map((c) => c.name);
    assert.ok(names.includes("FOO"), `expected FOO in changed: ${names.join(",")}`);
  });

  test("set() rejects an unassignable value", async () => {
    await assert.rejects(
      session.set("FOO", "garbage"),
      /not assignable|set/i,
    );
  });

  test("diff() reports symbols differing from the loaded .config", async () => {
    await session.set("BAR", "n");
    const d = await session.diff();
    const names = d.changes.map((c) => c.name);
    assert.ok(names.includes("BAR"), `expected BAR in diff: ${names.join(",")}`);
  });

  test("save() writes a Kconfig fragment containing edited symbols", async () => {
    await session.set("STR", "edited");
    const out = path.join(fixture.dir, "saved.conf");
    const r = await session.save(out, true);
    assert.ok(fs.existsSync(r.path), `save did not produce ${r.path}`);
    const content = fs.readFileSync(r.path, "utf8");
    assert.match(content, /CONFIG_STR="edited"/);
  });

  test("symbol() rejects an unknown name", async () => {
    await assert.rejects(session.symbol("NOT_A_SYMBOL"), /unknown symbol/);
  });
});

if (!py) {
  console.warn(
    "[kconfig-session.test] Skipping end-to-end suite: no python with kconfiglib " +
    "found on PATH. Activate a Zephyr venv (or `pip install kconfiglib`) to run them.",
  );
}
