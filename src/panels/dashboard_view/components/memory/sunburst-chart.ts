/*
Copyright 2026 mylonics
Author Rijesh Augustine
SPDX-License-Identifier: Apache-2.0
*/

import { html, svg, nothing, PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { ZephyrLitElement } from "../../../webview_shared/lit-base";
import {
  hierarchy,
  partition,
  type HierarchyRectangularNode,
} from "d3-hierarchy";
import { arc as d3arc } from "d3-shape";

import type { DashboardMemoryNode } from "../../dashboard-data";
import { nodeKey, formatBytes } from "./memory-utils";

interface ArcDatum {
  key: string;
  name: string;
  size: number;
  ancestors: string[];
  raw: DashboardMemoryNode;
  depth: number;
}

interface FocusRect {
  x0: number;
  x1: number;
  y0: number;
}

const PALETTE = [
  "#4f9cff",
  "#5bce6a",
  "#ff9f43",
  "#b07cff",
  "#ff6b6b",
  "#ffd93d",
  "#3ecbb8",
  "#e879b8",
];

@customElement("memory-sunburst")
export class MemorySunburst extends ZephyrLitElement {
  /** Root node (entire memory tree) for the active region (RAM/ROM/All). */
  @property({ attribute: false }) root: DashboardMemoryNode | undefined;
  /** Currently selected node key (for highlighting). */
  @property({ type: String }) selectedKey = "";
  /** Optional filter — keys to fade out (those NOT in the set). Empty = show all. */
  @property({ attribute: false }) visibleKeys: Set<string> | undefined;
  /** Region label shown at center when at root (e.g. "RAM", "ROM", "All"). */
  @property({ type: String }) regionLabel = "All";

  @state() private _focusKey = "";
  @state() private _hover: ArcDatum | null = null;
  @state() private _size = 360;
  @state() private _mx = 0;
  @state() private _my = 0;

  private _resizeObs?: ResizeObserver;

  connectedCallback() {
    super.connectedCallback();
    queueMicrotask(() => this._setupResizeObserver());
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._resizeObs?.disconnect();
  }

  protected updated(changed: PropertyValues): void {
    if (changed.has("root")) {
      // Reset focus to root when the data changes (region switch).
      this._focusKey = "";
    }
  }

  private _setupResizeObserver() {
    if (typeof ResizeObserver === "undefined") { return; }
    this._resizeObs = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = entry.contentRect.width;
        const next = Math.max(120, w);
        if (Math.abs(next - this._size) > 2) {
          this._size = next;
        }
      }
    });
    this._resizeObs.observe(this);
  }

  private _resetFocus() {
    this._focusKey = "";
    this.dispatchEvent(new CustomEvent("focus-reset", { bubbles: true, composed: true }));
  }

  private _arcPath(d: HierarchyRectangularNode<DashboardMemoryNode>, focus: FocusRect, radius: number, yScale: number): string {
    const x0 = Math.max(0, Math.min(1, (d.x0 - focus.x0) / (focus.x1 - focus.x0)));
    const x1 = Math.max(0, Math.min(1, (d.x1 - focus.x0) / (focus.x1 - focus.x0)));
    const y0 = Math.max(0, Math.min(1, (d.y0 - focus.y0) / (1 - focus.y0) * yScale));
    const y1 = Math.max(0, Math.min(1, (d.y1 - focus.y0) / (1 - focus.y0) * yScale));
    const arcGen = d3arc<unknown>()
      .startAngle(x0 * 2 * Math.PI)
      .endAngle(x1 * 2 * Math.PI)
      .innerRadius(y0 * radius)
      .outerRadius(Math.max(y0 * radius, y1 * radius - 1))
      .padAngle(0.005)
      .padRadius(radius / 2);
    return arcGen(null) ?? "";
  }

  private _colorFor(d: HierarchyRectangularNode<DashboardMemoryNode>): string {
    // Top-level child colors propagate to descendants for visual grouping.
    let cur: HierarchyRectangularNode<DashboardMemoryNode> = d;
    while (cur.depth > 1 && cur.parent) { cur = cur.parent; }
    const idx = cur.parent
      ? cur.parent.children?.indexOf(cur) ?? 0
      : 0;
    const base = PALETTE[idx % PALETTE.length];
    return base;
  }

  render() {
    if (!this.root) {
      return html`<div class="sunburst-empty"></div>`;
    }
    const size = this._size;
    const radius = size / 2;

    // Build d3 hierarchy. `value` accessor returns leaf size; d3 sums up.
    const h = hierarchy<DashboardMemoryNode>(this.root, (n) => n.children ?? [])
      .sum((n) => (n.children && n.children.length ? 0 : Math.max(0, n.data.size)))
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
    partition<DashboardMemoryNode>().size([1, 1])(h);
    const all = h.descendants() as HierarchyRectangularNode<DashboardMemoryNode>[];

    // Find focus node by key (computed from ancestor names).
    let focusNode: HierarchyRectangularNode<DashboardMemoryNode> = all[0];
    if (this._focusKey) {
      for (const n of all) {
        const ancestors = n.ancestors().reverse().slice(0, -1).map((a) => a.data.data.name);
        const key = nodeKey(ancestors, n.data);
        if (key === this._focusKey) { focusNode = n; break; }
      }
    }
    const focus: FocusRect = { x0: focusNode.x0, x1: focusNode.x1, y0: focusNode.y0 };

    // Filter visible arcs: include only descendants of the focus node within
    // a depth window for performance. yScale controls how many rings fill the
    // radius — higher = thicker rings (fewer levels visible at once).
    const yScale = 1.8;
    const maxDepth = focusNode.depth + Math.ceil(5 / yScale) + 1;
    const visible = all.filter((d) => {
      if (d === focusNode) { return false; }
      if (d.depth > maxDepth) { return false; }
      // Must be inside the focus angular range.
      return d.x1 > focus.x0 && d.x0 < focus.x1 && d.y0 >= focus.y0;
    });

    const totalVisibleSize = focusNode.value ?? 0;
    const hovered = this._hover;
    const hoveredPct = hovered && totalVisibleSize > 0
      ? (hovered.size * 100) / totalVisibleSize
      : 0;
    const isAtRoot = !this._focusKey;
    const rawCenter = focusNode.data.data.name;
    const centerName = isAtRoot
      ? this.regionLabel
      : (rawCenter.length > 22 ? rawCenter.slice(0, 20) + "\u2026" : rawCenter);
    const centerSize = focusNode.value ?? focusNode.data.data.size ?? 0;
    // The immediate children of the focus node start at this normalized inner
    // radius — use it for the donut hole so arcs never draw inside the circle.
    const holeR = Math.min(radius - 2, (focusNode.y1 - focusNode.y0) / (1 - focusNode.y0) * radius * yScale);
    const tipX = this._mx + 14;
    const tipY = this._my;

    return html`
      <div class="sunburst-svg-wrap"
        @mousemove=${this._onMouseMove}
        @mouseleave=${() => (this._hover = null)}
      >
        <svg
          viewBox="${-radius} ${-radius} ${size} ${size}"
          style="display:block;width:100%;height:auto;aspect-ratio:1"
          role="img"
          aria-label="Memory usage sunburst"
        >
          ${visible.map((d) => {
      const ancestors = d.ancestors().reverse().slice(0, -1).map((a) => a.data.data.name);
      const key = nodeKey(ancestors, d.data);
      const isSelected = key === this.selectedKey;
      const isFiltered = this.visibleKeys && !this.visibleKeys.has(key);
      const opacity = isFiltered ? 0.18 : isSelected ? 1 : 0.92;
      const color = this._colorFor(d);
      const datum: ArcDatum = {
        key,
        name: d.data.data.name,
        size: d.value ?? d.data.data.size,
        ancestors,
        raw: d.data,
        depth: d.depth,
      };
      return svg`<path
              d=${this._arcPath(d, focus, radius, yScale)}
              fill=${color}
              fill-opacity=${opacity}
              stroke=${isSelected ? "#007fd4" : "rgba(0,0,0,0.4)"}
              stroke-width=${isSelected ? 2 : 0.5}
              class="sunburst-arc ${isSelected ? "is-selected" : ""}"
              @mouseenter=${() => (this._hover = datum)}
              @click=${(e: MouseEvent) => this._onArcClick(e, datum)}
              @dblclick=${() => this._onArcDblClick(datum)}
            >
              <title>${ancestors.concat(datum.name).join(" / ")}\n${formatBytes(datum.size)}</title>
            </path>`;
    })}
          <!-- Center label / reset target -->
          <circle
            r=${holeR}
            fill="transparent"
            class="sunburst-center"
            @click=${() => this._resetFocus()}
          ></circle>
          <text
            text-anchor="middle"
            dy="-0.2em"
            font-size=${Math.min(12, Math.max(9, Math.round(radius * 0.065)))}
            class="sunburst-center-name"
            pointer-events="none"
          >${centerName.length > 22 ? centerName.slice(0, 20) + "…" : centerName}</text>
          <text
            text-anchor="middle"
            dy="1em"
            font-size=${Math.min(11, Math.max(8, Math.round(radius * 0.055)))}
            class="sunburst-center-size"
            pointer-events="none"
          >${formatBytes(centerSize)}</text>
        </svg>
        ${hovered ? html`<div class="sunburst-tooltip" style="left:${tipX}px;top:${tipY}px">
          <div class="sunburst-tooltip-path">${hovered.ancestors.concat(hovered.name).join(" \u203a ")}</div>
          <div class="sunburst-tooltip-meta">
            <span class="sunburst-tooltip-size">${formatBytes(hovered.size)}</span>
            <span class="sunburst-tooltip-pct">${hoveredPct.toFixed(1)}%</span>
          </div>
        </div>` : nothing}
      </div>
    `;
  }

  private _onMouseMove(e: MouseEvent) {
    this._mx = e.offsetX;
    this._my = e.offsetY;
  }

  private _onArcClick(e: MouseEvent, datum: ArcDatum) {
    e.stopPropagation();
    const isLeaf = !datum.raw.children || datum.raw.children.length === 0;
    // First emit selection so the tree can highlight + scroll to the row.
    this.dispatchEvent(new CustomEvent("arc-select", {
      detail: { key: datum.key },
      bubbles: true,
      composed: true,
    }));
    if (!isLeaf) {
      this._focusKey = datum.key;
    }
  }

  private _onArcDblClick(datum: ArcDatum) {
    const isLeaf = !datum.raw.children || datum.raw.children.length === 0;
    if (isLeaf && datum.raw.data.identifier) {
      this.dispatchEvent(new CustomEvent("arc-open", {
        detail: { identifier: datum.raw.data.identifier },
        bubbles: true,
        composed: true,
      }));
    }
  }

  /** Public API: drill into a specific node by key (used for tree → sunburst sync). */
  public focusKey(key: string) {
    this._focusKey = key;
  }

  public resetFocus() {
    this._focusKey = "";
  }
}
