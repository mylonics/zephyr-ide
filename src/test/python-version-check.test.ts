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
import * as fs from "fs-extra";
import * as os from "os";
import * as path from "path";

import { pickPythonExecutable } from "../setup_utilities/host_tools";

/**
 * Create a temporary "Python" executable that, when invoked with `--version`,
 * prints the supplied banner to stdout. On Windows we generate a `.cmd` file;
 * on Unix-like systems a chmod +x bash script.
 *
 * Pass `output: ""` to simulate a no-op (e.g. the Microsoft Store python.exe
 * stub which prints nothing on `--version`).
 */
function makeFakePython(dir: string, basename: string, output: string): string {
  if (os.platform() === "win32") {
    const filePath = path.join(dir, `${basename}.cmd`);
    // /B suppresses the "Press any key" prompt from echo/exit chains
    const body = output.length > 0
      ? `@echo off\r\necho ${output}\r\n`
      : `@echo off\r\n`;
    fs.writeFileSync(filePath, body);
    return filePath;
  }
  const filePath = path.join(dir, basename);
  const body = output.length > 0
    ? `#!/bin/sh\necho '${output}'\n`
    : `#!/bin/sh\nexit 0\n`;
  fs.writeFileSync(filePath, body);
  fs.chmodSync(filePath, 0o755);
  return filePath;
}

suite("Python Version Check Test Suite", () => {
  let tmpDir: string;

  setup(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "py-ver-check-"));
  });

  teardown(() => {
    fs.removeSync(tmpDir);
  });

  test("Returns highest-versioned candidate that meets the minimum floor", async () => {
    // Create three fake interpreters: 3.10, 3.13, 3.12.
    const py310 = makeFakePython(tmpDir, "fake-python-3.10", "Python 3.10.6");
    const py313 = makeFakePython(tmpDir, "fake-python-3.13", "Python 3.13.1");

    // Order matters: pickPythonExecutable returns the FIRST candidate that
    // satisfies the minimum, not necessarily the highest version.
    const result = await pickPythonExecutable([py310, py313], [3, 12]);

    assert.strictEqual(result.valid, true, `expected valid; got error=${result.error}`);
    assert.strictEqual(result.executable, py313, "should fall through to the candidate that meets >= 3.12");
    assert.strictEqual(result.version, "3.13.1");
  });

  test("Falls through past the Microsoft Store stub (empty --version output)", async () => {
    // First candidate prints nothing (simulates Store stub). Second prints a
    // valid Python version that meets the floor.
    const stub = makeFakePython(tmpDir, "fake-store-stub", "");
    const real = makeFakePython(tmpDir, "fake-real-python", "Python 3.13.0");

    const result = await pickPythonExecutable([stub, real], [3, 12]);

    assert.strictEqual(result.valid, true, `expected valid; got error=${result.error}`);
    assert.strictEqual(result.executable, real);
    assert.strictEqual(result.version, "3.13.0");
  });

  test("All candidates fail returns the highest-versioned attempted result with a clear error", async () => {
    // Two interpreters that both fail the >= 3.12 floor.
    const py39 = makeFakePython(tmpDir, "fake-python-3.9", "Python 3.9.18");
    const py310 = makeFakePython(tmpDir, "fake-python-3.10", "Python 3.10.6");

    const result = await pickPythonExecutable([py39, py310], [3, 12]);

    assert.strictEqual(result.valid, false);
    // Highest versioned of the failures should be reported for the most
    // helpful error message.
    assert.strictEqual(result.version, "3.10.6");
    assert.ok(result.error && result.error.includes("3.10.6"), `error should mention version, got: ${result.error}`);
    assert.ok(result.error && result.error.includes(">= 3.12"), `error should mention minimum, got: ${result.error}`);
  });

  test("All candidates missing returns invalid result", async () => {
    const result = await pickPythonExecutable(
      [
        path.join(tmpDir, "definitely-not-installed-1"),
        path.join(tmpDir, "definitely-not-installed-2"),
      ],
      [3, 12]
    );
    assert.strictEqual(result.valid, false);
    assert.ok(result.error, "should report an error");
  });

  test("Empty candidate list returns invalid", async () => {
    const result = await pickPythonExecutable([], [3, 12]);
    assert.strictEqual(result.valid, false);
    assert.ok(result.error);
  });
});
