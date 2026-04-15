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

import { TestDetails } from "../../project_utilities/project_info";
import { escapeHtml } from "../webview_shared/webviewTypes";

export function getTestSectionHtml(test: TestDetails, projectName: string): string {
  const p = escapeHtml(projectName);
  const t = escapeHtml(test.name);

  return `<div class="test-card">
    <div class="test-card-header">
      <h2 class="test-card-title">
        <i class="codicon codicon-beaker"></i>
        ${t}
      </h2>
    </div>
    <div class="test-card-body">
      <div class="info-row">
        <span class="info-label">Platform</span>
        <span class="info-value">${escapeHtml(test.platform)}</span>
      </div>
      ${test.board ? `<div class="info-row">
        <span class="info-label">Board</span>
        <span class="info-value">${escapeHtml(test.board)}</span>
      </div>` : ""}
      <div class="info-row">
        <span class="info-label">Tests</span>
        <span class="info-value">${test.tests.length > 0 ? test.tests.map(escapeHtml).join(", ") : "<em>none</em>"}</span>
      </div>
      ${test.args ? `<div class="info-row">
        <span class="info-label">Arguments</span>
        <span class="info-value" style="font-family: var(--vscode-editor-font-family, monospace); font-size: 0.92em;">${escapeHtml(test.args)}</span>
      </div>` : ""}
      ${test.serialPort ? `<div class="info-row">
        <span class="info-label">Serial Port</span>
        <span class="info-value">${escapeHtml(test.serialPort)}</span>
      </div>` : ""}
      ${test.serialBaud ? `<div class="info-row">
        <span class="info-label">Serial Baud</span>
        <span class="info-value">${escapeHtml(test.serialBaud)}</span>
      </div>` : ""}
    </div>
  </div>`;
}
