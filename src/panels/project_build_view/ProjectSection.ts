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
import { tabbedConfigGroupHtml } from "./configFileGroup";

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
      </div>
      <div class="variables-table">
        ${entries.length === 0 ? '<div class="file-list-empty">No variables defined</div>' : ""}
        ${entries
      .map(
        ([k, v]) => `
          <div class="variable-row">
            <input class="variable-key-input" type="text" value="${escapeHtml(k)}" aria-label="Variable name">
            <input class="variable-value-input" type="text" value="${escapeHtml(v)}" aria-label="Variable value">
            <vscode-button appearance="icon" icon="save" title="Save" data-command="upsertVariable" data-level="${level}" data-project="${escapeHtml(projectName)}" data-original-key="${escapeHtml(k)}">
            </vscode-button>
            <vscode-button appearance="icon" icon="trash" title="Remove" data-command="removeVariable" data-level="${level}" data-project="${escapeHtml(projectName)}" data-key="${escapeHtml(k)}">
            </vscode-button>
          </div>`,
      )
      .join("\n")}
        <div class="variable-row variable-row-add">
          <input class="variable-key-input" type="text" value="" placeholder="New variable name" aria-label="New variable name">
          <input class="variable-value-input" type="text" value="" placeholder="New variable value" aria-label="New variable value">
          <vscode-button appearance="icon" icon="add" title="Add Variable" data-command="upsertVariable" data-level="${level}" data-project="${escapeHtml(projectName)}" data-original-key="">
          </vscode-button>
        </div>
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

        ${tabbedConfigGroupHtml(
    "project",
    projectInfo.confFiles.config,
    projectInfo.confFiles.extraConfig,
    "addProjectConfigFile",
    "removeProjectConfigFile",
    "toggleProjectConfigFileExtra",
    projectInfo.confFiles.overlay,
    projectInfo.confFiles.extraOverlay,
    "addProjectOverlayFile",
    "removeProjectOverlayFile",
    "toggleProjectOverlayFileExtra",
  )}

        ${variablesTableHtml(projectVars, "project", projectName)}

        <div class="action-row">
          <vscode-button appearance="secondary" icon="add" data-command="addBuild" data-project="${escapeHtml(projectName)}">
            Add Build
          </vscode-button>
          <vscode-button appearance="secondary" icon="beaker" data-command="addTest" data-project="${escapeHtml(projectName)}">
            Add Test
          </vscode-button>
        </div>
      </div>
    </div>`;
}
