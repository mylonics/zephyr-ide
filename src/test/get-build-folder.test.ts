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
import * as path from "upath";

import { getBuildFolder, ProjectConfig } from "../project_utilities/project";
import type { BuildConfig } from "../project_utilities/build_selector";
import type { WorkspaceConfig } from "../setup_utilities/types";

function makeWs(rootPath: string): WorkspaceConfig {
  return { rootPath } as unknown as WorkspaceConfig;
}

function makeProject(rel_path: string): ProjectConfig {
  return {
    name: path.basename(rel_path),
    rel_path,
    buildConfigs: {},
    confFiles: { config: [], overlay: [] },
    twisterConfigs: {},
  };
}

function makeBuild(name: string, rel_path?: string): BuildConfig {
  return { name, rel_path } as unknown as BuildConfig;
}

suite("getBuildFolder Test Suite", () => {
  test("defaults to project rel_path + build name when rel_path is absent", () => {
    const ws = makeWs("/workspace");
    const project = makeProject("apps/sensors/accel_polling");
    const build = makeBuild("build/nrf52840dk/nrf52840");
    assert.strictEqual(
      getBuildFolder(ws, project, build),
      path.join("/workspace", "apps/sensors/accel_polling", "build/nrf52840dk/nrf52840"),
    );
  });

  test("uses build rel_path relative to workspace root when set", () => {
    const ws = makeWs("/workspace");
    const project = makeProject("apps/sensors/accel_polling");
    const build = makeBuild("my_build", "build/nrf52840dk/nrf52840");
    assert.strictEqual(
      getBuildFolder(ws, project, build),
      path.join("/workspace", "build/nrf52840dk/nrf52840"),
    );
  });

  test("build rel_path can point outside the project folder", () => {
    const ws = makeWs("/workspace");
    const project = makeProject("apps/sensors/accel_polling");
    const build = makeBuild("custom_name", "shared_builds/accel");
    assert.strictEqual(
      getBuildFolder(ws, project, build),
      path.join("/workspace", "shared_builds/accel"),
    );
  });

  test("falls back to name-based path when rel_path is empty string", () => {
    const ws = makeWs("/workspace");
    const project = makeProject("apps/myapp");
    const build = makeBuild("build/debug", "");
    // empty string is falsy — should fall back to default
    assert.strictEqual(
      getBuildFolder(ws, project, build),
      path.join("/workspace", "apps/myapp", "build/debug"),
    );
  });

  test("falls back to default when rel_path is an absolute path", () => {
    const ws = makeWs("/workspace");
    const project = makeProject("apps/myapp");
    const build = makeBuild("my_build", "/absolute/build/path");
    // absolute rel_path is not allowed — should fall back to default
    assert.strictEqual(
      getBuildFolder(ws, project, build),
      path.join("/workspace", "apps/myapp", "my_build"),
    );
  });

  test("falls back to default when rel_path escapes the workspace root via ../", () => {
    const ws = makeWs("/workspace");
    const project = makeProject("apps/myapp");
    const build = makeBuild("my_build", "../../outside");
    // path.resolve('/workspace', '../../outside') => '/outside', escaping root
    assert.strictEqual(
      getBuildFolder(ws, project, build),
      path.join("/workspace", "apps/myapp", "my_build"),
    );
  });

  test("allows rel_path with internal .. that still stays within workspace root", () => {
    const ws = makeWs("/workspace");
    const project = makeProject("apps/myapp");
    const build = makeBuild("my_build", "apps/../shared_builds/out");
    // resolves to /workspace/shared_builds/out — still within root
    assert.strictEqual(
      getBuildFolder(ws, project, build),
      path.resolve("/workspace", "shared_builds/out"),
    );
  });

  test("handles Windows-style backslash separators in rel_path", () => {
    // Users may store rel_path with backslashes in zephyr-ide.json on Windows;
    // upath.toUnix() converts them so the path resolves correctly on all platforms.
    const ws = makeWs("/workspace");
    const project = makeProject("apps/myapp");
    const build = makeBuild("my_build", "shared_builds\\nrf52840");
    assert.strictEqual(
      getBuildFolder(ws, project, build),
      path.resolve("/workspace", "shared_builds/nrf52840"),
    );
  });

  test("falls back to default when rel_path resolves to the workspace root", () => {
    const ws = makeWs("/workspace");
    const project = makeProject("apps/myapp");

    for (const relPath of [".", "apps/.."]) {
      const build = makeBuild("my_build", relPath);
      assert.strictEqual(
        getBuildFolder(ws, project, build),
        path.join("/workspace", "apps/myapp", "my_build"),
      );
    }
  });
});
