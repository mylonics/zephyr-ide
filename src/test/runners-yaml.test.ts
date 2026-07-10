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
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
    parseRunnersYaml,
    resolveRunnersYamlPath,
    resolveEffectiveBuildDir,
    runnerToServerType,
    runnerNeedsBridge,
    resolveCanonicalRunner,
    invalidateRunnersYamlCache,
} from "../zephyr_utilities/runners-yaml";
import { WEST_DEBUG_RUNNERS } from "../project_utilities/runner_selector";
import {
    buildCortexDebugConfig,
    pickDebugRunner,
} from "../zephyr_utilities/debug-provider";
import { splitArgs } from "../project_utilities/runner_profiles";

function makeTempBuildDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "zide-runners-"));
}

function writeFile(p: string, content: string) {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
}

suite("runners.yaml parser & DebugConfigurationProvider translation", () => {

    test("runnerToServerType maps known runners", () => {
        assert.strictEqual(runnerToServerType("jlink"), "jlink");
        assert.strictEqual(runnerToServerType("openocd"), "openocd");
        assert.strictEqual(runnerToServerType("pyocd"), "pyocd");
        assert.strictEqual(runnerToServerType("stlink"), "stlink");
        assert.strictEqual(runnerToServerType("stlink_gdbserver"), "stlink");
        assert.strictEqual(runnerToServerType("stm32cubeprogrammer-stlink"), "stlink");
        assert.strictEqual(runnerToServerType("stutil"), "stutil");
        assert.strictEqual(runnerToServerType("pe"), "pe");
        assert.strictEqual(runnerToServerType("blackmagicprobe"), "bmp");
        assert.strictEqual(runnerToServerType("bmp"), "bmp");
        assert.strictEqual(runnerToServerType("external"), "external");
        assert.strictEqual(runnerToServerType("qemu"), "qemu");
        assert.strictEqual(runnerToServerType("totally-unknown"), undefined);
    });

    test("runnerToServerType maps bridged runners to external", () => {
        assert.strictEqual(runnerToServerType("nrfjprog"), "external");
        assert.strictEqual(runnerToServerType("linkserver"), "external");
        assert.strictEqual(runnerToServerType("esp32"), "external");
        assert.strictEqual(runnerToServerType("stm32cubeprogrammer"), "external");
        assert.strictEqual(runnerToServerType("probe-rs"), "external");
        assert.strictEqual(runnerToServerType("nxp_s32dbg"), "external");
    });

    test("runnerNeedsBridge agrees with WEST_DEBUG_RUNNERS membership", () => {
        for (const r of WEST_DEBUG_RUNNERS) {
            assert.strictEqual(
                runnerNeedsBridge(r),
                runnerToServerType(r) === "external",
                `${r} should require bridge only when mapped to external`
            );
        }
        // Native servertypes must not be flagged as bridged.
        for (const r of ["jlink", "openocd", "pyocd", "stlink", "stutil", "pe", "bmp", "qemu"]) {
            assert.strictEqual(runnerNeedsBridge(r), false, `${r} should not need bridge`);
        }
    });

    test("resolveCanonicalRunner: picks stlink variant in priority order", () => {
        // All three present → prefer "stlink"
        assert.strictEqual(
            resolveCanonicalRunner("stlink", ["stm32cubeprogrammer-stlink", "stlink_gdbserver", "stlink"]),
            "stlink"
        );
        // Only stlink_gdbserver present → fall back to it
        assert.strictEqual(
            resolveCanonicalRunner("stlink", ["stlink_gdbserver", "openocd"]),
            "stlink_gdbserver"
        );
        // Only stm32cubeprogrammer-stlink present → last resort
        assert.strictEqual(
            resolveCanonicalRunner("stlink", ["stm32cubeprogrammer-stlink"]),
            "stm32cubeprogrammer-stlink"
        );
        // No stlink variant at all → returns "stlink" unchanged
        assert.strictEqual(
            resolveCanonicalRunner("stlink", ["openocd", "jlink"]),
            "stlink"
        );
        // Non-stlink runner → always unchanged
        assert.strictEqual(resolveCanonicalRunner("jlink", ["openocd"]), "jlink");
        assert.strictEqual(resolveCanonicalRunner("probe-rs", ["probe-rs"]), "probe-rs");
    });

    test("resolveCanonicalRunner: picks bmp variant in priority order", () => {
        // blackmagicprobe preferred over bmp
        assert.strictEqual(
            resolveCanonicalRunner("bmp", ["bmp", "blackmagicprobe"]),
            "blackmagicprobe"
        );
        // Only bmp present → use it
        assert.strictEqual(
            resolveCanonicalRunner("bmp", ["bmp", "openocd"]),
            "bmp"
        );
        // No bmp variant → returns "bmp" unchanged
        assert.strictEqual(
            resolveCanonicalRunner("bmp", ["openocd"]),
            "bmp"
        );
    });

    test("parseRunnersYaml returns undefined for missing file", () => {
        const buildDir = makeTempBuildDir();
        const result = parseRunnersYaml(path.join(buildDir, "runners.yaml"));
        assert.strictEqual(result, undefined);
    });

    test("parseRunnersYaml caches parsed result and re-reads when file changes", () => {
        const buildDir = makeTempBuildDir();
        const yamlPath = path.join(buildDir, "zephyr", "runners.yaml");
        const mkYaml = (runner: string) => `
config:
  build_dir: ${buildDir}
  gdb: /opt/sdk/gdb
runners:
  - ${runner}
flash-runner: ${runner}
debug-runner: ${runner}
args:
  ${runner}: []
`;
        invalidateRunnersYamlCache();
        writeFile(yamlPath, mkYaml("jlink"));

        const first = parseRunnersYaml(yamlPath);
        assert.ok(first);
        assert.deepStrictEqual(first!.runners, ["jlink"]);

        // Same call returns the same (frozen) instance from cache — proves no re-parse.
        const second = parseRunnersYaml(yamlPath);
        assert.strictEqual(second, first, "cached call should return identical object reference");

        // Rewrite the file with different content AND bump mtime so the
        // cache's stat-based validity check fails. (Use a future mtime since
        // some filesystems have second-level resolution.)
        writeFile(yamlPath, mkYaml("openocd"));
        const future = new Date(Date.now() + 2000);
        fs.utimesSync(yamlPath, future, future);

        const third = parseRunnersYaml(yamlPath);
        assert.ok(third);
        assert.notStrictEqual(third, first, "stale cache entry must be replaced");
        assert.deepStrictEqual(third!.runners, ["openocd"]);
    });

    test("invalidateRunnersYamlCache drops entries under a build folder", () => {
        const buildDir = makeTempBuildDir();
        const yamlPath = path.join(buildDir, "zephyr", "runners.yaml");
        writeFile(yamlPath, `
config:
  build_dir: ${buildDir}
runners: [jlink]
flash-runner: jlink
debug-runner: jlink
args: { jlink: [] }
`);
        const first = parseRunnersYaml(yamlPath);
        assert.ok(first);
        const cachedHit = parseRunnersYaml(yamlPath);
        assert.strictEqual(cachedHit, first);

        invalidateRunnersYamlCache(buildDir);
        const afterInvalidate = parseRunnersYaml(yamlPath);
        assert.ok(afterInvalidate);
        assert.notStrictEqual(afterInvalidate, first);
        assert.deepStrictEqual(afterInvalidate!.runners, first!.runners);
    });

    test("parseRunnersYaml drops cache entry when file is deleted then recreated", () => {
        const buildDir = makeTempBuildDir();
        const yamlPath = path.join(buildDir, "zephyr", "runners.yaml");
        writeFile(yamlPath, `
config: { build_dir: ${buildDir} }
runners: [jlink]
flash-runner: jlink
debug-runner: jlink
args: { jlink: [] }
`);
        assert.ok(parseRunnersYaml(yamlPath));
        fs.unlinkSync(yamlPath);
        assert.strictEqual(parseRunnersYaml(yamlPath), undefined);
        writeFile(yamlPath, `
config: { build_dir: ${buildDir} }
runners: [openocd]
flash-runner: openocd
debug-runner: openocd
args: { openocd: [] }
`);
        const reparsed = parseRunnersYaml(yamlPath);
        assert.ok(reparsed);
        assert.deepStrictEqual(reparsed!.runners, ["openocd"]);
    });

    test("parseRunnersYaml extracts elf, gdb, runners and args", () => {
        const buildDir = makeTempBuildDir();
        const yamlPath = path.join(buildDir, "zephyr", "runners.yaml");
        const yamlContent = `
config:
  build_dir: ${buildDir}
  board_dir: ${buildDir}/board
  elf_file: zephyr.elf
  hex_file: zephyr.hex
  bin_file: zephyr.bin
  gdb: /opt/sdk/arm-zephyr-eabi-gdb
runners:
  - jlink
  - openocd
flash-runner: jlink
debug-runner: jlink
args:
  jlink:
    - "--device=nRF52840_xxAA"
    - "--speed=4000"
  openocd:
    - "-f"
    - "interface/stlink.cfg"
    - "-f"
    - "target/nrf52.cfg"
`;
        writeFile(yamlPath, yamlContent);

        const parsed = parseRunnersYaml(yamlPath);
        assert.ok(parsed, "must parse");
        assert.deepStrictEqual(parsed!.runners, ["jlink", "openocd"]);
        assert.strictEqual(parsed!.flashRunner, "jlink");
        assert.strictEqual(parsed!.debugRunner, "jlink");
        assert.strictEqual(parsed!.gdb, "/opt/sdk/arm-zephyr-eabi-gdb");
        // Resolved against build_dir/zephyr. runners-yaml.ts uses upath which
        // always produces POSIX separators, so check with a forward-slash literal.
        assert.ok(parsed!.elfFile && parsed!.elfFile.endsWith("zephyr/zephyr.elf"),
            `elfFile should be absolute and end in zephyr/zephyr.elf, got ${parsed!.elfFile}`);
        assert.deepStrictEqual(parsed!.args["jlink"], [
            "--device=nRF52840_xxAA",
            "--speed=4000",
        ]);
        assert.deepStrictEqual(parsed!.args["openocd"], [
            "-f", "interface/stlink.cfg", "-f", "target/nrf52.cfg",
        ]);
    });

    test("resolveRunnersYamlPath honours sysbuild domains.yaml", () => {
        const topDir = makeTempBuildDir();
        const domainBuildDir = path.join(topDir, "myapp");
        fs.mkdirSync(domainBuildDir, { recursive: true });
        const domainsYaml = `
default: myapp
domains:
  - name: myapp
    build_dir: ${domainBuildDir}
`;
        writeFile(path.join(topDir, "domains.yaml"), domainsYaml);

        const resolved = resolveRunnersYamlPath(topDir);
        assert.strictEqual(
            path.normalize(resolved),
            path.normalize(path.join(domainBuildDir, "zephyr", "runners.yaml")),
        );
    });

    test("resolveRunnersYamlPath falls back to top build dir without sysbuild", () => {
        const buildDir = makeTempBuildDir();
        const resolved = resolveRunnersYamlPath(buildDir);
        assert.strictEqual(
            path.normalize(resolved),
            path.normalize(path.join(buildDir, "zephyr", "runners.yaml")),
        );
    });

    test("pickDebugRunner respects explicit, then debug-runner, then list head", () => {
        const ry: any = { runners: ["jlink", "openocd"], debugRunner: "openocd", args: {} };
        // Explicit runner that IS in runners.yaml is returned as-is.
        assert.strictEqual(pickDebugRunner(ry, "jlink"), "jlink");
        // Explicit runner that is NOT in runners.yaml but IS cortex-debug-capable
        // is returned as-is (with a warning) so the user's explicit choice is honoured.
        assert.strictEqual(pickDebugRunner(ry, "pyocd"), "pyocd");
        assert.strictEqual(pickDebugRunner(ry), "openocd");
        const ry2: any = { runners: ["jlink"], args: {} };
        assert.strictEqual(pickDebugRunner(ry2), "jlink");
        const ry3: any = { runners: [], args: {} };
        assert.strictEqual(pickDebugRunner(ry3), undefined);
    });

    test("pickDebugRunner: requested-runner fallback skips non-cortex-debug debugRunner", () => {
        // Requested runner "pyocd" is not in runners.yaml but IS cortex-debug-capable.
        // The explicit choice is returned as-is (with a warning) regardless of debugRunner.
        const ry: any = { runners: ["openocd", "qemu"], debugRunner: "qemu", args: {} };
        assert.strictEqual(pickDebugRunner(ry, "pyocd"), "pyocd");
        // Same: even when the only available runner is qemu, if the requested
        // runner is cortex-debug-capable it is returned directly.
        const ry2: any = { runners: ["qemu"], debugRunner: "qemu", args: {} };
        assert.strictEqual(pickDebugRunner(ry2, "pyocd"), "pyocd");
        // When the requested runner is itself not cortex-debug-capable AND
        // no capable runner exists in runners.yaml, return undefined so the
        // caller surfaces a clean "cannot translate" error rather than
        // forwarding a bogus server-type to cortex-debug.
        const ry3: any = { runners: ["qemu"], debugRunner: "qemu", args: {} };
        assert.strictEqual(pickDebugRunner(ry3, "dfu-util"), undefined);
    });

    test("splitArgs: whitespace-separated tokens", () => {
        assert.deepStrictEqual(splitArgs(""), []);
        assert.deepStrictEqual(splitArgs("   "), []);
        assert.deepStrictEqual(splitArgs("--a --b --c"), ["--a", "--b", "--c"]);
        assert.deepStrictEqual(splitArgs("--key=value"), ["--key=value"]);
        // Tabs and newlines also separate.
        assert.deepStrictEqual(splitArgs("--a\t--b\n--c"), ["--a", "--b", "--c"]);
    });

    test("splitArgs: quoted strings group whitespace and strip quote characters", () => {
        // Mid-token quotes are stripped (the legacy regex-based splitter left
        // a stray trailing quote here, e.g. `--key=some path`+`"` ).
        assert.deepStrictEqual(
            splitArgs(`--key="some path"`),
            ["--key=some path"],
        );
        assert.deepStrictEqual(
            splitArgs(`'a b' "c d"`),
            ["a b", "c d"],
        );
        // Adjacent quoted segments concatenate into one token.
        assert.deepStrictEqual(
            splitArgs(`"a"'b'"c"`),
            ["abc"],
        );
    });

    test("splitArgs: backslash escapes inside double quotes", () => {
        // \" and \\ are recognized inside double quotes.
        assert.deepStrictEqual(
            splitArgs(`--msg="hello \\"world\\""`),
            [`--msg=hello "world"`],
        );
        assert.deepStrictEqual(
            splitArgs(`"a\\\\b"`),
            ["a\\b"],
        );
        // Single quotes are literal — backslashes are preserved as-is (POSIX).
        assert.deepStrictEqual(
            splitArgs(`'hello \\"world\\"'`),
            [`hello \\"world\\"`],
        );
    });

    test("splitArgs: unterminated quotes consume to end-of-input", () => {
        // Unterminated quotes don't silently swallow following tokens; instead
        // they greedily consume to EOL so a typo surfaces as a single weird
        // token rather than as missing later args.
        assert.deepStrictEqual(
            splitArgs(`--a "unterminated`),
            ["--a", "unterminated"],
        );
        assert.deepStrictEqual(
            splitArgs(`--a 'unterminated`),
            ["--a", "unterminated"],
        );
    });

    test("buildCortexDebugConfig builds a jlink config with device/speed extracted", () => {
        const ry: any = {
            elfFile: "/p/zephyr.elf",
            gdb: "/sdk/arm-zephyr-eabi-gdb",
            runners: ["jlink"],
            args: { jlink: ["--device=nRF52840_xxAA", "--speed=4000", "--iface=swd"] },
        };
        const cfg: any = buildCortexDebugConfig(ry, "jlink");
        assert.ok(cfg);
        assert.strictEqual(cfg.type, "cortex-debug");
        assert.strictEqual(cfg.servertype, "jlink");
        assert.strictEqual(cfg.executable, "/p/zephyr.elf");
        assert.strictEqual(cfg.gdbPath, "/sdk/arm-zephyr-eabi-gdb");
        assert.strictEqual(cfg.rtos, "Zephyr");
        assert.strictEqual(cfg.device, "nRF52840_xxAA");
        assert.strictEqual(cfg.interface, "swd");
        assert.deepStrictEqual(cfg.serverArgs, ["-speed", "4000"]);
    });

    test("buildCortexDebugConfig builds an openocd config with configFiles extracted", () => {
        const ry: any = {
            elfFile: "/p/zephyr.elf",
            gdb: "/sdk/gdb",
            runners: ["openocd"],
            args: {
                openocd: [
                    "-f", "interface/stlink.cfg",
                    "-f", "target/nrf52.cfg",
                ],
            },
            openocdSearch: ["/share/openocd"],
            openocd: "/usr/bin/openocd",
        };
        const cfg: any = buildCortexDebugConfig(ry, "openocd", { request: "attach" });
        assert.ok(cfg);
        assert.strictEqual(cfg.servertype, "openocd");
        assert.strictEqual(cfg.request, "attach");
        assert.deepStrictEqual(cfg.configFiles, ["interface/stlink.cfg", "target/nrf52.cfg"]);
        assert.deepStrictEqual(cfg.searchDir, ["/share/openocd"]);
        assert.strictEqual(cfg.serverpath, "/usr/bin/openocd");
    });

    test("buildCortexDebugConfig returns undefined for unknown runner", () => {
        const ry: any = { runners: ["weird"], args: {} };
        assert.strictEqual(buildCortexDebugConfig(ry, "weird"), undefined);
    });

    test("buildCortexDebugConfig: BMP serial port extracted", () => {
        const ry: any = {
            elfFile: "/p/zephyr.elf",
            gdb: "/sdk/gdb",
            runners: ["blackmagicprobe"],
            args: { blackmagicprobe: ["--gdb-serial=/dev/ttyACM0"] },
        };
        const cfg: any = buildCortexDebugConfig(ry, "blackmagicprobe");
        assert.ok(cfg);
        assert.strictEqual(cfg.servertype, "bmp");
        assert.strictEqual(cfg.BMPGDBSerialPort, "/dev/ttyACM0");
        assert.strictEqual(cfg.interface, "swd");
        assert.strictEqual(cfg.rtos, undefined, "BMP does not support RTOS option");
    });

    test("buildCortexDebugConfig: BMP defaults interface to swd when no args", () => {
        const ry: any = {
            elfFile: "/p/zephyr.elf",
            gdb: "/sdk/gdb",
            runners: ["blackmagicprobe"],
            args: { blackmagicprobe: ["--gdb-serial=COM3"] },
        };
        const cfg: any = buildCortexDebugConfig(ry, "blackmagicprobe");
        assert.ok(cfg);
        assert.strictEqual(cfg.interface, "swd");
    });

    test("buildCortexDebugConfig: BMP --interface arg overrides default", () => {
        const ry: any = {
            elfFile: "/p/zephyr.elf",
            gdb: "/sdk/gdb",
            runners: ["blackmagicprobe"],
            args: { blackmagicprobe: ["--gdb-serial=/dev/ttyACM0", "--interface=jtag"] },
        };
        const cfg: any = buildCortexDebugConfig(ry, "blackmagicprobe");
        assert.ok(cfg);
        assert.strictEqual(cfg.interface, "jtag");
    });

    test("buildCortexDebugConfig: BMP serial port from userArgs (no runners.yaml args)", () => {
        // Simulates the case where --gdb-serial=COM3 is only in the RunnerConfig
        // (e.g. build.runnerConfigs.blackmagicprobe.args) and runners.yaml has no args.
        const ry: any = {
            elfFile: "/p/zephyr.elf",
            gdb: "/sdk/gdb",
            runners: ["blackmagicprobe"],
            args: {},
        };
        const cfg: any = buildCortexDebugConfig(ry, "blackmagicprobe", {
            userArgs: ["--gdb-serial=COM3"],
        });
        assert.ok(cfg);
        assert.strictEqual(cfg.BMPGDBSerialPort, "COM3");
        assert.strictEqual(cfg.interface, "swd");
        assert.strictEqual(cfg.rtos, undefined, "BMP does not support RTOS option");
    });

    test("buildCortexDebugConfig: non-BMP runners include rtos=Zephyr", () => {
        const ry: any = {
            elfFile: "/p/zephyr.elf",
            gdb: "/sdk/gdb",
            runners: ["openocd"],
            args: {},
        };
        const cfg: any = buildCortexDebugConfig(ry, "openocd");
        assert.ok(cfg);
        assert.strictEqual(cfg.rtos, "Zephyr");
    });
});

suite("resolveEffectiveBuildDir — sysbuild domain resolution", () => {
    test("returns buildDir unchanged when domains.yaml is absent (non-sysbuild)", () => {
        const buildDir = makeTempBuildDir();
        assert.strictEqual(resolveEffectiveBuildDir(buildDir), buildDir);
    });

    test("returns default domain build_dir when domains.yaml is present", () => {
        const buildDir = makeTempBuildDir();
        const domainBuildDir = path.join(buildDir, "hello_world");
        fs.mkdirSync(domainBuildDir, { recursive: true });
        writeFile(path.join(buildDir, "domains.yaml"), [
            "default: hello_world",
            "domains:",
            `  - name: hello_world`,
            `    build_dir: ${domainBuildDir}`,
        ].join("\n"));

        assert.strictEqual(resolveEffectiveBuildDir(buildDir), domainBuildDir);
    });

    test("resolves a specific domain by name", () => {
        const buildDir = makeTempBuildDir();
        const domainA = path.join(buildDir, "app_a");
        const domainB = path.join(buildDir, "app_b");
        writeFile(path.join(buildDir, "domains.yaml"), [
            "default: app_a",
            "domains:",
            `  - name: app_a`,
            `    build_dir: ${domainA}`,
            `  - name: app_b`,
            `    build_dir: ${domainB}`,
        ].join("\n"));

        assert.strictEqual(resolveEffectiveBuildDir(buildDir, "app_b"), domainB);
    });

    test("falls back to buildDir when named domain is not in domains.yaml", () => {
        const buildDir = makeTempBuildDir();
        const domainBuildDir = path.join(buildDir, "hello_world");
        writeFile(path.join(buildDir, "domains.yaml"), [
            "default: hello_world",
            "domains:",
            `  - name: hello_world`,
            `    build_dir: ${domainBuildDir}`,
        ].join("\n"));

        // Requesting a domain that does not exist falls back to the top-level dir
        assert.strictEqual(resolveEffectiveBuildDir(buildDir, "nonexistent"), buildDir);
    });

    test("falls back to buildDir when domains.yaml is malformed", () => {
        const buildDir = makeTempBuildDir();
        writeFile(path.join(buildDir, "domains.yaml"), "{ this is: [not valid yaml");

        assert.strictEqual(resolveEffectiveBuildDir(buildDir), buildDir);
    });

    test("resolveRunnersYamlPath delegates to default domain via resolveEffectiveBuildDir", () => {
        const buildDir = makeTempBuildDir();
        const domainBuildDir = path.join(buildDir, "hello_world");
        writeFile(path.join(buildDir, "domains.yaml"), [
            "default: hello_world",
            "domains:",
            `  - name: hello_world`,
            `    build_dir: ${domainBuildDir}`,
        ].join("\n"));

        const expected = path.join(domainBuildDir, "zephyr", "runners.yaml");
        assert.strictEqual(
            path.normalize(resolveRunnersYamlPath(buildDir)),
            path.normalize(expected),
        );
    });
});
