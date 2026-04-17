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
 * Workspace readiness taxonomy surfaced to the UI.
 * - 'not-initialized': no SetupState marked initialized for the panel target.
 * - 'needs-setup'    : initialized, but python env or west update not yet complete.
 * - 'ready'          : initialized AND python env AND west update complete.
 */
export type WorkspaceReadiness = 'not-initialized' | 'needs-setup' | 'ready';

/**
 * Top-level render mode for the Workspace panel.
 * - 'workspace-view' : showing info for a specific (active or registry) workspace.
 * - 'choice'         : no workspace is active and no specific path was requested —
 *                      show the two-button choice screen.
 * - 'new-current'    : user chose to create/adopt a new workspace in the open folder.
 * - 'new-external'   : user chose an external directory; show tiles that operate on it.
 */
export type WorkspacePanelMode = 'workspace-view' | 'choice' | 'new-current' | 'new-external';

export interface WorkspacePanelData {
  folderOpen: boolean;
  workspaceInitialized: boolean;
  /** Which top-level screen the webview should render. */
  panelMode: WorkspacePanelMode;
  /** When in 'new-external', the directory the user picked. */
  externalDirectoryPath?: string;
  /**
   * The directory the current panel mode is targeting. Shown in the header
   * so the user always knows which folder is being operated on.
   */
  targetDirectory?: string;
  /**
   * True when a `.west/` folder exists in the open folder but no workspace is
   * active/registered for it — offering a fast "activate preexisting" path.
   */
  preexistingWorkspaceDetected: boolean;
  /** Composite readiness used by the header badge. */
  readiness: WorkspaceReadiness;
  state: 'ready' | 'setup-required';
  statusIcon: string;
  statusLabel: string;
  statusClass: string;
  /** Not-undefined when viewing a non-active workspace */
  activationBanner?: ActivationBannerData;
  /** Set when workspace is initialized */
  workspaceInfo?: WorkspaceInfoData;
  /** Whether action buttons should be disabled (non-active workspace) */
  isNonActive: boolean;
  /**
   * True when the open VS Code folder is the target of this panel
   * (i.e., git clone / "current directory" setup options would operate on it).
   */
  targetIsCurrentFolder: boolean;
  /**
   * True when a folder is open AND that folder has not yet been set up as a
   * zephyr workspace. Gates the "current-folder" setup section so we don't
   * offer to re-initialize an already-initialized directory.
   */
  currentFolderCanBeInitialized: boolean;
  /**
   * Path to an already-initialized workspace in the open folder, if any.
   * Surfaced so the UI can offer "Activate" instead of "Set up".
   */
  currentFolderInitializedPath?: string;
  /** Readiness flags for the "West Update" row. Independent of `readiness`. */
  pythonEnvReady: boolean;
  westUpdated: boolean;
}

export interface ActivationBannerData {
  name: string;
  path: string;
}

export interface WorkspaceInfoData {
  currentFolderPath: string;
  westWorkspacePath: string;
  westYmlPath: string;
  venvPath: string;
  zephyrVersion: string;
}

export interface SetupProgressStep {
  id: string;
  label: string;
  status: 'pending' | 'in-progress' | 'completed' | 'failed' | 'skipped';
  detail?: string;
}

export interface SetupProgressData {
  type: 'start' | 'step-update' | 'complete' | 'failed';
  operationLabel: string;
  steps: SetupProgressStep[];
  message?: string;
}

/**
 * Commands that the Lit webview can post to the extension host. The string
 * union narrows message payloads and makes adding a new action impossible to
 * forget on the host side.
 */
export type WorkspacePanelCommand =
  | 'ready'
  | 'openFolder'
  | 'openSetupPanel'
  | 'openProjectPanel'
  | 'openWestYml'
  | 'saveAndUpdateWestYml'
  | 'activateWorkspace'
  | 'resetWorkspace'
  | 'deactivateWorkspace'
  | 'rerunWestSetup'
  | 'unregisterWorkspace'
  | 'setupWestEnvironment'
  | 'westInit'
  | 'westUpdate'
  | 'westConfig'
  | 'workspaceSetupFromGit'
  | 'workspaceSetupFromWestGit'
  | 'workspaceSetupStandard'
  | 'workspaceSetupFromCurrentDirectory'
  | 'workspaceSetupFromExternalDirectory'
  // Choice-screen routing
  | 'chooseNewInCurrent'
  | 'chooseNewInExternal'
  | 'backToChoice'
  | 'activatePreexisting'
  // New-in-external tile variants (operate on the externally picked directory)
  | 'workspaceSetupFromWestGitExternal'
  | 'workspaceSetupStandardExternal'
  | 'workspaceSetupFromDirectoryExternal'
  // Register the directory as already-set-up without running setup
  | 'markWorkspaceComplete'
  | 'markWorkspaceCompleteExternal';
