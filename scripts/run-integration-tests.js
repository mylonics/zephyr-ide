#!/usr/bin/env node

/*
Copyright 2025-2026 mylonics 
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

const repoRoot = path.dirname(__dirname);
const testType = process.argv[2] || 'all';

/** Decode the small set of XML entities mocha-junit-reporter escapes into attribute values. */
function decodeXmlEntities(value) {
    return value
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&');
}

/** Parse `key="value"` attribute pairs out of an XML tag's attribute string. */
function parseXmlAttrs(attrString) {
    const attrs = {};
    const attrRe = /(\w+)="([^"]*)"/g;
    let match;
    while ((match = attrRe.exec(attrString)) !== null) {
        attrs[match[1]] = decodeXmlEntities(match[2]);
    }
    return attrs;
}

/**
 * Parse the JUnit XML written by mocha-junit-reporter into a summary shape.
 * Written against that reporter's specific (simple, non-nested) output
 * format rather than pulling in a general-purpose XML parser dependency.
 */
function parseJUnitResults(xmlPath) {
    if (!fs.existsSync(xmlPath)) {
        return null;
    }
    const xml = fs.readFileSync(xmlPath, 'utf8');

    const rootMatch = xml.match(/<testsuites\b([^>]*)>/);
    if (!rootMatch) {
        return null;
    }
    const rootAttrs = parseXmlAttrs(rootMatch[1]);

    const testcases = [];
    const testcaseRe = /<testcase\b([^>]*)>([\s\S]*?)<\/testcase>|<testcase\b([^>]*)\/>/g;
    let match;
    while ((match = testcaseRe.exec(xml)) !== null) {
        const attrs = parseXmlAttrs(match[1] !== undefined ? match[1] : match[3]);
        const body = match[2] || '';
        const failureMatch = body.match(/<failure\b[^>]*\bmessage="([^"]*)"/);
        testcases.push({
            name: attrs.name || '(unnamed test)',
            time: parseFloat(attrs.time || '0'),
            failed: /<failure\b/.test(body),
            failureMessage: failureMatch ? decodeXmlEntities(failureMatch[1]) : undefined
        });
    }

    return {
        tests: parseInt(rootAttrs.tests || '0', 10),
        failures: parseInt(rootAttrs.failures || '0', 10),
        time: parseFloat(rootAttrs.time || '0'),
        testcases
    };
}

/** Append a pass/fail + duration table for this test type to $GITHUB_STEP_SUMMARY, if set. */
function writeStepSummary(testTypeLabel, results) {
    const summaryPath = process.env.GITHUB_STEP_SUMMARY;
    if (!summaryPath) {
        return;
    }

    const lines = [`### ${testTypeLabel} workflow integration test`, ''];

    if (!results) {
        lines.push('_No JUnit results file was produced — the test process likely crashed before Mocha could report._');
    } else {
        const passed = results.tests - results.failures;
        const icon = results.failures === 0 ? '✅' : '❌';
        lines.push(`${icon} **${passed}/${results.tests} passed** in ${results.time.toFixed(1)}s`);
        lines.push('');
        lines.push('| Test | Result | Time (s) |');
        lines.push('| --- | --- | --- |');
        for (const tc of results.testcases) {
            lines.push(`| ${tc.name} | ${tc.failed ? '❌ fail' : '✅ pass'} | ${tc.time.toFixed(1)} |`);
        }

        const failedCases = results.testcases.filter((tc) => tc.failed);
        if (failedCases.length > 0) {
            lines.push('', '<details><summary>Failure details</summary>', '');
            for (const tc of failedCases) {
                lines.push(`**${tc.name}**`, '', '```', tc.failureMessage || '(no message captured)', '```', '');
            }
            lines.push('</details>');
        }
    }

    lines.push('');
    fs.appendFileSync(summaryPath, lines.join('\n') + '\n');
}

// Show help if requested
if (testType === '--help' || testType === '-h' || testType === 'help') {
    console.log('=== Zephyr IDE Integration Test Runner ===');
    console.log('');
    console.log('Usage: node scripts/run-integration-tests.js [test-type]');
    console.log('');
    console.log('Available test types:');
    console.log('  combined                 - Combined test: install pkg mgr + packages + standard tests (single process)');
    console.log('  standard                 - Standard workspace workflow test');
    console.log('  west-git                 - West git workspace workflow test');
    console.log('  zephyr-ide-git           - Zephyr IDE git workspace workflow test');
    console.log('  local-west               - Local west workspace workflow test');
    console.log('  external-zephyr          - External zephyr workspace workflow test');
    console.log('  external-directory       - Workspace setup from external directory workflow test');
    console.log('  all                      - Run all tests (default)');
    console.log('');
    console.log('Examples:');
    console.log('  node scripts/run-integration-tests.js standard');
    console.log('  node scripts/run-integration-tests.js west-git');
    console.log('  node scripts/run-integration-tests.js external-zephyr');
    console.log('  node scripts/run-integration-tests.js external-directory');
    console.log('  node scripts/run-integration-tests.js all');
    console.log('');
    console.log('Environment Variables:');
    console.log('  SKIP_BUILD_TESTS=true - Skip actual build execution');
    console.log('  CI=true              - Automatically detected in CI environments');
    process.exit(0);
}

console.log(`=== Running Zephyr IDE ${testType.toUpperCase()} Workflow Integration Tests ===`);
console.log('These tests execute the Zephyr IDE workflow using VS Code commands');
console.log('');

// Distinct JUnit output path per test type so a full `workspace-setup-tests.yml`
// run (which invokes this script once per type, in the same job) doesn't have
// each type overwrite the previous one's results.
const mochaFile = path.join(repoRoot, 'test-results', `${testType}.xml`);
fs.mkdirSync(path.dirname(mochaFile), { recursive: true });

try {
    // Kill any orphaned VS Code Extension Host processes from a previous test run.
    //
    // HOW SPAWNING WORKS (expected behaviour):
    //   Each invocation of this script calls `npx vscode-test` exactly once,
    //   which starts ONE VS Code Extension Host process. When tests complete,
    //   vscode-test exits that host cleanly. Sequential runs therefore see only
    //   one host at a time.
    //
    //   Multiple hosts visible simultaneously means either:
    //     (a) Tasks were launched concurrently in the VS Code task runner, OR
    //     (b) A previous host didn't exit before the next run started (leak).
    //
    //   The cleanup below addresses (b): we kill any orphaned Code process that
    //   has our dedicated test workspace path ('zide-spc') in its command line.
    //   This is safe — 'zide-spc' is exclusively used by these integration tests
    //   and will never match a user's own VS Code instance.
    console.log('Checking for orphaned VS Code test hosts...');
    try {
        if (process.platform === 'win32') {
            // PowerShell: find Code processes with 'zide-spc' in their CommandLine
            execSync(
                'powershell -Command "Get-CimInstance Win32_Process | ' +
                'Where-Object { $_.Name -like \'Code*\' -and $_.CommandLine -like \'*zide-spc*\' } | ' +
                'ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"',
                { stdio: 'pipe' }
            );
        } else {
            // Linux/macOS: pkill by command-line pattern; exit code 1 just means no match
            execSync("pkill -f 'zide-spc' || true", { stdio: 'pipe' });
        }
        console.log('  Orphan check complete.');
    } catch (_) {
        // Non-fatal — proceed even if the cleanup command itself fails
    }

    // Clean stale VS Code test state that can interfere with extension loading
    const vscodeTestDir = path.join(path.dirname(__dirname), '.vscode-test');
    const staleDirs = ['extensions', 'user-data'];
    for (const dir of staleDirs) {
        const dirPath = path.join(vscodeTestDir, dir);
        if (fs.existsSync(dirPath)) {
            console.log(`Cleaning stale test state: ${dirPath}`);
            fs.rmSync(dirPath, { recursive: true, force: true });
        }
    }

    // CI workflows that invoke this script already run `npm run test-compile`
    // and `npm run esbuild` as separate steps once per job, then call this
    // script once per workspace type — recompiling/re-bundling here on every
    // invocation would repeat that work up to 5x for no benefit. Set
    // SKIP_COMPILE=true in those workflows; local/manual runs still compile
    // by default so this script works standalone.
    if (process.env.SKIP_COMPILE === 'true') {
        console.log('SKIP_COMPILE=true — assuming a prior CI step already compiled and bundled.');
    } else {
        // Compile TypeScript
        console.log('Compiling TypeScript...');
        execSync('npm run test-compile', { stdio: 'inherit', cwd: path.dirname(__dirname) });

        // Bundle extension so dist/extension.js (the "main" entry) is up to date
        console.log('Bundling extension with esbuild...');
        execSync('npm run esbuild', { stdio: 'inherit', cwd: path.dirname(__dirname) });
    }

    let grepPattern;
    switch (testType) {
        case 'combined':
            grepPattern = 'Combined Installation Test Suite';
            break;
        case 'standard':
            grepPattern = 'Workspace Standard Test Suite';
            break;
        case 'west-git':
            grepPattern = 'Workspace West Git Test Suite';
            break;
        case 'zephyr-ide-git':
            grepPattern = 'Workspace Zephyr IDE Git Test Suite';
            break;
        case 'local-west':
            grepPattern = 'Workspace Local West Test Suite';
            break;
        case 'external-zephyr':
            grepPattern = 'Workspace External Zephyr Test Suite';
            break;
        case 'external-directory':
            grepPattern = 'Workspace Setup From External Directory Test Suite';
            break;
        case 'all':
        default:
            grepPattern = 'Test Suite';
            break;
    }

    // Run workflow integration tests
    // Use platform-appropriate quoting for the --grep pattern:
    // - Windows cmd.exe uses double quotes
    // - Linux/macOS bash/zsh use single or double quotes
    //
    // --label integration selects the `integration` configuration in
    // .vscode-test.mjs (the explicit list of heavyweight workspace-*.test.ts
    // and combined-installation.test.ts files); --grep narrows further to
    // the specific suite requested on the command line.
    const quote = process.platform === 'win32' ? '"' : "'";
    console.log(`Running ${testType} workflow integration tests...`);
    execSync(`npx vscode-test --label integration --grep ${quote}${grepPattern}${quote}`, {
        stdio: 'inherit',
        cwd: repoRoot,
        env: { ...process.env, ZEPHYR_IDE_TESTING: 'true', MOCHA_FILE: mochaFile }
    });

    console.log(`${testType} workflow integration tests completed successfully`);
    writeStepSummary(testType, parseJUnitResults(mochaFile));
} catch (error) {
    console.error(`${testType} workflow integration tests failed: ${error.message}`);
    console.error('');
    console.error('This test executes the Zephyr IDE workflow.');
    console.error('Some steps may fail if build dependencies are not available.');
    console.error('');
    console.error('Available test types: combined, standard, west-git, zephyr-ide-git, local-west, external-zephyr, external-directory, all');
    console.error('Run "node scripts/run-integration-tests.js help" for more information.');

    // Report whatever Mocha managed to write before the process failed, so a
    // CI failure still shows a pass/fail table instead of just an exit code.
    writeStepSummary(testType, parseJUnitResults(mochaFile));
    process.exit(1);
}
