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

import { BuildDetails } from "../../project_utilities/project_info";
import { escapeHtml } from "../webview_shared/webviewTypes";
import { getLaunchTargetDisplayName } from "../../utilities/utils";
import { tabbedConfigGroupHtml } from "./configFileGroup";
import { variablesHelpHtml } from "./VariablesSection";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function collapsibleSection(
  sectionId: string,
  title: string,
  headerRight: string,
  body: string,
  expanded = false,
): string {
  const exp = expanded ? "true" : "false";
  return `<div class="collapsible-section" data-section-id="${escapeHtml(sectionId)}" aria-expanded="${exp}">
    <div class="collapsible-header" data-command="toggleSection" data-section="${escapeHtml(sectionId)}">
      <span class="collapsible-chevron codicon codicon-chevron-right"></span>
      <span>${title}</span>
      ${headerRight ? `<span class="collapsible-header-right">${headerRight}</span>` : ""}
    </div>
    <div class="collapsible-body">${body}</div>
  </div>`;
}

// ---------------------------------------------------------------------------
// Build argument rows
// ---------------------------------------------------------------------------

function buildArgRows(args: string[], projectName: string, buildName: string, kind: string): string {
  const rows: string[] = [];
  if (args.length === 0) {
    rows.push(`<div class="file-list-empty">No ${kind === "cmake" ? "CMake" : "west"} arguments</div>`);
  } else {
    for (let i = 0; i < args.length; i++) {
      const escaped = escapeHtml(args[i]);
      rows.push(`<div class="build-arg-row">
      <input class="build-arg-input" type="text" value="${escaped}"
        data-command="upsertBuildArg" data-project="${escapeHtml(projectName)}"
        data-build="${escapeHtml(buildName)}" data-kind="${kind}" data-index="${i}" />
      <vscode-button appearance="icon" icon="trash" title="Remove"
        data-command="removeBuildArg" data-project="${escapeHtml(projectName)}"
        data-build="${escapeHtml(buildName)}" data-kind="${kind}" data-index="${i}">
      </vscode-button>
    </div>`);
    }
  }
  // Add row (always shown)
  rows.push(`<div class="build-arg-row build-arg-row-add">
    <input class="build-arg-input" type="text" placeholder="Add ${kind === "cmake" ? "CMake" : "west"} argument…"
      data-command="upsertBuildArg" data-project="${escapeHtml(projectName)}"
      data-build="${escapeHtml(buildName)}" data-kind="${kind}" data-index="-1" />
  </div>`);
  return rows.join("\n");
}

// ---------------------------------------------------------------------------
// Runner rows
// ---------------------------------------------------------------------------

function runnerRows(runners: BuildDetails["runners"], projectName: string, buildName: string): string {
  if (runners.length === 0) {
    return `<div class="file-list-empty">No runners configured</div>
      <div style="margin-top:8px;">
        <vscode-button appearance="secondary" icon="add" data-command="addRunner"
          data-project="${escapeHtml(projectName)}" data-build="${escapeHtml(buildName)}">
          Add Runner
        </vscode-button>
      </div>`;
  }
  const rows = runners.map((r) => {
    const n = escapeHtml(r.name);
    return `<div class="runner-row">
      <span class="runner-name"><i class="codicon codicon-debug-alt-small"></i> ${n}</span>
      <div class="runner-fields">
        <div class="runner-field-row">
          <span class="runner-field-label">Type</span>
          <input class="runner-input" type="text" value="${escapeHtml(r.config.runner)}"
            data-command="updateRunner" data-project="${escapeHtml(projectName)}"
            data-build="${escapeHtml(buildName)}" data-runner="${n}" data-field="runner-type" />
        </div>
        <div class="runner-field-row">
          <span class="runner-field-label">Args</span>
          <input class="runner-input" type="text" value="${escapeHtml(r.config.args)}"
            data-command="updateRunner" data-project="${escapeHtml(projectName)}"
            data-build="${escapeHtml(buildName)}" data-runner="${n}" data-field="runner-args" />
        </div>
      </div>
      <div class="runner-actions">
        <vscode-button appearance="icon" icon="trash" title="Remove"
          data-command="removeRunner" data-project="${escapeHtml(projectName)}"
          data-build="${escapeHtml(buildName)}" data-runner="${n}">
        </vscode-button>
      </div>
    </div>`;
  });
  rows.push(`<div class="action-row">
    <vscode-button appearance="secondary" icon="add" data-command="addRunner"
      data-project="${escapeHtml(projectName)}" data-build="${escapeHtml(buildName)}">
      Add Runner
    </vscode-button>
  </div>`);
  return rows.join("\n");
}

// ---------------------------------------------------------------------------
// Variables table
// ---------------------------------------------------------------------------

function variablesTableHtml(
  vars: Record<string, string>,
  level: "project" | "build",
  projectName: string,
  buildName?: string,
): string {
  const entries = Object.entries(vars);
  const rows = entries.map(([k, v]) => {
    return `<div class="variable-row">
      <input class="variable-key-input" type="text" value="${escapeHtml(k)}"
        data-command="upsertVariable" data-level="${level}" data-project="${escapeHtml(projectName)}"
        ${buildName ? `data-build="${escapeHtml(buildName)}"` : ""}
        data-original-key="${escapeHtml(k)}" data-field="key" />
      <input class="variable-value-input" type="text" value="${escapeHtml(v)}"
        data-command="upsertVariable" data-level="${level}" data-project="${escapeHtml(projectName)}"
        ${buildName ? `data-build="${escapeHtml(buildName)}"` : ""}
        data-original-key="${escapeHtml(k)}" data-field="value" />
      <vscode-button appearance="icon" icon="trash" title="Remove"
        data-command="removeVariable" data-level="${level}" data-project="${escapeHtml(projectName)}"
        ${buildName ? `data-build="${escapeHtml(buildName)}"` : ""}
        data-key="${escapeHtml(k)}">
      </vscode-button>
    </div>`;
  });
  // Add row
  rows.push(`<div class="variable-row variable-row-add">
    <input class="variable-key-input" type="text" placeholder="name"
      data-command="upsertVariable" data-level="${level}" data-project="${escapeHtml(projectName)}"
      ${buildName ? `data-build="${escapeHtml(buildName)}"` : ""}
      data-original-key="" data-field="key" />
    <input class="variable-value-input" type="text" placeholder="value"
      data-command="upsertVariable" data-level="${level}" data-project="${escapeHtml(projectName)}"
      ${buildName ? `data-build="${escapeHtml(buildName)}"` : ""}
      data-original-key="" data-field="value" />
  </div>`);
  return `<div class="variables-table">${rows.join("\n")}</div>`;
}

// ---------------------------------------------------------------------------
// Launch config rows
// ---------------------------------------------------------------------------

function launchConfigHtml(build: BuildDetails): string {
  const debugDisplay = getLaunchTargetDisplayName(build.launchTarget, build.launchTargetFolder, "Zephyr IDE: Debug");
  const buildDebugDisplay = getLaunchTargetDisplayName(build.buildDebugTarget, build.buildDebugTargetFolder, "Zephyr IDE: Debug");
  const attachDisplay = getLaunchTargetDisplayName(build.attachTarget, build.attachTargetFolder, "Zephyr IDE: Attach");

  return `
    <div class="launch-row">
      <span class="launch-label">Debug</span>
      <span class="launch-value">${escapeHtml(debugDisplay)}</span>
      <vscode-button appearance="icon" icon="edit" title="Change"
        data-command="changeLaunchTarget" data-type="debug">
      </vscode-button>
    </div>
    <div class="launch-row">
      <span class="launch-label">Build + Debug</span>
      <span class="launch-value">${escapeHtml(buildDebugDisplay)}</span>
      <vscode-button appearance="icon" icon="edit" title="Change"
        data-command="changeLaunchTarget" data-type="buildDebug">
      </vscode-button>
    </div>
    <div class="launch-row">
      <span class="launch-label">Attach</span>
      <span class="launch-value">${escapeHtml(attachDisplay)}</span>
      <vscode-button appearance="icon" icon="edit" title="Change"
        data-command="changeLaunchTarget" data-type="attach">
      </vscode-button>
    </div>`;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function getBuildSectionHtml(
  build: BuildDetails,
  projectName: string,
  buildName: string,
  buildVars: Record<string, string>,
  isActive: boolean,
): string {
  const p = escapeHtml(projectName);
  const b = escapeHtml(buildName);

  // Status badge
  const statusClass = isActive ? "status-built" : "status-not-built";
  const statusLabel = isActive ? "Active" : "Inactive";

  // -- Config files section --
  const configBody = tabbedConfigGroupHtml(
    `build-${b}`,
    build.confFiles.config,
    "addBuildConfigFile", "removeBuildConfigFile", "toggleBuildConfigFileExtra",
    build.confFiles.overlay,
    "addBuildOverlayFile", "removeBuildOverlayFile", "toggleBuildOverlayFileExtra",
  );

  const kconfigCount = build.confFiles.config.length;
  const overlayCount = build.confFiles.overlay.length;
  const configHeaderRight = `${kconfigCount} kconfig, ${overlayCount} overlay`;

  // -- Build args section --
  const westArgCount = build.westBuildArgs.length;
  const cmakeArgCount = build.westBuildCMakeArgs.length;

  const buildArgsBody = `
    <div class="variables-section">
      <div class="section-row-header">
        <span class="section-row-title">West Build Arguments</span>
      </div>
      <div class="build-args-tab-body">${buildArgRows(build.westBuildArgs, projectName, buildName, "west")}</div>
    </div>
    <div class="variables-section">
      <div class="section-row-header">
        <span class="section-row-title">CMake Arguments</span>
      </div>
      <div class="build-args-tab-body">${buildArgRows(build.westBuildCMakeArgs, projectName, buildName, "cmake")}</div>
    </div>`;

  const argsHeaderRight = `${westArgCount} west, ${cmakeArgCount} cmake`;

  // -- Launch configs section --
  const launchBody = launchConfigHtml(build);

  // -- Runners section --
  const runnersBody = runnerRows(build.runners, projectName, buildName);
  const runnersHeaderRight = `${build.runners.length} runner${build.runners.length !== 1 ? "s" : ""}`;

  // -- Variables section --
  const varEntries = Object.keys(buildVars).length;
  const varsBody = `
    <div class="variables-section">
      <div class="section-row-header">
        <span class="section-row-title">Build Variables</span>
        <vscode-button appearance="icon" icon="question" title="Variable help"
          data-command="toggleHelp" data-target="variables-help-build-${b}">
        </vscode-button>
      </div>
      ${variablesHelpHtml(`build-${b}`)}
      ${variablesTableHtml(buildVars, "build", projectName, buildName)}
    </div>`;
  const varsHeaderRight = `${varEntries} var${varEntries !== 1 ? "s" : ""}`;

  // -- Board info strip --
  const boardDir = build.relBoardDir || build.relBoardSubDir || "";
  const boardDirLink = boardDir
    ? `<span class="info-item">
        <span class="info-item-label">Dir:</span>
        <span class="info-item-value clickable" data-command="openFolder" data-file="${escapeHtml(build.resolvedBoardPath ?? boardDir)}">${escapeHtml(boardDir)}</span>
      </span>`
    : "";

  return `<div class="build-card">
    <div class="build-card-header">
      <h2 class="build-card-title">
        <i class="codicon codicon-tools"></i>
        ${b}
      </h2>
      <div class="build-card-badges">
        <span class="build-status-badge ${statusClass}">${statusLabel}</span>
      </div>
      <div class="build-card-actions">
        <vscode-button icon="play" data-command="build" title="Build">Build</vscode-button>
        <vscode-button appearance="secondary" icon="refresh" data-command="buildPristine" title="Pristine Build">Pristine</vscode-button>
        <vscode-button appearance="secondary" icon="zap" data-command="flash" title="Flash">Flash</vscode-button>
        <vscode-button appearance="secondary" icon="debug-alt" data-command="debug" title="Debug">Debug</vscode-button>
        <vscode-button appearance="icon" icon="trash" title="Remove Build"
          data-command="removeBuild" data-project="${p}" data-build="${b}">
        </vscode-button>
      </div>
    </div>
    <div class="build-info-strip">
      <span class="info-item">
        <span class="info-item-label">Board:</span>
        <span class="info-item-value">${escapeHtml(build.boardDisplayName)}</span>
      </span>
      ${boardDirLink}
      <span class="info-item">
        <span class="info-item-label">Optimization:</span>
        <span class="info-item-value">${escapeHtml(build.debugOptimization)}</span>
      </span>
    </div>
    <div class="build-card-body">
      ${collapsibleSection("config-" + b, "Configuration Files", configHeaderRight, configBody, true)}
      ${collapsibleSection("args-" + b, "Build Arguments", argsHeaderRight, buildArgsBody)}
      ${collapsibleSection("launch-" + b, "Launch Configurations", "", launchBody)}
      ${collapsibleSection("runners-" + b, "Runners", runnersHeaderRight, runnersBody)}
      ${collapsibleSection("vars-" + b, "Variables", varsHeaderRight, varsBody)}
    </div>
  </div>`;
}
