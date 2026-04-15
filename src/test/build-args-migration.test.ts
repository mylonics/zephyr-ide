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

import { loadProjectsFromFile } from "../setup_utilities/workspace-config";
import { WorkspaceConfig } from "../setup_utilities/types";
import { joinBuildArgsForShell, normalizeBuildArgs } from "../project_utilities/build_args";

suite("Build Args Migration Test Suite", () => {
  test("normalizeBuildArgs splits shell-like string into argument list", () => {
    const args = normalizeBuildArgs(`--sysbuild -DCFG="value with spaces" '-DOTHER=quoted value'`);
    assert.deepStrictEqual(args, ["--sysbuild", "-DCFG=value with spaces", "-DOTHER=quoted value"]);
  });

  test("joinBuildArgsForShell preserves args with spaces as single shell tokens", () => {
    const cmdArgs = joinBuildArgsForShell(["--sysbuild", "-DCFG=value with spaces", "-DOTHER=quoted value"]);
    assert.strictEqual(cmdArgs, '--sysbuild "-DCFG=value with spaces" "-DOTHER=quoted value"');
  });

  test("loadProjectsFromFile migrates legacy build arg strings to arrays", async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zephyr-ide-build-args-"));
    try {
      const configDir = path.join(tmpRoot, ".vscode");
      await fs.ensureDir(configDir);
      const configPath = path.join(configDir, "zephyr-ide.json");
      await fs.writeJson(configPath, {
        projects: {
          app: {
            name: "app",
            rel_path: "app",
            confFiles: { config: [], overlay: [] },
            twisterConfigs: {},
            buildConfigs: {
              debug: {
                name: "build/debug",
                board: "native_sim",
                relBoardDir: "",
                relBoardSubDir: "native/native_sim",
                debugOptimization: "Debug",
                westBuildArgs: "--sysbuild --pristine=always",
                westBuildCMakeArgs: "-DCMAKE_BUILD_TYPE=Debug -DCONFIG_LOG=y",
                runnerConfigs: {
                  default: { runner: "Default", name: "Default", args: "" },
                },
                confFiles: { config: [], overlay: [] },
                launchTarget: "Zephyr IDE: Debug",
                buildDebugTarget: "Zephyr IDE: Debug",
                attachTarget: "Zephyr IDE: Attach",
              },
            },
          },
        },
      }, { spaces: 2 });

      const wsConfig: WorkspaceConfig = {
        rootPath: tmpRoot,
        projects: {},
        initialSetupComplete: true,
        projectStates: {},
      };

      await loadProjectsFromFile(wsConfig);

      assert.deepStrictEqual(
        wsConfig.projects.app.buildConfigs.debug.westBuildArgs,
        ["--sysbuild", "--pristine=always"],
      );
      assert.deepStrictEqual(
        wsConfig.projects.app.buildConfigs.debug.westBuildCMakeArgs,
        ["-DCMAKE_BUILD_TYPE=Debug", "-DCONFIG_LOG=y"],
      );

      const migrated = await fs.readJson(configPath);
      assert.deepStrictEqual(
        migrated.projects.app.buildConfigs.debug.westBuildArgs,
        ["--sysbuild", "--pristine=always"],
      );
      assert.deepStrictEqual(
        migrated.projects.app.buildConfigs.debug.westBuildCMakeArgs,
        ["-DCMAKE_BUILD_TYPE=Debug", "-DCONFIG_LOG=y"],
      );
    } finally {
      await fs.remove(tmpRoot);
    }
  });
});
