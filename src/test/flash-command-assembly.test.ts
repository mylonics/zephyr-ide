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

import { assembleFlashCommand, FlashCommandParams } from "../zephyr_utilities/flash";

/** Helper: create a default FlashCommandParams with overrides. */
function makeParams(overrides: Partial<FlashCommandParams> = {}): FlashCommandParams {
    return {
        buildFolder: "/home/user/project/app/build/debug",
        runner: "default",
        args: "",
        ...overrides,
    };
}

suite("assembleFlashCommand", () => {
    test("minimal command with default runner and no args", () => {
        const cmd = assembleFlashCommand(makeParams());
        assert.strictEqual(cmd, 'west flash --build-dir "/home/user/project/app/build/debug"');
    });

    test('runner "default" omits the -r flag', () => {
        const cmd = assembleFlashCommand(makeParams({ runner: "default" }));
        assert.ok(!cmd.includes("-r "), `got: ${cmd}`);
    });

    test("non-default runner produces -r <runner>", () => {
        const cmd = assembleFlashCommand(makeParams({ runner: "jlink" }));
        assert.ok(cmd.includes("-r jlink"), `got: ${cmd}`);
    });

    test("sysbuildImage produces --domain <image>", () => {
        const cmd = assembleFlashCommand(makeParams({ sysbuildImage: "mcuboot" }));
        assert.ok(cmd.includes("--domain mcuboot"), `got: ${cmd}`);
    });

    test("no sysbuildImage omits --domain (west chooses the default domain itself)", () => {
        const cmd = assembleFlashCommand(makeParams());
        assert.ok(!cmd.includes("--domain"), `got: ${cmd}`);
    });

    test("args are appended when non-empty", () => {
        const cmd = assembleFlashCommand(makeParams({ args: "--recover" }));
        assert.ok(cmd.includes(" --recover"), `got: ${cmd}`);
    });

    test("whitespace-only args are trimmed and produce no trailing space", () => {
        const cmd = assembleFlashCommand(makeParams({ args: "   " }));
        assert.strictEqual(cmd, 'west flash --build-dir "/home/user/project/app/build/debug"');
    });

    test("args with leading/trailing whitespace are trimmed before appending", () => {
        const cmd = assembleFlashCommand(makeParams({ args: "  --recover  " }));
        assert.ok(cmd.endsWith("--recover"), `got: ${cmd}`);
    });

    test("full pipeline: domain, runner, and args combine in --build-dir, --domain, -r, args order", () => {
        const cmd = assembleFlashCommand({
            buildFolder: "/build",
            sysbuildImage: "mcuboot",
            runner: "jlink",
            args: "--recover",
        });
        assert.strictEqual(cmd, 'west flash --build-dir "/build" --domain mcuboot -r jlink --recover');
    });
});
