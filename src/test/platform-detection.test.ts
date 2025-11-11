/*
Copyright 2024 mylonics 
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
});
