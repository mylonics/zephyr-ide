// SPDX-License-Identifier: Apache-2.0
import * as vscode from "vscode";
import * as fs from "fs";
import { repositoryAddresses } from "../utilities/repository-addresses";
import * as path from "path";
import { execFile } from "child_process";
import { SetupState, WorkspaceConfig } from "./types";
import { pythonInVenv } from "../utilities/python-venv";
import { getVenvPath } from "./workspace-config";
import { parseWestConfigManifestPath } from "./west-config-parser";

export interface RemoteRevision {
  checkedAt: string;
  localHead?: string;
  sha?: string;
  error?: "unavailable" | "refMissing";
}

export interface WestProject {
  checkout: { state: "absent" | "invalid" | "cloned"; head?: string };
  remote?: RemoteRevision;
  name: string;
  url: string;
  revision: string;
  path: string;
  extra: boolean;
  imported: boolean;
}

export interface WestCatalog {
  projects: WestProject[];
  partial: boolean;
}

export interface WestSelection {
  scope: string;
  names: string[];
  all?: boolean;
  preserveSelection?: boolean;
}

export function projectScope(ws: WorkspaceConfig, root: string) {
  const key = ws.activeProject ?? "";
  return JSON.stringify([path.resolve(root), key, ws.projectStates?.[key]?.activeBuildConfig ?? ""]);
}

export interface DependencyReference {
  name: string;
  sources: string[];
  requiredBy: string[];
}

export interface DetectedDependency extends DependencyReference {
  missing: boolean;
  needsUpdate?: boolean;
}

interface ProjectSelection {
  manual: string[];
  detected: DetectedDependency[];
  excluded: string[];
  unresolved?: DependencyReference[];
}

export function projectSelection(context: vscode.ExtensionContext, scope: string): ProjectSelection {
  const current = context.workspaceState.get<ProjectSelection>("westSelection:" + scope);
  if (current) { return current; }
  // Older releases saved only a flat list per project and did not record its origin.
  const legacyScope = JSON.stringify(JSON.parse(scope).slice(0, 2));
  return { manual: context.workspaceState.get("westProjects:" + legacyScope, []), detected: [], excluded: [] };
}

export function savedProjects(context: vscode.ExtensionContext, scope: string) {
  const { manual, detected, excluded } = projectSelection(context, scope);
  return [...new Set([...manual, ...detected.map(d => d.name).filter(n => !excluded.includes(n))])];
}

export function saveProjects(context: vscode.ExtensionContext, scope: string, names: string[]) {
  const selection = projectSelection(context, scope);
  const detected = selection.detected.map(d => d.name);
  return context.workspaceState.update("westSelection:" + scope, { ...selection,
    manual: [...new Set(names.filter(n => !detected.includes(n) || selection.manual.includes(n)))],
    excluded: detected.filter(n => !names.includes(n)) });
}

export function saveDependencies(context: vscode.ExtensionContext, scope: string, detected: DetectedDependency[], unresolved: DependencyReference[] = []) {
  const { manual } = projectSelection(context, scope);
  return context.workspaceState.update("westSelection:" + scope, { manual, detected, unresolved, excluded: [] });
}

export function projectHelper(context: vscode.ExtensionContext, state: SetupState) {
  const configuredVenv = state.env.VIRTUAL_ENV;
  const python = pythonInVenv(configuredVenv || getVenvPath(state.setupPath));
  const helper = context.asAbsolutePath("resources/west_projects.py");
  if (configuredVenv || fs.existsSync(python)) { return [python, helper]; }
  return [process.platform === "win32" ? "python" : "python3", helper];
}

function invoke<T>(context: vscode.ExtensionContext, state: SetupState, action: string, input?: unknown): Promise<T> {
  const [python, helper] = projectHelper(context, state);
  return new Promise((resolve, reject) => {
    const child = execFile(python, [helper, action], {
      cwd: state.setupPath, windowsHide: true, timeout: 30000, maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    }, (error, stdout, stderr) => {
      if (error) { reject(new Error(vscode.l10n.t(stderr.trim() || error.message))); return; }
      try { resolve(JSON.parse(stdout)); } catch (e) { reject(e); }
    });
    child.stdin?.on("error", () => { /* execFile reports child errors */ });
    child.stdin?.end(input === undefined ? undefined : JSON.stringify(input));
  });
}

export interface DependencyInputs {
  cmakeArgs: string[]; application: string; projectName: string; zephyr: string; board?: string; boardDir?: string; configs: string[];
}

export function discoverDependencies(context: vscode.ExtensionContext, state: SetupState, inputs: DependencyInputs) {
  return invoke<{ projects: DetectedDependency[]; unknown: string[]; unresolved?: DependencyReference[] }>(
    context, state, "dependencies", inputs);
}

function remoteKey(state: SetupState, p: WestProject) {
  return "westRemote:" + JSON.stringify([path.resolve(state.setupPath), p.name, p.url, p.revision]);
}

export async function checkWestRemote(context: vscode.ExtensionContext, state: SetupState, project: WestProject) {
  const remote = await invoke<RemoteRevision>(context, state, "remote-revision", project);
  await context.workspaceState.update(remoteKey(state, project), { ...remote, localHead: project.checkout.head });
}

export async function readWestCatalog(context: vscode.ExtensionContext, state: SetupState) {
  const data = await invoke<WestCatalog>(context, state, "list");
  for (const p of data.projects) { p.remote = context.workspaceState.get<RemoteRevision>(remoteKey(state, p)); }
  data.projects.sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }) || a.name.localeCompare(b.name, "en"));
  return data;
}

export async function chooseWestProjects(context: vscode.ExtensionContext, ws: WorkspaceConfig, state: SetupState, request?: WestSelection) {
  const scope = projectScope(ws, state.setupPath);
  if (request && request.scope !== scope) { return; }
  let selection = request;
  if (!selection) {
    const saved = savedProjects(context, scope);
    const { projects, partial } = await readWestCatalog(context, state);
    const { detected } = projectSelection(context, scope);
    const allLabel = vscode.l10n.t("Run a full west update");
    const items: (vscode.QuickPickItem & { name?: string })[] = [
      { label: allLabel, alwaysShow: true },
    ];
    for (const extra of [false, true]) {
      items.push({ label: extra ? vscode.l10n.t("Additional repositories") : vscode.l10n.t("Manifest repositories"), kind: vscode.QuickPickItemKind.Separator });
      items.push(...projects.filter(p => p.extra === extra).map(p => ({
        name: p.name, label: p.name, description: p.path, picked: saved.includes(p.name),
        detail: [p.revision, detected.find(d => d.name === p.name)?.requiredBy.join(", ")].filter(Boolean).join(" ← "),
      })));
    }
    const picked = await vscode.window.showQuickPick(items, { canPickMany: true, matchOnDescription: true,
      title: vscode.l10n.t("Select west projects to update"),
      placeHolder: partial ? vscode.l10n.t("Update the manifest provider and refresh to see its modules.") : vscode.l10n.t("Select the modules required by this project") });
    if (!picked?.length) { return; }
    selection = { scope, names: picked.flatMap(i => i.name ? [i.name] : []), all: picked.some(i => i.label === allLabel && !i.name) };
  }
  if (selection.all === true) {
    const confirm = vscode.l10n.t("Run a full west update");
    if ((request || selection.names.length) && await vscode.window.showWarningMessage(vscode.l10n.t("Download all active projects in this west workspace?"), { modal: true }, confirm) !== confirm) { return; }
  } else {
    if (!Array.isArray(selection.names) || !selection.names.length || !selection.names.every(n => typeof n === "string")) { return; }
    if (!selection.preserveSelection) { await saveProjects(context, scope, selection.names); }
  }
  if (!ws.activeSetupState || scope !== projectScope(ws, ws.activeSetupState.setupPath)) { return; }
  return selection;
}

function gitProject(input: string, revision: string, destination: string, existing?: WestProject) {
  const invalid = () => Error(vscode.l10n.t("Enter a Git repository address or GitHub commit URL."));
  if (/\s/.test(input)) { throw invalid(); }
  let url = input;
  let sha = "";
  const scp = /^[\w.-]+@[\w.-]+:([\w./-]+)$/.exec(url);
  let pathname = scp?.[1];
  if (!pathname) {
    if (/^[\w-]+\/[\w.-]+$/.test(url)) { url = "https://github.com/" + url; }
    let parsed: URL;
    try { parsed = new URL(url); } catch { throw invalid(); }
    if (!["https:", "http:", "ssh:", "git:"].includes(parsed.protocol) || !parsed.hostname ||
        parsed.password || parsed.search || parsed.hash || (parsed.username && parsed.protocol !== "ssh:")) { throw invalid(); }
    pathname = parsed.pathname.replace(/^\/|\/$/g, "");
    if (parsed.hostname.toLowerCase() === "github.com") {
      const match = /^([\w.-]+\/[\w.-]+)(?:\/(?:commit|pull\/\d+\/commits)\/([a-f\d]{7,64}))?$/i.exec(pathname);
      if (!match) { throw invalid(); }
      pathname = match[1];
      sha = match[2] ?? "";
      parsed.pathname = "/" + pathname;
      url = parsed.toString();
    }
  }
  const segments = pathname.split("/");
  if (!segments.every(s => /^[\w.-]+$/.test(s) && s !== "." && s !== "..")) { throw invalid(); }
  const repo = segments[segments.length - 1].replace(/\.git$/i, "");
  if (!/^[\w][\w.-]*$/.test(repo)) { throw invalid(); }
  const name = existing?.name ?? repo;
  revision = revision.trim();
  if (sha && revision && sha !== revision) { throw Error(vscode.l10n.t("The revision must match the commit URL.")); }
  const checkout = destination.trim() || (name.startsWith("hal_") ? "modules/hal/" + name.slice(4) : "modules/lib/" + name);
  if (!checkout.split("/").every(segment => /^[a-z\d_][\w.-]*$/i.test(segment) && !segment.endsWith("."))) {
    throw Error(vscode.l10n.t("Enter a relative checkout path inside the workspace."));
  }
  return { name, url, revision: sha || revision || "HEAD", path: checkout,
    ...(!existing ? { userdata: { "zephyr-ide-additional": true } } : {}) };
}

interface WestProjectEdit { url?: string; revision?: string; destination?: string; remove?: string; previous?: string }

export async function editWestProject(context: vscode.ExtensionContext, state: SetupState, input: WestProjectEdit) {
  const file = parseWestConfigManifestPath(state.setupPath);
  if (!file) { throw Error(vscode.l10n.t("West manifest not found.")); }
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
  if (doc.isDirty) { throw Error(vscode.l10n.t("Save your manifest edits and try again.")); }
  const version = doc.version;
  const { projects } = await readWestCatalog(context, state);
  const previous = input.previous || input.remove;
  const existing = projects.find(p => p.name === previous);
  if (previous && !existing) { throw Error(vscode.l10n.t("The manifest changed. Refresh and try again.")); }
  const lines = repositoryAddresses(input.url ?? "");
  if (!input.remove && (!lines.length || (existing && lines.length !== 1))) {
    throw Error(vscode.l10n.t("Enter one repository per line."));
  }
  const normalize = (p: string) => process.platform === "win32" ? p.toLowerCase() : p;
  const others = projects.filter(p => p !== existing);
  const names = new Set(others.map(p => p.name.toLowerCase()));
  const paths = others.map(p => normalize(path.resolve(state.setupPath, p.path)));
  const manifestDir = normalize(path.dirname(path.resolve(file)));
  if (manifestDir !== normalize(path.resolve(state.setupPath))) { paths.push(manifestDir); }
  const entries = lines.map(line => {
    try {
      const single = lines.length === 1;
      const p = gitProject(line.url, single ? input.revision ?? "" : "", single ? input.destination ?? "" : "", existing);
      const dest = normalize(path.resolve(state.setupPath, p.path));
      let ancestor = dest;
      while (!fs.existsSync(ancestor)) { ancestor = path.dirname(ancestor); }
      const relative = path.relative(fs.realpathSync(state.setupPath), fs.realpathSync(ancestor));
      if (relative.split(path.sep)[0] === ".." || path.isAbsolute(relative)) {
        throw Error(vscode.l10n.t("Enter a relative checkout path inside the workspace."));
      }
      if (p.name.toLowerCase() === "manifest" || names.has(p.name.toLowerCase()) ||
          paths.some(other => dest === other || dest.startsWith(other + path.sep) || other.startsWith(dest + path.sep))) {
        throw Error(vscode.l10n.t("A project already uses this name or checkout path."));
      }
      names.add(p.name.toLowerCase());
      paths.push(dest);
      return p;
    } catch (error) {
      throw Error(vscode.l10n.t("Line {0}: {1}", line.number, error instanceof Error ? error.message : String(error)));
    }
  });
  const source = doc.getText();
  const edited = await invoke<{ content: string; wrapper: boolean }>(context, state, "edit", { source, entries, previous, remove: !!input.remove });
  if (doc.isDirty || doc.version !== version) { throw Error(vscode.l10n.t("The manifest changed. Refresh and try again.")); }
  if (edited.wrapper) {
    await invoke(context, state, "activate-overlay", { file, source, content: edited.content });
    return input.remove ? undefined : [];
  }
  const edit = new vscode.WorkspaceEdit();
  edit.replace(doc.uri, new vscode.Range(doc.positionAt(0), doc.positionAt(source.length)), edited.content);
  if (!await vscode.workspace.applyEdit(edit) || !await doc.save()) { throw Error(vscode.l10n.t("Could not save the west manifest.")); }
  return input.remove ? undefined : existing ? [] : entries.map(p => p.name);
}
