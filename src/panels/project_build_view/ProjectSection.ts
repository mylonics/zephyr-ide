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

import { ProjectInfo } from "../../project_utilities/project_info";
import { escapeHtml } from "../webview_shared/webviewTypes";

function fileListHtml(files: string[], groupId: string, isExtra: boolean, removeCmd: string): string {
  if (files.length === 0) {
    return `<div class="file-list-empty">None</div>`;
  }
  return files
    .map((f) => {
      const escaped = escapeHtml(f);
      const extraFlag = isExtra ? "true" : "false";
      return `<div class="file-list-item">
        <span class="file-name clickable" data-command="openFile" data-file="${escaped}" title="${escaped}">${escaped}</span>
        <button class="icon-button" title="Remove" data-command="${removeCmd}" data-file="${escaped}" data-extra="${extraFlag}" data-group="${groupId}">
          <i class="codicon codicon-trash"></i>
        </button>
      </div>`;
    })
    .join("\n");
}

function fileGroupHtml(
  title: string,
  groupId: string,
  primaryFiles: string[],
  extraFiles: string[],
  addCmd: string,
  removeCmd: string,
): string {
  return `
    <div class="config-group">
      <div class="config-group-header">
        <span class="config-group-title">${title}</span>
        <button class="icon-button" title="Add File" data-command="${addCmd}" data-group="${groupId}">
          <i class="codicon codicon-add"></i>
        </button>
      </div>
      <div class="config-group-sub">
        <div class="config-sub-label">Override Files</div>
        ${fileListHtml(primaryFiles, groupId, false, removeCmd)}
      </div>
      <div class="config-group-sub">
        <div class="config-sub-label">Extra Files</div>
        ${fileListHtml(extraFiles, groupId, true, removeCmd)}
      </div>
    </div>`;
}

function variablesTableHtml(
  vars: Record<string, string>,
  level: "project",
  projectName: string,
): string {
  const entries = Object.entries(vars);
  return `
    <div class="variables-section">
      <div class="section-row-header">
        <span class="section-row-title">Variables</span>
        <button class="icon-button" title="Add Variable" data-command="addVariable" data-level="${level}" data-project="${escapeHtml(projectName)}">
          <i class="codicon codicon-add"></i>
        </button>
      </div>
      <div class="variables-table">
        ${entries.length === 0 ? '<div class="file-list-empty">No variables defined</div>' : ""}
        ${entries
      .map(
        ([k, v]) => `
          <div class="variable-row">
            <span class="variable-key">${escapeHtml(k)}</span>
            <span class="variable-value">${escapeHtml(v)}</span>
            <button class="icon-button" title="Edit" data-command="editVariable" data-level="${level}" data-project="${escapeHtml(projectName)}" data-key="${escapeHtml(k)}">
              <i class="codicon codicon-edit"></i>
            </button>
            <button class="icon-button" title="Remove" data-command="removeVariable" data-level="${level}" data-project="${escapeHtml(projectName)}" data-key="${escapeHtml(k)}">
              <i class="codicon codicon-trash"></i>
            </button>
          </div>`,
      )
      .join("\n")}
      </div>
    </div>`;
}

export function getProjectSectionHtml(
  projectInfo: ProjectInfo,
  projectName: string,
  projectVars: Record<string, string>,
): string {
  const mainFile = projectInfo.mainSourceFile
    ? `<span class="clickable" data-command="openFile" data-file="${escapeHtml(projectInfo.mainSourceFile)}">${escapeHtml(projectInfo.mainSourceFile)}</span>`
    : `<span class="text-muted">Not found</span>`;

  const cmakeFile = projectInfo.cmakeFile
    ? `<span class="clickable" data-command="openFile" data-file="${escapeHtml(projectInfo.cmakeFile)}">${escapeHtml(projectInfo.cmakeFile)}</span>`
    : `<span class="text-muted">Not found</span>`;

  return `
    <div class="panel-section">
      <div class="section-header">
        <h2><i class="codicon codicon-project"></i> Project: ${escapeHtml(projectInfo.name)}</h2>
      </div>
      <div class="section-body">
        <div class="info-row">
          <span class="info-label">Location</span>
          <span class="info-value clickable" data-command="openFolder" data-file="${escapeHtml(projectInfo.absPath)}">${escapeHtml(projectInfo.relPath)}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Main Source</span>
          <span class="info-value">${mainFile}</span>
        </div>
        <div class="info-row">
          <span class="info-label">CMake File</span>
          <span class="info-value">${cmakeFile}</span>
        </div>

        ${fileGroupHtml(
    "KConfig Files",
    "kconfig-project",
    projectInfo.confFiles.config,
    projectInfo.confFiles.extraConfig,
    "addProjectConfigFile",
    "removeProjectConfigFile",
  )}

        ${fileGroupHtml(
    "DTC Overlay Files",
    "overlay-project",
    projectInfo.confFiles.overlay,
    projectInfo.confFiles.extraOverlay,
    "addProjectOverlayFile",
    "removeProjectOverlayFile",
  )}

        ${variablesTableHtml(projectVars, "project", projectName)}

        <div class="action-row">
          <button class="action-button" data-command="addBuild" data-project="${escapeHtml(projectName)}">
            <i class="codicon codicon-add"></i> Add Build
          </button>
          <button class="action-button" data-command="addTest" data-project="${escapeHtml(projectName)}">
            <i class="codicon codicon-beaker"></i> Add Test
          </button>
        </div>
      </div>
    </div>`;
}
