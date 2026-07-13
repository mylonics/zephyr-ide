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

import { assembleTwisterCommand, TwisterCommandParams } from "../zephyr_utilities/twister";

/** Helper: create a default TwisterCommandParams with overrides. */
function makeParams(overrides: Partial<TwisterCommandParams> = {}): TwisterCommandParams {
    return {
        projectFolder: "/home/user/project/app",
        tests: [],
        args: "",
        platform: "native_sim",
        boardRootArg: "",
        ...overrides,
    };
}

suite("assembleTwisterCommand", () => {
    test("no board config uses -p <platform> (sim/qemu path)", () => {
        const cmd = assembleTwisterCommand(makeParams());
        assert.ok(cmd.startsWith('west twister -p native_sim '), `expected sim/qemu form, got: ${cmd}`);
        assert.ok(!cmd.includes("--device-testing"), "sim/qemu builds must not pass --device-testing");
    });

    test("-T points at the project folder", () => {
        const cmd = assembleTwisterCommand(makeParams());
        assert.ok(cmd.includes('-T "/home/user/project/app"'));
    });

    test("--outdir points at <projectFolder>/twister-out", () => {
        const cmd = assembleTwisterCommand(makeParams());
        assert.ok(cmd.includes('--outdir "/home/user/project/app/twister-out"'), `got: ${cmd}`);
    });

    test("empty tests array produces no -s flags", () => {
        const cmd = assembleTwisterCommand(makeParams({ tests: [] }));
        assert.ok(!cmd.includes("-s "), `expected no -s flags, got: ${cmd}`);
    });

    test("each test name produces its own -s flag", () => {
        const cmd = assembleTwisterCommand(makeParams({ tests: ["sample.basic.helloworld", "sample.basic.shell"] }));
        assert.ok(cmd.includes("-s sample.basic.helloworld "), `got: ${cmd}`);
        assert.ok(cmd.includes("-s sample.basic.shell "), `got: ${cmd}`);
    });

    test('tests: ["All"] is a sentinel meaning "run everything" and produces no -s flags', () => {
        const cmd = assembleTwisterCommand(makeParams({ tests: ["All"] }));
        assert.ok(!cmd.includes("-s "), `expected no -s flags for the "All" sentinel, got: ${cmd}`);
    });

    test("extra args are appended after --outdir", () => {
        const cmd = assembleTwisterCommand(makeParams({ args: "--inline-logs -v" }));
        assert.ok(cmd.includes("--inline-logs -v"), `got: ${cmd}`);
    });

    test("hardware board config switches to --device-testing -p <boardSpec>", () => {
        const cmd = assembleTwisterCommand(makeParams({
            boardConfig: { board: "nucleo_f401re/stm32f401xe" },
        }));
        assert.ok(cmd.includes("--device-testing"), `got: ${cmd}`);
        assert.ok(cmd.includes("-p nucleo_f401re/stm32f401xe"), `got: ${cmd}`);
        assert.ok(!cmd.includes("-p native_sim"), "platform field must be ignored when boardConfig is set");
    });

    test("board revision is inserted before the qualifier slash, matching assembleBuildCommand", () => {
        const cmd = assembleTwisterCommand(makeParams({
            boardConfig: { board: "nucleo_f401re/stm32f401xe", revision: "A" },
        }));
        assert.ok(cmd.includes("-p nucleo_f401re@A/stm32f401xe"), `got: ${cmd}`);
    });

    test("serialPort produces --device-serial <port>", () => {
        const cmd = assembleTwisterCommand(makeParams({
            boardConfig: { board: "nucleo_f401re" },
            serialPort: "/dev/ttyACM0",
        }));
        assert.ok(cmd.includes("--device-serial /dev/ttyACM0"), `got: ${cmd}`);
    });

    test("serialBaud produces --device-serial-baud <baud>", () => {
        const cmd = assembleTwisterCommand(makeParams({
            boardConfig: { board: "nucleo_f401re" },
            serialBaud: "115200",
        }));
        assert.ok(cmd.includes("--device-serial-baud 115200"), `got: ${cmd}`);
    });

    test("no serialPort/serialBaud omits both device-serial flags", () => {
        const cmd = assembleTwisterCommand(makeParams({
            boardConfig: { board: "nucleo_f401re" },
        }));
        assert.ok(!cmd.includes("--device-serial"), `got: ${cmd}`);
    });

    test("boardRootArg is appended as a -- <arg> section for hardware boards", () => {
        const cmd = assembleTwisterCommand(makeParams({
            boardConfig: { board: "custom_plank" },
            boardRootArg: "-DBOARD_ROOT='/home/user/project/boards'",
        }));
        assert.ok(cmd.includes("-- -DBOARD_ROOT='/home/user/project/boards'"), `got: ${cmd}`);
    });

    test("empty boardRootArg produces no -- section", () => {
        const cmd = assembleTwisterCommand(makeParams({
            boardConfig: { board: "nucleo_f401re" },
            boardRootArg: "",
        }));
        assert.ok(!cmd.includes(" -- "), `got: ${cmd}`);
    });

    test("boardRootArg is ignored for the sim/qemu (no boardConfig) path", () => {
        const cmd = assembleTwisterCommand(makeParams({
            boardRootArg: "-DBOARD_ROOT='/should/not/appear'",
        }));
        assert.ok(!cmd.includes("BOARD_ROOT"), `got: ${cmd}`);
    });
});
