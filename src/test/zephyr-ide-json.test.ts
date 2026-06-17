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
import * as path from "upath";

import {
  getZephyrIdeToolchains,
  setZephyrIdeToolchains,
  getZephyrIdeBlobs,
  setZephyrIdeBlobs,
  getZephyrIdeSdkVersion,
  setZephyrIdeSdkVersion,
  getZephyrIdeSampleProjects,
  setZephyrIdeSampleProjects,
  getZephyrIdePipPackages,
  setZephyrIdePipPackages,
  getZephyrIdePipRequirements,
  setZephyrIdePipRequirements,
  resolveZephyrIdePipRequirementsPath,
  getZephyrIdeCommands,
  setZephyrIdeCommands,
  readZephyrIdeJson,
} from "../setup_utilities/zephyr_ide_json";
import { WorkspaceConfig } from "../setup_utilities/types";
import { ProjectConfig } from "../project_utilities/project";

function makeWsConfig(rootPath: string): WorkspaceConfig {
  return {
    rootPath,
    projects: {},
    projectStates: {},
  };
}

suite("zephyr-ide.json toolchains/blobs Test Suite", () => {
  test("getZephyrIdeToolchains returns empty array when file is missing", async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zephyr-ide-tc-"));
    try {
      const ws = makeWsConfig(tmpRoot);
      assert.deepStrictEqual(getZephyrIdeToolchains(ws), []);
      assert.deepStrictEqual(getZephyrIdeBlobs(ws), []);
    } finally {
      await fs.remove(tmpRoot);
    }
  });

  test("setZephyrIdeToolchains creates file and persists list", async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zephyr-ide-tc-"));
    try {
      const ws = makeWsConfig(tmpRoot);
      await setZephyrIdeToolchains(ws, ["arm-zephyr-eabi", "riscv64-zephyr-elf"]);
      assert.deepStrictEqual(getZephyrIdeToolchains(ws), ["arm-zephyr-eabi", "riscv64-zephyr-elf"]);

      const onDisk = await fs.readJson(path.join(tmpRoot, ".vscode", "zephyr-ide.json"));
      assert.deepStrictEqual(onDisk.toolchains, ["arm-zephyr-eabi", "riscv64-zephyr-elf"]);
    } finally {
      await fs.remove(tmpRoot);
    }
  });

  test("setZephyrIdeToolchains preserves other top-level keys (e.g. projects, blobs)", async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zephyr-ide-tc-"));
    try {
      const ws = makeWsConfig(tmpRoot);
      const filePath = path.join(tmpRoot, ".vscode", "zephyr-ide.json");
      await fs.outputJson(filePath, {
        projects: { app: { name: "app", rel_path: "app" } },
        blobs: ["hal_nordic"],
        my_var: "value",
      });

      await setZephyrIdeToolchains(ws, ["arm-zephyr-eabi"]);

      const onDisk = await fs.readJson(filePath);
      assert.deepStrictEqual(onDisk.toolchains, ["arm-zephyr-eabi"]);
      assert.deepStrictEqual(onDisk.blobs, ["hal_nordic"]);
      assert.deepStrictEqual(onDisk.projects, { app: { name: "app", rel_path: "app" } });
      assert.strictEqual(onDisk.my_var, "value");
    } finally {
      await fs.remove(tmpRoot);
    }
  });

  test("setZephyrIdeBlobs preserves other top-level keys", async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zephyr-ide-tc-"));
    try {
      const ws = makeWsConfig(tmpRoot);
      const filePath = path.join(tmpRoot, ".vscode", "zephyr-ide.json");
      await fs.outputJson(filePath, {
        projects: { app: {} },
        toolchains: ["arm-zephyr-eabi"],
      });

      await setZephyrIdeBlobs(ws, ["hal_nordic", "hal_st"]);

      const onDisk = await fs.readJson(filePath);
      assert.deepStrictEqual(onDisk.blobs, ["hal_nordic", "hal_st"]);
      assert.deepStrictEqual(onDisk.toolchains, ["arm-zephyr-eabi"]);
      assert.deepStrictEqual(onDisk.projects, { app: {} });
    } finally {
      await fs.remove(tmpRoot);
    }
  });

  test("setZephyrIdeToolchains with empty list removes the key", async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zephyr-ide-tc-"));
    try {
      const ws = makeWsConfig(tmpRoot);
      await setZephyrIdeToolchains(ws, ["arm-zephyr-eabi"]);
      await setZephyrIdeToolchains(ws, []);

      const onDisk = readZephyrIdeJson(ws);
      assert.strictEqual(onDisk.toolchains, undefined);
    } finally {
      await fs.remove(tmpRoot);
    }
  });

  test("getZephyrIdeToolchains normalises malformed entries", async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zephyr-ide-tc-"));
    try {
      const ws = makeWsConfig(tmpRoot);
      const filePath = path.join(tmpRoot, ".vscode", "zephyr-ide.json");
      await fs.outputJson(filePath, {
        toolchains: ["arm-zephyr-eabi", "", "  riscv64-zephyr-elf  ", "arm-zephyr-eabi", 42, null],
      });
      assert.deepStrictEqual(getZephyrIdeToolchains(ws), ["arm-zephyr-eabi", "riscv64-zephyr-elf"]);
    } finally {
      await fs.remove(tmpRoot);
    }
  });

  test("readZephyrIdeJson rejects arrays and null at the top level", async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zephyr-ide-tc-"));
    try {
      const ws = makeWsConfig(tmpRoot);
      const filePath = path.join(tmpRoot, ".vscode", "zephyr-ide.json");

      // Top-level array — must not be returned, otherwise later writes silently lose data.
      await fs.outputFile(filePath, JSON.stringify(["arm-zephyr-eabi"]));
      assert.deepStrictEqual(readZephyrIdeJson(ws), {});
      assert.deepStrictEqual(getZephyrIdeToolchains(ws), []);

      // Top-level null — same risk.
      await fs.outputFile(filePath, "null");
      assert.deepStrictEqual(readZephyrIdeJson(ws), {});
    } finally {
      await fs.remove(tmpRoot);
    }
  });

  test("setZephyrIdeSdkVersion round-trips and preserves other top-level keys", async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zephyr-ide-tc-"));
    try {
      const ws = makeWsConfig(tmpRoot);
      const filePath = path.join(tmpRoot, ".vscode", "zephyr-ide.json");
      await fs.outputJson(filePath, {
        toolchains: ["arm-zephyr-eabi"],
        projects: { app: { name: "app", rel_path: "app" } },
      });

      await setZephyrIdeSdkVersion(ws, "0.17.0");
      assert.strictEqual(getZephyrIdeSdkVersion(ws), "0.17.0");

      const onDisk = await fs.readJson(filePath);
      assert.strictEqual(onDisk.sdkVersion, "0.17.0");
      assert.deepStrictEqual(onDisk.toolchains, ["arm-zephyr-eabi"]);
      assert.deepStrictEqual(onDisk.projects, { app: { name: "app", rel_path: "app" } });
    } finally {
      await fs.remove(tmpRoot);
    }
  });

  test("setZephyrIdeSdkVersion with empty / undefined removes the key", async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zephyr-ide-tc-"));
    try {
      const ws = makeWsConfig(tmpRoot);
      await setZephyrIdeSdkVersion(ws, "0.17.0");
      await setZephyrIdeSdkVersion(ws, "  ");
      assert.strictEqual(getZephyrIdeSdkVersion(ws), undefined);
      assert.strictEqual(readZephyrIdeJson(ws).sdkVersion, undefined);

      await setZephyrIdeSdkVersion(ws, "0.17.0");
      await setZephyrIdeSdkVersion(ws, undefined);
      assert.strictEqual(getZephyrIdeSdkVersion(ws), undefined);
    } finally {
      await fs.remove(tmpRoot);
    }
  });

  test("getZephyrIdeSdkVersion ignores non-string values", async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zephyr-ide-tc-"));
    try {
      const ws = makeWsConfig(tmpRoot);
      const filePath = path.join(tmpRoot, ".vscode", "zephyr-ide.json");
      await fs.outputJson(filePath, { sdkVersion: 17 });
      assert.strictEqual(getZephyrIdeSdkVersion(ws), undefined);
    } finally {
      await fs.remove(tmpRoot);
    }
  });

  // Helper: minimal ProjectConfig for tests.
  function makeProjectConfig(relPath: string): ProjectConfig {
    return {
      name: path.basename(relPath),
      rel_path: relPath,
      buildConfigs: {},
      confFiles: { config: [], overlay: [] },
      twisterConfigs: {},
    };
  }

  test("getZephyrIdeSampleProjects returns empty array when file is missing", async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zephyr-ide-sp-"));
    try {
      const ws = makeWsConfig(tmpRoot);
      assert.deepStrictEqual(getZephyrIdeSampleProjects(ws), []);
    } finally {
      await fs.remove(tmpRoot);
    }
  });

  test("setZephyrIdeSampleProjects creates file and persists list", async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zephyr-ide-sp-"));
    try {
      const ws = makeWsConfig(tmpRoot);
      const projects = [makeProjectConfig("samples/blinky"), makeProjectConfig("samples/hello_world")];
      await setZephyrIdeSampleProjects(ws, projects);
      const result = getZephyrIdeSampleProjects(ws);
      assert.strictEqual(result.length, 2);
      assert.strictEqual(result[0].rel_path, "samples/blinky");
      assert.strictEqual(result[1].rel_path, "samples/hello_world");
      // Check that the full config is persisted on disk.
      const onDisk = await fs.readJson(path.join(tmpRoot, ".vscode", "zephyr-ide.json"));
      assert.strictEqual(onDisk.sampleProjects[0].rel_path, "samples/blinky");
      assert.strictEqual(onDisk.sampleProjects[1].rel_path, "samples/hello_world");
    } finally {
      await fs.remove(tmpRoot);
    }
  });

  test("setZephyrIdeSampleProjects preserves other top-level keys", async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zephyr-ide-sp-"));
    try {
      const ws = makeWsConfig(tmpRoot);
      const filePath = path.join(tmpRoot, ".vscode", "zephyr-ide.json");
      await fs.outputJson(filePath, {
        projects: { app: { name: "app", rel_path: "app" } },
        toolchains: ["arm-zephyr-eabi"],
        blobs: ["hal_nordic"],
      });

      await setZephyrIdeSampleProjects(ws, [makeProjectConfig("samples/blinky")]);

      const onDisk = await fs.readJson(filePath);
      assert.strictEqual(onDisk.sampleProjects[0].rel_path, "samples/blinky");
      assert.deepStrictEqual(onDisk.toolchains, ["arm-zephyr-eabi"]);
      assert.deepStrictEqual(onDisk.blobs, ["hal_nordic"]);
      assert.deepStrictEqual(onDisk.projects, { app: { name: "app", rel_path: "app" } });
    } finally {
      await fs.remove(tmpRoot);
    }
  });

  test("setZephyrIdeSampleProjects with empty list removes the key", async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zephyr-ide-sp-"));
    try {
      const ws = makeWsConfig(tmpRoot);
      await setZephyrIdeSampleProjects(ws, [makeProjectConfig("samples/blinky")]);
      await setZephyrIdeSampleProjects(ws, []);

      const onDisk = readZephyrIdeJson(ws);
      assert.strictEqual(onDisk.sampleProjects, undefined);
    } finally {
      await fs.remove(tmpRoot);
    }
  });

  test("getZephyrIdeSampleProjects normalises malformed entries and drops duplicates", async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zephyr-ide-sp-"));
    try {
      const ws = makeWsConfig(tmpRoot);
      const filePath = path.join(tmpRoot, ".vscode", "zephyr-ide.json");
      // Mix of strings (legacy), empty strings, duplicates, and non-string values.
      await fs.outputJson(filePath, {
        sampleProjects: ["samples/blinky", "", "  samples/hello_world  ", "samples/blinky", 42, null],
      });
      const result = getZephyrIdeSampleProjects(ws);
      assert.strictEqual(result.length, 2);
      assert.strictEqual(result[0].rel_path, "samples/blinky");
      assert.strictEqual(result[1].rel_path, "samples/hello_world");
      // Legacy strings produce minimal ProjectConfig with basename as name.
      assert.strictEqual(result[0].name, "blinky");
      assert.strictEqual(result[1].name, "hello_world");
    } finally {
      await fs.remove(tmpRoot);
    }
  });

  test("getZephyrIdeSampleProjects reads back full ProjectConfig (round-trip)", async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zephyr-ide-sp-"));
    try {
      const ws = makeWsConfig(tmpRoot);
      const debugBuild = {
        name: "debug", board: "nrf52840dk",
        relBoardDir: "", relBoardSubDir: "", debugOptimization: "g",
        westBuildArgs: [], westBuildCMakeArgs: ["-DCONFIG_LOG=y"],
        runnerConfigs: {}, confFiles: { config: [], overlay: [] },
        launchTarget: "", buildDebugTarget: "", attachTarget: "",
      };
      const fullConfig = {
        name: "blinky",
        rel_path: "samples/blinky",
        buildConfigs: { debug: debugBuild },
        confFiles: { config: ["prj.conf"], overlay: [] },
        twisterConfigs: {},
      };
      await setZephyrIdeSampleProjects(ws, [fullConfig as any]);
      const result = getZephyrIdeSampleProjects(ws);
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].rel_path, "samples/blinky");
      assert.strictEqual(result[0].name, "blinky");
      assert.deepStrictEqual(result[0].confFiles, { config: ["prj.conf"], overlay: [] });
      assert.ok(result[0].buildConfigs["debug"], "build config 'debug' should be present");
    } finally {
      await fs.remove(tmpRoot);
    }
  });

  test("getZephyrIdePipPackages returns empty array when file is missing", async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zephyr-ide-pip-"));
    try {
      const ws = makeWsConfig(tmpRoot);
      assert.deepStrictEqual(getZephyrIdePipPackages(ws), []);
    } finally {
      await fs.remove(tmpRoot);
    }
  });

  test("setZephyrIdePipPackages creates file and persists list", async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zephyr-ide-pip-"));
    try {
      const ws = makeWsConfig(tmpRoot);
      await setZephyrIdePipPackages(ws, ["dtsh", "pyocd"]);
      assert.deepStrictEqual(getZephyrIdePipPackages(ws), ["dtsh", "pyocd"]);

      const onDisk = await fs.readJson(path.join(tmpRoot, ".vscode", "zephyr-ide.json"));
      assert.deepStrictEqual(onDisk.pipPackages, ["dtsh", "pyocd"]);
    } finally {
      await fs.remove(tmpRoot);
    }
  });

  test("setZephyrIdePipPackages with empty list removes the key", async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zephyr-ide-pip-"));
    try {
      const ws = makeWsConfig(tmpRoot);
      await setZephyrIdePipPackages(ws, ["dtsh"]);
      await setZephyrIdePipPackages(ws, []);
      assert.strictEqual(readZephyrIdeJson(ws).pipPackages, undefined);
    } finally {
      await fs.remove(tmpRoot);
    }
  });

  test("setZephyrIdePipPackages preserves other top-level keys", async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zephyr-ide-pip-"));
    try {
      const ws = makeWsConfig(tmpRoot);
      const filePath = path.join(tmpRoot, ".vscode", "zephyr-ide.json");
      await fs.outputJson(filePath, { toolchains: ["arm-zephyr-eabi"], blobs: ["hal_nordic"] });

      await setZephyrIdePipPackages(ws, ["dtsh", "pyocd"]);

      const onDisk = await fs.readJson(filePath);
      assert.deepStrictEqual(onDisk.pipPackages, ["dtsh", "pyocd"]);
      assert.deepStrictEqual(onDisk.toolchains, ["arm-zephyr-eabi"]);
      assert.deepStrictEqual(onDisk.blobs, ["hal_nordic"]);
    } finally {
      await fs.remove(tmpRoot);
    }
  });

  test("getZephyrIdePipPackages normalises malformed entries", async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zephyr-ide-pip-"));
    try {
      const ws = makeWsConfig(tmpRoot);
      const filePath = path.join(tmpRoot, ".vscode", "zephyr-ide.json");
      await fs.outputJson(filePath, {
        pipPackages: ["dtsh", "", "  pyocd  ", "dtsh", 42, null],
      });
      assert.deepStrictEqual(getZephyrIdePipPackages(ws), ["dtsh", "pyocd"]);
    } finally {
      await fs.remove(tmpRoot);
    }
  });

  test("getZephyrIdePipRequirements returns empty array when file is missing", async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zephyr-ide-req-"));
    try {
      const ws = makeWsConfig(tmpRoot);
      assert.deepStrictEqual(getZephyrIdePipRequirements(ws), []);
    } finally {
      await fs.remove(tmpRoot);
    }
  });

  test("setZephyrIdePipRequirements creates file and persists list", async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zephyr-ide-req-"));
    try {
      const ws = makeWsConfig(tmpRoot);
      await setZephyrIdePipRequirements(ws, [
        "external/nrf/scripts/requirements.txt",
        "external/bootloader/mcuboot/boot/zephyr/scripts/requirements.txt",
      ]);
      assert.deepStrictEqual(getZephyrIdePipRequirements(ws), [
        "external/nrf/scripts/requirements.txt",
        "external/bootloader/mcuboot/boot/zephyr/scripts/requirements.txt",
      ]);

      const onDisk = await fs.readJson(path.join(tmpRoot, ".vscode", "zephyr-ide.json"));
      assert.deepStrictEqual(onDisk.pipRequirements, [
        "external/nrf/scripts/requirements.txt",
        "external/bootloader/mcuboot/boot/zephyr/scripts/requirements.txt",
      ]);
    } finally {
      await fs.remove(tmpRoot);
    }
  });

  test("setZephyrIdePipRequirements with empty list removes the key", async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zephyr-ide-req-"));
    try {
      const ws = makeWsConfig(tmpRoot);
      await setZephyrIdePipRequirements(ws, ["scripts/requirements.txt"]);
      await setZephyrIdePipRequirements(ws, []);
      assert.strictEqual(readZephyrIdeJson(ws).pipRequirements, undefined);
    } finally {
      await fs.remove(tmpRoot);
    }
  });

  test("setZephyrIdePipRequirements preserves other top-level keys (toolchains, pipPackages)", async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zephyr-ide-req-"));
    try {
      const ws = makeWsConfig(tmpRoot);
      const filePath = path.join(tmpRoot, ".vscode", "zephyr-ide.json");
      await fs.outputJson(filePath, {
        toolchains: ["arm-zephyr-eabi"],
        pipPackages: ["dtsh"],
      });

      await setZephyrIdePipRequirements(ws, ["external/nrf/scripts/requirements.txt"]);

      const onDisk = await fs.readJson(filePath);
      assert.deepStrictEqual(onDisk.pipRequirements, ["external/nrf/scripts/requirements.txt"]);
      assert.deepStrictEqual(onDisk.toolchains, ["arm-zephyr-eabi"]);
      assert.deepStrictEqual(onDisk.pipPackages, ["dtsh"]);
    } finally {
      await fs.remove(tmpRoot);
    }
  });

  test("getZephyrIdePipRequirements normalises malformed entries", async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zephyr-ide-req-"));
    try {
      const ws = makeWsConfig(tmpRoot);
      const filePath = path.join(tmpRoot, ".vscode", "zephyr-ide.json");
      await fs.outputJson(filePath, {
        pipRequirements: [
          "scripts/requirements.txt",
          "",
          "  external/nrf/scripts/requirements.txt  ",
          "scripts/requirements.txt", // duplicate
          42,
          null,
        ],
      });
      assert.deepStrictEqual(getZephyrIdePipRequirements(ws), [
        "scripts/requirements.txt",
        "external/nrf/scripts/requirements.txt",
      ]);
    } finally {
      await fs.remove(tmpRoot);
    }
  });

  test("pipPackages and pipRequirements coexist in the same file", async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zephyr-ide-pip-req-"));
    try {
      const ws = makeWsConfig(tmpRoot);
      await setZephyrIdePipPackages(ws, ["dtsh", "pyocd"]);
      await setZephyrIdePipRequirements(ws, ["external/nrf/scripts/requirements.txt"]);

      assert.deepStrictEqual(getZephyrIdePipPackages(ws), ["dtsh", "pyocd"]);
      assert.deepStrictEqual(getZephyrIdePipRequirements(ws), ["external/nrf/scripts/requirements.txt"]);

      const onDisk = await fs.readJson(path.join(tmpRoot, ".vscode", "zephyr-ide.json"));
      assert.deepStrictEqual(onDisk.pipPackages, ["dtsh", "pyocd"]);
      assert.deepStrictEqual(onDisk.pipRequirements, ["external/nrf/scripts/requirements.txt"]);
    } finally {
      await fs.remove(tmpRoot);
    }
  });

  test("resolveZephyrIdePipRequirementsPath resolves relative paths against workspace root", async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zephyr-ide-pip-req-"));
    try {
      const ws = makeWsConfig(tmpRoot);
      const resolved = resolveZephyrIdePipRequirementsPath(ws, "external/nrf/scripts/requirements.txt");
      assert.strictEqual(resolved, path.join(tmpRoot, "external/nrf/scripts/requirements.txt"));
    } finally {
      await fs.remove(tmpRoot);
    }
  });

  test("resolveZephyrIdePipRequirementsPath preserves absolute paths", async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zephyr-ide-pip-req-"));
    try {
      const ws = makeWsConfig(tmpRoot);
      const absoluteReq = path.join(tmpRoot, "external", "nrf", "scripts", "requirements.txt");
      const resolved = resolveZephyrIdePipRequirementsPath(ws, absoluteReq);
      assert.strictEqual(resolved, absoluteReq);
    } finally {
      await fs.remove(tmpRoot);
    }
  });

  test("getZephyrIdeCommands normalizes platform lists and ignores unknown keys", async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zephyr-ide-cmd-"));
    try {
      const ws = makeWsConfig(tmpRoot);
      const filePath = path.join(tmpRoot, ".vscode", "zephyr-ide.json");
      await fs.outputJson(filePath, {
        commands: {
          linux: ["echo one", "  echo two  ", "", "echo one", 42],
          windows: ["dir", "dir", "  ", null],
          mac: "not-an-array",
          freebsd: ["unsupported"],
        },
      });

      assert.deepStrictEqual(getZephyrIdeCommands(ws), {
        linux: ["echo one", "echo two"],
        windows: ["dir"],
      });
    } finally {
      await fs.remove(tmpRoot);
    }
  });

  test("setZephyrIdeCommands omits empty platforms and preserves other top-level keys", async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zephyr-ide-cmd-"));
    try {
      const ws = makeWsConfig(tmpRoot);
      const filePath = path.join(tmpRoot, ".vscode", "zephyr-ide.json");
      await fs.outputJson(filePath, {
        projects: { app: { name: "app", rel_path: "app" } },
        sdkVersion: "0.17.0",
      });

      await setZephyrIdeCommands(ws, {
        linux: ["echo one", "echo one"],
        windows: [],
        mac: ["  echo mac  "],
      });

      const onDisk = await fs.readJson(filePath);
      assert.deepStrictEqual(onDisk.commands, {
        linux: ["echo one"],
        mac: ["echo mac"],
      });
      assert.deepStrictEqual(onDisk.projects, { app: { name: "app", rel_path: "app" } });
      assert.strictEqual(onDisk.sdkVersion, "0.17.0");
    } finally {
      await fs.remove(tmpRoot);
    }
  });

  test("setZephyrIdeCommands removes the key when all platform lists are empty", async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zephyr-ide-cmd-"));
    try {
      const ws = makeWsConfig(tmpRoot);
      await setZephyrIdeCommands(ws, { linux: ["echo one"] });
      await setZephyrIdeCommands(ws, { linux: [], windows: [], mac: [] });

      const onDisk = readZephyrIdeJson(ws);
      assert.strictEqual(onDisk.commands, undefined);
    } finally {
      await fs.remove(tmpRoot);
    }
  });
});
