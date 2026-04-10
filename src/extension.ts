/*
Copyright 2024 mylonics 
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

import * as vscode from "vscode";
import path from "upath";
import * as fs from "fs";

import { ActiveProjectView } from "./tree_views/ActiveProjectView";
import { ProjectTreeView, getUseGuiConfig } from "./tree_views/ProjectTreeView";
import { ExtensionSetupView } from "./tree_views/ExtensionSetupView";
import { WestWorkspaceView } from "./tree_views/WestWorkspaceView";
import { ProjectConfigView } from "./tree_views/ProjectConfigView";
import { SetupPanel } from "./panels/setup_panel/SetupPanel";
import { HostToolInstallView } from "./panels/host_tool_install_view/HostToolInstallView";

import {
  output,
  executeShellCommand,
  executeShellCommandInPythonEnv,
  reloadEnvironmentVariables,
  getLaunchConfigurationByName,
  getPlatformName,
  getPlatformArch,
  isWSL,
  resolveConfigInputs,
} from "./utilities/utils";
import { notifyError, outputInfo, outputError, outputLine, outputCommandFailure, getDebugOutput, clearDebugOutput } from "./utilities/output";
import * as project from "./project_utilities/project";
import {
  buildHelper,
  buildMenuConfig,
  buildRamRomReport,
  buildRamRomReportHeadless,
  runDtshShell,
  clean,
  MenuConfig,
  build,
} from "./zephyr_utilities/build";
import { flashActive } from "./zephyr_utilities/flash";
import { WorkspaceConfig, GlobalConfig } from "./setup_utilities/types";
import {
  loadGlobalState,
  setSetupState,
  setWorkspaceState,
  loadWorkspaceState,
  clearWorkspaceState,
  saveSetupState,
  clearSetupState,
} from "./setup_utilities/state-management";
import {
  getVariable,
  loadProjectsFromFile,
  getToolchainDir,
  getToolchainPath,
  migrateToolsDirectory,
  setWorkspaceSettings,
  getSetupState,
  getGdbPath,
  getArmGdbPath,
  getZephyrElfPath,
  getZephyrElfDir,
} from "./setup_utilities/workspace-config";
import { checkIfToolsAvailable } from "./setup_utilities/tools-validation";
import {
  westInit,
  setForceNarrowUpdateForTest,
  setupWestEnvironment,
  westUpdateWithRequirements,
} from "./setup_utilities/west-operations";
import {
  showWorkspaceSetupPicker,
  showCreateWorkspaceMenu,
  workspaceSetupFromGit,
  workspaceSetupFromWestGit,
  workspaceSetupFromCurrentDirectory,
  workspaceSetupStandard,
  manageWorkspaces,
  westConfig,
  selectExistingWestWorkspace,
} from "./setup_utilities/workspace-setup";
import {
  initializeDtsExt,
  printContexts,
  setDtsContext,
} from "./setup_utilities/dts_interface";
import {
  setActiveProject,
  getResolvedRunnerName,
  resolveActiveProjectBuild,
  resolveActiveProject,
} from "./project_utilities/project";
import { testHelper, deleteTestDirs } from "./zephyr_utilities/twister";

import { getModuleVersion, getModuleList } from "./setup_utilities/modules";
import { reconfigureTest } from "./project_utilities/twister_selector";
import { installSDKInteractive } from "./setup_utilities/west_sdk";
import {
  installPackageManagerHeadless,
  installHostPackagesHeadless,
  installHostToolsHeadless,
  checkHostToolsHeadless,
} from "./setup_utilities/host_tools";

// Helper function to mark workspace setup as complete and refresh UI
async function markWorkspaceSetupComplete(
  context: vscode.ExtensionContext,
  wsConfig: WorkspaceConfig,
  globalConfig: GlobalConfig
) {
  wsConfig.initialSetupComplete = true;
  await setWorkspaceState(context, wsConfig);
  // Update setup panel if it's open
  if (SetupPanel.currentPanel) {
    SetupPanel.currentPanel.updateContent(wsConfig, globalConfig, "workspace");
  }
}

/** Register a webview view provider with retained context. */
function registerWebviewView(
  context: vscode.ExtensionContext,
  viewId: string,
  provider: vscode.WebviewViewProvider
) {
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(viewId, provider,
      { webviewOptions: { retainContextWhenHidden: true } })
  );
}

/** Register a native TreeDataProvider view and wire up expand/collapse handlers if present. */
function registerTreeView<T>(
  context: vscode.ExtensionContext,
  viewId: string,
  provider: vscode.TreeDataProvider<T> & { treeView?: vscode.TreeView<T>; handleExpand?(e: T): void; handleCollapse?(e: T): void },
): vscode.TreeView<T> {
  const tv = vscode.window.createTreeView(viewId, { treeDataProvider: provider });
  context.subscriptions.push(tv);
  if ('treeView' in provider) {
    provider.treeView = tv;
  }
  if (provider.handleExpand) {
    context.subscriptions.push(tv.onDidExpandElement(e => provider.handleExpand!(e.element)));
  }
  if (provider.handleCollapse) {
    context.subscriptions.push(tv.onDidCollapseElement(e => provider.handleCollapse!(e.element)));
  }
  return tv;
}

/** Register a command that fires update-web-view after its action completes. */
function registerCommandWithRefresh(
  context: vscode.ExtensionContext,
  commandId: string,
  action: () => Promise<any>
) {
  context.subscriptions.push(
    vscode.commands.registerCommand(commandId, async () => {
      const result = await action();
      void vscode.commands.executeCommand("zephyr-ide.update-web-view");
      return result;
    })
  );
}

/** Create a left-aligned status bar item, register it, and show it. */
function createStatusBarButton(
  context: vscode.ExtensionContext,
  command: string,
  text: string,
  tooltip: string
): vscode.StatusBarItem {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  item.command = command;
  item.text = text;
  item.tooltip = tooltip;
  item.show();
  context.subscriptions.push(item);
  return item;
}

/** Register a workspace-setup command that calls markWorkspaceSetupComplete on success. */
function registerWorkspaceSetupCommand(
  context: vscode.ExtensionContext,
  commandId: string,
  setupFn: (ctx: vscode.ExtensionContext, ws: WorkspaceConfig, gc: GlobalConfig, ...extra: any[]) => Promise<any>,
  ...extraArgs: any[]
) {
  context.subscriptions.push(
    vscode.commands.registerCommand(commandId, async () => {
      const success = await setupFn(context, wsConfig, globalConfig, ...extraArgs);
      if (success) {
        await markWorkspaceSetupComplete(context, wsConfig, globalConfig);
      }
      return success;
    })
  );
}

/**
 * Start a debug session by passing the launch configuration name to VS Code.
 * VS Code resolves variables and settings from launch.json automatically.
 *
 * When a workspace folder is passed to startDebugging, VS Code only searches
 * that folder's .vscode/launch.json.  Configs defined at workspace level
 * (e.g. in a .code-workspace file) are NOT found that way, so we look up the
 * config first and only pass a folder when the config actually lives there.
 */
async function startDebugSession(
  context: vscode.ExtensionContext,
  wsConfig: WorkspaceConfig,
  mode: 'debug' | 'attach' | 'build-debug'
) {
  const defaults: Record<string, string> = {
    'debug': 'Zephyr IDE: Debug',
    'attach': 'Zephyr IDE: Attach',
    'build-debug': 'Zephyr IDE: Debug',
  };

  const resolved = resolveActiveProjectBuild(wsConfig);
  const activeBuild = resolved?.build;

  const targetKeys: Record<string, { name: 'buildDebugTarget' | 'launchTarget' | 'attachTarget'; folder: 'buildDebugTargetFolder' | 'launchTargetFolder' | 'attachTargetFolder' }> = {
    'build-debug': { name: 'buildDebugTarget', folder: 'buildDebugTargetFolder' },
    'debug': { name: 'launchTarget', folder: 'launchTargetFolder' },
    'attach': { name: 'attachTarget', folder: 'attachTargetFolder' },
  };

  const keys = targetKeys[mode];
  const debugTarget = activeBuild?.[keys.name] || defaults[mode];
  const debugTargetFolder = activeBuild?.[keys.folder];

  if (mode === 'build-debug') {
    if (!resolved) {
      notifyError("Debug", "No active project or build configuration found");
      return;
    }
    const res = await build(context, wsConfig, resolved.project, resolved.build, false);
    if (!res) {
      return;
    }
  }

  // Determine the correct folder to pass to startDebugging.
  // When a name (string) is passed, VS Code searches only the given folder's
  // .vscode/launch.json.  If the config lives at workspace level (e.g. in a
  // .code-workspace file) there is no per-folder launch.json and VS Code
  // fails with "launch.json does not exist for passed workspace folder".
  // Look up the config to see where it actually lives.
  const config = await getLaunchConfigurationByName(wsConfig, debugTarget, debugTargetFolder);
  const resolvedFolderName = config?.workspaceFolder;
  const folder = resolvedFolderName
    ? vscode.workspace.workspaceFolders?.find(f => f.name === resolvedFolderName)
    : undefined;

  // When the config lives at workspace level (.code-workspace) rather than in
  // a folder's launch.json, pass the full config object so VS Code doesn't
  // attempt a folder-scoped name lookup that would fail.  We also need to
  // resolve ${input:...} variables ourselves since VS Code only does that for
  // configs it looks up by name from a settings source.
  let nameOrConfig: string | vscode.DebugConfiguration = debugTarget;
  if (config && !resolvedFolderName) {
    const { workspaceFolder: _wf, ...debugConfig } = config;
    const resolvedConfig = await resolveConfigInputs(debugConfig as vscode.DebugConfiguration);
    if (!resolvedConfig) {
      return; // user cancelled an input prompt or an input was undefined
    }
    nameOrConfig = resolvedConfig;
  }

  const started = await vscode.debug.startDebugging(folder, nameOrConfig);
  if (!started) {
    const sessionLabel = mode === 'attach' ? 'attach session' : 'debug session';
    notifyError("Debug", `Failed to start ${sessionLabel}: "${debugTarget}"` +
      `\nWorkspace folder: ${folder?.name || '(default)'}` +
      `\nCheck the Debug Console and Output panel for more details.`);
  }
}

let wsConfig: WorkspaceConfig;
let globalConfig: GlobalConfig;

let activeProjectDisplay: vscode.StatusBarItem;
let activeBuildDisplay: vscode.StatusBarItem;
let activeRunnerDisplay: vscode.StatusBarItem;

// Function to get current workspace configuration for testing
export function getWorkspaceConfig(): WorkspaceConfig {
  return wsConfig;
}

export async function activate(context: vscode.ExtensionContext) {
  context.environmentVariableCollection.persistent = false;

  // Log detected platform information early, before any output clears
  const platformName = getPlatformName() ?? "unknown";
  const platformArch = getPlatformArch();
  const remoteName = vscode.env.remoteName;
  outputInfo("Startup", `Platform: ${platformName} (${platformArch})${remoteName ? `, remote: ${remoteName}` : ""}${isWSL() ? " [WSL]" : ""}`);

  // Migrate deprecated tools_directory setting to global_directory
  await migrateToolsDirectory();

  wsConfig = await loadWorkspaceState(context);
  globalConfig = await loadGlobalState(context);

  if (wsConfig.activeSetupState) {
    await setSetupState(
      context,
      wsConfig,
      globalConfig,
      wsConfig.activeSetupState.setupPath
    );
  }

  if (
    wsConfig.activeSetupState &&
    wsConfig.activeSetupState.zephyrVersion === undefined &&
    wsConfig.activeSetupState.zephyrDir
  ) {
    wsConfig.activeSetupState.zephyrVersion = await getModuleVersion(
      wsConfig.activeSetupState.zephyrDir
    );
  }

  reloadEnvironmentVariables(context, wsConfig.activeSetupState);

  const activeProjectView = new ActiveProjectView(
    context.extensionPath,
    context,
    wsConfig
  );
  const projectTreeView = new ProjectTreeView(
    context.extensionPath,
    context,
    wsConfig
  );
  const projectConfigView = new ProjectConfigView(
    context.extensionPath,
    context,
    wsConfig
  );
  const extensionSetupView = new ExtensionSetupView(
    context.extensionPath,
    context,
    wsConfig,
    globalConfig
  );
  const westWorkspaceView = new WestWorkspaceView(
    context.extensionPath,
    context,
    wsConfig,
    globalConfig
  );

  /** Update status bar buttons to reflect the currently active project/build/runner. */
  function refreshStatusBar(updateProject = false) {
    if (updateProject && wsConfig.activeProject) {
      activeProjectDisplay.text = `$(folder) ${wsConfig.activeProject}`;
    }
    const resolved = resolveActiveProjectBuild(wsConfig);
    if (resolved) {
      activeBuildDisplay.text = `$(project) ${resolved.buildName}`;
      const activeRunner = getResolvedRunnerName(wsConfig, resolved);
      activeRunnerDisplay.text = activeRunner ? `$(chip) ${activeRunner}` : ``;
    } else {
      activeBuildDisplay.text = ``;
      activeRunnerDisplay.text = ``;
    }
    return resolved;
  }

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.update-status", () => {
      if (wsConfig.activeProject) {
        const resolved = refreshStatusBar(true);
        if (resolved) {
          void setDtsContext(wsConfig, resolved.project, resolved.build);
        }
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.print-workspace", async () => {
      const structure = await printWorkspaceStructure(wsConfig.rootPath);
      outputInfo("Workspace", "Directory Structure:");
      outputLine(structure);
      return structure;
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.print-python-path", async () => {
      if (!wsConfig.activeSetupState) {
        const errorMsg = "No active setup state. Please initialize the workspace first.";
        outputError("Python Path", errorMsg);
        return { error: errorMsg };
      }

      // Use simple string formatting instead of f-strings to avoid shell escaping issues
      const pythonScript = `import sys; print('Python interpreter path: ' + sys.executable)`;
      const cmd = `python -c "${pythonScript}"`;

      try {
        const result = await executeShellCommandInPythonEnv(cmd, wsConfig.rootPath, wsConfig.activeSetupState, false);
        if (result.stdout) {
          outputInfo("Python Path", result.stdout.trim());
          return { stdout: result.stdout, stderr: result.stderr };
        } else {
          outputCommandFailure("Python Path", result);
          return { error: result.stderr || "No output from Python command" };
        }
      } catch (error) {
        const errorMsg = `Failed to execute Python command: ${error}`;
        outputError("Python Path", errorMsg);
        return { error: errorMsg };
      }
    })
  );

  // -- Register native TreeViews --
  const activeProjectTreeView = registerTreeView(context, "zephyrIdeActiveProject", activeProjectView);
  registerTreeView(context, "zephyrIdeProjects", projectTreeView);
  registerTreeView(context, "zephyrIdeProjectStatus", projectConfigView);
  registerTreeView(context, "zephyrIdeExtensionSetup", extensionSetupView);
  registerTreeView(context, "zephyrIdeWestWorkspaces", westWorkspaceView);

  // -- ActiveProjectView inline action commands --
  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.active-view.gui-config", (item: any) => {
      void buildMenuConfig(context, wsConfig, MenuConfig.GuiConfig);
    }),
    vscode.commands.registerCommand("zephyr-ide.active-view.menu-config", (item: any) => {
      void buildMenuConfig(context, wsConfig, MenuConfig.MenuConfig);
    }),
    vscode.commands.registerCommand("zephyr-ide.active-view.change-launch-target", (item: any) => {
      if (item?.launchChangeCmd) {
        void vscode.commands.executeCommand(item.launchChangeCmd);
      }
    }),
    vscode.commands.registerCommand("zephyr-ide.active-view.clean-test-dirs", () => {
      const resolved = resolveActiveProject(wsConfig, { caller: "Clean Test Dirs" });
      if (resolved) {
        deleteTestDirs(wsConfig, resolved.project);
      }
    }),
  );

  // -- WestWorkspaceView inline action commands --
  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.west-workspace.activate", (item: any) => {
      westWorkspaceView.handleActivate(item);
    }),
    vscode.commands.registerCommand("zephyr-ide.west-workspace.deselect", () => {
      westWorkspaceView.handleDeselect();
    }),
    vscode.commands.registerCommand("zephyr-ide.west-workspace.delete", (item: any) => {
      westWorkspaceView.handleDelete(item);
    }),
  );

  // -- ProjectConfigView inline action + click commands --
  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.config-view.open-board-dtc", (item: any) => {
      projectConfigView.handleOpenBoardDtc(item);
    }),
    vscode.commands.registerCommand("zephyr-ide.config-view.open-main", (item: any) => {
      projectConfigView.handleOpenMain(item);
    }),
    vscode.commands.registerCommand("zephyr-ide.config-view.open-cmake", (item: any) => {
      projectConfigView.handleOpenCmake(item);
    }),
    vscode.commands.registerCommand("zephyr-ide.config-view.modify-build-args", (item: any) => {
      projectConfigView.handleModifyBuildArgs(item);
    }),
    vscode.commands.registerCommand("zephyr-ide.config-view.modify-test-args", (item: any) => {
      projectConfigView.handleModifyTestArgs(item);
    }),
    vscode.commands.registerCommand("zephyr-ide.config-view.add-file", (item: any) => {
      projectConfigView.handleAddFile(item);
    }),
    vscode.commands.registerCommand("zephyr-ide.config-view.delete-file", (item: any) => {
      projectConfigView.handleDeleteFile(item);
    }),
  );

  // -- ProjectTreeView inline action commands --
  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.tree-view.select", (item: any) => {
      projectTreeView.handleSelect(item);
    }),
    vscode.commands.registerCommand("zephyr-ide.tree-view.add-build", (item: any) => {
      projectTreeView.handleSharedCommand("addBuild", item);
    }),
    vscode.commands.registerCommand("zephyr-ide.tree-view.add-test", (item: any) => {
      projectTreeView.handleAddTest(item);
    }),
    vscode.commands.registerCommand("zephyr-ide.tree-view.delete-project", (item: any) => {
      projectTreeView.handleSharedCommand("deleteProject", item);
    }),
    vscode.commands.registerCommand("zephyr-ide.tree-view.build", (item: any) => {
      projectTreeView.handleSharedCommand("build", item);
    }),
    vscode.commands.registerCommand("zephyr-ide.tree-view.build-pristine", (item: any) => {
      projectTreeView.handleSharedCommand("buildPristine", item);
    }),
    vscode.commands.registerCommand("zephyr-ide.tree-view.config", (item: any) => {
      const useGui = getUseGuiConfig();
      projectTreeView.handleSharedCommand(useGui ? "guiConfig" : "menuConfig", item);
    }),
    vscode.commands.registerCommand("zephyr-ide.tree-view.add-runner", (item: any) => {
      projectTreeView.handleSharedCommand("addRunner", item);
    }),
    vscode.commands.registerCommand("zephyr-ide.tree-view.delete-build", (item: any) => {
      projectTreeView.handleSharedCommand("deleteBuild", item);
    }),
    vscode.commands.registerCommand("zephyr-ide.tree-view.flash", (item: any) => {
      projectTreeView.handleSharedCommand("flash", item);
    }),
    vscode.commands.registerCommand("zephyr-ide.tree-view.delete-runner", (item: any) => {
      projectTreeView.handleSharedCommand("deleteRunner", item);
    }),
    vscode.commands.registerCommand("zephyr-ide.tree-view.test", (item: any) => {
      projectTreeView.handleTest(item);
    }),
    vscode.commands.registerCommand("zephyr-ide.tree-view.delete-test", (item: any) => {
      projectTreeView.handleDeleteTest(item);
    }),
  );

  registerCommandWithRefresh(context, "zephyr-ide.set-active-runner",
    () => project.setActiveRunner(context, wsConfig));

  activeProjectDisplay = createStatusBarButton(context,
    "zephyr-ide.set-active-project", `$(folder) ${wsConfig.activeProject}`, "Zephyr IDE Active Project");

  activeBuildDisplay = createStatusBarButton(context,
    "zephyr-ide.set-active-build", ``, "Zephyr IDE Active Build");
  activeRunnerDisplay = createStatusBarButton(context,
    "zephyr-ide.set-active-runner", ``, "Zephyr IDE Active Runner");
  {
    refreshStatusBar();
  }

  createStatusBarButton(context, "zephyr-ide.build-pristine", `$(debug-rerun)`, "Zephyr IDE Build Pristine");
  createStatusBarButton(context, "zephyr-ide.build", `$(play)`, "Zephyr IDE Build");
  createStatusBarButton(context, "zephyr-ide.flash", `$(arrow-circle-up)`, "Zephyr IDE Flash");
  createStatusBarButton(context, "zephyr-ide.debug", `$(debug-alt)`, "Zephyr IDE Debug");

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((handleChange) => {
      if (wsConfig.automaticProjectSelection && handleChange) {
        const filePath = path.relative(
          wsConfig.rootPath,
          handleChange.document.uri.fsPath
        );

        for (const key in wsConfig.projects) {
          if (filePath.includes(wsConfig.projects[key].rel_path)) {
            if (wsConfig.activeProject !== key) {
              void setActiveProject(context, wsConfig, key)
                .then(() => refreshStatusBar(true))
                .catch(err => outputError("Extension", `Failed to set active project: ${err}`));
            }
            void vscode.commands.executeCommand("zephyr-ide.update-web-view");
          }
        }
      }
    })
  );

  // Extension/Workspace Setup Commands
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "zephyr-ide.check-build-dependencies",
      async () => {
        const res = await checkIfToolsAvailable(context, wsConfig, globalConfig);

        if (res) {
          void vscode.commands.executeCommand(
            "setContext",
            "buildDependenciesAvailable",
            true
          );
        }
        extensionSetupView.updateWebView(wsConfig, globalConfig);
        return res;
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.setup-west-environment", async () => {
      if (wsConfig.rootPath !== "" && wsConfig.activeSetupState) {
        await setupWestEnvironment(context, wsConfig, globalConfig);
        extensionSetupView.updateWebView(wsConfig, globalConfig);
      } else {
        notifyError("West Environment", "Open Folder or Setup Workspace Before Continuing");
      }
    }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.west-init", async () => {
      if (
        wsConfig.activeSetupState &&
        wsConfig.activeSetupState.pythonEnvironmentSetup
      ) {
        await westInit(context, wsConfig, globalConfig);
        extensionSetupView.updateWebView(wsConfig, globalConfig);
      } else {
        notifyError("West Init",
          "Run `Zephyr IDE: Setup West Environment` first."
        );
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.west-update", async () => {
      await westUpdateWithRequirements(context, wsConfig, globalConfig);
      extensionSetupView.updateWebView(wsConfig, globalConfig);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.reset-workspace", async () => {
      await clearWorkspaceState(context, wsConfig);
      extensionSetupView.updateWebView(wsConfig, globalConfig);
      // Also update setup panel if it's open
      if (SetupPanel.currentPanel) {
        SetupPanel.currentPanel.updateContent(wsConfig, globalConfig);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.clear-projects", async () => {
      const selection = await vscode.window.showWarningMessage(
        "Are you sure you want to Clear All Projects?",
        "Yes",
        "Cancel"
      );
      if (selection !== "Yes") {
        return;
      }
      wsConfig.projects = {};
      wsConfig.activeProject = undefined;
      await setWorkspaceState(context, wsConfig);
      void vscode.commands.executeCommand("zephyr-ide.update-web-view");
      extensionSetupView.updateWebView(wsConfig, globalConfig);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "zephyr-ide.load-projects-from-file",
      async () => {
        await loadProjectsFromFile(wsConfig);
        void vscode.commands.executeCommand("zephyr-ide.update-web-view");
        extensionSetupView.updateWebView(wsConfig, globalConfig);
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "zephyr-ide.save-projects-to-file",
      async () => {
        await setWorkspaceState(context, wsConfig);
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "zephyr-ide.disable-automatic-project-target",
      async () => {
        wsConfig.automaticProjectSelection = false;
        await setWorkspaceState(context, wsConfig);
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "zephyr-ide.enable-automatic-project-target",
      async () => {
        wsConfig.automaticProjectSelection = true;
        await setWorkspaceState(context, wsConfig);
      }
    )
  );

  // Project Setup Commands
  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.create-project", async () => {
      const projectPath = await project.createNewProjectFromSample(context, wsConfig);
      if (projectPath !== undefined) {
        const result = await project.addProject(wsConfig, context, projectPath);
        extensionSetupView.updateWebView(wsConfig, globalConfig);
        void vscode.commands.executeCommand("zephyr-ide.update-web-view");
        return result;
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.add-project", async () => {
      const result = await project.addProject(wsConfig, context, undefined);
      extensionSetupView.updateWebView(wsConfig, globalConfig);
      void vscode.commands.executeCommand("zephyr-ide.update-web-view");
      return result;
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.remove-project", async () => {
      await project.removeProject(context, wsConfig);
      void vscode.commands.executeCommand("zephyr-ide.update-web-view");
    })
  );

  // Config/overlay file commands (data-driven to eliminate duplication)
  const configFileCommands: Array<{ cmd: string; fn: typeof project.addConfigFiles; isConfig: boolean; isProject: boolean }> = [
    { cmd: "add-project-config-files", fn: project.addConfigFiles, isConfig: true, isProject: true },
    { cmd: "remove-project-config-files", fn: project.removeConfigFiles, isConfig: true, isProject: true },
    { cmd: "add-project-overlay-files", fn: project.addConfigFiles, isConfig: false, isProject: true },
    { cmd: "remove-project-overlay-files", fn: project.removeConfigFiles, isConfig: false, isProject: true },
    { cmd: "add-build-config-files", fn: project.addConfigFiles, isConfig: true, isProject: false },
    { cmd: "remove-build-config-files", fn: project.removeConfigFiles, isConfig: true, isProject: false },
    { cmd: "add-build-overlay-files", fn: project.addConfigFiles, isConfig: false, isProject: false },
    { cmd: "remove-build-overlay-files", fn: project.removeConfigFiles, isConfig: false, isProject: false },
  ];
  for (const { cmd, fn, isConfig, isProject } of configFileCommands) {
    registerCommandWithRefresh(context, `zephyr-ide.${cmd}`,
      () => fn(context, wsConfig, isConfig, isProject));
  }

  registerCommandWithRefresh(context, "zephyr-ide.set-active-project",
    () => project.setActiveProject(context, wsConfig));

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.add-build", async () => {
      const setupState = await getSetupState(context, wsConfig);
      if (setupState && setupState.westUpdated) {
        const result = await project.addBuild(wsConfig, context);
        void vscode.commands.executeCommand("zephyr-ide.update-web-view");
        return result;
      } else {
        notifyError("Build Config", "Run `Zephyr IDE: West Update` first.");
      }
      return false;
    })
  );

  registerCommandWithRefresh(context, "zephyr-ide.remove-build",
    () => project.removeBuild(context, wsConfig));

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.add-test", async () => {
      const setupState = await getSetupState(context, wsConfig);
      if (setupState && setupState.westUpdated) {
        await project.addTest(wsConfig, context);
        void vscode.commands.executeCommand("zephyr-ide.update-web-view");
      } else {
        notifyError("Test Config", "Run `Zephyr IDE: West Update` first.");
      }
    })
  );

  registerCommandWithRefresh(context, "zephyr-ide.remove-test",
    () => project.removeTest(context, wsConfig));

  registerCommandWithRefresh(context, "zephyr-ide.set-active-test",
    () => project.setActiveTest(context, wsConfig));

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.run-test", async () => {
      await testHelper(context, wsConfig);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.remove-test-dirs", async () => {
      const resolved = resolveActiveProject(wsConfig, { caller: "Remove Test Dirs" });
      if (resolved) {
        deleteTestDirs(wsConfig, resolved.project);
      }
    })
  );

  registerCommandWithRefresh(context, "zephyr-ide.reconfigure-active-test", async () => {
    const resolved = resolveActiveProject(wsConfig, { caller: "Reconfigure Test" });
    if (resolved) {
      const activeTest = project.getResolvedTestConfig(wsConfig, resolved);
      if (activeTest) {
        await reconfigureTest(activeTest);
        await setWorkspaceState(context, wsConfig);
      }
    }
  });

  registerCommandWithRefresh(context, "zephyr-ide.set-active-build",
    () => project.setActiveBuild(context, wsConfig));

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.add-runner", async () => {
      const setupState = await getSetupState(context, wsConfig);
      if (setupState && setupState.westUpdated) {
        await project.addRunner(wsConfig, context);
        void vscode.commands.executeCommand("zephyr-ide.update-web-view");
      } else {
        notifyError("Runner Config", "Run `Zephyr IDE: West Update` first.");
      }
    })
  );

  registerCommandWithRefresh(context, "zephyr-ide.remove-runner",
    () => project.removeRunner(context, wsConfig));

  registerCommandWithRefresh(context, "zephyr-ide.change-debug-launch-for-build",
    () => project.selectDebugLaunchConfiguration(context, wsConfig));

  registerCommandWithRefresh(context, "zephyr-ide.change-build-debug-launch-for-build",
    () => project.selectBuildDebugLaunchConfiguration(context, wsConfig));

  registerCommandWithRefresh(context, "zephyr-ide.change-debug-attach-launch-for-build",
    () => project.selectDebugAttachLaunchConfiguration(context, wsConfig));

  //Debugger Helper commands
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "zephyr-ide.get-active-project-name",
      async () => {
        return wsConfig.activeProject;
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "zephyr-ide.get-active-project-path",
      async () => {
        if (wsConfig.activeProject) {
          return path.join(
            wsConfig.rootPath,
            wsConfig.projects[wsConfig.activeProject].rel_path
          );
        }
        return;
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "zephyr-ide.get-active-build-path",
      async () => {
        const resolved = resolveActiveProjectBuild(wsConfig);
        if (!resolved) { return; }
        return path.join(wsConfig.rootPath, resolved.project.rel_path, resolved.buildName);
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "zephyr-ide.get-active-build-board-path",
      async () => {
        const resolved = resolveActiveProjectBuild(wsConfig);
        if (!resolved) { return; }

        const setupState = await getSetupState(context, wsConfig);
        if (!setupState) { return; }

        return project.resolveBoardPath(wsConfig, resolved.build, setupState);
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "zephyr-ide.get-active-board-name",
      async () => {
        const resolved = resolveActiveProjectBuild(wsConfig);
        if (!resolved) { return; }

        const setupState = await getSetupState(context, wsConfig);
        if (!setupState) { return; }

        return path.join(setupState.setupPath, resolved.build.board);
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "zephyr-ide.select-active-build-path",
      async () => {
        await project.setActiveProject(context, wsConfig);
        await project.setActiveBuild(context, wsConfig);
        void vscode.commands.executeCommand("zephyr-ide.update-web-view");

        const resolved = resolveActiveProjectBuild(wsConfig);
        if (!resolved) { return; }
        return path.join(wsConfig.rootPath, resolved.project.rel_path, resolved.buildName);
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.get-arm-gdb-path", async () => {
      return getArmGdbPath(wsConfig);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.get-gdb-path", async () => {
      return getGdbPath(wsConfig);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.get-zephyr-dir", async () => {
      const setupState = await getSetupState(context, wsConfig);
      return setupState?.zephyrDir;
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.get-zephyr-elf", async () => {
      return getZephyrElfPath(wsConfig);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.get-zephyr-elf-dir", async () => {
      return getZephyrElfDir(wsConfig);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "zephyr-ide.get-toolchain-path",
      () => {
        return getToolchainPath(wsConfig);
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "zephyr-ide.get-zephyr-ide-json-variable",
      async (var_name) => {
        return getVariable(wsConfig, var_name);
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "zephyr-ide.get-active-project-variable",
      async (var_name) => {
        if (wsConfig.activeProject) {
          return getVariable(wsConfig, var_name, wsConfig.activeProject);
        }
        return "";
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "zephyr-ide.get-active-build-variable",
      async (var_name) => {
        if (wsConfig.activeProject) {
          const activeBuildConfig =
            wsConfig.projectStates[wsConfig.activeProject]?.activeBuildConfig;
          return getVariable(
            wsConfig,
            var_name,
            wsConfig.activeProject,
            activeBuildConfig
          );
        }
        return "";
      }
    )
  );

  //Board commands
  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.build-pristine", async () => {
      return await buildHelper(context, wsConfig, true);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.build", async () => {
      return await buildHelper(context, wsConfig, false);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.flash", async () => {
      const setupState = await getSetupState(context, wsConfig);
      if (setupState && setupState.westUpdated) {
        await flashActive(context, wsConfig);
      } else {
        notifyError("Flash", "Run `Zephyr IDE: West Update` first.");
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.debug", async () => {
      await startDebugSession(context, wsConfig, 'debug');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.debug-attach", async () => {
      await startDebugSession(context, wsConfig, 'attach');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.build-debug", async () => {
      await startDebugSession(context, wsConfig, 'build-debug');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.clean", async () => {
      await clean(wsConfig, undefined);
    })
  );

  context.subscriptions.push(
    vscode.window.registerTerminalProfileProvider("zephyr-ide.terminal-profile", {
      provideTerminalProfile(
        token: vscode.CancellationToken
      ): vscode.ProviderResult<vscode.TerminalProfile> {
        const opts: vscode.TerminalOptions = {
          name: "Zephyr IDE Terminal",
        };
        return new vscode.TerminalProfile(opts);
      },
    }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.show-container", async () => {
      // Reveal any view inside our container; this triggers container visibility
      await vscode.commands.executeCommand("workbench.view.extension.zephyr-ide-main");
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.update-web-view", async () => {
      activeProjectView.updateWebView(wsConfig);
      await activeProjectView.getChildren();
      activeProjectTreeView.title = activeProjectView.title;
      projectTreeView.updateWebView(wsConfig);
      projectConfigView.updateWebView(wsConfig);
      // Ensure the setup panel stays in sync as well
      extensionSetupView.updateWebView(wsConfig, globalConfig);
      westWorkspaceView.updateWebView(wsConfig, globalConfig);
      if (SetupPanel.currentPanel) {
        SetupPanel.currentPanel.updateContent(wsConfig, globalConfig);
      }
      void vscode.commands.executeCommand("zephyr-ide.update-status");
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.create-new-west-workspace", async () => {
      await showCreateWorkspaceMenu(context, wsConfig, globalConfig);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.refresh-west-workspaces", async () => {
      westWorkspaceView.updateWebView(wsConfig, globalConfig);
    })
  );

  // Kick an initial refresh shortly after activation so views populate
  setTimeout(() => {
    void vscode.commands.executeCommand("zephyr-ide.update-web-view");
  }, 500);

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.start-menu-config", async () => {
      await buildMenuConfig(context, wsConfig, MenuConfig.MenuConfig);
    }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.start-gui-config", async () => {
      await buildMenuConfig(context, wsConfig, MenuConfig.GuiConfig);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.start-dtsh-shell", async () => {
      await runDtshShell(context, wsConfig);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.run-ram-report", async () => {
      await buildRamRomReport(context, wsConfig, true);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.run-rom-report", async () => {
      await buildRamRomReport(context, wsConfig, false);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.run-ram-report-headless", async () => {
      return await buildRamRomReportHeadless(context, wsConfig, true);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.run-rom-report-headless", async () => {
      return await buildRamRomReportHeadless(context, wsConfig, false);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.modify-build-arguments", async () => {
      await project.modifyBuildArguments(context, wsConfig);
    }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.debug-internal-shell", async () => {
      output.clear();
      const temp = await executeShellCommand("Get-ChildItem Env: | Format-Table -AutoSize", wsConfig.rootPath, false);
      if (temp.stdout) {
        outputLine(temp.stdout);
      }
      outputLine(JSON.stringify({ wsConfig }));
      outputLine(JSON.stringify({ globalConfig }));
    }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.west-list", async () => {
      if (!wsConfig.activeSetupState) {
        notifyError("West List", "No active setup state. Please set up a workspace first.");
        return;
      }
      output.clear();
      output.show(true);
      const modules = await getModuleList(wsConfig.activeSetupState);
      if (modules.length === 0) {
        return;
      }
      outputLine("West Modules:");
      outputLine("─".repeat(80));
      for (const mod of modules) {
        outputLine(`  ${mod[0].padEnd(30)} ${mod[1]}`);
      }
      outputLine("─".repeat(80));
      outputLine(`Total: ${modules.length} modules`);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "zephyr-ide.reset-zephyr-install-selection",
      async () => {
        await clearSetupState(context, wsConfig);
        extensionSetupView.updateWebView(wsConfig, globalConfig);
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "zephyr-ide.manage-workspaces",
      async () => {
        await manageWorkspaces(context, wsConfig, globalConfig);
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "zephyr-ide.mark-west-as-ready",
      async () => {
        if (wsConfig.activeSetupState) {
          wsConfig.activeSetupState.westUpdated = true;
          await saveSetupState(context, wsConfig, globalConfig);
        }
        extensionSetupView.updateWebView(wsConfig, globalConfig);
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.reint-dts", async () => {
      const setupState = await getSetupState(context, wsConfig);
      if (setupState) {
        await initializeDtsExt(setupState, wsConfig);
      } else {
        notifyError("DTS Init",
          "First Initialize Zephyr IDE Workspace Folder"
        );
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.set-workspace-settings", async () => {
      await setWorkspaceSettings(true);
    }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.install-host-tools", async () => {
      // Open the Setup Panel and navigate to host tools page
      const panel = SetupPanel.createOrShow(
        context.extensionPath,
        context,
        wsConfig,
        globalConfig
      );
      // Navigate to host tools page after a short delay to ensure panel is ready
      setTimeout(() => {
        if (SetupPanel.currentPanel) {
          SetupPanel.currentPanel.navigateToHostTools();
        }
      }, 100);
    }
    )
  );

  // Programmatic host tools installation commands (for CI/testing)
  // These commands delegate to host_tools.ts to keep extension.ts clean
  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.install-host-tools-headless", async () => {
      return await installHostToolsHeadless();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.install-package-manager-headless", async () => {
      return await installPackageManagerHeadless();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.install-host-packages-headless", async () => {
      return await installHostPackagesHeadless();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.check-host-tools-headless", async () => {
      return await checkHostToolsHeadless();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.install-sdk", async () => {
      const ret = await installSDKInteractive(wsConfig, globalConfig, context);
      return ret;
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.is-sdk-installed", async () => {
      return globalConfig.sdkInstalled;
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.get-debug-output", () => {
      return getDebugOutput();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.clear-debug-output", () => {
      clearDebugOutput();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.open-setup-panel", async () => {
      SetupPanel.createOrShow(
        context.extensionPath,
        context,
        wsConfig,
        globalConfig
      );
    }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.open-host-tools-panel", async () => {
      HostToolInstallView.createOrShow(
        context.extensionPath,
        context,
        wsConfig,
        globalConfig
      );
    }
    )
  );

  // New workspace setup commands
  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.workspace-setup-picker", async () => {
      await showWorkspaceSetupPicker(context, wsConfig, globalConfig);
    })
  );

  registerWorkspaceSetupCommand(context, "zephyr-ide.workspace-setup-from-git", workspaceSetupFromGit);
  registerWorkspaceSetupCommand(context, "zephyr-ide.workspace-setup-from-west-git", workspaceSetupFromWestGit);
  registerWorkspaceSetupCommand(context, "zephyr-ide.workspace-setup-from-current-directory",
    (ctx, ws, gc) => workspaceSetupFromCurrentDirectory(ctx, ws, gc, true));
  registerWorkspaceSetupCommand(context, "zephyr-ide.workspace-setup-standard", workspaceSetupStandard);

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.west-config", async () => {
      await westConfig(context, wsConfig, globalConfig);
    }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.select-existing-west-workspace", async () => {
      await selectExistingWestWorkspace(context, wsConfig, globalConfig);
      // Refresh the setup panel if it's open
      if (SetupPanel.currentPanel) {
        SetupPanel.currentPanel.updateContent(wsConfig, globalConfig);
      }
    }
    )
  );

  // Test-only command: update-with-narrow (not in package.json)
  context.subscriptions.push(
    vscode.commands.registerCommand('zephyr-ide.update-with-narrow', async () => {
      setForceNarrowUpdateForTest(true);
      void vscode.window.showInformationMessage('Zephyr IDE: Forced useNarrowUpdate for westUpdate (test only, variable override).');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.shell_test", async () => {
      output.show();
      printContexts();

      const configuration = await vscode.workspace.getConfiguration();
      const platform_name = "osx";
      const force_bash = true;
      outputLine(
        configuration.get(
          "terminal.integrated.defaultProfile." + platform_name
        ) ?? ""
      );
      outputLine(
        configuration.get(
          "terminal.integrated.defaultProfile." + platform_name
        ) === "zsh"
          ? "default set to zsh"
          : "default set to something else"
      );

      const default_terminal =
        configuration.get(
          "terminal.integrated.defaultProfile." + platform_name
        ) === "zsh" || force_bash
          ? "bash"
          : "Zephyr IDE Terminal";
      outputLine("Setting terminal to: " + default_terminal);
      //configuration.update('terminal.integrated.defaultProfile.' + platform_name, default_terminal, target, false);
      outputLine(
        configuration.get(
          "terminal.integrated.defaultProfile." + platform_name
        ) ?? ""
      );
      outputLine("Finished");
    })
  );

  // Return API for tests and other extensions
  return {
    getWorkspaceConfig: () => wsConfig,
  };
}

/**
 * Print workspace directory structure: rootPath + one layer down
 * @param rootPath The root path to analyze
 * @returns String representation of the directory structure
 */
async function printWorkspaceStructure(rootPath: string): Promise<string> {
  try {
    if (!fs.existsSync(rootPath)) {
      return `Root path does not exist: ${rootPath}`;
    }

    const result: string[] = [];
    result.push(`Root: ${rootPath}`);

    // Read root directory contents
    const rootContents = fs.readdirSync(rootPath);

    for (const item of rootContents) {
      const itemPath = path.join(rootPath, item);
      const stats = fs.statSync(itemPath);

      if (stats.isDirectory()) {
        result.push(`├── ${item}/`);

        // Read one layer down
        try {
          const subContents = fs.readdirSync(itemPath);
          subContents.forEach((subItem, index) => {
            const subItemPath = path.join(itemPath, subItem);
            const subStats = fs.statSync(subItemPath);
            const isLast = index === subContents.length - 1;
            const prefix = isLast ? "    └── " : "    ├── ";
            const suffix = subStats.isDirectory() ? "/" : "";
            result.push(`${prefix}${subItem}${suffix}`);
          });
        } catch (error) {
          result.push(`    └── [Error reading directory: ${error}]`);
        }
      } else {
        result.push(`├── ${item}`);
      }
    }

    return result.join('\n');
  } catch (error) {
    return `Error reading workspace structure: ${error}`;
  }
}

export function deactivate() { }
