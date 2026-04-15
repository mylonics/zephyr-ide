/*
Copyright 2026 mylonics 
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
import { ConfigFileEntry } from "../../project_utilities/config_selector";

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
  const toggleToExtraFlag = isExtra ? "false" : "true";
  const modeLabel = isExtra ? "Extra" : "Override";
  return `<div class="file-list-item" data-file="${escaped}" data-group="${groupId}" data-toggle-cmd="${escapeHtml(toggleCmd)}">
    <vscode-button class="file-mode-button" appearance="secondary" title="${isExtra ? "Switch to override file" : "Switch to extra file"}" data-command="toggleFileExtra" data-file="${escaped}" data-group="${groupId}" data-toggle-cmd="${escapeHtml(toggleCmd)}" data-extra="${toggleToExtraFlag}">
      ${modeLabel}
    </vscode-button>
    <span class="file-name clickable" data-command="openFile" data-file="${escaped}" title="${escaped}">${escaped}</span>
    <vscode-button class="file-remove-button" appearance="icon" icon="trash" title="Remove" data-command="${removeCmd}" data-file="${escaped}" data-extra="${extraFlag}" data-group="${groupId}">
    </vscode-button>
  </div>`;
}

/**
 * Renders a scrollable file list for one tab (KConfig or DTC).
 */
function fileTabContentHtml(
  groupId: string,
  files: ConfigFileEntry[],
  addCmd: string,
  removeCmd: string,
  toggleCmd: string,
  addLabel: string,
): string {
  const allRows: string[] = [];

  for (const entry of files) {
    allRows.push(fileRowHtml(entry.path, groupId, !!entry.extra, removeCmd, toggleCmd));
  }

  const emptyNotice = allRows.length === 0
    ? '<div class="file-list-empty">No files configured</div>'
    : "";

  return `
    <div class="config-tab-body">
      <div class="config-tab-header-row">
        <span class="config-tab-col-extra">Type</span>
        <span class="config-tab-col-file">File</span>
        <vscode-button class="config-tab-add-button" appearance="secondary" icon="add" title="${addLabel}" data-command="${addCmd}" data-group="${groupId}">
          ${addLabel}
        </vscode-button>
      </div>
      <vscode-scrollable class="config-file-scroll">
        ${allRows.join("\n")}
        ${emptyNotice}
      </vscode-scrollable>
    </div>`;
}

/**
 * Renders a tabbed config file group with Kconfig and Devicetree Overlay tabs.
 * Each tab shows a unified list of files with an Extra checkbox column.
 */
export function tabbedConfigGroupHtml(
  idPrefix: string,
  kconfigFiles: ConfigFileEntry[],
  kconfigAddCmd: string,
  kconfigRemoveCmd: string,
  kconfigToggleCmd: string,
  overlayFiles: ConfigFileEntry[],
  overlayAddCmd: string,
  overlayRemoveCmd: string,
  overlayToggleCmd: string,
): string {
  const kconfigGroupId = `kconfig-${idPrefix}`;
  const overlayGroupId = `overlay-${idPrefix}`;

  return `
    <div class="config-group">
      <vscode-tabs data-tab-id="config-${idPrefix}">
        <vscode-tab-header slot="header">Kconfig Files</vscode-tab-header>
        <vscode-tab-panel>
          ${fileTabContentHtml(kconfigGroupId, kconfigFiles, kconfigAddCmd, kconfigRemoveCmd, kconfigToggleCmd, "Add Kconfig")}
        </vscode-tab-panel>
        <vscode-tab-header slot="header">Devicetree Overlay Files</vscode-tab-header>
        <vscode-tab-panel>
          ${fileTabContentHtml(overlayGroupId, overlayFiles, overlayAddCmd, overlayRemoveCmd, overlayToggleCmd, "Add Overlay")}
        </vscode-tab-panel>
      </vscode-tabs>
    </div>`;
}
