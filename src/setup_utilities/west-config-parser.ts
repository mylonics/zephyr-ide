/*
Copyright 2024 mylonics 
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

import * as fs from "fs";
import * as path from "path";
import { outputWarning } from "../utilities/output";

export interface WestManifestConfig {
    path?: string;
    file?: string;
}

function stripOptionalQuotes(value: string): string {
    const trimmed = value.trim();
    if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
        return trimmed.slice(1, -1);
    }
    return trimmed;
}

function parseWestManifestConfigFromIni(configContent: string): WestManifestConfig {
    let manifestPath: string | undefined;
    let manifestFile: string | undefined;
    let inManifestSection = false;

    for (const line of configContent.split(/\r?\n/)) {
        const trimmedLine = line.trim();

        if (trimmedLine === '[manifest]') {
            inManifestSection = true;
            continue;
        }

        if (trimmedLine.startsWith('[') && trimmedLine !== '[manifest]') {
            inManifestSection = false;
            continue;
        }

        if (!inManifestSection) {
            continue;
        }

        if (!trimmedLine || trimmedLine.startsWith('#') || trimmedLine.startsWith(';')) {
            continue;
        }

        const eqIndex = trimmedLine.indexOf('=');
        if (eqIndex <= 0) {
            continue;
        }

        const key = trimmedLine.substring(0, eqIndex).trim();
        const value = stripOptionalQuotes(trimmedLine.substring(eqIndex + 1));
        if (key === 'path') {
            manifestPath = value;
        } else if (key === 'file') {
            manifestFile = value;
        }
    }

    return { path: manifestPath, file: manifestFile };
}

/**
 * Parse the manifest path from .west/config file
 * Returns the full path to west.yml or null if not found
 */
export function parseWestConfigManifestPath(setupPath: string): string | null {
    const westConfigPath = path.join(setupPath, ".west", "config");

    try {
        // Check if .west/config exists
        if (!fs.existsSync(westConfigPath)) {
            outputWarning("West Config", `.west/config not found at: ${westConfigPath} (setupPath: ${setupPath}). Run 'west init' to initialize the workspace.`);
            return null;
        }

        // Read .west/config file
        const configContent = fs.readFileSync(westConfigPath, "utf8");
        const manifest = parseWestManifestConfigFromIni(configContent);

        if (manifest.path) {
            const westYmlPath = path.join(setupPath, manifest.path, "west.yml");
            
            // Verify the file exists
            if (fs.existsSync(westYmlPath)) {
                return westYmlPath;
            }
            
            outputWarning("West Config", `west.yml not found at expected location: ${westYmlPath} (manifest.path = "${manifest.path}", setupPath: ${setupPath}). Verify the manifest path in .west/config is correct.`);
        } else {
            outputWarning("West Config", `manifest.path key not found in ${westConfigPath}. The [manifest] section may be missing or malformed.`);
        }
    } catch (error) {
        outputWarning("West Config", `Error reading .west/config at ${westConfigPath}: ${error}`);
    }

    return null;
}

/**
 * Read both manifest.path and manifest.file from `.west/config`.
 */
export function parseWestConfigManifest(setupPath: string): WestManifestConfig | null {
    const westConfigPath = path.join(setupPath, ".west", "config");
    try {
        if (!fs.existsSync(westConfigPath)) {
            return null;
        }
        const configContent = fs.readFileSync(westConfigPath, "utf8");
        return parseWestManifestConfigFromIni(configContent);
    } catch {
        return null;
    }
}

/**
 * Ensure `.west/config` contains a usable manifest section.
 *
 * This guards against cases where `manifest.file` or `manifest.path` ends up as
 * an empty value or the literal string `None`, which causes `west update` to fail
 * with `manifest file not found: None`.
 *
 * @returns true if the file was modified
 */
export function ensureWestConfigManifest(
    setupPath: string,
    expected: { manifestPath?: string; manifestFile?: string } = {}
): boolean {
    const westConfigPath = path.join(setupPath, ".west", "config");
    if (!fs.existsSync(westConfigPath)) {
        return false;
    }

    const original = fs.readFileSync(westConfigPath, "utf8");
    const eol = original.includes("\r\n") ? "\r\n" : "\n";
    const lines = original.split(/\r?\n/);

    let manifestStart = -1;
    let manifestEnd = lines.length;

    for (let i = 0; i < lines.length; i++) {
        const t = lines[i].trim();
        if (t === '[manifest]') {
            manifestStart = i;
            continue;
        }
        if (manifestStart >= 0 && i > manifestStart && t.startsWith('[') && t.endsWith(']')) {
            manifestEnd = i;
            break;
        }
    }

    const expectedFile = (expected.manifestFile && expected.manifestFile.trim()) ? expected.manifestFile.trim() : 'west.yml';
    const expectedPath = (expected.manifestPath && expected.manifestPath.trim()) ? expected.manifestPath.trim() : undefined;

    const isBadValue = (value: string | undefined) => {
        if (value === undefined) {
            return true;
        }
        const v = value.trim();
        return v === '' || v.toLowerCase() === 'none';
    };

    if (manifestStart < 0) {
        // Add a new manifest section at the end.
        if (lines.length > 0 && lines[lines.length - 1].trim() !== '') {
            lines.push('');
        }
        lines.push('[manifest]');
        if (expectedPath) {
            lines.push(`path = ${expectedPath}`);
        }
        lines.push(`file = ${expectedFile}`);
        const updated = lines.join(eol);
        if (updated !== original) {
            fs.writeFileSync(westConfigPath, updated, 'utf8');
            return true;
        }
        return false;
    }

    // Parse existing keys in the manifest section, tracking line indexes.
    let pathLineIndex: number | undefined;
    let fileLineIndex: number | undefined;
    let currentPath: string | undefined;
    let currentFile: string | undefined;

    for (let i = manifestStart + 1; i < manifestEnd; i++) {
        const raw = lines[i];
        const t = raw.trim();
        if (!t || t.startsWith('#') || t.startsWith(';')) {
            continue;
        }
        const eq = t.indexOf('=');
        if (eq <= 0) {
            continue;
        }
        const key = t.substring(0, eq).trim();
        const value = stripOptionalQuotes(t.substring(eq + 1));
        if (key === 'path') {
            pathLineIndex = i;
            currentPath = value;
        } else if (key === 'file') {
            fileLineIndex = i;
            currentFile = value;
        }
    }

    let changed = false;

    if (expectedPath && isBadValue(currentPath)) {
        if (pathLineIndex !== undefined) {
            lines[pathLineIndex] = `path = ${expectedPath}`;
        } else {
            lines.splice(manifestEnd, 0, `path = ${expectedPath}`);
            manifestEnd++;
        }
        changed = true;
    }

    if (isBadValue(currentFile)) {
        if (fileLineIndex !== undefined) {
            lines[fileLineIndex] = `file = ${expectedFile}`;
        } else {
            lines.splice(manifestEnd, 0, `file = ${expectedFile}`);
        }
        changed = true;
    }

    if (!changed) {
        return false;
    }

    const updated = lines.join(eol);
    if (updated !== original) {
        fs.writeFileSync(westConfigPath, updated, 'utf8');
        return true;
    }
    return false;
}
