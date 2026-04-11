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

import { BuildDetails, CalculatedConfigFiles } from "../../project_utilities/project_info";
import { BuildInfo } from "../../zephyr_utilities/build";
import { escapeHtml } from "../webview_shared/webviewTypes";
import { getLaunchTargetDisplayName } from "../../utilities/utils";

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

function readonlyFileListHtml(files: string[]): string {
  if (files.length === 0) {
    return `<div class="file-list-empty">None</div>`;
  }
  return files
    .map((f) => {
      const escaped = escapeHtml(f);
      return `<div class="file-list-item">
        <span class="file-name clickable" data-command="openFile" data-file="${escaped}" title="${escaped}">${escaped}</span>
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

function buildVariablesTableHtml(
  vars: Record<string, string>,
  projectName: string,
  buildName: string,
): string {
  const entries = Object.entries(vars);
  return `
    <div class="variables-section">
      <div class="section-row-header">
        <span class="section-row-title">Variables</span>
        <button class="icon-button" title="Add Variable" data-command="addVariable" data-level="build" data-project="${escapeHtml(projectName)}" data-build="${escapeHtml(buildName)}">
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
            <button class="icon-button" title="Edit" data-command="editVariable" data-level="build" data-project="${escapeHtml(projectName)}" data-build="${escapeHtml(buildName)}" data-key="${escapeHtml(k)}">
              <i class="codicon codicon-edit"></i>
            </button>
            <button class="icon-button" title="Remove" data-command="removeVariable" data-level="build" data-project="${escapeHtml(projectName)}" data-build="${escapeHtml(buildName)}" data-key="${escapeHtml(k)}">
              <i class="codicon codicon-trash"></i>
            </button>
          </div>`,
      )
      .join("\n")}
      </div>
    </div>`;
}

function calculatedSectionHtml(
  calculated: CalculatedConfigFiles,
  buildInfo: BuildInfo | undefined,
): string {
  let buildOutputHtml: string;
  if (buildInfo) {
    buildOutputHtml = `
      <div class="calculated-sub">
        <div class="config-sub-label">Resolved KConfig Files (from build output)</div>
        ${readonlyFileListHtml(buildInfo.kconfigFiles)}
        <div class="config-sub-label">Resolved KConfig User Files</div>
        ${readonlyFileListHtml(buildInfo.otherKconfigFiles)}
        <div class="config-sub-label">Resolved DTS File</div>
        ${buildInfo.dtsFile ? readonlyFileListHtml([buildInfo.dtsFile]) : '<div class="file-list-empty">None</div>'}
        <div class="config-sub-label">Resolved DTS Overlay / Include Files</div>
        ${readonlyFileListHtml(buildInfo.otherDtsFiles)}
      </div>`;
  } else {
    buildOutputHtml = `
      <div class="calculated-notice">
        <i class="codicon codicon-info"></i>
        Run a build to see resolved configuration files from build output.
      </div>`;
  }

  return `
    <div class="collapsible-section">
      <div class="collapsible-header" data-toggle="calculated">
        <i class="codicon codicon-chevron-right toggle-icon"></i>
        <h3>Calculated Configuration</h3>
      </div>
      <div class="collapsible-body" data-section="calculated" style="display:none;">
        <div class="calculated-sub">
          <div class="config-sub-label">Composed KConfig Files (project + build)</div>
          ${readonlyFileListHtml(calculated.config.concat(calculated.extraConfig))}
          <div class="config-sub-label">Composed DTC Overlay Files (project + build)</div>
          ${readonlyFileListHtml(calculated.overlay.concat(calculated.extraOverlay))}
        </div>
        <hr class="section-divider">
        ${buildOutputHtml}
      </div>
    </div>`;
}

function runnersHtml(
  runners: { name: string; config: { runner: string; args: string } }[],
  projectName: string,
  buildName: string,
): string {
  if (runners.length === 0) {
    return `<div class="file-list-empty">No runners configured</div>`;
  }
  return runners
    .map(
      (r) => `
    <div class="runner-row">
      <span class="runner-name"><i class="codicon codicon-debug-alt"></i> ${escapeHtml(r.name)}</span>
      <span class="runner-detail">Runner: ${escapeHtml(r.config.runner)}</span>
      <span class="runner-detail">Args: ${escapeHtml(r.config.args || "(none)")}</span>
      <button class="icon-button" title="Remove Runner" data-command="removeRunner" data-project="${escapeHtml(projectName)}" data-build="${escapeHtml(buildName)}" data-runner="${escapeHtml(r.name)}">
        <i class="codicon codicon-trash"></i>
      </button>
    </div>`,
    )
    .join("\n");
}

export function getBuildSectionHtml(
  build: BuildDetails,
  projectName: string,
  buildName: string,
  buildVars: Record<string, string>,
  calculated: CalculatedConfigFiles,
  buildInfo: BuildInfo | undefined,
  isActive: boolean,
): string {
  const activeClass = isActive ? " build-active" : "";
  const activeBadge = isActive ? '<span class="badge badge-active">Active</span>' : "";

  return `
    <div class="panel-section build-section${activeClass}">
      <div class="collapsible-header build-header" data-toggle="build-${escapeHtml(buildName)}">
        <i class="codicon codicon-chevron-down toggle-icon"></i>
        <h3><i class="codicon codicon-tools"></i> Build: ${escapeHtml(buildName)}</h3>
        <span class="build-board-badge">${escapeHtml(build.boardDisplayName)}</span>
        ${activeBadge}
      </div>
      <div class="collapsible-body" data-section="build-${escapeHtml(buildName)}">
        <div class="section-body">
          <div class="info-row">
            <span class="info-label">Board</span>
            <span class="info-value">${escapeHtml(build.boardDisplayName)}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Board Directory</span>
            <span class="info-value${build.resolvedBoardPath ? ' clickable' : ''}" ${build.resolvedBoardPath ? `data-command="openFolder" data-file="${escapeHtml(build.resolvedBoardPath)}"` : ''}>${escapeHtml(build.resolvedBoardPath ?? "Not resolved")}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Debug Optimization</span>
            <span class="info-value">${escapeHtml(build.debugOptimization)}</span>
          </div>
          <div class="info-row">
            <span class="info-label">West Args</span>
            <span class="info-value editable" data-command="modifyBuildArgs" data-project="${escapeHtml(projectName)}" data-build="${escapeHtml(buildName)}" title="Click to edit">${escapeHtml(build.westBuildArgs || "(none)")}</span>
          </div>
          <div class="info-row">
            <span class="info-label">CMake Args</span>
            <span class="info-value editable" data-command="modifyBuildArgs" data-project="${escapeHtml(projectName)}" data-build="${escapeHtml(buildName)}" title="Click to edit">${escapeHtml(build.westBuildCMakeArgs || "(none)")}</span>
          </div>

          ${fileGroupHtml(
    "KConfig Files",
    `kconfig-build-${buildName}`,
    build.confFiles.config,
    build.confFiles.extraConfig,
    "addBuildConfigFile",
    "removeBuildConfigFile",
  )}

          ${fileGroupHtml(
    "DTC Overlay Files",
    `overlay-build-${buildName}`,
    build.confFiles.overlay,
    build.confFiles.extraOverlay,
    "addBuildOverlayFile",
    "removeBuildOverlayFile",
  )}

          ${calculatedSectionHtml(calculated, buildInfo)}

          ${buildVariablesTableHtml(buildVars, projectName, buildName)}

          <div class="launch-configs">
            <div class="section-row-header">
              <span class="section-row-title">Launch Configurations</span>
            </div>
            <div class="launch-row">
              <span class="launch-label">Debug</span>
              <span class="launch-value">${escapeHtml(getLaunchTargetDisplayName(build.launchTarget, build.launchTargetFolder, "Zephyr IDE: Debug"))}</span>
              <button class="icon-button" title="Change" data-command="changeLaunchTarget" data-project="${escapeHtml(projectName)}" data-build="${escapeHtml(buildName)}" data-type="debug">
                <i class="codicon codicon-edit"></i>
              </button>
            </div>
            <div class="launch-row">
              <span class="launch-label">Build + Debug</span>
              <span class="launch-value">${escapeHtml(getLaunchTargetDisplayName(build.buildDebugTarget, build.buildDebugTargetFolder, "Zephyr IDE: Debug"))}</span>
              <button class="icon-button" title="Change" data-command="changeLaunchTarget" data-project="${escapeHtml(projectName)}" data-build="${escapeHtml(buildName)}" data-type="buildDebug">
                <i class="codicon codicon-edit"></i>
              </button>
            </div>
            <div class="launch-row">
              <span class="launch-label">Attach</span>
              <span class="launch-value">${escapeHtml(getLaunchTargetDisplayName(build.attachTarget, build.attachTargetFolder, "Zephyr IDE: Attach"))}</span>
              <button class="icon-button" title="Change" data-command="changeLaunchTarget" data-project="${escapeHtml(projectName)}" data-build="${escapeHtml(buildName)}" data-type="attach">
                <i class="codicon codicon-edit"></i>
              </button>
            </div>
          </div>

          <div class="runners-section">
            <div class="section-row-header">
              <span class="section-row-title">Runners</span>
              <button class="icon-button" title="Add Runner" data-command="addRunner" data-project="${escapeHtml(projectName)}" data-build="${escapeHtml(buildName)}">
                <i class="codicon codicon-add"></i>
              </button>
            </div>
            ${runnersHtml(build.runners, projectName, buildName)}
          </div>

          <div class="build-actions">
            <button class="action-button primary" data-command="build" data-project="${escapeHtml(projectName)}" data-build="${escapeHtml(buildName)}">
              <i class="codicon codicon-play"></i> Build
            </button>
            <button class="action-button" data-command="buildPristine" data-project="${escapeHtml(projectName)}" data-build="${escapeHtml(buildName)}">
              <i class="codicon codicon-debug-rerun"></i> Build Pristine
            </button>
            <button class="action-button" data-command="flash" data-project="${escapeHtml(projectName)}" data-build="${escapeHtml(buildName)}">
              <i class="codicon codicon-arrow-circle-up"></i> Flash
            </button>
            <button class="action-button" data-command="debug" data-project="${escapeHtml(projectName)}" data-build="${escapeHtml(buildName)}">
              <i class="codicon codicon-debug-alt"></i> Debug
            </button>
            <button class="action-button" data-command="buildDebug" data-project="${escapeHtml(projectName)}" data-build="${escapeHtml(buildName)}">
              <i class="codicon codicon-debug-start"></i> Build + Debug
            </button>
          </div>
        </div>
      </div>
    </div>`;
}
