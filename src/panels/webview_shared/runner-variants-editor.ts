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
import { ZephyrLitElement } from "./lit-base";

/**
 * Minimal shape consumed by `<runner-variants-editor>`. Mirrors
 * `WebviewVariantEntry` / `WebviewVariantsCatalogue` from the project-build
 * panel so it can be shared by other panels (e.g. Settings) without
 * cross-panel imports.
 */
export interface VariantEntry {
  name: string;
  runner: string;
  args: string;
  shadowed: boolean;
}

export interface VariantsCatalogue {
  user: VariantEntry[];
  workspace: VariantEntry[];
  referencedNames: string[];
  hasWorkspace: boolean;
}

type VariantScope = "user" | "workspace";

/**
 * Inline editor for `zephyr-ide.runnerVariants` (user scope) and the
 * `runnerVariants` array in `.vscode/zephyr-ide.json` (workspace scope).
 *
 * - Each row uses a dirty-on-blur / Enter-to-save pattern to match the rest
 *   of the project-build webview.
 * - The runner field is a free-text input listing `KNOWN_RUNNERS` as datalist
 *   suggestions so users can pick one or type a custom value.
 */
@customElement("runner-variants-editor")
export class RunnerVariantsEditor extends ZephyrLitElement {
  @property({ type: Object }) catalogue!: VariantsCatalogue;
  @property({ type: Array }) knownRunners: string[] = [];

  private _onInput(e: InputEvent) {
    (e.target as HTMLInputElement).classList.add("input-dirty");
  }

  private _saveIfDirty(scope: VariantScope, originalName: string, row: HTMLElement) {
    const dirty = row.querySelector(".input-dirty");
    if (!dirty) { return; }
    const nameEl = row.querySelector<HTMLInputElement>('input[data-field="name"]');
    const runnerEl = row.querySelector<HTMLInputElement>('input[data-field="runner"]');
    const argsEl = row.querySelector<HTMLInputElement>('input[data-field="args"]');
    if (!nameEl || !runnerEl || !argsEl) { return; }

    row.querySelectorAll(".input-dirty").forEach(el => el.classList.remove("input-dirty"));

    this.postCommand("updateVariant", {
      scope,
      originalName,
      name: nameEl.value,
      runner: runnerEl.value,
      args: argsEl.value,
    });
  }

  private _onBlur(e: FocusEvent, scope: VariantScope, originalName: string) {
    const input = e.target as HTMLInputElement;
    if (!input.classList.contains("input-dirty")) { return; }
    const row = input.closest(".variant-row") as HTMLElement | null;
    if (!row) { return; }
    // Defer slightly so blur->focus moves between fields in the same row are coalesced.
    setTimeout(() => this._saveIfDirty(scope, originalName, row), 250);
  }

  private _onKeydown(e: KeyboardEvent, scope: VariantScope, originalName: string) {
    if (e.key !== "Enter") { return; }
    const input = e.target as HTMLInputElement;
    const row = input.closest(".variant-row") as HTMLElement | null;
    if (!row) { return; }
    e.preventDefault();
    input.blur();
    this._saveIfDirty(scope, originalName, row);
  }

  private _addVariant(scope: VariantScope) {
    this.postCommand("addVariant", { scope, name: "new-variant", runner: "openocd", args: "" });
  }

  private _removeVariant(scope: VariantScope, name: string) {
    this.postCommand("removeVariant", { scope, name });
  }

  private _renderRow(scope: VariantScope, entry: VariantEntry, referenced: Set<string>) {
    const isReferenced = referenced.has(entry.name);
    const datalistId = `runners-${scope}-${entry.name}`;
    const refTitle = isReferenced ? "Referenced by one or more runner bindings" : "";
    const shadowedBadge = entry.shadowed
      ? html`<span class="variant-shadow-badge" title="A workspace variant of the same name overrides this user entry">overridden by workspace</span>`
      : nothing;
    return html`
      <div class="variant-row" data-original-name=${entry.name}>
        <input class="variant-input variant-name" type="text" data-field="name"
          .value=${entry.name}
          aria-label="Variant name"
          placeholder="name"
          @input=${this._onInput}
          @focusout=${(e: FocusEvent) => this._onBlur(e, scope, entry.name)}
          @keydown=${(e: KeyboardEvent) => this._onKeydown(e, scope, entry.name)} />
        ${shadowedBadge}
        ${isReferenced ? html`<span class="variant-ref-badge" title=${refTitle}>in use</span>` : nothing}
        <input class="variant-input variant-runner" type="text" data-field="runner"
          .value=${entry.runner}
          list=${datalistId}
          aria-label="Runner"
          placeholder="runner"
          @input=${this._onInput}
          @focusout=${(e: FocusEvent) => this._onBlur(e, scope, entry.name)}
          @keydown=${(e: KeyboardEvent) => this._onKeydown(e, scope, entry.name)} />
        <datalist id=${datalistId}>
          ${this.knownRunners.map(r => html`<option value=${r}></option>`)}
        </datalist>
        <input class="variant-input variant-args" type="text" data-field="args"
          .value=${entry.args}
          aria-label="Args"
          placeholder="args (e.g. --speed 4000)"
          @input=${this._onInput}
          @focusout=${(e: FocusEvent) => this._onBlur(e, scope, entry.name)}
          @keydown=${(e: KeyboardEvent) => this._onKeydown(e, scope, entry.name)} />
        <vscode-button appearance="icon" icon="trash" title="Remove variant"
          @click=${() => this._removeVariant(scope, entry.name)}>
        </vscode-button>
      </div>
    `;
  }

  private _renderScope(scope: VariantScope, label: string, hint: string, entries: VariantEntry[], referenced: Set<string>, disabled: boolean) {
    return html`
      <div class="variant-scope">
        <div class="variant-scope-header">
          <span class="variant-scope-label">${label}</span>
          <span class="variant-scope-hint">${hint}</span>
        </div>
        ${disabled
        ? html`<div class="file-list-empty">Open a workspace folder to manage workspace-scope variants.</div>`
        : (entries.length === 0
          ? html`<div class="file-list-empty">No variants in this scope</div>`
          : entries.map(entry => this._renderRow(scope, entry, referenced)))}
        ${disabled
        ? nothing
        : html`
            <div class="variant-actions">
              <vscode-button appearance="secondary" icon="add"
                @click=${() => this._addVariant(scope)}>
                Add Variant
              </vscode-button>
            </div>
          `}
      </div>
    `;
  }

  render() {
    const cat = this.catalogue;
    if (!cat) { return nothing; }
    const referenced = new Set(cat.referencedNames ?? []);
    return html`
      <div class="variant-editor">
        ${this._renderScope("user", "User (settings.json)", "zephyr-ide.runnerVariants", cat.user, referenced, false)}
        ${this._renderScope("workspace", "Workspace (.vscode/zephyr-ide.json)", "runnerVariants", cat.workspace, referenced, !cat.hasWorkspace)}
      </div>
    `;
  }
}
