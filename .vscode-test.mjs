import { defineConfig } from '@vscode/test-cli';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdirSync } from 'fs';

// Create a temporary test workspace
const testWorkspace = join(tmpdir(), 'zephyr-ide-test-workspace-' + Date.now());
mkdirSync(testWorkspace, { recursive: true });

export default defineConfig({
	files: 'out/test/**/*.test.js',
	workspaceFolder: testWorkspace,
	mocha: {
		ui: 'tdd',
		timeout: 30000
	}
});
