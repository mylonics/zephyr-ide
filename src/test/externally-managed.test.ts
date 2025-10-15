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
import { generateExternallyManagedSetupState } from "../setup_utilities/types";

suite("Externally Managed Setup State Test Suite", () => {
    
    test("Creates externally managed setup state correctly", () => {
        const setupState = generateExternallyManagedSetupState();
        
        // Verify all required fields are set correctly
        assert.strictEqual(setupState.pythonEnvironmentSetup, true, "pythonEnvironmentSetup should be true");
        assert.strictEqual(setupState.westUpdated, true, "westUpdated should be true");
        assert.strictEqual(setupState.packagesInstalled, true, "packagesInstalled should be true");
        assert.strictEqual(setupState.setupPath, 'externally-managed', "setupPath should be 'externally-managed'");
        assert.strictEqual(setupState.externallyManaged, true, "externallyManaged flag should be true");
        
        // Verify env is an empty object
        assert.deepStrictEqual(setupState.env, {}, "env should be an empty object");
    });

    test("Uses ZEPHYR_BASE from environment if available", () => {
        // Save original value
        const originalZephyrBase = process.env.ZEPHYR_BASE;
        
        // Set test value
        process.env.ZEPHYR_BASE = "/test/zephyr/path";
        
        const setupState = generateExternallyManagedSetupState();
        
        assert.strictEqual(setupState.zephyrDir, "/test/zephyr/path", "zephyrDir should use ZEPHYR_BASE from environment");
        
        // Restore original value
        if (originalZephyrBase !== undefined) {
            process.env.ZEPHYR_BASE = originalZephyrBase;
        } else {
            delete process.env.ZEPHYR_BASE;
        }
    });

    test("Sets empty zephyrDir when ZEPHYR_BASE is not set", () => {
        // Save original value
        const originalZephyrBase = process.env.ZEPHYR_BASE;
        
        // Remove ZEPHYR_BASE
        delete process.env.ZEPHYR_BASE;
        
        const setupState = generateExternallyManagedSetupState();
        
        assert.strictEqual(setupState.zephyrDir, '', "zephyrDir should be empty when ZEPHYR_BASE is not set");
        
        // Restore original value
        if (originalZephyrBase !== undefined) {
            process.env.ZEPHYR_BASE = originalZephyrBase;
        }
    });
});
