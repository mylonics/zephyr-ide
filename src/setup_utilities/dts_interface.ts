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
import * as fs from "fs";
import { IntegrationSettings, Context } from "devicetree-language-server-types";
import { IDeviceTreeAPI } from "devicetree-language-server-vscode-types";

import { SetupState, WorkspaceConfig } from "./types";
import * as path from "upath";
import { getDtsIncludes } from "./modules";
import {
  resolveActiveProjectBuild, ProjectConfig
} from "../project_utilities/project";
import { outputInfo } from "../utilities/output";

import { getBuildInfo } from "../zephyr_utilities/build";
import { BuildConfig } from "../project_utilities/build_selector";

let api: IDeviceTreeAPI | undefined = undefined;

async function activateDtsExtension() {
  if (api === undefined) {
    const ext = vscode.extensions.getExtension<IDeviceTreeAPI>(
      "KyleMicallefBonnici.dts-lsp"
    );
    if (ext) {
      api = ext.isActive ? ext.exports : await ext.activate();
    }
  }
}

export async function initializeDtsExt(state: SetupState, wsConfig: WorkspaceConfig) {
  await activateDtsExtension();
  if (api) {
    const dtsIncludeArray = await getDtsIncludes(state);

    const dtsDir = path.join(state.zephyrDir, "dts");
    const dtsIncludePaths: string[] = [dtsDir];

    // Discover architecture subdirectories dynamically instead of hardcoding
    try {
      const entries = fs.readdirSync(dtsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && entry.name !== "bindings") {
          dtsIncludePaths.push(path.join(dtsDir, entry.name));
        }
      }
    } catch {
      // Fall back to just the dts root if we can't read the directory
    }
    dtsIncludePaths.push(path.join(state.zephyrDir, "include"));

    const settings: IntegrationSettings = {
      cwd: state.setupPath,
      defaultBindingType: "Zephyr",
      defaultZephyrBindings: [path.join(dtsDir, "bindings")],
      defaultIncludePaths: dtsIncludePaths,
      autoChangeContext: true,
      allowAdhocContexts: true,
    };
    settings.defaultIncludePaths?.push(...dtsIncludeArray);
    await api.setDefaultSettings(settings);
    await updateAllDtsContexts(wsConfig);
  }
}


export async function setDtsContext(wsConfig: WorkspaceConfig, project?: ProjectConfig, build?: BuildConfig) {
  if (api) {
    if (!project || !build) {
      const resolved = resolveActiveProjectBuild(wsConfig, project ? { projectName: project.name } : undefined);
      if (!resolved) { return; }
      project = project ?? resolved.project;
      build = build ?? resolved.build;
    }
    api.setActiveContextByName(project.name + "-" + build.name);
  }
}

export async function updateAllDtsContexts(wsConfig: WorkspaceConfig) {
  if (api) {
    for (const projectName in wsConfig.projects) {
      const project = wsConfig.projects[projectName];
      for (const buildName in project.buildConfigs) {
        const build = project.buildConfigs[buildName];
        await updateDtsContext(wsConfig, project, build);
      }
    }
  }
}

export async function updateDtsContext(wsConfig: WorkspaceConfig,
  project: ProjectConfig,
  build: BuildConfig) {
  if (api) {
    const buildInfo = await getBuildInfo(wsConfig, project, build);

    if (buildInfo) {
      const context: Context = {
        ctxName: project.name + "-" + build.name,
        includePaths: buildInfo.includeDirs,
        dtsFile: buildInfo.dtsFile,
        overlays: buildInfo.otherDtsFiles,
        bindingType: "Zephyr",
        zephyrBindings: buildInfo.bindingsDirs,
      };
      await api.requestContext(context);
    }
  }
}

export async function printContexts() {

  if (api) {
    const contexts = await api.getContexts();
    outputInfo("DTS Interface", JSON.stringify(contexts));
  }
}

