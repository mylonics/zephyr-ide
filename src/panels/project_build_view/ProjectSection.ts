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

import { ProjectInfo } from "../../project_utilities/project_info";
import { escapeHtml } from "../webview_shared/webviewTypes";
import { tabbedConfigGroupHtml } from "./configFileGroup";
import { variablesHelpHtml } from "./VariablesSection";

// ---------------------------------------------------------------------------
// Variables table (project-level)
// ---------------------------------------------------------------------------

function projectVariablesTableHtml(
  vars: Record<string, string>,
  projectName: string,
): string {
  const entries = Object.entries(vars);
  const rows = entries.map(([k, v]) => {
    return `<div class="variable-row">
      <input class="variable-key-input" type="text" value="${escapeHtml(k)}"
        data-command="upsertVariable" data-level="project" data-project="${escapeHtml(projectName)}"
        data-original-key="${escapeHtml(k)}" data-field="key" />
      <input class="variable-value-input" type="text" value="${escapeHtml(v)}"
        data-command="upsertVariable" data-level="project" data-project="${escapeHtml(projectName)}"
        data-original-key="${escapeHtml(k)}" data-field="value" />
      <vscode-button appearance="icon" icon="trash" title="Remove"
        data-command="removeVariable" data-level="project" data-project="${escapeHtml(projectName)}"
        data-key="${escapeHtml(k)}">
      </vscode-button>
    </div>`;
  });
  // Add row
  rows.push(`<div class="variable-row variable-row-add">
    <input class="variable-key-input" type="text" placeholder="name"
      data-command="upsertVariable" data-level="project" data-project="${escapeHtml(projectName)}"
      data-original-key="" data-field="key" />
    <input class="variable-value-input" type="text" placeholder="value"
      data-command="upsertVariable" data-level="project" data-project="${escapeHtml(projectName)}"
      data-original-key="" data-field="value" />
  </div>`);
  return `<div class="variables-table">${rows.join("\n")}</div>`;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function getProjectSectionHtml(
  info: ProjectInfo,
  projectName: string,
  projectVars: Record<string, string>,
): string {
  const p = escapeHtml(projectName);

  const mainFile = info.mainSourceFile
    ? `<span class="clickable" data-command="openFile" data-file="${escapeHtml(info.mainSourceFile)}">${escapeHtml(info.mainSourceFile)}</span>`
    : "<em>not found</em>";

  const kconfigCount = info.confFiles.config.length;
  const overlayCount = info.confFiles.overlay.length;
  const varCount = Object.keys(projectVars).length;

  // Summary bar (compact, click to expand)
  const summaryBar = `<div class="project-summary-bar" aria-expanded="false" data-command="toggleProjectDetail">
    <span class="project-summary-title">
      <i class="codicon codicon-folder"></i>
      ${p}
    </span>
    <span class="project-summary-meta">
      <span class="meta-item clickable" data-command="openFolder" data-file="${escapeHtml(info.absPath)}" title="${escapeHtml(info.absPath)}">${escapeHtml(info.relPath)}</span>
      <span class="meta-item">main: ${mainFile}</span>
      <span class="meta-item">${kconfigCount} kconfig</span>
      <span class="meta-item">${overlayCount} overlay</span>
      <span class="meta-item">${varCount} var${varCount !== 1 ? "s" : ""}</span>
    </span>
    <span class="project-summary-expand codicon codicon-chevron-right"></span>
  </div>`;

  // Detail panel (hidden by default)
  const configGroupHtml = tabbedConfigGroupHtml(
    `project-${p}`,
    info.confFiles.config,
    "addProjectConfigFile", "removeProjectConfigFile", "toggleProjectConfigFileExtra",
    info.confFiles.overlay,
    "addProjectOverlayFile", "removeProjectOverlayFile", "toggleProjectOverlayFileExtra",
  );

  const varsSection = `
    <div class="variables-section">
      <div class="section-row-header">
        <span class="section-row-title">Project Variables</span>
        <vscode-button appearance="icon" icon="question" title="Variable help"
          data-command="toggleHelp" data-target="variables-help-project-${p}">
        </vscode-button>
      </div>
      ${variablesHelpHtml(`project-${p}`)}
      ${projectVariablesTableHtml(projectVars, projectName)}
    </div>`;

  const detailPanel = `<div class="project-detail-panel" hidden>
    <div class="info-row">
      <span class="info-label">Path</span>
      <span class="info-value clickable" data-command="openFolder" data-file="${escapeHtml(info.absPath)}">${escapeHtml(info.absPath)}</span>
    </div>
    <div class="info-row">
      <span class="info-label">Relative Path</span>
      <span class="info-value">${escapeHtml(info.relPath)}</span>
    </div>
    <div class="info-row">
      <span class="info-label">Main Source</span>
      <span class="info-value">${mainFile}</span>
    </div>
    ${info.cmakeFile ? `<div class="info-row">
      <span class="info-label">CMakeLists.txt</span>
      <span class="info-value clickable" data-command="openFile" data-file="${escapeHtml(info.cmakeFile)}">${escapeHtml(info.cmakeFile)}</span>
    </div>` : ""}
    <div class="info-row">
      <span class="info-label">Builds</span>
      <span class="info-value">${info.buildNames.length > 0 ? info.buildNames.map(escapeHtml).join(", ") : "<em>none</em>"}</span>
    </div>
    <div class="info-row">
      <span class="info-label">Tests</span>
      <span class="info-value">${info.testNames.length > 0 ? info.testNames.map(escapeHtml).join(", ") : "<em>none</em>"}</span>
    </div>
    ${configGroupHtml}
    ${varsSection}
  </div>`;

  return summaryBar + detailPanel;
}
