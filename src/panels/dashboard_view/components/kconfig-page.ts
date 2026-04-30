/*
Copyright 2026 mylonics
Author Rijesh Augustine
SPDX-License-Identifier: Apache-2.0
*/

import { html, nothing, TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { ZephyrLitElement } from "../../webview_shared/lit-base";
import type { DashboardKconfigEntry } from "../dashboard-data";

/**
 * Kconfig dashboard page — kconfiglib-backed two-pane editor.
 *
 * Architecture
 * ------------
 * Driven by the `KconfigSession` JSON-RPC bridge (see
 * `src/build_data/kconfig-session.ts`).  On mount the page asks the extension
 * for the menu tree (`kconfigTree`); the extension lazily spawns a Python
 * helper that wraps kconfiglib and returns a hierarchical node tree.  When
 * the user toggles a symbol the page issues `kconfigSet`; the response lists
 * every cascading change so the visible rows can be patched without a full
 * re-render.  When the user clicks a symbol the page issues `kconfigSymbol`
 * to populate the right-hand detail panel (help, defaults, ranges,
 * dependencies, defining files).
 *
 * Fallback
 * --------
 * If the session fails to start (no kconfiglib in venv, helper missing, or
 * Kconfig parse error) the page degrades to a flat read-only/edit table over
 * the `entries` slice from the dashboard JSON, preserving the Phase 1A
 * "save fragment" workflow.
 *
 * Phase 2 features
 * ----------------
 * - Hidden-symbol toggle (`visible` flag from helper).
 * - Choice groups rendered as a single radio cluster.
 * - Range/assignable validation in the value editor.
 * - "Changes" view with per-row reset.
 * - Direct dependencies clickable to jump within the tree.
 * - Defining-file links open the source in an editor (best-effort).
 */

// ---------------------------------------------------------------------------
// Wire types - mirror the helper response shapes (see kconfig-session.ts).
// ---------------------------------------------------------------------------

interface KconfigNode {
  id: number;
  prompt: string;
  name: string;
  type: string;
  value: string;
  visible: boolean;
  is_menu: boolean;
  is_choice: boolean;
  is_symbol: boolean;
  children?: KconfigNode[];
}

interface KconfigSymbolDetail {
  name: string;
  type: string;
  prompt: string;
  help: string;
  value: string;
  user_value: string | number | null;
  visible: boolean;
  assignable_values: number[];
  direct_dependencies: string;
  defaults: { value: string; cond: string }[];
  ranges: { low: string; high: string; cond: string }[];
  defining_files: { filename: string; linenr: number; prompt: string }[];
  is_constant: boolean;
  choice: string | null;
}

interface KconfigChangeRow { name: string; old: string; new: string; }

interface KconfigSearchHit {
  name: string;
  prompt: string;
  type: string;
  value: string;
  visible: boolean;
  matched_help: boolean;
  rank: number;
}

/** Persisted webview state (vscodeApi.setState).  Restored across reloads of
 * the dashboard panel - per-panel scope, so each (project, build) keeps its
 * own UI state. */
interface PersistedState {
  expanded?: number[];
  selectedName?: string;
  showHidden?: boolean;
  searchHelp?: boolean;
  viewMode?: ViewMode;
  history?: string[];
  historyIndex?: number;
}

type SaveStatus =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; path: string }
  | { kind: "error"; message: string };

type ViewMode = "tree" | "changes";

@customElement("kconfig-page")
export class KconfigPage extends ZephyrLitElement {
  /** Optional fallback entries from the dashboard JSON used only when the
   * Python session is unavailable. */
  @property({ attribute: false }) entries?: DashboardKconfigEntry[];

  // --- Session-mode state --------------------------------------------------
  @state() private _treeRoot?: KconfigNode;
  @state() private _treeError?: string;
  @state() private _loading = true;
  @state() private _selectedName?: string;
  @state() private _selectedDetail?: KconfigSymbolDetail;
  @state() private _selectedDetailLoading = false;
  @state() private _changes: KconfigChangeRow[] = [];
  @state() private _viewMode: ViewMode = "tree";
  @state() private _showHidden = false;
  @state() private _filter = "";
  /** Whether the filter input runs the helper-side `search` (incl. help body)
   * instead of the cheap client-side prompt/name match. */
  @state() private _searchHelp = false;
  /** Pending search results when `_searchHelp` is on (or filter is empty). */
  @state() private _searchHits?: KconfigSearchHit[];
  @state() private _searchTruncated = false;
  private _searchDebounce?: ReturnType<typeof setTimeout>;
  @state() private _saveStatus: SaveStatus = { kind: "idle" };
  /** Set of node ids whose children are visually expanded. */
  @state() private _expanded: Set<number> = new Set();
  /** Symbol selection history for back/forward navigation. */
  @state() private _history: string[] = [];
  @state() private _historyIndex = -1;

  // --- Fallback (Phase 1A) state ------------------------------------------
  @state() private _fallbackEdits: Record<string, string> = {};
  @state() private _fallbackShowOnlyModified = false;

  /** Resolves to the fallback flat-table mode when the session fails. */
  @state() private _useFallback = false;

  /** Pending in-flight requestId -> resolver. */
  private _requestSeq = 1;
  private _pending = new Map<number, {
    resolve: (v: unknown) => void;
    reject: (e: Error) => void;
  }>();

  connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener("message", this._onMessage);
    window.addEventListener("keydown", this._onKeydown);
    this._restoreState();
    void this._bootstrap();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener("message", this._onMessage);
    window.removeEventListener("keydown", this._onKeydown);
  }

  /** Persist UI-only state via the VS Code webview state API.  Survives
   * panel reloads (retainContextWhenHidden + reload) but not panel close. */
  private _persistState(): void {
    const state: PersistedState = {
      expanded: Array.from(this._expanded),
      selectedName: this._selectedName,
      showHidden: this._showHidden,
      searchHelp: this._searchHelp,
      viewMode: this._viewMode,
      history: this._history,
      historyIndex: this._historyIndex,
    };
    try { this.vscodeApi.setState(state); } catch { /* best-effort */ }
  }

  private _restoreState(): void {
    let s: PersistedState | undefined;
    try { s = this.vscodeApi.getState() as PersistedState | undefined; } catch { /* ignore */ }
    if (!s) { return; }
    if (Array.isArray(s.expanded)) { this._expanded = new Set(s.expanded); }
    if (typeof s.showHidden === "boolean") { this._showHidden = s.showHidden; }
    if (typeof s.searchHelp === "boolean") { this._searchHelp = s.searchHelp; }
    if (s.viewMode === "tree" || s.viewMode === "changes") { this._viewMode = s.viewMode; }
    if (Array.isArray(s.history)) { this._history = s.history; }
    if (typeof s.historyIndex === "number") { this._historyIndex = s.historyIndex; }
    if (typeof s.selectedName === "string") { this._selectedName = s.selectedName; }
  }

  /** Updates whose property change should write through to webview state. */
  protected updated(changed: Map<string, unknown>): void {
    super.updated?.(changed);
    const persistKeys = [
      "_expanded", "_selectedName", "_showHidden", "_searchHelp",
      "_viewMode", "_history", "_historyIndex",
    ];
    if (persistKeys.some((k) => changed.has(k))) { this._persistState(); }
  }

  /** Alt+Left/Right navigate history; Esc clears the filter. */
  private _onKeydown = (e: KeyboardEvent) => {
    if (e.altKey && e.key === "ArrowLeft") {
      e.preventDefault();
      void this._historyBack();
    } else if (e.altKey && e.key === "ArrowRight") {
      e.preventDefault();
      void this._historyForward();
    } else if (e.key === "Escape" && this._filter) {
      this._filter = "";
      this._searchHits = undefined;
    }
  };

  // ------------------------------------------------------------------
  // Message protocol (request/response over postMessage with requestId)
  // ------------------------------------------------------------------

  private _onMessage = (event: MessageEvent) => {
    const msg = event.data;
    if (!msg || typeof msg.command !== "string") { return; }

    // Phase 1A fallback save reply.
    if (msg.command === "kconfigSaveResult") {
      this._handleFallbackSaveReply(msg);
      return;
    }

    // Generic kconfig*Result responses keyed by requestId.
    if (msg.command.endsWith("Result") && typeof msg.requestId === "number") {
      const pending = this._pending.get(msg.requestId);
      if (!pending) { return; }
      this._pending.delete(msg.requestId);
      if (msg.ok) {
        pending.resolve(msg.result);
      } else {
        pending.reject(new Error(typeof msg.error === "string" ? msg.error : "Unknown error"));
      }
    }
  };

  private _request<T>(command: string, payload: Record<string, unknown> = {}): Promise<T> {
    const requestId = this._requestSeq++;
    return new Promise<T>((resolve, reject) => {
      this._pending.set(requestId, {
        resolve: resolve as (v: unknown) => void,
        reject,
      });
      this.vscodeApi.postMessage({ command, requestId, ...payload });
    });
  }

  // ------------------------------------------------------------------
  // Bootstrap
  // ------------------------------------------------------------------

  private async _bootstrap(): Promise<void> {
    this._loading = true;
    try {
      const result = await this._request<{ top_menu: KconfigNode }>("kconfigTree");
      this._treeRoot = result.top_menu;
      this._treeError = undefined;
      this._useFallback = false;
      // Auto-expand the top level on first load (no persisted expansion).
      if (this._expanded.size === 0 && this._treeRoot.children) {
        const next = new Set<number>();
        for (const child of this._treeRoot.children) {
          if (this._isMenuLike(child)) { next.add(child.id); }
        }
        this._expanded = next;
      }
      // Restore selection detail if a symbol was persisted from a previous session.
      if (this._selectedName) {
        void this._loadDetail(this._selectedName);
      }
      void this._refreshChanges();
    } catch (e) {
      this._treeError = e instanceof Error ? e.message : String(e);
      this._useFallback = !!this.entries;
    } finally {
      this._loading = false;
    }
  }

  private async _refreshChanges(): Promise<void> {
    try {
      const result = await this._request<{ changes: KconfigChangeRow[] }>("kconfigDiff");
      this._changes = result.changes ?? [];
    } catch {
      // best-effort
    }
  }

  /** Debounce-schedule a helper-side search.  Only fires when `_searchHelp`
   * is on; otherwise the cheap client-side prompt/name match is used. */
  private _scheduleSearch(): void {
    if (this._searchDebounce) { clearTimeout(this._searchDebounce); }
    if (!this._searchHelp || !this._filter) {
      this._searchHits = undefined;
      this._searchTruncated = false;
      return;
    }
    const query = this._filter;
    this._searchDebounce = setTimeout(() => { void this._runSearch(query); }, 200);
  }

  private async _runSearch(query: string): Promise<void> {
    try {
      const r = await this._request<{ hits: KconfigSearchHit[]; truncated?: boolean }>(
        "kconfigSearch",
        { query, includeHelp: true, includeHidden: this._showHidden, limit: 200 },
      );
      // Race guard: ignore stale results if the user kept typing.
      if (this._filter !== query) { return; }
      this._searchHits = r.hits;
      this._searchTruncated = !!r.truncated;
    } catch {
      // best-effort - leave _searchHits untouched
    }
  }

  // ------------------------------------------------------------------
  // Tree mutation helpers
  // ------------------------------------------------------------------

  private _isMenuLike(n: KconfigNode): boolean {
    return n.is_menu || n.is_choice || !!(n.children && n.children.length);
  }

  /** Patch every node in the tree whose `name` is in the `byName` map. */
  private _patchTreeValues(byName: Map<string, string>): void {
    if (!this._treeRoot) { return; }
    const walk = (n: KconfigNode) => {
      if (n.name && byName.has(n.name)) {
        n.value = byName.get(n.name) ?? n.value;
      }
      if (n.children) { for (const c of n.children) { walk(c); } }
    };
    walk(this._treeRoot);
    // Force a re-render: the @state tree is mutated in place but Lit only
    // re-renders on identity change.
    this._treeRoot = { ...this._treeRoot };
  }

  /** Find a symbol node by name (DFS).  Used for clickable dep links. */
  private _findNodeByName(name: string): KconfigNode | undefined {
    if (!this._treeRoot) { return undefined; }
    const stack: KconfigNode[] = [this._treeRoot];
    while (stack.length) {
      const n = stack.pop()!;
      if (n.name === name) { return n; }
      if (n.children) { for (const c of n.children) { stack.push(c); } }
    }
    return undefined;
  }

  /** Expand all ancestors of a node so it becomes visible. */
  private _revealNode(target: KconfigNode): void {
    if (!this._treeRoot) { return; }
    const next = new Set(this._expanded);
    const path: KconfigNode[] = [];
    const walk = (n: KconfigNode): boolean => {
      if (n.id === target.id) { return true; }
      if (n.children) {
        for (const c of n.children) {
          path.push(n);
          if (walk(c)) { return true; }
          path.pop();
        }
      }
      return false;
    };
    walk(this._treeRoot);
    for (const a of path) { next.add(a.id); }
    this._expanded = next;
  }

  // ------------------------------------------------------------------
  // Symbol set / select
  // ------------------------------------------------------------------

  private async _setSymbol(name: string, value: string): Promise<void> {
    try {
      const result = await this._request<{ changed: KconfigChangeRow[] }>("kconfigSet", {
        name,
        value,
      });
      const byName = new Map<string, string>();
      for (const c of result.changed) { byName.set(c.name, c.new); }
      this._patchTreeValues(byName);
      // If the changed symbol is selected, refresh its detail.
      if (this._selectedName && byName.has(this._selectedName)) {
        void this._loadDetail(this._selectedName, /*silent*/ true);
      }
      void this._refreshChanges();
      if (this._saveStatus.kind === "saved" || this._saveStatus.kind === "error") {
        this._saveStatus = { kind: "idle" };
      }
    } catch (e) {
      this._saveStatus = {
        kind: "error",
        message: e instanceof Error ? e.message : String(e),
      };
    }
  }

  private async _selectSymbol(name: string, opts: { skipHistory?: boolean } = {}): Promise<void> {
    if (!name) { return; }
    if (this._selectedName !== name && !opts.skipHistory) {
      // Truncate forward history when navigating from the middle of the stack.
      const trimmed = this._history.slice(0, this._historyIndex + 1);
      trimmed.push(name);
      // Cap history length to avoid unbounded growth.
      const MAX = 50;
      this._history = trimmed.length > MAX ? trimmed.slice(trimmed.length - MAX) : trimmed;
      this._historyIndex = this._history.length - 1;
    }
    this._selectedName = name;
    await this._loadDetail(name);
  }

  private async _historyBack(): Promise<void> {
    if (this._historyIndex <= 0) { return; }
    this._historyIndex -= 1;
    const name = this._history[this._historyIndex];
    if (name) { await this._selectSymbol(name, { skipHistory: true }); }
  }

  private async _historyForward(): Promise<void> {
    if (this._historyIndex >= this._history.length - 1) { return; }
    this._historyIndex += 1;
    const name = this._history[this._historyIndex];
    if (name) { await this._selectSymbol(name, { skipHistory: true }); }
  }

  private async _loadDetail(name: string, silent = false): Promise<void> {
    if (!silent) { this._selectedDetailLoading = true; }
    try {
      const detail = await this._request<KconfigSymbolDetail>("kconfigSymbol", { name });
      this._selectedDetail = detail;
    } catch (e) {
      this._selectedDetail = {
        name,
        type: "",
        prompt: "",
        help: e instanceof Error ? e.message : String(e),
        value: "",
        user_value: null,
        visible: false,
        assignable_values: [],
        direct_dependencies: "",
        defaults: [],
        ranges: [],
        defining_files: [],
        is_constant: false,
        choice: null,
      };
    } finally {
      this._selectedDetailLoading = false;
    }
  }

  // ------------------------------------------------------------------
  // Toolbar actions
  // ------------------------------------------------------------------

  private async _onSaveAs(): Promise<void> {
    this._saveStatus = { kind: "saving" };
    try {
      const r = await this._request<{ savedPath: string | null }>("kconfigSaveAs", { minimal: true });
      if (r.savedPath) {
        this._saveStatus = { kind: "saved", path: r.savedPath };
      } else {
        this._saveStatus = { kind: "idle" };
      }
    } catch (e) {
      this._saveStatus = {
        kind: "error",
        message: e instanceof Error ? e.message : String(e),
      };
    }
  }

  private async _onReload(): Promise<void> {
    this._loading = true;
    this._saveStatus = { kind: "idle" };
    try {
      await this._request("kconfigReload");
      const tree = await this._request<{ top_menu: KconfigNode }>("kconfigTree");
      this._treeRoot = tree.top_menu;
      this._treeError = undefined;
      this._changes = [];
      if (this._selectedName) { void this._loadDetail(this._selectedName); }
    } catch (e) {
      this._treeError = e instanceof Error ? e.message : String(e);
    } finally {
      this._loading = false;
    }
  }

  private _onOpenExternal(tool: "menuconfig" | "guiconfig"): void {
    this.postCommand("kconfigOpenExternal", { tool });
  }

  private _onJumpToSymbol = (name: string) => {
    const node = this._findNodeByName(name);
    if (node) { this._revealNode(node); }
    void this._selectSymbol(name);
    if (this._viewMode !== "tree") { this._viewMode = "tree"; }
  };

  private _onOpenDefiningFile(filename: string, linenr: number): void {
    this.vscodeApi.postMessage({
      command: "openMemorySymbol",   // reuse existing extension handler
      path: filename,
      line: linenr,
    });
  }

  // ------------------------------------------------------------------
  // Render: top-level
  // ------------------------------------------------------------------

  render() {
    if (this._useFallback) { return this._renderFallback(); }
    if (this._loading && !this._treeRoot) { return this._renderLoading(); }
    if (this._treeError && !this._treeRoot) { return this._renderError(); }

    return html`
      <h1>
        Kconfig
        ${this._changes.length > 0
        ? html`<span class="kconfig-header-badge">
                ${this._changes.length} change${this._changes.length === 1 ? "" : "s"}
              </span>`
        : nothing}
      </h1>

      ${this._renderToolbar()}
      ${this._renderStatus()}

      <div class="kconfig-split">
        <div class="kconfig-pane kconfig-pane-tree">
          ${this._viewMode === "tree" ? this._renderTree() : this._renderChanges()}
        </div>
        <div class="kconfig-pane kconfig-pane-detail">
          ${this._renderDetail()}
        </div>
      </div>
    `;
  }

  private _renderLoading() {
    return html`
      <h1>Kconfig</h1>
      <p class="kconfig-info">
        <span class="codicon codicon-loading codicon-modifier-spin"></span>
        Loading Kconfig tree…
      </p>
    `;
  }

  private _renderError() {
    return html`
      <h1>Kconfig</h1>
      <p class="kconfig-status kconfig-status-error">
        <span class="codicon codicon-error"></span>
        ${this._treeError}
      </p>
      ${this.entries
        ? html`<p class="kconfig-info">
            Falling back to read-only table view.
            <vscode-button appearance="secondary" @click=${() => this._useFallback = true}>
              Open table view
            </vscode-button>
          </p>`
        : nothing}
    `;
  }

  // ------------------------------------------------------------------
  // Render: toolbar
  // ------------------------------------------------------------------

  private _renderToolbar() {
    const dirty = this._changes.length;
    const saving = this._saveStatus.kind === "saving";
    const canBack = this._historyIndex > 0;
    const canFwd = this._historyIndex < this._history.length - 1;
    return html`
      <div class="kconfig-toolbar">
        <vscode-button
          appearance="icon"
          ?disabled=${!canBack}
          title="Back (Alt+Left)"
          @click=${() => void this._historyBack()}
        >
          <span class="codicon codicon-arrow-left"></span>
        </vscode-button>
        <vscode-button
          appearance="icon"
          ?disabled=${!canFwd}
          title="Forward (Alt+Right)"
          @click=${() => void this._historyForward()}
        >
          <span class="codicon codicon-arrow-right"></span>
        </vscode-button>
        <vscode-textfield
          class="kconfig-filter"
          placeholder=${this._searchHelp ? "Search name, prompt, and help text…" : "Filter symbols by name or prompt…"}
          .value=${this._filter}
          @input=${(e: Event) => {
        const t = e.currentTarget as { value?: string } | null;
        this._filter = (t?.value ?? "").trim().toLowerCase();
        this._scheduleSearch();
      }}
        ></vscode-textfield>
        <label class="kconfig-toolbar-toggle" title="Include help text body in filter (uses kconfiglib)">
          <vscode-checkbox
            .checked=${this._searchHelp}
            @change=${(e: Event) => {
        const t = e.currentTarget as { checked?: boolean } | null;
        this._searchHelp = !!t?.checked;
        this._scheduleSearch();
      }}
          ></vscode-checkbox>
          Search help
        </label>
        <label class="kconfig-toolbar-toggle">
          <vscode-checkbox
            .checked=${this._showHidden}
            @change=${(e: Event) => {
        const t = e.currentTarget as { checked?: boolean } | null;
        this._showHidden = !!t?.checked;
        this._scheduleSearch();
      }}
          ></vscode-checkbox>
          Show hidden symbols
        </label>
        <span style="flex:1"></span>
        <div class="kconfig-view-tabs" role="tablist">
          <vscode-button
            appearance=${this._viewMode === "tree" ? "primary" : "secondary"}
            role="tab"
            aria-selected=${this._viewMode === "tree"}
            @click=${() => this._viewMode = "tree"}
          >
            <span class="codicon codicon-list-tree" style="margin-right:4px"></span>
            Tree
          </vscode-button>
          <vscode-button
            appearance=${this._viewMode === "changes" ? "primary" : "secondary"}
            role="tab"
            aria-selected=${this._viewMode === "changes"}
            @click=${() => { this._viewMode = "changes"; void this._refreshChanges(); }}
          >
            <span class="codicon codicon-diff"></span>
            Changes${dirty > 0 ? html`&nbsp;(${dirty})` : nothing}
          </vscode-button>
        </div>
        <vscode-button
          appearance="secondary"
          @click=${this._onReload}
          title="Discard in-memory edits and re-parse the build's .config"
        >
          <span class="codicon codicon-refresh" style="margin-right:4px"></span>
          Reload
        </vscode-button>
        <vscode-button
          appearance="primary"
          ?disabled=${saving || dirty === 0}
          @click=${this._onSaveAs}
          title="Save edited symbols to a Kconfig fragment file (minimal)"
        >
          <span class="codicon ${saving
        ? "codicon-loading codicon-modifier-spin"
        : "codicon-save"}" style="margin-right:4px"></span>
          ${saving ? "Saving…" : `Save fragment…${dirty > 0 ? ` (${dirty})` : ""}`}
        </vscode-button>
        <vscode-button
          appearance="secondary"
          @click=${() => this._onOpenExternal("menuconfig")}
          title="Run 'west build -t menuconfig' in a terminal"
        >
          <span class="codicon codicon-terminal" style="margin-right:4px"></span>
          menuconfig
        </vscode-button>
        <vscode-button
          appearance="secondary"
          @click=${() => this._onOpenExternal("guiconfig")}
          title="Run 'west build -t guiconfig' in a terminal"
        >
          <span class="codicon codicon-window" style="margin-right:4px"></span>
          guiconfig
        </vscode-button>
      </div>
    `;
  }

  private _renderStatus() {
    const s = this._saveStatus;
    if (s.kind === "saved") {
      return html`
        <p class="kconfig-status kconfig-status-ok">
          <span class="codicon codicon-check"></span>
          Saved fragment to <code>${s.path}</code>
        </p>
      `;
    }
    if (s.kind === "error") {
      return html`
        <p class="kconfig-status kconfig-status-error">
          <span class="codicon codicon-error"></span>
          ${s.message}
        </p>
      `;
    }
    return nothing;
  }

  // ------------------------------------------------------------------
  // Render: tree pane
  // ------------------------------------------------------------------

  private _renderTree() {
    if (!this._treeRoot) { return nothing; }
    const filter = this._filter;

    // Helper-side search (includes help text body) - render the server hit
    // list directly.  Each hit shows name + prompt and a "matched help" badge.
    if (filter && this._searchHelp) {
      const hits = this._searchHits;
      if (hits === undefined) {
        return html`<p class="kconfig-info">
          <span class="codicon codicon-loading codicon-modifier-spin"></span>
          Searching…
        </p>`;
      }
      if (hits.length === 0) {
        return html`<p class="kconfig-info">No symbols match “${filter}”.</p>`;
      }
      return html`
        <ul class="kconfig-tree kconfig-tree-flat" role="tree">
          ${hits.map((h) => this._renderSearchHit(h))}
        </ul>
        ${this._searchTruncated
          ? html`<p class="kconfig-info">Showing first ${hits.length} matches — refine your query for more.</p>`
          : nothing}
      `;
    }

    // Cheap client-side substring match on name/prompt only.
    if (filter) {
      const hits: KconfigNode[] = [];
      const walk = (n: KconfigNode) => {
        if (n.is_symbol && n.name) {
          if (!this._showHidden && !n.visible) { /* skip */ }
          else if (
            n.name.toLowerCase().includes(filter)
            || n.prompt.toLowerCase().includes(filter)
          ) {
            hits.push(n);
          }
        }
        if (n.children) { for (const c of n.children) { walk(c); } }
      };
      walk(this._treeRoot);
      if (hits.length === 0) {
        return html`<p class="kconfig-info">No symbols match “${filter}”.</p>`;
      }
      return html`
        <ul class="kconfig-tree kconfig-tree-flat" role="tree">
          ${hits.map((n) => this._renderLeafRow(n))}
        </ul>
      `;
    }

    return html`
      <ul class="kconfig-tree" role="tree">
        ${(this._treeRoot.children ?? []).map((c) => this._renderTreeNode(c, 0))}
      </ul>
    `;
  }

  private _renderSearchHit(h: KconfigSearchHit): TemplateResult {
    const selected = this._selectedName === h.name;
    return html`
      <li
        class="kconfig-tree-leaf ${selected ? "kconfig-tree-selected" : ""} ${!h.visible ? "kconfig-tree-hidden" : ""}"
        role="treeitem"
      >
        <div
          class="kconfig-tree-row"
          style="padding-left:14px"
          @click=${() => this._selectSymbol(h.name)}
        >
          <span class="kconfig-tree-label">
            ${h.prompt || html`<code>${h.name}</code>`}
            ${h.matched_help ? html`<span class="badge badge-muted" title="Matched help text">help</span>` : nothing}
          </span>
          <span class="kconfig-tree-value">
            <code class="kconfig-bool-label">${h.value || '""'}</code>
          </span>
        </div>
      </li>
    `;
  }

  private _renderTreeNode(node: KconfigNode, depth: number): TemplateResult | typeof nothing {
    if (!this._showHidden && !node.visible && !node.is_menu && !node.is_choice) {
      return nothing;
    }
    const hasChildren = !!(node.children && node.children.length);
    const expanded = this._expanded.has(node.id);

    if (node.is_choice) {
      return this._renderChoiceNode(node, depth);
    }
    if (node.is_menu || (hasChildren && !node.is_symbol)) {
      return html`
        <li class="kconfig-tree-menu" role="treeitem" aria-expanded=${expanded}>
          <div
            class="kconfig-tree-row kconfig-tree-row-menu"
            style="padding-left:${depth * 14}px"
            @click=${() => this._toggleExpand(node.id)}
          >
            <span class="codicon ${expanded ? "codicon-chevron-down" : "codicon-chevron-right"}"></span>
            <span class="kconfig-tree-label">${node.prompt || node.name || "(menu)"}</span>
          </div>
          ${expanded && hasChildren
          ? html`<ul role="group">
                ${node.children!.map((c) => this._renderTreeNode(c, depth + 1))}
              </ul>`
          : nothing}
        </li>
      `;
    }
    if (node.is_symbol) {
      // Symbol with children (rare — implies a menuconfig-style sub-menu).
      if (hasChildren) {
        return html`
          <li class="kconfig-tree-menu" role="treeitem" aria-expanded=${expanded}>
            <div class="kconfig-tree-row" style="padding-left:${depth * 14}px">
              <span
                class="codicon ${expanded ? "codicon-chevron-down" : "codicon-chevron-right"}"
                @click=${() => this._toggleExpand(node.id)}
                style="cursor:pointer"
              ></span>
              ${this._renderLeafRowInner(node)}
            </div>
            ${expanded
            ? html`<ul role="group">
                  ${node.children!.map((c) => this._renderTreeNode(c, depth + 1))}
                </ul>`
            : nothing}
          </li>
        `;
      }
      return this._renderLeafRow(node, depth);
    }
    return nothing;
  }

  private _renderLeafRow(node: KconfigNode, depth = 0): TemplateResult {
    const selected = this._selectedName === node.name;
    return html`
      <li
        class="kconfig-tree-leaf ${selected ? "kconfig-tree-selected" : ""} ${!node.visible ? "kconfig-tree-hidden" : ""}"
        role="treeitem"
      >
        <div
          class="kconfig-tree-row"
          style="padding-left:${(depth + 1) * 14}px"
          @click=${() => this._selectSymbol(node.name)}
        >
          ${this._renderLeafRowInner(node)}
        </div>
      </li>
    `;
  }

  private _renderLeafRowInner(node: KconfigNode): TemplateResult {
    return html`
      <span class="kconfig-tree-label">
        ${node.prompt || html`<code>${node.name}</code>`}
      </span>
      <span class="kconfig-tree-value" @click=${(e: Event) => e.stopPropagation()}>
        ${this._renderInlineEditor(node)}
      </span>
    `;
  }

  private _renderInlineEditor(node: KconfigNode): TemplateResult | string {
    if (!node.visible) { return html`<span class="kconfig-bool-label">${node.value}</span>`; }
    if (node.type === "bool") {
      const checked = node.value === "y";
      return html`
        <vscode-checkbox
          .checked=${checked}
          @change=${(e: Event) => {
          const t = e.currentTarget as { checked?: boolean } | null;
          void this._setSymbol(node.name, t?.checked ? "y" : "n");
        }}
          aria-label=${`Toggle ${node.name}`}
        ></vscode-checkbox>
      `;
    }
    if (node.type === "tristate") {
      return html`
        <vscode-single-select
          .value=${node.value}
          @change=${(e: Event) => {
          const t = e.currentTarget as { value?: string } | null;
          void this._setSymbol(node.name, t?.value ?? "n");
        }}
          aria-label=${`Set ${node.name}`}
        >
          <vscode-option value="y">y</vscode-option>
          <vscode-option value="m">m</vscode-option>
          <vscode-option value="n">n</vscode-option>
        </vscode-single-select>
      `;
    }
    // int / hex / string
    return html`
      <vscode-textfield
        class="kconfig-inline-input"
        .value=${node.value}
        spellcheck="false"
        @change=${(e: Event) => {
        const t = e.currentTarget as { value?: string } | null;
        void this._setSymbol(node.name, t?.value ?? "");
      }}
        aria-label=${`Edit ${node.name}`}
      ></vscode-textfield>
    `;
  }

  private _renderChoiceNode(node: KconfigNode, depth: number): TemplateResult {
    // Render as a single radio cluster; each child symbol becomes one option.
    const expanded = this._expanded.has(node.id);
    const options = (node.children ?? []).filter((c) => c.is_symbol);
    const selected = options.find((o) => o.value === "y");
    return html`
      <li class="kconfig-tree-menu kconfig-tree-choice" role="treeitem" aria-expanded=${expanded}>
        <div
          class="kconfig-tree-row kconfig-tree-row-menu"
          style="padding-left:${depth * 14}px"
          @click=${() => this._toggleExpand(node.id)}
        >
          <span class="codicon ${expanded ? "codicon-chevron-down" : "codicon-chevron-right"}"></span>
          <span class="kconfig-tree-label">${node.prompt || "(choice)"}</span>
          <span class="kconfig-tree-value">
            ${selected ? html`<code>${selected.name}</code>` : html`<em class="kconfig-bool-label">none</em>`}
          </span>
        </div>
        ${expanded
        ? html`<ul role="group">
              ${options.map((opt) => html`
                <li class="kconfig-tree-leaf ${this._selectedName === opt.name ? "kconfig-tree-selected" : ""}">
                  <div
                    class="kconfig-tree-row"
                    style="padding-left:${(depth + 1) * 14}px"
                  >
                    <vscode-radio
                      name=${`choice-${node.id}`}
                      ?checked=${opt.value === "y"}
                      @change=${(e: Event) => {
            const t = e.currentTarget as { checked?: boolean } | null;
            if (t?.checked) { void this._setSymbol(opt.name, "y"); }
          }}
                    ></vscode-radio>
                    <span
                      class="kconfig-tree-label kconfig-tree-link"
                      @click=${() => this._selectSymbol(opt.name)}
                    >${opt.prompt || html`<code>${opt.name}</code>`}</span>
                  </div>
                </li>
              `)}
            </ul>`
        : nothing}
      </li>
    `;
  }

  private _toggleExpand(id: number): void {
    const next = new Set(this._expanded);
    if (next.has(id)) { next.delete(id); } else { next.add(id); }
    this._expanded = next;
  }

  // ------------------------------------------------------------------
  // Render: changes pane
  // ------------------------------------------------------------------

  private _renderChanges() {
    if (this._changes.length === 0) {
      return html`<p class="kconfig-info">No changes vs. on-disk .config.</p>`;
    }
    return html`
      <table class="dashboard-table kconfig-changes-table">
        <thead>
          <tr>
            <th>Symbol</th>
            <th>Original</th>
            <th>Current</th>
            <th aria-label="Actions"></th>
          </tr>
        </thead>
        <tbody>
          ${this._changes.map((c) => html`
            <tr>
              <td>
                <code class="kconfig-tree-link" @click=${() => this._onJumpToSymbol(c.name)}>
                  ${c.name}
                </code>
              </td>
              <td><code>${c.old || '""'}</code></td>
              <td><code>${c.new || '""'}</code></td>
              <td>
                <vscode-button
                  appearance="icon"
                  title="Reset to original"
                  @click=${() => void this._setSymbol(c.name, c.old)}
                >
                  <span class="codicon codicon-discard"></span>
                </vscode-button>
              </td>
            </tr>
          `)}
        </tbody>
      </table>
    `;
  }

  // ------------------------------------------------------------------
  // Render: detail pane
  // ------------------------------------------------------------------

  private _renderDetail() {
    if (!this._selectedName) {
      return html`<p class="kconfig-info">Select a symbol to see its details.</p>`;
    }
    if (this._selectedDetailLoading && !this._selectedDetail) {
      return html`<p class="kconfig-info">
        <span class="codicon codicon-loading codicon-modifier-spin"></span>
        Loading…
      </p>`;
    }
    const d = this._selectedDetail;
    if (!d) { return nothing; }

    return html`
      <div class="kconfig-detail">
        <div class="kconfig-detail-header">
          <h2><code>CONFIG_${d.name}</code></h2>
          ${d.prompt ? html`<p class="kconfig-detail-prompt">${d.prompt}</p>` : nothing}
        </div>

        <dl class="kconfig-detail-grid">
          <dt>Type</dt><dd>${d.type}</dd>
          <dt>Value</dt><dd><code>${d.value || '""'}</code>
            ${!d.visible ? html`<span class="badge badge-muted" title="Not currently visible/enabled by its dependencies">hidden</span>` : nothing}
          </dd>
          ${d.choice ? html`<dt>Choice group</dt><dd><code>${d.choice}</code></dd>` : nothing}
          ${d.direct_dependencies && d.direct_dependencies !== "y"
        ? html`<dt>Depends on</dt><dd>${this._renderExpr(d.direct_dependencies)}</dd>`
        : nothing}
          ${d.ranges.length > 0
        ? html`<dt>Ranges</dt><dd>
                ${d.ranges.map((r) => html`<div><code>${r.low} … ${r.high}</code>${r.cond !== "y" ? html` if ${this._renderExpr(r.cond)}` : nothing}</div>`)}
              </dd>`
        : nothing}
          ${d.defaults.length > 0
        ? html`<dt>Defaults</dt><dd>
                ${d.defaults.map((df) => html`<div><code>${df.value}</code>${df.cond !== "y" ? html` if ${this._renderExpr(df.cond)}` : nothing}</div>`)}
              </dd>`
        : nothing}
        </dl>

        ${this._renderDetailEditor(d)}

        ${d.help
        ? html`<section class="kconfig-help">
              <h3>Help</h3>
              <pre>${d.help}</pre>
            </section>`
        : nothing}

        ${d.defining_files.length > 0
        ? html`<section class="kconfig-defining">
              <h3>Defined in</h3>
              <ul>
                ${d.defining_files.map((f) => html`
                  <li>
                    <span
                      class="kconfig-tree-link"
                      @click=${() => this._onOpenDefiningFile(f.filename, f.linenr)}
                    >
                      <code>${f.filename}:${f.linenr}</code>
                    </span>
                    ${f.prompt ? html` — ${f.prompt}` : nothing}
                  </li>
                `)}
              </ul>
            </section>`
        : nothing}
      </div>
    `;
  }

  private _renderDetailEditor(d: KconfigSymbolDetail): TemplateResult | typeof nothing {
    if (d.is_constant || !d.visible) { return nothing; }
    const node: KconfigNode = {
      id: -1,
      prompt: d.prompt,
      name: d.name,
      type: d.type,
      value: d.value,
      visible: d.visible,
      is_menu: false,
      is_choice: false,
      is_symbol: true,
    };

    // Range hint for int/hex
    let rangeHint: TemplateResult | typeof nothing = nothing;
    if ((d.type === "int" || d.type === "hex") && d.ranges.length > 0) {
      const r = d.ranges[0];
      rangeHint = html`<small class="kconfig-info">
        Allowed range: <code>${r.low}</code> … <code>${r.high}</code>
      </small>`;
    }

    return html`
      <section class="kconfig-detail-editor">
        <h3>Set value</h3>
        <div class="kconfig-detail-editor-row">
          ${this._renderInlineEditor(node)}
        </div>
        ${rangeHint}
      </section>
    `;
  }

  /**
   * Convert a kconfiglib expression string into clickable spans for symbol
   * names embedded in the expression.  Heuristic: any uppercase identifier
   * that resolves to a symbol in the current tree is linkified.
   */
  private _renderExpr(expr: string): TemplateResult {
    const parts: (TemplateResult | string)[] = [];
    const re = /[A-Z][A-Z0-9_]+/g;
    let lastIdx = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(expr)) !== null) {
      if (m.index > lastIdx) { parts.push(expr.slice(lastIdx, m.index)); }
      const name = m[0];
      const node = this._findNodeByName(name);
      if (node) {
        parts.push(html`<span class="kconfig-tree-link" @click=${() => this._onJumpToSymbol(name)}><code>${name}</code></span>`);
      } else {
        parts.push(html`<code>${name}</code>`);
      }
      lastIdx = m.index + name.length;
    }
    if (lastIdx < expr.length) { parts.push(expr.slice(lastIdx)); }
    return html`<span class="kconfig-expr">${parts}</span>`;
  }

  // ------------------------------------------------------------------
  // Fallback (Phase 1A) flat-table mode
  // ------------------------------------------------------------------

  private _handleFallbackSaveReply(msg: Record<string, unknown>): void {
    if (msg.ok && typeof msg.savedPath === "string") {
      this._saveStatus = { kind: "saved", path: msg.savedPath };
      this._fallbackEdits = {};
    } else if (msg.ok && !msg.savedPath) {
      this._saveStatus = { kind: "idle" };
    } else {
      this._saveStatus = {
        kind: "error",
        message: typeof msg.error === "string" ? msg.error : "Save failed.",
      };
    }
  }

  private _fallbackCurrent(entry: DashboardKconfigEntry): string {
    return Object.prototype.hasOwnProperty.call(this._fallbackEdits, entry.name)
      ? this._fallbackEdits[entry.name]
      : entry.value;
  }

  private _fallbackIsModified(entry: DashboardKconfigEntry): boolean {
    if (!Object.prototype.hasOwnProperty.call(this._fallbackEdits, entry.name)) { return false; }
    return this._fallbackEdits[entry.name] !== entry.value;
  }

  private _fallbackSetEdit(entry: DashboardKconfigEntry, raw: string): void {
    if (raw === entry.value) {
      const next = { ...this._fallbackEdits };
      delete next[entry.name];
      this._fallbackEdits = next;
    } else {
      this._fallbackEdits = { ...this._fallbackEdits, [entry.name]: raw };
    }
  }

  private _fallbackOnSave(): void {
    const modified = (this.entries ?? []).filter((e) => this._fallbackIsModified(e));
    if (modified.length === 0) { return; }
    this._saveStatus = { kind: "saving" };
    this.vscodeApi.postMessage({
      command: "kconfigSaveFragment",
      changes: modified.map((e) => ({
        name: e.name,
        value: this._fallbackCurrent(e),
        type: e.type,
      })),
    });
  }

  private _renderFallback() {
    const entries = this.entries ?? [];
    let list = entries;
    if (this._fallbackShowOnlyModified) {
      list = list.filter((e) => this._fallbackIsModified(e));
    }
    if (this._filter) {
      list = list.filter((e) =>
        e.name.toLowerCase().includes(this._filter)
        || this._fallbackCurrent(e).toLowerCase().includes(this._filter),
      );
    }
    const dirtyCount = entries.filter((e) => this._fallbackIsModified(e)).length;
    return html`
      <h1>
        Kconfig
        <span style="font-weight:400;font-size:0.75em;opacity:0.7">
          (${entries.length} symbols${dirtyCount > 0 ? `, ${dirtyCount} edited` : ""})
        </span>
      </h1>
      ${this._treeError
        ? html`<p class="kconfig-status kconfig-status-error">
            <span class="codicon codicon-warning"></span>
            Live editor unavailable: ${this._treeError}. Showing fallback table view.
          </p>`
        : nothing}
      <div class="kconfig-toolbar">
        <vscode-textfield
          class="kconfig-filter"
          placeholder="Filter by name or value…"
          .value=${this._filter}
          @input=${(e: Event) => {
        const t = e.currentTarget as { value?: string } | null;
        this._filter = (t?.value ?? "").trim().toLowerCase();
      }}
        ></vscode-textfield>
        <label class="kconfig-toolbar-toggle">
          <vscode-checkbox
            .checked=${this._fallbackShowOnlyModified}
            @change=${(e: Event) => {
        const t = e.currentTarget as { checked?: boolean } | null;
        this._fallbackShowOnlyModified = !!t?.checked;
      }}
          ></vscode-checkbox>
          Show only edited
        </label>
        <span style="flex:1"></span>
        <vscode-button
          appearance="primary"
          ?disabled=${dirtyCount === 0 || this._saveStatus.kind === "saving"}
          @click=${this._fallbackOnSave}
        >
          <span class="codicon codicon-save" style="margin-right:4px"></span>
          Save fragment… (${dirtyCount})
        </vscode-button>
        <vscode-button
          appearance="secondary"
          @click=${() => this._onOpenExternal("menuconfig")}
        >
          <span class="codicon codicon-terminal" style="margin-right:4px"></span>
          menuconfig
        </vscode-button>
      </div>
      ${this._renderStatus()}
      <table class="dashboard-table kconfig-table">
        <thead>
          <tr>
            <th>Symbol</th>
            <th>Type</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          ${list.map((e) => {
        const modified = this._fallbackIsModified(e);
        const value = this._fallbackCurrent(e);
        return html`
              <tr class=${modified ? "kconfig-row-modified" : ""}>
                <td><code>${e.name}</code></td>
                <td><span class="badge">${e.type ?? ""}</span></td>
                <td class="kconfig-value-cell">
                  ${e.type === "bool" || e.type === "tristate"
            ? html`
                        <vscode-checkbox
                          .checked=${value === "y" || value === "m"}
                          @change=${(ev: Event) => {
                const t = ev.currentTarget as { checked?: boolean } | null;
                this._fallbackSetEdit(e, t?.checked ? "y" : "n");
              }}
                        ></vscode-checkbox>
                        <span class="kconfig-bool-label">${value}</span>
                      `
            : html`
                        <vscode-textfield
                          class="kconfig-value-input"
                          .value=${value}
                          spellcheck="false"
                          @input=${(ev: Event) => {
                const t = ev.currentTarget as { value?: string } | null;
                this._fallbackSetEdit(e, t?.value ?? "");
              }}
                        ></vscode-textfield>
                      `}
                </td>
              </tr>
            `;
      })}
        </tbody>
      </table>
    `;
  }
}
