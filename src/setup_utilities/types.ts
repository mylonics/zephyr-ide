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

import { ProjectConfig, ProjectState } from "../project_utilities/project";
import { ZephyrVersionNumber } from "./modules";

export type ProjectConfigDictionary = { [name: string]: ProjectConfig };
export type ProjectStateDictionary = { [name: string]: ProjectState };

export interface SetupState {
  pythonEnvironmentSetup: boolean,
  westUpdated: boolean,
  packagesInstalled?: boolean,
  zephyrDir: string,
  zephyrVersion?: ZephyrVersionNumber,
  env: { [name: string]: string | undefined },
  setupPath: string,
}

export type SetupStateDictionary = { [name: string]: SetupState };

export interface ToolChainEntry {
  version: string,
  basePath: string,
  targetsInstalled: string[];
}

export type ToolChainDictionary = { [name: string]: ToolChainEntry };

export interface GlobalConfig {
  toolsAvailable?: boolean,
  sdkInstalled?: boolean,
  setupStateDictionary?: SetupStateDictionary
}

export interface WorkspaceConfig {
  rootPath: string;
  projects: ProjectConfigDictionary,
  activeProject?: string,
  initialSetupComplete: boolean,
  automaticProjectSelction: boolean,
  activeSetupState?: SetupState,
  projectStates: ProjectStateDictionary,
}

export function generateSetupState(setupPath: string): SetupState {
  return {
    pythonEnvironmentSetup: false,
    westUpdated: false,
    packagesInstalled: false,
    zephyrDir: '',
    env: {},
    setupPath: setupPath
  };
}
