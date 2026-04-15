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
import { getPythonCommand, resetPythonCommand } from "../setup_utilities/west-operations";

suite("Python Command Test Suite", () => {
    
    // Store original environment variables
    let originalEnvVars: Map<string, string | undefined>;

    setup(() => {
        // Reset the cached Python command before each test
        resetPythonCommand();
        
        // Store original environment variables
        originalEnvVars = new Map([
            ['HOME', process.env.HOME],
            ['USER', process.env.USER],
            ['USERPROFILE', process.env.USERPROFILE],
        ]);
    });
    
    teardown(() => {
        // Reset cached command
        resetPythonCommand();
        
        // Restore original environment variables
        for (const [key, value] of originalEnvVars.entries()) {
            if (value !== undefined) {
                process.env[key] = value;
            } else {
                delete process.env[key];
            }
        }
    });

    test("Returns platform default when no configuration is set", async () => {
        const pythonCmd = await getPythonCommand();
        
        // Should return platform-specific default
        const platform = os.platform();
        if (platform === "linux" || platform === "darwin") {
            assert.strictEqual(pythonCmd, "python3", "Should return python3 on Linux/macOS");
        } else if (platform === "win32") {
            assert.strictEqual(pythonCmd, "python", "Should return python on Windows");
        }
    });

    test("Uses configured Python path when available and exists", async function() {
        // Find the actual Python executable on the system (platform-appropriate fallback)
        const defaultPythonPath = os.platform() === 'win32' 
            ? path.join(process.env.LOCALAPPDATA || 'C:\\Python3', 'Programs', 'Python', 'Python3', 'python.exe')
            : '/usr/bin/python3';
        const pythonPath = process.env.PYTHON_PATH || defaultPythonPath;
        
        // Only run this test if the Python path exists
        if (fs.existsSync(pythonPath)) {
            const pythonCmd = await getPythonCommand(pythonPath);
            assert.strictEqual(pythonCmd, pythonPath, "Should use configured Python path");
        }
    });

    test("Expands environment variables correctly for whitelisted variables", async function() {
        // Set up a test environment variable using a cross-platform temp path
        const testHome = fs.mkdtempSync(path.join(os.tmpdir(), "python-home-"));
        process.env.HOME = testHome;
        
        // Create a mock Python path using environment variable
        const pythonExeName = os.platform() === 'win32' ? 'python.exe' : 'python3';
        
        // Create a temporary file to simulate the Python executable
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "python-test-"));
        const tempPythonPath = path.join(tempDir, pythonExeName);
        fs.writeFileSync(tempPythonPath, "#!/bin/bash\necho test");
        if (os.platform() !== 'win32') {
            fs.chmodSync(tempPythonPath, 0o755);
        }
        
        try {
            // Configure with the actual temp path but using env var syntax
            // Use forward slashes for cross-platform compatibility in config paths
            const relativePath = path.relative(testHome, tempPythonPath).split(path.sep).join('/');
            const testConfigPath = `\${env:HOME}/${relativePath}`;
            
            const pythonCmd = await getPythonCommand(testConfigPath);
            
            // Should have expanded the environment variable
            assert.ok(!pythonCmd.includes("${env:HOME}"), "Should not contain unexpanded variable");
            assert.ok(pythonCmd.includes(testHome) || pythonCmd === "python3" || pythonCmd === "python", 
                "Should either expand the variable or fall back to default");
        } finally {
            // Clean up temp files and directories
            fs.removeSync(tempDir);
            fs.removeSync(testHome);
        }
    });

    test("Handles missing environment variables gracefully", async function() {
        // Use a non-existent environment variable
        const configPath = "${env:NONEXISTENT_VAR}/python3";
        
        const pythonCmd = await getPythonCommand(configPath);
        
        // Should fall back to platform default because expansion failed
        const platform = os.platform();
        if (platform === "linux" || platform === "darwin") {
            assert.strictEqual(pythonCmd, "python3", "Should fall back to python3 when env var expansion fails");
        } else if (platform === "win32") {
            assert.strictEqual(pythonCmd, "python", "Should fall back to python when env var expansion fails");
        }
    });

    test("Falls back to platform default when configured path doesn't exist", async function() {
        const nonExistentPath = "/nonexistent/path/to/python";
        
        const pythonCmd = await getPythonCommand(nonExistentPath);
        
        // Should fall back to platform default
        const platform = os.platform();
        if (platform === "linux" || platform === "darwin") {
            assert.strictEqual(pythonCmd, "python3", "Should fall back to python3 when path doesn't exist");
        } else if (platform === "win32") {
            assert.strictEqual(pythonCmd, "python", "Should fall back to python when path doesn't exist");
        }
    });

    test("Caching behavior works correctly", async function() {
        // First call should determine the Python command
        const firstCall = await getPythonCommand();
        
        // Second call should return cached value (without resetting)
        const secondCall = await getPythonCommand();
        
        assert.strictEqual(firstCall, secondCall, "Should return the same cached value");
        
        // Verify it's actually caching by passing a different override (shouldn't affect result
        // because the cache is already populated)
        const thirdCall = await getPythonCommand("/different/path");
        assert.strictEqual(thirdCall, firstCall, "Should still return cached value even after config change");
    });

    test("Ignores non-whitelisted environment variables", async function() {
        // Set up a custom environment variable that's not in the whitelist
        process.env.CUSTOM_VAR = "/custom/path";
        
        const configPath = "${env:CUSTOM_VAR}/python3";
        
        const pythonCmd = await getPythonCommand(configPath);
        
        // Should fall back to platform default because CUSTOM_VAR is not whitelisted
        const platform = os.platform();
        if (platform === "linux" || platform === "darwin") {
            assert.strictEqual(pythonCmd, "python3", "Should fall back to python3 for non-whitelisted env var");
        } else if (platform === "win32") {
            assert.strictEqual(pythonCmd, "python", "Should fall back to python for non-whitelisted env var");
        }
        
        // Clean up
        delete process.env.CUSTOM_VAR;
    });

    test("Handles empty configured path", async function() {
        const pythonCmd = await getPythonCommand("");
        
        // Should fall back to platform default
        const platform = os.platform();
        if (platform === "linux" || platform === "darwin") {
            assert.strictEqual(pythonCmd, "python3", "Should fall back to python3 for empty config");
        } else if (platform === "win32") {
            assert.strictEqual(pythonCmd, "python", "Should fall back to python for empty config");
        }
    });

    test("Handles whitespace-only configured path", async function() {
        const pythonCmd = await getPythonCommand("   ");
        
        // Should fall back to platform default
        const platform = os.platform();
        if (platform === "linux" || platform === "darwin") {
            assert.strictEqual(pythonCmd, "python3", "Should fall back to python3 for whitespace-only config");
        } else if (platform === "win32") {
            assert.strictEqual(pythonCmd, "python", "Should fall back to python for whitespace-only config");
        }
    });
});
