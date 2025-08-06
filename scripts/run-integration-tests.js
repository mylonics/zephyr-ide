#!/usr/bin/env node

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

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const testType = process.argv[2] || 'all';

console.log(`=== Running Zephyr IDE ${testType.toUpperCase()} Workflow Integration Tests ===`);
console.log('🔬 These tests execute the Zephyr IDE workflow using VS Code commands');
console.log('');

try {
    // Compile TypeScript
    console.log('Compiling TypeScript...');
    execSync('npm run test-compile', { stdio: 'inherit', cwd: path.dirname(__dirname) });

    let grepPattern;
    switch (testType) {
        case 'standard':
            grepPattern = '"Standard Workflow Integration Test Suite"';
            break;
        case 'git':
            grepPattern = '"Git Workflow Integration Test Suite"';
            break;
        case 'all':
        default:
            grepPattern = '"Workflow Integration Test Suite"';
            break;
    }

    // Run workflow integration tests
    console.log(`Running ${testType} workflow integration tests...`);
    execSync(`npx vscode-test --grep ${grepPattern}`, { 
        stdio: 'inherit', 
        cwd: path.dirname(__dirname) 
    });

    console.log(`✓ ${testType} workflow integration tests completed successfully`);
} catch (error) {
    console.error(`❌ ${testType} workflow integration tests failed:`, error.message);
    console.error('');
    console.error('This test executes the Zephyr IDE workflow.');
    console.error('Some steps may fail if build dependencies are not available.');
    process.exit(1);
}
