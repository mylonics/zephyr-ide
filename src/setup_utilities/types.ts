/*
Copyright 2025-2026 mylonics 
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

/** Format a ZephyrVersionNumber as "major.minor.patch" */
export function formatZephyrVersion(v: ZephyrVersionNumber): string {
  return `${v.major}.${v.minor}.${v.patch}`;
}

export type ProjectConfigDictionary = { [name: string]: ProjectConfig };
export type ProjectStateDictionary = { [name: string]: ProjectState };

export interface SetupState {
  /**
   * Workspace-level structural marker: has the user completed the initial setup
   * selection (choose source, point at .west/west.yml, etc.) for this workspace?
   *
   * True when a `.west/` directory has been produced by setup, an existing
   * `.west/` has been adopted, or the user has explicitly marked the workspace
   * as set up. Remains true through transient failures (west-update error,
   * requirements install failure, folder reopened). Cleared only by an explicit
   * Reset Workspace action or by unregistering the workspace.
   *
   * This is distinct from readiness (see `pythonEnvironmentSetup`, `westUpdated`):
   * an initialized workspace may still be un-ready if west update hasn't run.
   */
  initialized?: boolean,
  /** Readiness flag: venv created, pip available. */
  pythonEnvironmentSetup: boolean,
  /** Readiness flag: `west update` and requirements install succeeded. */
  westUpdated: boolean,
  packagesInstalled?: boolean,
  zephyrDir: string,
  zephyrVersion?: ZephyrVersionNumber,
  env: { [name: string]: string | undefined },
  setupPath: string,
}

export type SetupStateDictionary = { [name: string]: SetupState };

export interface GlobalConfig {
  toolsAvailable?: boolean,
  sdkInstalled?: boolean,
  sdkVersion?: string,
  setupStateDictionary?: SetupStateDictionary,
  /**
   * Names of host packages that were installed but were not yet visible on
   * PATH at install time. Persisted so the "Pending Restart" badge survives a
   * VS Code window reload. Cleared automatically when the extension detects
   * a full process restart (see `pendingRestartSessionToken`) or when the
   * package is later observed as available.
   */
  pendingRestartPackages?: string[],
  /**
   * Opaque token written to globalState alongside `pendingRestartPackages`.
   * Compared against a freshly generated process-level token on activation;
   * a mismatch indicates VS Code (or the extension host) was fully restarted,
   * and the pending list is cleared.
   */
  pendingRestartSessionToken?: string,
}

export interface WorkspaceConfig {
  rootPath: string;
  projects: ProjectConfigDictionary,
  activeProject?: string,
  /**
   * @deprecated Use `isActiveWorkspaceInitialized(wsConfig)` instead. Kept on the
   * type only so legacy persisted state can be migrated into
   * `activeSetupState.initialized` by `loadWorkspaceState`.
   */
  initialSetupComplete?: boolean,
  /** @deprecated Migrated to VS Code setting zephyr-ide.automaticProjectSelection */
  automaticProjectSelection?: boolean,
  activeSetupState?: SetupState,
  projectStates: ProjectStateDictionary,
}

export function generateSetupState(setupPath: string): SetupState {
  return {
    initialized: false,
    pythonEnvironmentSetup: false,
    westUpdated: false,
    packagesInstalled: false,
    zephyrDir: '',
    env: {},
    setupPath: setupPath
  };
}

/**
 * True iff the folder is bound to a workspace AND that workspace has completed
 * initial setup (the `initialized` marker is set). Use to decide whether to
 * show the Initial Setup page vs the regular workspace management UI.
 *
 * Does NOT imply readiness — the workspace may be initialized but still need
 * `west update`. See `isActiveWorkspaceReady` for the full readiness check.
 */
export function isActiveWorkspaceInitialized(wsConfig: WorkspaceConfig): boolean {
  return !!wsConfig.activeSetupState?.initialized;
}

/**
 * True iff the active workspace is initialized AND all readiness flags are set
 * (python env ready and west updated). This is the "can build" state.
 */
export function isActiveWorkspaceReady(wsConfig: WorkspaceConfig): boolean {
  const s = wsConfig.activeSetupState;
  return !!(s && s.initialized && s.pythonEnvironmentSetup && s.westUpdated);
}

/** Registry-level helper: is this workspace initialized? (no folder binding needed) */
export function isWorkspaceInitialized(setupState: SetupState | undefined): boolean {
  return !!setupState?.initialized;
}
