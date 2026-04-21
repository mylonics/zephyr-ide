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

  test("loadProjectsFromFile migration preserves existing config entry objects when extra arrays exist", async () => {    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zephyr-ide-config-files-"));
    try {
      const configDir = path.join(tmpRoot, ".vscode");
      await fs.ensureDir(configDir);
      const configPath = path.join(configDir, "zephyr-ide.json");
      await fs.writeJson(configPath, {
        projects: {
          app: {
            name: "app",
            rel_path: "app",
            confFiles: {
              config: [{ path: "prj.conf" }],
              extraConfig: ["debug.conf"],
              overlay: [{ path: "board.overlay" }],
              extraOverlay: ["debug.overlay"],
            },
            twisterConfigs: {},
            buildConfigs: {
              debug: {
                name: "build/debug",
                board: "native_sim",
                relBoardDir: "",
                relBoardSubDir: "native/native_sim",
                debugOptimization: "Debug",
                westBuildArgs: [],
                westBuildCMakeArgs: [],
                runnerConfigs: {
                  default: { runner: "Default", name: "Default", args: "" },
                },
                confFiles: {
                  config: [{ path: "build.conf" }],
                  extraConfig: ["build_extra.conf"],
                  overlay: [{ path: "build.overlay" }],
                  extraOverlay: ["build_extra.overlay"],
                },
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
        wsConfig.projects.app.confFiles.config,
        [{ path: "prj.conf" }, { path: "debug.conf", extra: true }],
      );
      assert.deepStrictEqual(
        wsConfig.projects.app.confFiles.overlay,
        [{ path: "board.overlay" }, { path: "debug.overlay", extra: true }],
      );
      assert.deepStrictEqual(
        wsConfig.projects.app.buildConfigs.debug.confFiles.config,
        [{ path: "build.conf" }, { path: "build_extra.conf", extra: true }],
      );
      assert.deepStrictEqual(
        wsConfig.projects.app.buildConfigs.debug.confFiles.overlay,
        [{ path: "build.overlay" }, { path: "build_extra.overlay", extra: true }],
      );

      const migrated = await fs.readJson(configPath);
      assert.deepStrictEqual(
        migrated.projects.app.confFiles.config,
        [{ path: "prj.conf" }, { path: "debug.conf", extra: true }],
      );
      assert.deepStrictEqual(
        migrated.projects.app.confFiles.overlay,
        [{ path: "board.overlay" }, { path: "debug.overlay", extra: true }],
      );
      assert.strictEqual(migrated.projects.app.confFiles.extraConfig, undefined);
      assert.strictEqual(migrated.projects.app.confFiles.extraOverlay, undefined);
    } finally {
      await fs.remove(tmpRoot);
    }
  });

  test("loadProjectsFromFile migrates pure-string config arrays to ConfigFileEntry objects", async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zephyr-ide-conf-strings-"));
    try {
      const configDir = path.join(tmpRoot, ".vscode");
      await fs.ensureDir(configDir);
      const configPath = path.join(configDir, "zephyr-ide.json");
      await fs.writeJson(configPath, {
        projects: {
          app: {
            name: "app",
            rel_path: "app",
            confFiles: {
              config: ["prj.conf", "debug.conf"],
              overlay: ["board.overlay"],
            },
            twisterConfigs: {},
            buildConfigs: {
              release: {
                name: "build/release",
                board: "native_sim",
                relBoardDir: "",
                relBoardSubDir: "native/native_sim",
                debugOptimization: "Release",
                westBuildArgs: [],
                westBuildCMakeArgs: [],
                runnerConfigs: {},
                confFiles: {
                  config: ["release.conf"],
                  overlay: [],
                },
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

      // Pure strings should become {path: "..."} objects (non-extra)
      assert.deepStrictEqual(wsConfig.projects.app.confFiles.config, [
        { path: "prj.conf" },
        { path: "debug.conf" },
      ]);
      assert.deepStrictEqual(wsConfig.projects.app.confFiles.overlay, [
        { path: "board.overlay" },
      ]);
      assert.deepStrictEqual(wsConfig.projects.app.buildConfigs.release.confFiles.config, [
        { path: "release.conf" },
      ]);

      // Persisted file should also have the migrated format
      const persisted = await fs.readJson(configPath);
      assert.deepStrictEqual(persisted.projects.app.confFiles.config, [
        { path: "prj.conf" },
        { path: "debug.conf" },
      ]);
    } finally {
      await fs.remove(tmpRoot);
    }
  });

  test("loadProjectsFromFile is idempotent: second load does not re-migrate or re-write the file", async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zephyr-ide-idempotent-"));
    try {
      const configDir = path.join(tmpRoot, ".vscode");
      await fs.ensureDir(configDir);
      const configPath = path.join(configDir, "zephyr-ide.json");
      // Start with a legacy (string-array) format that will be migrated on first load
      await fs.writeJson(configPath, {
        projects: {
          app: {
            name: "app",
            rel_path: "app",
            confFiles: {
              config: ["prj.conf"],
              extraConfig: ["debug.conf"],
              overlay: [],
              extraOverlay: [],
            },
            twisterConfigs: {},
            buildConfigs: {
              debug: {
                name: "build/debug",
                board: "native_sim",
                relBoardDir: "",
                relBoardSubDir: "native/native_sim",
                debugOptimization: "Debug",
                westBuildArgs: "--sysbuild",
                westBuildCMakeArgs: [],
                runnerConfigs: {},
                confFiles: { config: [], overlay: [] },
                launchTarget: "Zephyr IDE: Debug",
                buildDebugTarget: "Zephyr IDE: Debug",
                attachTarget: "Zephyr IDE: Attach",
              },
            },
          },
        },
      }, { spaces: 2 });

      const wsConfig1: WorkspaceConfig = {
        rootPath: tmpRoot,
        projects: {},
        initialSetupComplete: true,
        projectStates: {},
      };
      await loadProjectsFromFile(wsConfig1);

      // Capture the file content after the first (migrating) load
      const afterFirst = await fs.readJson(configPath);

      // Second load — file is already in new format; should produce the same result
      const wsConfig2: WorkspaceConfig = {
        rootPath: tmpRoot,
        projects: {},
        initialSetupComplete: true,
        projectStates: {},
      };
      await loadProjectsFromFile(wsConfig2);

      const afterSecond = await fs.readJson(configPath);

      assert.deepStrictEqual(
        afterSecond,
        afterFirst,
        "File content must be identical after a second load (migration is idempotent)"
      );
      assert.deepStrictEqual(wsConfig2.projects.app.confFiles.config, wsConfig1.projects.app.confFiles.config);
      assert.deepStrictEqual(wsConfig2.projects.app.buildConfigs.debug.westBuildArgs, ["--sysbuild"]);
    } finally {
      await fs.remove(tmpRoot);
    }
  });
});
