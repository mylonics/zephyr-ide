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
import * as assert from 'assert';
import { logTestEnvironment } from './test-runner';

suite('Install Package Manager Test Suite', () => {
    test('Install or verify package manager', async () => {
        logTestEnvironment();
        console.log('🔧 Installing/verifying package manager...');

        try {
            const result = await vscode.commands.executeCommand('zephyr-ide.install-package-manager-headless');
            console.log(`Package manager installation result: ${result}`);
            
            if (result === true) {
                console.log('✅ Package manager is available');
            } else {
                console.log('⚠️  Package manager was installed but may need restart for PATH updates');
                console.log('   This is expected on first run. The workflow will retry in a fresh shell.');
                // Exit with error to trigger retry, but this is expected behavior
                throw new Error('Package manager installed - restart needed for PATH updates');
            }
        } catch (error) {
            console.error(`❌ Package manager installation/check failed: ${error}`);
            throw error;
        }
    }).timeout(300000); // 5 minutes timeout for package manager installation
});
