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

import { resolveBoardRoot, resolveBoardPath, resolveBoardRootArg } from "../project_utilities/project";
import type { WorkspaceConfig } from "../setup_utilities/types";

function makeWs(rootPath: string): WorkspaceConfig {
  return { rootPath } as unknown as WorkspaceConfig;
}

const setupState = { zephyrDir: "/opt/zephyr" };

suite("resolveBoardRoot", () => {
  test("returns undefined when relBoardDir is not set", () => {
    const ws = makeWs("/workspace");
    assert.strictEqual(resolveBoardRoot(ws, {}), undefined);
  });

  test("returns undefined when relBoardDir is empty string", () => {
    const ws = makeWs("/workspace");
    assert.strictEqual(resolveBoardRoot(ws, { relBoardDir: "" }), undefined);
  });

  test("returns parent directory when relBoardDir is set", () => {
    const ws = makeWs("/workspace");
    const result = resolveBoardRoot(ws, { relBoardDir: "boards/vendor/my_board" });
    // dirname of /workspace/boards/vendor/my_board = /workspace/boards/vendor
    assert.strictEqual(result, "/workspace/boards/vendor");
  });

  test("does NOT fall back to zephyr dir when relBoardDir is absent", () => {
    // Previously this would return setupState.zephyrDir — it must not any more.
    const ws = makeWs("/workspace");
    const result = resolveBoardRoot(ws, {});
    assert.strictEqual(result, undefined);
  });
});

suite("resolveBoardRootArg", () => {
  test("returns empty string when relBoardDir is not set", () => {
    const ws = makeWs("/workspace");
    assert.strictEqual(resolveBoardRootArg(ws, {}), "");
  });

  test("returns empty string when relBoardDir is empty string", () => {
    const ws = makeWs("/workspace");
    assert.strictEqual(resolveBoardRootArg(ws, { relBoardDir: "" }), "");
  });

  test("returns BOARD_ROOT cmake def when relBoardDir is set", () => {
    const ws = makeWs("/workspace");
    const result = resolveBoardRootArg(ws, { relBoardDir: "boards/vendor/my_board" });
    assert.ok(result.includes("-DBOARD_ROOT="), `expected BOARD_ROOT in: ${result}`);
    assert.ok(result.includes("/workspace/boards/vendor"), `expected board root path in: ${result}`);
  });
});

suite("resolveBoardPath", () => {
  test("returns undefined when relBoardSubDir is empty and relBoardDir is not set", () => {
    const ws = makeWs("/workspace");
    assert.strictEqual(resolveBoardPath(ws, {}, setupState), undefined);
  });

  test("returns undefined when relBoardSubDir is undefined and relBoardDir is not set", () => {
    const ws = makeWs("/workspace");
    assert.strictEqual(resolveBoardPath(ws, { relBoardSubDir: undefined }, setupState), undefined);
  });

  test("returns absolute path when relBoardSubDir is absolute", () => {
    const ws = makeWs("/workspace");
    const result = resolveBoardPath(ws, { relBoardSubDir: "/abs/path/to/board" }, setupState);
    assert.strictEqual(result, "/abs/path/to/board");
  });

  test("uses relBoardDir + relBoardSubDir when relBoardDir is set", () => {
    const ws = makeWs("/workspace");
    const result = resolveBoardPath(ws, { relBoardDir: "boards/vendor", relBoardSubDir: "my_board" }, setupState);
    assert.strictEqual(result, "/workspace/boards/vendor/my_board");
  });

  test("uses zephyr boards dir when only relBoardSubDir is set", () => {
    const ws = makeWs("/workspace");
    const result = resolveBoardPath(ws, { relBoardSubDir: "arm/nrf52840dk" }, setupState);
    assert.strictEqual(result, "/opt/zephyr/boards/arm/nrf52840dk");
  });

  test("returns undefined when relBoardSubDir is empty and no zephyr setupState", () => {
    const ws = makeWs("/workspace");
    assert.strictEqual(resolveBoardPath(ws, { relBoardSubDir: "" }), undefined);
  });

  test("returns relBoardDir path even when relBoardSubDir is empty", () => {
    const ws = makeWs("/workspace");
    const result = resolveBoardPath(ws, { relBoardDir: "boards/vendor", relBoardSubDir: "" }, setupState);
    assert.strictEqual(result, "/workspace/boards/vendor");
  });

  test("uses zephyr boards dir when relBoardDir is empty string and relBoardSubDir is set", () => {
    // empty relBoardDir should behave the same as absent relBoardDir
    const ws = makeWs("/workspace");
    const result = resolveBoardPath(ws, { relBoardDir: "", relBoardSubDir: "arm/nrf52840dk" }, setupState);
    assert.strictEqual(result, "/opt/zephyr/boards/arm/nrf52840dk");
  });
});
