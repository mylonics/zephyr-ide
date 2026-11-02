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
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { ConfigItem, ProjectConfigView } from "../tree_views/ProjectConfigView";
import { WorkspaceConfig } from "../setup_utilities/types";

suite("Board DTS opening", () => {
  let rootPath: string;
  let boardPath: string;

  setup(() => {
    rootPath = fs.mkdtempSync(path.join(os.tmpdir(), "zide-board-dts-"));
    boardPath = path.join(rootPath, "boards", "vendor", "apex");
    fs.mkdirSync(boardPath, { recursive: true });
  });

  teardown(async () => {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    fs.rmSync(rootPath, { recursive: true, force: true });
  });

  async function openBoardDts(board: string, filenames: string[], expected: string, absoluteBoardPath = false) {
    for (const filename of filenames) {
      const filePath = path.join(boardPath, filename);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, "/dts-v1/;\n/ {};\n");
    }
    const context = {
      workspaceState: {
        get: () => undefined,
        update: async () => {},
      },
    } as unknown as vscode.ExtensionContext;
    const wsConfig = {
      rootPath,
      projects: {
        app: {
          buildConfigs: {
            debug: {
              board,
              relBoardDir: absoluteBoardPath ? undefined : "boards/vendor",
              relBoardSubDir: absoluteBoardPath ? boardPath : "apex",
            },
          },
        },
      },
      projectStates: { app: {} },
    } as unknown as WorkspaceConfig;
    const view = new ProjectConfigView(rootPath, context, wsConfig);
    const item = new ConfigItem("debug", "gear", false);
    item.data = { project: "app", build: "debug" };

    await view.handleOpenBoardDtc(item);

    assert.strictEqual(
      vscode.window.activeTextEditor?.document.uri.fsPath,
      vscode.Uri.file(path.join(boardPath, expected)).fsPath,
    );
    assert.strictEqual(vscode.window.activeTextEditor?.document.isUntitled, false);
  }

  test("opens the single-SoC board DTS for a qualified target", async () => {
    await openBoardDts("apex/stm32f411xe", ["apex.dts"], "apex.dts");
  });

  test("opens the board DTS with multiple qualifiers and an absolute board directory", async () => {
    await openBoardDts("apex/stm32f411xe/ns", ["apex.dts"], "apex.dts", true);
  });

  test("still opens an unqualified board target", async () => {
    await openBoardDts("apex", ["apex.dts"], "apex.dts");
  });

  for (const filename of ["apex_stm32f411xe.dts", "apex/stm32f411xe.dts", "stm32f411xe.dts"]) {
    test(`prefers the existing candidate ${filename} over the unqualified fallback`, async () => {
      await openBoardDts("apex/stm32f411xe", [filename, "apex.dts"], filename);
    });
  }
});
