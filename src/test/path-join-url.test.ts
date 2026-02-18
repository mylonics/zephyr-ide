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
import * as path from "upath";

suite("Path Join URL Preservation Test Suite", () => {
    
    test("path.join should NOT be used on command strings with URLs", () => {
        // This demonstrates the bug: path.join normalizes // to /
        const venvBin = "/Users/user/.venv/bin";
        const commandWithUrl = "west init -m https://github.com/zephyrproject-rtos/example-application";
        
        // This is what the old buggy code did - it corrupts the URL
        const buggyResult = path.join(venvBin, commandWithUrl);
        
        // path.join normalizes // to / which breaks URLs
        assert.ok(buggyResult.includes("https:/github.com"), 
            "path.join incorrectly strips double slashes from URLs");
        assert.ok(!buggyResult.includes("https://github.com"), 
            "path.join damaged the URL protocol");
    });
    
    test("Correct approach: only join executable path, not entire command", () => {
        const venvBin = "/Users/user/.venv/bin";
        const commandWithUrl = "west init -m https://github.com/zephyrproject-rtos/example-application";
        
        // Extract executable and args
        const parts = commandWithUrl.trim().split(/\s+/);
        const executable = parts[0];
        const args = parts.slice(1).join(' ');
        
        // Only apply path.join to the executable
        const executablePath = path.join(venvBin, executable);
        const correctResult = args ? `${executablePath} ${args}` : executablePath;
        
        // The URL should remain intact
        assert.ok(correctResult.includes("https://github.com"), 
            "URL protocol should be preserved");
        assert.ok(!correctResult.includes("https:/github.com"), 
            "URL should not have double slashes stripped");
        assert.ok(correctResult.startsWith(venvBin), 
            "Command should start with venv binary path");
        assert.strictEqual(correctResult, 
            "/Users/user/.venv/bin/west init -m https://github.com/zephyrproject-rtos/example-application",
            "Command should be correctly constructed");
    });
    
    test("Handles various URL protocols correctly", () => {
        const venvBin = "/path/to/.venv/bin";
        const testCases = [
            "west init -m https://github.com/user/repo.git",
            "west init -m http://gitlab.com/user/repo.git", 
            "west init -m ssh://git@github.com/user/repo.git",
            "west init -m git://server.com/repo.git"
        ];
        
        for (const command of testCases) {
            const parts = command.trim().split(/\s+/);
            const executable = parts[0];
            const args = parts.slice(1).join(' ');
            const executablePath = path.join(venvBin, executable);
            const result = args ? `${executablePath} ${args}` : executablePath;
            
            // Verify the URL protocol is preserved
            const urlMatch = command.match(/(https?|ssh|git):\/\//);
            if (urlMatch) {
                assert.ok(result.includes(urlMatch[0]), 
                    `Protocol ${urlMatch[0]} should be preserved in: ${command}`);
            }
        }
    });
    
    test("Handles commands without URLs correctly", () => {
        const venvBin = "/path/to/.venv/bin";
        const command = "west update --narrow";
        
        const parts = command.trim().split(/\s+/);
        const executable = parts[0];
        const args = parts.slice(1).join(' ');
        const executablePath = path.join(venvBin, executable);
        const result = args ? `${executablePath} ${args}` : executablePath;
        
        assert.strictEqual(result, "/path/to/.venv/bin/west update --narrow",
            "Command without URLs should also work correctly");
    });
    
    test("Handles command with only executable (no arguments)", () => {
        const venvBin = "/path/to/.venv/bin";
        const command = "west";
        
        const parts = command.trim().split(/\s+/);
        const executable = parts[0];
        const args = parts.slice(1).join(' ');
        const executablePath = path.join(venvBin, executable);
        const result = args ? `${executablePath} ${args}` : executablePath;
        
        assert.strictEqual(result, "/path/to/.venv/bin/west",
            "Single executable should work correctly");
    });
    
    test("Handles commands with complex arguments containing spaces", () => {
        const venvBin = "/path/to/.venv/bin";
        const command = 'west init -m https://github.com/user/repo.git --mr "branch with spaces"';
        
        const parts = command.trim().split(/\s+/);
        const executable = parts[0];
        const args = parts.slice(1).join(' ');
        const executablePath = path.join(venvBin, executable);
        const result = args ? `${executablePath} ${args}` : executablePath;
        
        assert.ok(result.includes("https://github.com"), 
            "URL should be preserved with complex arguments");
        assert.ok(result.includes('--mr "branch with spaces"'), 
            "Complex arguments should be preserved");
    });
});
