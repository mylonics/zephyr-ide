// SPDX-License-Identifier: Apache-2.0
import { html } from "lit";
import { live } from "lit/directives/live.js";
import { panelText as t } from "./panel-text";

export function moduleMatcher(query: string, regex: boolean) {
  const term = query.trim();
  if (regex) {
    try {
      const expression = new RegExp(term, "i");
      return { matches: (value: string) => expression.test(value), invalid: false };
    } catch {
      return { matches: () => false, invalid: true };
    }
  }
  const needle = term.toLowerCase();
  const matches = (value: string) => {
    const haystack = value.toLowerCase();
    let start = 0;
    for (const letter of needle) {
      const index = haystack.indexOf(letter, start);
      if (index === -1) {
        return false;
      }
      start = index + 1;
    }
    return true;
  };
  return { matches, invalid: false };
}

export function moduleSearchBox(query: string, regex: boolean, input: (value: string) => void, toggle: () => void) {
  return html`<div class="module-search west-selection-tools">
    <input type="search" aria-label=${regex ? t("Search by regular expression") : t("Fuzzy search by module name")}
      placeholder=${regex ? "^hal_(x|st).*" : t("Fuzzy search by module name")}
      .value=${live(query)} @input=${(e: Event) => input((e.target as HTMLInputElement).value)}>
    <button type="button" aria-pressed=${regex} aria-label=${t("Regular expression")}
      title=${t("Regular expression")} @click=${toggle}>${t("Regular expression")}</button>
  </div>`;
}
