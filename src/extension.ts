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
import path from "path";

import { ActiveProjectView } from "./panels/active_project_view/ActiveProjectView";
import { ProjectTreeView } from "./panels/project_tree_view/ProjectTreeView";
import { ExtensionSetupView } from "./panels/extension_setup_view/ExtensionSetupView";
import { ProjectConfigView } from "./panels/project_config_view/ProjectConfigView";
import { SetupPanel } from "./panels/setup_panel/SetupPanel";

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
    SetupPanel.currentPanel.updateContent(wsConfig, globalConfig);
  }
}

import {
  getLaunchConfigurationByName,
  output,
  executeShellCommand,
  reloadEnvironmentVariables,
  getRootPathFs,
  executeTaskHelper,
  getPlatformName,
} from "./utilities/utils";
import * as project from "./project_utilities/project";
import {
  buildHelper,
  buildMenuConfig,
  buildRamRomReport,
  runDtshShell,
  clean,
  MenuConfig,
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
  getToolsDir,
  setWorkspaceSettings,
} from "./setup_utilities/workspace-config";
import { checkIfToolsAvailable } from "./setup_utilities/tools-validation";
import {
  postWorkspaceSetup,
  westInit,
  setupWestEnvironment,
  westUpdateWithRequirements,
} from "./setup_utilities/west-operations";
import {
  showWorkspaceSetupPicker,
  workspaceSetupFromGit,
  workspaceSetupFromWestGit,
  workspaceSetupFromCurrentDirectory,
  workspaceSetupStandard,
  manageWorkspaces,
} from "./setup_utilities/workspace-setup";
import {
  initializeDtsExt,
  printContexts,
  setDtsContext,
} from "./setup_utilities/dts_interface";
import {
  setActiveProject,
  getActiveRunnerNameOfBuild,
  getActiveBuildNameOfProject,
  getActiveBuildConfigOfProject,
} from "./project_utilities/project";
import { testHelper, deleteTestDirs } from "./zephyr_utilities/twister";
import { installHostTools } from "./setup_utilities/host_tools";

import { getModuleVersion } from "./setup_utilities/modules";
import { reconfigureTest } from "./project_utilities/twister_selector";
import { installSDKInteractive } from "./setup_utilities/west_sdk";

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
  context.environmentVariableCollection.description =
    "Zephyr IDE adds python path";
  context.environmentVariableCollection.replace("ZFUN", "REALLY FUN1");

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

  let activeProjectView = new ActiveProjectView(
    context.extensionPath,
    context,
    wsConfig
  );
  let projectTreeView = new ProjectTreeView(
    context.extensionPath,
    context,
    wsConfig
  );
  let projectConfigView = new ProjectConfigView(
    context.extensionPath,
    context,
    wsConfig
  );
  let extensionSetupView = new ExtensionSetupView(
    context.extensionPath,
    context,
    wsConfig,
    globalConfig
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.update-status", () => {
      if (wsConfig.activeProject) {
        activeProjectDisplay.text = `$(folder) ${wsConfig.activeProject}`;
        let activeBuild = getActiveBuildConfigOfProject(
          wsConfig,
          wsConfig.activeProject
        );

        if (activeBuild) {
          setDtsContext(
            wsConfig,
            wsConfig.projects[wsConfig.activeProject],
            activeBuild
          );
          activeBuildDisplay.text = `$(project) ${activeBuild.name}`;
          let activeRunner;
          if (activeBuild) {
            activeRunner = getActiveRunnerNameOfBuild(
              wsConfig,
              wsConfig.activeProject,
              activeBuild.name
            );
          }
          if (activeRunner) {
            activeRunnerDisplay.text = `$(chip) ${activeRunner}`;
          } else {
            activeRunnerDisplay.text = ``;
          }
        } else {
          activeBuildDisplay.text = ``;
          activeRunnerDisplay.text = ``;
        }
      }
    })
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      "zephyrIdeActiveProject",
      activeProjectView,
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      "zephyrIdeProjects",
      projectTreeView,
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      "zephyrIdeProjectStatus",
      projectConfigView,
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      "zephyrIdeExtensionSetup",
      extensionSetupView,
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "zephyr-ide.set-active-runner",
      async () => {
        await project.setActiveRunner(context, wsConfig);
        vscode.commands.executeCommand("zephyr-ide.update-web-view");
      }
    )
  );

  activeProjectDisplay = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100
  );
  activeProjectDisplay.command = "zephyr-ide.set-active-project";
  activeProjectDisplay.text = `$(folder) ${wsConfig.activeProject}`;
  activeProjectDisplay.tooltip = "Zephyr IDE Active Project";
  activeProjectDisplay.show();
  context.subscriptions.push(activeProjectDisplay);

  activeBuildDisplay = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100
  );
  activeBuildDisplay.command = "zephyr-ide.set-active-build";
  if (wsConfig.activeProject) {
    let activeBuild = getActiveBuildNameOfProject(
      wsConfig,
      wsConfig.activeProject
    );
    if (activeBuild) {
      activeBuildDisplay.text = `$(project) ${activeBuild}`;
    }
  }
  activeBuildDisplay.tooltip = "Zephyr IDE Active Build";
  activeBuildDisplay.show();
  context.subscriptions.push(activeBuildDisplay);

  activeRunnerDisplay = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100
  );
  activeRunnerDisplay.command = "zephyr-ide.set-active-runner";

  if (wsConfig.activeProject) {
    let activeBuild = getActiveBuildNameOfProject(
      wsConfig,
      wsConfig.activeProject
    );
    if (activeBuild) {
      let activeRunner = getActiveRunnerNameOfBuild(
        wsConfig,
        wsConfig.activeProject,
        activeBuild
      );
      if (activeRunner) {
        activeRunnerDisplay.text = `$(chip) ${activeRunner}`;
      }
    }
  }
  activeRunnerDisplay.tooltip = "Zephyr IDE Active Runner";
  activeRunnerDisplay.show();
  context.subscriptions.push(activeRunnerDisplay);

  let activeBuildPristineButton = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100
  );
  activeBuildPristineButton.command = "zephyr-ide.build-pristine";
  activeBuildPristineButton.text = `$(debug-rerun)`;
  activeBuildPristineButton.tooltip = "Zephyr IDE Build Pristine";
  activeBuildPristineButton.show();
  context.subscriptions.push(activeBuildPristineButton);

  let activeBuildButton = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100
  );
  activeBuildButton.command = "zephyr-ide.build";
  activeBuildButton.text = `$(play)`;
  activeBuildButton.tooltip = "Zephyr IDE Build";
  activeBuildButton.show();
  context.subscriptions.push(activeBuildButton);

  let activeFlashButton = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100
  );
  activeFlashButton.command = "zephyr-ide.flash";
  activeFlashButton.text = `$(arrow-circle-up)`;
  activeFlashButton.tooltip = "Zephyr IDE Flash";
  activeFlashButton.show();
  context.subscriptions.push(activeFlashButton);

  let activeDebugButton = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100
  );
  activeDebugButton.command = "zephyr-ide.debug";
  activeDebugButton.text = `$(debug-alt)`;
  activeDebugButton.tooltip = "Zephyr IDE Debug";
  activeDebugButton.show();
  context.subscriptions.push(activeDebugButton);

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((handleChange) => {
      if (wsConfig.automaticProjectSelction && handleChange) {
        let filePath = path.relative(
          wsConfig.rootPath,
          handleChange.document.uri.fsPath
        );

        for (let key in wsConfig.projects) {
          if (filePath.includes(wsConfig.projects[key].rel_path)) {
            if (wsConfig.activeProject !== key) {
              setActiveProject(context, wsConfig, key);
              activeProjectDisplay.text = `$(folder) ${key}`;
              let activeBuild = getActiveBuildNameOfProject(
                wsConfig,
                wsConfig.activeProject
              );
              activeBuildDisplay.text = `$(project) ${activeBuild}`;
              let activeRunner;
              if (activeBuild) {
                activeRunner = getActiveRunnerNameOfBuild(
                  wsConfig,
                  wsConfig.activeProject,
                  activeBuild
                );
              }
              activeRunnerDisplay.text = `$(chip) ${activeRunner}`;
            }
            vscode.commands.executeCommand("zephyr-ide.update-web-view");
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
        let res = await checkIfToolsAvailable(context, wsConfig, globalConfig);

        if (res) {
          vscode.commands.executeCommand(
            "setContext",
            "buildDependenciesAvailable",
            true
          );
        }
        extensionSetupView.updateWebView(wsConfig, globalConfig);
        console.log(res);
        return res;
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "zephyr-ide.setup-west-environment",
      async () => {
        if (wsConfig.rootPath !== "") {
          await setupWestEnvironment(context, wsConfig, globalConfig);
          extensionSetupView.updateWebView(wsConfig, globalConfig);
        } else {
          vscode.window.showErrorMessage("Open Folder Before Continuing");
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
        vscode.window.showErrorMessage(
          "Run `Zephyr IDE: Setup West Environment` first."
        );
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.west-update", async () => {
      if (
        wsConfig.activeSetupState &&
        wsConfig.activeSetupState.pythonEnvironmentSetup
      ) {
        await westUpdateWithRequirements(context, wsConfig, globalConfig);
        extensionSetupView.updateWebView(wsConfig, globalConfig);
      } else {
        vscode.window.showErrorMessage(
          "Run `Zephyr IDE: Setup West Environment` first."
        );
      }
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
      setWorkspaceState(context, wsConfig);
      vscode.commands.executeCommand("zephyr-ide.update-web-view");
      extensionSetupView.updateWebView(wsConfig, globalConfig);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "zephyr-ide.load-projects-from-file",
      async () => {
        await loadProjectsFromFile(wsConfig);
        vscode.commands.executeCommand("zephyr-ide.update-web-view");
        extensionSetupView.updateWebView(wsConfig, globalConfig);
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "zephyr-ide.save-projects-to-file",
      async () => {
        setWorkspaceState(context, wsConfig);
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "zephyr-ide.disable-automatic-project-target",
      async () => {
        wsConfig.automaticProjectSelction = false;
        setWorkspaceState(context, wsConfig);
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "zephyr-ide.enable-automatic-project-target",
      async () => {
        wsConfig.automaticProjectSelction = true;
        setWorkspaceState(context, wsConfig);
      }
    )
  );

  // Project Setup Commands
  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.create-project", async () => {
      let projectPath = await project.createNewProjectFromSample(wsConfig);
      if (projectPath !== undefined) {
        let result = await project.addProject(wsConfig, context, projectPath);
        extensionSetupView.updateWebView(wsConfig, globalConfig);
        vscode.commands.executeCommand("zephyr-ide.update-web-view");
        return result;
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.add-project", async () => {
      let result = await project.addProject(wsConfig, context, undefined);
      extensionSetupView.updateWebView(wsConfig, globalConfig);
      vscode.commands.executeCommand("zephyr-ide.update-web-view");
      return result;
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.remove-project", async () => {
      await project.removeProject(context, wsConfig);
      vscode.commands.executeCommand("zephyr-ide.update-web-view");
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "zephyr-ide.add-project-config-files",
      async () => {
        await project.addConfigFiles(context, wsConfig, true, true);
        vscode.commands.executeCommand("zephyr-ide.update-web-view");
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "zephyr-ide.remove-project-config-files",
      async () => {
        await project.removeConfigFiles(context, wsConfig, true, true);
        vscode.commands.executeCommand("zephyr-ide.update-web-view");
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "zephyr-ide.add-project-overlay-files",
      async () => {
        await project.addConfigFiles(context, wsConfig, false, true);
        vscode.commands.executeCommand("zephyr-ide.update-web-view");
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "zephyr-ide.remove-project-overlay-files",
      async () => {
        await project.removeConfigFiles(context, wsConfig, false, true);
        vscode.commands.executeCommand("zephyr-ide.update-web-view");
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "zephyr-ide.set-active-project",
      async () => {
        await project.setActiveProject(context, wsConfig);
        vscode.commands.executeCommand("zephyr-ide.update-web-view");
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.add-build", async () => {
      if (wsConfig.activeSetupState && wsConfig.activeSetupState.westUpdated) {
        let result = await project.addBuild(wsConfig, context);
        vscode.commands.executeCommand("zephyr-ide.update-web-view");
        return result;
      } else {
        vscode.window.showErrorMessage("Run `Zephyr IDE: West Update` first.");
      }
      return false;
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.remove-build", async () => {
      await project.removeBuild(context, wsConfig);
      vscode.commands.executeCommand("zephyr-ide.update-web-view");
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.add-test", async () => {
      if (wsConfig.activeSetupState && wsConfig.activeSetupState.westUpdated) {
        await project.addTest(wsConfig, context);
        vscode.commands.executeCommand("zephyr-ide.update-web-view");
      } else {
        vscode.window.showErrorMessage("Run `Zephyr IDE: West Update` first.");
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.remove-test", async () => {
      await project.removeTest(context, wsConfig);
      vscode.commands.executeCommand("zephyr-ide.update-web-view");
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.set-active-test", async () => {
      await project.setActiveTest(context, wsConfig);
      vscode.commands.executeCommand("zephyr-ide.update-web-view");
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.run-test", async () => {
      testHelper(context, wsConfig);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.remove-test-dirs", async () => {
      let activeProject = project.getActiveProject(wsConfig);
      if (activeProject) {
        deleteTestDirs(wsConfig, activeProject);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "zephyr-ide.reconfigure-active-test",
      async () => {
        let activeProject = project.getActiveProject(wsConfig);
        if (activeProject) {
          let activeTest = project.getActiveTestConfigOfProject(
            wsConfig,
            activeProject.name
          );
          if (activeTest) {
            await reconfigureTest(activeTest);
            await setWorkspaceState(context, wsConfig);
          }
        }
        vscode.commands.executeCommand("zephyr-ide.update-web-view");
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "zephyr-ide.add-build-config-files",
      async () => {
        await project.addConfigFiles(context, wsConfig, true, false);
        vscode.commands.executeCommand("zephyr-ide.update-web-view");
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "zephyr-ide.remove-build-config-files",
      async () => {
        await project.removeConfigFiles(context, wsConfig, true, false);
        vscode.commands.executeCommand("zephyr-ide.update-web-view");
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "zephyr-ide.add-build-overlay-files",
      async () => {
        await project.addConfigFiles(context, wsConfig, false, false);
        vscode.commands.executeCommand("zephyr-ide.update-web-view");
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "zephyr-ide.remove-build-overlay-files",
      async () => {
        await project.removeConfigFiles(context, wsConfig, false, false);
        vscode.commands.executeCommand("zephyr-ide.update-web-view");
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.set-active-build", async () => {
      await project.setActiveBuild(context, wsConfig);
      vscode.commands.executeCommand("zephyr-ide.update-web-view");
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.add-runner", async () => {
      if (wsConfig.activeSetupState && wsConfig.activeSetupState.westUpdated) {
        await project.addRunner(wsConfig, context);
        vscode.commands.executeCommand("zephyr-ide.update-web-view");
      } else {
        vscode.window.showErrorMessage("Run `Zephyr IDE: West Update` first.");
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.remove-runner", async () => {
      await project.removeRunner(context, wsConfig);
      vscode.commands.executeCommand("zephyr-ide.update-web-view");
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "zephyr-ide.change-debug-launch-for-build",
      async () => {
        await project.selectDebugLaunchConfiguration(context, wsConfig);
        vscode.commands.executeCommand("zephyr-ide.update-web-view");
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "zephyr-ide.change-build-debug-launch-for-build",
      async () => {
        await project.selectBuildDebugLaunchConfiguration(context, wsConfig);
        vscode.commands.executeCommand("zephyr-ide.update-web-view");
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "zephyr-ide.change-debug-attach-launch-for-build",
      async () => {
        await project.selectDebugAttachLaunchConfiguration(context, wsConfig);
        vscode.commands.executeCommand("zephyr-ide.update-web-view");
      }
    )
  );

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
        if (wsConfig.activeProject) {
          let project = wsConfig.projects[wsConfig.activeProject];
          let activeBuildConfig =
            wsConfig.projectStates[wsConfig.activeProject].activeBuildConfig;

          if (activeBuildConfig) {
            return path.join(
              wsConfig.rootPath,
              project.rel_path,
              activeBuildConfig
            );
          }
        }
        return;
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "zephyr-ide.get-active-build-board-path",
      async () => {
        if (wsConfig.activeProject) {
          let project = wsConfig.projects[wsConfig.activeProject];
          let activeBuildConfig =
            wsConfig.projectStates[wsConfig.activeProject].activeBuildConfig;

          if (activeBuildConfig && wsConfig.activeSetupState) {
            let build = project.buildConfigs[activeBuildConfig];

            if (build.relBoardDir) {
              //Custom Folder
              return path.join(
                wsConfig.rootPath,
                build.relBoardDir,
                build.relBoardSubDir
              );
            } else if (wsConfig.activeSetupState) {
              //Default zephyr folder
              return path.join(
                wsConfig.activeSetupState?.zephyrDir,
                "boards",
                build.relBoardSubDir
              );
            }
          }
        }
        return;
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "zephyr-ide.get-active-board-name",
      async () => {
        if (wsConfig.activeProject) {
          let project = wsConfig.projects[wsConfig.activeProject];
          let activeBuildConfig =
            wsConfig.projectStates[wsConfig.activeProject].activeBuildConfig;

          if (activeBuildConfig && wsConfig.activeSetupState) {
            return path.join(
              wsConfig.activeSetupState.setupPath,
              project.buildConfigs[activeBuildConfig].board
            );
          }
        }
        return;
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "zephyr-ide.select-active-build-path",
      async () => {
        await project.setActiveProject(context, wsConfig);
        await project.setActiveBuild(context, wsConfig);
        vscode.commands.executeCommand("zephyr-ide.update-web-view");

        if (wsConfig.activeProject) {
          let project = wsConfig.projects[wsConfig.activeProject];
          let activeBuildConfig =
            wsConfig.projectStates[wsConfig.activeProject].activeBuildConfig;
          if (activeBuildConfig) {
            return path.join(
              wsConfig.rootPath,
              project.rel_path,
              activeBuildConfig
            );
          }
        }
        return;
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.get-gdb-path", async () => {
      return globalConfig.armGdbPath;
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.get-zephyr-dir", async () => {
      return wsConfig.activeSetupState?.zephyrDir;
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "zephyr-ide.get-toolchain-path",
      async () => {
        return await getToolchainDir();
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
          let activeBuildConfig =
            wsConfig.projectStates[wsConfig.activeProject].activeBuildConfig;
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
      if (wsConfig.activeSetupState && wsConfig.activeSetupState.westUpdated) {
        await flashActive(wsConfig);
      } else {
        vscode.window.showErrorMessage("Run `Zephyr IDE: West Update` first.");
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.debug", async () => {
      let debugTarget = "Zephyr IDE: Debug";
      let activeBuild = await project.getActiveBuild(context, wsConfig);

      if (activeBuild?.launchTarget) {
        debugTarget = activeBuild.launchTarget;
      }
      let debugConfig = await getLaunchConfigurationByName(
        wsConfig,
        debugTarget
      );
      if (debugConfig) {
        await vscode.commands.executeCommand(
          "debug.startFromConfig",
          debugConfig
        );
      } else {
        vscode.window.showErrorMessage(
          "Launch Configuration: " + debugTarget + " not found"
        );
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.debug-attach", async () => {
      let debugTarget = "Zephyr IDE: Attach";
      let activeBuild = await project.getActiveBuild(context, wsConfig);

      if (activeBuild?.attachTarget) {
        debugTarget = activeBuild.attachTarget;
      }
      let debugConfig = await getLaunchConfigurationByName(
        wsConfig,
        debugTarget
      );
      if (debugConfig) {
        await vscode.commands.executeCommand(
          "debug.startFromConfig",
          debugConfig
        );
      } else {
        vscode.window.showErrorMessage(
          "Launch Configuration: " + debugTarget + " not found"
        );
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.build-debug", async () => {
      let debugTarget = "Zephyr IDE: Debug";
      let activeBuild = await project.getActiveBuild(context, wsConfig);

      if (activeBuild?.buildDebugTarget) {
        debugTarget = activeBuild.buildDebugTarget;
      }
      let debugConfig = await getLaunchConfigurationByName(
        wsConfig,
        debugTarget
      );

      if (debugConfig) {
        let res = await buildHelper(context, wsConfig, false);
        if (res) {
          await vscode.commands.executeCommand(
            "debug.startFromConfig",
            debugConfig
          );
        }
      } else {
        vscode.window.showErrorMessage(
          "Launch Configuration: " + debugTarget + " not found"
        );
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.clean", async () => {
      if (wsConfig.activeSetupState && wsConfig.activeSetupState.westUpdated) {
        await clean(wsConfig, undefined);
      } else {
        vscode.window.showErrorMessage("Run `Zephyr IDE: West Update` first.");
      }
    })
  );

  context.subscriptions.push(
    vscode.window.registerTerminalProfileProvider("zephyr-ide.terminal-profile", {
      provideTerminalProfile(
        token: vscode.CancellationToken
      ): vscode.ProviderResult<vscode.TerminalProfile> {
        let opts: vscode.TerminalOptions = {
          name: "Zephyr IDE Terminal",
        };
        return new vscode.TerminalProfile(opts);
      },
    }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.update-web-view", async () => {
      activeProjectView.updateWebView(wsConfig);
      projectTreeView.updateWebView(wsConfig);
      projectConfigView.updateWebView(wsConfig);
      vscode.commands.executeCommand("zephyr-ide.update-status");
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.start-menu-config", async () => {
      buildMenuConfig(wsConfig, MenuConfig.MenuConfig);
    }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.start-gui-config", async () => {
      buildMenuConfig(wsConfig, MenuConfig.GuiConfig);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.start-dtsh-shell", async () => {
      runDtshShell(wsConfig);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.run-ram-report", async () => {
      buildRamRomReport(wsConfig, true);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.run-rom-report", async () => {
      buildRamRomReport(wsConfig, false);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.modify-build-arguments", async () => {
      project.modifyBuildArguments(context, wsConfig);
    }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.debug-internal-shell", async () => {
      output.clear();
      let temp = await executeShellCommand("SET", wsConfig.rootPath, false);
      if (temp.stdout) {
        output.append(temp.stdout);
      }
      output.append(JSON.stringify({ wsConfig }));
      output.append(JSON.stringify({ globalConfig }));
    }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "zephyr-ide.reset-zephyr-install-selection",
      async () => {
        clearSetupState(context, wsConfig, globalConfig);
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
          saveSetupState(context, wsConfig, globalConfig);
        }
        extensionSetupView.updateWebView(wsConfig, globalConfig);
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.reint-dts", async () => {
      if (wsConfig.activeSetupState) {
        initializeDtsExt(wsConfig.activeSetupState, wsConfig);
      } else {
        vscode.window.showErrorMessage(
          "First Initialize Zephyr IDE Workspace Folder"
        );
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.set-workspace-settings", async () => {
      setWorkspaceSettings(true);
    }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.install-host-tools", async () => {
      let res = await installHostTools(context);
      if (res) {
        vscode.commands.executeCommand(
          "setContext",
          "hostToolsInstalled",
          true
        );
      }
    }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.install-sdk", async () => {
      return await installSDKInteractive(wsConfig, globalConfig, context);
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

  // New workspace setup commands
  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.workspace-setup-picker", async () => {
      await showWorkspaceSetupPicker(context, wsConfig, globalConfig);
    }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.workspace-setup-from-git", async () => {
      const success = await workspaceSetupFromGit(
        context,
        wsConfig,
        globalConfig
      );
      if (success) {
        await markWorkspaceSetupComplete(context, wsConfig, globalConfig);
      }
      return success;
    }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.workspace-setup-from-west-git", async () => {
      const success = await workspaceSetupFromWestGit(
        context,
        wsConfig,
        globalConfig
      );
      if (success) {
        await markWorkspaceSetupComplete(context, wsConfig, globalConfig);
      }
      return success;
    }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.workspace-setup-from-current-directory", async () => {
      const success = await workspaceSetupFromCurrentDirectory(
        context,
        wsConfig,
        globalConfig,
        true
      );
      if (success) {
        await markWorkspaceSetupComplete(context, wsConfig, globalConfig);
      }
      return success;
    }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.workspace-setup-standard", async () => {
      const success = await workspaceSetupStandard(
        context,
        wsConfig,
        globalConfig
      );
      if (success) {
        await markWorkspaceSetupComplete(context, wsConfig, globalConfig);
      }
      return success;
    }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.shell_test", async () => {
      output.show();
      printContexts();

      const configuration = await vscode.workspace.getConfiguration();
      let platform_name = "osx";
      let force_bash = true;
      output.appendLine(
        configuration.get(
          "terminal.integrated.defaultProfile." + platform_name
        ) ?? ""
      );
      output.appendLine(
        configuration.get(
          "terminal.integrated.defaultProfile." + platform_name
        ) === "zsh"
          ? "default set to zsh"
          : "default set to something else"
      );

      let default_terminal =
        configuration.get(
          "terminal.integrated.defaultProfile." + platform_name
        ) === "zsh" || force_bash
          ? "bash"
          : "Zephyr IDE Terminal";
      output.appendLine("Setting terminal to: " + default_terminal);
      //configuration.update('terminal.integrated.defaultProfile.' + platform_name, default_terminal, target, false);
      output.appendLine(
        configuration.get(
          "terminal.integrated.defaultProfile." + platform_name
        ) ?? ""
      );
      output.appendLine("Finished");
    })
  );

  // Return API for tests and other extensions
  return {
    getWorkspaceConfig: () => wsConfig,
  };
}

export function deactivate() { }
