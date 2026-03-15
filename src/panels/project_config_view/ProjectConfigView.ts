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
import path from 'upath';
import { ProjectConfig, addConfigFiles, setActive, modifyBuildArguments, removeConfigFile, getResolvedRunnerConfig, getResolvedTestConfig, resolveActiveProject, resolveActiveProjectBuild } from '../../project_utilities/project';
import { BuildConfig } from '../../project_utilities/build_selector';
import { RunnerConfig } from '../../project_utilities/runner_selector';
import { ConfigFiles } from '../../project_utilities/config_selector';

import { WorkspaceConfig } from '../../setup_utilities/types';
import { TwisterConfig } from '../../project_utilities/twister_selector';
import { getSetupState } from '../../setup_utilities/workspace-config';
import { generateWebviewHtml, initWebviewView } from '../webviewHelper';
import { handleSharedProjectCommand } from '../projectCommandHandler';
import { outputInfo } from '../../utilities/output';

export class ProjectConfigState {
  projectOpenState: boolean = true;
  buildOpenState: boolean = true;
  runnerOpenState: boolean = true;
  twisterOpenState: boolean = true;
  projectKConfigOpenState: boolean = true;
  projectOverlayOpenState: boolean = true;
  buildKConfigOpenState: boolean = true;
  buildOverlayOpenState: boolean = true;
}

export class ProjectConfigView implements vscode.WebviewViewProvider {
  public view: vscode.WebviewView | undefined;
  private needToClearHtml: boolean = false;
  private treeData: any = [];

  private projectConfigState: ProjectConfigState;

  path_icons = {
    branch: 'folder-library',
    leaf: 'folder-library',
    open: 'folder-library',
  };
  fileActions = [{
    icon: "add",
    actionId: "addFile",
    tooltip: "Add File",
  }];
  fileItemActions = [{
    icon: "trash",
    actionId: "deleteFile",
    tooltip: "Delete File",
  }];
  constructor(public extensionPath: string, private context: vscode.ExtensionContext, private wsConfig: WorkspaceConfig) {
    this.projectConfigState = this.context.workspaceState.get("zephyr-ide.project-config-view-state") ?? new ProjectConfigState;
  }

  async setProjectConfigState() {
    await this.context.workspaceState.update("zephyr-ide.project-config-view-state", this.projectConfigState);
  }

  /** Shared helper to generate file entry sub-items for config or overlay files. */
  private generateFileEntries(
    entry: any,
    projectName: string,
    buildName: string | undefined,
    files: string[],
    extraFiles: string[],
    cmd: string,
    label: string,
    extraLabel: string,
    open: boolean | undefined
  ) {
    entry.subItems = [];
    entry.open = open === undefined ? true : open;
    const fileIcon = { branch: 'file', leaf: 'file', open: 'file' };
    for (const filename of files) {
      entry.subItems.push({
        icons: fileIcon, label,
        value: { project: projectName, build: buildName, cmd, isExtra: false, filename },
        actions: this.fileItemActions,
        description: filename
      });
    }
    for (const filename of extraFiles) {
      entry.subItems.push({
        icons: fileIcon, label: extraLabel,
        value: { project: projectName, build: buildName, cmd, isExtra: true, filename },
        actions: this.fileItemActions,
        description: filename
      });
    }
    return entry;
  }

  generateOverlayFileEntry(entry: any, projectName: string, buildName: string | undefined, confFiles: ConfigFiles, open: boolean | undefined) {
    if (confFiles === undefined) {
      entry.subItems = [];
      entry.open = open === undefined ? true : open;
      return entry;
    }
    return this.generateFileEntries(entry, projectName, buildName,
      confFiles.overlay, confFiles.extraOverlay, "removeOverlayFile", "dtc", "Extra dtc", open);
  }

  generateConfigFileEntry(entry: any, projectName: string, buildName: string | undefined, confFiles: ConfigFiles, open: boolean | undefined) {
    if (confFiles === undefined) {
      entry.subItems = [];
      entry.open = open === undefined ? true : open;
      return entry;
    }
    return this.generateFileEntries(entry, projectName, buildName,
      confFiles.config, confFiles.extraConfig, "removeKConfigFile", "Conf", "Extra Conf", open);
  }

  generateRunnerString(projectName: string, buildName: string, runner: RunnerConfig, open: boolean | undefined): any {
    const entry = {
      icons: {
        branch: 'chip',
        leaf: 'chip',
        open: 'chip',
      },
      label: runner.name,
      value: { project: projectName, build: buildName, runner: runner.name },
      open: open === undefined ? true : open,
      subItems: [
        {
          icons: {
            branch: 'tools',
            leaf: 'tools',
            open: 'tools',
          }, label: 'Runner', description: runner.runner
        },
        {
          icons: {
            branch: 'file-code',
            leaf: 'file-code',
            open: 'file-code',
          }, label: 'Args', description: runner.args
        }
      ]
    };

    return entry;
  }


  generateTwisterString(projectName: string, test: TwisterConfig, open: boolean | undefined): any {
    const entry = {
      icons: {
        branch: 'beaker',
        leaf: 'beaker',
        open: 'beaker',
      },
      label: test.name,
      value: { project: projectName, test: test.name },
      open: open === undefined ? true : open,
      subItems: [
        {
          icons: {
            branch: 'tools',
            leaf: 'tools',
            open: 'tools',
          }, label: 'platform', description: test.platform
        },
        {
          icons: {
            branch: 'file-code',
            leaf: 'file-code',
            open: 'file-code',
          }, label: 'Tests', description: test.tests.join(', ')
        },
        {
          icons: {
            branch: 'file-code',
            leaf: 'file-code',
            open: 'file-code',
          }, label: 'Args', description: test.args,
          value: { project: projectName, test: test.name, cmd: "modifyTestArgs" },
        }
      ]
    };
    if (test.boardConfig) {
      entry.subItems.push({
        icons: {
          branch: 'circuit-board',
          leaf: 'circuit-board',
          open: 'circuit-board',
        }, label: 'Board', description: test.boardConfig.board + (test.boardConfig.revision ? '@' + test.boardConfig.revision : "")
      });

      entry.subItems.push({
        icons: {
          branch: 'symbol-string',
          leaf: 'symbol-string',
          open: 'symbol-string',
        }, label: 'Port', description: test.serialPort ? test.serialPort : "",
        value: { project: projectName, test: test.name, cmd: "modifyTestArgs" },
      });
      entry.subItems.push({
        icons: {
          branch: 'pulse',
          leaf: 'pulse',
          open: 'pulse',
        }, label: 'Baud', description: test.serialBaud ? test.serialBaud : "",
        value: { project: projectName, test: test.name, cmd: "modifyTestArgs" },
      });

    }

    return entry;
  }


  generateBuildString(buildData: any | undefined, projectName: string, build: BuildConfig, open: boolean | undefined, kConfigOpen: boolean | undefined, overlayOpen: boolean | undefined): any {
    if (buildData === undefined) {
      buildData = {};
      buildData['icons'] = {
        branch: 'project',
        leaf: 'project',
        open: 'project',
      };
      buildData['label'] = build.name;
      buildData['value'] = { project: projectName, build: build.name };
      buildData['open'] = open === undefined ? true : open;
      buildData['subItems'] = [
        {
          icons: {
            branch: 'circuit-board',
            leaf: 'circuit-board',
            open: 'circuit-board',
          },
          value: { cmd: "openBoardDtc", project: projectName, build: build.name },
          label: 'Board',
          description: build.board + (build.revision ? '@' + build.revision : "")
        },
        {
          icons: {
            branch: 'file-submodule',
            leaf: 'file-submodule',
            open: 'file-submodule',
          },
          value: { cmd: "openBoardDir", project: projectName, build: build.name },
          label: 'Board Dir',
          description: build.relBoardSubDir,
        },
        {
          icons: {
            branch: 'settings',
            leaf: 'settings',
            open: 'settings',
          },
          actions: this.fileActions,
          label: "KConfig",
          value: { project: projectName, build: build.name, cmd: "addKConfigFile" },
          open: true,
          subItems: []
        }, {
          icons: {
            branch: 'circuit-board',
            leaf: 'circuit-board',
            open: 'circuit-board',
          },
          actions: this.fileActions,
          label: "DTC Overlay",
          value: { project: projectName, build: build.name, cmd: "addOverlayFile" },
          open: true,
          subItems: []
        }, {
          icons: {
            branch: 'circuit-board',
            leaf: 'circuit-board',
            open: 'circuit-board',
          },
          label: "West Args",
          value: { project: projectName, build: build.name, cmd: "modifyBuildArgs" },
          description: build.westBuildArgs,
        }, {
          icons: {
            branch: 'circuit-board',
            leaf: 'circuit-board',
            open: 'circuit-board',
          },
          label: "CMake Args",
          value: { project: projectName, build: build.name, cmd: "modifyBuildArgs" },
          description: build.westBuildCMakeArgs,
        },
      ];
    }
    this.generateConfigFileEntry(buildData.subItems[2], projectName, build.name, build.confFiles, kConfigOpen);
    this.generateOverlayFileEntry(buildData.subItems[3], projectName, build.name, build.confFiles, overlayOpen);

    //if statements may be removed in the future once everyone has upgraded.
    if (build.westBuildArgs) {
      buildData.subItems[4].description = build.westBuildArgs;
    }
    if (build.westBuildCMakeArgs) {
      buildData.subItems[5].description = build.westBuildCMakeArgs;
    }

    return buildData;
  }

  generateProjectString(projectData: any | undefined, project: ProjectConfig, open: boolean | undefined, kConfigOpen: boolean | undefined, overlayOpen: boolean | undefined): any {
    if (projectData === undefined) {
      projectData = {};
      projectData['icons'] = {
        branch: 'folder',
        leaf: 'file',
        open: 'folder-opened',
      };
      projectData['label'] = project.name;
      projectData['value'] = { project: project.name };
      projectData['open'] = open === undefined ? true : open;
      projectData['subItems'] = [
        {
          icons: this.path_icons,
          label: 'main',
          description: project.rel_path,
          value: { cmd: "openMain", project: project.name },
        },
        {
          icons: this.path_icons,
          label: 'CMake File',
          value: { cmd: "openCmakeFile", project: project.name },
        },
        {
          icons: {
            branch: 'settings',
            leaf: 'settings',
            open: 'settings',
          },
          actions: this.fileActions,
          label: "KConfig",
          value: { project: project.name, build: undefined, cmd: "addKConfigFile" },
          open: true,
          subItems: []
        }, {
          icons: {
            branch: 'circuit-board',
            leaf: 'circuit-board',
            open: 'circuit-board',
          },
          actions: this.fileActions,
          label: "DTC Overlay",
          value: { project: project.name, build: undefined, cmd: "addOverlayFile" },
          open: true,
          subItems: []
        },
      ];
    }
    this.generateConfigFileEntry(projectData.subItems[2], project.name, undefined, project.confFiles, kConfigOpen);
    this.generateOverlayFileEntry(projectData.subItems[3], project.name, undefined, project.confFiles, overlayOpen);

    return projectData;
  }

  updateWebView(wsConfig: WorkspaceConfig) {
    if (Object.keys(wsConfig.projects).length === 0) {
      const bodyString = '<vscode-label side-aligned="end">No Projects Registered In Workspace</vscode-label>';
      this.setHtml(bodyString);
      this.needToClearHtml = true;
      return;
    } else if (this.needToClearHtml) {
      this.setHtml("");
    }

    if (wsConfig.activeProject === undefined) {
      wsConfig.activeProject = Object.keys(wsConfig.projects)[0];
    }
    let activeProject;
    let activeBuild;
    let activeRunner;
    let activeTest;

    const resolvedProject = resolveActiveProject(wsConfig);
    if (resolvedProject) {
      activeProject = resolvedProject.project;

      const resolved = resolveActiveProjectBuild(wsConfig);
      activeBuild = resolved?.build;

      if (resolved) {
        activeRunner = getResolvedRunnerConfig(wsConfig, resolved);
      }

      activeTest = getResolvedTestConfig(wsConfig, resolvedProject);
    }


    if (this.treeData[0] !== undefined) {
      this.projectConfigState.projectOpenState = (this.treeData[0].open !== undefined) ? this.treeData[0].open : this.projectConfigState.projectOpenState;
      if (this.treeData[0].subItems !== undefined) {
        if (this.treeData[0].subItems.length >= 4) {
          this.projectConfigState.projectKConfigOpenState = this.treeData[0].subItems[2].open !== undefined ? this.treeData[0].subItems[2].open : this.projectConfigState.projectKConfigOpenState;
          this.projectConfigState.projectOverlayOpenState = this.treeData[0].subItems[3].open !== undefined ? this.treeData[0].subItems[3].open : this.projectConfigState.projectOverlayOpenState;
        }
      }
    }

    if (this.treeData[1] !== undefined) {
      this.projectConfigState.buildOpenState = this.treeData[1].open !== undefined ? this.treeData[1].open : this.projectConfigState.buildOpenState;
      if (this.treeData[1].subItems !== undefined) {
        if (this.treeData[1].subItems.length >= 4) {
          this.projectConfigState.buildKConfigOpenState = this.treeData[1].subItems[2].open !== undefined ? this.treeData[1].subItems[2].open : this.projectConfigState.buildKConfigOpenState;
          this.projectConfigState.buildOverlayOpenState = this.treeData[1].subItems[3].open !== undefined ? this.treeData[1].subItems[3].open : this.projectConfigState.buildOverlayOpenState;
        }
      }
    }

    if (this.treeData[2] !== undefined) {
      this.projectConfigState.runnerOpenState = this.treeData[2].open !== undefined ? this.treeData[2].open : this.projectConfigState.runnerOpenState;
    }

    if (this.treeData[3] !== undefined) {
      this.projectConfigState.twisterOpenState = this.treeData[3].open !== undefined ? this.treeData[3].open : this.projectConfigState.twisterOpenState;
    }

    if (activeProject) {
      this.treeData[0] = this.generateProjectString(undefined, activeProject, this.projectConfigState.projectOpenState, this.projectConfigState.projectKConfigOpenState, this.projectConfigState.projectOverlayOpenState);
      if (activeBuild) {
        this.treeData[1] = this.generateBuildString(undefined, activeProject.name, activeBuild, this.projectConfigState.buildOpenState, this.projectConfigState.buildKConfigOpenState, this.projectConfigState.buildOverlayOpenState);
        if (activeRunner) {
          this.treeData[2] = this.generateRunnerString(activeProject.name, activeBuild?.name, activeRunner, this.projectConfigState.runnerOpenState);
        } else {
          this.treeData[2] = {};
        }
      } else {
        this.treeData[1] = {};
        this.treeData[2] = {};
      }
      if (activeTest) {
        this.treeData[3] = this.generateTwisterString(activeProject.name, activeTest, this.projectConfigState.twisterOpenState);
      } else {
        this.treeData[3] = {};
      }
    } else {
      this.treeData = [];
    }


    if (this.view) {
      this.view.webview.postMessage(this.treeData);
    }
  }

  setHtml(body: string) {
    if (this.view !== undefined) {
      this.view.webview.html = generateWebviewHtml(this.view, this.extensionPath, body, {
        handlerJsPath: 'src/panels/project_config_view/ProjectConfigViewHandler.js',
        treeElementHtml: '<vscode-tree id="project-config-tree" indent-guides arrows></vscode-tree>',
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

  private async handleMessage(message: any) {
    if (message.treeData) {
      this.treeData = message.treeData;
      void this.setProjectConfigState();
    }

    // Try shared handler first (covers: deleteProject, addBuild, deleteBuild, addRunner, deleteRunner, build, buildPristine, menuConfig, guiConfig, flash, setActive)
    if (message.command && handleSharedProjectCommand(this.context, this.wsConfig, message.command, message.value, true)) {
      return;
    }

    // Handle view-specific commands
    switch (message.command) {
      case "openBoardDtc": {
        const project = this.wsConfig.projects[message.value.project];
        if (!project || !project.buildConfigs[message.value.build]) {
          return;
        }
        const build = project.buildConfigs[message.value.build];


        let boardPath: string | undefined = undefined;
        if (path.isAbsolute(build.relBoardSubDir)) {
          boardPath = build.relBoardSubDir;
        } else {
          if (build.relBoardDir) {
            //Custom Folder
            boardPath = path.join(this.wsConfig.rootPath, build.relBoardDir, build.relBoardSubDir);
          } else {
            const setupState = await getSetupState(this.context, this.wsConfig);
            if (setupState) {
              //Default zephyr folder
              boardPath = path.join(setupState.zephyrDir, 'boards', build.relBoardSubDir);
            }
          }
        }

        if (boardPath) {
          const filePath = vscode.Uri.file(path.join(boardPath, build.board + ".dts"));

          try {
            const document = await vscode.workspace.openTextDocument(filePath);
            await vscode.window.showTextDocument(document);
          } catch {
            outputInfo("Project Config", `Board DTS file not found: ${filePath.fsPath}`);
          }
          void setActive(this.context, this.wsConfig, message.value.project, message.value.build, message.value.runner);
        }
        break;
      }
      case "openMain": {
        const project = this.wsConfig.projects[message.value.project];
        const mainCPath = vscode.Uri.file(path.join(this.wsConfig.rootPath, project.rel_path, "src", "main.c"));

        try {
          const document = await vscode.workspace.openTextDocument(mainCPath);
          await vscode.window.showTextDocument(document);
        } catch {
          try {
            const mainCppPath = vscode.Uri.file(path.join(this.wsConfig.rootPath, project.rel_path, "src", "main.cpp"));
            const document = await vscode.workspace.openTextDocument(mainCppPath);
            await vscode.window.showTextDocument(document);
          } catch {
            outputInfo("Project Config", `Neither main.c nor main.cpp found in ${project.rel_path}/src`);
          }
        }

        void setActive(this.context, this.wsConfig, message.value.project, message.value.build, message.value.runner);
        break;
      }
      case "openCmakeFile": {
        const project = this.wsConfig.projects[message.value.project];
        const filePath = vscode.Uri.file(path.join(this.wsConfig.rootPath, project.rel_path, "CMakeLists.txt"));

        try {
          const document = await vscode.workspace.openTextDocument(filePath);
          await vscode.window.showTextDocument(document);
        } catch {
          outputInfo("Project Config", `CMakeLists.txt not found in ${project.rel_path}`);
        }
        void setActive(this.context, this.wsConfig, message.value.project, message.value.build, message.value.runner);
        break;
      }
      case "modifyBuildArgs": {
        void modifyBuildArguments(this.context, this.wsConfig, message.value.project, message.value.build).finally(() => { void vscode.commands.executeCommand("zephyr-ide.update-web-view"); });
        void setActive(this.context, this.wsConfig, message.value.project, message.value.build, message.value.runner);
        break;
      }
      case "modifyTestArgs": {
        void vscode.commands.executeCommand("zephyr-ide.reconfigure-active-test");
        void setActive(this.context, this.wsConfig, message.value.project, message.value.build, message.value.runner);
        break;
      }
      case "addFile": {
        switch (message.value.cmd) {
          case "addOverlayFile": {
            void addConfigFiles(this.context, this.wsConfig, false, !message.value.build, message.value.project, message.value.build).finally(() => { void vscode.commands.executeCommand("zephyr-ide.update-web-view"); });
            break;
          }
          case "addKConfigFile": {
            void addConfigFiles(this.context, this.wsConfig, true, !message.value.build, message.value.project, message.value.build).finally(() => { void vscode.commands.executeCommand("zephyr-ide.update-web-view"); });
            break;
          }
        }
        break;
      }
      case "deleteFile": {
        switch (message.value.cmd) {
          case "removeOverlayFile": {
            void removeConfigFile(this.context, this.wsConfig, false, !message.value.build, message.value.project, !message.value.isExtra, [message.value.filename], message.value.build).finally(() => { void vscode.commands.executeCommand("zephyr-ide.update-web-view"); });
            break;
          }
          case "removeKConfigFile": {
            void removeConfigFile(this.context, this.wsConfig, true, !message.value.build, message.value.project, !message.value.isExtra, [message.value.filename], message.value.build).finally(() => { void vscode.commands.executeCommand("zephyr-ide.update-web-view"); });
            break;
          }
        }
        break;
      }

      default:
        break;
    }
  }
}

