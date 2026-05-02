/*
Copyright 2026 mylonics 
Author Rijesh Augustine
SPDX-License-Identifier: Apache-2.0
*/

import { html, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { ZephyrLitElement } from "../../webview_shared/lit-base";
import type { DashboardDts } from "../dashboard-data";

// ── Types ──────────────────────────────────────────────────────────────────

interface DtsNodeInfo {
  name: string;
  path: string;
  labels: string[];
  filename: string | null;
  lineno: number | null;
  compatible: string | null;
  status: string | null;
  children: DtsNodeInfo[];
}

// ── Parser ─────────────────────────────────────────────────────────────────

function parseDtsSource(source: string): DtsNodeInfo | null {
  // Match: /* node 'PATH' defined in FILE:LINENO */
  const re = /\/\* node '([^']+)' defined in ([^*:]+):(\d+) \*\//g;

  interface Meta {
    path: string;
    filename: string;
    lineno: number;
    commentIdx: number;
    commentEndIdx: number;
  }

  const metas: Meta[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    metas.push({
      path: m[1],
      filename: m[2].trim(),
      lineno: parseInt(m[3], 10),
      commentIdx: m.index,
      commentEndIdx: m.index + m[0].length,
    });
  }
  if (metas.length === 0) { return null; }

  // Build node objects
  const nodeMap = new Map<string, DtsNodeInfo>();
  for (const meta of metas) {
    const parts = meta.path === '/' ? [] : meta.path.split('/').filter(Boolean);
    const name = parts.length > 0 ? parts[parts.length - 1] : '/';
    nodeMap.set(meta.path, {
      name,
      path: meta.path,
      labels: [],
      filename: meta.filename,
      lineno: meta.lineno,
      compatible: null,
      status: null,
      children: [],
    });
  }

  // Connect parent → child
  for (const meta of metas) {
    if (meta.path === '/') { continue; }
    const lastSlash = meta.path.lastIndexOf('/');
    const parentPath = lastSlash <= 0 ? '/' : meta.path.substring(0, lastSlash);
    const parent = nodeMap.get(parentPath);
    const child = nodeMap.get(meta.path);
    if (parent && child) { parent.children.push(child); }
  }

  // Extract labels and key properties for each node
  for (const meta of metas) {
    const node = nodeMap.get(meta.path)!;

    // The declaration sits between the comment end and the opening brace
    const braceIdx = source.indexOf('{', meta.commentEndIdx);
    if (braceIdx < 0) { continue; }

    const decl = source.substring(meta.commentEndIdx, braceIdx);
    // Labels look like "label:" identifiers before the node name
    const labelRe = /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g;
    let lm: RegExpExecArray | null;
    while ((lm = labelRe.exec(decl)) !== null) { node.labels.push(lm[1]); }

    // Property section ends where the first direct child comment starts
    const childMetas = metas.filter(cm => {
      if (cm.path === meta.path) { return false; }
      const cmLastSlash = cm.path.lastIndexOf('/');
      const cmParent = cmLastSlash <= 0 ? '/' : cm.path.substring(0, cmLastSlash);
      return cmParent === meta.path && cm.commentIdx > braceIdx;
    });

    let propEnd: number;
    if (childMetas.length > 0) {
      propEnd = Math.min(...childMetas.map(cm => cm.commentIdx));
    } else {
      // Leaf node — find matching closing brace
      propEnd = source.length;
      let depth = 0;
      for (let i = braceIdx; i < source.length; i++) {
        const ch = source[i];
        if (ch === '"') {
          i++;
          while (i < source.length && source[i] !== '"') {
            if (source[i] === '\\') { i++; }
            i++;
          }
        } else if (ch === '{') {
          depth++;
        } else if (ch === '}') {
          if (--depth === 0) { propEnd = i; break; }
        }
      }
    }

    const props = source.substring(braceIdx + 1, propEnd);
    const compatM = props.match(/\bcompatible\s*=\s*"([^"]+)"/);
    if (compatM) { node.compatible = compatM[1]; }
    const statusM = props.match(/\bstatus\s*=\s*"([^"]+)"/);
    if (statusM) { node.status = statusM[1]; }
  }

  return nodeMap.get('/') ?? null;
}

// ── Component ──────────────────────────────────────────────────────────────

@customElement("dts-page")
export class DtsPage extends ZephyrLitElement {
  @property({ attribute: false }) data!: DashboardDts;

  @state() private _activeTab: 'browser' | 'source' = 'browser';
  @state() private _expanded = new Set<string>(['/']);
  @state() private _tree: DtsNodeInfo | null = null;

  override updated(changed: Map<PropertyKey, unknown>) {
    super.updated(changed);
    if (changed.has('data')) {
      this._tree = this.data?.source ? parseDtsSource(this.data.source) : null;
      this._expanded = new Set(['/']);
    }
  }

  private _toggle(path: string) {
    const next = new Set(this._expanded);
    if (next.has(path)) { next.delete(path); } else { next.add(path); }
    this._expanded = next;
  }

  private _openSource(filename: string | null, lineno: number | null) {
    if (!filename) { return; }
    this.dispatchEvent(new CustomEvent('open-symbol', {
      detail: { path: filename, line: lineno ?? undefined },
      bubbles: true,
      composed: true,
    }));
  }

  /** Recursively build a flat array of <tr> TemplateResults for the tbody. */
  private _rows(node: DtsNodeInfo, depth: number): TemplateResult[] {
    const expanded = this._expanded.has(node.path);
    const hasKids = node.children.length > 0;
    const pl = 4 + depth * 20;
    const base = node.filename?.replace(/\\/g, '/').split('/').pop() ?? null;

    const row = html`
      <tr class="dts-node-row${node.status === 'disabled' ? ' dts-row-disabled' : ''}">
        <td style="padding-left:${pl}px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:${hasKids ? 'pointer' : 'default'}"
            @click=${hasKids ? () => this._toggle(node.path) : null}>
          ${hasKids
            ? html`<span class="tt-chevron codicon ${expanded ? 'codicon-chevron-down' : 'codicon-chevron-right'}" aria-hidden="true"></span>`
            : html`<span class="tt-chevron tt-chevron-empty" aria-hidden="true"></span>`}
          <span class="dts-node-name">${node.name}</span
          >${node.labels.map(l => html`<code class="dts-label">${l}</code>`)}
        </td>
        <td class="dts-compat">
          ${node.compatible ? html`<code>${node.compatible}</code>` : nothing}
        </td>
        <td class="dts-status-cell">
          ${node.status
            ? html`<span class="dts-badge dts-badge-${node.status === 'okay' ? 'ok' : 'dis'}">${node.status}</span>`
            : nothing}
        </td>
        <td class="dts-src">
          ${base
            ? html`<button
                class="link-button"
                title="${node.filename ?? ''}:${node.lineno ?? ''}"
                @click=${() => this._openSource(node.filename, node.lineno)}
              >${base}:${node.lineno}</button>`
            : nothing}
        </td>
      </tr>`;

    const result: TemplateResult[] = [row];
    if (expanded && hasKids) {
      for (const child of node.children) {
        result.push(...this._rows(child, depth + 1));
      }
    }
    return result;
  }

  render() {
    if (!this.data) { return nothing; }

    return html`
      <h1>Device Tree</h1>
      <p class="dts-path"><code>${this.data.sourcePath}</code></p>

      ${this._renderDtsSourceFiles()}

      <div class="dts-tabs">
        <button class="dts-tab${this._activeTab === 'browser' ? ' dts-tab-active' : ''}"
          @click=${() => { this._activeTab = 'browser'; }}>Browser</button>
        <button class="dts-tab${this._activeTab === 'source' ? ' dts-tab-active' : ''}"
          @click=${() => { this._activeTab = 'source'; }}>Source</button>
      </div>

      ${this._activeTab === 'browser' ? this._renderBrowser() : this._renderSource()}
    `;
  }

  private _renderDtsSourceFiles(): TemplateResult | typeof nothing {
    const raw = this.data?.sourceFiles;
    if (!raw || raw.length === 0) { return nothing; }
    // Deduplicate while preserving order.
    const seen = new Set<string>();
    const files = raw.filter((f) => {
      const k = f.replace(/\\/g, "/").toLowerCase();
      if (seen.has(k)) { return false; }
      seen.add(k);
      return true;
    });
    return html`
      <details class="source-files-panel">
        <summary class="source-files-heading">
          <span class="codicon codicon-file-text" aria-hidden="true"></span>
          Device tree sources
          <span class="source-files-count">(${files.length})</span>
        </summary>
        <ul class="source-files-list">
          ${files.map((f) => {
            const display = f.replace(/\\/g, '/').split('/').slice(-2).join('/');
            return html`
              <li class="source-files-item" title="${f}">
                <span class="codicon codicon-file" aria-hidden="true"></span>
                <button class="link-button" @click=${() => this._openSource(f, null)}>${display}</button>
              </li>
            `;
          })}
        </ul>
      </details>
    `;
  }

  private _renderBrowser() {
    if (!this._tree) {
      return html`<p class="text-muted">No device tree data available.</p>`;
    }
    return html`
      <div class="dts-tree-wrap">
        <table class="dashboard-table dts-tree-table">
          <colgroup>
            <col>
            <col style="width:240px">
            <col style="width:76px">
            <col style="width:180px">
          </colgroup>
          <thead>
            <tr>
              <th>Node</th>
              <th>Compatible</th>
              <th>Status</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            ${this._rows(this._tree, 0)}
          </tbody>
        </table>
      </div>
    `;
  }

  private _renderSource() {
    return this.data.source
      ? html`<pre class="text-viewer">${this.data.source}</pre>`
      : html`<p class="text-muted">No device tree source available.</p>`;
  }
}
