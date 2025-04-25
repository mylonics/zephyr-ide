/*
Copyright 2025 mylonics 
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
import { IntegrationSettings, Context } from "devicetree-language-server-types";
import { IDeviceTreeAPI } from "devicetree-language-server-vscode-types";

import { SetupState } from "./setup";
import path from "path";
import { getDtsIncludes } from "./modules";
import { WorkspaceConfig } from "./setup";
import {
  getActiveProject, getActiveBuildConfigOfProject, ProjectConfig
} from "../project_utilities/project"

import { getBuildInfo } from "../zephyr_utilities/build";
import { BuildConfig } from "../project_utilities/build_selector";

const ext = vscode.extensions.getExtension<IDeviceTreeAPI>(
  "KyleMicallefBonnici.dts-lsp"
);

let api: IDeviceTreeAPI | undefined = undefined;

async function activateDtsExtension() {
  if (ext && (api == undefined)) {
    api = ext.isActive ? ext.exports : await ext.activate();
  }
}

export async function initializeDtsExt(state: SetupState, wsConfig: WorkspaceConfig) {
  await activateDtsExtension();
  if (api && state.westUpdated) {
    const dtsIncludeArray = await getDtsIncludes(state);

    let settings: IntegrationSettings = {
      cwd: state.setupPath,
      defaultBindingType: "Zephyr",
      defaultZephyrBindings: [path.join(state.zephyrDir, "dts/bindings")],
      defaultIncludePaths: [
        path.join(state.zephyrDir, "dts"),
        path.join(state.zephyrDir, "dts/arc"),
        path.join(state.zephyrDir, "dts/arm"),
        path.join(state.zephyrDir, "dts/arm64/"),
        path.join(state.zephyrDir, "dts/riscv"),
        path.join(state.zephyrDir, "dts/common"),
        path.join(state.zephyrDir, "dts/nios2"),
        path.join(state.zephyrDir, "dts/posix"),
        path.join(state.zephyrDir, "dts/riscv"),
        path.join(state.zephyrDir, "dts/sparc"),
        path.join(state.zephyrDir, "dts/x86"),
        path.join(state.zephyrDir, "dts/xtensa"),
        path.join(state.zephyrDir, "include"),
      ],
      autoChangeContext: true,
      allowAdhocContexts: true,
    }
    settings.defaultIncludePaths?.push(...dtsIncludeArray);
    await api.setDefaultSettings(settings);
    await updateAllDtsContexts(wsConfig);
  }
}


export async function setDtsContext(wsConfig: WorkspaceConfig, project?: ProjectConfig, build?: BuildConfig) {
  if (api && wsConfig.activeSetupState) {
    if (project === undefined) {
      project = getActiveProject(wsConfig);
    }

    if (project) {
      if (build === undefined) {
        build = getActiveBuildConfigOfProject(wsConfig, project.name)
      }
      if (build) {
        api.setActiveContextByName(project.name + "-" + build.name);
        return;
      }
    }
  }
}

export async function updateAllDtsContexts(wsConfig: WorkspaceConfig) {
  if (api && wsConfig.activeSetupState) {
    for (let projectName in wsConfig.projects) {
      let project = wsConfig.projects[projectName];
      for (let buildName in project.buildConfigs) {
        let build = project.buildConfigs[buildName]
        updateDtsContext(wsConfig, project, build);
      }
    }
  }
}

export async function updateDtsContext(wsConfig: WorkspaceConfig,
  project: ProjectConfig,
  build: BuildConfig) {
  if (api && wsConfig.activeSetupState) {
    let buildInfo = await getBuildInfo(wsConfig, project, build);

    if (buildInfo) {
      let context: Context = {
        ctxName: project.name + "-" + build.name,
        includePaths: buildInfo.includeDirs,
        dtsFile: buildInfo.dtsFile,
        overlays: buildInfo.otherDtsFiles,
        bindingType: "Zephyr",
        zephyrBindings: buildInfo.bindingsDirs,
      }
      console.log(context)
      await api.requestContext(context);
    }
  }
}

export async function printContexts() {

  if (api) {
    let contexts = await api.getContexts()
    console.log(contexts);
  }
}




