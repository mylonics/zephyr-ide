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
import { mergeVariableDefaults } from "../project_utilities/project_info";

suite("Project Variable Defaults Test Suite", () => {
    test("Includes default keys with empty values", () => {
        const merged = mergeVariableDefaults({}, ["foo", "bar"]);
        assert.deepStrictEqual(merged, { foo: "", bar: "" });
    });

    test("Keeps explicit values when defaults are present", () => {
        const merged = mergeVariableDefaults({ foo: "123" }, ["foo", "bar"]);
        assert.deepStrictEqual(merged, { foo: "123", bar: "" });
    });

    test("Preserves non-default variables", () => {
        const merged = mergeVariableDefaults({ custom: "x" }, ["foo"]);
        assert.deepStrictEqual(merged, { foo: "", custom: "x" });
    });
});
