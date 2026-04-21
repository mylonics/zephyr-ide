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
        // Pass null to explicitly bypass VS Code settings (python.defaultInterpreterPath)
        // and reach the platform-default branch.
        const pythonCmd = await getPythonCommand(null);
        
        // Should return a platform-appropriate Python executable.
        // getDefaultPythonExecutable() probes manifest candidates (e.g. python3.12,
        // python3) and returns the best match, so accept any python3* on Linux/macOS
        // and any python* on Windows.
        const platform = os.platform();
        if (platform === "linux" || platform === "darwin") {
            assert.ok(pythonCmd.startsWith("python3"), `Should return a python3 variant on Linux/macOS, got: ${pythonCmd}`);
        } else if (platform === "win32") {
            assert.ok(pythonCmd.startsWith("python") || pythonCmd.startsWith("py"), `Should return a python variant on Windows, got: ${pythonCmd}`);
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
            assert.ok(pythonCmd.includes(testHome) || pythonCmd.startsWith("python3") || pythonCmd.startsWith("python") || pythonCmd.startsWith("py"), 
                "Should either expand the variable or fall back to a platform default");
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
        
        // Should fall back to platform default because expansion failed.
        // getDefaultPythonExecutable() may return a versioned executable
        // (e.g. python3.12) when one meets the manifest minimum requirement.
        const platform = os.platform();
        if (platform === "linux" || platform === "darwin") {
            assert.ok(pythonCmd.startsWith("python3"), `Should fall back to a python3 variant when env var expansion fails, got: ${pythonCmd}`);
        } else if (platform === "win32") {
            assert.ok(pythonCmd.startsWith("python") || pythonCmd.startsWith("py"), `Should fall back to a python variant when env var expansion fails, got: ${pythonCmd}`);
        }
    });

    test("Falls back to platform default when configured path doesn't exist", async function() {
        const nonExistentPath = "/nonexistent/path/to/python";
        
        const pythonCmd = await getPythonCommand(nonExistentPath);
        
        // Should fall back to platform default.
        // getDefaultPythonExecutable() may return a versioned executable
        // (e.g. python3.12) when one meets the manifest minimum requirement.
        const platform = os.platform();
        if (platform === "linux" || platform === "darwin") {
            assert.ok(pythonCmd.startsWith("python3"), `Should fall back to a python3 variant when path doesn't exist, got: ${pythonCmd}`);
        } else if (platform === "win32") {
            assert.ok(pythonCmd.startsWith("python") || pythonCmd.startsWith("py"), `Should fall back to a python variant when path doesn't exist, got: ${pythonCmd}`);
        }
    });

    test("Caching behavior works correctly", async function() {
        // Repeated no-override calls should return the same cached value.
        const firstCall = await getPythonCommand();
        const secondCall = await getPythonCommand();
        assert.strictEqual(firstCall, secondCall, "Should return the same cached value on repeated no-override calls");

        // Calls with an explicit override always bypass the cache and compute fresh.
        // A non-existent path falls through to the platform default, which may be a
        // versioned executable (e.g. python3.12) probed from the manifest candidates.
        const withOverride = await getPythonCommand("/nonexistent/override/python");
        const platform = os.platform();
        if (platform === "linux" || platform === "darwin") {
            assert.ok(withOverride.startsWith("python3"), `Override that doesn't exist should fall back to a python3 variant, got: ${withOverride}`);
        } else if (platform === "win32") {
            assert.ok(withOverride.startsWith("python") || withOverride.startsWith("py"), `Override that doesn't exist should fall back to a python variant on Windows, got: ${withOverride}`);
        }
    });

    test("Ignores non-whitelisted environment variables", async function() {
        // Set up a custom environment variable that's not in the whitelist
        process.env.CUSTOM_VAR = "/custom/path";
        
        const configPath = "${env:CUSTOM_VAR}/python3";
        
        const pythonCmd = await getPythonCommand(configPath);
        
        // Should fall back to platform default because CUSTOM_VAR is not whitelisted.
        // getDefaultPythonExecutable() may return a versioned executable
        // (e.g. python3.12) when one meets the manifest minimum requirement.
        const platform = os.platform();
        if (platform === "linux" || platform === "darwin") {
            assert.ok(pythonCmd.startsWith("python3"), `Should fall back to a python3 variant for non-whitelisted env var, got: ${pythonCmd}`);
        } else if (platform === "win32") {
            assert.ok(pythonCmd.startsWith("python") || pythonCmd.startsWith("py"), `Should fall back to a python variant for non-whitelisted env var, got: ${pythonCmd}`);
        }
        
        // Clean up
        delete process.env.CUSTOM_VAR;
    });

    test("Handles empty configured path", async function() {
        const pythonCmd = await getPythonCommand("");
        
        // Should fall back to platform default.
        // getDefaultPythonExecutable() may return a versioned executable
        // (e.g. python3.12) when one meets the manifest minimum requirement.
        const platform = os.platform();
        if (platform === "linux" || platform === "darwin") {
            assert.ok(pythonCmd.startsWith("python3"), `Should fall back to a python3 variant for empty config, got: ${pythonCmd}`);
        } else if (platform === "win32") {
            assert.ok(pythonCmd.startsWith("python") || pythonCmd.startsWith("py"), `Should fall back to a python variant for empty config, got: ${pythonCmd}`);
        }
    });

    test("Handles whitespace-only configured path", async function() {
        const pythonCmd = await getPythonCommand("   ");
        
        // Should fall back to platform default.
        // getDefaultPythonExecutable() may return a versioned executable
        // (e.g. python3.12) when one meets the manifest minimum requirement.
        const platform = os.platform();
        if (platform === "linux" || platform === "darwin") {
            assert.ok(pythonCmd.startsWith("python3"), `Should fall back to a python3 variant for whitespace-only config, got: ${pythonCmd}`);
        } else if (platform === "win32") {
            assert.ok(pythonCmd.startsWith("python") || pythonCmd.startsWith("py"), `Should fall back to a python variant for whitespace-only config, got: ${pythonCmd}`);
        }
    });
});
