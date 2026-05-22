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
import * as fs from "fs";
import * as path from "path";
import {
  formatBindLabel,
  loadRunnerProfiles,
  resolveRunnerArgs,
  RunnerVarContext,
} from "../project_utilities/runner_profiles";
import { WorkspaceConfig } from "../setup_utilities/types";

function makeCtx(overrides: Partial<RunnerVarContext> & { buildFolder?: string } = {}): RunnerVarContext {
  return {
    workspaceFolder: "/ws",
    buildFolder: overrides.buildFolder ?? "/ws/myproject/mybuild",
    board: "nucleo_f401re",
    boardRevision: "",
    project: "myproject",
    build: "mybuild",
    ...overrides,
  };
}

suite("runner-profile-resolution: simplified binds", () => {
  test("formatBindLabel reports auto and launch entries", () => {
    assert.strictEqual(formatBindLabel(undefined), "Auto (runners.yaml)");
    assert.strictEqual(formatBindLabel({ kind: "auto" }), "Auto (runners.yaml)");
    assert.strictEqual(formatBindLabel({ kind: "launch", name: "My Config" }), "launch.json: My Config");
  });

  test("loadRunnerProfiles preserves legacy runner binds as migration sentinels", () => {
    const rootPath = path.join(process.cwd(), ".test-runner-profile-resolution");
    fs.mkdirSync(path.join(rootPath, ".vscode"), { recursive: true });
    fs.writeFileSync(path.join(rootPath, ".vscode", "zephyr-ide.json"), JSON.stringify({
      runnerProfiles: [{
        name: "Legacy",
        flash: { kind: "runner", runner: "openocd", extraArgs: ["-f", "interface/jlink.cfg"] },
        debug: { kind: "auto" },
        attach: { kind: "launch", name: "Attach", workspaceFolder: "app" },
      }],
    }), "utf8");
    try {
      const profiles = loadRunnerProfiles({ rootPath, projects: {}, projectStates: {} } as WorkspaceConfig);
      assert.strictEqual(profiles.length, 1);
      assert.strictEqual((profiles[0].flash as any).kind, "legacyRunner");
      assert.strictEqual((profiles[0].flash as any).runner, "openocd");
      assert.deepStrictEqual((profiles[0].flash as any).extraArgs, ["-f", "interface/jlink.cfg"]);
      assert.deepStrictEqual(profiles[0].attach, { kind: "launch", name: "Attach", workspaceFolder: "app" });
    } finally {
      fs.rmSync(rootPath, { recursive: true, force: true });
    }
  });
});

suite("runner-profile-resolution: resolveRunnerArgs", () => {
  test("resolves static and custom variables", () => {
    const ctx = makeCtx({ boardRevision: "1.0", buildVars: { speed: "4000" }, projectVars: { probe: "jlink" } });
    assert.strictEqual(
      resolveRunnerArgs("${workspaceFolder} ${board}@${boardRevision} ${project}/${build} ${buildvar:speed} ${projectvar:probe}", ctx),
      "/ws nucleo_f401re@1.0 myproject/mybuild 4000 jlink",
    );
  });

  test("leaves unknown variables for VS Code", () => {
    assert.strictEqual(resolveRunnerArgs("${command:foo}", makeCtx()), "${command:foo}");
  });
});
