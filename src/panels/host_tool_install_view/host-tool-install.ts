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

import '@vscode-elements/elements/dist/vscode-button/index.js';
import '@vscode-elements/elements/dist/vscode-icon/index.js';
import '@vscode-elements/elements/dist/vscode-progress-ring/index.js';
import { getVsCodeApi } from '../webview_shared/webviewTypes';
import { HostToolsClient } from '../webview_shared/hostToolsClient';

const vscode = getVsCodeApi();

// Create the shared host tools client for the standalone panel.
const hostToolsClient = new HostToolsClient(vscode, 'cards');

// Expose on window for onclick handlers in HTML
(window as any).hostToolsClient = hostToolsClient;

// Route all messages from the extension to the shared client
window.addEventListener('message', event => {
  hostToolsClient.handleMessage(event.data);
});

// Also expose a markComplete function for the standalone view's button
function markComplete(): void {
  vscode.postMessage({ command: 'markComplete' });
}
(window as any).markComplete = markComplete;

// Initial status check on load
hostToolsClient.refreshStatus();
