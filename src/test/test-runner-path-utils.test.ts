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
import { isPathWithin } from "./test-runner";

suite("Test Runner Path Utility Suite", () => {
    test("isPathWithin returns true for equal paths", () => {
        assert.strictEqual(isPathWithin("/tmp/build", "/tmp/build"), true);
    });

    test("isPathWithin returns true for nested paths", () => {
        assert.strictEqual(isPathWithin("/tmp/build", "/tmp/build/zephyr/zephyr.elf"), true);
    });

    test("isPathWithin returns false for outside paths", () => {
        assert.strictEqual(isPathWithin("/tmp/build", "/tmp/other/zephyr.elf"), false);
    });

    test("isPathWithin handles Windows drive letter case differences", function () {
        if (process.platform !== "win32") {
            this.skip();
        }
        assert.strictEqual(
            isPathWithin("d:/Temp/zide-spc/custom_build_output/relpath_build", "D:/Temp/zide-spc/custom_build_output/relpath_build/zephyr/zephyr.elf"),
            true
        );
        assert.strictEqual(
            isPathWithin("D:/Temp/zide-spc/custom_build_output/relpath_build", "d:/Temp/zide-spc/custom_build_output/relpath_build/zephyr/zephyr.elf"),
            true
        );
    });
});
