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

import { escapeHtml } from "../webview_shared/webviewTypes";

/**
 * Renders a single file row with an "Extra" checkbox, clickable filename, and remove button.
 */
function fileRowHtml(
  file: string,
  groupId: string,
  isExtra: boolean,
  removeCmd: string,
  toggleCmd: string,
): string {
  const escaped = escapeHtml(file);
  const extraFlag = isExtra ? "true" : "false";
  const checkedAttr = isExtra ? " checked" : "";
  return `<div class="file-list-item" data-file="${escaped}" data-group="${groupId}" data-toggle-cmd="${escapeHtml(toggleCmd)}">
    <vscode-checkbox class="file-extra-checkbox"${checkedAttr} title="${isExtra ? "Extra file (appended)" : "Override file (replaces defaults)"}"></vscode-checkbox>
    <span class="file-name clickable" data-command="openFile" data-file="${escaped}" title="${escaped}">${escaped}</span>
    <vscode-button appearance="icon" title="Remove" data-command="${removeCmd}" data-file="${escaped}" data-extra="${extraFlag}" data-group="${groupId}">
      <vscode-icon name="trash" slot="start-icon"></vscode-icon>
    </vscode-button>
  </div>`;
}

/**
 * Renders a scrollable file list for one tab (KConfig or DTC).
 */
function fileTabContentHtml(
  groupId: string,
  primaryFiles: string[],
  extraFiles: string[],
  addCmd: string,
  removeCmd: string,
  toggleCmd: string,
): string {
  const allRows: string[] = [];

  for (const f of primaryFiles) {
    allRows.push(fileRowHtml(f, groupId, false, removeCmd, toggleCmd));
  }
  for (const f of extraFiles) {
    allRows.push(fileRowHtml(f, groupId, true, removeCmd, toggleCmd));
  }

  const emptyNotice = allRows.length === 0
    ? '<div class="file-list-empty">No files configured</div>'
    : "";

  return `
    <div class="config-tab-body">
      <div class="config-tab-header-row">
        <span class="config-tab-col-extra">Extra</span>
        <span class="config-tab-col-file">File</span>
        <vscode-button appearance="icon" title="Add File" data-command="${addCmd}" data-group="${groupId}">
          <vscode-icon name="add" slot="start-icon"></vscode-icon>
        </vscode-button>
      </div>
      <vscode-scrollable class="config-file-scroll">
        ${allRows.join("\n")}
        ${emptyNotice}
      </vscode-scrollable>
    </div>`;
}

/**
 * Renders a tabbed config file group with KConfig and DTC Overlay tabs.
 * Each tab shows a unified list of files with an Extra checkbox column.
 */
export function tabbedConfigGroupHtml(
  idPrefix: string,
  kconfigPrimary: string[],
  kconfigExtra: string[],
  kconfigAddCmd: string,
  kconfigRemoveCmd: string,
  kconfigToggleCmd: string,
  overlayPrimary: string[],
  overlayExtra: string[],
  overlayAddCmd: string,
  overlayRemoveCmd: string,
  overlayToggleCmd: string,
): string {
  const kconfigGroupId = `kconfig-${idPrefix}`;
  const overlayGroupId = `overlay-${idPrefix}`;

  return `
    <div class="config-group">
      <vscode-tabs>
        <vscode-tab-header slot="header">KConfig Files</vscode-tab-header>
        <vscode-tab-panel>
          ${fileTabContentHtml(kconfigGroupId, kconfigPrimary, kconfigExtra, kconfigAddCmd, kconfigRemoveCmd, kconfigToggleCmd)}
        </vscode-tab-panel>
        <vscode-tab-header slot="header">DTC Overlay Files</vscode-tab-header>
        <vscode-tab-panel>
          ${fileTabContentHtml(overlayGroupId, overlayPrimary, overlayExtra, overlayAddCmd, overlayRemoveCmd, overlayToggleCmd)}
        </vscode-tab-panel>
      </vscode-tabs>
    </div>`;
}
