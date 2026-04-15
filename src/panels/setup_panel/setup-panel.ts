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

// Zephyr IDE Setup Panel Client-Side Logic (overview-only dashboard)

import '@vscode-elements/elements/dist/vscode-button/index.js';
import '@vscode-elements/elements/dist/vscode-icon/index.js';
import { getVsCodeApi } from '../webview_shared/webviewTypes';

const vscode = getVsCodeApi();

// ---------------------------------------------------------------------------
// Command helpers
// ---------------------------------------------------------------------------

function sendCommand(cmd: string): void {
  vscode.postMessage({ command: cmd });
}

// ---------------------------------------------------------------------------
// Keyboard accessibility
// ---------------------------------------------------------------------------

function handleKeyboardCommand(event: KeyboardEvent): void {
  const isSpaceKey = event.code === 'Space' || event.key === ' ' || event.key === 'Spacebar';
  if (event.key !== 'Enter' && !isSpaceKey) {
    return;
  }

  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const actionElement = target.closest('[data-keyboard-command="true"]');
  if (!(actionElement instanceof HTMLElement)) {
    return;
  }

  if (isSpaceKey) {
    event.preventDefault();
  }
  actionElement.click();
}

document.body.addEventListener('keydown', handleKeyboardCommand);

// ---------------------------------------------------------------------------
// Workspace list actions
// ---------------------------------------------------------------------------

function reconfigureWorkspace(installPath: string): void {
  vscode.postMessage({ command: 'reconfigureWorkspace', path: installPath });
}

function updateWorkspace(installPath: string): void {
  vscode.postMessage({ command: 'updateWorkspace', path: installPath });
}

function deleteWorkspace(installPath: string, installName: string): void {
  vscode.postMessage({ command: 'deleteWorkspace', path: installPath, name: installName });
}

// ---------------------------------------------------------------------------
// Project list actions
// ---------------------------------------------------------------------------

function setActiveProject(_projectName: string): void {
  vscode.postMessage({ command: 'setActiveProject' });
}

function removeProject(projectName: string): void {
  vscode.postMessage({ command: 'removeProject', name: projectName });
}

function openProjectBuildPanel(): void {
  sendCommand('openProjectBuildPanel');
}

function openWorkspacePanelForPath(installPath: string): void {
  vscode.postMessage({ command: 'openWorkspacePanelForPath', path: installPath });
}

function deactivateWorkspace(): void {
  vscode.postMessage({ command: 'deactivateWorkspace' });
}

// ---------------------------------------------------------------------------
// Expose onclick handler functions on window
// ---------------------------------------------------------------------------

const w = window as any;
w.sendCommand = sendCommand;
w.reconfigureWorkspace = reconfigureWorkspace;
w.updateWorkspace = updateWorkspace;
w.deleteWorkspace = deleteWorkspace;
w.setActiveProject = setActiveProject;
w.removeProject = removeProject;
w.openProjectBuildPanel = openProjectBuildPanel;
w.openWorkspacePanelForPath = openWorkspacePanelForPath;
w.deactivateWorkspace = deactivateWorkspace;
