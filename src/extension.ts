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

import { getShellEnvironment, getLaunchConfigurationByName, output, executeShellCommand, getRootPath } from "./utilities/utils";

import { ActiveProjectView } from "./panels/active_project_view/ActiveProjectView";
import { ProjectTreeView } from "./panels/project_tree_view/ProjectTreeView";
import { ExtensionSetupView } from "./panels/extension_setup_view/ExtensionSetupView";

import path from "path";
import * as project from "./project_utilities/project";
import { buildHelper, buildMenuConfig, clean } from "./zephyr_utilities/build";
import { flashActive } from "./zephyr_utilities/flash";
import { WorkspaceConfig, westUpdate, workspaceInit, setWorkspaceState, loadWorkspaceState, clearWorkspaceState, westInit, checkIfToolsAvailable, setupWestEnvironment, loadProjectsFromFile, toolchainDir } from "./setup_utilities/setup";
import { installSdk } from "./setup_utilities/download";

let wsConfig: WorkspaceConfig;

let activeProjectDisplay: vscode.StatusBarItem;

export async function activate(context: vscode.ExtensionContext) {
  wsConfig = await loadWorkspaceState(context);

  let activeProjectView = new ActiveProjectView(context.extensionPath, context, wsConfig);
  let projectTreeView = new ProjectTreeView(context.extensionPath, context, wsConfig);
  let extensionSetupView = new ExtensionSetupView(context.extensionPath, context, wsConfig);

  context.subscriptions.push(vscode.commands.registerCommand("zephyr-ide.update-status", () => {
    if (wsConfig.activeProject) {
      let selectedProject = wsConfig.projects[wsConfig.activeProject];
      if (selectedProject.activeBuildConfig) {
        activeProjectDisplay.text = `$(megaphone) ${selectedProject.name}`;
        vscode.window.showInformationMessage(`Zephyr IDE:\r\n 
        Active Project: ${selectedProject.name}\r\n
        Active Build: ${selectedProject.activeBuildConfig} `);
      }
    }
  }));

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      'zephyrIdeActiveProject',
      activeProjectView,
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      'zephyrIdeProjectStatus',
      projectTreeView,
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      'zephyrIdeExtensionSetup',
      extensionSetupView,
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );

  activeProjectDisplay = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  activeProjectDisplay.command = "zephyr-ide.update-status";
  activeProjectDisplay.text = `$(megaphone) ${wsConfig.activeProject}`;
  activeProjectDisplay.tooltip = "Zephyr IDE Status";
  activeProjectDisplay.show();
  context.subscriptions.push(activeProjectDisplay);

  let activeBuildButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  activeBuildButton.command = "zephyr-ide.build";
  activeBuildButton.text = `$(play)`;
  activeBuildButton.tooltip = "Zephyr IDE Build";
  activeBuildButton.show();
  context.subscriptions.push(activeBuildButton);

  let activeFlashButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  activeFlashButton.command = "zephyr-ide.flash";
  activeFlashButton.text = `$(arrow-circle-up)`;
  activeFlashButton.tooltip = "Zephyr IDE Flash";
  activeFlashButton.show();
  context.subscriptions.push(activeFlashButton);

  let activeDebugButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  activeDebugButton.command = "zephyr-ide.debug";
  activeDebugButton.text = `$(debug-alt)`;
  activeDebugButton.tooltip = "Zephyr IDE Debug";
  activeDebugButton.show();
  context.subscriptions.push(activeDebugButton);

  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(handleChange => {
    if (wsConfig.automaticProjectSelction && handleChange) {
      let filePath = path.relative(wsConfig.rootPath, handleChange.document.uri.fsPath);

      for (let key in wsConfig.projects) {
        if (filePath.includes(wsConfig.projects[key].rel_path)) {
          if (wsConfig.activeProject !== key) {
            vscode.window.showInformationMessage(`Active project changed to ${key}`);
            wsConfig.activeProject = key;
            activeProjectDisplay.text = `$(megaphone) ${key}`;
          }
          vscode.commands.executeCommand("zephyr-ide.update-web-view");
        }
      }
    }
  }));

  // Extension/Workspace Setup Commands
  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.init-workspace", async () => {
      if (getRootPath()) {
        var setupViewUpdate = (wsConfig: WorkspaceConfig): void => {
          extensionSetupView.updateWebView(wsConfig);
        };
        await workspaceInit(context, wsConfig, setupViewUpdate);
      } else {
        vscode.window.showErrorMessage("Open Folder Before Continuing");
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.check-build-dependencies", async () => {
      await checkIfToolsAvailable(context, wsConfig);
      extensionSetupView.updateWebView(wsConfig);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.setup-west-environment", async () => {
      if (getRootPath()) {
        await setupWestEnvironment(context, wsConfig);
        extensionSetupView.updateWebView(wsConfig);
      } else {
        vscode.window.showErrorMessage("Open Folder Before Continuing");
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.install-sdk", async () => {
      await installSdk(context, wsConfig, output);
      extensionSetupView.updateWebView(wsConfig);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.west-init", async () => {
      if (wsConfig.pythonEnvironmentSetup) {
        await westInit(context, wsConfig);
        extensionSetupView.updateWebView(wsConfig);
      } else {
        vscode.window.showErrorMessage("Run `Zephyr IDE: Setup West Environment` first.");
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.west-update", async () => {
      if (wsConfig.pythonEnvironmentSetup) {
        await westUpdate(context, wsConfig);
        extensionSetupView.updateWebView(wsConfig);
      } else {
        vscode.window.showErrorMessage("Run `Zephyr IDE: Setup West Environment` first.");
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.reset-extension", async () => {
      const selection = await vscode.window.showWarningMessage('Are you sure you want to Reset the Extension?', 'Yes', 'Cancel');
      if (selection !== 'Yes') {
        return;
      }
      await clearWorkspaceState(context, wsConfig);
      extensionSetupView.updateWebView(wsConfig);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.clear-projects", async () => {
      const selection = await vscode.window.showWarningMessage('Are you sure you want to Clear All Projects?', 'Yes', 'Cancel');
      if (selection !== 'Yes') {
        return;
      }
      wsConfig.projects = {};
      wsConfig.activeProject = undefined;
      setWorkspaceState(context, wsConfig);
      vscode.commands.executeCommand("zephyr-ide.update-web-view");
      extensionSetupView.updateWebView(wsConfig);

    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.load-projects-from-file", async () => {
      await loadProjectsFromFile(wsConfig);
      vscode.commands.executeCommand("zephyr-ide.update-web-view");
      extensionSetupView.updateWebView(wsConfig);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.save-projects-to-file", async () => {
      setWorkspaceState(context, wsConfig);
    })
  );


  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.disable-automatic-project-target", async () => {
      wsConfig.automaticProjectSelction = false;
      setWorkspaceState(context, wsConfig);
    })

  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.enable-automatic-project-target", async () => {
      wsConfig.automaticProjectSelction = true;
      setWorkspaceState(context, wsConfig);
    })
  );

  // Project Setup Commands
  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.create-project", async () => {
      let projectPath = await project.createNewProjectFromSample(context, wsConfig);
      if (projectPath !== undefined) {
        await project.addProject(wsConfig, context, projectPath);
        extensionSetupView.updateWebView(wsConfig);
        vscode.commands.executeCommand("zephyr-ide.update-web-view");
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.add-project", async () => {
      await project.addProject(wsConfig, context, undefined);
      extensionSetupView.updateWebView(wsConfig);
      vscode.commands.executeCommand("zephyr-ide.update-web-view");
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.remove-project", async () => {
      await project.removeProject(context, wsConfig);
      vscode.commands.executeCommand("zephyr-ide.update-web-view");
    })
  );

  context.subscriptions.push(vscode.commands.registerCommand("zephyr-ide.add-project-config-files", async () => {
    await project.addConfigFiles(context, wsConfig, true, true);
    vscode.commands.executeCommand("zephyr-ide.update-web-view");
  })
  );

  context.subscriptions.push(vscode.commands.registerCommand("zephyr-ide.remove-project-config-files", async () => {
    await project.removeConfigFiles(context, wsConfig, true, true);
    vscode.commands.executeCommand("zephyr-ide.update-web-view");
  })
  );

  context.subscriptions.push(vscode.commands.registerCommand("zephyr-ide.add-project-overlay-files", async () => {
    await project.addConfigFiles(context, wsConfig, false, true);
    vscode.commands.executeCommand("zephyr-ide.update-web-view");
  })
  );

  context.subscriptions.push(vscode.commands.registerCommand("zephyr-ide.remove-project-overlay-files", async () => {
    await project.removeConfigFiles(context, wsConfig, false, true);
    vscode.commands.executeCommand("zephyr-ide.update-web-view");
  })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.set-active-project", async () => {
      await project.setActiveProject(context, wsConfig);
      vscode.commands.executeCommand("zephyr-ide.update-web-view");

    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.add-build", async () => {
      if (wsConfig.westUpdated) {
        await project.addBuild(wsConfig, context);
        vscode.commands.executeCommand("zephyr-ide.update-web-view");
      } else {
        vscode.window.showErrorMessage("Run `Zephyr IDE: West Update` first.");
      }
    })
  );

  vscode.workspace.onDidChangeConfiguration((event: vscode.ConfigurationChangeEvent) => {
    //const projectsFileChanged = event.affectsConfiguration(`zephyr-ide.use-zephyr-ide-json`);
    const projectsChanged = event.affectsConfiguration(`zephyr-ide.projects`);

    if (projectsChanged) {
      vscode.commands.executeCommand("zephyr-ide.load-projects-from-file");
    }
  });

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.remove-build", async () => {
      await project.removeBuild(context, wsConfig);
      vscode.commands.executeCommand("zephyr-ide.update-web-view");
    })
  );

  context.subscriptions.push(vscode.commands.registerCommand("zephyr-ide.add-build-config-files", async () => {
    await project.addConfigFiles(context, wsConfig, true, false);
    vscode.commands.executeCommand("zephyr-ide.update-web-view");
  })
  );

  context.subscriptions.push(vscode.commands.registerCommand("zephyr-ide.remove-build-config-files", async () => {
    await project.removeConfigFiles(context, wsConfig, true, false);
    vscode.commands.executeCommand("zephyr-ide.update-web-view");
  })
  );

  context.subscriptions.push(vscode.commands.registerCommand("zephyr-ide.add-build-overlay-files", async () => {
    await project.addConfigFiles(context, wsConfig, false, false);
    vscode.commands.executeCommand("zephyr-ide.update-web-view");
  })
  );

  context.subscriptions.push(vscode.commands.registerCommand("zephyr-ide.remove-build-overlay-files", async () => {
    await project.removeConfigFiles(context, wsConfig, false, false);
    vscode.commands.executeCommand("zephyr-ide.update-web-view");
  })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.set-active-build", async () => {
      await project.setActiveBuild(context, wsConfig);
      vscode.commands.executeCommand("zephyr-ide.update-web-view");

    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.add-runner", async () => {
      if (wsConfig.westUpdated) {
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
    vscode.commands.registerCommand("zephyr-ide.set-active-runner", async () => {
      await project.setActiveRunner(context, wsConfig);
      vscode.commands.executeCommand("zephyr-ide.update-web-view");

    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.change-debug-launch-for-build", async () => {
      await project.selectDebugLaunchConfiguration(context, wsConfig);
      vscode.commands.executeCommand("zephyr-ide.update-web-view");

    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.change-build-debug-launch-for-build", async () => {
      await project.selectBuildDebugLaunchConfiguration(context, wsConfig);
      vscode.commands.executeCommand("zephyr-ide.update-web-view");

    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.change-debug-attach-launch-for-build", async () => {
      await project.selectDebugAttachLaunchConfiguration(context, wsConfig);
      vscode.commands.executeCommand("zephyr-ide.update-web-view");

    })
  );

  //Debugger Helper commands
  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.get-active-project-name", async () => {
      return wsConfig.activeProject;
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.get-active-project-path", async () => {
      if (wsConfig.activeProject) {
        return path.join(wsConfig.rootPath, wsConfig.projects[wsConfig.activeProject].rel_path);
      }
      return;
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.get-active-build-path", async () => {
      if (wsConfig.activeProject) {
        let project = wsConfig.projects[wsConfig.activeProject];
        if (project.activeBuildConfig) {
          return path.join(wsConfig.rootPath, project.rel_path, project.activeBuildConfig);
        }
      }
      return;
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.select-active-build-path", async () => {
      await project.setActiveProject(context, wsConfig);
      await project.setActiveBuild(context, wsConfig);
      vscode.commands.executeCommand("zephyr-ide.update-web-view");

      if (wsConfig.activeProject) {
        let project = wsConfig.projects[wsConfig.activeProject];
        if (project.activeBuildConfig) {
          return path.join(wsConfig.rootPath, project.rel_path, project.activeBuildConfig);
        }
      }
      return;
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.get-gdb-path", async () => {
      return wsConfig.armGdbPath;
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.get-toolchain-path", async () => {
      return toolchainDir;
    })
  );

  //Board commands
  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.build-pristine", async () => {
      buildHelper(context, wsConfig, true);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.build", async () => {
      buildHelper(context, wsConfig, false);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.flash", async () => {
      if (wsConfig.westUpdated) {
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
      let debugConfig = getLaunchConfigurationByName(debugTarget);
      if (debugConfig) {
        await vscode.commands.executeCommand('debug.startFromConfig', debugConfig);
      } else {
        vscode.window.showErrorMessage("Launch Configuration: " + debugTarget + " not found");
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
      let debugConfig = getLaunchConfigurationByName(debugTarget);
      if (debugConfig) {
        await vscode.commands.executeCommand('debug.startFromConfig', debugConfig);
      } else {
        vscode.window.showErrorMessage("Launch Configuration: " + debugTarget + " not found");
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
      let debugConfig = getLaunchConfigurationByName(debugTarget);

      if (debugConfig) {
        await buildHelper(context, wsConfig, false);
        await vscode.commands.executeCommand('debug.startFromConfig', debugConfig);
      } else {
        vscode.window.showErrorMessage("Launch Configuration: " + debugTarget + " not found");
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.clean", async () => {
      if (wsConfig.westUpdated) {
        await clean(wsConfig, undefined);
      } else {
        vscode.window.showErrorMessage("Run `Zephyr IDE: West Update` first.");
      }
    })
  );


  context.subscriptions.push(vscode.window.registerTerminalProfileProvider('zephyr-ide.terminal-profile', {
    provideTerminalProfile(token: vscode.CancellationToken): vscode.ProviderResult<vscode.TerminalProfile> {
      let opts: vscode.TerminalOptions = {
        name: "Zephyr IDE Terminal",
        env: getShellEnvironment(wsConfig),
      };
      return new vscode.TerminalProfile(opts);
    }
  }));

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.update-web-view", async () => {
      activeProjectView.updateWebView(wsConfig);
      projectTreeView.updateWebView(wsConfig);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.start-menu-config", async () => {
      buildMenuConfig(wsConfig, true);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.start-gui-config", async () => {
      buildMenuConfig(wsConfig, false);
    })
  );


  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.modify-build-arguments", async () => {
      project.modifyBuildArguments(context, wsConfig);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("zephyr-ide.debug-internal-shell", async () => {
      let temp = await executeShellCommand("SET", wsConfig.rootPath, getShellEnvironment(wsConfig), false);
      if (temp.stdout) {
        output.append(temp.stdout);
      }
    })
  );

}

export function deactivate() { }
