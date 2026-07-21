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
import { readMemoryReports, readDashboardData, readBuildInfoSourceFiles } from "../build_data/build-artifact-reader";

suite("build-artifact-reader Test Suite", () => {

    let buildFolder: string;

    setup(() => {
        buildFolder = fs.mkdtempSync(path.join(os.tmpdir(), "zide-artifact-reader-test-"));
    });

    teardown(() => {
        fs.rmSync(buildFolder, { recursive: true, force: true });
    });

    suite("readMemoryReports", () => {
        test("returns all-null when neither ram.json nor rom.json exist", () => {
            const result = readMemoryReports(buildFolder);
            assert.deepStrictEqual(result, { all: null, ram: null, rom: null });
        });

        test("parses the legacy {size, tree} format for ram.json and rom.json", () => {
            const ramReport = { size: 1024, tree: [{ data: { name: "RAM", size: 1024, displaySize: "1.0 KB" } }] };
            const romReport = { size: 2048, tree: [{ data: { name: "ROM", size: 2048, displaySize: "2.0 KB" } }] };
            fs.writeFileSync(path.join(buildFolder, "ram.json"), JSON.stringify(ramReport));
            fs.writeFileSync(path.join(buildFolder, "rom.json"), JSON.stringify(romReport));

            const result = readMemoryReports(buildFolder);
            assert.deepStrictEqual(result.ram, ramReport);
            assert.deepStrictEqual(result.rom, romReport);
            assert.ok(result.all, "merged 'all' view should not be null when ram and rom are present");
            assert.strictEqual(result.all!.size, 1024 + 2048, "merged size must be the sum of ram + rom");
        });

        test("merged 'all' view retags top-level tree node names to RAM/ROM to avoid key collisions", () => {
            // Zephyr's size_report always names the top-level node "Root" for both
            // ram.json and rom.json; merging them unchanged would collide in the
            // sunburst/tree-table (see mergeMemoryReports' comment in the source).
            const sharedNameReport = (size: number) => ({ size, tree: [{ data: { name: "Root", size, displaySize: `${size} B` } }] });
            fs.writeFileSync(path.join(buildFolder, "ram.json"), JSON.stringify(sharedNameReport(100)));
            fs.writeFileSync(path.join(buildFolder, "rom.json"), JSON.stringify(sharedNameReport(200)));

            const result = readMemoryReports(buildFolder);
            const names = result.all!.tree.map((n) => n.data.name);
            assert.deepStrictEqual(names, ["RAM", "ROM"]);
        });

        test("ram-only build (no rom.json) still produces a non-null 'all' view", () => {
            fs.writeFileSync(path.join(buildFolder, "ram.json"), JSON.stringify({ size: 512, tree: [] }));

            const result = readMemoryReports(buildFolder);
            assert.strictEqual(result.rom, null);
            assert.ok(result.ram);
            assert.ok(result.all, "'all' should be derived from ram alone when rom is missing");
            assert.strictEqual(result.all!.size, 512);
        });

        test("parses the modern Zephyr size_report format ({ symbols, total_size })", () => {
            const sizeReport = {
                total_size: 42,
                symbols: {
                    name: "Root",
                    size: 42,
                    loc: [],
                    children: [
                        { name: "main.c", size: 42, loc: ["text"], children: [] },
                    ],
                },
            };
            fs.writeFileSync(path.join(buildFolder, "ram.json"), JSON.stringify(sizeReport));

            const result = readMemoryReports(buildFolder);
            assert.ok(result.ram);
            assert.strictEqual(result.ram!.size, 42);
            assert.strictEqual(result.ram!.tree[0].data.name, "Root");
            assert.strictEqual(result.ram!.tree[0].children?.[0].data.name, "main.c");
        });

        test("malformed JSON in ram.json is treated as absent, not a thrown error", () => {
            fs.writeFileSync(path.join(buildFolder, "ram.json"), "{ this is not valid json");
            const result = readMemoryReports(buildFolder);
            assert.strictEqual(result.ram, null);
        });
    });

    suite("readBuildInfoSourceFiles", () => {
        test("reads Kconfig and devicetree file lists through the shared YAML reader", () => {
            fs.writeFileSync(path.join(buildFolder, "build_info.yml"), [
                "cmake:",
                "  kconfig:",
                "    files:",
                "      - /src/Kconfig",
                "    user-files:",
                "      - /src/prj.conf",
                "  devicetree:",
                "    files:",
                "      - /boards/board.dts",
                "    user-files:",
                "      - /src/app.overlay",
            ].join("\n"));

            assert.deepStrictEqual(readBuildInfoSourceFiles(buildFolder), {
                kconfigFiles: ["/src/Kconfig", "/src/prj.conf"],
                dtsFiles: ["/boards/board.dts", "/src/app.overlay"],
            });
        });

        test("ignores malformed non-array file fields", () => {
            fs.writeFileSync(path.join(buildFolder, "build_info.yml"), [
                "cmake:",
                "  kconfig:",
                "    files: /src/Kconfig",
                "  devicetree:",
                "    files:",
                "      unexpected: value",
            ].join("\n"));

            assert.deepStrictEqual(readBuildInfoSourceFiles(buildFolder), {
                kconfigFiles: [],
                dtsFiles: [],
            });
        });
    });

    suite("readDashboardData", () => {
        test("returns a fully-populated-but-empty shape for a completely empty build folder (lenient by design)", async () => {
            const data = await readDashboardData(buildFolder, "myProject", "myBuild");

            assert.strictEqual(data.summary.board, null);
            assert.strictEqual(data.summary.application, null);
            assert.strictEqual(data.summary.zephyrBase, null);
            assert.deepStrictEqual(data.kconfig, []);
            assert.deepStrictEqual(data.kconfigSourceFiles, []);
            assert.deepStrictEqual(data.memory, { all: null, ram: null, rom: null });
            assert.strictEqual(data.dts.source, "");
            assert.strictEqual(data.meta.projectName, "myProject");
            assert.strictEqual(data.meta.buildName, "myBuild");
        });

        test("extracts board name from CMakeCache.txt, stripping the CMake :TYPE annotation", async () => {
            fs.writeFileSync(path.join(buildFolder, "CMakeCache.txt"), [
                "// This is a comment",
                "BOARD:STRING=nucleo_f401re/stm32f401xe",
                "CACHED_BOARD:STRING=nucleo_f401re",
                "# another comment",
                "malformed line without equals",
            ].join("\n"));

            const data = await readDashboardData(buildFolder, "myProject", "myBuild");
            assert.strictEqual(data.summary.board, "nucleo_f401re/stm32f401xe");
        });

        test("parses zephyr/.config into typed kconfig entries", async () => {
            fs.mkdirSync(path.join(buildFolder, "zephyr"), { recursive: true });
            fs.writeFileSync(path.join(buildFolder, "zephyr", ".config"), [
                "CONFIG_BOOL_ENABLED=y",
                "# CONFIG_BOOL_DISABLED is not set",
                "CONFIG_SOME_INT=42",
                'CONFIG_SOME_STRING="hello"',
                "CONFIG_SOME_HEX=0xDEAD",
                "# a plain comment, not a kconfig line",
            ].join("\n"));

            const data = await readDashboardData(buildFolder, "myProject", "myBuild");
            const byName = Object.fromEntries(data.kconfig.map((e) => [e.name, e]));

            assert.deepStrictEqual(byName["CONFIG_BOOL_ENABLED"], { name: "CONFIG_BOOL_ENABLED", value: "y", type: "bool" });
            assert.deepStrictEqual(byName["CONFIG_BOOL_DISABLED"], { name: "CONFIG_BOOL_DISABLED", value: "n", type: "bool" });
            assert.deepStrictEqual(byName["CONFIG_SOME_INT"], { name: "CONFIG_SOME_INT", value: "42", type: "int" });
            assert.deepStrictEqual(byName["CONFIG_SOME_STRING"], { name: "CONFIG_SOME_STRING", value: "hello", type: "string" });
            assert.deepStrictEqual(byName["CONFIG_SOME_HEX"], { name: "CONFIG_SOME_HEX", value: "0xDEAD", type: "hex" });
            assert.strictEqual(Object.keys(byName).length, 5, "the plain comment line must not produce an entry");
        });

        test("reads zephyr.dts source verbatim when present", async () => {
            fs.mkdirSync(path.join(buildFolder, "zephyr"), { recursive: true });
            fs.writeFileSync(path.join(buildFolder, "zephyr", "zephyr.dts"), "/dts-v1/;\n\n/ { model = \"test\"; };\n");

            const data = await readDashboardData(buildFolder, "myProject", "myBuild");
            assert.ok(data.dts.source.includes("/dts-v1/;"));
        });
    });
});
