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
import { getTestsFromProject } from "../project_utilities/twister_selector";

suite("getTestsFromProject Test Suite", () => {

    let tmpDir: string;

    setup(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "zide-twister-selector-test-"));
    });

    teardown(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test("returns empty array when neither testcase.yaml nor sample.yaml exists", () => {
        assert.deepStrictEqual(getTestsFromProject(tmpDir), []);
    });

    test("reads test names from testcase.yaml", () => {
        fs.writeFileSync(path.join(tmpDir, "testcase.yaml"), [
            "tests:",
            "  sample.basic.helloworld:",
            "    tags: introduction",
            "  sample.basic.helloworld.shell:",
            "    tags: introduction shell",
        ].join("\n"));

        assert.deepStrictEqual(
            getTestsFromProject(tmpDir),
            ["sample.basic.helloworld", "sample.basic.helloworld.shell"]
        );
    });

    test("falls back to sample.yaml when testcase.yaml is absent", () => {
        fs.writeFileSync(path.join(tmpDir, "sample.yaml"), [
            "sample:",
            "  name: Hello World",
            "common:",
            "  tags: introduction",
            "tests:",
            "  sample.basic.helloworld:",
            "    build_only: true",
        ].join("\n"));

        assert.deepStrictEqual(getTestsFromProject(tmpDir), ["sample.basic.helloworld"]);
    });

    test("prefers testcase.yaml over sample.yaml when both are present", () => {
        fs.writeFileSync(path.join(tmpDir, "testcase.yaml"), [
            "tests:",
            "  from.testcase:",
            "    tags: a",
        ].join("\n"));
        fs.writeFileSync(path.join(tmpDir, "sample.yaml"), [
            "tests:",
            "  from.sample:",
            "    tags: b",
        ].join("\n"));

        assert.deepStrictEqual(getTestsFromProject(tmpDir), ["from.testcase"]);
    });

    test("returns empty array when the yaml file has no 'tests' key", () => {
        fs.writeFileSync(path.join(tmpDir, "testcase.yaml"), [
            "common:",
            "  tags: introduction",
        ].join("\n"));

        assert.deepStrictEqual(getTestsFromProject(tmpDir), []);
    });

    test("returns empty array when testcase.yaml is empty", () => {
        fs.writeFileSync(path.join(tmpDir, "testcase.yaml"), "");
        assert.deepStrictEqual(getTestsFromProject(tmpDir), []);
    });
});
