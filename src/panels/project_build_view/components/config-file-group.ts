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

import { html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { ZephyrLitElement } from "../../webview_shared/lit-base";
import type { WebviewConfigFileEntry } from "../project-build-data";

@customElement("config-file-group")
export class ConfigFileGroup extends ZephyrLitElement {
  @property() idPrefix = "";
  @property({ type: Boolean }) isProject = false;
  @property({ type: Array }) kconfigFiles: WebviewConfigFileEntry[] = [];
  @property() kconfigAddCmd = "";
  @property() kconfigRemoveCmd = "";
  @property({ type: Array }) overlayFiles: WebviewConfigFileEntry[] = [];
  @property() overlayAddCmd = "";
  @property() overlayRemoveCmd = "";

  private _renderFileList(
    files: WebviewConfigFileEntry[],
    groupId: string,
    addCmd: string,
    removeCmd: string,
    isKConfig: boolean,
    addLabel: string,
  ) {
    return html`
      <div class="config-tab-body">
        <div class="config-tab-header-row">
          <span class="config-tab-col-extra">Type</span>
          <span class="config-tab-col-file">File</span>
          <vscode-button class="config-tab-add-button" appearance="secondary" icon="add" title=${addLabel}
            @click=${() => this.postCommand(addCmd, { group: groupId })}>
            ${addLabel}
          </vscode-button>
        </div>
        <vscode-scrollable class="config-file-scroll">
          ${files.length === 0
        ? html`<div class="file-list-empty">No files configured</div>`
        : files.map(
          (entry) => html`
                  <div class="file-list-item">
                    <vscode-button class="file-mode-button" appearance="secondary"
                      title=${entry.extra ? "Currently used as an extra file. Click to use as an override." : "Currently used as an override. Click to use as an extra file."}
                      @click=${() => this.postCommand("toggleFileExtra", {
            file: entry.path,
            group: groupId,
            isKConfig: isKConfig ? "true" : "false",
            isProject: this.isProject ? "true" : "false",
            extra: entry.extra ? "false" : "true",
          })}>
                      ${entry.extra ? "Extra" : "Override"}
                    </vscode-button>
                    <span class="file-name" title=${entry.path}
                      @click=${() => this.postCommand("openFile", { file: entry.path })}>
                      ${entry.path}
                    </span>
                    <vscode-button class="file-remove-button" appearance="icon" icon="trash" title="Remove"
                      @click=${() => this.postCommand(removeCmd, {
            file: entry.path,
            extra: entry.extra ? "true" : "false",
            group: groupId,
          })}>
                    </vscode-button>
                  </div>
                `,
        )}
        </vscode-scrollable>
      </div>
    `;
  }

  render() {
    const kconfigGroupId = `kconfig-${this.idPrefix}`;
    const overlayGroupId = `overlay-${this.idPrefix}`;

    return html`
      <div class="config-group">
        <vscode-tabs>
          <vscode-tab-header slot="header">Kconfig Files</vscode-tab-header>
          <vscode-tab-panel>
            ${this._renderFileList(this.kconfigFiles, kconfigGroupId, this.kconfigAddCmd, this.kconfigRemoveCmd, true, "Add Kconfig")}
          </vscode-tab-panel>
          <vscode-tab-header slot="header">Devicetree Overlay Files</vscode-tab-header>
          <vscode-tab-panel>
            ${this._renderFileList(this.overlayFiles, overlayGroupId, this.overlayAddCmd, this.overlayRemoveCmd, false, "Add Overlay")}
          </vscode-tab-panel>
        </vscode-tabs>
      </div>
    `;
  }
}
