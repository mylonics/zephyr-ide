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
import * as vscode from "vscode";
import { isZephyrIdeJsonDocument } from "../extension";

suite("Extension JSON validation activation helpers", () => {
  function mockDocument(filePath: string): vscode.TextDocument {
    return { uri: vscode.Uri.file(filePath) } as vscode.TextDocument;
  }

  function mockDocumentFromUri(uri: vscode.Uri): vscode.TextDocument {
    return { uri } as vscode.TextDocument;
  }

  test("isZephyrIdeJsonDocument: matches zephyr-ide.json files", () => {
    assert.ok(isZephyrIdeJsonDocument(mockDocument("/tmp/workspace/.vscode/zephyr-ide.json")));
    assert.ok(isZephyrIdeJsonDocument(mockDocument("C:/repo/.vscode/Zephyr-IDE.json")));
    assert.ok(isZephyrIdeJsonDocument(mockDocumentFromUri(vscode.Uri.parse("untitled:zephyr-ide.json"))));
    assert.ok(
      isZephyrIdeJsonDocument(
        mockDocumentFromUri(
          vscode.Uri.parse("vscode-remote://ssh-remote+host/workspace/.vscode/zephyr-ide.json")
        )
      )
    );
  });

  test("isZephyrIdeJsonDocument: rejects non-target file names", () => {
    assert.strictEqual(isZephyrIdeJsonDocument(mockDocument("/tmp/workspace/.vscode/settings.json")), false);
    assert.strictEqual(isZephyrIdeJsonDocument(mockDocument("/tmp/workspace/.vscode/zephyr-ide.json.bak")), false);
  });
});
