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
  getActiveProject, getActiveBuildConfigOfProject
} from "../project_utilities/project"

const ext = vscode.extensions.getExtension<IDeviceTreeAPI>(
  "KyleMicallefBonnici.dts-lsp"
);

let api: IDeviceTreeAPI | undefined = undefined;

async function activateDtsExtension() {
  if (ext && (api == undefined)) {
    api = ext.isActive ? ext.exports : await ext.activate();
  }
}

export async function initializeDtsExt(state: SetupState) {
  await activateDtsExtension();
  if (api) {

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
      autoChangeContext: false, //Maybe this should be disabled?
      allowAdhocContexts: true,
    }
    settings.defaultIncludePaths?.push(...dtsIncludeArray);;


    api.setDefaultSettings(settings);
  }
}


export function setDtsContext(wsConfig: WorkspaceConfig) {
  if (api) {
    let project = getActiveProject(wsConfig);

    if (project) {
      let build = getActiveBuildConfigOfProject(wsConfig, project.name)
      if (build) {
        api.setActiveContext(project.name + "-" + build.name);
      }
    }
  }
}

export function updateDtsContexts(wsConfig: WorkspaceConfig) {
  if (api) {
    for (let projectName in wsConfig.projects) {
      let project = wsConfig.projects[projectName];
      for (let buildName in project.buildConfigs) {
        let build = project.buildConfigs[buildName]
        let context: Context = {
          dtsFile: path.join(wsConfig.rootPath, build.relBoardDir, build.relBoardSubDir, build.board + ".dts"),
          includePaths: [path.join(wsConfig.rootPath, project.rel_path), path.join(wsConfig.rootPath, build.relBoardDir, build.relBoardSubDir)],
          ctxName: project.name + "-" + build.name,
          overlays: project.confFiles.overlay.concat(project.confFiles.extraOverlay).concat(build.confFiles.overlay.concat(build.confFiles.extraOverlay))
        }
        api.requestContext(context);
        if (typeof (context.ctxName) == "string") {
          api.setActiveContext(context.ctxName)
        }
      }
    }
  }
}


