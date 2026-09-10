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
import * as path from "path";
import * as os from "os";
import { discoverRunnersAsync, _resetRunnerDiscoveryForTests } from "../utilities/utils";
import { getDiscoveredRunners } from "../project_utilities/runner_selector";
import { SetupState } from "../setup_utilities/types";

/**
 * Builds a fake `$ZEPHYR_BASE/scripts/west_commands/runners` package containing
 * one out-of-tree `ZephyrBinaryRunner` subclass, mirroring the layout described
 * in issue #631 (custom runner registered in `runners/__init__.py`).
 */
async function makeFakeZephyrBase(runnerNameAttr: string): Promise<string> {
    const zephyrBase = await fs.mkdtemp(path.join(os.tmpdir(), "zide-runner-discovery-"));
    const runnersDir = path.join(zephyrBase, "scripts", "west_commands", "runners");
    await fs.ensureDir(runnersDir);
    await fs.writeFile(
        path.join(runnersDir, "__init__.py"),
        "_names = [\"core\", \"my_custom\"]\n\n" +
        "def _import_runner_module(name):\n" +
        "    __import__(f\"runners.{name}\", fromlist=[\"*\"])\n"
    );
    await fs.writeFile(
        path.join(runnersDir, "core.py"),
        "class ZephyrBinaryRunner:\n    pass\n"
    );
    await fs.writeFile(
        path.join(runnersDir, "my_custom.py"),
        "from runners.core import ZephyrBinaryRunner\n\n" +
        "class MyCustomBinaryRunner(ZephyrBinaryRunner):\n" +
        "    @classmethod\n" +
        `    def name(cls):\n        return "${runnerNameAttr}"\n`
    );
    return zephyrBase;
}

function makeSetupState(zephyrDir: string, setupPath: string): SetupState {
    return {
        pythonEnvironmentSetup: true,
        westUpdated: true,
        zephyrDir,
        env: {},
        setupPath,
    };
}

suite("Dynamic Runner Discovery Test Suite", () => {
    const tempDirs: string[] = [];

    setup(() => {
        _resetRunnerDiscoveryForTests();
    });

    teardown(async () => {
        _resetRunnerDiscoveryForTests();
        for (const dir of tempDirs.splice(0)) {
            await fs.remove(dir).catch(() => { /* best-effort cleanup */ });
        }
    });

    test("discoverRunnersAsync populates getDiscoveredRunners with an out-of-tree runner", async function () {
        this.timeout(20000);
        const zephyrBase = await makeFakeZephyrBase("my-custom-runner");
        tempDirs.push(zephyrBase);

        await discoverRunnersAsync(makeSetupState(zephyrBase, zephyrBase));

        assert.deepStrictEqual(getDiscoveredRunners(), ["my-custom-runner"]);
    });

    test("discoverRunnersAsync resolves without throwing and leaves cache empty when setupState is undefined", async () => {
        await discoverRunnersAsync(undefined);

        assert.deepStrictEqual(getDiscoveredRunners(), []);
    });

    test("discoverRunnersAsync resolves without throwing and leaves cache empty when zephyrDir is unset", async () => {
        await discoverRunnersAsync(makeSetupState("", os.tmpdir()));

        assert.deepStrictEqual(getDiscoveredRunners(), []);
    });

    test("discoverRunnersAsync is a no-op (does not throw) when ZEPHYR_BASE has no runners package", async function () {
        this.timeout(20000);
        const emptyBase = await fs.mkdtemp(path.join(os.tmpdir(), "zide-runner-discovery-empty-"));
        tempDirs.push(emptyBase);

        await discoverRunnersAsync(makeSetupState(emptyBase, emptyBase));

        assert.deepStrictEqual(getDiscoveredRunners(), []);
    });

    test("discoverRunnersAsync keeps discovered runners isolated per Zephyr base", async function () {
        this.timeout(20000);
        const zephyrBaseA = await makeFakeZephyrBase("runner-a");
        const zephyrBaseB = await makeFakeZephyrBase("runner-b");
        tempDirs.push(zephyrBaseA, zephyrBaseB);

        await discoverRunnersAsync(makeSetupState(zephyrBaseA, zephyrBaseA));
        await discoverRunnersAsync(makeSetupState(zephyrBaseB, zephyrBaseB));

        assert.deepStrictEqual(getDiscoveredRunners(zephyrBaseA), ["runner-a"]);
        assert.deepStrictEqual(getDiscoveredRunners(zephyrBaseB), ["runner-b"]);
    });

    test("concurrent discoverRunnersAsync calls share a single in-flight scan", async function () {
        this.timeout(20000);
        const zephyrBase = await makeFakeZephyrBase("my-custom-runner");
        tempDirs.push(zephyrBase);
        const setupState = makeSetupState(zephyrBase, zephyrBase);

        const a = discoverRunnersAsync(setupState);
        const b = discoverRunnersAsync(setupState);

        await Promise.all([a, b]);

        assert.strictEqual(a, b);
        assert.deepStrictEqual(getDiscoveredRunners(), ["my-custom-runner"]);
    });

    test("discoverRunnersAsync allows a fresh rescan after the prior scan settles", async function () {
        this.timeout(20000);
        const zephyrBase = await makeFakeZephyrBase("my-custom-runner");
        tempDirs.push(zephyrBase);
        const setupState = makeSetupState(zephyrBase, zephyrBase);

        const first = discoverRunnersAsync(setupState);
        await first;

        const second = discoverRunnersAsync(setupState);
        await second;

        assert.notStrictEqual(first, second);
        assert.deepStrictEqual(getDiscoveredRunners(), ["my-custom-runner"]);
    });
});
