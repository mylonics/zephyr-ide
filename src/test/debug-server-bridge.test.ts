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
import { matchPortAnnouncement } from "../zephyr_utilities/debug-server-bridge";

suite("debug-server-bridge port announcement parser", () => {

  test("nrfjprog: JLink-style 'Listening on TCP/IP port'", () => {
    const r = matchPortAnnouncement("nrfjprog", "Listening on TCP/IP port 2331");
    assert.deepStrictEqual(r, { host: "127.0.0.1", port: 2331 });
  });

  test("linkserver: 'GDB server listening on port'", () => {
    const r = matchPortAnnouncement("linkserver", "GDB server listening on port 3333");
    assert.deepStrictEqual(r, { host: "127.0.0.1", port: 3333 });
  });

  test("esp32: openocd-style 'Info : Listening on port N for gdb'", () => {
    const r = matchPortAnnouncement(
      "esp32",
      "Info : Listening on port 3333 for gdb connections",
    );
    assert.deepStrictEqual(r, { host: "127.0.0.1", port: 3333 });
  });

  test("stm32cubeprogrammer: 'listening at host:port' with host", () => {
    const r = matchPortAnnouncement(
      "stm32cubeprogrammer",
      "GDB server listening at 127.0.0.1:61234",
    );
    assert.deepStrictEqual(r, { host: "127.0.0.1", port: 61234 });
  });

  test("generic fallback for unknown runner that announces a port", () => {
    const r = matchPortAnnouncement(
      "unknown-runner",
      "gdbserver started listening on port 4444",
    );
    assert.deepStrictEqual(r, { host: "127.0.0.1", port: 4444 });
  });

  test("returns undefined for irrelevant log lines", () => {
    assert.strictEqual(matchPortAnnouncement("nrfjprog", ""), undefined);
    assert.strictEqual(matchPortAnnouncement("nrfjprog", "Connecting to target..."), undefined);
    assert.strictEqual(matchPortAnnouncement("linkserver", "Loaded image: app.elf"), undefined);
  });

  test("rejects ports outside the valid TCP range", () => {
    // Pattern requires 2-5 digit port, so 0 and 70000 are rejected at the regex level.
    assert.strictEqual(matchPortAnnouncement("nrfjprog", "Listening on TCP/IP port 0"), undefined);
    assert.strictEqual(matchPortAnnouncement("nrfjprog", "Listening on TCP/IP port 700000"), undefined);
  });
});
