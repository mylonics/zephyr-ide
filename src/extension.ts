/*
Copyright 2024-2026 mylonics 
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
import * as path from "upath";
import * as fs from "fs";

import { ActiveProjectView } from "./tree_views/ActiveProjectView";
import { ProjectTreeView } from "./tree_views/ProjectTreeView";
import { ExtensionSetupView } from "./tree_views/ExtensionSetupView";
import { WestWorkspaceView } from "./tree_views/WestWorkspaceView";
import { ProjectConfigView } from "./tree_views/ProjectConfigView";
import { SetupPanel } from "./panels/setup_panel/SetupPanel";
import { HostToolInstallView } from "./panels/host_tool_install_view/HostToolInstallView";
import { ProjectBuildPanel } from "./panels/project_build_view/ProjectBuildPanel";
import { DashboardPanel } from "./panels/dashboard_view/DashboardPanel";
import { listSaveTargets as listKconfigSaveTargets, attachFragmentToScope, offerAddFragmentToBuild, saveFragmentInteractive, saveSessionFragmentToPath } from "./panels/dashboard_view/kconfig-fragment";
import {
  KconfigSession,
  buildEnvFromCMakeCache,
  getKconfigHelperPath,
  resolveDotConfig,
  resolveKconfigRoot,
  resolveVenvPython,
} from "./build_data/kconfig-session";
import { SettingsPanel } from "./panels/settings_view/SettingsPanel";
import { SDKPanel } from "./panels/sdk_panel/SDKPanel";
import { RunnerProfilePanel } from "./panels/runner_profile_view/RunnerProfilePanel";
import { WorkspacePanel } from "./panels/workspace_panel/WorkspacePanel";

import {
  output,
  executeShellCommand,
  executeShellCommandInPythonEnv,
  reloadEnvironmentVariables,
  getLaunchConfigurationByName,
  RUNNER_TARGET_PREFIX,
  getPlatformName,
  getPlatformArch,
  isWSL,
  resolveConfigInputs,
} from "./utilities/utils";
import { notifyError, outputInfo, outputError, outputLine, outputCommandFailure, getDebugOutput, clearDebugOutput } from "./utilities/output";
import * as project from "./project_utilities/project";
import {
  buildHelper,
  buildByName,
  buildMenuConfig,
  buildRamRomReport,
  buildRamRomReportHeadless,
  buildDashboard,
  buildDashboardReport,
  refreshDashboardMemory,
  runDtshShell,
  clean,
  MenuConfig,
  build,
} from "./zephyr_utilities/build";
import { flashActive } from "./zephyr_utilities/flash";
import { ZephyrIdeDebugConfigurationProvider } from "./zephyr_utilities/debug-provider";
import { getSysbuildDomains, resolveRunnersYamlPath } from "./zephyr_utilities/runners-yaml";
import { RunnerBind, formatBindLabel } from "./project_utilities/runner_profiles";
import { WorkspaceConfig, GlobalConfig } from "./setup_utilities/types";
import {
  loadGlobalState,
  setSetupState,
  setWorkspaceState,
  loadWorkspaceState,
  clearWorkspaceState,
  clearWorkspaceReadiness,
  saveSetupState,
  clearSetupState,
  setExternalSetupState,
  setGlobalState,
} from "./setup_utilities/state-management";
import {
  getVariable,
  loadProjectsFromFile,
  getToolchainDir,
  getToolchainPath,
  migrateSettingKeys,
  setWorkspaceSettings,
  getSetupState,
  getGdbPath,
  getArmGdbPath,
  getZephyrElfPath,
  getZephyrElfDir,
  getAutomaticProjectSelection,
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
  workspaceSetupFromExternalDirectory,
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
  resolveActiveProjectBuild,
  resolveActiveProfile,
  resolveActiveBuildBind,
  resolveActiveProject,
  getProjectFolder,
  getBuildFolder,
  getBindOverride,
  addSampleProjectsFromFile,
} from "./project_utilities/project";
import { testHelper, deleteTestDirs } from "./zephyr_utilities/twister";

import { getModuleVersion, getModuleList } from "./setup_utilities/modules";
import { reconfigureTest } from "./project_utilities/twister_selector";
import { installSDKInteractive, detectInstalledSDKVersion } from "./setup_utilities/west_sdk";
import {
  modifyZephyrIdeToolchainsInteractive,
  installZephyrIdeToolchains,
  modifyZephyrIdeBlobsInteractive,
  installZephyrIdeBlobs,
  modifyZephyrIdeSampleProjectsInteractive,
} from "./setup_utilities/zephyr_ide_install";
import { getZephyrIdeSampleProjects } from "./setup_utilities/zephyr_ide_json";
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
  // Mark the bound workspace as initialized at the registry level. The folder
  // binding itself is represented by `activeSetupState` being set.
  if (wsConfig.activeSetupState) {
    wsConfig.activeSetupState.initialized = true;
    await setExternalSetupState(context, globalConfig, wsConfig.activeSetupState.setupPath, wsConfig.activeSetupState);
  }
  await setWorkspaceState(context, wsConfig);
  void vscode.commands.executeCommand("zephyr-ide.update-web-view");

  // If the workspace declares sample projects that haven't been added yet,
  // offer to add them now.
  const sampleProjects = getZephyrIdeSampleProjects(wsConfig);
  if (sampleProjects.length > 0) {
    const addedPaths = new Set(
      Object.values(wsConfig.projects).map(p => path.normalize(p.rel_path))
    );
    const unadded = sampleProjects.filter(p => !addedPaths.has(path.normalize(p.rel_path)));
    if (unadded.length > 0) {
      const choice = await vscode.window.showInformationMessage(
        `This workspace declares ${unadded.length} sample project${unadded.length > 1 ? "s" : ""} in zephyr-ide.json that haven't been added yet. Would you like to add them now?`,
        "Add Sample Projects",
        "Later"
      );
      if (choice === "Add Sample Projects") {
        await vscode.commands.executeCommand("zephyr-ide.add-sample-projects-from-file");
      }
    }
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
  const resolved = resolveActiveProjectBuild(wsConfig);

  // 3-bind model: Flash drives both Flash and Build-and-Flash; the unified
  // `debug` bind drives both Debug and Build-and-Debug; `attach` is dedicated.
  const slot: 'debug' | 'attach' = mode === 'attach' ? 'attach' : 'debug';

  let activeBind: RunnerBind | undefined;
  let pinnedRunner: string | undefined;

  if (resolved) {
    const profileName = resolved.build.activeProfile;
    if (profileName) {
      const profileResolved = resolveActiveProfile(wsConfig);
      if (profileResolved) {
        activeBind = profileResolved.profile[slot];
        if (activeBind.kind === 'runner') {
          pinnedRunner = activeBind.runner;
        } else if (activeBind.kind === 'auto') {
          // auto → let runners.yaml provider pick the runner
        }
      }
    }
  }

  let debugTarget: string | undefined;
  let debugTargetFolder: string | undefined;
  if (activeBind && activeBind.kind === 'launch') {
    debugTarget = activeBind.name;
  } else if (pinnedRunner) {
    debugTarget = `${RUNNER_TARGET_PREFIX}${pinnedRunner}`;
  }

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

  // No bound launch.json target → synthesize a Zephyr IDE provider config
  // (cortex-debug + runners.yaml) directly. This is the default for runner
  // binds of kind auto/runner/variant. A bind of kind "launch" already set
  // `debugTarget` to the launch.json entry name and falls through to Path B.
  if (!debugTarget || pinnedRunner !== undefined) {
    if (!resolved) {
      notifyError("Debug", "No active project or build configuration found");
      return;
    }
    const baseName = mode === 'attach' ? "Zephyr IDE: Attach" : "Zephyr IDE: Debug";
    const inlineCfg: vscode.DebugConfiguration = {
      type: "zephyr-ide",
      name: pinnedRunner ? `${baseName} (${pinnedRunner})` : baseName,
      request: mode === 'attach' ? "attach" : "launch",
      ...(pinnedRunner ? { runner: pinnedRunner } : {}),
    };
    // Prefer the workspace folder whose uri.fsPath matches wsConfig.rootPath (case-insensitive on Windows)
    const folders = vscode.workspace.workspaceFolders ?? [];
    const isWindows = process.platform === "win32";
    const folder = folders.find(f =>
      isWindows
        ? f.uri.fsPath.toLowerCase() === wsConfig.rootPath.toLowerCase()
        : f.uri.fsPath === wsConfig.rootPath
    ) ?? folders[0];
    const started = await vscode.debug.startDebugging(folder, inlineCfg);
    if (!started) {
      const sessionLabel = mode === 'attach' ? 'attach session' : 'debug session';
      notifyError("Debug", `Failed to start ${sessionLabel} from runners.yaml.` +
        `\nCheck the Debug Console and the Zephyr IDE output channel for the synthesized cortex-debug config.`);
    }
    return;
  }

  // Determine the correct folder to pass to startDebugging.
  // When a name (string) is passed, VS Code searches only the given folder's
  // .vscode/launch.json.  If the config lives at workspace level (e.g. in a
  // .code-workspace file) there is no per-folder launch.json and VS Code
  // fails with "launch.json does not exist for passed workspace folder".
  // Look up the config to see where it actually lives.
  const config = await getLaunchConfigurationByName(wsConfig, debugTarget, debugTargetFolder);
  // Item #26: when the bound launch config no longer exists (renamed/deleted),
  // surface an actionable error with a rebind button instead of letting
  // startDebugging fail with a generic "Cannot find launch configuration".
  if (!config) {
    const folderHint = debugTargetFolder ? ` (folder: ${debugTargetFolder})` : "";
    const choice = await vscode.window.showErrorMessage(
      `Bound launch configuration "${debugTarget}"${folderHint} was not found. ` +
      `It may have been renamed or removed from launch.json.`,
      "Edit Runner Profile",
      "Open launch.json"
    );
    if (choice === "Edit Runner Profile") {
      void vscode.commands.executeCommand("zephyr-ide.set-active-profile");
    } else if (choice === "Open launch.json") {
      void vscode.commands.executeCommand("workbench.action.debug.configure");
    }
    return;
  }
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

  // Issue #35: log which path we took so support can triage debug failures.
  outputInfo(
    "Debug",
    `Path B (bound launch config) | mode=${mode} target="${debugTarget}" folder=${folder?.name || '(workspace)'}`
  );

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

  // Wrap critical initialization in try/catch so an unexpected failure produces
  // a meaningful notification instead of silently preventing activation.
  try {
    // Migrate deprecated setting keys to camelCase equivalents
    await migrateSettingKeys();

    // Auto-enable clangd mode when the clangd extension is installed and the
    // user has not yet explicitly configured zephyr-ide.useClangd (i.e. it is
    // still at its default value of false across all configuration scopes).
    {
      const cfg = vscode.workspace.getConfiguration();
      const clangdInspect = cfg.inspect<boolean>("zephyr-ide.useClangd");
      const isExplicitlySet = [
        clangdInspect?.globalValue,
        clangdInspect?.workspaceValue,
        clangdInspect?.workspaceFolderValue,
      ].some((v) => v !== undefined);

      if (
        !isExplicitlySet &&
        vscode.extensions.getExtension("llvm-vs-code-extensions.vscode-clangd") &&
        !vscode.extensions.getExtension("ms-vscode.cpptools")
      ) {
        await cfg.update("zephyr-ide.useClangd", true, vscode.ConfigurationTarget.Global)
          .then(
            () => {
              outputInfo("Startup", "Auto-enabled clangd IntelliSense: clangd extension present, cpptools absent, zephyr-ide.useClangd not set.");
            },
            (err: unknown) => {
              const detail = err instanceof Error ? err.message : String(err);
              outputInfo("Startup", `Auto-enable clangd: could not write useClangd setting: ${detail}`);
            });
      }
    }

    wsConfig = await loadWorkspaceState(context);
    globalConfig = await loadGlobalState(context);

    // Guard: ensure the active workspace's setup state is registered in the
    // global dictionary before setSetupState runs. Without this, if the global
    // dictionary is missing the path (e.g., after a VS Code state reset or when
    // upgrading from a very old release), loadExternalSetupState would create a
    // fresh zeroed entry and overwrite the correctly-loaded activeSetupState —
    // sending the user back to the Initial Setup page even though their
    // workspace was already fully configured.
    //
    // This also ensures that the old global install (previously stored at
    // getToolsDir()) is preserved as a single entry in setupStateDictionary
    // rather than a second entry being created at a new default path.
    if (wsConfig.activeSetupState) {
      const activePath = wsConfig.activeSetupState.setupPath;
      if (activePath && !globalConfig.setupStateDictionary?.[activePath]) {
        if (!globalConfig.setupStateDictionary) {
          globalConfig.setupStateDictionary = {};
        }
        globalConfig.setupStateDictionary[activePath] = wsConfig.activeSetupState;
        await setGlobalState(context, globalConfig);
      }
    }

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
  } catch (initError) {
    const initErrorMsg = initError instanceof Error ? initError.message : String(initError);
    const initErrorDetail =
      initError instanceof Error && initError.stack ? initError.stack : initErrorMsg;
    outputError("Startup", `Extension initialization failed: ${initErrorDetail}`);
    void vscode.window.showErrorMessage(
      `Zephyr IDE failed to initialize: ${initErrorMsg}. Check the Zephyr IDE output channel for details.`
    );
    // Initialize with safe defaults so that commands and views are still registered
    if (!wsConfig) {
      wsConfig = {
        rootPath: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "",
        projects: {},
        projectStates: {},
      };
    }
    if (!globalConfig) {
      globalConfig = {};
    }
  } finally {
    // Always sync the environment variable collection regardless of init success/failure
    // so terminals opened after activation pick up the correct (or cleared) variables.
    reloadEnvironmentVariables(context, wsConfig?.activeSetupState);
  }

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
      const profileName = resolved.build.activeProfile;
      activeRunnerDisplay.text = profileName ? `$(chip) ${profileName}` : `$(chip)`;
      if (profileName) {
        const profileResolved = resolveActiveProfile(wsConfig);
        if (profileResolved) {
          const p = profileResolved.profile;
          const flashLabel = formatBindLabel(p.flash, getBindOverride(resolved.build, "flash"));
          const debugLabel = formatBindLabel(p.debug, getBindOverride(resolved.build, "debug"));
          const attachLabel = formatBindLabel(p.attach, getBindOverride(resolved.build, "attach"));
          activeRunnerDisplay.tooltip =
            `Runner Profile: ${profileName}` +
            `\nFlash: ${flashLabel}` +
            `\nDebug: ${debugLabel}` +
            `\nAttach: ${attachLabel}` +
            `\nClick to change active profile`;
        } else {
          activeRunnerDisplay.tooltip = `Runner Profile "${profileName}" not found. Click to change.`;
        }
      } else {
        activeRunnerDisplay.tooltip = "No runner profile set — west/runners.yaml defaults apply. Click to select one.";
      }
    } else {
      activeBuildDisplay.text = ``;
      activeRunnerDisplay.text = ``;
      activeRunnerDisplay.tooltip = "Select Active Runner Profile";
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
        const result = await executeShellCommandInPythonEnv(cmd, wsConfig.activeSetupState.setupPath, wsConfig.activeSetupState, false);
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
    vscode.commands.registerCommand("zephyr-ide.active-view.kconfig", async () => {
      const buttonMode = vscode.workspace.getConfiguration().get<string>("zephyr-ide.activeViewKconfigButton") ?? "dashboard";
      if (buttonMode === "gui-config") {
        void buildMenuConfig(context, wsConfig, MenuConfig.GuiConfig);
      } else if (buttonMode === "menu-config") {
        void buildMenuConfig(context, wsConfig, MenuConfig.MenuConfig);
      } else if (buttonMode === "kconfig-dashboard") {
        // Navigate to Kconfig page of the dashboard.
        const resolved = resolveActiveProjectBuild(wsConfig);
        if (!resolved) { return; }
        await vscode.commands.executeCommand("zephyr-ide.run-dashboard");
        DashboardPanel.getPanel(resolved.projectName, resolved.buildName)?.navigateTo("kconfig");
      } else {
        // Default ("dashboard"): open dashboard to the main summary page.
        await vscode.commands.executeCommand("zephyr-ide.run-dashboard");
      }
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
    vscode.commands.registerCommand("zephyr-ide.config-view.open-project-details", () => {
      ProjectBuildPanel.createOrShow(
        context.extensionPath,
        context,
        wsConfig,
        globalConfig,
        wsConfig.activeProject,
      );
    }),
  );

  // -- ProjectTreeView inline action commands --
  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.tree-view.select", (item: any) => {
      projectTreeView.handleSelect(item);
    }),
    vscode.commands.registerCommand("zephyr-ide.tree-view.open-project-details", (item: any) => {
      const projectName = item?.data?.project;
      ProjectBuildPanel.createOrShow(
        context.extensionPath,
        context,
        wsConfig,
        globalConfig,
        projectName,
      );
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
    vscode.commands.registerCommand("zephyr-ide.tree-view.config", async (item: any) => {
      const buttonMode = vscode.workspace.getConfiguration().get<string>("zephyr-ide.projectViewKconfigButton") ?? "kconfig-dashboard";
      if (buttonMode === "gui-config") {
        projectTreeView.handleSharedCommand("guiConfig", item);
      } else if (buttonMode === "menu-config") {
        projectTreeView.handleSharedCommand("menuConfig", item);
      } else {
        // Default ("kconfig-dashboard"): set this build active, open dashboard, navigate to Kconfig.
        const projectName: string = item?.data?.project;
        const buildName: string = item?.data?.build;
        if (!projectName || !buildName) { return; }
        await project.setActive(context, wsConfig, projectName, buildName);
        await vscode.commands.executeCommand("zephyr-ide.run-dashboard");
        DashboardPanel.getPanel(projectName, buildName)?.navigateTo("kconfig");
      }
    }),
    vscode.commands.registerCommand("zephyr-ide.tree-view.delete-build", (item: any) => {
      projectTreeView.handleSharedCommand("deleteBuild", item);
    }),
    vscode.commands.registerCommand("zephyr-ide.tree-view.flash", (item: any) => {
      projectTreeView.handleSharedCommand("flash", item);
    }),
    vscode.commands.registerCommand("zephyr-ide.tree-view.debug", (item: any) => {
      projectTreeView.handleSharedCommand("debug", item);
    }),
    vscode.commands.registerCommand("zephyr-ide.tree-view.attach", (item: any) => {
      projectTreeView.handleSharedCommand("attach", item);
    }),
    vscode.commands.registerCommand("zephyr-ide.tree-view.test", (item: any) => {
      projectTreeView.handleTest(item);
    }),
    vscode.commands.registerCommand("zephyr-ide.tree-view.delete-test", (item: any) => {
      projectTreeView.handleDeleteTest(item);
    }),
  );

  registerCommandWithRefresh(context, "zephyr-ide.set-active-profile",
    () => project.setActiveProfile(context, wsConfig));

  activeProjectDisplay = createStatusBarButton(context,
    "zephyr-ide.set-active-project", `$(folder) ${wsConfig.activeProject}`, "Zephyr IDE Select Active Project");

  activeBuildDisplay = createStatusBarButton(context,
    "zephyr-ide.set-active-build", ``, "Select Active Build");
  activeRunnerDisplay = createStatusBarButton(context,
    "zephyr-ide.set-active-profile", ``, "Select Active Runner Profile");
  {
    refreshStatusBar();
  }

  createStatusBarButton(context, "zephyr-ide.build-pristine", `$(debug-rerun)`, "Zephyr IDE Build Pristine");
  createStatusBarButton(context, "zephyr-ide.build", `$(play)`, "Zephyr IDE Build");
  createStatusBarButton(context, "zephyr-ide.flash", `$(arrow-circle-up)`, "Zephyr IDE Flash");
  createStatusBarButton(context, "zephyr-ide.build-flash", `$(cloud-upload)`, "Zephyr IDE Build and Flash");
  createStatusBarButton(context, "zephyr-ide.debug", `$(debug-alt)`, "Zephyr IDE Debug");

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((handleChange) => {
      if (getAutomaticProjectSelection() && handleChange) {
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
      if (wsConfig.activeSetupState) {
        await setupWestEnvironment(context, wsConfig, globalConfig);
        extensionSetupView.updateWebView(wsConfig, globalConfig);
      } else {
        notifyError("West Environment", "No active workspace. Set up a workspace first.");
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
      const workspacePath = wsConfig.activeSetupState?.setupPath ?? "the active workspace";
      const confirm = await vscode.window.showWarningMessage(
        `Reset workspace at ${workspacePath}? This marks it as uninitialized. Files on disk (including .west/) are preserved.`,
        "Reset"
      );
      if (confirm !== "Reset") { return; }
      await clearWorkspaceState(context, wsConfig, globalConfig);
      // After a workspace reset, re-check the toolchains directory so that
      // sdkInstalled stays true when the SDK is physically present. This
      // ensures the SDK install prompt is not shown on the next workspace
      // setup for a user who has already installed the SDK.
      if (!globalConfig.sdkInstalled) {
        const detectedVersion = await detectInstalledSDKVersion();
        if (detectedVersion) {
          outputInfo("SDK Install", `SDK found on disk after workspace reset (version ${detectedVersion}), preserving installed state.`);
          globalConfig.sdkInstalled = true;
          if (!globalConfig.sdkVersion) {
            globalConfig.sdkVersion = detectedVersion;
          }
          await setGlobalState(context, globalConfig);
        }
      }
      void vscode.commands.executeCommand("zephyr-ide.update-web-view");
    })
  );

  // Deactivate: unbind the folder from its active workspace. Registry entry
  // and readiness flags are preserved; the folder simply no longer points at
  // any workspace, so the Initial Setup options re-appear.
  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.deactivate-workspace", async () => {
      const confirm = await vscode.window.showWarningMessage(
        "Deactivate this workspace? The folder will no longer be bound to a Zephyr workspace. The workspace itself (including .west/) is kept.",
        "Deactivate"
      );
      if (confirm !== "Deactivate") { return; }
      await clearSetupState(context, wsConfig);
      void vscode.commands.executeCommand("zephyr-ide.update-web-view");
    })
  );

  // Re-run west setup: clear readiness flags only (python env, west update)
  // without touching `initialized`. Then trigger the west setup flow again.
  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.rerun-west-setup", async () => {
      const confirm = await vscode.window.showWarningMessage(
        "Re-run west setup? This clears the python environment and west-update state, then re-runs setup. The workspace stays initialized.",
        "Re-run"
      );
      if (confirm !== "Re-run") { return; }
      await clearWorkspaceReadiness(context, wsConfig, globalConfig);
      await vscode.commands.executeCommand("zephyr-ide.setup-west-environment");
      void vscode.commands.executeCommand("zephyr-ide.update-web-view");
    })
  );

  // Unregister: remove the active workspace's entry from the global registry.
  // Also unbinds the folder. Does NOT delete files on disk.
  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.unregister-workspace", async () => {
      const activePath = wsConfig.activeSetupState?.setupPath;
      if (!activePath) {
        void vscode.window.showInformationMessage("No active workspace to unregister.");
        return;
      }
      const confirm = await vscode.window.showWarningMessage(
        `Unregister workspace at ${activePath}? It will be removed from Zephyr IDE's registry. Files on disk are not deleted.`,
        "Unregister"
      );
      if (confirm !== "Unregister") { return; }
      if (globalConfig.setupStateDictionary && globalConfig.setupStateDictionary[activePath]) {
        delete globalConfig.setupStateDictionary[activePath];
        await setGlobalState(context, globalConfig);
      }
      await clearSetupState(context, wsConfig);
      void vscode.commands.executeCommand("zephyr-ide.update-web-view");
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.clear-projects", async () => {
      const selection = await vscode.window.showWarningMessage(
        "Are you sure you want to clear all projects?",
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
      "zephyr-ide.add-sample-projects-from-file",
      async () => {
        const result = await addSampleProjectsFromFile(wsConfig, context);
        if (result === undefined) {
          void vscode.window.showInformationMessage("No sample projects declared in .vscode/zephyr-ide.json");
        } else if (result) {
          extensionSetupView.updateWebView(wsConfig, globalConfig);
          void vscode.commands.executeCommand("zephyr-ide.update-web-view");
        }
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
        const configuration = vscode.workspace.getConfiguration();
        await configuration.update("zephyr-ide.automaticProjectSelection", false, vscode.ConfigurationTarget.Workspace);
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "zephyr-ide.enable-automatic-project-target",
      async () => {
        const configuration = vscode.workspace.getConfiguration();
        await configuration.update("zephyr-ide.automaticProjectSelection", true, vscode.ConfigurationTarget.Workspace);
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

  // U5: Single command that lets the user choose which debug target to reconfigure.
  registerCommandWithRefresh(context, "zephyr-ide.change-launch-for-build", async () => {
    notifyError("Runner Profile", "Launch bindings are now configured per-slot on the active Runner Profile.");
    void vscode.commands.executeCommand("zephyr-ide.set-active-profile");
  });

  // Issue #25: Open the active build's runners.yaml in an editor for inspection.
  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.open-runners-yaml", async () => {
      const resolved = resolveActiveProjectBuild(wsConfig, { caller: "Open runners.yaml" });
      if (!resolved) { return; }
      const buildFolder = getBuildFolder(wsConfig, resolved.project, resolved.build);
      const sysbuildImage = wsConfig.projectStates?.[resolved.projectName]?.buildStates?.[resolved.buildName]?.sysbuildImage;
      const runnersYamlPath = resolveRunnersYamlPath(buildFolder, sysbuildImage);
      if (!fs.existsSync(runnersYamlPath)) {
        const choice = await vscode.window.showErrorMessage(
          `runners.yaml not found at "${runnersYamlPath}". Build the project first.`,
          "Build Now"
        );
        if (choice === "Build Now") {
          void vscode.commands.executeCommand("zephyr-ide.build");
        }
        return;
      }
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(runnersYamlPath));
      await vscode.window.showTextDocument(doc);
    })
  );

  // B7: Let the user select which sysbuild image to flash/debug.
  registerCommandWithRefresh(context, "zephyr-ide.set-sysbuild-image", async () => {
    const resolved = resolveActiveProjectBuild(wsConfig, { caller: "Set Sysbuild Image" });
    if (!resolved) { return; }
    const buildFolder = getBuildFolder(wsConfig, resolved.project, resolved.build);
    const domains = getSysbuildDomains(buildFolder);
    if (!domains || domains.length === 0) {
      vscode.window.showInformationMessage(
        "No sysbuild domains found for this build. Build the project first, or this is not a sysbuild project."
      );
      return;
    }
    const items = domains.map(d => ({ label: d.name, description: d.buildDir }));
    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: "Select sysbuild image to use for flash/debug",
      ignoreFocusOut: true,
    });
    if (!picked) { return; }
    const bs = wsConfig.projectStates[resolved.projectName]?.buildStates[resolved.buildName];
    if (bs) {
      bs.sysbuildImage = picked.label;
      await setWorkspaceState(context, wsConfig);
    }
  });

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

        return resolved.build.board;
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
        // B8: Optionally build before flashing (mirrors "Build and Debug" behaviour).
        const buildFirst = vscode.workspace.getConfiguration().get<boolean>("zephyr-ide.buildBeforeFlash") ?? false;
        if (buildFirst) {
          const resolved = resolveActiveProjectBuild(wsConfig);
          if (resolved) {
            const buildOk = await build(context, wsConfig, resolved.project, resolved.build, false);
            if (!buildOk) { return; }
          }
        }
        await flashActive(context, wsConfig);
      } else {
        notifyError("Flash", "Cannot flash: this workspace is not yet initialized. Run `Zephyr IDE: West Update` first.");
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.build-flash", async () => {
      const setupState = await getSetupState(context, wsConfig);
      if (!setupState || !setupState.westUpdated) {
        notifyError("Build and Flash", "Cannot build: this workspace is not yet initialized. Run `Zephyr IDE: West Update` first.");
        return;
      }
      const resolved = resolveActiveProjectBuild(wsConfig, { caller: "Build and Flash" });
      if (!resolved) { return; }
      const buildOk = await build(context, wsConfig, resolved.project, resolved.build, false);
      if (buildOk) {
        await flashActive(context, wsConfig);
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

  // DebugConfigurationProvider that translates `zephyr-ide` launch.json entries
  // to cortex-debug configurations using the build's runners.yaml.  Registered
  // for both Initial (provideDebugConfigurations) and Dynamic triggers so it
  // populates the "Add Configuration" menu and resolves at launch time.
  const zephyrIdeDebugProvider = new ZephyrIdeDebugConfigurationProvider(() => wsConfig, context);
  context.subscriptions.push(
    vscode.debug.registerDebugConfigurationProvider("zephyr-ide", zephyrIdeDebugProvider)
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
      ProjectBuildPanel.updateAllPanels(wsConfig, globalConfig);
      SDKPanel.updateAllPanels(wsConfig, globalConfig);
      WorkspacePanel.updateAllPanels(wsConfig, globalConfig);
      HostToolInstallView.currentPanel?.updateContent(wsConfig, globalConfig);
      RunnerProfilePanel.updateAllPanels(wsConfig, globalConfig);
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
    vscode.commands.registerCommand("zephyr-ide.run-dashboard-report", async () => {
      // Run the full dashboard memory report (stat + ram_report + rom_report).
      // If a dashboard panel is already open for this project/build, refresh
      // its memory view with the newly generated data.
      const result = await buildDashboardReport(context, wsConfig);
      if (!result) { return; }
      const panel = DashboardPanel.getPanel(result.projectName, result.buildName);
      if (panel) {
        void panel.refreshMemory();
      }
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
    vscode.commands.registerCommand("zephyr-ide.run-dashboard", async () => {
      // 1. Fast path: read build artifacts from disk immediately.
      const result = await buildDashboard(context, wsConfig);
      if (!result?.success) { return; }

      // Resolve the project/build objects so the Kconfig save callback can
      // persist its fragment into the right build's confFiles list.
      const proj = wsConfig.projects[result.projectName];
      const bld = proj?.buildConfigs[result.buildName];

      // 2. Open the panel right away with all fast data (memory tree is null
      //    until the cmake targets finish).
      const panel = DashboardPanel.createOrShow(
        context.extensionPath,
        result.data,
        () => refreshDashboardMemory(context, wsConfig, result.buildFolder, result.projectName, result.buildName),
        proj && bld ? {
          saveFragment: async (changes) => {
            const saved = await saveFragmentInteractive(wsConfig, proj, changes);
            if (saved) {
              await offerAddFragmentToBuild(context, wsConfig, proj, bld, saved);
            }
            return saved;
          },
          // kconfiglib-backed "Save as new fragment" — scope chosen by user.
          saveSessionFragmentNew: async (scope, writeFragment) => {
            const defaultUri = vscode.Uri.file(
              path.join(getProjectFolder(wsConfig, proj), "prj_dashboard.conf"),
            );
            const target = await vscode.window.showSaveDialog({
              defaultUri,
              filters: { "Kconfig fragment": ["conf"] },
              saveLabel: "Save Kconfig Fragment",
              title: `Save Kconfig fragment (attached to ${scope})`,
            });
            if (!target) { return undefined; }
            await writeFragment(target.fsPath);
            await attachFragmentToScope(context, wsConfig, proj, bld, target.fsPath, scope);
            return target.fsPath;
          },
          saveSessionFragmentToPath: async (absPath, writeFragment, opts) => {
            return saveSessionFragmentToPath(wsConfig, proj, bld, absPath, writeFragment, opts);
          },
          listSaveTargets: async () => {
            return listKconfigSaveTargets(wsConfig, proj, bld);
          },
          openExternal: async (tool) => {
            await buildMenuConfig(
              context,
              wsConfig,
              tool === "guiconfig" ? MenuConfig.GuiConfig : MenuConfig.MenuConfig,
              proj,
              bld,
            );
            // Phase 3: external tool wrote a fresh .config — tell the panel
            // (if still open) so its in-memory editor reloads from disk.
            const liveDashPanel = DashboardPanel.getPanel(proj.name, bld.name);
            await liveDashPanel?.notifyKconfigExternalDone(tool);
          },
        } : undefined,
        // Lazy Kconfig session factory: spawned on first kconfig request from
        // the webview, kept alive for the panel's lifetime, disposed on close.
        () => {
          const buildFolder = result.buildFolder;
          const env = buildEnvFromCMakeCache(buildFolder);
          const kconfigRoot = resolveKconfigRoot(env);
          if (!kconfigRoot) {
            return Promise.reject(new Error(
              "Could not resolve KCONFIG_ROOT from this build's CMakeCache.txt. " +
              "Re-run a clean build and try again.",
            ));
          }
          const setupState = wsConfig.activeSetupState;
          const helperScript = getKconfigHelperPath(context.extensionPath);
          // Build env for the Python child: prepend venv bin to PATH so the
          // helper imports kconfiglib from the Zephyr venv rather than a
          // system Python.
          const spawnEnv: NodeJS.ProcessEnv = { ...process.env };
          if (setupState?.env?.["VIRTUAL_ENV"]) {
            spawnEnv["VIRTUAL_ENV"] = setupState.env["VIRTUAL_ENV"];
          }
          if (setupState?.env?.["PATH"]) {
            const pathKey = Object.keys(spawnEnv).find((k) => k.toLowerCase() === "path") ?? "PATH";
            spawnEnv[pathKey] = setupState.env["PATH"] + (spawnEnv[pathKey] ?? "");
          }
          const session = new KconfigSession({
            helperScript,
            pythonExecutable: resolveVenvPython(setupState),
            spawnEnv,
            cwd: setupState?.setupPath,
            onLog: (level, message) => {
              if (level === "error") {
                console.error(`[kconfig_helper] ${message}`);
              } else if (level === "warn") {
                console.warn(`[kconfig_helper] ${message}`);
              }
            },
          });
          session.start();
          return session.init({
            kconfigRoot,
            env,
            dotConfig: resolveDotConfig(buildFolder),
          }).then(() => session, (err) => {
            // Init failed - tear down the spawned process before propagating.
            session.dispose();
            throw err;
          });
        },
        // onBuild: build the dashboard's own project/build, not the active project.
        // build.ts auto-detects whether a pristine build is needed (conf file changes).
        async (pristine) => {
          await buildByName(context, wsConfig, pristine, result.projectName, result.buildName);
        },
      );

      // 3. Auto-trigger memory report generation in the background so the
      //    Memory page populates without requiring a manual refresh click.
      void panel.refreshMemory();
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
    vscode.commands.registerCommand("zephyr-ide.debug-reset-host-tools", async () => {
      globalConfig.toolsAvailable = false;
      await saveSetupState(context, wsConfig, globalConfig);
      void vscode.commands.executeCommand("zephyr-ide.update-web-view");
      void vscode.window.showInformationMessage("Zephyr IDE Debug: Host tools marked as not ready");
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.debug-reset-sdk", async () => {
      globalConfig.sdkInstalled = false;
      await saveSetupState(context, wsConfig, globalConfig);
      void vscode.commands.executeCommand("zephyr-ide.update-web-view");
      void vscode.window.showInformationMessage("Zephyr IDE Debug: SDK marked as not installed");
    })
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
    vscode.workspace.onDidChangeConfiguration(async (e) => {
      if (e.affectsConfiguration("zephyr-ide.useClangd")) {
        await setWorkspaceSettings(false);
      } else if (e.affectsConfiguration("zephyr-ide.toolchainDirectory")) {
        // If toolchainDirectory changes while clangd is active, the --query-driver glob
        // needs to be refreshed to point at the new SDK location.
        const useClangd: boolean = vscode.workspace.getConfiguration().get("zephyr-ide.useClangd") ?? false;
        if (useClangd) {
          await setWorkspaceSettings(false);
        }
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.install-host-tools", async () => {
      // Open the standalone Host Tools panel
      HostToolInstallView.createOrShow(
        context.extensionPath,
        context,
        wsConfig,
        globalConfig
      );
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
      // If clangd is active, refresh workspace settings so --query-driver picks up
      // the newly installed SDK (the install does not write zephyr-ide.toolchainDirectory,
      // so the onDidChangeConfiguration listener would not fire on its own).
      if (ret) {
        const useClangd: boolean = vscode.workspace.getConfiguration().get("zephyr-ide.useClangd") ?? false;
        if (useClangd) {
          await setWorkspaceSettings(false);
        }
        // Refresh the SDK panel so the newly installed toolchains appear without
        // requiring the user to click the Refresh button manually.
        SDKPanel.refreshAllPanels(wsConfig, globalConfig);
      }
      return ret;
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.is-sdk-installed", async () => {
      return globalConfig.sdkInstalled;
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.modify-zephyr-ide-toolchains", async () => {
      await modifyZephyrIdeToolchainsInteractive(wsConfig);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.install-zephyr-ide-toolchains", async () => {
      const ok = await installZephyrIdeToolchains(wsConfig, globalConfig, context);
      if (ok) {
        SDKPanel.refreshAllPanels(wsConfig, globalConfig);
      }
      return ok;
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.modify-zephyr-ide-blobs", async () => {
      await modifyZephyrIdeBlobsInteractive(wsConfig, context);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.install-zephyr-ide-blobs", async () => {
      return await installZephyrIdeBlobs(wsConfig, context);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.modify-zephyr-ide-sample-projects", async () => {
      await modifyZephyrIdeSampleProjectsInteractive(wsConfig);
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
    vscode.commands.registerCommand("zephyr-ide.open-setup-panel-workspace", async () => {
      WorkspacePanel.createOrShow(
        context.extensionPath,
        context,
        wsConfig,
        globalConfig
      );
    }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.open-setup-panel-sdk", async () => {
      SDKPanel.createOrShow(
        context.extensionPath,
        context,
        wsConfig,
        globalConfig
      );
    }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.open-project-build-panel", async () => {
      ProjectBuildPanel.createOrShow(
        context.extensionPath,
        context,
        wsConfig,
        globalConfig,
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

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.open-sdk-panel", async () => {
      SDKPanel.createOrShow(
        context.extensionPath,
        context,
        wsConfig,
        globalConfig
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.open-runner-profile-panel", async () => {
      RunnerProfilePanel.createOrShow(
        context.extensionPath,
        context,
        wsConfig,
        globalConfig
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.open-workspace-panel", async () => {
      WorkspacePanel.createOrShow(
        context.extensionPath,
        context,
        wsConfig,
        globalConfig
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.open-settings-panel", async () => {
      SettingsPanel.createOrShow(context.extensionPath);
    })
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
    (ctx, ws, gc) => workspaceSetupFromCurrentDirectory(ctx, ws, gc, false));
  registerWorkspaceSetupCommand(context, "zephyr-ide.workspace-setup-from-external-directory", workspaceSetupFromExternalDirectory);
  registerWorkspaceSetupCommand(context, "zephyr-ide.workspace-setup-standard", workspaceSetupStandard);

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.west-config", async () => {
      // Always analyse the active workspace directory, not the VS Code open folder.
      // When rootPath !== setupPath (external workspace), westConfig must scan
      // setupPath so it finds the real .west folder and west.yml files there.
      const baseDir = wsConfig.activeSetupState?.setupPath || wsConfig.rootPath;
      await westConfig(context, wsConfig, globalConfig, undefined, baseDir);
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
