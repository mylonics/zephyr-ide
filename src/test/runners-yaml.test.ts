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
    runnerToServerType,
} from "../zephyr_utilities/runners-yaml";
import {
    buildCortexDebugConfig,
    pickDebugRunner,
} from "../zephyr_utilities/debug-provider";

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
        assert.strictEqual(runnerToServerType("blackmagicprobe"), "bmp");
        assert.strictEqual(runnerToServerType("bmp"), "bmp");
        assert.strictEqual(runnerToServerType("totally-unknown"), undefined);
    });

    test("parseRunnersYaml returns undefined for missing file", () => {
        const buildDir = makeTempBuildDir();
        const result = parseRunnersYaml(path.join(buildDir, "runners.yaml"));
        assert.strictEqual(result, undefined);
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
        // Resolved against build_dir/zephyr
        assert.ok(parsed!.elfFile && parsed!.elfFile.endsWith(path.join("zephyr", "zephyr.elf")),
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
        // Explicit runner that is NOT in runners.yaml falls back to debugRunner
        // (with a warning logged) to avoid silently producing an empty-args config.
        assert.strictEqual(pickDebugRunner(ry, "pyocd"), "openocd");
        assert.strictEqual(pickDebugRunner(ry), "openocd");
        const ry2: any = { runners: ["jlink"], args: {} };
        assert.strictEqual(pickDebugRunner(ry2), "jlink");
        const ry3: any = { runners: [], args: {} };
        assert.strictEqual(pickDebugRunner(ry3), undefined);
    });

    test("pickDebugRunner: requested-runner fallback skips non-cortex-debug debugRunner", () => {
        // debugRunner is qemu (not cortex-debug-capable). Requested runner
        // "pyocd" is not in runners.yaml. Fallback should not return qemu;
        // it should walk runners.yaml.runners for the first capable one.
        const ry: any = { runners: ["openocd", "qemu"], debugRunner: "qemu", args: {} };
        assert.strictEqual(pickDebugRunner(ry, "pyocd"), "openocd");
        // When no capable runner exists either, return the requested name so
        // the caller can produce a useful "cannot translate" error.
        const ry2: any = { runners: ["qemu"], debugRunner: "qemu", args: {} };
        assert.strictEqual(pickDebugRunner(ry2, "pyocd"), "pyocd");
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
