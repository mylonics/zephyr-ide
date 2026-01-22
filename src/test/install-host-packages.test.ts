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

import * as vscode from 'vscode';
import { logTestEnvironment } from './test-runner';

suite('Install Host Packages Test Suite', () => {
    test('Install or verify host packages', async () => {
        logTestEnvironment();
        console.log('📦 Installing/verifying host packages...');

        try {
            const result = await vscode.commands.executeCommand('zephyr-ide.install-host-packages-headless');
            console.log(`Host packages installation result: ${result}`);
            
            if (result === true) {
                console.log('✅ All host packages are available on PATH');
            } else {
                console.log('⚠️  Host packages were installed but may not be on PATH yet');
                console.log('   This is expected on first run. The workflow will retry in a fresh shell.');
                // Exit with error to trigger retry, but this is expected behavior
                throw new Error('Host packages installed - restart needed for PATH updates');
            }
        } catch (error) {
            console.error(`❌ Host packages installation/check failed: ${error}`);
            throw error;
        }
    }).timeout(300000); // 5 minutes timeout for package installation
});
