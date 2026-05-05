/*
Copyright 2025-2026 mylonics 
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
import { findWestDir, findWestTopDir } from "../setup_utilities/west-config-parser";
import { normalizePath } from "./test-runner";

suite("West Config Parser Test Suite", () => {

    let tmpDir: string;

    setup(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "zide-west-test-"));
    });

    teardown(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test("findWestTopDir returns null when no .west/config exists", () => {
        const result = findWestTopDir(tmpDir);
        assert.strictEqual(result, null);
    });

    test("findWestTopDir returns the directory that directly contains .west/config", () => {
        // Create .west/config in tmpDir
        const westDir = path.join(tmpDir, ".west");
        fs.mkdirSync(westDir, { recursive: true });
        fs.writeFileSync(path.join(westDir, "config"), "[manifest]\npath = zephyr\nfile = west.yml\n");

        const result = findWestTopDir(tmpDir);
        assert.strictEqual(result, normalizePath(tmpDir));
    });

    test("findWestTopDir finds .west/config in a parent directory (WSL/nested workspace scenario)", () => {
        // Create .west/config in tmpDir (the "west topdir")
        const westDir = path.join(tmpDir, ".west");
        fs.mkdirSync(westDir, { recursive: true });
        fs.writeFileSync(path.join(westDir, "config"), "[manifest]\npath = zephyr\nfile = west.yml\n");

        // Create a nested subdirectory (simulating the VS Code workspace folder)
        const subDir = path.join(tmpDir, "my-project");
        fs.mkdirSync(subDir, { recursive: true });

        // Starting from the subdirectory should find .west/config in the parent
        const result = findWestTopDir(subDir);
        assert.strictEqual(result, normalizePath(tmpDir));
    });

    test("findWestTopDir finds .west/config two levels up", () => {
        // Create .west/config in tmpDir
        const westDir = path.join(tmpDir, ".west");
        fs.mkdirSync(westDir, { recursive: true });
        fs.writeFileSync(path.join(westDir, "config"), "[manifest]\npath = zephyr\n");

        // Create a deeply nested subdirectory
        const deepDir = path.join(tmpDir, "level1", "level2");
        fs.mkdirSync(deepDir, { recursive: true });

        const result = findWestTopDir(deepDir);
        assert.strictEqual(result, normalizePath(tmpDir));
    });

    test("findWestTopDir prefers the closest .west/config", () => {
        // Create .west/config in tmpDir (grandparent)
        const grandParentWest = path.join(tmpDir, ".west");
        fs.mkdirSync(grandParentWest, { recursive: true });
        fs.writeFileSync(path.join(grandParentWest, "config"), "[manifest]\npath = zephyr\n");

        // Create a subdirectory that also has .west/config (the workspace itself)
        const subDir = path.join(tmpDir, "workspace");
        const subWest = path.join(subDir, ".west");
        fs.mkdirSync(subWest, { recursive: true });
        fs.writeFileSync(path.join(subWest, "config"), "[manifest]\npath = app\n");

        // Starting from subDir should find the CLOSER .west/config (in subDir)
        const result = findWestTopDir(subDir);
        assert.strictEqual(result, normalizePath(subDir));
    });

    test("findWestTopDir returns null when only .west directory exists without config file", () => {
        // Create .west directory but no config file inside it
        const westDir = path.join(tmpDir, ".west");
        fs.mkdirSync(westDir, { recursive: true });
        // Intentionally do NOT create .west/config

        const result = findWestTopDir(tmpDir);
        assert.strictEqual(result, null);
    });

    test("findWestDir returns null when no .west directory exists", () => {
        const result = findWestDir(tmpDir);
        assert.strictEqual(result, null);
    });

    test("findWestDir returns the directory that directly contains .west (no config file)", () => {
        // Create .west directory without a config file — simulates a stale/partial init
        const westDir = path.join(tmpDir, ".west");
        fs.mkdirSync(westDir, { recursive: true });
        // No .west/config

        const result = findWestDir(tmpDir);
        assert.strictEqual(result, normalizePath(tmpDir));
    });

    test("findWestDir detects .west in a parent directory (stale WSL home-directory scenario)", () => {
        // Simulate /home/user/.west existing (stale or from a different workspace)
        const westDir = path.join(tmpDir, ".west");
        fs.mkdirSync(westDir, { recursive: true });

        // VS Code workspace folder is a subdirectory
        const subDir = path.join(tmpDir, "zidetest");
        fs.mkdirSync(subDir, { recursive: true });

        // findWestDir must detect the parent .west, preventing west init from failing
        const result = findWestDir(subDir);
        assert.strictEqual(result, normalizePath(tmpDir));
    });

    test("findWestDir detects .west with a config file (fully initialised workspace)", () => {
        // .west with config is the normal post-init state
        const westDir = path.join(tmpDir, ".west");
        fs.mkdirSync(westDir, { recursive: true });
        fs.writeFileSync(path.join(westDir, "config"), "[manifest]\npath = zephyr\nfile = west.yml\n");

        const subDir = path.join(tmpDir, "my-project");
        fs.mkdirSync(subDir, { recursive: true });

        const result = findWestDir(subDir);
        assert.strictEqual(result, normalizePath(tmpDir));
    });

    test("findWestDir prefers the closest .west directory", () => {
        // Grandparent has .west
        const gpWest = path.join(tmpDir, ".west");
        fs.mkdirSync(gpWest, { recursive: true });

        // Subdirectory also has .west (closer)
        const subDir = path.join(tmpDir, "workspace");
        const subWest = path.join(subDir, ".west");
        fs.mkdirSync(subWest, { recursive: true });

        const result = findWestDir(subDir);
        assert.strictEqual(result, normalizePath(subDir));
    });
});
