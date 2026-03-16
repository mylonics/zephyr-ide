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
import { ProjectConfig, addConfigFiles, setActive, modifyBuildArguments, modifyProjectVariables, modifyBuildVariables, removeConfigFile, getResolvedTestConfig, resolveActiveProject } from '../../project_utilities/project';
import { BuildConfig } from '../../project_utilities/build_selector';
import { ConfigFiles } from '../../project_utilities/config_selector';

import { WorkspaceConfig } from '../../setup_utilities/types';
import { TwisterConfig } from '../../project_utilities/twister_selector';
import { getSetupState } from '../../setup_utilities/workspace-config';
import { generateWebviewHtml, initWebviewView } from '../webviewHelper';
import { handleSharedProjectCommand, FILE_ADD_ACTION, FILE_DELETE_ACTION } from '../projectCommandHandler';
import { outputInfo } from '../../utilities/output';

export class ProjectConfigState {
  projectOpenState: boolean = true;
  twisterOpenState: boolean = true;
  projectKConfigOpenState: boolean = true;
  projectOverlayOpenState: boolean = true;
  projectVariablesOpenState: boolean = true;
  buildsOpenState: boolean = true;
  /** Per-build open states keyed by build name */
  buildStates: {
    [buildName: string]: {
      open?: boolean;
      kConfigOpen?: boolean;
      overlayOpen?: boolean;
      variablesOpen?: boolean;
      calcOpen?: boolean;
    }
  } = {};
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
  fileActions = FILE_ADD_ACTION;
  fileItemActions = FILE_DELETE_ACTION;
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


  generateBuildString(projectName: string, build: BuildConfig, projectConfFiles: ConfigFiles, buildState: { open?: boolean; kConfigOpen?: boolean; overlayOpen?: boolean; variablesOpen?: boolean; calcOpen?: boolean } | undefined): any {
    const open = buildState?.open;
    const kConfigOpen = buildState?.kConfigOpen;
    const overlayOpen = buildState?.overlayOpen;
    const variablesOpen = buildState?.variablesOpen;
    const calcOpen = buildState?.calcOpen;

    const buildActions = [
      { icon: "play", actionId: "build", tooltip: "Build" },
      { icon: "debug-rerun", actionId: "buildPristine", tooltip: "Build Pristine" },
      { icon: "arrow-circle-up", actionId: "flash", tooltip: "Flash" },
      { icon: "debug-alt", actionId: "debug", tooltip: "Debug" },
      { icon: "debug-all", actionId: "buildDebug", tooltip: "Build and Debug" },
      { icon: "add", actionId: "addRunner", tooltip: "Add Runner" },
      { icon: "trash", actionId: "deleteBuild", tooltip: "Delete Build" },
    ];

    const buildData: any = {};
    buildData['icons'] = {
      branch: 'project',
      leaf: 'project',
      open: 'project',
    };
    buildData['label'] = build.name;
    buildData['value'] = { project: projectName, build: build.name };
    buildData['open'] = open === undefined ? true : open;
    buildData['actions'] = buildActions;
    buildData['description'] = build.board + (build.revision ? '@' + build.revision : "");
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
        open: kConfigOpen === undefined ? true : kConfigOpen,
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
        open: overlayOpen === undefined ? true : overlayOpen,
        subItems: []
      }, {
        icons: {
          branch: 'symbol-string',
          leaf: 'symbol-string',
          open: 'symbol-string',
        },
        label: "West Args",
        value: { project: projectName, build: build.name, cmd: "modifyBuildArgs" },
        description: build.westBuildArgs,
      }, {
        icons: {
          branch: 'symbol-string',
          leaf: 'symbol-string',
          open: 'symbol-string',
        },
        label: "CMake Args",
        value: { project: projectName, build: build.name, cmd: "modifyBuildArgs" },
        description: build.westBuildCMakeArgs,
      }, {
        icons: {
          branch: 'debug-alt',
          leaf: 'debug-alt',
          open: 'debug-alt',
        },
        label: "Launch Config",
        value: { project: projectName, build: build.name, cmd: "changeLaunchTarget" },
        description: build.launchTarget,
      }, {
        icons: {
          branch: 'debug-all',
          leaf: 'debug-all',
          open: 'debug-all',
        },
        label: "Build+Debug Config",
        value: { project: projectName, build: build.name, cmd: "changeBuildDebugTarget" },
        description: build.buildDebugTarget,
      }, {
        icons: {
          branch: 'debug-console',
          leaf: 'debug-console',
          open: 'debug-console',
        },
        label: "Attach Config",
        value: { project: projectName, build: build.name, cmd: "changeAttachTarget" },
        description: build.attachTarget,
      },
    ];
    this.generateConfigFileEntry(buildData.subItems[2], projectName, build.name, build.confFiles, kConfigOpen);
    this.generateOverlayFileEntry(buildData.subItems[3], projectName, build.name, build.confFiles, overlayOpen);

    // Calculated config: merge project-level + build-level conf/overlay files
    const calcConfFiles = [
      ...(projectConfFiles?.config ?? []),
      ...(build.confFiles?.config ?? []),
      ...(projectConfFiles?.extraConfig ?? []),
      ...(build.confFiles?.extraConfig ?? []),
    ];
    const calcOverlayFiles = [
      ...(projectConfFiles?.overlay ?? []),
      ...(build.confFiles?.overlay ?? []),
      ...(projectConfFiles?.extraOverlay ?? []),
      ...(build.confFiles?.extraOverlay ?? []),
    ];

    const calcEntry: any = {
      icons: { branch: 'list-tree', leaf: 'list-tree', open: 'list-tree' },
      label: "Calculated Config",
      open: calcOpen === undefined ? false : calcOpen,
      subItems: [],
    };
    const fileIcon = { branch: 'file', leaf: 'file', open: 'file' };
    for (const f of calcConfFiles) {
      calcEntry.subItems.push({ icons: fileIcon, label: "Conf", description: f });
    }
    for (const f of calcOverlayFiles) {
      calcEntry.subItems.push({ icons: fileIcon, label: "DTC", description: f });
    }
    buildData.subItems.push(calcEntry);

    // Variables section for this build
    const buildVarsEntry: any = {
      icons: { branch: 'symbol-variable', leaf: 'symbol-variable', open: 'symbol-variable' },
      label: "Variables",
      value: { project: projectName, build: build.name, cmd: "modifyBuildVars" },
      open: variablesOpen === undefined ? false : variablesOpen,
      subItems: [],
    };
    const varIcon = { branch: 'symbol-key', leaf: 'symbol-key', open: 'symbol-key' };
    if (build.vars && Object.keys(build.vars).length > 0) {
      for (const [k, v] of Object.entries(build.vars)) {
        buildVarsEntry.subItems.push({ icons: varIcon, label: k, description: v });
      }
    } else {
      buildVarsEntry.subItems.push({ icons: varIcon, label: "No variables set", description: "Click to edit" });
    }
    buildData.subItems.push(buildVarsEntry);

    // Runners section
    const runnersEntry: any = {
      icons: { branch: 'chip', leaf: 'chip', open: 'chip' },
      label: "Runners",
      open: true,
      subItems: [],
    };
    for (const runnerKey in build.runnerConfigs) {
      const runner = build.runnerConfigs[runnerKey];
      runnersEntry.subItems.push({
        icons: { branch: 'chip', leaf: 'chip', open: 'chip' },
        label: runner.name,
        value: { project: projectName, build: build.name, runner: runner.name },
        subItems: [
          { icons: { branch: 'tools', leaf: 'tools', open: 'tools' }, label: 'Runner', description: runner.runner },
          { icons: { branch: 'file-code', leaf: 'file-code', open: 'file-code' }, label: 'Args', description: runner.args },
        ],
        actions: [{ icon: "trash", actionId: "deleteRunner", tooltip: "Delete Runner" }],
      });
    }
    if (runnersEntry.subItems.length === 0) {
      runnersEntry.subItems.push({
        icons: { branch: 'add', leaf: 'add', open: 'add' },
        label: 'Add Runner',
        value: { cmd: "addRunner", project: projectName, build: build.name },
        description: 'Add Runner',
      });
    }
    buildData.subItems.push(runnersEntry);

    return buildData;
  }

  generateProjectString(project: ProjectConfig, wsConfig: WorkspaceConfig, open: boolean | undefined, kConfigOpen: boolean | undefined, overlayOpen: boolean | undefined, variablesOpen: boolean | undefined, buildsOpen: boolean | undefined): any {
    const projectData: any = {};
    projectData['icons'] = {
      branch: 'folder',
      leaf: 'file',
      open: 'folder-opened',
    };
    projectData['label'] = project.name;
    projectData['value'] = { project: project.name };
    projectData['open'] = open === undefined ? true : open;
    projectData['actions'] = [
      { icon: "add", actionId: "addBuild", tooltip: "Add Build" },
      { icon: "beaker", actionId: "addTest", tooltip: "Add Test" },
      { icon: "trash", actionId: "deleteProject", tooltip: "Delete Project" },
    ];
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
        open: kConfigOpen === undefined ? true : kConfigOpen,
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
        open: overlayOpen === undefined ? true : overlayOpen,
        subItems: []
      },
    ];
    this.generateConfigFileEntry(projectData.subItems[2], project.name, undefined, project.confFiles, kConfigOpen);
    this.generateOverlayFileEntry(projectData.subItems[3], project.name, undefined, project.confFiles, overlayOpen);

    // Variables section for this project
    const projectVarsEntry: any = {
      icons: { branch: 'symbol-variable', leaf: 'symbol-variable', open: 'symbol-variable' },
      label: "Variables",
      value: { project: project.name, cmd: "modifyProjectVars" },
      open: variablesOpen === undefined ? false : variablesOpen,
      subItems: [],
    };
    const varIcon = { branch: 'symbol-key', leaf: 'symbol-key', open: 'symbol-key' };
    if (project.vars && Object.keys(project.vars).length > 0) {
      for (const [k, v] of Object.entries(project.vars)) {
        projectVarsEntry.subItems.push({ icons: varIcon, label: k, description: v });
      }
    } else {
      projectVarsEntry.subItems.push({ icons: varIcon, label: "No variables set", description: "Click to edit" });
    }
    projectData.subItems.push(projectVarsEntry);

    // Builds section containing all build configurations
    const buildsEntry: any = {
      icons: { branch: 'project', leaf: 'project', open: 'project' },
      label: "Builds",
      open: buildsOpen === undefined ? true : buildsOpen,
      subItems: [],
    };
    for (const buildKey in project.buildConfigs) {
      const build = project.buildConfigs[buildKey];
      const bState = this.projectConfigState.buildStates[buildKey];
      buildsEntry.subItems.push(this.generateBuildString(project.name, build, project.confFiles, bState));
    }
    if (buildsEntry.subItems.length === 0) {
      buildsEntry.subItems.push({
        icons: { branch: 'add', leaf: 'add', open: 'add' },
        label: 'Add Build',
        value: { cmd: "addBuild", project: project.name },
        description: 'Add Build',
      });
    }
    projectData.subItems.push(buildsEntry);

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
    let activeTest;

    const resolvedProject = resolveActiveProject(wsConfig);
    if (resolvedProject) {
      activeProject = resolvedProject.project;
      activeTest = getResolvedTestConfig(wsConfig, resolvedProject);
    }

    // Restore open/closed states from the rendered treeData before rebuilding
    if (this.treeData[0] !== undefined) {
      this.projectConfigState.projectOpenState = this.treeData[0].open !== undefined ? this.treeData[0].open : this.projectConfigState.projectOpenState;
      if (this.treeData[0].subItems !== undefined) {
        // subItems layout: [0]=main, [1]=cmake, [2]=kconfig, [3]=dtcoverlay, [4]=variables, [5]=builds
        if (this.treeData[0].subItems.length >= 3) {
          this.projectConfigState.projectKConfigOpenState = this.treeData[0].subItems[2].open !== undefined ? this.treeData[0].subItems[2].open : this.projectConfigState.projectKConfigOpenState;
        }
        if (this.treeData[0].subItems.length >= 4) {
          this.projectConfigState.projectOverlayOpenState = this.treeData[0].subItems[3].open !== undefined ? this.treeData[0].subItems[3].open : this.projectConfigState.projectOverlayOpenState;
        }
        if (this.treeData[0].subItems.length >= 5) {
          this.projectConfigState.projectVariablesOpenState = this.treeData[0].subItems[4].open !== undefined ? this.treeData[0].subItems[4].open : this.projectConfigState.projectVariablesOpenState;
        }
        if (this.treeData[0].subItems.length >= 6) {
          const buildsItem = this.treeData[0].subItems[5];
          this.projectConfigState.buildsOpenState = buildsItem.open !== undefined ? buildsItem.open : this.projectConfigState.buildsOpenState;
          // Restore per-build open states
          if (buildsItem.subItems) {
            for (const buildItem of buildsItem.subItems) {
              if (buildItem.label && buildItem.label !== 'Add Build') {
                const bn = buildItem.label as string;
                if (!this.projectConfigState.buildStates[bn]) {
                  this.projectConfigState.buildStates[bn] = {};
                }
                if (buildItem.open !== undefined) {
                  this.projectConfigState.buildStates[bn].open = buildItem.open;
                }
                if (buildItem.subItems) {
                  // subItems: [0]=board, [1]=boardDir, [2]=kconfig, [3]=dtcoverlay, [4]=westArgs, [5]=cmakeArgs, [6]=launchConfig, [7]=buildDebugConfig, [8]=attachConfig, [9]=calcConfig, [10]=vars, [11]=runners
                  if (buildItem.subItems.length >= 3) {
                    const ki = buildItem.subItems[2];
                    if (ki?.open !== undefined) { this.projectConfigState.buildStates[bn].kConfigOpen = ki.open; }
                  }
                  if (buildItem.subItems.length >= 4) {
                    const oi = buildItem.subItems[3];
                    if (oi?.open !== undefined) { this.projectConfigState.buildStates[bn].overlayOpen = oi.open; }
                  }
                  if (buildItem.subItems.length >= 10) {
                    const ci = buildItem.subItems[9];
                    if (ci?.open !== undefined) { this.projectConfigState.buildStates[bn].calcOpen = ci.open; }
                  }
                  if (buildItem.subItems.length >= 11) {
                    const vi = buildItem.subItems[10];
                    if (vi?.open !== undefined) { this.projectConfigState.buildStates[bn].variablesOpen = vi.open; }
                  }
                }
              }
            }
          }
        }
      }
    }

    if (this.treeData[1] !== undefined) {
      this.projectConfigState.twisterOpenState = this.treeData[1].open !== undefined ? this.treeData[1].open : this.projectConfigState.twisterOpenState;
    }

    if (activeProject) {
      this.treeData[0] = this.generateProjectString(
        activeProject, wsConfig,
        this.projectConfigState.projectOpenState,
        this.projectConfigState.projectKConfigOpenState,
        this.projectConfigState.projectOverlayOpenState,
        this.projectConfigState.projectVariablesOpenState,
        this.projectConfigState.buildsOpenState,
      );

      if (activeTest) {
        this.treeData[1] = this.generateTwisterString(activeProject.name, activeTest, this.projectConfigState.twisterOpenState);
      } else {
        this.treeData[1] = {};
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
      case "buildDebug": {
        void setActive(this.context, this.wsConfig, message.value.project, message.value.build);
        void vscode.commands.executeCommand("zephyr-ide.build-debug");
        break;
      }
      case "debug": {
        void setActive(this.context, this.wsConfig, message.value.project, message.value.build);
        void vscode.commands.executeCommand("zephyr-ide.debug");
        break;
      }
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
            boardPath = path.join(this.wsConfig.rootPath, build.relBoardDir, build.relBoardSubDir);
          } else {
            const setupState = await getSetupState(this.context, this.wsConfig);
            if (setupState) {
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
      case "openBoardDir": {
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
            boardPath = path.join(this.wsConfig.rootPath, build.relBoardDir, build.relBoardSubDir);
          } else {
            const setupState = await getSetupState(this.context, this.wsConfig);
            if (setupState) {
              boardPath = path.join(setupState.zephyrDir, 'boards', build.relBoardSubDir);
            }
          }
        }

        if (boardPath) {
          const dirUri = vscode.Uri.file(boardPath);
          try {
            await vscode.commands.executeCommand('revealInExplorer', dirUri);
          } catch {
            outputInfo("Project Config", `Board directory not found: ${boardPath}`);
          }
          void setActive(this.context, this.wsConfig, message.value.project, message.value.build);
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
      case "modifyProjectVars": {
        void modifyProjectVariables(this.context, this.wsConfig, message.value.project).finally(() => { void vscode.commands.executeCommand("zephyr-ide.update-web-view"); });
        void setActive(this.context, this.wsConfig, message.value.project);
        break;
      }
      case "modifyBuildVars": {
        void modifyBuildVariables(this.context, this.wsConfig, message.value.project, message.value.build).finally(() => { void vscode.commands.executeCommand("zephyr-ide.update-web-view"); });
        void setActive(this.context, this.wsConfig, message.value.project, message.value.build);
        break;
      }
      case "changeLaunchTarget": {
        void setActive(this.context, this.wsConfig, message.value.project, message.value.build);
        void vscode.commands.executeCommand("zephyr-ide.change-debug-launch-for-build");
        break;
      }
      case "changeBuildDebugTarget": {
        void setActive(this.context, this.wsConfig, message.value.project, message.value.build);
        void vscode.commands.executeCommand("zephyr-ide.change-build-debug-launch-for-build");
        break;
      }
      case "changeAttachTarget": {
        void setActive(this.context, this.wsConfig, message.value.project, message.value.build);
        void vscode.commands.executeCommand("zephyr-ide.change-debug-attach-launch-for-build");
        break;
      }
      case "modifyTestArgs": {
        void vscode.commands.executeCommand("zephyr-ide.reconfigure-active-test");
        void setActive(this.context, this.wsConfig, message.value.project, message.value.build, message.value.runner);
        break;
      }
      case "addTest": {
        void setActive(this.context, this.wsConfig, message.value.project)
          .then(() => vscode.commands.executeCommand("zephyr-ide.add-test"));
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

