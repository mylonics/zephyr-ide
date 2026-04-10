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

import * as vscode from 'vscode';

import { ProjectConfig, getResolvedRunnerConfig, getResolvedTestConfig, resolveActiveProject, resolveActiveProjectBuild } from '../../project_utilities/project';
import { BuildConfig } from '../../project_utilities/build_selector';
import { RunnerConfig } from '../../project_utilities/runner_selector';
import { WorkspaceConfig } from '../../setup_utilities/types';
import { TwisterConfig } from "../../project_utilities/twister_selector";
import { getLaunchTargetDisplayName } from '../../utilities/utils';
import { generateWebviewHtml, initWebviewView } from '../webviewHelper';

export class ActiveProjectView implements vscode.WebviewViewProvider {
  public view: vscode.WebviewView | undefined;

  launchActions = [
    {
      icon: "arrow-swap",
      actionId: "changeLaunchTarget",
      tooltip: "Change Launch Target",
    },
  ];

  buildActions = [
    {
      icon: "preview",
      actionId: "startGuiConfig",
      tooltip: "GuiConfig",
    }, {
      icon: "settings",
      actionId: "startMenuConfig",
      tooltip: "MenuConfig",
    },
  ];

  testActions = [
    {
      icon: "clear-all",
      actionId: "deleteActiveTestDir",
      tooltip: "Clean Test Dirs",
    },
  ];

  constructor(public extensionPath: string, private context: vscode.ExtensionContext, private wsConfig: WorkspaceConfig) {

  }

  updateWebView(wsConfig: WorkspaceConfig) {
    if (this.view) {
      let activeProject: ProjectConfig | undefined;
      let activeBuild: BuildConfig | undefined;
      let activeRunner: RunnerConfig | undefined;
      let activeTwister: TwisterConfig | undefined;
      const resolvedProject = resolveActiveProject(wsConfig);
      if (resolvedProject) {
        activeProject = resolvedProject.project;
        const resolved = resolveActiveProjectBuild(wsConfig);
        activeBuild = resolved?.build;
        if (resolved) {
          activeRunner = getResolvedRunnerConfig(wsConfig, resolved);
          this.view.title = activeProject.name + ": " + resolved.build.name;
        } else {
          this.view.title = activeProject.name;
        }
        activeTwister = getResolvedTestConfig(wsConfig, resolvedProject);
      } else {
        this.view.title = "Active Project: None";
        this.view.webview.postMessage([{}]);
        return;
      }


      // Resolve display names for launch targets (shows workspace folder in multi-root)
      const debugDisplay = getLaunchTargetDisplayName(activeBuild?.launchTarget ?? "", activeBuild?.launchTargetFolder, "IDE for Zephyr: Debug");
      const buildDebugDisplay = getLaunchTargetDisplayName(activeBuild?.buildDebugTarget ?? "", activeBuild?.buildDebugTargetFolder, "IDE for Zephyr: Debug");
      const attachDisplay = getLaunchTargetDisplayName(activeBuild?.attachTarget ?? "", activeBuild?.attachTargetFolder, "IDE for Zephyr: Attach");

      const data = [{
        icons: {
          leaf: 'project',
        },
        actions: this.buildActions,
        label: "Build Pristine",
        description: activeBuild ? activeBuild.name : "Not Available",
        value: { command: "vsCommand", vsCommand: "zephyr-ide.build-pristine" },
      }, {
        icons: {
          leaf: 'project',
        },
        actions: this.buildActions,
        label: "Build",
        description: activeBuild ? activeBuild.name : "Not Available",
        value: { command: "vsCommand", vsCommand: "zephyr-ide.build" },
      }, {
        icons: {
          leaf: 'chip',
        },
        label: "Flash",
        description: activeRunner ? activeRunner.name : "Not Available",
        value: { command: "vsCommand", vsCommand: "zephyr-ide.flash" },
      }, {
        icons: {
          leaf: 'debug-alt',
        },
        actions: this.launchActions,
        label: "Debug",
        value: { command: "vsCommand", vsCommand: "zephyr-ide.debug", "launchChangeCmd": "zephyr-ide.change-debug-launch-for-build", },
        description: debugDisplay,
      }, {
        icons: {
          leaf: 'debug-all',
        },
        actions: this.launchActions,
        label: "Build and Debug",
        value: { command: "vsCommand", vsCommand: "zephyr-ide.build-debug", "launchChangeCmd": "zephyr-ide.change-build-debug-launch-for-build", },
        description: buildDebugDisplay,
      }, {
        icons: {
          leaf: 'debug-console',
        },
        actions: this.launchActions,
        label: "Debug Attach",
        value: { command: "vsCommand", vsCommand: "zephyr-ide.debug-attach", "launchChangeCmd": "zephyr-ide.change-debug-attach-launch-for-build" },
        description: attachDisplay,
      }];

      if (activeProject.twisterConfigs && Object.keys(activeProject.twisterConfigs).length) {
        data.push({
          icons: {
            leaf: 'beaker',
          },
          actions: this.testActions,
          label: "Twister Run",
          value: { command: "vsCommand", vsCommand: "zephyr-ide.run-test" },
          description: activeTwister ? activeTwister.name : "",
        });
      }

      this.view.webview.postMessage(data);
    }
  }

  setHtml(body: string) {
    if (this.view !== undefined) {
      this.view.webview.html = generateWebviewHtml(this.view, this.extensionPath, body, {
        handlerJsPath: 'src/panels/active_project_view/ActiveProjectViewHandler.js',
        treeElementHtml: '<vscode-tree id="basic-example" ></vscode-tree>',
        includeCSP: false,
      });
    }
  };

  resolveWebviewView(webviewView: vscode.WebviewView, context: vscode.WebviewViewResolveContext, token: vscode.CancellationToken): void | Thenable<void> {
    initWebviewView(
      this, webviewView,
      () => this.updateWebView(this.wsConfig),
      (message) => this.handleMessage(message),
      () => { this.setHtml(""); this.updateWebView(this.wsConfig); }
    );
  }

  private handleMessage(message: any) {
      switch (message.command) {
        case "vsCommand": {
          void vscode.commands.executeCommand(message.value.vsCommand);
          break;
        }
        case "changeLaunchTarget": {
          if (message.value?.launchChangeCmd) {
            void vscode.commands.executeCommand(message.value.launchChangeCmd);
          }
          break;
        }
        case "startGuiConfig": {
          void vscode.commands.executeCommand("zephyr-ide.start-gui-config");
          break;
        }
        case "startMenuConfig": {
          void vscode.commands.executeCommand("zephyr-ide.start-menu-config");
          break;
        }
        case "deleteActiveTestDir": {
          void vscode.commands.executeCommand("zephyr-ide.remove-test-dirs");
          break;
        }
        default:
          break;
      }
  }
}

