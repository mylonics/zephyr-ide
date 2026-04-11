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
        <vscode-button appearance="icon" title="Remove" data-command="${removeCmd}" data-file="${escaped}" data-extra="${extraFlag}" data-group="${groupId}">
          <vscode-icon name="trash" slot="start-icon"></vscode-icon>
        </vscode-button>
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
        <vscode-button appearance="icon" title="Add File" data-command="${addCmd}" data-group="${groupId}">
          <vscode-icon name="add" slot="start-icon"></vscode-icon>
        </vscode-button>
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
        <vscode-button appearance="icon" title="Add Variable" data-command="addVariable" data-level="build" data-project="${escapeHtml(projectName)}" data-build="${escapeHtml(buildName)}">
          <vscode-icon name="add" slot="start-icon"></vscode-icon>
        </vscode-button>
      </div>
      <div class="variables-table">
        ${entries.length === 0 ? '<div class="file-list-empty">No variables defined</div>' : ""}
        ${entries
      .map(
        ([k, v]) => `
          <div class="variable-row">
            <span class="variable-key">${escapeHtml(k)}</span>
            <span class="variable-value">${escapeHtml(v)}</span>
            <vscode-button appearance="icon" title="Edit" data-command="editVariable" data-level="build" data-project="${escapeHtml(projectName)}" data-build="${escapeHtml(buildName)}" data-key="${escapeHtml(k)}">
              <vscode-icon name="edit" slot="start-icon"></vscode-icon>
            </vscode-button>
            <vscode-button appearance="icon" title="Remove" data-command="removeVariable" data-level="build" data-project="${escapeHtml(projectName)}" data-build="${escapeHtml(buildName)}" data-key="${escapeHtml(k)}">
              <vscode-icon name="trash" slot="start-icon"></vscode-icon>
            </vscode-button>
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
    <vscode-collapsible title="Calculated Configuration">
      <div slot="body">
        <div class="calculated-sub">
          <div class="config-sub-label">Composed KConfig Files (project + build)</div>
          ${readonlyFileListHtml(calculated.config.concat(calculated.extraConfig))}
          <div class="config-sub-label">Composed DTC Overlay Files (project + build)</div>
          ${readonlyFileListHtml(calculated.overlay.concat(calculated.extraOverlay))}
        </div>
        <vscode-divider></vscode-divider>
        ${buildOutputHtml}
      </div>
    </vscode-collapsible>`;
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
      <vscode-button appearance="icon" title="Remove Runner" data-command="removeRunner" data-project="${escapeHtml(projectName)}" data-build="${escapeHtml(buildName)}" data-runner="${escapeHtml(r.name)}">
        <vscode-icon name="trash" slot="start-icon"></vscode-icon>
      </vscode-button>
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
  const activeBadge = isActive ? '<vscode-badge variant="counter">Active</vscode-badge>' : "";

  return `
    <div class="panel-section build-section${activeClass}">
      <vscode-collapsible title="Build: ${escapeHtml(buildName)}" open>
        <div slot="decorations">
          <vscode-badge>${escapeHtml(build.boardDisplayName)}</vscode-badge>
          ${activeBadge}
        </div>
        <div slot="body">
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
            <span class="info-value editable" role="button" tabindex="0" data-keyboard-command="true" data-command="modifyBuildArgs" data-project="${escapeHtml(projectName)}" data-build="${escapeHtml(buildName)}" title="Click to edit">${escapeHtml(build.westBuildArgs || "(none)")}</span>
          </div>
          <div class="info-row">
            <span class="info-label">CMake Args</span>
            <span class="info-value editable" role="button" tabindex="0" data-keyboard-command="true" data-command="modifyBuildArgs" data-project="${escapeHtml(projectName)}" data-build="${escapeHtml(buildName)}" title="Click to edit">${escapeHtml(build.westBuildCMakeArgs || "(none)")}</span>
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
              <vscode-button appearance="icon" title="Change" data-command="changeLaunchTarget" data-project="${escapeHtml(projectName)}" data-build="${escapeHtml(buildName)}" data-type="debug">
                <vscode-icon name="edit" slot="start-icon"></vscode-icon>
              </vscode-button>
            </div>
            <div class="launch-row">
              <span class="launch-label">Build + Debug</span>
              <span class="launch-value">${escapeHtml(getLaunchTargetDisplayName(build.buildDebugTarget, build.buildDebugTargetFolder, "Zephyr IDE: Debug"))}</span>
              <vscode-button appearance="icon" title="Change" data-command="changeLaunchTarget" data-project="${escapeHtml(projectName)}" data-build="${escapeHtml(buildName)}" data-type="buildDebug">
                <vscode-icon name="edit" slot="start-icon"></vscode-icon>
              </vscode-button>
            </div>
            <div class="launch-row">
              <span class="launch-label">Attach</span>
              <span class="launch-value">${escapeHtml(getLaunchTargetDisplayName(build.attachTarget, build.attachTargetFolder, "Zephyr IDE: Attach"))}</span>
              <vscode-button appearance="icon" title="Change" data-command="changeLaunchTarget" data-project="${escapeHtml(projectName)}" data-build="${escapeHtml(buildName)}" data-type="attach">
                <vscode-icon name="edit" slot="start-icon"></vscode-icon>
              </vscode-button>
            </div>
          </div>

          <div class="runners-section">
            <div class="section-row-header">
              <span class="section-row-title">Runners</span>
              <vscode-button appearance="icon" title="Add Runner" data-command="addRunner" data-project="${escapeHtml(projectName)}" data-build="${escapeHtml(buildName)}">
                <vscode-icon name="add" slot="start-icon"></vscode-icon>
              </vscode-button>
            </div>
            ${runnersHtml(build.runners, projectName, buildName)}
          </div>

          <vscode-divider></vscode-divider>

          <div class="build-actions">
            <vscode-button-group>
            <vscode-button data-command="build" data-project="${escapeHtml(projectName)}" data-build="${escapeHtml(buildName)}">
              <vscode-icon name="play" slot="start-icon"></vscode-icon>
              Build
            </vscode-button>
            <vscode-button appearance="secondary" data-command="buildPristine" data-project="${escapeHtml(projectName)}" data-build="${escapeHtml(buildName)}">
              <vscode-icon name="debug-rerun" slot="start-icon"></vscode-icon>
              Build Pristine
            </vscode-button>
            <vscode-button appearance="secondary" data-command="flash" data-project="${escapeHtml(projectName)}" data-build="${escapeHtml(buildName)}">
              <vscode-icon name="arrow-circle-up" slot="start-icon"></vscode-icon>
              Flash
            </vscode-button>
            <vscode-button appearance="secondary" data-command="debug" data-project="${escapeHtml(projectName)}" data-build="${escapeHtml(buildName)}">
              <vscode-icon name="debug-alt" slot="start-icon"></vscode-icon>
              Debug
            </vscode-button>
            <vscode-button appearance="secondary" data-command="buildDebug" data-project="${escapeHtml(projectName)}" data-build="${escapeHtml(buildName)}">
              <vscode-icon name="debug-start" slot="start-icon"></vscode-icon>
              Build + Debug
            </vscode-button>
            </vscode-button-group>
          </div>
        </div>
        </div>
      </vscode-collapsible>
    </div>`;
}
