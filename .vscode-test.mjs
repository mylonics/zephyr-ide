import { defineConfig } from '@vscode/test-cli';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { existsSync, mkdirSync, rmSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Create a temporary test workspace
const testWorkspace = join(tmpdir(), 'zide-spc');
if (existsSync(testWorkspace)) {
	rmSync(testWorkspace, { recursive: true, force: true });
}
mkdirSync(testWorkspace, { recursive: true });

process.on('exit', () => {
	if (existsSync(testWorkspace)) {
		rmSync(testWorkspace, { recursive: true, force: true });
	}
});

// Heavyweight suites that require a real Zephyr SDK, network access, and a
// full west/build toolchain. These are run explicitly via the `integration`
// label (scripts/run-integration-tests.js, workspace-setup-tests.yml,
// basic-tests.yml / multiplatform-tests.yml for the combined suite).
//
// This is the single source of truth for which compiled test files count as
// "integration". Every other file under out/test is picked up automatically
// by the `unit` label below, so a newly added unit test file is never
// silently excluded from CI the way a title-based --grep filter could be.
const integrationTestFileNames = [
	'workspace-standard.test.js',
	'workspace-external-zephyr.test.js',
	'workspace-west-git.test.js',
	'workspace-zephyr-ide-git.test.js',
	'workspace-local-west.test.js',
	'combined-installation.test.js',
];

const outTestDir = join(__dirname, 'out', 'test');
const integrationTestFiles = integrationTestFileNames.map((f) => join('out', 'test', f));
const unitTestFiles = existsSync(outTestDir)
	? readdirSync(outTestDir)
		.filter((f) => f.endsWith('.test.js') && !integrationTestFileNames.includes(f))
		.map((f) => join('out', 'test', f))
	: [];

const sharedConfig = {
	workspaceFolder: testWorkspace,
	mocha: {
		ui: 'tdd',
		timeout: 900000
	}
};

export default defineConfig([
	{
		label: 'unit',
		files: unitTestFiles,
		...sharedConfig
	},
	{
		label: 'integration',
		files: integrationTestFiles,
		...sharedConfig
	}
]);
