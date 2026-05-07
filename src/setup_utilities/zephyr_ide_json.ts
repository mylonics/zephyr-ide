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
 * Read / write helpers for shared workspace requirements stored in
 * `.vscode/zephyr-ide.json`.
 *
 * The same file is also used for project / build configuration (see
 * `workspace-config.ts` and `project_info.ts`); these helpers preserve any
 * top-level keys they don't manage so the two responsibilities can coexist.
 *
 * Keys managed here:
 *   - `toolchains`: string[]  Zephyr SDK toolchain names (e.g. `arm-zephyr-eabi`)
 *                             that the workspace requires.
 *   - `blobs`: string[]       West module names whose binary blobs should be
 *                             fetched (`west blobs fetch <module>`).
 *   - `sdkVersion`: string    Optional Zephyr SDK version to install when the
 *                             auto-install hook needs to bootstrap an SDK. If
 *                             omitted, the version recorded in the Zephyr
 *                             source tree's `SDK_VERSION` file is used; if
 *                             that's also unavailable, the latest released
 *                             SDK is installed.
 *   - `sampleProjects`: string[]  Paths (relative to the workspace root) to
 *                             project directories that can be optionally loaded
 *                             into the workspace. Unlike `projects`, these are
 *                             NOT loaded automatically on startup. They can be
 *                             added during workspace setup or later via the
 *                             `zephyr-ide.add-sample-projects-from-file` command.
 *
 * When either array is present, the workspace setup flow installs the missing
 * items automatically; the user can also manage them via the SDK panel or via
 * the command palette commands `zephyr-ide.modify-zephyr-ide-toolchains`,
 * `zephyr-ide.install-zephyr-ide-toolchains`, `zephyr-ide.modify-zephyr-ide-blobs`,
 * and `zephyr-ide.install-zephyr-ide-blobs`.
 */

import * as fs from "fs-extra";
import * as path from "upath";

import { WorkspaceConfig } from "./types";
import { outputError } from "../utilities/output";

function getZephyrIdeJsonPath(wsConfig: WorkspaceConfig): string {
    return path.join(wsConfig.rootPath, ".vscode", "zephyr-ide.json");
}

/** Read the raw zephyr-ide.json object, or `{}` if it doesn't exist / is unreadable. */
export function readZephyrIdeJson(wsConfig: WorkspaceConfig): Record<string, any> {
    const filePath = getZephyrIdeJsonPath(wsConfig);
    try {
        if (fs.pathExistsSync(filePath)) {
            const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
            // Reject arrays, null, and other non-plain-object values: the
            // helpers below assume the file is a JSON object so they can add
            // / remove keys without losing data.
            if (
                parsed !== null &&
                typeof parsed === "object" &&
                !Array.isArray(parsed)
            ) {
                return parsed;
            }
        }
    } catch (error) {
        outputError("Zephyr IDE JSON", `Failed to read zephyr-ide.json: ${String(error)}`);
    }
    return {};
}

/**
 * Persist `data` to `.vscode/zephyr-ide.json`. Creates parent directories as
 * needed. Caller is responsible for round-tripping any keys it wants to
 * preserve.
 */
export async function writeZephyrIdeJson(wsConfig: WorkspaceConfig, data: Record<string, any>): Promise<void> {
    const filePath = getZephyrIdeJsonPath(wsConfig);
    try {
        await fs.outputFile(filePath, JSON.stringify(data, null, 2));
    } catch (error) {
        outputError("Zephyr IDE JSON", `Failed to write zephyr-ide.json: ${String(error)}`);
    }
}

/** Sanitize a list of strings: trim, drop empties, dedupe (preserve order). */
function normalizeStringList(values: unknown): string[] {
    if (!Array.isArray(values)) { return []; }
    const seen = new Set<string>();
    const out: string[] = [];
    for (const v of values) {
        if (typeof v !== "string") { continue; }
        const trimmed = v.trim();
        if (!trimmed || seen.has(trimmed)) { continue; }
        seen.add(trimmed);
        out.push(trimmed);
    }
    return out;
}

/** Get the list of required toolchains declared in zephyr-ide.json. */
export function getZephyrIdeToolchains(wsConfig: WorkspaceConfig): string[] {
    return normalizeStringList(readZephyrIdeJson(wsConfig).toolchains);
}

/**
 * Replace the `toolchains` key in zephyr-ide.json with `toolchains`.
 * If `toolchains` is empty the key is removed. All other top-level keys are
 * preserved.
 */
export async function setZephyrIdeToolchains(wsConfig: WorkspaceConfig, toolchains: string[]): Promise<void> {
    const data = readZephyrIdeJson(wsConfig);
    const normalized = normalizeStringList(toolchains);
    if (normalized.length === 0) {
        delete data.toolchains;
    } else {
        data.toolchains = normalized;
    }
    await writeZephyrIdeJson(wsConfig, data);
}

/** Get the list of required blob-providing modules declared in zephyr-ide.json. */
export function getZephyrIdeBlobs(wsConfig: WorkspaceConfig): string[] {
    return normalizeStringList(readZephyrIdeJson(wsConfig).blobs);
}

/**
 * Get the optional Zephyr SDK version declared in zephyr-ide.json. Returns
 * `undefined` when the key is absent or not a non-empty string.
 */
export function getZephyrIdeSdkVersion(wsConfig: WorkspaceConfig): string | undefined {
    const value = readZephyrIdeJson(wsConfig).sdkVersion;
    if (typeof value !== "string") { return undefined; }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Replace the `sdkVersion` key in zephyr-ide.json. Pass `undefined` (or an
 * empty / whitespace-only string) to remove the key. All other top-level
 * keys are preserved.
 */
export async function setZephyrIdeSdkVersion(wsConfig: WorkspaceConfig, sdkVersion: string | undefined): Promise<void> {
    const data = readZephyrIdeJson(wsConfig);
    const trimmed = (typeof sdkVersion === "string") ? sdkVersion.trim() : "";
    if (!trimmed) {
        delete data.sdkVersion;
    } else {
        data.sdkVersion = trimmed;
    }
    await writeZephyrIdeJson(wsConfig, data);
}

/**
 * Get the list of optional sample project paths declared in zephyr-ide.json.
 * Each entry is a path relative to the workspace root pointing to an existing
 * project directory. Returns an empty array when the key is absent.
 */
export function getZephyrIdeSampleProjects(wsConfig: WorkspaceConfig): string[] {
    return normalizeStringList(readZephyrIdeJson(wsConfig).sampleProjects);
}

/**
 * Replace the `sampleProjects` key in zephyr-ide.json with the provided list.
 * If `sampleProjects` is empty the key is removed. All other top-level keys
 * are preserved.
 */
export async function setZephyrIdeSampleProjects(wsConfig: WorkspaceConfig, sampleProjects: string[]): Promise<void> {
    const data = readZephyrIdeJson(wsConfig);
    const normalized = normalizeStringList(sampleProjects);
    if (normalized.length === 0) {
        delete data.sampleProjects;
    } else {
        data.sampleProjects = normalized;
    }
    await writeZephyrIdeJson(wsConfig, data);
}

/**
 * Replace the `blobs` key in zephyr-ide.json with `blobs`.
 * If `blobs` is empty the key is removed. All other top-level keys are
 * preserved.
 */
export async function setZephyrIdeBlobs(wsConfig: WorkspaceConfig, blobs: string[]): Promise<void> {
    const data = readZephyrIdeJson(wsConfig);
    const normalized = normalizeStringList(blobs);
    if (normalized.length === 0) {
        delete data.blobs;
    } else {
        data.blobs = normalized;
    }
    await writeZephyrIdeJson(wsConfig, data);
}
