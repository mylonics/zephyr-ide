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

import {
  getZephyrIdeToolchains,
  setZephyrIdeToolchains,
  getZephyrIdeBlobs,
  setZephyrIdeBlobs,
  readZephyrIdeJson,
} from "../setup_utilities/zephyr_ide_json";
import { WorkspaceConfig } from "../setup_utilities/types";

function makeWsConfig(rootPath: string): WorkspaceConfig {
  return {
    rootPath,
    projects: {},
    projectStates: {},
  };
}

suite("zephyr-ide.json toolchains/blobs Test Suite", () => {
  test("getZephyrIdeToolchains returns empty array when file is missing", async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zephyr-ide-tc-"));
    try {
      const ws = makeWsConfig(tmpRoot);
      assert.deepStrictEqual(getZephyrIdeToolchains(ws), []);
      assert.deepStrictEqual(getZephyrIdeBlobs(ws), []);
    } finally {
      await fs.remove(tmpRoot);
    }
  });

  test("setZephyrIdeToolchains creates file and persists list", async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zephyr-ide-tc-"));
    try {
      const ws = makeWsConfig(tmpRoot);
      await setZephyrIdeToolchains(ws, ["arm-zephyr-eabi", "riscv64-zephyr-elf"]);
      assert.deepStrictEqual(getZephyrIdeToolchains(ws), ["arm-zephyr-eabi", "riscv64-zephyr-elf"]);

      const onDisk = await fs.readJson(path.join(tmpRoot, ".vscode", "zephyr-ide.json"));
      assert.deepStrictEqual(onDisk.toolchains, ["arm-zephyr-eabi", "riscv64-zephyr-elf"]);
    } finally {
      await fs.remove(tmpRoot);
    }
  });

  test("setZephyrIdeToolchains preserves other top-level keys (e.g. projects, blobs)", async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zephyr-ide-tc-"));
    try {
      const ws = makeWsConfig(tmpRoot);
      const filePath = path.join(tmpRoot, ".vscode", "zephyr-ide.json");
      await fs.outputJson(filePath, {
        projects: { app: { name: "app", rel_path: "app" } },
        blobs: ["hal_nordic"],
        my_var: "value",
      });

      await setZephyrIdeToolchains(ws, ["arm-zephyr-eabi"]);

      const onDisk = await fs.readJson(filePath);
      assert.deepStrictEqual(onDisk.toolchains, ["arm-zephyr-eabi"]);
      assert.deepStrictEqual(onDisk.blobs, ["hal_nordic"]);
      assert.deepStrictEqual(onDisk.projects, { app: { name: "app", rel_path: "app" } });
      assert.strictEqual(onDisk.my_var, "value");
    } finally {
      await fs.remove(tmpRoot);
    }
  });

  test("setZephyrIdeBlobs preserves other top-level keys", async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zephyr-ide-tc-"));
    try {
      const ws = makeWsConfig(tmpRoot);
      const filePath = path.join(tmpRoot, ".vscode", "zephyr-ide.json");
      await fs.outputJson(filePath, {
        projects: { app: {} },
        toolchains: ["arm-zephyr-eabi"],
      });

      await setZephyrIdeBlobs(ws, ["hal_nordic", "hal_st"]);

      const onDisk = await fs.readJson(filePath);
      assert.deepStrictEqual(onDisk.blobs, ["hal_nordic", "hal_st"]);
      assert.deepStrictEqual(onDisk.toolchains, ["arm-zephyr-eabi"]);
      assert.deepStrictEqual(onDisk.projects, { app: {} });
    } finally {
      await fs.remove(tmpRoot);
    }
  });

  test("setZephyrIdeToolchains with empty list removes the key", async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zephyr-ide-tc-"));
    try {
      const ws = makeWsConfig(tmpRoot);
      await setZephyrIdeToolchains(ws, ["arm-zephyr-eabi"]);
      await setZephyrIdeToolchains(ws, []);

      const onDisk = readZephyrIdeJson(ws);
      assert.strictEqual(onDisk.toolchains, undefined);
    } finally {
      await fs.remove(tmpRoot);
    }
  });

  test("getZephyrIdeToolchains normalises malformed entries", async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zephyr-ide-tc-"));
    try {
      const ws = makeWsConfig(tmpRoot);
      const filePath = path.join(tmpRoot, ".vscode", "zephyr-ide.json");
      await fs.outputJson(filePath, {
        toolchains: ["arm-zephyr-eabi", "", "  riscv64-zephyr-elf  ", "arm-zephyr-eabi", 42, null],
      });
      assert.deepStrictEqual(getZephyrIdeToolchains(ws), ["arm-zephyr-eabi", "riscv64-zephyr-elf"]);
    } finally {
      await fs.remove(tmpRoot);
    }
  });
});
