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
import { customElement, property, state } from "lit/decorators.js";
import { ZephyrLitElement } from "../../webview_shared/lit-base";

@customElement("variables-table")
export class VariablesTable extends ZephyrLitElement {
  @property() level: "project" | "build" = "project";
  @property() projectName = "";
  @property() buildName = "";
  @property({ type: Object }) vars: Record<string, string> = {};

  @state() private _addKey = "";
  @state() private _addValue = "";
  private _saveTimer: ReturnType<typeof setTimeout> | null = null;

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._saveTimer) { clearTimeout(this._saveTimer); this._saveTimer = null; }
  }

  private _upsert(originalKey: string, key: string, value: string) {
    if (!key.trim()) { return; }
    const msg: Record<string, string> = {
      level: this.level,
      project: this.projectName,
      key,
      value,
      originalKey,
    };
    if (this.level === "build" && this.buildName) {
      msg["build"] = this.buildName;
    }
    this.postCommand("upsertVariable", msg);
  }

  private _remove(key: string) {
    const msg: Record<string, string> = {
      level: this.level,
      project: this.projectName,
      key,
    };
    if (this.level === "build" && this.buildName) {
      msg["build"] = this.buildName;
    }
    this.postCommand("removeVariable", msg);
  }

  private _debouncedSave(originalKey: string, keyInput: HTMLInputElement, valueInput: HTMLInputElement) {
    if (this._saveTimer) { clearTimeout(this._saveTimer); }
    this._saveTimer = setTimeout(() => {
      keyInput.classList.remove("input-dirty");
      valueInput.classList.remove("input-dirty");
      this._upsert(originalKey, keyInput.value, valueInput.value);
    }, 600);
  }

  private _onBlur(e: FocusEvent, originalKey: string) {
    const input = e.target as HTMLInputElement;
    if (!input.classList.contains("input-dirty")) { return; }
    const row = input.closest(".variable-row") as HTMLElement;
    if (!row) { return; }
    const keyInput = row.querySelector<HTMLInputElement>(".variable-key-input")!;
    const valueInput = row.querySelector<HTMLInputElement>(".variable-value-input")!;
    this._debouncedSave(originalKey, keyInput, valueInput);
  }

  private _onInput(e: InputEvent) {
    const input = e.target as HTMLInputElement;
    input.classList.add("input-dirty");
  }

  private _onKeydown(e: KeyboardEvent, originalKey: string) {
    if (e.key !== "Enter") { return; }
    const input = e.target as HTMLInputElement;
    if (this._saveTimer) { clearTimeout(this._saveTimer); this._saveTimer = null; }
    input.classList.remove("input-dirty");
    const row = input.closest(".variable-row") as HTMLElement;
    if (!row) { return; }
    const keyInput = row.querySelector<HTMLInputElement>(".variable-key-input")!;
    const valueInput = row.querySelector<HTMLInputElement>(".variable-value-input")!;
    this._upsert(originalKey, keyInput.value, valueInput.value);
  }

  private _addRow() {
    if (!this._addKey.trim()) { return; }
    this._upsert("", this._addKey, this._addValue);
    this._addKey = "";
    this._addValue = "";
  }

  private _onAddKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      this._addRow();
    }
  }

  render() {
    const entries = Object.entries(this.vars);

    return html`
      <div class="variables-table">
        ${entries.map(
      ([k, v]) => html`
            <div class="variable-row">
              <input class="variable-key-input" type="text" .value=${k}
                @input=${this._onInput}
                @focusout=${(e: FocusEvent) => this._onBlur(e, k)}
                @keydown=${(e: KeyboardEvent) => this._onKeydown(e, k)} />
              <input class="variable-value-input" type="text" .value=${v}
                @input=${this._onInput}
                @focusout=${(e: FocusEvent) => this._onBlur(e, k)}
                @keydown=${(e: KeyboardEvent) => this._onKeydown(e, k)} />
              <vscode-button appearance="icon" icon="trash" title="Remove"
                @click=${() => this._remove(k)}>
              </vscode-button>
            </div>
          `,
    )}
        <div class="variable-row variable-row-add">
          <input class="variable-key-input" type="text" placeholder="New variable name"
            .value=${this._addKey}
            @input=${(e: InputEvent) => { this._addKey = (e.target as HTMLInputElement).value; }}
            @keydown=${this._onAddKeydown} />
          <input class="variable-value-input" type="text" placeholder="Value"
            .value=${this._addValue}
            @input=${(e: InputEvent) => { this._addValue = (e.target as HTMLInputElement).value; }}
            @keydown=${this._onAddKeydown} />
          <vscode-button appearance="icon" icon="add" title="Add variable"
            @click=${() => this._addRow()}>
          </vscode-button>
        </div>
      </div>
    `;
  }
}
