// SPDX-License-Identifier: Apache-2.0
import * as vscode from "vscode";
import * as path from "path";
import { getProjectFolder, resolveBoardPath } from "../project_utilities/project";
import { normalizeBuildArgs, normalizeCMakeArg } from "../project_utilities/build_args";
import { primaryPaths, extraPaths } from "../project_utilities/config_selector";
import { outputInfo, outputWarning } from "../utilities/output";
import { WorkspaceConfig } from "./types";
import { discoverDependencies, projectScope, saveDependencies } from "./west-projects";
import { runWestUpdateTask, withWestUpdate } from "./west-operations";

export async function syncProjectDependencies(context: vscode.ExtensionContext, ws: WorkspaceConfig, explicit = false) {
  if (!vscode.workspace.isTrusted) { return; }
  const fetch = explicit || vscode.workspace.getConfiguration("zephyr-ide").get("autoFetchProjectModules", true);
  const key = ws.activeProject;
  const state = ws.activeSetupState;
  const project = key && ws.projects[key];
  if (!key || !project || !state?.initialized || !state.setupPath) {
    if (explicit) { void vscode.window.showInformationMessage(vscode.l10n.t("Select a project in an initialized west workspace.")); }
    return;
  }
  const setupPath = state.setupPath;
  const scope = projectScope(ws, setupPath);
  const buildKey = ws.projectStates[key]?.activeBuildConfig;
  const builds = Object.values(project.buildConfigs ?? {});
  const build = buildKey ? project.buildConfigs[buildKey] : builds.length === 1 ? builds[0] : undefined;
  const current = () => ws.activeSetupState?.setupPath === setupPath && ws.activeProject === key &&
    ws.projectStates[key]?.activeBuildConfig === buildKey && vscode.workspace.isTrusted;
  const app = getProjectFolder(ws, project);
  const entries = [...(project.confFiles?.config ?? []), ...(build?.confFiles?.config ?? [])];
  const primary = primaryPaths(entries).map(file => path.resolve(ws.rootPath, file));
  const configs = [...(primary.length ? primary : [path.join(app, "prj.conf")]), ...extraPaths(entries).map(file => path.resolve(ws.rootPath, file))];
  const cmakeArgs = normalizeBuildArgs(build?.westBuildCMakeArgs).map(normalizeCMakeArg);
  const inputs = { cmakeArgs, application: app, projectName: key, zephyr: state.zephyrDir, board: build?.board, boardDir: build && resolveBoardPath(ws, build, state), configs };
  try {
    const unknown = await withWestUpdate(setupPath, async () => {
      const attempted = new Set<string>();
      while (current()) {
        const result = await discoverDependencies(context, state, inputs);
        if (!current()) { return; }
        await saveDependencies(context, scope, result.projects, result.unresolved);
        void vscode.commands.executeCommand("zephyr-ide.update-web-view");
        const missing = result.projects.filter(p => p.missing || p.needsUpdate);
        for (const p of result.projects) { outputInfo("West", p.name + " ← " + p.sources.join(", ")); }
        if (!fetch || !missing.length) {
          if (explicit) { void vscode.window.showInformationMessage(vscode.l10n.t("Detected {0} required west modules. See the module list for target revisions.", result.projects.length)); }
          return result.unknown;
        }
        const names = missing.map(p => p.name);
        if (names.some(name => attempted.has(name))) { throw Error(vscode.l10n.t("The checkout is still missing after west update.")); }
        if (!current()) { return; }
        names.forEach(name => attempted.add(name));
        void vscode.window.showInformationMessage(vscode.l10n.t("Downloading west dependencies for {0}: {1}", key, names.join(", ")));
        if (!await runWestUpdateTask(context, state, names)) { throw Error(vscode.l10n.t("West Update Failed. Check the Zephyr IDE output for details.")); }
      }
    });
    if (unknown?.length && current()) {
      outputWarning("West", vscode.l10n.t("Required modules outside the active west manifest have no manifest revision: {0}", unknown.join(", ")), true);
    }
  } catch (error) {
    outputWarning("West", vscode.l10n.t("Could not synchronize project modules: {0}", String(error)), true);
  }
}
