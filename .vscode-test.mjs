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
// basic-tests.yml for the combined suite).
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
	'workspace-setup-from-external-directory.test.js',
	'combined-installation.test.js',
];

const outTestDir = join(__dirname, 'out', 'test');
// `files` entries are glob patterns, not filesystem paths — the `glob`
// package treats backslash as an escape character, so path.join's
// platform-native separator silently matches zero files on Windows. Always
// use forward slashes here regardless of OS.
const integrationTestFiles = integrationTestFileNames.map((f) => `out/test/${f}`);
const unitTestFiles = existsSync(outTestDir)
	? readdirSync(outTestDir)
		.filter((f) => f.endsWith('.test.js') && !integrationTestFileNames.includes(f))
		.map((f) => `out/test/${f}`)
	: [];

// Always emit both the human-readable spec output and a JUnit XML file.
// mocha-junit-reporter honors the MOCHA_FILE env var as an override for the
// output path; scripts/run-integration-tests.js sets an absolute one per
// invocation to avoid each workspace type overwriting the previous type's
// results. For any invocation that doesn't set it (e.g. `npx vscode-test`
// run directly, or unit-tests.yml's `--label unit`), default it here to an
// absolute path — the reporter resolves a relative MOCHA_FILE against the
// extension host's own cwd (the downloaded VS Code install directory, not
// this repo), so a relative default would silently write results there.
if (!process.env.MOCHA_FILE) {
	process.env.MOCHA_FILE = join(__dirname, 'test-results', 'results.xml');
}

const sharedMochaConfig = {
	ui: 'tdd',
	reporter: 'mocha-multi-reporters',
	reporterOptions: {
		configFile: join(__dirname, '.mocha-multi-reporters.json')
	}
};

export default defineConfig([
	{
		label: 'unit',
		files: unitTestFiles,
		workspaceFolder: testWorkspace,
		mocha: {
			...sharedMochaConfig,
			timeout: 900000,
		}
	},
	{
		label: 'integration',
		files: integrationTestFiles,
		workspaceFolder: testWorkspace,
		mocha: {
			...sharedMochaConfig,
			// Extended timeout for integration tests: Windows SDK toolchain
			// download via setup.cmd can take 15+ min on the first run, so the
			// per-test monitor timeout is 1200s on Windows (vs 600s elsewhere).
			// Adding a 5-minute buffer gives 1500s = 25 minutes total.
			timeout: 1500000,
		}
	}
]);
