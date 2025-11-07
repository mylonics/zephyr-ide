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

suite("Environment Variable Detection Test Suite", () => {

    test("Detects ZEPHYR_BASE environment variable", () => {
        // Save original value
        const originalZephyrBase = process.env.ZEPHYR_BASE;
        
        // Set test value
        process.env.ZEPHYR_BASE = "/test/zephyr/path";
        
        // Verify environment variable is set
        assert.strictEqual(process.env.ZEPHYR_BASE, "/test/zephyr/path", "ZEPHYR_BASE should be set");
        
        // Restore original value
        if (originalZephyrBase !== undefined) {
            process.env.ZEPHYR_BASE = originalZephyrBase;
        } else {
            delete process.env.ZEPHYR_BASE;
        }
    });

    test("Detects ZEPHYR_SDK_INSTALL_DIR environment variable", () => {
        // Save original value
        const originalSdkPath = process.env.ZEPHYR_SDK_INSTALL_DIR;
        
        // Set test value
        process.env.ZEPHYR_SDK_INSTALL_DIR = "/test/sdk/path";
        
        // Verify environment variable is set
        assert.strictEqual(process.env.ZEPHYR_SDK_INSTALL_DIR, "/test/sdk/path", "ZEPHYR_SDK_INSTALL_DIR should be set");
        
        // Restore original value
        if (originalSdkPath !== undefined) {
            process.env.ZEPHYR_SDK_INSTALL_DIR = originalSdkPath;
        } else {
            delete process.env.ZEPHYR_SDK_INSTALL_DIR;
        }
    });

    test("Handles missing environment variables gracefully", () => {
        // Save original values
        const originalZephyrBase = process.env.ZEPHYR_BASE;
        const originalSdkPath = process.env.ZEPHYR_SDK_INSTALL_DIR;
        
        // Remove environment variables
        delete process.env.ZEPHYR_BASE;
        delete process.env.ZEPHYR_SDK_INSTALL_DIR;
        
        // Verify variables are undefined
        assert.strictEqual(process.env.ZEPHYR_BASE, undefined, "ZEPHYR_BASE should be undefined");
        assert.strictEqual(process.env.ZEPHYR_SDK_INSTALL_DIR, undefined, "ZEPHYR_SDK_INSTALL_DIR should be undefined");
        
        // Restore original values
        if (originalZephyrBase !== undefined) {
            process.env.ZEPHYR_BASE = originalZephyrBase;
        }
        if (originalSdkPath !== undefined) {
            process.env.ZEPHYR_SDK_INSTALL_DIR = originalSdkPath;
        }
    });
});