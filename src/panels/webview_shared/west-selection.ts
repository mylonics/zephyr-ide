// SPDX-License-Identifier: Apache-2.0
import { html, type TemplateResult } from "lit";
import { panelText } from "./panel-text";

export type SelectionAction = "select" | "invert" | "clear";

export function westSelectionToolbar(disabled: boolean, apply: (action: SelectionAction) => void) {
  return html`<div class="west-selection-tools" role="group" aria-label=${panelText("Module selection")}>
    <button ?disabled=${disabled} @click=${() => apply("select")}>${panelText("Select all")}</button>
    <button ?disabled=${disabled} @click=${() => apply("invert")}>${panelText("Invert selection")}</button>
    <button ?disabled=${disabled} @click=${() => apply("clear")}>${panelText("Clear selection")}</button>
  </div>`;
}

export function westSelectionPane(id: string, title: string, count: number, content: TemplateResult, action?: TemplateResult) {
  return html`<section class="west-pane">
    <div class="west-pane-header"><h4 id=${id}>${title} <small>${count}</small></h4>${action}</div>
    <div class="west-pane-list" tabindex="0" role="region" aria-labelledby=${id}>${content}</div>
  </section>`;
}

export function changeSelection(current: Set<string>, names: string[], action: SelectionAction) {
  const result = new Set(current);
  for (const name of names) {
    if (action === "clear" || (action === "invert" && result.has(name))) { result.delete(name); }
    else { result.add(name); }
  }
  return result;
}
