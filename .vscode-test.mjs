import { defineConfig } from '@vscode/test-cli';
import { tmpdir } from 'os';
import { join } from 'path';
import { existsSync, mkdirSync, rmSync } from 'fs';

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

export default defineConfig({
	files: 'out/test/**/*.test.js',
	workspaceFolder: testWorkspace,
	mocha: {
		ui: 'tdd',
		timeout: 900000
	}
});
