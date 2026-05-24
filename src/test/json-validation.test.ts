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
import * as path from "path";
import * as vscode from "vscode";
import { setZephyrIdeJsonValidation } from "../setup_utilities/json-validation";

type JsonSchemaEntry = { fileMatch?: string[]; url?: string; schema?: unknown };

suite("JSON Validation schema registration test suite", () => {
  const wsTarget = vscode.ConfigurationTarget.Workspace;
  const globalTarget = vscode.ConfigurationTarget.Global;
  const config = vscode.workspace.getConfiguration();
  let originalWorkspaceSchemas: JsonSchemaEntry[] | undefined;
  let originalGlobalSchemas: JsonSchemaEntry[] | undefined;

  function getWorkspaceSchemas(): JsonSchemaEntry[] | undefined {
    return config.inspect<JsonSchemaEntry[]>("json.schemas")?.workspaceValue;
  }

  async function getTestContext(): Promise<vscode.ExtensionContext> {
    const extension = vscode.extensions.getExtension("mylonics.zephyr-ide");
    if (!extension) {
      throw new Error("mylonics.zephyr-ide extension is not available in tests");
    }
    if (!extension.isActive) {
      await extension.activate();
    }
    return { extensionPath: extension.extensionPath } as vscode.ExtensionContext;
  }

  setup(async () => {
    const inspected = config.inspect<JsonSchemaEntry[]>("json.schemas");
    originalWorkspaceSchemas = inspected?.workspaceValue;
    originalGlobalSchemas = inspected?.globalValue;
    await config.update("json.schemas", undefined, wsTarget);
    await config.update("json.schemas", undefined, globalTarget);
  });

  teardown(async () => {
    await config.update("json.schemas", originalWorkspaceSchemas, wsTarget);
    await config.update("json.schemas", originalGlobalSchemas, globalTarget);
  });

  test("enable: adds zephyr-ide schema and preserves unrelated workspace schemas", async () => {
    const unrelatedSchema: JsonSchemaEntry = {
      fileMatch: ["**/other.json"],
      url: "https://example.com/other-schema.json",
    };
    await config.update("json.schemas", [unrelatedSchema], wsTarget);

    await setZephyrIdeJsonValidation(await getTestContext(), true);

    const workspaceSchemas = getWorkspaceSchemas() ?? [];
    assert.ok(
      workspaceSchemas.some((schema) => schema.url === unrelatedSchema.url),
      "Expected existing unrelated schema entries to be preserved"
    );

    const zephyrSchema = workspaceSchemas.find((schema) => typeof schema.url === "string" && schema.url.endsWith("/resources/zephyr-ide-schema.json"));
    assert.ok(zephyrSchema, "Expected zephyr-ide schema entry to be added");
    assert.deepStrictEqual(
      zephyrSchema?.fileMatch,
      ["zephyr-ide.json", "**/zephyr-ide.json"],
      "Expected zephyr-ide schema fileMatch to include non-.vscode paths"
    );
  });

  test("enable/disable: preserves effective global json.schemas entries", async () => {
    const globalSchema: JsonSchemaEntry = {
      fileMatch: ["**/global.json"],
      url: "https://example.com/global-schema.json",
    };
    await config.update("json.schemas", [globalSchema], globalTarget);

    const context = await getTestContext();
    await setZephyrIdeJsonValidation(context, true);
    await setZephyrIdeJsonValidation(context, false);

    const workspaceSchemas = getWorkspaceSchemas() ?? [];
    assert.ok(
      workspaceSchemas.some((schema) => schema.url === globalSchema.url),
      "Expected global json.schemas associations to be preserved in workspace override"
    );
    assert.ok(
      workspaceSchemas.every(
        (schema) => !(typeof schema.url === "string" && schema.url.endsWith("/resources/zephyr-ide-schema.json"))
      ),
      "Expected extension-managed zephyr-ide schema entry to be removed on disable"
    );
  });

  test("enable: replaces legacy .vscode fileMatch entry with zephyr-ide.json fileMatch", async () => {
    const legacyUrl = vscode.Uri.file(path.join((await getTestContext()).extensionPath, "resources", "zephyr-ide-schema.json")).toString();
    const legacyEntry: JsonSchemaEntry = {
      fileMatch: ["**/.vscode/zephyr-ide.json"],
      url: legacyUrl,
    };
    await config.update("json.schemas", [legacyEntry], wsTarget);

    await setZephyrIdeJsonValidation(await getTestContext(), true);

    const workspaceSchemas = getWorkspaceSchemas() ?? [];
    const zephyrSchema = workspaceSchemas.find((schema) => schema.url === legacyUrl);
    assert.ok(zephyrSchema, "Expected zephyr-ide schema entry to be present");
    assert.deepStrictEqual(
      zephyrSchema?.fileMatch,
      ["zephyr-ide.json", "**/zephyr-ide.json"],
      "Expected legacy .vscode match to be upgraded"
    );
  });
});
