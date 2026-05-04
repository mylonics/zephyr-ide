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

import { parseBoardListOutput } from "../project_utilities/build_selector";
import { assembleTwisterBoardSpec } from "../zephyr_utilities/twister";

// ---------------------------------------------------------------------------
// parseBoardListOutput — board list qualifier / revision parsing
// ---------------------------------------------------------------------------

suite("board-qualifier-revision", () => {
  suite("parseBoardListOutput", () => {

    // --- hwm-v1 (no qualifiers, no revisions) ---

    test("hwm-v1 board (name;dir only) produces bare board name", () => {
      const result = parseBoardListOutput("nucleo_f401re;arm/st/nucleo_f401re", false, false);
      assert.deepStrictEqual(result, [
        { name: "nucleo_f401re", subdir: "arm/st/nucleo_f401re", revisions: undefined, revision_default: undefined },
      ]);
    });

    test("hwm-v1 multiple boards are each parsed correctly", () => {
      const stdout = "nucleo_f401re;arm/st/nucleo_f401re\nnative_sim;native/native_sim";
      const result = parseBoardListOutput(stdout, false, false);
      assert.strictEqual(result.length, 2);
      assert.strictEqual(result[0].name, "nucleo_f401re");
      assert.strictEqual(result[1].name, "native_sim");
    });

    // --- hwm-v2 qualifiers (Zephyr ≥ 3.7.0) ---

    test("hwm-v2 board with empty qualifier string produces bare board name", () => {
      // `west boards -f "{name};{dir};{qualifiers}"` emits an empty qualifiers field
      // for boards that have no qualifiers (hwm-v1-style boards in the v2 path).
      const result = parseBoardListOutput("native_sim;native/native_sim;", true, false);
      assert.deepStrictEqual(result, [
        { name: "native_sim", subdir: "native/native_sim", revisions: undefined, revision_default: undefined },
      ]);
    });

    test("hwm-v2 board with single qualifier embeds qualifier in board name", () => {
      const result = parseBoardListOutput("rpi_pico;arm/raspberrypi/rpi_pico;rpi_pico", true, false);
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].name, "rpi_pico/rpi_pico");
    });

    test("hwm-v2 board with multiple qualifiers produces one entry per qualifier", () => {
      const result = parseBoardListOutput("nrf5340dk;arm/nordic/nrf5340dk;nrf5340dk/cpuapp,nrf5340dk/cpunet", true, false);
      assert.strictEqual(result.length, 2);
      assert.strictEqual(result[0].name, "nrf5340dk/nrf5340dk/cpuapp");
      assert.strictEqual(result[1].name, "nrf5340dk/nrf5340dk/cpunet");
      // All entries share the same subdir
      assert.ok(result.every(r => r.subdir === "arm/nordic/nrf5340dk"));
    });

    test("hwm-v2 board with qualifiers containing extra whitespace in output strips quotes", () => {
      // `west boards` sometimes wraps values in single quotes on some hosts
      const result = parseBoardListOutput("mimxrt1170_evk;'arm/nxp';mimxrt1170_evk/cm7,mimxrt1170_evk/cm4", true, false);
      assert.strictEqual(result.length, 2);
      assert.strictEqual(result[0].name, "mimxrt1170_evk/mimxrt1170_evk/cm7");
      assert.strictEqual(result[1].subdir, "arm/nxp");
    });

    // --- revisions (Zephyr ≥ 4.1.0) ---

    test("board with revision list populates revisions array", () => {
      const result = parseBoardListOutput("nrf52840dk;arm/nordic/nrf52840dk;;1.0.0,2.0.0,3.0.0;2.0.0", true, true);
      assert.deepStrictEqual(result[0].revisions, ["1.0.0", "2.0.0", "3.0.0"]);
      assert.strictEqual(result[0].revision_default, "2.0.0");
    });

    test("board with None revisions produces undefined revisions", () => {
      const result = parseBoardListOutput("nucleo_f401re;arm/st/nucleo_f401re;;None", true, true);
      assert.strictEqual(result[0].revisions, undefined);
      assert.strictEqual(result[0].revision_default, undefined);
    });

    test("board with single qualifier and revisions embeds qualifier and carries revisions", () => {
      const result = parseBoardListOutput("rpi_pico2;arm/raspberrypi/rpi_pico2;rpi_pico2;A,B;B", true, true);
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].name, "rpi_pico2/rpi_pico2");
      assert.deepStrictEqual(result[0].revisions, ["A", "B"]);
      assert.strictEqual(result[0].revision_default, "B");
    });

    test("multi-qualifier board with revisions copies revisions to every entry", () => {
      const result = parseBoardListOutput("nrf5340dk;arm/nordic/nrf5340dk;nrf5340dk/cpuapp,nrf5340dk/cpunet;1.0.0,2.0.0;1.0.0", true, true);
      assert.strictEqual(result.length, 2);
      assert.deepStrictEqual(result[0].revisions, ["1.0.0", "2.0.0"]);
      assert.deepStrictEqual(result[1].revisions, ["1.0.0", "2.0.0"]);
      assert.strictEqual(result[0].revision_default, "1.0.0");
    });

    // --- edge cases ---

    test("empty stdout produces empty array", () => {
      assert.deepStrictEqual(parseBoardListOutput("", true, true), []);
    });

    test("line with only one field (no semicolon) is skipped", () => {
      const result = parseBoardListOutput("badjunk\nnative_sim;native/native_sim", false, false);
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].name, "native_sim");
    });

    test("CRLF line endings are handled", () => {
      const result = parseBoardListOutput("nucleo_f401re;arm/st/nucleo_f401re\r\nnative_sim;native/native_sim", false, false);
      assert.strictEqual(result.length, 2);
      assert.strictEqual(result[0].name, "nucleo_f401re");
      assert.strictEqual(result[1].name, "native_sim");
    });
  });

  // ---------------------------------------------------------------------------
  // assembleTwisterBoardSpec — board spec for `west twister -p`
  // ---------------------------------------------------------------------------

  suite("assembleTwisterBoardSpec", () => {
    test("no revision returns board name unchanged", () => {
      assert.strictEqual(assembleTwisterBoardSpec("native_sim", undefined), "native_sim");
    });

    test("revision is appended with @ separator for plain board", () => {
      assert.strictEqual(assembleTwisterBoardSpec("nrf52840dk", "2.0.0"), "nrf52840dk@2.0.0");
    });

    test("revision is inserted before qualifier slash, not appended at the end", () => {
      assert.strictEqual(assembleTwisterBoardSpec("nrf5340dk/cpuapp", "1.0.0"), "nrf5340dk@1.0.0/cpuapp");
    });

    test("revision is inserted before first slash only for multi-segment qualifier", () => {
      assert.strictEqual(
        assembleTwisterBoardSpec("mimxrt1170_evk/mimxrt1176/cm7", "A"),
        "mimxrt1170_evk@A/mimxrt1176/cm7",
      );
    });

    test("empty string revision is treated as no revision (board returned unchanged)", () => {
      // Empty string is falsy, so the function treats it the same as undefined.
      assert.strictEqual(assembleTwisterBoardSpec("native_sim", ""), "native_sim");
    });
  });
});
