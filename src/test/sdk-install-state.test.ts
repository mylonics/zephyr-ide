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
import * as vscode from "vscode";

import { GlobalConfig } from "../setup_utilities/types";
import { listAvailableSDKs, syncSDKInstallState } from "../setup_utilities/west_sdk";

suite("SDK Install State Test Suite", () => {
    let tmpDir: string;
    let config: vscode.WorkspaceConfiguration;

    async function resetToolchainDirectory() {
        await config.update("zephyr-ide.toolchainDirectory", undefined, vscode.ConfigurationTarget.Global);
    }

    async function createSdk(version: string, installedToolchains: string[], availableToolchains: string[] = installedToolchains) {
        const sdkDir = path.join(tmpDir, `zephyr-sdk-${version}`);
        const gccSuffix = os.platform() === "win32" ? "-gcc.exe" : "-gcc";

        await fs.ensureDir(sdkDir);
        await fs.writeFile(path.join(sdkDir, "sdk_version"), `${version}\n`);
        await fs.writeFile(path.join(sdkDir, "sdk_gnu_toolchains"), `${availableToolchains.join("\n")}\n`);

        for (const toolchain of installedToolchains) {
            const gccPath = path.join(sdkDir, "gnu", toolchain, "bin", `${toolchain}${gccSuffix}`);
            await fs.ensureDir(path.dirname(gccPath));
            await fs.writeFile(gccPath, "");
        }
    }

    setup(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "zephyr-ide-sdk-state-"));
        config = vscode.workspace.getConfiguration();
        await config.update("zephyr-ide.toolchainDirectory", tmpDir, vscode.ConfigurationTarget.Global);
    });

    teardown(async () => {
        await resetToolchainDirectory();
        await fs.remove(tmpDir);
    });

    test("marks SDK installed when at least one toolchain is present", async () => {
        await createSdk("1.0.1", ["arm-zephyr-eabi"], ["arm-zephyr-eabi", "x86_64-zephyr-elf"]);

        const sdkList = await listAvailableSDKs();
        const globalConfig: GlobalConfig = { sdkInstalled: false };

        const state = await syncSDKInstallState(globalConfig, undefined, sdkList);

        assert.strictEqual(state.sdkInstalled, true);
        assert.strictEqual(state.sdkVersion, "1.0.1");
        assert.strictEqual(globalConfig.sdkInstalled, true);
        assert.strictEqual(globalConfig.sdkVersion, "1.0.1");
    });

    test("keeps SDK marked as not installed when no toolchains are present", async () => {
        await createSdk("1.0.1", [], ["arm-zephyr-eabi", "x86_64-zephyr-elf"]);

        const globalConfig: GlobalConfig = { sdkInstalled: false };
        const state = await syncSDKInstallState(globalConfig);

        assert.strictEqual(state.sdkInstalled, false);
        assert.strictEqual(state.sdkVersion, "1.0.1");
        assert.strictEqual(globalConfig.sdkInstalled, false);
        assert.strictEqual(globalConfig.sdkVersion, "1.0.1");
    });
});
