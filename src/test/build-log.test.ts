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
import * as path from "path";
import { getBuildLogPath, LoggedTaskTerminal } from "../utilities/build-log";
import { executeTaskHelper } from "../utilities/utils";
import { ProjectBuildPanel } from "../panels/project_build_view/ProjectBuildPanel";
import { getBuildDetails } from "../project_utilities/project_info";
import type { BuildConfig } from "../project_utilities/build_selector";
import type { SetupState, WorkspaceConfig } from "../setup_utilities/types";

suite("Build logging", () => {
  let root: string;

  setup(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "zephyr-build-log-"));
  });

  teardown(async () => {
    await fs.remove(root);
  });

  function command(script: string): string {
    const prefix = process.platform === "win32" ? "& " : "";
    return `${prefix}"${process.execPath}" -e "${script}"`;
  }

  function run(script: string, env?: NodeJS.ProcessEnv) {
    const logFile = getBuildLogPath(root, "app", { name: "debug", saveBuildLog: true })!;
    const terminal = new LoggedTaskTerminal(command(script), root, { ELECTRON_RUN_AS_NODE: "1", ...env }, logFile);
    let output = "";
    terminal.onDidWrite(data => { output += data; });
    const done = new Promise<number>(resolve => terminal.onDidClose(resolve));
    terminal.open();
    return { terminal, logFile, done, output: () => output };
  }

  test("logging is opt-in, even when a directory is configured", () => {
    assert.strictEqual(getBuildLogPath(root, "app", { name: "debug" }), undefined);
    assert.strictEqual(getBuildLogPath(root, "app", { name: "debug", saveBuildLog: false, buildLogDir: "logs" }), undefined);
    assert.deepStrictEqual(fs.readdirSync(root), []);
  });

  function settingsFixture() {
    const makeBuild = (name: string): BuildConfig => ({
      name, board: "native_sim", westBuildArgs: [], westBuildCMakeArgs: [],
      confFiles: { config: [], overlay: [] },
    });
    const build = makeBuild("debug");
    const otherBuild = makeBuild("release");
    const ws: WorkspaceConfig = {
      rootPath: root,
      projects: {
        app: {
          name: "app", relPath: "app", buildConfigs: { debug: build, release: otherBuild },
          confFiles: { config: [], overlay: [] }, twisterConfigs: {},
        },
      },
      projectStates: {},
      activeSetupState: { initialized: true } as SetupState,
    };
    const panel = Object.create(ProjectBuildPanel.prototype) as any;
    let updates = 0;
    panel._wsConfig = ws;
    panel._selectedProject = "app";
    panel._context = { workspaceState: { update: async () => {} } };
    panel.updateHtml = () => { updates++; };
    return { panel, ws, build, otherBuild, updates: () => updates };
  }

  test("settings UI build details provide defaults and reflect configured logging values", () => {
    const { ws, build } = settingsFixture();
    let details = getBuildDetails(ws, "app", "debug")!;
    assert.strictEqual(details.saveBuildLog, false);
    assert.strictEqual(details.buildLogDir, "logs");
    build.saveBuildLog = true;
    build.buildLogDir = path.join(root, "custom logs");
    details = getBuildDetails(ws, "app", "debug")!;
    assert.strictEqual(details.saveBuildLog, true);
    assert.strictEqual(details.buildLogDir, build.buildLogDir);
  });

  test("settings messages persist only the selected build and clearing the directory restores its default", async () => {
    const { panel, ws, build, otherBuild, updates } = settingsFixture();
    const send = (key: string, value: unknown) => panel.handleMessage({
      command: "updateBuildLogSetting", build: "debug", key, value,
    });
    await send("saveBuildLog", true);
    await send("buildLogDir", " my logs ");
    let saved = await fs.readJson(path.join(root, ".vscode", "zephyr-ide.json"));
    assert.strictEqual(saved.projects.app.buildConfigs.debug.saveBuildLog, true);
    assert.strictEqual(saved.projects.app.buildConfigs.debug.buildLogDir, "my logs");
    assert.strictEqual(otherBuild.saveBuildLog, undefined);
    assert.strictEqual(otherBuild.buildLogDir, undefined);
    await send("saveBuildLog", false);
    assert.strictEqual(build.buildLogDir, "my logs");
    await send("buildLogDir", "   ");
    saved = await fs.readJson(path.join(root, ".vscode", "zephyr-ide.json"));
    assert.strictEqual(saved.projects.app.buildConfigs.debug.saveBuildLog, false);
    assert.ok(!("buildLogDir" in saved.projects.app.buildConfigs.debug));
    assert.strictEqual(getBuildDetails(ws, "app", "debug")!.buildLogDir, "logs");
    assert.strictEqual(updates(), 4);
  });

  test("settings messages reject unexpected keys, value types, and missing builds", async () => {
    const { panel, build, updates } = settingsFixture();
    for (const message of [
      { build: "debug", key: "saveBuildLog", value: "true" },
      { build: "debug", key: "buildLogDir", value: false },
      { build: "debug", key: "board", value: "other_board" },
      { build: "missing", key: "saveBuildLog", value: true },
      { build: "__proto__", key: "saveBuildLog", value: true },
      { key: "saveBuildLog", value: true },
    ]) {
      await panel.handleMessage({ command: "updateBuildLogSetting", ...message });
    }
    assert.strictEqual(build.saveBuildLog, undefined);
    assert.strictEqual(build.buildLogDir, undefined);
    assert.strictEqual(build.board, "native_sim");
    assert.strictEqual(updates(), 0);
    assert.ok(!fs.existsSync(path.join(root, ".vscode", "zephyr-ide.json")));
  });

  test("resolves default, relative, and absolute directories with unique safe filenames", () => {
    const config = { name: "debug/../../bad:name", saveBuildLog: true };
    const first = getBuildLogPath(root, "../app", config)!;
    const second = getBuildLogPath(root, "../app", config)!;
    assert.strictEqual(path.dirname(first), path.join(root, "logs"));
    assert.notStrictEqual(first, second);
    assert.match(path.basename(first), /^\.\._app-debug_.*-\d{4}-\d{2}-\d{2}T.*\.log$/);
    assert.ok(!path.basename(first).includes(":"));
    assert.strictEqual(path.dirname(getBuildLogPath(root, "app", { ...config, buildLogDir: "my logs" })!), path.join(root, "my logs"));
    assert.strictEqual(path.dirname(getBuildLogPath(root, "app", { ...config, buildLogDir: root })!), root);
  });

  test("streams configure and build stdout/stderr to the terminal and flushes the log before completing", async () => {
    const result = run("console.log('configure'); console.error('configure warning'); setTimeout(() => { console.log('build'); console.error('compiler warning'); }, 30)");
    assert.strictEqual(await result.done, 0);
    const log = await fs.readFile(result.logFile, "utf8");
    for (const line of ["configure", "configure warning", "build", "compiler warning"]) {
      assert.ok(log.includes(line), log);
      assert.ok(result.output().includes(line), result.output());
    }
    assert.ok(result.output().includes(result.logFile));
  });

  test("retains failed build output and preserves its nonzero exit code", async () => {
    const result = run("console.log('configure'); console.error('build failed'); process.exitCode = 7");
    assert.strictEqual(await result.done, 7);
    const log = await fs.readFile(result.logFile, "utf8");
    assert.ok(log.includes("configure"));
    assert.ok(log.includes("build failed"));
  });

  test("preserves large output and unicode without an exec buffer limit", async () => {
    const result = run("process.stdout.write('é'.repeat(600000)); process.stderr.write('warning')");
    assert.strictEqual(await result.done, 0);
    const log = await fs.readFile(result.logFile, "utf8");
    assert.strictEqual(log.replace("warning", ""), "é".repeat(600000));
  });

  test("inherits the build environment and working directory", async () => {
    const result = run("console.log(process.env.BUILD_LOG_TEST); console.log(process.cwd())", { BUILD_LOG_TEST: "injected build environment" });
    assert.strictEqual(await result.done, 0);
    const log = await fs.readFile(result.logFile, "utf8");
    assert.ok(log.includes("injected build environment"));
    assert.ok(log.includes(root));
  });

  test("cancellation stops the process and retains partial output", async () => {
    const result = run("console.log('build started'); setInterval(() => {}, 1000)");
    result.terminal.onDidWrite(data => {
      if (data.includes("build started") && !data.includes(" -e ")) {
        result.terminal.close();
      }
    });
    assert.notStrictEqual(await result.done, 0);
    assert.ok((await fs.readFile(result.logFile, "utf8")).includes("build started"));
  });

  test("an invalid log directory fails clearly without launching the build", async () => {
    const blocked = path.join(root, "not-a-directory");
    await fs.writeFile(blocked, "");
    const terminal = new LoggedTaskTerminal(command("console.log('should not run')"), root, undefined, path.join(blocked, "build.log"));
    let output = "";
    terminal.onDidWrite(data => { output += data; });
    const done = new Promise<number>(resolve => terminal.onDidClose(resolve));
    terminal.open();
    assert.strictEqual(await done, 1);
    assert.ok(output.includes("Build logging failed"));
  });

  test("logged VS Code tasks complete successfully and report failed builds", async () => {
    const successLog = path.join(root, "success.log");
    assert.strictEqual(await executeTaskHelper("Build Log Success Test",
      command("console.log('task output')"), root, { ELECTRON_RUN_AS_NODE: "1" }, successLog), true);
    assert.ok((await fs.readFile(successLog, "utf8")).includes("task output"));
    const failureLog = path.join(root, "failure.log");
    assert.strictEqual(await executeTaskHelper("Build Log Failure Test",
      command("console.error('task failure'); process.exitCode = 9"), root, { ELECTRON_RUN_AS_NODE: "1" }, failureLog), false);
    assert.ok((await fs.readFile(failureLog, "utf8")).includes("task failure"));
  });
});
