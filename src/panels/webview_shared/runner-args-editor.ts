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

/**
 * `<runner-args-editor>` — structured runner argument editor.
 *
 * Renders schema-driven controls (toggle, dropdown, combo-box, text input, path)
 * for a single runner + slot combination. Operates in two modes:
 *
 *   - **"profile"**: edits a `RunnerArgs` object directly (used in the Runner
 *     Profile panel). Emits `args-changed` with the new `RunnerArgs` value.
 *
 *   - **"build-override"**: shows resolved args with provenance badges (yaml /
 *     profile / build) and per-arg override / remove / reset controls (used on
 *     the Build page). Emits fine-grained `runner-arg-update`, `runner-arg-remove`,
 *     `runner-arg-add`, and `runner-arg-reset` events that the parent handles.
 *
 * Both modes accept:
 *   - `runner`  — Zephyr runner name (e.g. "openocd").
 *   - `slot`    — "flash" | "debug" | "attach" | "buildDebug".
 *   - `schema`  — `ArgDef[]` describing the available args.
 *
 * Profile mode additionally accepts:
 *   - `profileArgs` — `ArgValue[]` (current canonical values).
 *
 * Build-override mode additionally accepts:
 *   - `resolvedArgs` — `WebviewArgEntry[]` with provenance.
 *   - `schemaArgIds` — full schema id list for the "add arg" dialog.
 */

import { html, nothing, TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { ZephyrLitElement } from "../webview_shared/lit-base";

// ---------------------------------------------------------------------------
// Types (mirror of project-build-data.ts / runner_arg_schema.ts, kept here
// as plain interfaces to avoid a cross-bundle import).
// ---------------------------------------------------------------------------

export interface ArgDef {
  id: string;
  label: string;
  description: string;
  group?: string;
  type: "bool" | "string" | "int" | "enum" | "combo" | "path";
  enumOptions?: string[];
  suggestions?: string[];
  defaultValue?: string;
  multi?: boolean;
  slots?: ("flash" | "debug" | "attach" | "buildDebug")[];
  west: { flag: string; takesValue: boolean; aliases?: string[] };
  cortexDebug?: { kind: string };
}

export interface ArgValue {
  id: string;
  value?: string;
}

export interface WebviewArgEntry extends ArgValue {
  source: "profile" | "yaml" | "build";
  label: string;
  description: string;
  type: "bool" | "string" | "int" | "enum" | "combo" | "path";
  enumOptions?: string[];
  suggestions?: string[];
  isRemoved: boolean;
  group?: string;
  canRemove: boolean;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/**
 * Fired in "profile" mode when the complete `RunnerArgs` changes.
 * `detail` is the new `{ structured: ArgValue[], raw?: string[] }` object.
 */
export class RunnerArgsChangedEvent extends CustomEvent<{ structured: ArgValue[]; raw?: string[] }> {
  constructor(detail: { structured: ArgValue[]; raw?: string[] }) {
    super("args-changed", { detail, bubbles: true, composed: true });
  }
}

/**
 * Fired in "build-override" mode for individual arg mutations.
 * Handlers access `e.detail.argId` / `e.detail.value`.
 */
export class RunnerArgUpdateEvent extends CustomEvent<{ argId: string; value: string | undefined }> {
  constructor(argId: string, value: string | undefined) {
    super("runner-arg-update", { detail: { argId, value }, bubbles: true, composed: true });
  }
}
export class RunnerArgRemoveEvent extends CustomEvent<{ argId: string }> {
  constructor(argId: string) {
    super("runner-arg-remove", { detail: { argId }, bubbles: true, composed: true });
  }
}
export class RunnerArgAddEvent extends CustomEvent<{ argId: string; value: string | undefined }> {
  constructor(argId: string, value: string | undefined) {
    super("runner-arg-add", { detail: { argId, value }, bubbles: true, composed: true });
  }
}
export class RunnerArgResetEvent extends CustomEvent<never> {
  constructor() {
    super("runner-arg-reset", { bubbles: true, composed: true });
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

@customElement("runner-args-editor")
export class RunnerArgsEditor extends ZephyrLitElement {
  // Mode and context
  @property() mode: "profile" | "build-override" = "profile";
  @property() runner = "";
  @property() slot: "flash" | "debug" | "attach" | "buildDebug" = "flash";

  // Schema (passed by parent from RUNNER_ARG_SCHEMAS or WebviewSlotBind.schemaArgIds)
  @property({ attribute: false }) schema: ArgDef[] = [];

  // Profile mode
  @property({ attribute: false }) profileArgs: ArgValue[] = [];

  // Build-override mode
  @property({ attribute: false }) resolvedArgs: WebviewArgEntry[] = [];
  @property({ attribute: false }) schemaArgIds: string[] = [];

  // UI state
  @state() private _addArgPickerOpen = false;
  @state() private _addArgId = "";
  @state() private _addArgValue = "";

  // ── Helpers ──────────────────────────────────────────────────────────────

  private _defFor(id: string): ArgDef | undefined {
    return this.schema.find(d => d.id === id);
  }

  private _emitProfileArgsChanged(args: ArgValue[]) {
    this.dispatchEvent(new RunnerArgsChangedEvent({ structured: args }));
  }

  // ── Profile-mode handlers ─────────────────────────────────────────────────

  private _onProfileBoolToggle(id: string, checked: boolean) {
    const next = this.profileArgs.filter(a => a.id !== id);
    if (checked) { next.push({ id }); }
    this._emitProfileArgsChanged(next);
  }

  private _onProfileValueChange(id: string, value: string, multi = false) {
    if (multi) {
      // For multi-value args, we append a new entry (each input is independent).
      const next = [...this.profileArgs, { id, value }];
      this._emitProfileArgsChanged(next);
    } else {
      const next = this.profileArgs.filter(a => a.id !== id);
      if (value.trim()) { next.push({ id, value }); }
      this._emitProfileArgsChanged(next);
    }
  }

  private _onProfileMultiValueChange(id: string, index: number, value: string) {
    const entries = this.profileArgs.filter(a => a.id === id);
    const others = this.profileArgs.filter(a => a.id !== id);
    if (value.trim()) {
      entries[index] = { id, value };
    } else {
      entries.splice(index, 1);
    }
    this._emitProfileArgsChanged([...others, ...entries]);
  }

  private _onProfileMultiValueDelete(id: string, index: number) {
    const entries = this.profileArgs.filter(a => a.id === id);
    const others = this.profileArgs.filter(a => a.id !== id);
    entries.splice(index, 1);
    this._emitProfileArgsChanged([...others, ...entries]);
  }

  private _onProfileArgAdd(id: string) {
    // Don't add if already present (non-multi).
    const def = this._defFor(id);
    if (!def) { return; }
    if (!def.multi && this.profileArgs.some(a => a.id === id)) { return; }
    const entry: ArgValue = def.type === "bool"
      ? { id }
      : { id, value: def.defaultValue ?? "" };
    this._emitProfileArgsChanged([...this.profileArgs, entry]);
  }

  private _onProfileArgRemove(id: string) {
    this._emitProfileArgsChanged(this.profileArgs.filter(a => a.id !== id));
  }

  // ── Build-override handlers ───────────────────────────────────────────────

  private _onBuildOverride(id: string, value: string | undefined) {
    this.dispatchEvent(new RunnerArgUpdateEvent(id, value));
  }

  private _onBuildRemove(id: string) {
    this.dispatchEvent(new RunnerArgRemoveEvent(id));
  }

  private _onBuildAdd(id: string, value: string | undefined) {
    this.dispatchEvent(new RunnerArgAddEvent(id, value));
    this._addArgPickerOpen = false;
    this._addArgId = "";
    this._addArgValue = "";
  }

  private _onBuildReset() {
    this.dispatchEvent(new RunnerArgResetEvent());
  }

  // ── Render helpers ────────────────────────────────────────────────────────

  private _sourceBadge(source: "profile" | "yaml" | "build"): TemplateResult {
    const labels: Record<string, string> = {
      profile: "profile",
      yaml: "runners.yaml",
      build: "override",
    };
    return html`<span class="arg-source-badge arg-source-badge--${source}">${labels[source]}</span>`;
  }

  /** Render the input control appropriate for a given arg type and current value. */
  private _renderControl(
    def: ArgDef,
    currentValue: string | undefined,
    onChange: (value: string) => void,
    disabled = false,
  ): TemplateResult {
    switch (def.type) {
      case "bool":
        return html`
          <vscode-checkbox
            .checked=${currentValue === undefined ? false : true}
            ?disabled=${disabled}
            @change=${(e: Event) => onChange((e.target as HTMLInputElement).checked ? "1" : "")}>
          </vscode-checkbox>
        `;

      case "enum":
        return html`
          <vscode-single-select
            .value=${currentValue ?? ""}
            ?disabled=${disabled}
            @change=${(e: Event) => onChange((e.target as HTMLSelectElement).value)}>
            <vscode-option value="" ?selected=${!currentValue}>(default)</vscode-option>
            ${(def.enumOptions ?? []).map(opt => html`
              <vscode-option value=${opt} ?selected=${currentValue === opt}>${opt}</vscode-option>
            `)}
          </vscode-single-select>
        `;

      case "combo":
        return html`
          <vscode-textfield class="arg-control-input"
            list="datalist-${def.id}"
            .value=${currentValue ?? ""}
            placeholder=${def.defaultValue ?? ""}
            ?disabled=${disabled}
            @change=${(e: Event) => onChange((e.target as HTMLInputElement).value)}>
          </vscode-textfield>
          <datalist id="datalist-${def.id}">
            ${(def.suggestions ?? []).map(s => html`<option value=${s}></option>`)}
          </datalist>
        `;

      case "int":
        return html`
          <vscode-textfield class="arg-control-input arg-control-int"
            type="number"
            .value=${currentValue ?? ""}
            placeholder=${def.defaultValue ?? ""}
            ?disabled=${disabled}
            @change=${(e: Event) => onChange((e.target as HTMLInputElement).value)}>
          </vscode-textfield>
        `;

      case "path":
        return html`
          <vscode-textfield class="arg-control-input arg-control-path"
            .value=${currentValue ?? ""}
            placeholder=${def.defaultValue ?? "path…"}
            ?disabled=${disabled}
            @change=${(e: Event) => onChange((e.target as HTMLInputElement).value)}>
          </vscode-textfield>
        `;

      case "string":
      default:
        // Show datalist suggestions if available.
        if (def.suggestions?.length) {
          return html`
            <vscode-textfield class="arg-control-input"
              list="datalist-${def.id}"
              .value=${currentValue ?? ""}
              placeholder=${def.defaultValue ?? ""}
              ?disabled=${disabled}
              @change=${(e: Event) => onChange((e.target as HTMLInputElement).value)}>
            </vscode-textfield>
            <datalist id="datalist-${def.id}">
              ${def.suggestions.map(s => html`<option value=${s}></option>`)}
            </datalist>
          `;
        }
        return html`
          <vscode-textfield class="arg-control-input"
            .value=${currentValue ?? ""}
            placeholder=${def.defaultValue ?? ""}
            ?disabled=${disabled}
            @change=${(e: Event) => onChange((e.target as HTMLInputElement).value)}>
          </vscode-textfield>
        `;
    }
  }

  // -- Profile mode rendering ------------------------------------------------

  private _renderProfileMode(): TemplateResult {
    // Group args by schema group.
    const groups = this._groupBySchemaOrder();

    const renderArg = (def: ArgDef): TemplateResult => {
      if (def.multi) {
        const entries = this.profileArgs.filter(a => a.id === def.id);
        return html`
          <div class="arg-row arg-row--multi" data-id=${def.id}>
            <div class="arg-multi-header">
              <span class="arg-label" title=${def.description}>${def.label}</span>
              <span class="arg-west-flag">${def.west.flag}</span>
              <vscode-button appearance="secondary" icon="add" title="Add another value"
                @click=${() => this._onProfileArgAdd(def.id)}>
                Add
              </vscode-button>
            </div>
            ${entries.length > 0 ? html`
              <div class="arg-multi-values">
                ${entries.map((entry, idx) => html`
                  <div class="arg-multi-row">
                    ${this._renderControl(def, entry.value, (v) => this._onProfileMultiValueChange(def.id, idx, v))}
                    <vscode-button appearance="icon" icon="close" title="Remove"
                      @click=${() => this._onProfileMultiValueDelete(def.id, idx)}>
                    </vscode-button>
                  </div>
                `)}
              </div>
            ` : nothing}
          </div>
        `;
      }

      const current = this.profileArgs.find(a => a.id === def.id);
      const enabled = !!current;

      if (def.type === "bool") {
        return html`
          <div class="arg-row arg-row--bool" data-id=${def.id}>
            <label class="arg-row-bool-label" title=${def.description}>
              <vscode-checkbox
                .checked=${enabled}
                @change=${(e: Event) => this._onProfileBoolToggle(def.id, !!(e.currentTarget as { checked?: boolean })?.checked)}>
              </vscode-checkbox>
              <span class="arg-label">${def.label}</span>
              <span class="arg-west-flag">${def.west.flag}</span>
            </label>
          </div>
        `;
      }

      // Non-bool, non-multi: compact 2-column row (enable label | value input).
      // Value control is always shown; disabled when arg is not enabled.
      return html`
        <div class="arg-row" data-id=${def.id}>
          <label class="arg-row-enable" title=${def.description}>
            <vscode-checkbox
              .checked=${enabled}
              @change=${(e: Event) => {
          if (!!(e.currentTarget as { checked?: boolean })?.checked) {
            this._onProfileArgAdd(def.id);
          } else {
            this._onProfileArgRemove(def.id);
          }
        }}>
            </vscode-checkbox>
            <span class="arg-label">${def.label}</span>
            <span class="arg-west-flag">${def.west.flag}</span>
          </label>
          ${this._renderControl(def, current?.value, (v) => this._onProfileValueChange(def.id, v), !enabled)}
        </div>
      `;
    };

    return html`
      <div class="runner-args-editor runner-args-editor--profile">
        ${groups.map(group => html`
          ${group.label ? html`<div class="arg-group-label">${group.label}</div>` : nothing}
          ${group.defs.map(def => renderArg(def))}
        `)}
        ${this.schema.length === 0
        ? html`<p class="arg-editor-empty">No schema defined for runner "${this.runner}".</p>`
        : nothing}
      </div>
    `;
  }

  // -- Build-override mode rendering -----------------------------------------

  private _renderBuildOverrideMode(): TemplateResult {
    const hasAnyOverride = this.resolvedArgs.some(a => a.source === "build" || a.isRemoved);

    const renderEntry = (entry: WebviewArgEntry): TemplateResult => {
      const def = this._defFor(entry.id);
      const isRemovedStyle = entry.isRemoved ? "arg-row--removed" : "";

      if (entry.isRemoved) {
        return html`
          <div class="arg-row ${isRemovedStyle}" data-id=${entry.id}>
            <div class="arg-row-info">
              <span class="arg-label arg-label--strikethrough" title=${entry.description}>${entry.label}</span>
              <span class="arg-west-flag">${def?.west.flag ?? entry.id}</span>
              ${this._sourceBadge(entry.source)}
              <span class="arg-badge arg-badge--removed">removed</span>
            </div>
            <div class="arg-row-actions">
              <vscode-button appearance="icon" icon="redo" title="Restore this arg"
                @click=${() => {
            // Restoring a removed arg: send an "add" with the original value.
            this.dispatchEvent(new RunnerArgAddEvent(entry.id, entry.value));
          }}>
              </vscode-button>
            </div>
          </div>
        `;
      }

      const onChange = (v: string) => this._onBuildOverride(entry.id, v || undefined);

      // Bool args have no value to edit; show a simple "active" badge instead.
      const control = (entry.type === "bool")
        ? html`<span class="arg-bool-present">active</span>`
        : def
          ? this._renderControl(def, entry.value, onChange, entry.source !== "build")
          : html`<vscode-textfield class="arg-control-input" .value=${entry.value ?? ""} @change=${(e: Event) => onChange((e.target as HTMLInputElement).value)}></vscode-textfield>`;

      return html`
        <div class="arg-row" data-id=${entry.id}>
          <div class="arg-row-info">
            <span class="arg-label" title=${entry.description}>${entry.label}</span>
            <span class="arg-west-flag">${def?.west.flag ?? entry.id}</span>
            ${this._sourceBadge(entry.source)}
          </div>
          <div class="arg-row-control">
            ${control}
          </div>
          <div class="arg-row-actions">
            ${entry.source !== "build" && entry.type !== "bool"
          ? html`
                <vscode-button appearance="icon" icon="edit"
                  title="Override this arg value at build level"
                  @click=${() => this._onBuildOverride(entry.id, entry.value)}>
                </vscode-button>`
          : entry.source === "build" && entry.type !== "bool"
            ? html`
                <vscode-button appearance="icon" icon="discard"
                  title="Reset to profile/yaml value"
                  @click=${() => {
                // Remove the build-level override by dispatching an update with undefined.
                this.dispatchEvent(new RunnerArgUpdateEvent(entry.id, undefined));
              }}>
                </vscode-button>`
            : nothing}
            ${entry.canRemove
          ? html`
                <vscode-button appearance="icon" icon="trash"
                  title="Remove this arg for this build"
                  @click=${() => this._onBuildRemove(entry.id)}>
                </vscode-button>`
          : nothing}
          </div>
        </div>
      `;
    };

    // Available schema ids not yet in resolvedArgs (for "add" picker).
    const existingIds = new Set(this.resolvedArgs.map(a => a.id));
    const availableToAdd = this.schema.filter(d => !existingIds.has(d.id));

    return html`
      <div class="runner-args-editor runner-args-editor--build">
        ${this.resolvedArgs.length === 0
        ? html`<p class="arg-editor-empty">No structured args defined for this slot.</p>`
        : this.resolvedArgs.map(entry => renderEntry(entry))}

        <div class="arg-editor-footer">
          ${availableToAdd.length > 0 || this.schemaArgIds.length > 0
        ? html`
              <vscode-button appearance="secondary" icon="add"
                title="Add an arg for this build only"
                @click=${() => { this._addArgPickerOpen = !this._addArgPickerOpen; }}>
                Add Arg
              </vscode-button>
              ${this._addArgPickerOpen ? this._renderAddArgPicker(availableToAdd) : nothing}`
        : nothing}
          ${hasAnyOverride
        ? html`
              <vscode-button appearance="secondary" icon="discard"
                title="Reset all build-level arg overrides"
                @click=${() => this._onBuildReset()}>
                Reset All Overrides
              </vscode-button>`
        : nothing}
        </div>
      </div>
    `;
  }

  private _renderAddArgPicker(available: ArgDef[]): TemplateResult {
    const selectedDef = available.find(d => d.id === this._addArgId) ?? available[0];

    return html`
      <div class="add-arg-picker">
        <vscode-single-select
          .value=${this._addArgId || (available[0]?.id ?? "")}
          @change=${(e: Event) => {
        this._addArgId = (e.target as HTMLSelectElement).value;
        this._addArgValue = "";
      }}>
          ${available.map(d => html`
            <vscode-option value=${d.id} ?selected=${d.id === this._addArgId}
              title=${d.description}>
              ${d.label} (${d.west.flag})
            </vscode-option>
          `)}
        </vscode-single-select>
        ${selectedDef && selectedDef.type !== "bool"
        ? this._renderControl(
          selectedDef,
          this._addArgValue || selectedDef.defaultValue,
          (v) => { this._addArgValue = v; },
        )
        : nothing}
        <vscode-button
          ?disabled=${!this._addArgId && available.length === 0}
          @click=${() => {
        const id = this._addArgId || available[0]?.id;
        if (!id) { return; }
        this._onBuildAdd(id, this._addArgValue || undefined);
      }}>
          Add
        </vscode-button>
        <vscode-button appearance="icon" icon="close"
          @click=${() => { this._addArgPickerOpen = false; }}>
        </vscode-button>
      </div>
    `;
  }

  // -- Schema grouping -------------------------------------------------------

  private _groupBySchemaOrder(): Array<{ label: string | undefined; defs: ArgDef[] }> {
    const groups: Array<{ label: string | undefined; defs: ArgDef[] }> = [];
    let current: { label: string | undefined; defs: ArgDef[] } = { label: undefined, defs: [] };
    groups.push(current);

    for (const def of this.schema) {
      // Filter by slot.
      if (def.slots && !def.slots.includes(this.slot)) { continue; }

      if (def.group !== current.label) {
        if (current.defs.length === 0 && current.label === undefined) {
          // Re-use the empty ungrouped bucket.
          current.label = def.group;
        } else {
          current = { label: def.group, defs: [] };
          groups.push(current);
        }
      }
      current.defs.push(def);
    }

    return groups.filter(g => g.defs.length > 0);
  }

  // -- Main render -----------------------------------------------------------

  render() {
    if (this.mode === "profile") {
      return this._renderProfileMode();
    }
    return this._renderBuildOverrideMode();
  }
}
