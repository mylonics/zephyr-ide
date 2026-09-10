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
import * as vscode from "vscode";

import { BuildConfig } from "../project_utilities/build_selector";
import { ProjectConfig } from "../project_utilities/project";
import { WorkspaceConfig } from "../setup_utilities/types";
import { regenerateCompileCommands } from "../zephyr_utilities/build";

interface CompileCommandsFixture {
  rootPath: string;
  wsConfig: WorkspaceConfig;
  entries: string[];
}

function makeBuild(name: string): BuildConfig {
  return {
    name,
    board: "native_sim",
    westBuildArgs: [],
    westBuildCMakeArgs: [],
    confFiles: { config: [], overlay: [] },
  };
}

async function makeFixture(): Promise<CompileCommandsFixture> {
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "zephyr-ide-compile-commands-"));
  const projectNames = ["project-a", "project-b"];
  const projects: Record<string, ProjectConfig> = {};
  const entries: string[] = [];

  for (const projectName of projectNames) {
    const buildNames = projectName === "project-a" ? ["active-build", "other-build"] : ["other-project-build"];
    const buildConfigs = Object.fromEntries(buildNames.map((name) => [name, makeBuild(name)]));
    projects[projectName] = {
      name: projectName,
      relPath: projectName,
      buildConfigs,
      confFiles: { config: [], overlay: [] },
      twisterConfigs: {},
    };

    for (const buildName of buildNames) {
      const entry = `${projectName}/${buildName}`;
      entries.push(entry);
      await fs.outputJson(
        path.join(rootPath, projectName, buildName, "compile_commands.json"),
        [{ file: entry }],
      );
    }
  }

  return {
    rootPath,
    entries,
    wsConfig: {
      rootPath,
      projects,
      activeProject: "project-a",
      projectStates: {
        "project-a": { activeBuildConfig: "active-build", buildStates: {}, twisterStates: {} },
        "project-b": { buildStates: {}, twisterStates: {} },
      },
    },
  };
}

async function resetCompileCommandsMode(): Promise<void> {
  const config = vscode.workspace.getConfiguration();
  await config.update("zephyr-ide.compileCommandsMode", undefined, vscode.ConfigurationTarget.Workspace);
  await config.update("zephyr-ide.compileCommandsMode", undefined, vscode.ConfigurationTarget.Global);
}

async function readGeneratedEntries(rootPath: string): Promise<string[]> {
  const data = await fs.readJson(path.join(rootPath, ".vscode", "compile_commands.json"));
  return data.map((entry: { file: string }) => entry.file).sort();
}

suite("Compile Commands Mode Test Suite", () => {
  let fixture: CompileCommandsFixture;

  setup(async () => {
    await resetCompileCommandsMode();
    fixture = await makeFixture();
  });

  teardown(async () => {
    await resetCompileCommandsMode();
    await fs.remove(fixture.rootPath);
  });

  test("defaults to all projects and builds", async () => {
    await regenerateCompileCommands(fixture.wsConfig);

    assert.deepStrictEqual(await readGeneratedEntries(fixture.rootPath), fixture.entries.sort());
  });

  test("active mode includes only the active project build", async () => {
    await vscode.workspace.getConfiguration().update(
      "zephyr-ide.compileCommandsMode",
      "active",
      vscode.ConfigurationTarget.Workspace,
    );

    await regenerateCompileCommands(fixture.wsConfig);

    assert.deepStrictEqual(await readGeneratedEntries(fixture.rootPath), ["project-a/active-build"]);
  });

  test("active mode leaves existing compile commands unchanged when no active build resolves", async () => {
    await vscode.workspace.getConfiguration().update(
      "zephyr-ide.compileCommandsMode",
      "active",
      vscode.ConfigurationTarget.Workspace,
    );
    await fs.outputJson(
      path.join(fixture.rootPath, ".vscode", "compile_commands.json"),
      [{ file: "preserve/me" }],
    );
    fixture.wsConfig.projectStates["project-a"].activeBuildConfig = undefined;

    await regenerateCompileCommands(fixture.wsConfig);

    assert.deepStrictEqual(await readGeneratedEntries(fixture.rootPath), ["preserve/me"]);
  });

  test("project mode includes all builds in the active project", async () => {
    await vscode.workspace.getConfiguration().update(
      "zephyr-ide.compileCommandsMode",
      "project",
      vscode.ConfigurationTarget.Workspace,
    );

    await regenerateCompileCommands(fixture.wsConfig);

    assert.deepStrictEqual(
      await readGeneratedEntries(fixture.rootPath),
      ["project-a/active-build", "project-a/other-build"],
    );
  });

  test("invalid mode falls back to all projects and builds", async () => {
    await vscode.workspace.getConfiguration().update(
      "zephyr-ide.compileCommandsMode",
      "invalid",
      vscode.ConfigurationTarget.Workspace,
    );

    await regenerateCompileCommands(fixture.wsConfig);

    assert.deepStrictEqual(await readGeneratedEntries(fixture.rootPath), fixture.entries.sort());
  });
});
