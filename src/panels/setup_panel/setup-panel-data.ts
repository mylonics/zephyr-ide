/*
Copyright 2026 mylonics 
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

/**
 * Data types for the Setup Panel webview.
 */

export interface SetupPanelData {
  folderOpen: boolean;
  workspaceInitialized: boolean;
  hasValidSetupState: boolean;
  toolsReady: boolean;
  sdkReady: boolean;
  westUpdated: boolean;
  initialSetupComplete: boolean;
  hasWorkspaces: boolean;
  activeWorkspace: ActiveWorkspaceData | undefined;
  workspaces: WorkspaceListItem[];
  projects: ProjectListItem[];
  activeProject: string | undefined;
}

export interface ActiveWorkspaceData {
  name: string;
  path: string;
  version: string;
  hasPythonEnv: boolean;
  hasWestUpdated: boolean;
  hasSdk: boolean;
  isInitialized: boolean;
}

export interface WorkspaceListItem {
  path: string;
  name: string;
  description: string;
  isActive: boolean;
  hasPythonEnv: boolean;
  hasWestUpdated: boolean;
}

export interface ProjectListItem {
  name: string;
  isActive: boolean;
  buildCount: number;
}
