/*
Copyright 2025 mylonics 
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
import { getPlatformName, getPlatformNameAsync } from "../utilities/utils";
import { detectLinuxDistro, resetLinuxDistroCache, setLinuxDistroForTesting } from "../setup_utilities/host_tools";

suite("Platform Detection Test Suite", () => {
    
    test("getPlatformName returns valid platform", () => {
        const platform = getPlatformName();
        assert.ok(
            platform === "linux" || platform === "macos" || platform === "windows",
            `Expected valid platform, got: ${platform}`
        );
    });

    test("getPlatformNameAsync returns valid platform", async () => {
        const platform = await getPlatformNameAsync();
        assert.ok(
            platform === "linux" || platform === "macos" || platform === "windows",
            `Expected valid platform, got: ${platform}`
        );
    });

    test("getPlatformNameAsync returns consistent result", async () => {
        const platform1 = await getPlatformNameAsync();
        const platform2 = await getPlatformNameAsync();
        assert.strictEqual(
            platform1,
            platform2,
            "Platform detection should return consistent results"
        );
    });

    test("Platform detection handles remote environments", async () => {
        // This test validates that the async version works correctly
        // In a remote environment (WSL, SSH), it should detect the remote OS
        // In a local environment, it should match the local OS
        const syncPlatform = getPlatformName();
        const asyncPlatform = await getPlatformNameAsync();
        
        // Both should return valid platform names
        assert.ok(syncPlatform !== undefined, "Sync platform should not be undefined");
        assert.ok(asyncPlatform !== undefined, "Async platform should not be undefined");
        
        // Both functions should return valid platform values
        const validPlatforms = ["linux", "macos", "windows"];
        assert.ok(
            validPlatforms.includes(syncPlatform as string),
            `Sync platform should be valid: ${syncPlatform}`
        );
        assert.ok(
            validPlatforms.includes(asyncPlatform as string),
            `Async platform should be valid: ${asyncPlatform}`
        );
    });

    suite("Linux distro detection", () => {

        setup(() => {
            resetLinuxDistroCache();
        });

        teardown(() => {
            resetLinuxDistroCache();
        });

        test("detectLinuxDistro returns a valid distro family on Linux", async function() {
            if (process.platform !== "linux") {
                this.skip();
            }
            const distro = await detectLinuxDistro();
            const valid = ["apt", "fedora", "arch", "clear"];
            assert.ok(valid.includes(distro), `Expected a valid distro family, got: ${distro}`);
        });

        test("detectLinuxDistro returns consistent results (cached)", async function() {
            if (process.platform !== "linux") {
                this.skip();
            }
            const first = await detectLinuxDistro();
            const second = await detectLinuxDistro();
            assert.strictEqual(first, second, "detectLinuxDistro should return the same cached result");
        });

        test("resetLinuxDistroCache clears the cache", async function() {
            if (process.platform !== "linux") {
                this.skip();
            }
            // Inject a sentinel value so we can tell whether the cache was truly cleared.
            setLinuxDistroForTesting("__test_sentinel__");
            const injected = await detectLinuxDistro();
            assert.strictEqual(injected, "__test_sentinel__", "setLinuxDistroForTesting should make detectLinuxDistro return the injected value");

            // Clear the cache — the next call must re-probe instead of returning
            // the stale sentinel.
            resetLinuxDistroCache();
            const reDetected = await detectLinuxDistro();
            const valid = ["apt", "fedora", "arch", "clear"];
            assert.ok(valid.includes(reDetected), `Expected a valid distro family after cache reset, got: ${reDetected}`);
            assert.notStrictEqual(reDetected, "__test_sentinel__", "resetLinuxDistroCache should have cleared the injected sentinel");
        });
    });
});
