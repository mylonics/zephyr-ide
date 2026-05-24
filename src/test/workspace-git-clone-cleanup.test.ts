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
import { inspectWorkspaceForGitClone } from "../setup_utilities/workspace-setup";

suite("Workspace Git Clone cleanup inspection test suite", () => {
  let tmpRoot: string;
  const extensionPath = path.resolve(__dirname, "..", "..");

  setup(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zephyr-ide-git-cleanup-"));
  });

  teardown(async () => {
    await fs.remove(tmpRoot);
  });

  test("marks extension-created .vscode and .gitignore as removable", async () => {
    await fs.copy(
      path.join(extensionPath, "resources", "git_ignores", "gitignore_workspace_install"),
      path.join(tmpRoot, ".gitignore")
    );
    await fs.copy(
      path.join(extensionPath, "resources", "recommendations", "extensions.json"),
      path.join(tmpRoot, ".vscode", "extensions.json")
    );

    await fs.writeJson(path.join(tmpRoot, ".vscode", "settings.json"), {
      "terminal.integrated.defaultProfile.linux": "Zephyr IDE Terminal",
      "cmake.configureOnOpen": false,
    }, { spaces: 2 });

    const inspection = await inspectWorkspaceForGitClone(tmpRoot, extensionPath);
    assert.deepStrictEqual(inspection.unexpectedEntries, []);
    assert.deepStrictEqual(new Set(inspection.removableEntries), new Set([".vscode", ".gitignore"]));
  });

  test("treats non-template .gitignore as unexpected", async () => {
    await fs.writeFile(path.join(tmpRoot, ".gitignore"), "build/\n");

    const inspection = await inspectWorkspaceForGitClone(tmpRoot, extensionPath);
    assert.deepStrictEqual(inspection.removableEntries, []);
    assert.deepStrictEqual(inspection.unexpectedEntries, [".gitignore"]);
  });

  test("treats user files inside .vscode as unexpected", async () => {
    await fs.ensureDir(path.join(tmpRoot, ".vscode"));
    await fs.writeFile(path.join(tmpRoot, ".vscode", "launch.json"), "{}");

    const inspection = await inspectWorkspaceForGitClone(tmpRoot, extensionPath);
    assert.deepStrictEqual(inspection.removableEntries, []);
    assert.deepStrictEqual(inspection.unexpectedEntries, [".vscode"]);
  });

  test("allows removing an empty .vscode directory", async () => {
    await fs.ensureDir(path.join(tmpRoot, ".vscode"));

    const inspection = await inspectWorkspaceForGitClone(tmpRoot, extensionPath);
    assert.deepStrictEqual(inspection.unexpectedEntries, []);
    assert.deepStrictEqual(inspection.removableEntries, [".vscode"]);
  });

  test("allows removing .vscode/settings.json when it is empty", async () => {
    await fs.writeJson(path.join(tmpRoot, ".vscode", "settings.json"), {}, { spaces: 2 });

    const inspection = await inspectWorkspaceForGitClone(tmpRoot, extensionPath);
    assert.deepStrictEqual(inspection.unexpectedEntries, []);
    assert.deepStrictEqual(inspection.removableEntries, [".vscode"]);
  });

  test("treats non-extension settings keys in .vscode/settings.json as unexpected", async () => {
    await fs.writeJson(path.join(tmpRoot, ".vscode", "settings.json"), {
      "files.trimTrailingWhitespace": true,
    }, { spaces: 2 });

    const inspection = await inspectWorkspaceForGitClone(tmpRoot, extensionPath);
    assert.deepStrictEqual(inspection.removableEntries, []);
    assert.deepStrictEqual(inspection.unexpectedEntries, [".vscode"]);
  });

  test("treats modified extension-managed settings values as unexpected", async () => {
    await fs.writeJson(path.join(tmpRoot, ".vscode", "settings.json"), {
      "terminal.integrated.defaultProfile.linux": "bash",
    }, { spaces: 2 });

    const inspection = await inspectWorkspaceForGitClone(tmpRoot, extensionPath);
    assert.deepStrictEqual(inspection.removableEntries, []);
    assert.deepStrictEqual(inspection.unexpectedEntries, [".vscode"]);
  });
});
