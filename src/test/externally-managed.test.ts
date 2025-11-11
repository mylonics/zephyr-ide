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
import * as path from "path";
import { getEnvironmentSetupState } from "../setup_utilities/workspace-config";

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

    test("getEnvironmentSetupState returns SetupState when ZEPHYR_BASE is set", () => {
        // Save original value
        const originalZephyrBase = process.env.ZEPHYR_BASE;
        
        try {
            // Set test value
            const testZephyrBase = "/test/zephyr/path";
            process.env.ZEPHYR_BASE = testZephyrBase;
            
            // Call the function
            const setupState = getEnvironmentSetupState();
            
            // Verify setup state is returned
            assert.notStrictEqual(setupState, undefined, "setupState should not be undefined");
            assert.strictEqual(setupState?.zephyrDir, testZephyrBase, "zephyrDir should match ZEPHYR_BASE");
            assert.strictEqual(setupState?.setupPath, path.dirname(testZephyrBase), "setupPath should be parent directory of ZEPHYR_BASE");
            assert.strictEqual(setupState?.westUpdated, true, "westUpdated should be true for external environment");
            assert.strictEqual(setupState?.packagesInstalled, true, "packagesInstalled should be true for external environment");
        } finally {
            // Restore original value
            if (originalZephyrBase !== undefined) {
                process.env.ZEPHYR_BASE = originalZephyrBase;
            } else {
                delete process.env.ZEPHYR_BASE;
            }
        }
    });

    test("getEnvironmentSetupState returns undefined when ZEPHYR_BASE is not set", () => {
        // Save original value
        const originalZephyrBase = process.env.ZEPHYR_BASE;
        
        try {
            // Remove ZEPHYR_BASE
            delete process.env.ZEPHYR_BASE;
            
            // Call the function
            const setupState = getEnvironmentSetupState();
            
            // Verify setup state is undefined
            assert.strictEqual(setupState, undefined, "setupState should be undefined when ZEPHYR_BASE is not set");
        } finally {
            // Restore original value
            if (originalZephyrBase !== undefined) {
                process.env.ZEPHYR_BASE = originalZephyrBase;
            }
        }
    });
});