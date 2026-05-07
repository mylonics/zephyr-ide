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

import * as path from "upath";
import * as fs from "fs-extra";
import * as vscode from "vscode";

import type { DashboardData, DashboardMemoryRefresh } from "./dashboard-data";
import { generateNonce } from "../webview_shared/nonce";
import type { KconfigSession } from "../../build_data/kconfig-session";

/** Callback invoked when the user requests a memory report refresh. */
type MemoryRefreshCallback = () => Promise<(DashboardMemoryRefresh & { error?: string }) | undefined>;

/** Callback invoked when the user clicks Build from the Kconfig page.
 * Builds the specific project/build this dashboard was opened for. */
type BuildCallback = (pristine: boolean) => Promise<void>;

/**
 * Callbacks that route Kconfig editor actions to extension-side helpers.
 * The DashboardPanel does not know about workspace state directly — these
 * callbacks are bound at construction time from extension.ts where the
 * relevant project/build are already resolved.
 */
export interface DashboardKconfigCallbacks {
  /** Persist the listed changes as a Kconfig fragment file. Returns the
   * absolute path of the saved file, or undefined if the user cancelled. */
  saveFragment: (changes: KconfigChange[]) => Promise<string | undefined>;
  /** Show the save-as dialog for a NEW fragment, attach to the given scope
   * (build or project), invoke `writeFragment(path)` to persist the file.
   * Returns the saved absolute path, or undefined if the user cancelled. */
  saveSessionFragmentNew: (
    scope: "build" | "project",
    writeFragment: (path: string) => Promise<unknown>,
  ) => Promise<string | undefined>;
  /** Write fragment content to an existing target path that the user chose
   * from the in-panel Save menu.  Existing symbol lines are updated in-place;
   * new symbols are appended.  Pass `symbols` to restrict the write to a
   * subset (used by the per-row "Save this symbol to…" action).
   * Returns the saved absolute path, or undefined on error. */
  saveSessionFragmentToPath: (
    absPath: string,
    writeFragment: (path: string) => Promise<unknown>,
    opts: { symbols?: string[] },
  ) => Promise<string | undefined>;
  /** List existing extra Kconfig fragments attached to the active project +
   * build that the user may overwrite from the dashboard.  Build-scope
   * entries shadow project-scope entries with the same path.  Also returns
   * override-style (CONF_FILE) and auto-detected (build_info.yml) entries. */
  listSaveTargets: () => Promise<KconfigSaveTarget[]>;
  /** Launch the existing terminal-based menuconfig or guiconfig task. */
  openExternal: (tool: "menuconfig" | "guiconfig") => Promise<void>;
}

/** A pre-existing Kconfig fragment file the user may overwrite from the
 * dashboard's Save menu. */
export interface KconfigSaveTarget {
  /** Workspace-relative path, as stored in `confFiles`. */
  path: string;
  /** Absolute path on disk. */
  absPath: string;
  /** "build" if attached at the build scope, "project" if at the project
   * scope.  When the same path is attached at both scopes the build-scope
   * entry shadows the project-scope one. */
  scope: "build" | "project";
  /** True if the file currently exists on disk.  False entries are still
   * offered so the user can populate a fragment that was attached but never
   * created. */
  exists: boolean;
  /**
   * How this file is used in the build:
   * - "extra"    — passed as EXTRA_CONF_FILE (safe to overwrite as fragment).
   * - "override" — passed as CONF_FILE (e.g. prj.conf); saving will merge
   *               changed symbols into the file instead of overwriting it.
   * - "auto"     — detected by west from build_info.yml but not yet listed
   *               in the project/build confFiles; saving offers to attach it.
   */
  kind: "extra" | "override" | "auto";
  /** True when this path appears in the project's or build's confFiles list
   * (i.e. it is under active extension management).  Auto-detected entries
   * that come from build_info.yml alone have attached=false. */
  attached: boolean;
}

/** A single Kconfig symbol edit emitted from the webview. */
export interface KconfigChange {
  name: string;
  /** Raw fragment value: "y" / "n" for bool/tristate, decimal/hex for ints,
   * unquoted string for strings (the extension will quote it on write). */
  value: string;
  type?: string;
}

/**
 * Lazy factory for a kconfiglib-backed editor session.  Called at most once
 * per panel — the resulting session is cached and reused for all subsequent
 * Kconfig requests.  May reject if kconfiglib is missing or the helper cannot
 * load the build's Kconfig tree (the error is surfaced to the webview).
 *
 * The factory is responsible for spawning the helper AND calling `init()` so
 * the returned session is ready to receive `tree`/`symbol`/`set` requests.
 */
export type KconfigSessionFactory = () => Promise<KconfigSession>;

/**
 * VS Code webview panel that displays the Zephyr build dashboard natively.
 * Data is read via the TypeScript build artifact reader (build-artifact-reader.ts).
 * One panel is opened per project/build pair.
 */
export class DashboardPanel {
  private static readonly _panels: Map<string, DashboardPanel> = new Map();

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionPath: string;
  private _data: DashboardData;
  private readonly _onRefreshMemory: MemoryRefreshCallback;
  private readonly _onBuild: BuildCallback | undefined;
  private readonly _kconfigCallbacks: DashboardKconfigCallbacks | undefined;
  private readonly _kconfigSessionFactory: KconfigSessionFactory | undefined;
  /** In-flight or completed session promise. Reused across concurrent requests. */
  private _kconfigSessionPromise: Promise<KconfigSession> | undefined;
  private _memoryRefreshing = false;
  private _disposables: vscode.Disposable[] = [];

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Returns the open panel for the given project/build pair, if any. */
  public static getPanel(projectName: string, buildName: string): DashboardPanel | undefined {
    return DashboardPanel._panels.get(`${projectName}/${buildName}`);
  }

  /** Navigate the webview to the specified dashboard page (e.g. "kconfig"). */
  public navigateTo(page: string): void {
    void this._panel.webview.postMessage({ command: "navigateTo", page });
  }

  public static createOrShow(
    extensionPath: string,
    data: DashboardData,
    onRefreshMemory: MemoryRefreshCallback,
    kconfigCallbacks?: DashboardKconfigCallbacks,
    kconfigSessionFactory?: KconfigSessionFactory,
    onBuild?: BuildCallback,
  ): DashboardPanel {
    const { projectName, buildName } = data.meta;
    const key = `${projectName}/${buildName}`;
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : vscode.ViewColumn.One;

    const existing = DashboardPanel._panels.get(key);
    if (existing) {
      existing._panel.reveal(column);
      existing._data = data;
      void existing._postData();
      return existing;
    }

    const panel = vscode.window.createWebviewPanel(
      "zephyrIDEDashboard",
      `Dashboard: ${projectName} / ${buildName}`,
      column ?? vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.file(extensionPath)],
      },
    );

    const instance = new DashboardPanel(
      panel,
      extensionPath,
      data,
      onRefreshMemory,
      kconfigCallbacks,
      kconfigSessionFactory,
      onBuild,
    );
    DashboardPanel._panels.set(key, instance);
    return instance;
  }

  // ---------------------------------------------------------------------------
  // Private implementation
  // ---------------------------------------------------------------------------

  private constructor(
    panel: vscode.WebviewPanel,
    extensionPath: string,
    data: DashboardData,
    onRefreshMemory: MemoryRefreshCallback,
    kconfigCallbacks?: DashboardKconfigCallbacks,
    kconfigSessionFactory?: KconfigSessionFactory,
    onBuild?: BuildCallback,
  ) {
    this._panel = panel;
    this._extensionPath = extensionPath;
    this._data = data;
    this._onRefreshMemory = onRefreshMemory;
    this._onBuild = onBuild;
    this._kconfigCallbacks = kconfigCallbacks;
    this._kconfigSessionFactory = kconfigSessionFactory;

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    this._panel.webview.onDidReceiveMessage(
      (message) => { void this.handleMessage(message); },
      null,
      this._disposables,
    );

    this._panel.webview.html = this.getHtmlShell();
    void this._postData();

    // Kick off the Kconfig session immediately in the background so it is
    // ready (or near-ready) by the time the user navigates to the Kconfig
    // page.  We notify the webview as the promise settles so it can update
    // the loading spinner in the sidebar nav.
    if (this._kconfigSessionFactory) {
      void this._preloadKconfigSession();
    }
  }

  /** Eagerly initialises the Kconfig session and notifies the webview of the
   * outcome so the sidebar can show/hide the loading spinner. */
  private async _preloadKconfigSession(): Promise<void> {
    await this._panel.webview.postMessage({ command: "kconfigPreloading" });
    try {
      await this._getOrInitSession();
      await this._panel.webview.postMessage({ command: "kconfigReady" });
    } catch (err) {
      await this._panel.webview.postMessage({
        command: "kconfigPreloadFailed",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async handleMessage(message: Record<string, unknown>) {
    if (message?.command === "ready") {
      await this._postData();
    } else if (message?.command === "refreshMemory") {
      await this.refreshMemory();
    } else if (message?.command === "openMemorySymbol") {
      await this._openSymbolFile(
        typeof message.path === "string" ? message.path : "",
        typeof message.line === "number" ? message.line : undefined,
      );
    } else if (message?.command === "kconfigSaveFragment") {
      await this._handleKconfigSaveFragment(message);
    } else if (message?.command === "kconfigOpenExternal") {
      const tool = message.tool === "guiconfig" ? "guiconfig" : "menuconfig";
      await this._kconfigCallbacks?.openExternal(tool);
    } else if (message?.command === "build") {
      const pristine = !!message.pristine;
      // Build the specific project/build this dashboard was opened for, not
      // the globally active project.  Falls back to the VS Code command if
      // no callback was registered (should not happen in normal usage).
      if (this._onBuild) {
        await this._onBuild(pristine);
      } else {
        await vscode.commands.executeCommand(
          pristine ? "zephyr-ide.build-pristine" : "zephyr-ide.build",
        );
      }
      // Auto-rescan: reload the Kconfig session from the new .config so the
      // editor reflects the result of the build immediately.  If the build
      // failed, .config is unchanged and the reload is a harmless no-op.
      await this.notifyKconfigExternalDone("build");
    } else if (typeof message?.command === "string" && (message.command as string).startsWith("kconfig")) {
      await this._handleKconfigSession(message);
    }
  }

  // ---------------------------------------------------------------------------
  // Kconfig session (kconfiglib-backed editor)
  // ---------------------------------------------------------------------------

  /**
   * Lazily creates the Kconfig session via the registered factory.  The
   * session promise is cached: concurrent callers share the same in-flight
   * spawn+init, and once resolved the session is reused for every subsequent
   * request.  If the factory rejects (kconfiglib missing, parse error, ...)
   * the rejection is surfaced and the cache is cleared so the next request
   * may retry from scratch.
   */
  private _getOrInitSession(): Promise<KconfigSession> {
    if (!this._kconfigSessionFactory) {
      return Promise.reject(new Error("Kconfig editor is not available for this dashboard."));
    }
    if (!this._kconfigSessionPromise) {
      this._kconfigSessionPromise = this._kconfigSessionFactory().catch((err) => {
        this._kconfigSessionPromise = undefined;
        throw err;
      });
    }
    return this._kconfigSessionPromise;
  }

  /**
   * Routes a `kconfig*` (session-backed) message to the helper subprocess and
   * posts the response back as `kconfig*Result`.  Errors are surfaced as
   * `{ ok: false, error }` so the webview never has to reason about
   * subprocess lifecycle.
   */
  private async _handleKconfigSession(message: Record<string, unknown>): Promise<void> {
    const command = message.command as string;
    const requestId = typeof message.requestId === "number" ? message.requestId : undefined;
    const replyCommand = `${command}Result`;
    try {
      const session = await this._getOrInitSession();
      let result: unknown;
      switch (command) {
        case "kconfigInit": {
          // Init is performed by the factory; expose just the cached snapshot.
          // Most callers should rely on `kconfigTree` instead.
          result = { ok: true };
          break;
        }
        case "kconfigTree":
          result = await session.tree();
          break;
        case "kconfigSymbol":
          result = await session.symbol(String(message.name ?? ""));
          break;
        case "kconfigSet":
          result = await session.set(
            String(message.name ?? ""),
            String(message.value ?? ""),
          );
          break;
        case "kconfigDiff":
          result = await session.diff();
          break;
        case "kconfigSearch":
          result = await session.search(
            String(message.query ?? ""),
            {
              include_help: message.includeHelp !== false,
              include_hidden: !!message.includeHidden,
              limit: typeof message.limit === "number" ? message.limit : 200,
            },
          );
          break;
        case "kconfigSaveFromSession": {
          const filePath = typeof message.path === "string" ? message.path : "";
          const minimal = message.minimal !== false;
          result = await session.save(filePath, minimal);
          break;
        }
        case "kconfigSaveAs": {
          // Combined save-as flow.  Returns { savedPath } or { savedPath: null } on cancel.
          //
          // Variants:
          //   target=""  + scope="build"|"project"  →  save-as-new dialog,
          //                                             attach to chosen scope.
          //   target=<absPath>                       →  update existing entries
          //                                             in-place, append new ones.
          //     symbols=[…] →  only write the listed symbol names (subset save).
          if (!this._kconfigCallbacks) {
            throw new Error("Kconfig save is not available for this dashboard.");
          }
          const minimalSave = message.minimal !== false;
          const target = typeof message.target === "string" ? message.target : "";
          const scope = (message.scope === "project" ? "project" : "build") as "build" | "project";
          // Subset of symbol names to save (for per-row "Save this symbol to…").
          const symbols: string[] | undefined = Array.isArray(message.symbols) && message.symbols.length > 0
            ? (message.symbols as string[])
            : undefined;

          let savedPath: string | undefined;

          if (target) {
            // Existing-target flow: update in-place / append.
            savedPath = await this._kconfigCallbacks.saveSessionFragmentToPath(
              target,
              async (p) => session.save(p, minimalSave),
              { symbols },
            );
          } else {
            // New-fragment flow — scope chosen by user in the Save menu.
            savedPath = await this._kconfigCallbacks.saveSessionFragmentNew(
              scope,
              async (p) => session.save(p, minimalSave),
            );
          }
          result = { savedPath: savedPath ?? null };
          break;
        }
        case "kconfigListSaveTargets": {
          if (!this._kconfigCallbacks) {
            throw new Error("Kconfig save is not available for this dashboard.");
          }
          const targets = await this._kconfigCallbacks.listSaveTargets();
          result = { targets };
          break;
        }
        case "kconfigReload":
          result = await session.reload();
          break;
        default:
          // Unknown kconfig* message - swallow silently; the existing fragment
          // handler upstream already deals with kconfigSaveFragment / Open.
          return;
      }
      await this._panel.webview.postMessage({
        command: replyCommand,
        ok: true,
        requestId,
        result,
      });
    } catch (err) {
      await this._panel.webview.postMessage({
        command: replyCommand,
        ok: false,
        requestId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Validates the change list from the webview, delegates persistence to the
   * extension-side callback, and reports the outcome back to the webview so
   * its dirty-state can be cleared on success.
   */
  private async _handleKconfigSaveFragment(message: Record<string, unknown>): Promise<void> {
    if (!this._kconfigCallbacks) {
      await this._panel.webview.postMessage({
        command: "kconfigSaveResult",
        ok: false,
        error: "Kconfig save is not available for this dashboard.",
      });
      return;
    }
    const rawChanges = Array.isArray(message.changes) ? message.changes : [];
    const changes: KconfigChange[] = [];
    for (const c of rawChanges) {
      if (
        c && typeof c === "object"
        && typeof (c as KconfigChange).name === "string"
        && typeof (c as KconfigChange).value === "string"
      ) {
        changes.push({
          name: (c as KconfigChange).name,
          value: (c as KconfigChange).value,
          type: typeof (c as KconfigChange).type === "string" ? (c as KconfigChange).type : undefined,
        });
      }
    }
    if (changes.length === 0) {
      await this._panel.webview.postMessage({
        command: "kconfigSaveResult",
        ok: false,
        error: "No edited symbols to save.",
      });
      return;
    }
    try {
      const savedPath = await this._kconfigCallbacks.saveFragment(changes);
      await this._panel.webview.postMessage({
        command: "kconfigSaveResult",
        ok: !!savedPath,
        savedPath,
      });
    } catch (e) {
      await this._panel.webview.postMessage({
        command: "kconfigSaveResult",
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  /**
   * Converts POSIX-style absolute paths from cross-compiler build environments
   * into Windows paths.
   *   /c/Users/...     -> C:/Users/... (MSYS2 / MinGW drive-letter shorthand)
   *   /mnt/c/Users/... -> C:/Users/... (WSL mount)
   */
  private static _toWindowsPath(p: string): string | undefined {
    const wsl = p.match(/^\/mnt\/([a-zA-Z])\/(.*)/);
    if (wsl) { return `${wsl[1].toUpperCase()}:/${wsl[2]}`; }
    const msys = p.match(/^\/([a-zA-Z])\/(.*)/);
    if (msys) { return `${msys[1].toUpperCase()}:/${msys[2]}`; }
    return undefined;
  }

  /**
   * Best-effort resolves a symbol path string from the memory report and
   * opens it in the editor.  Probes (in order):
   *   - POSIX cross-compiler path converted to Windows (MSYS2 / WSL)
   *   - the path as-is if absolute
   *   - relative to the build folder (summary.outputDir)
   *   - relative to APPLICATION_SOURCE_DIR (app source root)
   *   - relative to each workspace folder
   * Shows an info message on miss.
   */
  private async _openSymbolFile(symbolPath: string, line?: number): Promise<void> {
    if (!symbolPath) { return; }
    // Strip ":line" suffix if embedded (Zephyr identifiers may use "file.c:42").
    let resolvedLine = line;
    let p = symbolPath;
    const m = p.match(/^(.*):(\d+)$/);
    if (m) {
      p = m[1];
      if (resolvedLine === undefined) { resolvedLine = parseInt(m[2], 10); }
    }

    const candidates: string[] = [];

    // On Windows, DWARF paths from cross-compilers (arm-zephyr-eabi built via
    // MSYS2) are POSIX-style (/c/Users/...) or WSL-style (/mnt/c/Users/...).
    // Convert them to usable Windows paths before falling back to others.
    const winEquiv = DashboardPanel._toWindowsPath(p);
    if (winEquiv) { candidates.push(winEquiv); }

    if (path.isAbsolute(p)) { candidates.push(p); }
    const buildFolder = this._data.summary.outputDir;
    if (buildFolder) {
      candidates.push(path.join(buildFolder, p));
      candidates.push(path.join(buildFolder, "..", p));
    }
    // APPLICATION_SOURCE_DIR from CMake — the actual project source tree root.
    const appDir = this._data.summary.application;
    if (appDir) {
      candidates.push(path.join(appDir, p));
      candidates.push(path.join(appDir, "..", p));
    }
    for (const ws of vscode.workspace.workspaceFolders ?? []) {
      candidates.push(path.join(ws.uri.fsPath, p));
    }
    // ZEPHYR_BASE from the CMake cache — reliable even when the env var is not
    // set (e.g. VS Code opened from Start menu rather than a shell).  Only
    // useful for RELATIVE paths; absolute paths are already handled above.
    const zephyrBase = this._data.summary.zephyrBase ?? process.env["ZEPHYR_BASE"];
    if (zephyrBase && !path.isAbsolute(p)) {
      candidates.push(path.join(zephyrBase, p));
    }

    for (const candidate of candidates) {
      try {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          const uri = vscode.Uri.file(candidate);
          const opts: vscode.TextDocumentShowOptions = {};
          if (resolvedLine !== undefined && resolvedLine > 0) {
            const pos = new vscode.Position(Math.max(0, resolvedLine - 1), 0);
            opts.selection = new vscode.Range(pos, pos);
          }
          await vscode.window.showTextDocument(uri, opts);
          return;
        }
      } catch { /* keep trying */ }
    }
    void vscode.window.showInformationMessage(
      `Zephyr IDE: could not locate source file for symbol: ${symbolPath}`,
    );
  }

  /**
   * Triggers a memory report refresh via the stored callback and pushes the
   * updated memory data to the webview.  Safe to call concurrently — a second
   * call while a refresh is in-progress is a no-op.
   */
  /**
   * Notify the webview that an external menuconfig/guiconfig run has finished
   * so the in-panel editor can reload the build's .config from disk.  No-op
   * if the panel is disposed.
   */
  public async notifyKconfigExternalDone(tool: "menuconfig" | "guiconfig" | "build"): Promise<void> {
    try {
      await this._panel.webview.postMessage({ command: "kconfigExternalDone", tool });
    } catch { /* panel may be disposed */ }
  }

  public async refreshMemory(): Promise<void> {
    if (this._memoryRefreshing) { return; }
    this._memoryRefreshing = true;
    await this._panel.webview.postMessage({ command: "memoryRefreshing" });
    try {
      const result = await this._onRefreshMemory();
      if (result) {
        this._data.memory = result.memory;
        this._data.summary.memorySummary = result.memorySummary;
        await this._panel.webview.postMessage({
          command: "updateMemory",
          memory: result.memory,
          memorySummary: result.memorySummary,
          error: result.error,
        });
      } else {
        await this._panel.webview.postMessage({
          command: "memoryRefreshFailed",
          error: "Memory refresh could not start. Check Zephyr IDE setup.",
        });
      }
    } catch (err) {
      await this._panel.webview.postMessage({
        command: "memoryRefreshFailed",
        error: err instanceof Error ? err.message : "Memory refresh failed unexpectedly.",
      });
    } finally {
      this._memoryRefreshing = false;
    }
  }

  private async _postData(): Promise<void> {
    await this._panel.webview.postMessage({ command: "updateContent", data: this._data });
  }

  private getHtmlShell(): string {
    const nonce = generateNonce();
    const cssUri = this._panel.webview.asWebviewUri(
      vscode.Uri.joinPath(
        vscode.Uri.file(this._extensionPath),
        "src",
        "panels",
        "dashboard_view",
        "dashboard-panel.css",
      ),
    );
    const codiconUri = this._panel.webview.asWebviewUri(
      vscode.Uri.joinPath(
        vscode.Uri.file(this._extensionPath),
        "node_modules",
        "@vscode",
        "codicons",
        "dist",
        "codicon.css",
      ),
    );
    const jsUri = this._panel.webview.asWebviewUri(
      vscode.Uri.joinPath(
        vscode.Uri.file(this._extensionPath),
        "dist",
        "webview",
        "dashboard_view",
        "dashboard-panel.js",
      ),
    );
    const cspSource = this._panel.webview.cspSource;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; font-src ${cspSource}; img-src ${cspSource} data:; script-src 'nonce-${nonce}';">
  <title>Zephyr IDE Dashboard</title>
  <link rel="stylesheet" type="text/css" href="${cssUri}">
  <link rel="stylesheet" type="text/css" href="${codiconUri}" id="vscode-codicon-stylesheet">
</head>
<body>
  <dashboard-app></dashboard-app>
  <script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
  }

  public dispose() {
    for (const [key, panel] of DashboardPanel._panels.entries()) {
      if (panel === this) {
        DashboardPanel._panels.delete(key);
        break;
      }
    }
    // Tear down the Kconfig helper subprocess if one was started.  We don't
    // await shutdown - the panel is going away and the OS will reap the
    // process; we just want to make sure dispose() returns synchronously.
    if (this._kconfigSessionPromise) {
      this._kconfigSessionPromise
        .then((s) => s.dispose())
        .catch(() => { /* already failed - nothing to dispose */ });
      this._kconfigSessionPromise = undefined;
    }
    this._panel.dispose();
    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) { x.dispose(); }
    }
  }
}
