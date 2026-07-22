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

suite("rel_path -> relPath Migration Test Suite", () => {
  test("loadProjectsFromFile migrates legacy rel_path to relPath on both project and build", async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zephyr-ide-rel-path-"));
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
                rel_path: "custom_out/debug",
                westBuildArgs: [],
                westBuildCMakeArgs: [],
                confFiles: { config: [], overlay: [] },
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

      assert.strictEqual(wsConfig.projects.app.relPath, "app");
      assert.strictEqual((wsConfig.projects.app as any).rel_path, undefined);
      assert.strictEqual(wsConfig.projects.app.buildConfigs.debug.relPath, "custom_out/debug");
      assert.strictEqual((wsConfig.projects.app.buildConfigs.debug as any).rel_path, undefined);

      const migrated = await fs.readJson(configPath);
      assert.strictEqual(migrated.projects.app.relPath, "app");
      assert.strictEqual(migrated.projects.app.rel_path, undefined);
      assert.strictEqual(migrated.projects.app.buildConfigs.debug.relPath, "custom_out/debug");
      assert.strictEqual(migrated.projects.app.buildConfigs.debug.rel_path, undefined);
    } finally {
      await fs.remove(tmpRoot);
    }
  });

  test("loadProjectsFromFile leaves a project already using relPath unchanged", async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zephyr-ide-rel-path-"));
    try {
      const configDir = path.join(tmpRoot, ".vscode");
      await fs.ensureDir(configDir);
      const configPath = path.join(configDir, "zephyr-ide.json");
      await fs.writeJson(configPath, {
        projects: {
          app: {
            name: "app",
            relPath: "app",
            confFiles: { config: [], overlay: [] },
            twisterConfigs: {},
            buildConfigs: {
              debug: {
                name: "build/debug",
                board: "native_sim",
                relBoardDir: "",
                relBoardSubDir: "native/native_sim",
                westBuildArgs: [],
                westBuildCMakeArgs: [],
                confFiles: { config: [], overlay: [] },
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

      assert.strictEqual(wsConfig.projects.app.relPath, "app");
      assert.strictEqual(wsConfig.projects.app.buildConfigs.debug.relPath, undefined);
    } finally {
      await fs.remove(tmpRoot);
    }
  });

  test("loadProjectsFromFile rel_path migration is idempotent across two loads", async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zephyr-ide-rel-path-idempotent-"));
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
                westBuildArgs: [],
                westBuildCMakeArgs: [],
                confFiles: { config: [], overlay: [] },
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
      const afterFirst = await fs.readJson(configPath);

      const wsConfig2: WorkspaceConfig = {
        rootPath: tmpRoot,
        projects: {},
        initialSetupComplete: true,
        projectStates: {},
      };
      await loadProjectsFromFile(wsConfig2);
      const afterSecond = await fs.readJson(configPath);

      assert.deepStrictEqual(afterSecond, afterFirst, "File content must be identical after a second load");
      assert.strictEqual(wsConfig2.projects.app.relPath, "app");
    } finally {
      await fs.remove(tmpRoot);
    }
  });
});
