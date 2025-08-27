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

// Show help if requested
if (testType === '--help' || testType === '-h' || testType === 'help') {
    console.log('=== Zephyr IDE Integration Test Runner ===');
    console.log('');
    console.log('Usage: node scripts/run-integration-tests.js [test-type]');
    console.log('');
    console.log('Available test types:');
    console.log('  basic           - Basic workspace structure test (quick)');
    console.log('  standard        - Standard workspace workflow test');
    console.log('  west-git        - West git workspace workflow test');
    console.log('  zephyr-ide-git  - Zephyr IDE git workspace workflow test');
    console.log('  local-west      - Local west workspace workflow test');
    console.log('  external-zephyr - External zephyr workspace workflow test');
    console.log('  all             - Run all tests (default)');
    console.log('');
    console.log('Examples:');
    console.log('  node scripts/run-integration-tests.js basic');
    console.log('  node scripts/run-integration-tests.js standard');
    console.log('  node scripts/run-integration-tests.js west-git');
    console.log('  node scripts/run-integration-tests.js external-zephyr');
    console.log('  node scripts/run-integration-tests.js all');
    console.log('');
    console.log('Environment Variables:');
    console.log('  SKIP_BUILD_TESTS=true - Skip actual build execution');
    console.log('  CI=true              - Automatically detected in CI environments');
    process.exit(0);
}

console.log(`=== Running Zephyr IDE ${testType.toUpperCase()} Workflow Integration Tests ===`);
console.log('🔬 These tests execute the Zephyr IDE workflow using VS Code commands');
console.log('');

try {
    // Compile TypeScript
    console.log('Compiling TypeScript...');
    execSync('npm run test-compile', { stdio: 'inherit', cwd: path.dirname(__dirname) });

    let grepPattern;
    switch (testType) {
        case 'basic':
            grepPattern = '"Basic Workspace Test Suite"';
            break;
        case 'standard':
            grepPattern = '"Standard Workspace Test Suite"';
            break;
        case 'west-git':
            grepPattern = '"West Git Workspace Test Suite"';
            break;
        case 'zephyr-ide-git':
            grepPattern = '"Workspace Zephyr IDE Git Test Suite"';
            break;
        case 'local-west':
            grepPattern = '"Workspace Local West Test Suite"';
            break;
        case 'external-zephyr':
            grepPattern = '"Workspace External Zephyr Test Suite"';
            break;
        case 'all':
        default:
            grepPattern = '"Test Suite"';
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
    console.error('');
    console.error('Available test types: basic, standard, west-git, zephyr-ide-git, local-west, external-zephyr, all');
    console.error('Run "node scripts/run-integration-tests.js help" for more information.');
    process.exit(1);
}
