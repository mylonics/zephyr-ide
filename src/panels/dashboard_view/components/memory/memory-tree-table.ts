/*
Copyright 2026 mylonics
Author Rijesh Augustine
SPDX-License-Identifier: Apache-2.0
*/

import { html, nothing, PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { ZephyrLitElement } from "../../../webview_shared/lit-base";

import type { DashboardMemoryNode } from "../../dashboard-data";
import {
  ancestorKeys,
  filterKeys,
  nodeKey,
  parentKey,
  sortTree,
  type SortDir,
  type SortKey,
} from "./memory-utils";

interface FlatRow {
  key: string;
  ancestors: string[];
  node: DashboardMemoryNode;
  depth: number;
  hasChildren: boolean;
  pct: number;
}

@customElement("memory-tree-table")
export class MemoryTreeTable extends ZephyrLitElement {
  @property({ attribute: false }) tree: DashboardMemoryNode[] = [];
  @property({ type: Number }) total = 0;
  @property({ type: String }) selectedKey = "";
  @property({ type: String }) query = "";

  @state() private _sortKey: SortKey = "size";
  @state() private _sortDir: SortDir = "desc";
  @state() private _expanded: Set<string> = new Set();

  protected updated(changed: PropertyValues): void {
    if (changed.has("tree")) {
      // On data change, expand the first level by default.
      const next = new Set<string>();
      for (const n of this.tree) {
        next.add(nodeKey([], n));
      }
      this._expanded = next;
    }
    if (changed.has("selectedKey") && this.selectedKey) {
      // Auto-expand ancestors so the selected row is visible.
      const expanded = new Set(this._expanded);
      for (const k of ancestorKeys(this.selectedKey)) {
        expanded.add(k);
      }
      if (expanded.size !== this._expanded.size) {
        this._expanded = expanded;
      }
      // Scroll the row into view next frame.
      requestAnimationFrame(() => {
        const row = this.querySelector(`[data-key="${cssEscape(this.selectedKey)}"]`) as HTMLElement | null;
        if (row && typeof row.scrollIntoView === "function") {
          row.scrollIntoView({ block: "nearest", behavior: "smooth" });
        }
      });
    }
  }

  private _toggleExpand(key: string) {
    const next = new Set(this._expanded);
    if (next.has(key)) { next.delete(key); } else { next.add(key); }
    this._expanded = next;
  }

  private _setSort(key: SortKey) {
    if (this._sortKey === key) {
      this._sortDir = this._sortDir === "asc" ? "desc" : "asc";
    } else {
      this._sortKey = key;
      this._sortDir = key === "name" ? "asc" : "desc";
    }
  }

  private _onRowClick(row: FlatRow, evt: MouseEvent) {
    // Click on chevron just toggles; click elsewhere selects.
    const target = evt.target as HTMLElement;
    if (target.closest(".tt-chevron")) {
      this._toggleExpand(row.key);
      return;
    }
    this.dispatchEvent(new CustomEvent("row-select", {
      detail: { key: row.key },
      bubbles: true,
      composed: true,
    }));
    if (row.hasChildren) {
      this._toggleExpand(row.key);
    }
  }

  private _onRowDblClick(row: FlatRow) {
    // Double-click focuses the sunburst chart on this node.
    this.dispatchEvent(new CustomEvent("row-drill", {
      detail: { key: row.key },
      bubbles: true,
      composed: true,
    }));
  }

  private _onIconClick(e: MouseEvent, row: FlatRow) {
    e.stopPropagation();
    const id = row.node.data.identifier;
    if (id) {
      this.dispatchEvent(new CustomEvent("row-open", {
        detail: { identifier: id },
        bubbles: true,
        composed: true,
      }));
    }
  }

  private _onKeydown(evt: KeyboardEvent, row: FlatRow, rows: FlatRow[]) {
    const idx = rows.indexOf(row);
    switch (evt.key) {
      case "ArrowDown": {
        evt.preventDefault();
        const next = rows[Math.min(rows.length - 1, idx + 1)];
        if (next) { this._select(next); }
        break;
      }
      case "ArrowUp": {
        evt.preventDefault();
        const prev = rows[Math.max(0, idx - 1)];
        if (prev) { this._select(prev); }
        break;
      }
      case "ArrowRight":
        if (row.hasChildren && !this._expanded.has(row.key)) {
          evt.preventDefault();
          this._toggleExpand(row.key);
        }
        break;
      case "ArrowLeft":
        if (row.hasChildren && this._expanded.has(row.key)) {
          evt.preventDefault();
          this._toggleExpand(row.key);
        } else {
          const pk = parentKey(row.key);
          if (pk) {
            evt.preventDefault();
            this.dispatchEvent(new CustomEvent("row-select", { detail: { key: pk }, bubbles: true, composed: true }));
          }
        }
        break;
      case "Enter":
      case " ":
        evt.preventDefault();
        this._onRowClick(row, evt as unknown as MouseEvent);
        break;
    }
  }

  private _select(row: FlatRow) {
    this.dispatchEvent(new CustomEvent("row-select", {
      detail: { key: row.key },
      bubbles: true,
      composed: true,
    }));
    requestAnimationFrame(() => {
      const el = this.querySelector(`[data-key="${cssEscape(row.key)}"]`) as HTMLElement | null;
      el?.focus();
    });
  }

  private _flatten(): { rows: FlatRow[]; visibleKeys?: Set<string> } {
    const sorted = sortTree(this.tree, this._sortKey, this._sortDir, this.total);
    const filterSet = this.query ? filterKeys(sorted, this.query) : undefined;
    const rows: FlatRow[] = [];
    const walk = (
      arr: DashboardMemoryNode[],
      ancestors: string[],
      depth: number,
    ) => {
      for (const n of arr) {
        const key = nodeKey(ancestors, n);
        if (filterSet && !filterSet.has(key)) { continue; }
        const hasChildren = !!(n.children && n.children.length);
        rows.push({
          key,
          ancestors,
          node: n,
          depth,
          hasChildren,
          pct: this.total > 0 ? (n.data.size * 100) / this.total : 0,
        });
        if (hasChildren && this._expanded.has(key)) {
          walk(n.children!, [...ancestors, n.data.name], depth + 1);
        }
      }
    };
    walk(sorted, [], 0);
    return { rows, visibleKeys: filterSet };
  }

  private _renderHeader() {
    const arrow = (k: SortKey) => {
      if (this._sortKey !== k) { return html`<span class="tt-sort-icon"></span>`; }
      return html`<span class="tt-sort-icon codicon ${this._sortDir === "asc" ? "codicon-arrow-up" : "codicon-arrow-down"}"></span>`;
    };
    return html`
      <div class="tt-header" role="row">
        <button class="tt-th tt-th-name" role="columnheader" @click=${() => this._setSort("name")}>
          Symbol ${arrow("name")}
        </button>
        <button class="tt-th tt-th-size" role="columnheader" @click=${() => this._setSort("size")}>
          Size ${arrow("size")}
        </button>
        <button class="tt-th tt-th-pct" role="columnheader" @click=${() => this._setSort("pct")}>
          % ${arrow("pct")}
        </button>
        <div class="tt-th tt-th-region" role="columnheader">Region</div>
      </div>
    `;
  }

  private _renderRow(row: FlatRow, rows: FlatRow[]) {
    const expanded = this._expanded.has(row.key);
    const selected = row.key === this.selectedKey;
    const indent = row.depth * 10;
    const tags = (row.node.data.memoryType ?? []).map(
      (t) => html`<span class="tt-pill">${t}</span>`,
    );
    const barW = Math.min(100, Math.max(0.4, row.pct)).toFixed(1);
    const pctLabel = row.pct < 0.1 ? "<0.1%" : `${row.pct.toFixed(1)}%`;
    const nameHtml = highlightMatch(row.node.data.name, this.query);

    return html`
      <div
        class="tt-row ${selected ? "is-selected" : ""}"
        role="row"
        tabindex=${selected ? 0 : -1}
        data-key=${row.key}
        @click=${(e: MouseEvent) => this._onRowClick(row, e)}
        @dblclick=${() => this._onRowDblClick(row)}
        @keydown=${(e: KeyboardEvent) => this._onKeydown(e, row, rows)}
      >
        <div class="tt-cell tt-cell-name" style="padding-left:${indent}px">
          ${row.hasChildren
        ? html`<span class="tt-chevron codicon ${expanded ? "codicon-chevron-down" : "codicon-chevron-right"}" aria-hidden="true"></span>`
        : html`<span class="tt-chevron tt-chevron-empty" aria-hidden="true"></span>`}
          <span class="tt-name" title=${row.node.data.name}>${nameHtml}</span>
          ${row.node.data.identifier && looksLikeSourceFile(row.node.data.identifier)
        ? html`<span
              class="tt-link-icon codicon codicon-go-to-file"
              title="Open: ${row.node.data.identifier}"
              @click=${(e: MouseEvent) => this._onIconClick(e, row)}
            ></span>`
        : nothing}
        </div>
        <div class="tt-cell tt-cell-size">
          <span class="tt-bar-wrap"><span class="tt-bar" style="width:${barW}%"></span></span>
          <span class="tt-size">${row.node.data.displaySize}</span>
        </div>
        <div class="tt-cell tt-cell-pct">${pctLabel}</div>
        <div class="tt-cell tt-cell-region">${tags.length ? tags : nothing}</div>
      </div>
    `;
  }

  render() {
    const { rows } = this._flatten();
    return html`
      <div class="memory-tree-table" role="table">
        ${this._renderHeader()}
        <div class="tt-body" role="rowgroup">
          ${rows.length === 0
        ? html`<div class="tt-empty">No symbols match the filter.</div>`
        : rows.map((r) => this._renderRow(r, rows))}
        </div>
      </div>
    `;
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** Returns true when the identifier looks like an openable source file path. */
function looksLikeSourceFile(id: string): boolean {
  const last = id.split(/[\/\\]/).pop() ?? "";
  return /\.(?:c|cc|cpp|cxx|h|hpp|hxx|s|S|asm|py|rs|go|cmake|kconfig)$/i.test(last);
}

function cssEscape(s: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(s);
  }
  return s.replace(/(["\\])/g, "\\$1");
}

function highlightMatch(text: string, query: string): unknown {
  if (!query) { return text; }
  const i = text.toLowerCase().indexOf(query.toLowerCase());
  if (i === -1) { return text; }
  return html`${text.slice(0, i)}<mark class="tt-mark">${text.slice(i, i + query.length)}</mark>${text.slice(i + query.length)}`;
}
