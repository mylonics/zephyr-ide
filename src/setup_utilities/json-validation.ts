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

/**
 * Manages the JSON schema association for `zephyr-ide.json` via the
 * `json.schemas` workspace setting.  When enabled, VS Code's built-in JSON
 * language server validates the file against the bundled schema and provides
 * IntelliSense (completions, hover docs, diagnostics).
 *
 * Controlled by the `zephyr-ide.enableJsonValidation` setting (default: true).
 */

import * as vscode from "vscode";
import * as path from "path";
import { outputInfo, outputWarning } from "../utilities/output";

/** Shape of an entry in the VS Code `json.schemas` workspace setting. */
interface JsonSchemaEntry {
  fileMatch?: string[];
  url?: string;
  schema?: unknown;
}

/** fileMatch patterns used to associate the schema with zephyr-ide.json files. */
const ZEPHYR_IDE_JSON_FILE_MATCHES = ["zephyr-ide.json", "**/zephyr-ide.json"] as const;
const LEGACY_ZEPHYR_IDE_JSON_FILE_MATCH = "**/.vscode/zephyr-ide.json";

/**
 * Enable or disable JSON schema validation for `zephyr-ide.json`.
 *
 * When `enable` is true, an entry is added to the `json.schemas` workspace
 * setting pointing at the bundled schema file. When false, any previously
 * added entry is removed.
 *
 * No-ops silently when no workspace folder is open.
 */
export async function setZephyrIdeJsonValidation(
  context: vscode.ExtensionContext,
  enable: boolean
): Promise<void> {
  const configuration = vscode.workspace.getConfiguration();
  const target = vscode.ConfigurationTarget.Workspace;

  // json.schemas requires a workspace folder; bail out gracefully when none is open.
  if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
    return;
  }

  const schemaUrl = vscode.Uri.file(
    path.join(context.extensionPath, "resources", "zephyr-ide-schema.json")
  ).toString();

  const currentSchemasValue = configuration.get<JsonSchemaEntry[]>("json.schemas");
  const currentSchemas: JsonSchemaEntry[] = Array.isArray(currentSchemasValue) ? currentSchemasValue : [];

  // Remove any existing zephyr-ide.json entry added by this extension.
  const filtered = currentSchemas.filter(
    (s) => {
      const hasLegacyMatch =
        Array.isArray(s?.fileMatch) &&
        s.fileMatch.includes(LEGACY_ZEPHYR_IDE_JSON_FILE_MATCH);
      const isExtensionSchema =
        typeof s?.url === "string" &&
        (s.url === schemaUrl || s.url.endsWith("/resources/zephyr-ide-schema.json"));
      return !hasLegacyMatch && !isExtensionSchema;
    }
  );

  let newSchemas: JsonSchemaEntry[];
  if (enable) {
    newSchemas = [
      ...filtered,
      { fileMatch: [...ZEPHYR_IDE_JSON_FILE_MATCHES], url: schemaUrl },
    ];
  } else {
    newSchemas = filtered;
  }

  // Skip the write when nothing actually changed.
  if (JSON.stringify(newSchemas) === JSON.stringify(currentSchemas)) {
    return;
  }

  try {
    await configuration.update(
      "json.schemas",
      newSchemas.length > 0 ? newSchemas : undefined,
      target
    );
    outputInfo(
      "JSON Validation",
      enable
        ? "Enabled JSON schema validation for zephyr-ide.json."
        : "Disabled JSON schema validation for zephyr-ide.json."
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    outputWarning("JSON Validation", `Failed to update json.schemas: ${detail}`);
  }
}
