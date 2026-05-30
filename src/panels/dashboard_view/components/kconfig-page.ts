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
  direct_dep?: string;
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

interface KconfigSaveTarget {
  path: string;
  absPath: string;
  scope: "build" | "project";
  exists: boolean;
  /** "extra" = EXTRA_CONF_FILE; "override" = CONF_FILE (e.g. prj.conf);
   * "auto" = detected by west (build_info.yml) but not yet in confFiles. */
  kind: "extra" | "override" | "auto";
  /** True when the file is tracked in the project/build confFiles list. */
  attached: boolean;
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
  /** Absolute path of the last save target picked from the in-panel menu,
   * so the next save defaults to the same file. */
  lastSaveTarget?: string;
}

type SaveStatus =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; path: string; count: number; rebuildRequired: boolean }
  | { kind: "error"; message: string }
  | { kind: "info"; message: string };

type ViewMode = "tree" | "changes";

@customElement("kconfig-page")
export class KconfigPage extends ZephyrLitElement {
  /** Optional fallback entries from the dashboard JSON used only when the
   * Python session is unavailable. */
  @property({ attribute: false }) entries?: DashboardKconfigEntry[];

  /** Absolute paths of every Kconfig conf file that contributed to this
   * build (from build_info.yml).  Displayed as an informational file list
   * at the top of the page so the user knows which files are in effect. */
  @property({ attribute: false }) kconfigSourceFiles?: string[];

  /** Set by the parent when the session was warmed up in the background
   * before the user navigated here.  When true the loading state shows a
   * lightweight inline spinner instead of replacing the whole page so the
   * toolbar and nav remain visible while the tree is being fetched. */
  @property({ type: Boolean }) preloaded = false;

  // --- Session-mode state --------------------------------------------------
  @state() private _treeRoot?: KconfigNode;
  @state() private _treeError?: string;
  @state() private _loading = true;
  @state() private _selectedName?: string;
  @state() private _selectedDetail?: KconfigSymbolDetail;
  @state() private _selectedDetailLoading = false;
  @state() private _selectedChoiceNode?: KconfigNode;
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

  // --- Phase 1 / 2: Save menu + per-row UX --------------------------------
  /** Pre-existing extra Kconfig fragments the user can overwrite from the
   * Save menu.  Lazily fetched on first menu open and refreshed after each
   * successful save. */
  @state() private _saveTargets?: KconfigSaveTarget[];
  @state() private _saveMenuOpen = false;
  @state() private _saveTargetsLoading = false;
  /** Last save target the user picked, persisted across reloads. */
  @state() private _lastSaveTarget?: string;
  /** True while a reload (discard + re-parse) is in progress — disables all
   * interactive controls so the user cannot edit while the tree is stale. */
  @state() private _reloading = false;
  /** True from when the "Build & Re-parse" button is clicked until the
   * extension posts back `kconfigExternalDone` after the build finishes. */
  @state() private _building = false;
  /** Floating right-click context menu for tree rows. */
  @state() private _contextMenu?: {
    x: number;
    y: number;
    node: KconfigNode;
    modified: boolean;
  };

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
    document.addEventListener("mousedown", this._onDocumentMouseDown, true);
    this._restoreState();
    void this._bootstrap();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener("message", this._onMessage);
    window.removeEventListener("keydown", this._onKeydown);
    document.removeEventListener("mousedown", this._onDocumentMouseDown, true);
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
      lastSaveTarget: this._lastSaveTarget,
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
    if (typeof s.lastSaveTarget === "string") { this._lastSaveTarget = s.lastSaveTarget; }
  }

  /** Updates whose property change should write through to webview state. */
  protected updated(changed: Map<string, unknown>): void {
    super.updated?.(changed);
    const persistKeys = [
      "_expanded", "_selectedName", "_showHidden", "_searchHelp",
      "_viewMode", "_history", "_historyIndex", "_lastSaveTarget",
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

    // Phase 3: external menuconfig/guiconfig finished — reload the tree and
    // .config so the dashboard matches what the user just edited.
    if (msg.command === "kconfigExternalDone") {
      const tool = typeof msg.tool === "string" ? msg.tool : "menuconfig";
      void this._reloadAfterExternal(tool);
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
      // Start fully collapsed (persisted expansion restored by _restoreState
      // above).  Only seed the set so subsequent toggles work; the virtual
      // General group and real menus are all collapsed by default.
      // (Nothing to do — _expanded starts empty.)

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

  /** Find any node by its stable Python id (DFS). */
  private _findNodeById(id: number): KconfigNode | undefined {
    if (!this._treeRoot) { return undefined; }
    const stack: KconfigNode[] = [this._treeRoot];
    while (stack.length) {
      const n = stack.pop()!;
      if (n.id === id) { return n; }
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
      // Re-fetch the full tree so visibility changes (symbols becoming
      // visible/hidden due to dependency changes) are reflected immediately,
      // without requiring a full reload.  Node IDs are stable within a
      // Python session so the _expanded set remains valid.
      const freshTree = await this._request<{ top_menu: KconfigNode }>("kconfigTree");
      this._treeRoot = freshTree.top_menu;
      // Refresh selected-choice node reference to point into the new tree.
      if (this._selectedChoiceNode) {
        this._selectedChoiceNode = this._findNodeById(this._selectedChoiceNode.id) ?? this._selectedChoiceNode;
      }
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
    this._selectedChoiceNode = undefined;
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

  /** Open the save-as dialog for a NEW fragment, attaching to the given scope. */
  private async _onSaveAsNew(scope: "build" | "project" = "build"): Promise<void> {
    this._saveMenuOpen = false;
    await this._performSave("", { scope });
  }

  /** Save to an existing target — updates symbols in-place, appends new ones. */
  private async _onSaveToTarget(target: KconfigSaveTarget): Promise<void> {
    this._saveMenuOpen = false;
    this._lastSaveTarget = target.absPath;
    await this._performSave(target.absPath);
  }

  /** Per-row "Save just this symbol to <target>". */
  private async _onSaveSymbolToTarget(symbolName: string, target: KconfigSaveTarget): Promise<void> {
    this._saveMenuOpen = false;
    this._contextMenu = undefined;
    if (!symbolName) { return; }
    this._lastSaveTarget = target.absPath;
    await this._performSave(target.absPath, { symbols: [symbolName] });
  }

  /** Per-row "Save just this symbol to a new fragment". */
  private async _onSaveSymbolAsNew(symbolName: string, scope: "build" | "project"): Promise<void> {
    this._contextMenu = undefined;
    if (!symbolName) { return; }
    await this._performSave("", { scope, symbols: [symbolName] });
  }

  private async _performSave(
    target: string,
    opts: { scope?: "build" | "project"; symbols?: string[] } = {},
  ): Promise<void> {
    const dirty = opts.symbols ? opts.symbols.length : this._changes.length;
    this._saveStatus = { kind: "saving" };
    try {
      const r = await this._request<{ savedPath: string | null }>(
        "kconfigSaveAs",
        {
          minimal: true,
          target,
          scope: opts.scope ?? "build",
          symbols: opts.symbols ?? [],
        },
      );
      if (r.savedPath) {
        this._saveStatus = { kind: "saved", path: r.savedPath, count: dirty, rebuildRequired: true };
        // Save targets list may have changed (file existence flipped) — drop
        // the cache so the menu is repopulated on next open.
        this._saveTargets = undefined;
        // Clear the pending-changes list.  For a full save every change was
        // written; for a per-symbol save only those symbols were written —
        // remove just them from the list.
        if (!opts.symbols || opts.symbols.length === 0) {
          this._changes = [];
        } else {
          const saved = new Set(opts.symbols);
          this._changes = this._changes.filter((c) => !saved.has(c.name));
        }
      } else {
        // User cancelled the save dialog.
        this._saveStatus = { kind: "idle" };
      }
    } catch (e) {
      this._saveStatus = {
        kind: "error",
        message: e instanceof Error ? e.message : String(e),
      };
    }
  }

  /** Trigger a project build (pristine=true for build-pristine). */
  private _onBuild(pristine: boolean): void {
    this.vscodeApi.postMessage({ command: "build", pristine });
  }

  /** Open the saved file in the editor. */
  private _onOpenSavedFile(absPath: string): void {
    this.vscodeApi.postMessage({
      command: "openMemorySymbol",   // reuse existing extension file-open handler
      path: absPath,
    });
  }

  private async _ensureSaveTargets(): Promise<void> {
    if (this._saveTargets !== undefined || this._saveTargetsLoading) { return; }
    this._saveTargetsLoading = true;
    try {
      const r = await this._request<{ targets: KconfigSaveTarget[] }>("kconfigListSaveTargets");
      this._saveTargets = r.targets ?? [];
    } catch {
      this._saveTargets = [];
    } finally {
      this._saveTargetsLoading = false;
    }
  }

  private async _toggleSaveMenu(): Promise<void> {
    if (this._saveMenuOpen) {
      this._saveMenuOpen = false;
      return;
    }
    await this._ensureSaveTargets();
    this._saveMenuOpen = true;
  }

  /** Clicked outside the save menu / context menu: dismiss them.  Wired up
   * via `connectedCallback`. */
  private _onDocumentMouseDown = (e: MouseEvent) => {
    const root = this.shadowRoot;
    if (!root) { return; }
    const path = e.composedPath();
    if (this._saveMenuOpen) {
      const inMenu = path.some((n) => {
        return n instanceof Element
          && (n.classList?.contains?.("kconfig-save-menu")
            || n.classList?.contains?.("kconfig-save-button"));
      });
      if (!inMenu) { this._saveMenuOpen = false; }
    }
    if (this._contextMenu) {
      const inCtx = path.some((n) => {
        return n instanceof Element && n.classList?.contains?.("kconfig-ctx-menu");
      });
      if (!inCtx) { this._contextMenu = undefined; }
    }
  };

  private async _onReload(): Promise<void> {
    this._loading = true;
    this._reloading = true;
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
      this._reloading = false;
    }
  }

  private _onOpenExternal(tool: "menuconfig" | "guiconfig"): void {
    this.postCommand("kconfigOpenExternal", { tool });
  }

  /** Build the project then re-parse Kconfig so DT_HAS_* and other
   * build-derived symbols reflect the new build output. */
  private _onBuildAndReparse(): void {
    this._building = true;
    this._onBuild(false);
    // _building is cleared in _reloadAfterExternal when kconfigExternalDone arrives.
  }

  /** Phase 3: re-run `kconfigReload` after the user exits an external
   * menuconfig/guiconfig session and surface a transient banner so they
   * know the dashboard has caught up. */
  private async _reloadAfterExternal(tool: string): Promise<void> {
    this._building = false;
    await this._onReload();
    this._saveStatus = {
      kind: "info",
      message: tool === "build"
        ? "Kconfig reloaded after build."
        : `Reloaded after external ${tool}.`,
    };
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
  // Phase 2: per-row helpers (modified marker, reset, jump-to-def, context)
  // ------------------------------------------------------------------

  /** True if this symbol differs from the on-disk .config that was loaded
   * when the dashboard opened (drives the modified ● and reset button). */
  private _isModified(name: string): boolean {
    if (!name) { return false; }
    return this._changes.some((c) => c.name === name);
  }

  /** Restore a symbol to the value it had at load time (or last reload). */
  private async _resetSymbol(name: string): Promise<void> {
    const change = this._changes.find((c) => c.name === name);
    if (!change) { return; }
    await this._setSymbol(name, change.old);
  }

  /** Open the Kconfig file that defines this symbol.  Uses the cached detail
   * if it matches; otherwise asks the helper. */
  private async _jumpToDefinition(name: string): Promise<void> {
    let detail = this._selectedDetail;
    if (!detail || detail.name !== name) {
      try {
        detail = await this._request<KconfigSymbolDetail>("kconfigSymbol", { name });
      } catch {
        return;
      }
    }
    const def = detail.defining_files?.[0];
    if (def) { this._onOpenDefiningFile(def.filename, def.linenr); }
  }

  private _openContextMenu(e: MouseEvent, node: KconfigNode): void {
    e.preventDefault();
    e.stopPropagation();
    const modified = this._isModified(node.name);
    this._contextMenu = {
      x: e.clientX,
      y: e.clientY,
      node,
      modified,
    };
    // Eagerly load save targets when we open a context menu on a modified
    // symbol so the sub-list is ready by the time the user hovers it.
    if (modified && node.is_symbol && !this._isMenuLike(node)) {
      void this._ensureSaveTargets();
    }
  }

  /** Recursively collect all menu/choice node ids in a subtree (for the
   * Expand/Collapse-subtree context-menu actions). */
  private _collectMenuIds(node: KconfigNode, into: Set<number>): void {
    if (this._isMenuLike(node)) { into.add(node.id); }
    if (node.children) {
      for (const c of node.children) { this._collectMenuIds(c, into); }
    }
  }

  private _expandSubtree(node: KconfigNode): void {
    const ids = new Set<number>(this._expanded);
    this._collectMenuIds(node, ids);
    this._expanded = ids;
    this._contextMenu = undefined;
  }

  private _collapseSubtree(node: KconfigNode): void {
    const collect = new Set<number>();
    this._collectMenuIds(node, collect);
    const next = new Set<number>();
    for (const id of this._expanded) { if (!collect.has(id)) { next.add(id); } }
    this._expanded = next;
    this._contextMenu = undefined;
  }

  private async _copyConfigName(name: string): Promise<void> {
    this._contextMenu = undefined;
    if (!name) { return; }
    try {
      await navigator.clipboard.writeText(`CONFIG_${name}`);
    } catch { /* clipboard may be blocked */ }
  }

  private _renderContextMenu(): TemplateResult | typeof nothing {
    const ctx = this._contextMenu;
    if (!ctx) { return nothing; }
    const node = ctx.node;
    const isMenu = this._isMenuLike(node);
    return html`
      <ul
        class="kconfig-ctx-menu"
        role="menu"
        style="left:${ctx.x}px;top:${ctx.y}px"
        @mousedown=${(e: Event) => e.stopPropagation()}
      >
        ${isMenu
        ? html`
            <li class="kconfig-ctx-item" role="menuitem"
                @click=${() => this._expandSubtree(node)}>
              <span class="codicon codicon-expand-all"></span>Expand subtree
            </li>
            <li class="kconfig-ctx-item" role="menuitem"
                @click=${() => this._collapseSubtree(node)}>
              <span class="codicon codicon-collapse-all"></span>Collapse subtree
            </li>
            <li class="kconfig-ctx-sep" role="separator"></li>`
        : nothing}
        ${node.is_symbol && node.name
        ? html`
            <li class="kconfig-ctx-item" role="menuitem"
                @click=${() => { this._contextMenu = undefined; void this._jumpToDefinition(node.name); }}>
              <span class="codicon codicon-go-to-file"></span>Go to definition
            </li>
            <li class="kconfig-ctx-item" role="menuitem"
                @click=${() => void this._copyConfigName(node.name)}>
              <span class="codicon codicon-copy"></span>Copy <code>CONFIG_${node.name}</code>
            </li>`
        : nothing}
        ${ctx.modified
        ? html`
            <li class="kconfig-ctx-sep" role="separator"></li>
            <li class="kconfig-ctx-item" role="menuitem"
                @click=${() => { this._contextMenu = undefined; void this._resetSymbol(node.name); }}>
              <span class="codicon codicon-discard"></span>Reset to original
            </li>
            ${node.is_symbol && !isMenu
            ? html`
              <li class="kconfig-ctx-sep" role="separator"></li>
              <li class="kconfig-ctx-item kconfig-ctx-item-header" role="presentation">
                Save this symbol to…
              </li>
              ${this._saveTargetsLoading
                ? html`<li class="kconfig-ctx-item kconfig-ctx-disabled">
                  <span class="codicon codicon-loading codicon-modifier-spin"></span> Loading…
                </li>`
                : (this._saveTargets ?? []).map((t) => {
                  const badge = t.kind === "override"
                    ? html`<span class="badge badge-warning">override</span>`
                    : html`<span class="badge badge-muted">${t.kind}</span>`;
                  return html`
                    <li class="kconfig-ctx-item" role="menuitem"
                        @click=${() => void this._onSaveSymbolToTarget(node.name, t)}>
                      <span class="codicon codicon-file"></span>
                      ${t.path} ${badge}
                    </li>
                  `;
                })}
              <li class="kconfig-ctx-item" role="menuitem"
                  @click=${() => void this._onSaveSymbolAsNew(node.name, "build")}>
                <span class="codicon codicon-new-file"></span>New fragment (build)…
              </li>
              <li class="kconfig-ctx-item" role="menuitem"
                  @click=${() => void this._onSaveSymbolAsNew(node.name, "project")}>
                <span class="codicon codicon-new-file"></span>New fragment (project)…
              </li>
            `
            : nothing}`
        : nothing}
      </ul>
    `;
  }

  // ------------------------------------------------------------------
  // Render: top-level
  // ------------------------------------------------------------------

  render() {
    if (this._useFallback) { return this._renderFallback(); }
    if (this._loading && !this._treeRoot) {
      // If the session was preloaded we keep the shell (toolbar etc.) visible
      // with an inline spinner so the UI feels faster.
      if (!this.preloaded) { return this._renderLoading(); }
    }
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

      ${this._renderSourceFiles()}
      ${this._renderToolbar()}
      ${this._renderStatus()}

      <div class="kconfig-split">
        <div class="kconfig-pane kconfig-pane-tree${this._reloading ? " kconfig-pane--reloading" : ""}">
          ${this._reloading
        ? html`<div class="kconfig-pane-loading">
                <span class="codicon codicon-loading codicon-modifier-spin" style="font-size:28px;opacity:0.7"></span>
                <p>Reloading Kconfig tree…</p>
              </div>`
        : this._loading && !this._treeRoot
          ? html`<div class="kconfig-pane-loading">
                <span class="codicon codicon-loading codicon-modifier-spin" style="font-size:28px;opacity:0.7"></span>
                <p>Loading Kconfig tree…</p>
              </div>`
          : this._viewMode === "tree" ? this._renderTree() : this._renderChanges()}
        </div>
        <div class="kconfig-pane kconfig-pane-detail">
          ${this._renderDetail()}
        </div>
      </div>
      ${this._renderContextMenu()}
    `;
  }

  // ------------------------------------------------------------------
  // Render: Kconfig source file list
  // ------------------------------------------------------------------

  /** Displays the .conf files that contributed to this build (from
   * build_info.yml).  Each file is clickable to open it in the editor. */
  private _renderSourceFiles(): TemplateResult | typeof nothing {
    const raw = this.kconfigSourceFiles;
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
          Configuration sources
          <span class="source-files-count">(${files.length})</span>
        </summary>
        <ul class="source-files-list">
          ${files.map((f) => {
      const display = f.replace(/\\/g, '/').split('/').slice(-2).join('/');
      return html`
              <li class="source-files-item" title="${f}">
                <span class="codicon codicon-file" aria-hidden="true"></span>
                <button class="link-button" @click=${() => this._onOpenSourceFile(f)}>${display}</button>
              </li>
            `;
    })}
        </ul>
      </details>
    `;
  }

  private _onOpenSourceFile(absPath: string): void {
    this.vscodeApi.postMessage({ command: "openMemorySymbol", path: absPath });   // reuse existing extension file-open handler
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
    const reloading = this._reloading;
    const canBack = !reloading && this._historyIndex > 0;
    const canFwd = !reloading && this._historyIndex < this._history.length - 1;
    return html`
      <div class="kconfig-toolbar${reloading ? " kconfig-toolbar--reloading" : ""}">
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
        <div class="kconfig-view-toggle" role="group" aria-label="View mode">
          <button
            class="kconfig-view-toggle-btn ${this._viewMode === "tree" ? "kconfig-view-toggle-btn--active" : ""}"
            title="Show Kconfig tree"
            @click=${() => { this._viewMode = "tree"; }}
          >
            <span class="codicon codicon-list-tree"></span>
            Tree
          </button>
          <button
            class="kconfig-view-toggle-btn ${this._viewMode === "changes" ? "kconfig-view-toggle-btn--active" : ""}"
            title="Show pending changes"
            @click=${() => { this._viewMode = "changes"; void this._refreshChanges(); }}
          >
            <span class="codicon codicon-diff"></span>
            Changes${dirty > 0 ? html`<span class="kconfig-toggle-badge">${dirty}</span>` : nothing}
          </button>
        </div>
        <vscode-button
          appearance="icon"
          ?disabled=${reloading || this._building || dirty > 0}
          @click=${this._onBuildAndReparse}
          title=${dirty > 0 ? "Save changes before building" : "Build project and re-parse Kconfig"}
        >
          <span class="codicon ${this._building ? "codicon-loading codicon-modifier-spin" : "codicon-play"}"></span>
        </vscode-button>
        <vscode-button
          appearance="icon"
          ?disabled=${reloading || this._building}
          @click=${this._onReload}
          title="Discard in-memory edits and re-parse the build's .config"
        >
          <span class="codicon ${reloading ? "codicon-loading codicon-modifier-spin" : "codicon-refresh"}"></span>
        </vscode-button>
        ${this._renderSaveButton(saving || reloading, dirty)}
        <vscode-button
          appearance="icon"
          ?disabled=${saving || reloading}
          @click=${() => this._onOpenExternal("menuconfig")}
          title="Run 'west build -t menuconfig' in a terminal"
        >
          <span class="codicon codicon-terminal"></span>
        </vscode-button>
        <vscode-button
          appearance="icon"
          ?disabled=${saving || reloading}
          @click=${() => this._onOpenExternal("guiconfig")}
          title="Run 'west build -t guiconfig' in a terminal"
        >
          <span class="codicon codicon-window"></span>
        </vscode-button>
      </div>
    `;
  }

  private _renderStatus() {
    const s = this._saveStatus;
    if (s.kind === "saved") {
      const rel = this._relPath(s.path);
      const noun = s.count === 1 ? "symbol" : "symbols";
      return html`
        <p class="kconfig-status kconfig-status-ok">
          <span class="codicon codicon-check"></span>
          Saved ${s.count} ${noun} to <code>${rel}</code>
          <span
            class="kconfig-tree-link"
            style="margin-left:8px"
            @click=${() => this._onOpenSavedFile(s.path)}
          >Open file</span>
          ${s.rebuildRequired ? html`
            <span style="margin-left:12px;opacity:0.8">— Rebuild required to apply changes.</span>
            <vscode-button
              appearance="secondary"
              style="margin-left:8px"
              @click=${() => this._onBuild(false)}
              title="Run west build"
            >Build</vscode-button>
          ` : nothing}
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
    if (s.kind === "info") {
      return html`
        <p class="kconfig-status kconfig-status-info">
          <span class="codicon codicon-info"></span>
          ${s.message}
        </p>
      `;
    }
    return nothing;
  }

  /** Best-effort: trim a workspace-rootless path off an absolute one for
   * display.  We don't know the workspace root in the webview, so we just
   * shorten the leading segments to avoid huge absolute paths. */
  private _relPath(absPath: string): string {
    const norm = absPath.replace(/\\/g, "/");
    const parts = norm.split("/");
    if (parts.length <= 4) { return norm; }
    return ".../" + parts.slice(-3).join("/");
  }

  /** Save split-button: primary action saves to the last-used target (or
   * opens the menu when there is no last target so scope is always chosen);
   * the chevron always opens the popover listing all conf files +
   * "Save as new fragment attached to build/project…". */
  private _renderSaveButton(saving: boolean, dirty: number): TemplateResult {
    const disabled = saving || dirty === 0;
    const last = this._lastSaveTarget
      ? this._saveTargets?.find((t) => t.absPath === this._lastSaveTarget)
      : undefined;
    const primaryLabel = saving
      ? "Saving…"
      : last
        ? `Save to ${this._relPath(last.absPath)}${dirty > 0 ? ` (${dirty})` : ""}`
        : `Save fragment…${dirty > 0 ? ` (${dirty})` : ""}`;
    const primaryTitle = last
      ? `Save ${dirty} change${dirty === 1 ? "" : "s"} to ${last.path}`
      : "Choose where to save your Kconfig changes";
    const primaryAction = async () => {
      if (last) {
        await this._onSaveToTarget(last);
      } else {
        // No prior target — open the menu so the user picks scope first.
        await this._toggleSaveMenu();
      }
    };
    return html`
      <span class="kconfig-save-split">
        <vscode-button
          class="kconfig-save-button"
          appearance="primary"
          ?disabled=${disabled}
          title=${primaryTitle}
          @click=${primaryAction}
        >
          <span class="codicon ${saving
        ? "codicon-loading codicon-modifier-spin"
        : "codicon-save"}" style="margin-right:4px"></span>
          ${primaryLabel}
        </vscode-button>
        <vscode-button
          class="kconfig-save-button kconfig-save-chevron"
          appearance="primary"
          ?disabled=${disabled}
          title="Choose save target…"
          @click=${(e: Event) => { e.stopPropagation(); void this._toggleSaveMenu(); }}
        >
          <span class="codicon codicon-chevron-down"></span>
        </vscode-button>
        ${this._saveMenuOpen ? this._renderSaveMenu() : nothing}
      </span>
    `;
  }

  private _renderSaveMenu(): TemplateResult {
    const targets = this._saveTargets ?? [];
    return html`
      <ul class="kconfig-save-menu" role="menu" @mousedown=${(e: Event) => e.stopPropagation()}>
        ${this._saveTargetsLoading
        ? html`<li class="kconfig-save-menu-info">
              <span class="codicon codicon-loading codicon-modifier-spin"></span>
              Loading targets…
            </li>`
        : nothing}
        ${!this._saveTargetsLoading && targets.length === 0
        ? html`<li class="kconfig-save-menu-info">No conf files found for this build.</li>`
        : nothing}
        ${targets.map((t) => {
          const kindBadge = t.kind === "override"
            ? html`<span class="badge badge-warning" title="Override file (CONF_FILE). Changes will be merged in-place.">override</span>`
            : t.kind === "auto"
              ? html`<span class="badge badge-muted" title="Auto-detected by west (not yet attached to build/project)">auto</span>`
              : html`<span class="badge badge-muted">extra</span>`;
          const scopeBadge = html`<span class="badge badge-muted">${t.scope}</span>`;
          const actionHint = t.kind === "override"
            ? " — merge"
            : t.exists ? "" : " — will be created";
          return html`
          <li
            class="kconfig-save-menu-item ${t.absPath === this._lastSaveTarget ? "kconfig-save-menu-current" : ""}"
            role="menuitem"
            title="${t.absPath}${actionHint}"
            @click=${() => void this._onSaveToTarget(t)}
          >
            <span class="codicon codicon-file"></span>
            <span class="kconfig-save-menu-path">${t.path}</span>
            ${kindBadge}
            ${scopeBadge}
            ${!t.exists && t.kind !== "override"
              ? html`<span class="badge" title="File does not exist yet — will be created">new</span>`
              : nothing}
          </li>
        `;
        })}
        ${targets.length > 0 ? html`<li class="kconfig-save-menu-sep" role="separator"></li>` : nothing}
        <li
          class="kconfig-save-menu-item"
          role="menuitem"
          @click=${() => void this._onSaveAsNew("build")}
        >
          <span class="codicon codicon-new-file"></span>
          <span class="kconfig-save-menu-path">Save as new fragment (attach to build)…</span>
        </li>
        <li
          class="kconfig-save-menu-item"
          role="menuitem"
          @click=${() => void this._onSaveAsNew("project")}
        >
          <span class="codicon codicon-new-file"></span>
          <span class="kconfig-save-menu-path">Save as new fragment (attach to project)…</span>
        </li>
      </ul>
    `;
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
        ${this._renderTopLevel()}
      </ul>
    `;
  }

  /** Render the top-level children of the tree root.
   *
   * Zephyr's root Kconfig defines a number of symbols (BOARD, ARCH, SOC, …)
   * directly under `top_node` before any `menu` block.  Rendering them
   * inline as a flat list mixes them visually with the menu headers.  We
   * collect these "orphaned" top-level symbols and choices into a virtual
   * "General" collapsible section so the view is uniform.
   */
  private _renderTopLevel(): TemplateResult | typeof nothing {
    const children = this._treeRoot?.children ?? [];
    // Partition into orphaned symbols/choices vs. real menu nodes.
    const orphans: KconfigNode[] = [];
    const menus: KconfigNode[] = [];
    for (const c of children) {
      if (c.is_menu || (!c.is_symbol && !c.is_choice && (c.children?.length ?? 0) > 0)) {
        menus.push(c);
      } else {
        orphans.push(c);
      }
    }

    // Filter invisible orphans now (menus are handled in _renderTreeNode).
    const visibleOrphans = this._showHidden
      ? orphans
      : orphans.filter((n) => n.visible);

    const GENERAL_ID = -1; // virtual node id, never conflicts with real py id()
    const generalExpanded = this._expanded.has(GENERAL_ID);

    return html`
      ${visibleOrphans.length > 0 ? html`
        <li class="kconfig-tree-menu" role="treeitem" aria-expanded=${generalExpanded}>
          <div
            class="kconfig-tree-row kconfig-tree-row-menu"
            style="padding-left:0"
            @click=${() => this._toggleExpand(GENERAL_ID)}
            @contextmenu=${(e: MouseEvent) => this._openContextMenu(e, { id: GENERAL_ID, prompt: "General", name: "", type: "", value: "", visible: true, is_menu: true, is_choice: false, is_symbol: false, children: visibleOrphans })}
          >
            <span class="codicon ${generalExpanded ? "codicon-chevron-down" : "codicon-chevron-right"}"></span>
            <span class="kconfig-tree-label">General</span>
          </div>
          ${generalExpanded
          ? html`<ul role="group">
                ${visibleOrphans.map((c) => this._renderTreeNode(c, 1))}
              </ul>`
          : nothing}
        </li>
      ` : nothing}
      ${menus.map((c) => this._renderTreeNode(c, 0))}
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

  /** Returns true when a node has at least one descendant that would be
   * visible in the tree (respects `_showHidden` via caller context). */
  private _hasVisibleContent(node: KconfigNode): boolean {
    if (node.is_symbol) { return node.visible; }
    // Choices are always shown (even when invisible) so they always count as
    // having content — prevents their parent menu from collapsing.
    if (node.is_choice) { return true; }
    if (node.is_menu) {
      if (!node.visible) { return false; }
      return (node.children ?? []).some((c) => this._hasVisibleContent(c));
    }
    return false;
  }

  private _renderTreeNode(node: KconfigNode, depth: number): TemplateResult | typeof nothing {
    if (!this._showHidden) {
      // Hide invisible leaf symbols.
      if (!node.visible && !node.is_menu && !node.is_choice) { return nothing; }
      // Hide menus whose own `depends on` condition is false.
      if (node.is_menu && !node.visible) { return nothing; }
      // Hide menus that contain no visible descendants.
      // Choices are always shown even when invisible so the user can select an
      // option and have the guarding dependency auto-enabled.
      if (node.is_menu && !this._hasVisibleContent(node)) { return nothing; }
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
            @contextmenu=${(e: MouseEvent) => this._openContextMenu(e, node)}
          >
            <span class="codicon ${expanded ? "codicon-chevron-down" : "codicon-chevron-right"}"></span>
            <span class="kconfig-tree-label" title=${node.prompt || node.name || ""}>${node.prompt || node.name || "(menu)"}</span>
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
    const modified = this._isModified(node.name);
    return html`
      <li
        class="kconfig-tree-leaf ${selected ? "kconfig-tree-selected" : ""} ${!node.visible ? "kconfig-tree-hidden" : ""} ${modified ? "kconfig-tree-modified" : ""}"
        role="treeitem"
      >
        <div
          class="kconfig-tree-row"
          style="padding-left:${(depth + 1) * 14}px"
          @click=${() => this._selectSymbol(node.name)}
          @contextmenu=${(e: MouseEvent) => this._openContextMenu(e, node)}
        >
          ${this._renderLeafRowInner(node, modified)}
        </div>
      </li>
    `;
  }

  private _renderLeafRowInner(node: KconfigNode, modified = this._isModified(node.name)): TemplateResult {
    // Use the prompt as the label; fall back to the symbol name in code style.
    // title= provides a tooltip for truncated text (browser native).
    const labelText = node.prompt || node.name;
    return html`
      ${modified
        ? html`<span
            class="kconfig-modified-dot"
            title="Modified from on-disk .config"
          >●</span>`
        : nothing}
      <span class="kconfig-tree-label" title=${labelText}>
        ${node.prompt || html`<code>${node.name}</code>`}
      </span>
      <span class="kconfig-tree-value" title=${node.value} @click=${(e: Event) => e.stopPropagation()}>
        ${this._renderInlineEditor(node)}
      </span>
      <span class="kconfig-row-actions" @click=${(e: Event) => e.stopPropagation()}>
        ${modified
        ? html`<vscode-button
              appearance="icon"
              title="Reset to original"
              @click=${() => void this._resetSymbol(node.name)}
            >
              <span class="codicon codicon-discard"></span>
            </vscode-button>`
        : nothing}
        ${node.name
        ? html`<vscode-button
              appearance="icon"
              title="Go to definition"
              @click=${() => void this._jumpToDefinition(node.name)}
            >
              <span class="codicon codicon-go-to-file"></span>
            </vscode-button>`
        : nothing}
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

  /** Extract Kconfig symbol names from a dependency expression string.
   * Heuristic: uppercase identifiers — covers "A", "A && B", "(A || B) && C".
   */
  private _extractDepSymbols(expr: string): string[] {
    if (!expr || expr === "y") { return []; }
    const matches = expr.match(/\b([A-Z][A-Z0-9_]+)\b/g);
    return matches ? [...new Set(matches)] : [];
  }

  /** Enable all symbols found in directDep (if assignable), then set the
   * target symbol.  Used when the user picks a choice option whose parent
   * choice has an unmet `depends on`. */
  private async _enableDepsAndSet(directDep: string | undefined, name: string, value: string): Promise<void> {
    if (directDep) {
      for (const dep of this._extractDepSymbols(directDep)) {
        const depNode = this._findNodeByName(dep);
        if (depNode?.is_symbol
          && (depNode.type === "bool" || depNode.type === "tristate")
          && depNode.value !== "y") {
          try { await this._setSymbol(dep, "y"); } catch { /* non-assignable — skip */ }
        }
      }
    }
    await this._setSymbol(name, value);
  }

  private _renderChoiceNode(node: KconfigNode, depth: number): TemplateResult {
    const options = (node.children ?? []).filter((c) => c.is_symbol);
    const selected = options.find((o) => o.value === "y");
    const choiceLabel = node.prompt || node.name || "(choice)";
    const locked = !node.visible;
    const modified = options.some((o) => this._isModified(o.name));
    const isSelected = this._selectedChoiceNode?.id === node.id;

    const handleClick = () => { this._selectChoice(node); };

    return html`
      <li
        class="kconfig-tree-leaf ${locked ? "kconfig-tree-hidden" : ""} ${modified ? "kconfig-tree-modified" : ""} ${isSelected ? "kconfig-tree-selected" : ""}"
        role="treeitem"
      >
        <div
          class="kconfig-tree-row"
          style="padding-left:${(depth + 1) * 14}px; cursor:pointer"
          @click=${handleClick}
          @contextmenu=${(e: MouseEvent) => this._openContextMenu(e, node)}
        >
          ${modified
        ? html`<span class="kconfig-modified-dot" title="Modified from on-disk .config">●</span>`
        : nothing}
          <span class="kconfig-tree-label" title=${choiceLabel}>
            ${choiceLabel}
            ${locked && node.direct_dep
        ? html`<span class="badge badge-muted" title="Requires: ${node.direct_dep}. Selecting an option will enable it.">requires: ${node.direct_dep}</span>`
        : nothing}
          </span>
          <span class="kconfig-tree-value">
            <code class="kconfig-bool-label">${selected ? (selected.prompt || selected.name) : "—"}</code>
          </span>
          <span class="kconfig-row-actions" @click=${(e: Event) => e.stopPropagation()}>
            ${selected
        ? html`<vscode-button
                  appearance="icon"
                  title="Go to definition"
                  @click=${() => void this._jumpToDefinition(selected.name)}
                >
                  <span class="codicon codicon-go-to-file"></span>
                </vscode-button>`
        : nothing}
          </span>
        </div>
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
                <code class="kconfig-tree-link" @click=${() => void this._selectSymbol(c.name)}>
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

  private _selectChoice(node: KconfigNode): void {
    this._selectedChoiceNode = node;
    this._selectedName = undefined;
    this._selectedDetail = undefined;
  }

  private _renderChoiceDetail(node: KconfigNode): TemplateResult {
    const options = (node.children ?? []).filter((c) => c.is_symbol);
    const selected = options.find((o) => o.value === "y");
    const locked = !node.visible;
    return html`
      <div class="kconfig-detail">
        <div class="kconfig-detail-header">
          <h2><code>CONFIG_${node.name}</code></h2>
          ${node.prompt ? html`<p class="kconfig-detail-prompt">${node.prompt}</p>` : nothing}
        </div>
        <dl class="kconfig-detail-grid">
          <dt>Type</dt><dd>choice</dd>
          ${selected ? html`<dt>Selected</dt><dd><code>${selected.prompt || selected.name}</code></dd>` : nothing}
          ${locked && node.direct_dep ? html`<dt>Depends on</dt><dd>${this._renderExpr(node.direct_dep)}</dd>` : nothing}
        </dl>
        ${this._renderChoiceDetailEditor(node)}
      </div>
    `;
  }

  private _renderDetail() {
    if (this._selectedChoiceNode) {
      return this._renderChoiceDetail(this._selectedChoiceNode);
    }
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
    if (d.is_constant) { return nothing; }

    // Choice members: show a dropdown for the whole choice group rather than
    // a single-symbol bool editor.  Works even when the choice is locked
    // (depends on not met) so the user can pick an option and auto-enable
    // the guarding dependency.
    if (d.choice !== null) {
      const choiceNode = this._findChoiceForSymbol(d.name);
      if (choiceNode) { return this._renderChoiceDetailEditor(choiceNode); }
    }

    if (!d.visible) {
      // For bool/tristate symbols hidden due to an unmet dependency, offer a
      // one-click "enable with dependencies" action rather than a dead end.
      if ((d.type === "bool" || d.type === "tristate") && d.direct_dependencies && d.direct_dependencies !== "y") {
        return html`
          <section class="kconfig-detail-editor">
            <h3>Set value</h3>
            <p class="kconfig-info" style="margin:0 0 6px">
              <span class="codicon codicon-lock" style="margin-right:4px"></span>
              Hidden — dependency not met: ${this._renderExpr(d.direct_dependencies)}
            </p>
            <div class="kconfig-detail-editor-row">
              <vscode-button @click=${() => void this._enableDepsAndSet(d.direct_dependencies, d.name, "y")}>
                Enable (auto-enable dependencies)
              </vscode-button>
            </div>
          </section>
        `;
      }
      return nothing;
    }
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

  /** Find the choice node in the tree that owns the given symbol as a child. */
  private _findChoiceForSymbol(name: string): KconfigNode | undefined {
    const search = (node: KconfigNode): KconfigNode | undefined => {
      if (node.is_choice && node.children?.some((c) => c.name === name)) {
        return node;
      }
      for (const child of node.children ?? []) {
        const found = search(child);
        if (found) { return found; }
      }
      return undefined;
    };
    return this._treeRoot ? search(this._treeRoot) : undefined;
  }

  /** Detail-pane editor for a choice: a single `<vscode-single-select>` that
   * replaces the per-option bool toggles with one compact dropdown. */
  private _renderChoiceDetailEditor(choiceNode: KconfigNode): TemplateResult {
    const options = (choiceNode.children ?? []).filter((c) => c.is_symbol);
    const selected = options.find((o) => o.value === "y");
    const locked = !choiceNode.visible;
    return html`
      <section class="kconfig-detail-editor">
        <h3>Select</h3>
        ${locked && choiceNode.direct_dep
        ? html`<p class="kconfig-info" style="margin:0 0 6px">
            <span class="codicon codicon-lock" style="margin-right:4px"></span>
            Requires <strong>${choiceNode.direct_dep}</strong> — selecting an option will enable it.
          </p>`
        : nothing}
        <div class="kconfig-detail-editor-row">
          <vscode-single-select
            .value=${selected?.name ?? ""}
            @change=${(e: Event) => {
        const t = e.currentTarget as { value?: string } | null;
        const optName = t?.value;
        if (!optName) { return; }
        void (locked
          ? this._enableDepsAndSet(choiceNode.direct_dep, optName, "y")
          : this._setSymbol(optName, "y"));
      }}
            aria-label=${choiceNode.prompt || "choice"}
          >
            ${!selected ? html`<vscode-option value="">—</vscode-option>` : nothing}
            ${options.map((opt) => html`
              <vscode-option value=${opt.name}>${opt.prompt || opt.name}</vscode-option>
            `)}
          </vscode-single-select>
        </div>
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
      const count = Object.keys(this._fallbackEdits).length;
      this._saveStatus = { kind: "saved", path: msg.savedPath, count, rebuildRequired: true };
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
      ${this._renderSourceFiles()}
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
