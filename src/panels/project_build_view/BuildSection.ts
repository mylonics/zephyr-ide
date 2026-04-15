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

import { BuildDetails } from "../../project_utilities/project_info";
import { escapeHtml } from "../webview_shared/webviewTypes";
import { getLaunchTargetDisplayName } from "../../utilities/utils";
import { tabbedConfigGroupHtml } from "./configFileGroup";
import { variablesHelpHtml } from "./VariablesSection";

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
        <vscode-button appearance="icon" icon="question" title="Variable Reference" data-command="toggleVariablesHelp" data-target="variables-help-build-${escapeHtml(buildName)}">
        </vscode-button>
      </div>
      ${variablesHelpHtml(`build-${buildName}`)}
      <div class="variables-table">
        ${entries.length === 0 ? '<div class="file-list-empty">No variables defined</div>' : ""}
        ${entries
      .map(
        ([k, v]) => `
          <div class="variable-row">
            <input class="variable-key-input" type="text" value="${escapeHtml(k)}" aria-label="Variable name">
            <input class="variable-value-input" type="text" value="${escapeHtml(v)}" aria-label="Variable value">
            <vscode-button appearance="icon" icon="save" title="Save" data-command="upsertVariable" data-level="build" data-project="${escapeHtml(projectName)}" data-build="${escapeHtml(buildName)}" data-original-key="${escapeHtml(k)}">
            </vscode-button>
            <vscode-button appearance="icon" icon="trash" title="Remove" data-command="removeVariable" data-level="build" data-project="${escapeHtml(projectName)}" data-build="${escapeHtml(buildName)}" data-key="${escapeHtml(k)}">
            </vscode-button>
          </div>`,
      )
      .join("\n")}
        <div class="variable-row variable-row-add">
          <input class="variable-key-input" type="text" value="" placeholder="New variable name" aria-label="New variable name">
          <input class="variable-value-input" type="text" value="" placeholder="New variable value" aria-label="New variable value">
          <vscode-button appearance="icon" icon="add" title="Add Variable" data-command="upsertVariable" data-level="build" data-project="${escapeHtml(projectName)}" data-build="${escapeHtml(buildName)}" data-original-key="">
          </vscode-button>
        </div>
      </div>
    </div>`;
}

function buildArgsTabContentHtml(
  kind: "west" | "cmake",
  args: string[],
  projectName: string,
  buildName: string,
): string {
  return `
    <div class="build-args-tab-body">
      <vscode-scrollable class="config-file-scroll">
        ${args.length === 0 ? '<div class="file-list-empty">No arguments defined</div>' : ""}
        ${args
      .map(
        (arg, index) => `
          <div class="build-arg-row">
            <input class="build-arg-input" type="text" value="${escapeHtml(arg)}" aria-label="${kind} argument ${index + 1}">
            <vscode-button appearance="icon" icon="save" title="Save" data-command="upsertBuildArg" data-kind="${kind}" data-project="${escapeHtml(projectName)}" data-build="${escapeHtml(buildName)}" data-index="${index}">
            </vscode-button>
            <vscode-button appearance="icon" icon="trash" title="Remove" data-command="removeBuildArg" data-kind="${kind}" data-project="${escapeHtml(projectName)}" data-build="${escapeHtml(buildName)}" data-index="${index}">
            </vscode-button>
          </div>`,
      )
      .join("\n")}
        <div class="build-arg-row build-arg-row-add">
          <input class="build-arg-input" type="text" value="" placeholder="Add one or more arguments" aria-label="New ${kind} argument">
          <vscode-button appearance="icon" icon="add" title="Add Argument" data-command="upsertBuildArg" data-kind="${kind}" data-project="${escapeHtml(projectName)}" data-build="${escapeHtml(buildName)}" data-index="">
          </vscode-button>
        </div>
      </vscode-scrollable>
    </div>`;
}

function tabbedBuildArgsHtml(
  westArgs: string[],
  cmakeArgs: string[],
  projectName: string,
  buildName: string,
): string {
  return `
    <div class="config-group">
      <vscode-tabs data-tab-id="build-args-${buildName}">
        <vscode-tab-header slot="header">West Args</vscode-tab-header>
        <vscode-tab-panel>
          ${buildArgsTabContentHtml("west", westArgs, projectName, buildName)}
        </vscode-tab-panel>
        <vscode-tab-header slot="header">CMake Args</vscode-tab-header>
        <vscode-tab-panel>
          ${buildArgsTabContentHtml("cmake", cmakeArgs, projectName, buildName)}
        </vscode-tab-panel>
      </vscode-tabs>
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
      <div class="runner-fields">
        <div class="runner-field-row">
          <label class="runner-field-label">Runner</label>
          <input class="runner-input runner-runner-input" type="text" value="${escapeHtml(r.config.runner)}" aria-label="Runner type">
        </div>
        <div class="runner-field-row">
          <label class="runner-field-label">Args</label>
          <input class="runner-input runner-args-input" type="text" value="${escapeHtml(r.config.args || "")}" aria-label="Runner arguments">
        </div>
      </div>
      <div class="runner-actions">
        <vscode-button appearance="icon" icon="save" title="Save Runner" data-command="updateRunner" data-project="${escapeHtml(projectName)}" data-build="${escapeHtml(buildName)}" data-runner="${escapeHtml(r.name)}">
        </vscode-button>
        <vscode-button appearance="icon" icon="trash" title="Remove Runner" data-command="removeRunner" data-project="${escapeHtml(projectName)}" data-build="${escapeHtml(buildName)}" data-runner="${escapeHtml(r.name)}">
        </vscode-button>
      </div>
    </div>`,
    )
    .join("\n");
}

export function getBuildSectionHtml(
  build: BuildDetails,
  projectName: string,
  buildName: string,
  buildVars: Record<string, string>,
  isActive: boolean,
): string {
  const activeClass = isActive ? " build-active" : "";
  const activeBadge = isActive ? ' <vscode-badge variant="counter">Active</vscode-badge>' : "";

  return `
    <div class="panel-section build-section${activeClass}">
      <div class="section-header">
        <h2><i class="codicon codicon-project"></i> Build: ${escapeHtml(buildName)}${activeBadge}</h2>
        <vscode-badge>${escapeHtml(build.boardDisplayName)}</vscode-badge>
      </div>
      <div class="section-body">
        <div class="info-row">
          <span class="info-label">Board</span>
          <span class="info-value">${escapeHtml(build.boardDisplayName)}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Board Directory</span>
          <span class="info-value${build.resolvedBoardPath ? ' clickable' : ''}" ${build.resolvedBoardPath ? `data-command="openFolder" data-file="${escapeHtml(build.resolvedBoardPath)}"` : ''}>${escapeHtml(build.resolvedBoardPath ?? "Not resolved")}</span>
        </div>
        <div class="build-details-grid">
          <div class="build-details-col">
            <div class="info-row">
              <span class="info-label">Debug Optimization</span>
              <span class="info-value">${escapeHtml(build.debugOptimization)}</span>
            </div>
          </div>
        </div>

        <div class="config-group">
          <vscode-tabs data-tab-id="build-outer-${buildName}">
            <vscode-tab-header slot="header">Config</vscode-tab-header>
            <vscode-tab-panel>
              ${buildVariablesTableHtml(buildVars, projectName, buildName)}

              ${tabbedConfigGroupHtml(
    `build-${buildName}`,
    build.confFiles.config,
    build.confFiles.extraConfig,
    "addBuildConfigFile",
    "removeBuildConfigFile",
    "toggleBuildConfigFileExtra",
    build.confFiles.overlay,
    build.confFiles.extraOverlay,
    "addBuildOverlayFile",
    "removeBuildOverlayFile",
    "toggleBuildOverlayFileExtra",
  )}
            </vscode-tab-panel>
            <vscode-tab-header slot="header">Build &amp; Debug</vscode-tab-header>
            <vscode-tab-panel>
              ${tabbedBuildArgsHtml(build.westBuildArgs, build.westBuildCMakeArgs, projectName, buildName)}

              <div class="launch-configs">
                <div class="section-row-header">
                  <span class="section-row-title">Launch Configurations</span>
                </div>
                <div class="launch-row">
                  <span class="launch-label">Debug</span>
                  <span class="launch-value">${escapeHtml(getLaunchTargetDisplayName(build.launchTarget, build.launchTargetFolder, "Zephyr IDE: Debug"))}</span>
                  <vscode-button appearance="icon" icon="edit" title="Change" data-command="changeLaunchTarget" data-project="${escapeHtml(projectName)}" data-build="${escapeHtml(buildName)}" data-type="debug">
                  </vscode-button>
                </div>
                <div class="launch-row">
                  <span class="launch-label">Build + Debug</span>
                  <span class="launch-value">${escapeHtml(getLaunchTargetDisplayName(build.buildDebugTarget, build.buildDebugTargetFolder, "Zephyr IDE: Debug"))}</span>
                  <vscode-button appearance="icon" icon="edit" title="Change" data-command="changeLaunchTarget" data-project="${escapeHtml(projectName)}" data-build="${escapeHtml(buildName)}" data-type="buildDebug">
                  </vscode-button>
                </div>
                <div class="launch-row">
                  <span class="launch-label">Attach</span>
                  <span class="launch-value">${escapeHtml(getLaunchTargetDisplayName(build.attachTarget, build.attachTargetFolder, "Zephyr IDE: Attach"))}</span>
                  <vscode-button appearance="icon" icon="edit" title="Change" data-command="changeLaunchTarget" data-project="${escapeHtml(projectName)}" data-build="${escapeHtml(buildName)}" data-type="attach">
                  </vscode-button>
                </div>
              </div>

              <div class="runners-section">
                <div class="section-row-header">
                  <span class="section-row-title">Runners</span>
                  <vscode-button appearance="icon" icon="add" title="Add Runner" data-command="addRunner" data-project="${escapeHtml(projectName)}" data-build="${escapeHtml(buildName)}">
                  </vscode-button>
                </div>
                ${runnersHtml(build.runners, projectName, buildName)}
              </div>
            </vscode-tab-panel>
          </vscode-tabs>
        </div>
      </div>
    </div>`;
}
