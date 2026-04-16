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
import * as path from "path";
import * as fs from "fs-extra";
import * as os from "os";

import { assembleBuildCommand, BuildCommandParams, computeCMakeDefs, computeRawCMakeDefs, writeCMakeInitFile } from "../zephyr_utilities/build";
import { quoteCMakeDef, quoteBuildArgForShell, splitBuildArgs } from "../project_utilities/build_args";

/** Helper: create a default BuildCommandParams with overrides. */
function makeParams(overrides: Partial<BuildCommandParams> = {}): BuildCommandParams {
  return {
    board: "native_sim",
    projectFolder: "/home/user/project/app",
    buildFolder: "/home/user/project/app/build/debug",
    westBuildArgs: [],
    westBuildCMakeArgs: [],
    primaryConfFiles: [],
    secondaryConfFiles: [],
    overlayFiles: [],
    extraOverlayFiles: [],
    boardRootArg: "",
    isPristine: true,
    ...overrides,
  };
}

suite("assembleBuildCommand", () => {
  test("pristine build with no extras produces minimal command", () => {
    const cmd = assembleBuildCommand(makeParams());
    assert.strictEqual(
      cmd,
      'west build -b native_sim "/home/user/project/app" -p --build-dir "/home/user/project/app/build/debug"',
    );
  });

  test("non-pristine build omits board, -p flag, and cmake section", () => {
    const cmd = assembleBuildCommand(makeParams({
      isPristine: false,
      primaryConfFiles: ["/home/user/project/prj.conf"],
    }));
    assert.strictEqual(
      cmd,
      'west build "/home/user/project/app" --build-dir "/home/user/project/app/build/debug"',
    );
    // Config files should NOT appear in non-pristine builds
    assert.ok(!cmd.includes("CONF_FILE"));
  });

  test("board revision is appended with @ separator", () => {
    const cmd = assembleBuildCommand(makeParams({ revision: "1.0.0" }));
    assert.ok(cmd.includes("-b native_sim@1.0.0"));
  });

  test("west build args are included in both pristine and non-pristine builds", () => {
    const pristineCmd = assembleBuildCommand(makeParams({
      westBuildArgs: ["--sysbuild", "--pristine=always"],
      isPristine: true,
    }));
    assert.ok(pristineCmd.includes("--sysbuild --pristine=always"));

    const nonPristineCmd = assembleBuildCommand(makeParams({
      westBuildArgs: ["--sysbuild"],
      isPristine: false,
    }));
    assert.ok(nonPristineCmd.includes("--sysbuild"));
  });

  test("west cmake args appear after -- separator", () => {
    const cmd = assembleBuildCommand(makeParams({
      westBuildCMakeArgs: ["-DCMAKE_BUILD_TYPE=Debug", "-DCONFIG_LOG=y"],
    }));
    assert.ok(cmd.includes("-- -DCMAKE_BUILD_TYPE=Debug -DCONFIG_LOG=y"));
  });

  test("cmake args with spaces are shell-quoted", () => {
    const cmd = assembleBuildCommand(makeParams({
      westBuildCMakeArgs: ["-DEXTRA=value with spaces"],
    }));
    assert.ok(cmd.includes('"-DEXTRA=value with spaces"'));
  });

  test("primary conf files produce -DCONF_FILE", () => {
    const cmd = assembleBuildCommand(makeParams({
      primaryConfFiles: ["/home/user/project/prj.conf"],
    }));
    assert.ok(cmd.includes("-DCONF_FILE=/home/user/project/prj.conf"));
  });

  test("multiple primary conf files are semicolon-joined", () => {
    const cmd = assembleBuildCommand(makeParams({
      primaryConfFiles: ["/home/user/project/prj.conf", "/home/user/project/extra.conf"],
    }));
    assert.ok(cmd.includes('"-DCONF_FILE=/home/user/project/prj.conf;/home/user/project/extra.conf"'));
  });

  test("secondary conf files produce -DEXTRA_CONF_FILE", () => {
    const cmd = assembleBuildCommand(makeParams({
      secondaryConfFiles: ["/home/user/project/debug.conf"],
    }));
    assert.ok(cmd.includes("-DEXTRA_CONF_FILE=/home/user/project/debug.conf"));
  });

  test("overlay files produce -DDTC_OVERLAY_FILE", () => {
    const cmd = assembleBuildCommand(makeParams({
      overlayFiles: ["/home/user/project/board.overlay"],
    }));
    assert.ok(cmd.includes("-DDTC_OVERLAY_FILE=/home/user/project/board.overlay"));
  });

  test("extra overlay files produce -DEXTRA_DTC_OVERLAY_FILE", () => {
    const cmd = assembleBuildCommand(makeParams({
      extraOverlayFiles: ["/home/user/project/debug.overlay"],
    }));
    assert.ok(cmd.includes("-DEXTRA_DTC_OVERLAY_FILE=/home/user/project/debug.overlay"));
  });

  test("conf file paths with spaces are quoted as a single shell token", () => {
    const cmd = assembleBuildCommand(makeParams({
      primaryConfFiles: ["/home/user/my project/prj.conf"],
    }));
    assert.ok(cmd.includes('"-DCONF_FILE=/home/user/my project/prj.conf"'));
  });

  test("board root arg is included in cmake defs", () => {
    const cmd = assembleBuildCommand(makeParams({
      boardRootArg: '"-DBOARD_ROOT=/home/user/boards"',
    }));
    assert.ok(cmd.includes('"-DBOARD_ROOT=/home/user/boards"'));
    assert.ok(cmd.includes("-- "));
  });

  test("all cmake defs combine: board root, user cmake args, conf files, overlays", () => {
    const cmd = assembleBuildCommand(makeParams({
      boardRootArg: "-DBOARD_ROOT=/opt/zephyr",
      westBuildCMakeArgs: ["-DCMAKE_BUILD_TYPE=Release"],
      primaryConfFiles: ["/home/user/prj.conf"],
      overlayFiles: ["/home/user/app.overlay"],
    }));

    const cmakeSection = cmd.split(" -- ")[1];
    assert.ok(cmakeSection, "expected cmake section after --");
    assert.ok(cmakeSection.includes("-DBOARD_ROOT=/opt/zephyr"));
    assert.ok(cmakeSection.includes("-DCMAKE_BUILD_TYPE=Release"));
    assert.ok(cmakeSection.includes("-DCONF_FILE=/home/user/prj.conf"));
    assert.ok(cmakeSection.includes("-DDTC_OVERLAY_FILE=/home/user/app.overlay"));
  });

  test("empty conf/overlay arrays produce no cmake defs", () => {
    const cmd = assembleBuildCommand(makeParams({
      primaryConfFiles: [],
      secondaryConfFiles: [],
      overlayFiles: [],
      extraOverlayFiles: [],
    }));
    assert.ok(!cmd.includes("CONF_FILE"));
    assert.ok(!cmd.includes("DTC_OVERLAY_FILE"));
    assert.ok(!cmd.includes(" -- "));
  });

  test("non-pristine build ignores west cmake args", () => {
    const cmd = assembleBuildCommand(makeParams({
      isPristine: false,
      westBuildCMakeArgs: ["-DCMAKE_BUILD_TYPE=Debug"],
    }));
    assert.ok(!cmd.includes("CMAKE_BUILD_TYPE"));
    assert.ok(!cmd.includes(" -- "));
  });
});

suite("quoteCMakeDef", () => {
  test("simple key=value is always quoted", () => {
    assert.strictEqual(quoteCMakeDef("CMAKE_BUILD_TYPE", "Debug"), '"-DCMAKE_BUILD_TYPE=Debug"');
  });

  test("value with semicolons is quoted", () => {
    assert.strictEqual(
      quoteCMakeDef("CONF_FILE", "/a/prj.conf;/b/extra.conf"),
      '"-DCONF_FILE=/a/prj.conf;/b/extra.conf"',
    );
  });

  test("value with spaces is quoted", () => {
    assert.strictEqual(
      quoteCMakeDef("BOARD_ROOT", "/home/my user/boards"),
      '"-DBOARD_ROOT=/home/my user/boards"',
    );
  });

  test("value with single quotes is quoted", () => {
    assert.strictEqual(
      quoteCMakeDef("EXTRA", "it's a test"),
      `"-DEXTRA=it's a test"`,
    );
  });

  test("Windows backslash paths are normalized to forward slashes", () => {
    assert.strictEqual(
      quoteCMakeDef("BOARD_ROOT", "C:\\Users\\test\\zephyr"),
      '"-DBOARD_ROOT=C:/Users/test/zephyr"',
    );
  });

  test("Windows backslash path with spaces is quoted and normalized", () => {
    assert.strictEqual(
      quoteCMakeDef("BOARD_ROOT", "C:\\Users\\my user\\zephyr"),
      '"-DBOARD_ROOT=C:/Users/my user/zephyr"',
    );
  });
});

suite("quoteBuildArgForShell", () => {
  test("empty string returns quoted empty", () => {
    assert.strictEqual(quoteBuildArgForShell(""), '""');
  });

  test("simple safe arg passes through", () => {
    assert.strictEqual(quoteBuildArgForShell("--pristine=always"), "--pristine=always");
  });

  test("arg with spaces is double-quoted", () => {
    assert.strictEqual(quoteBuildArgForShell("-DVAL=hello world"), '"-DVAL=hello world"');
  });

  test("arg with double quotes is escaped", () => {
    assert.strictEqual(quoteBuildArgForShell('say "hi"'), '"say \\"hi\\""');
  });

  test("arg with backslashes is escaped", () => {
    assert.strictEqual(quoteBuildArgForShell("C:\\path\\to\\file"), '"C:\\\\path\\\\to\\\\file"');
  });
});

suite("splitBuildArgs edge cases", () => {
  test("empty string returns empty array", () => {
    assert.deepStrictEqual(splitBuildArgs(""), []);
  });

  test("whitespace-only string returns empty array", () => {
    assert.deepStrictEqual(splitBuildArgs("   "), []);
  });

  test("trailing backslash is preserved literally", () => {
    assert.deepStrictEqual(splitBuildArgs("arg\\"), ["arg\\"]);
  });

  test("escaped space keeps token together", () => {
    assert.deepStrictEqual(splitBuildArgs("hello\\ world"), ["hello world"]);
  });

  test("mixed quotes within a single token", () => {
    assert.deepStrictEqual(splitBuildArgs(`-D"FOO='bar'"`), ["-DFOO='bar'"]);
  });

  test("multiple spaces between args are collapsed", () => {
    assert.deepStrictEqual(splitBuildArgs("a   b   c"), ["a", "b", "c"]);
  });

  test("unterminated single quote includes remaining chars", () => {
    assert.deepStrictEqual(splitBuildArgs("'unterminated"), ["unterminated"]);
  });

  test("unterminated double quote includes remaining chars", () => {
    assert.deepStrictEqual(splitBuildArgs('"unterminated'), ["unterminated"]);
  });
});

suite("computeCMakeDefs", () => {
  test("empty params produce no defs", () => {
    const defs = computeCMakeDefs({
      boardRootArg: "",
      westBuildCMakeArgs: [],
      primaryConfFiles: [],
      secondaryConfFiles: [],
      overlayFiles: [],
      extraOverlayFiles: [],
    });
    assert.deepStrictEqual(defs, []);
  });

  test("board root arg is included", () => {
    const defs = computeCMakeDefs({
      boardRootArg: "-DBOARD_ROOT=/opt/zephyr",
      westBuildCMakeArgs: [],
      primaryConfFiles: [],
      secondaryConfFiles: [],
      overlayFiles: [],
      extraOverlayFiles: [],
    });
    assert.deepStrictEqual(defs, ["-DBOARD_ROOT=/opt/zephyr"]);
  });

  test("user cmake args are included and quoted", () => {
    const defs = computeCMakeDefs({
      boardRootArg: "",
      westBuildCMakeArgs: ["-DCMAKE_BUILD_TYPE=Debug", "-DVAL=hello world"],
      primaryConfFiles: [],
      secondaryConfFiles: [],
      overlayFiles: [],
      extraOverlayFiles: [],
    });
    assert.ok(defs.includes("-DCMAKE_BUILD_TYPE=Debug"));
    assert.ok(defs.some(d => d.includes("-DVAL=hello world")));
  });

  test("conf files produce correct defs", () => {
    const defs = computeCMakeDefs({
      boardRootArg: "",
      westBuildCMakeArgs: [],
      primaryConfFiles: ["/home/user/prj.conf"],
      secondaryConfFiles: ["/home/user/debug.conf"],
      overlayFiles: ["/home/user/app.overlay"],
      extraOverlayFiles: ["/home/user/debug.overlay"],
    });
    assert.ok(defs.some(d => d.includes("CONF_FILE") && d.includes("prj.conf")));
    assert.ok(defs.some(d => d.includes("EXTRA_CONF_FILE") && d.includes("debug.conf")));
    assert.ok(defs.some(d => d.includes("DTC_OVERLAY_FILE") && d.includes("app.overlay")));
    assert.ok(defs.some(d => d.includes("EXTRA_DTC_OVERLAY_FILE") && d.includes("debug.overlay")));
  });

  test("result is consistent across calls with same inputs", () => {
    const params = {
      boardRootArg: "-DBOARD_ROOT=/opt/zephyr",
      westBuildCMakeArgs: ["-DCMAKE_BUILD_TYPE=Release"],
      primaryConfFiles: ["/home/user/prj.conf"],
      secondaryConfFiles: [],
      overlayFiles: ["/home/user/app.overlay"],
      extraOverlayFiles: [],
    };
    const a = computeCMakeDefs(params);
    const b = computeCMakeDefs(params);
    assert.deepStrictEqual(a, b);
  });

  test("changing a cmake arg produces different output", () => {
    const base = {
      boardRootArg: "",
      westBuildCMakeArgs: ["-DCMAKE_BUILD_TYPE=Debug"],
      primaryConfFiles: ["/home/user/prj.conf"],
      secondaryConfFiles: [],
      overlayFiles: [],
      extraOverlayFiles: [],
    };
    const changed = { ...base, westBuildCMakeArgs: ["-DCMAKE_BUILD_TYPE=Release"] };
    const defsA = computeCMakeDefs(base);
    const defsB = computeCMakeDefs(changed);
    assert.notDeepStrictEqual(defsA, defsB);
  });

  test("adding a conf file produces different output", () => {
    const base = {
      boardRootArg: "",
      westBuildCMakeArgs: [],
      primaryConfFiles: ["/home/user/prj.conf"],
      secondaryConfFiles: [],
      overlayFiles: [],
      extraOverlayFiles: [],
    };
    const changed = { ...base, secondaryConfFiles: ["/home/user/debug.conf"] };
    const defsA = computeCMakeDefs(base);
    const defsB = computeCMakeDefs(changed);
    assert.notDeepStrictEqual(defsA, defsB);
  });

  test("assembleBuildCommand uses computeCMakeDefs output", () => {
    const params = makeParams({
      boardRootArg: "-DBOARD_ROOT=/opt/zephyr",
      primaryConfFiles: ["/home/user/prj.conf"],
    });
    const defs = computeCMakeDefs(params);
    const cmd = assembleBuildCommand(params);
    // Every def from computeCMakeDefs should appear in the assembled command
    for (const def of defs) {
      assert.ok(cmd.includes(def), `Expected command to include "${def}"`);
    }
  });
});

suite("assembleBuildCommand with cmakeInitFile", () => {
  test("uses -C flag when cmakeInitFile is set", () => {
    const cmd = assembleBuildCommand(makeParams({
      cmakeInitFile: "/home/user/.vscode/cmake-init-app_debug.cmake",
    }));
    assert.ok(cmd.includes('-- -C "/home/user/.vscode/cmake-init-app_debug.cmake"'));
    assert.ok(!cmd.includes("-DCONF_FILE"));
    assert.ok(!cmd.includes("-DBOARD_ROOT"));
  });

  test("normalizes Windows backslashes in init file path", () => {
    const cmd = assembleBuildCommand(makeParams({
      cmakeInitFile: "C:\\Users\\test\\.vscode\\cmake-init.cmake",
    }));
    assert.ok(cmd.includes('-- -C "C:/Users/test/.vscode/cmake-init.cmake"'));
  });

  test("ignores inline defs when cmakeInitFile is provided", () => {
    const cmd = assembleBuildCommand(makeParams({
      cmakeInitFile: "/tmp/init.cmake",
      boardRootArg: "-DBOARD_ROOT=/opt/zephyr",
      westBuildCMakeArgs: ["-DCMAKE_BUILD_TYPE=Debug"],
      primaryConfFiles: ["/home/user/prj.conf"],
    }));
    assert.ok(cmd.includes("-C"));
    assert.ok(!cmd.includes("-DBOARD_ROOT"));
    assert.ok(!cmd.includes("-DCMAKE_BUILD_TYPE"));
    assert.ok(!cmd.includes("-DCONF_FILE"));
  });

  test("non-pristine build ignores cmakeInitFile", () => {
    const cmd = assembleBuildCommand(makeParams({
      isPristine: false,
      cmakeInitFile: "/tmp/init.cmake",
    }));
    assert.ok(!cmd.includes("-C"));
  });
});

suite("computeRawCMakeDefs", () => {
  test("empty params produce no entries", () => {
    const entries = computeRawCMakeDefs({
      westBuildCMakeArgs: [],
      primaryConfFiles: [],
      secondaryConfFiles: [],
      overlayFiles: [],
      extraOverlayFiles: [],
    });
    assert.deepStrictEqual(entries, []);
  });

  test("board root is included with forward slashes", () => {
    const entries = computeRawCMakeDefs({
      boardRoot: "C:\\Users\\test\\zephyr",
      westBuildCMakeArgs: [],
      primaryConfFiles: [],
      secondaryConfFiles: [],
      overlayFiles: [],
      extraOverlayFiles: [],
    });
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].key, "BOARD_ROOT");
    assert.strictEqual(entries[0].value, "C:/Users/test/zephyr");
  });

  test("user cmake -D args are parsed", () => {
    const entries = computeRawCMakeDefs({
      westBuildCMakeArgs: ["-DCMAKE_BUILD_TYPE=Debug", "-DCONFIG_LOG=y"],
      primaryConfFiles: [],
      secondaryConfFiles: [],
      overlayFiles: [],
      extraOverlayFiles: [],
    });
    assert.strictEqual(entries.length, 2);
    assert.strictEqual(entries[0].key, "CMAKE_BUILD_TYPE");
    assert.strictEqual(entries[0].value, "Debug");
    assert.strictEqual(entries[1].key, "CONFIG_LOG");
    assert.strictEqual(entries[1].value, "y");
  });

  test("conf and overlay files are included", () => {
    const entries = computeRawCMakeDefs({
      westBuildCMakeArgs: [],
      primaryConfFiles: ["/home/user/prj.conf"],
      secondaryConfFiles: ["/home/user/debug.conf"],
      overlayFiles: ["/home/user/app.overlay"],
      extraOverlayFiles: ["/home/user/debug.overlay"],
    });
    assert.strictEqual(entries.length, 4);
    assert.ok(entries.some(e => e.key === "CONF_FILE" && e.value === "/home/user/prj.conf"));
    assert.ok(entries.some(e => e.key === "EXTRA_CONF_FILE" && e.value === "/home/user/debug.conf"));
    assert.ok(entries.some(e => e.key === "DTC_OVERLAY_FILE" && e.value === "/home/user/app.overlay"));
    assert.ok(entries.some(e => e.key === "EXTRA_DTC_OVERLAY_FILE" && e.value === "/home/user/debug.overlay"));
  });

  test("multiple conf files are semicolon-joined", () => {
    const entries = computeRawCMakeDefs({
      westBuildCMakeArgs: [],
      primaryConfFiles: ["/a/prj.conf", "/b/extra.conf"],
      secondaryConfFiles: [],
      overlayFiles: [],
      extraOverlayFiles: [],
    });
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].value, "/a/prj.conf;/b/extra.conf");
  });

  test("Windows backslash paths in conf files are normalized", () => {
    const entries = computeRawCMakeDefs({
      westBuildCMakeArgs: [],
      primaryConfFiles: ["C:\\Users\\test\\prj.conf"],
      secondaryConfFiles: [],
      overlayFiles: [],
      extraOverlayFiles: [],
    });
    assert.strictEqual(entries[0].value, "C:/Users/test/prj.conf");
  });
});

suite("writeCMakeInitFile", () => {
  let tmpDir: string;

  setup(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "zephyr-ide-test-"));
  });

  teardown(() => {
    fs.removeSync(tmpDir);
  });

  test("writes valid cmake set commands", () => {
    const filePath = path.join(tmpDir, "init.cmake");
    writeCMakeInitFile(filePath, [
      { key: "BOARD_ROOT", value: "C:/Users/test/zephyr" },
      { key: "CMAKE_BUILD_TYPE", value: "Debug" },
    ]);
    const content = fs.readFileSync(filePath, "utf8");
    assert.ok(content.includes('set(BOARD_ROOT "C:/Users/test/zephyr" CACHE STRING "" FORCE)'));
    assert.ok(content.includes('set(CMAKE_BUILD_TYPE "Debug" CACHE STRING "" FORCE)'));
  });

  test("escapes double quotes in values", () => {
    const filePath = path.join(tmpDir, "init.cmake");
    writeCMakeInitFile(filePath, [
      { key: "MY_VAR", value: 'say "hello"' },
    ]);
    const content = fs.readFileSync(filePath, "utf8");
    assert.ok(content.includes('set(MY_VAR "say \\"hello\\"" CACHE STRING "" FORCE)'));
  });

  test("creates parent directories if needed", () => {
    const filePath = path.join(tmpDir, "sub", "dir", "init.cmake");
    writeCMakeInitFile(filePath, [
      { key: "FOO", value: "bar" },
    ]);
    assert.ok(fs.existsSync(filePath));
  });
});
