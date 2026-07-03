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
 *   - `sampleProjects`: ProjectConfig[]  Project configuration snapshots for
 *                             project directories that can be optionally loaded
 *                             into the workspace. Unlike `projects`, these are
 *                             NOT loaded automatically on startup. They include
 *                             a `rel_path` (relative to workspace root) plus any
 *                             build configurations declared for each sample.
 *                             A plain string entry (just a path) is also accepted
 *                             for backward compatibility.
 *                             Samples can be added during workspace setup or
 *                             later via the
 *                             `zephyr-ide.add-sample-projects-from-file` command.
 *   - `pipPackages`: string[] Additional Python package specifiers that should
 *                             be installed in the workspace's Python environment.
 *                             The user is prompted before installation for security.
 *   - `pipRequirements`: string[] Relative paths (from workspace root) or
 *                             absolute paths to `requirements.txt`-style files
 *                             whose packages
 *                             should be installed in the workspace's Python
 *                             environment alongside any `pipPackages`. Both
 *                             fields are installed together after explicit
 *                             user confirmation during workspace setup, or via
 *                             the user-invoked install action.
 *   - `commands`: { linux?: string[], windows?: string[], mac?: string[] }
 *                             Platform-specific terminal commands to run after
 *                             workspace setup. The user is prompted via a
 *                             multiselect quickpick to choose which commands to
 *                             run, maintaining the order from the JSON file.
 *
 * When `toolchains` or `blobs` arrays are present, the workspace setup flow
 * installs the missing items automatically; the user can also manage them via
 * the SDK panel or via the command palette commands
 * `zephyr-ide.modify-zephyr-ide-toolchains`, `zephyr-ide.install-zephyr-ide-toolchains`,
 * `zephyr-ide.modify-zephyr-ide-blobs`, and `zephyr-ide.install-zephyr-ide-blobs`.
 * `sampleProjects` entries are never loaded or installed automatically.
 */

import * as fs from "fs-extra";
import * as path from "upath";

import { WorkspaceConfig } from "./types";
import { outputError } from "../utilities/output";
// Type-only import: erased at compile time, avoiding a runtime circular
// dependency (project.ts imports getZephyrIdeSampleProjects from this file).
import type { ProjectConfig } from "../project_utilities/project";
import { markZephyrIdeJsonWrite } from "./zephyr-ide-json-write-guard";

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
        markZephyrIdeJsonWrite();
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

/** Resolve a pip requirements path from zephyr-ide.json to an absolute path. */
export function resolveZephyrIdePipRequirementsPath(wsConfig: WorkspaceConfig, requirementPath: string): string {
    return path.isAbsolute(requirementPath)
        ? requirementPath
        : path.join(wsConfig.rootPath, requirementPath);
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
 * Get the list of optional sample project entries declared in zephyr-ide.json.
 * Each entry is a full `ProjectConfig` snapshot (including any stored build
 * configurations). Plain string entries (just a path) are accepted for backward
 * compatibility and are promoted to a minimal `ProjectConfig`.
 * Returns an empty array when the key is absent.
 */
export function getZephyrIdeSampleProjects(wsConfig: WorkspaceConfig): ProjectConfig[] {
    const raw = readZephyrIdeJson(wsConfig).sampleProjects;
    if (!Array.isArray(raw)) { return []; }
    const out: ProjectConfig[] = [];
    const seenPaths = new Set<string>();
    for (const entry of raw) {
        if (typeof entry === "string") {
            // Legacy format: plain path string.
            const relPath = entry.trim();
            if (!relPath || seenPaths.has(relPath)) { continue; }
            seenPaths.add(relPath);
            out.push({
                name: path.basename(relPath),
                rel_path: relPath,
                buildConfigs: {},
                confFiles: { config: [], overlay: [] },
                twisterConfigs: {},
            });
        } else if (
            entry !== null &&
            typeof entry === "object" &&
            !Array.isArray(entry) &&
            typeof (entry as Record<string, unknown>).rel_path === "string"
        ) {
            const relPath = ((entry as Record<string, unknown>).rel_path as string).trim();
            if (!relPath || seenPaths.has(relPath)) { continue; }
            seenPaths.add(relPath);
            out.push(entry as ProjectConfig);
        }
    }
    return out;
}

/**
 * Replace the `sampleProjects` key in zephyr-ide.json with the provided list
 * of `ProjectConfig` snapshots. Each entry's full configuration (build configs,
 * conf files, etc.) is persisted so future runs can detect settings changes.
 * If the list is empty the key is removed. All other top-level keys are preserved.
 */
export async function setZephyrIdeSampleProjects(wsConfig: WorkspaceConfig, projects: ProjectConfig[]): Promise<void> {
    const data = readZephyrIdeJson(wsConfig);
    if (projects.length === 0) {
        delete data.sampleProjects;
    } else {
        data.sampleProjects = projects;
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

/** Get the list of additional pip packages declared in zephyr-ide.json. */
export function getZephyrIdePipPackages(wsConfig: WorkspaceConfig): string[] {
    return normalizeStringList(readZephyrIdeJson(wsConfig).pipPackages);
}

/**
 * Replace the `pipPackages` key in zephyr-ide.json with `packages`.
 * If `packages` is empty the key is removed. All other top-level keys are
 * preserved.
 */
export async function setZephyrIdePipPackages(wsConfig: WorkspaceConfig, packages: string[]): Promise<void> {
    const data = readZephyrIdeJson(wsConfig);
    const normalized = normalizeStringList(packages);
    if (normalized.length === 0) {
        delete data.pipPackages;
    } else {
        data.pipPackages = normalized;
    }
    await writeZephyrIdeJson(wsConfig, data);
}

/** Get the list of additional pip requirements files declared in zephyr-ide.json. */
export function getZephyrIdePipRequirements(wsConfig: WorkspaceConfig): string[] {
    return normalizeStringList(readZephyrIdeJson(wsConfig).pipRequirements);
}

/**
 * Replace the `pipRequirements` key in zephyr-ide.json with `requirements`.
 * If `requirements` is empty the key is removed. All other top-level keys are
 * preserved.
 */
export async function setZephyrIdePipRequirements(wsConfig: WorkspaceConfig, requirements: string[]): Promise<void> {
    const data = readZephyrIdeJson(wsConfig);
    const normalized = normalizeStringList(requirements);
    if (normalized.length === 0) {
        delete data.pipRequirements;
    } else {
        data.pipRequirements = normalized;
    }
    await writeZephyrIdeJson(wsConfig, data);
}

/**
 * Platform-specific terminal command lists declared in zephyr-ide.json.
 * Each key maps to an ordered array of shell commands to run after workspace
 * setup completes.  The user is prompted via a multiselect quickpick to
 * choose which commands to execute, so no command runs without consent.
 */
export interface ZephyrIdeCommands {
    linux?: string[];
    windows?: string[];
    mac?: string[];
}

/**
 * Get the platform-specific commands object declared in zephyr-ide.json.
 * Returns an empty object when the key is absent or not a plain object.
 */
export function getZephyrIdeCommands(wsConfig: WorkspaceConfig): ZephyrIdeCommands {
    const value = readZephyrIdeJson(wsConfig).commands;
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        return {};
    }
    const result: ZephyrIdeCommands = {};
    const raw = value as Record<string, unknown>;
    if (Array.isArray(raw.linux)) {
        result.linux = normalizeStringList(raw.linux);
    }
    if (Array.isArray(raw.windows)) {
        result.windows = normalizeStringList(raw.windows);
    }
    if (Array.isArray(raw.mac)) {
        result.mac = normalizeStringList(raw.mac);
    }
    return result;
}

/**
 * Replace the `commands` key in zephyr-ide.json.
 * Empty platform lists are omitted; if all platforms are empty the key is
 * removed entirely. All other top-level keys are preserved.
 */
export async function setZephyrIdeCommands(wsConfig: WorkspaceConfig, commands: ZephyrIdeCommands): Promise<void> {
    const data = readZephyrIdeJson(wsConfig);
    const linux = normalizeStringList(commands.linux ?? []);
    const windows = normalizeStringList(commands.windows ?? []);
    const mac = normalizeStringList(commands.mac ?? []);
    if (linux.length === 0 && windows.length === 0 && mac.length === 0) {
        delete data.commands;
    } else {
        const entry: Record<string, string[]> = {};
        if (linux.length > 0) { entry.linux = linux; }
        if (windows.length > 0) { entry.windows = windows; }
        if (mac.length > 0) { entry.mac = mac; }
        data.commands = entry;
    }
    await writeZephyrIdeJson(wsConfig, data);
}
