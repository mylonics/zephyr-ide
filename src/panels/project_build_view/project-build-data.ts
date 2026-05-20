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
 * Data types for the Project Build Panel webview.
 *
 * These types define the JSON payload sent from the extension host to the
 * webview via postMessage. They are intentionally simple serialisable objects
 * (no class instances, no VS Code API types) so they can cross the webview
 * boundary safely.
 */

// ---------------------------------------------------------------------------
// Config file types (mirrors ConfigFileEntry / ConfigFiles from config_selector)
// ---------------------------------------------------------------------------

export interface WebviewConfigFileEntry {
  path: string;
  extra?: boolean;
}

export interface WebviewConfigFiles {
  config: WebviewConfigFileEntry[];
  overlay: WebviewConfigFileEntry[];
}

// ---------------------------------------------------------------------------
// Project data
// ---------------------------------------------------------------------------

export interface WebviewProjectInfo {
  name: string;
  relPath: string;
  absPath: string;
  mainSourceFile: string | undefined;
  cmakeFile: string | undefined;
  confFiles: WebviewConfigFiles;
  buildNames: string[];
  testNames: string[];
}

// ---------------------------------------------------------------------------
// Build data
// ---------------------------------------------------------------------------

/** Resolved view of one Runner Profile slot for the build card. */
export interface WebviewSlotBind {
  /** Slot identifier — "flash" | "debug" | "attach". */
  slot: "flash" | "debug" | "attach";
  /** Display label: "Auto (runners.yaml)" | "openocd --speed 4000" | "launch.json: <name>". */
  label: string;
  /** Bind discriminator from the profile, or "none" when no active profile. */
  kind: "none" | "auto" | "runner" | "launch";
  /** Underlying runner name (only when `kind === "runner"`). */
  runner?: string;
  /** Effective extra args (profile + override) shown in the inline editor. */
  extraArgs: string;
  /** Per-build override extra args (separate from profile-defined extraArgs). */
  overrideExtraArgs: string;
  /** True when a `bindOverrides[slot]` is set for this build. */
  hasOverride: boolean;
}

export interface WebviewBuildDetails {
  name: string;
  board: string;
  revision: string | undefined;
  boardDisplayName: string;
  relBoardDir: string;
  relBoardSubDir: string;
  resolvedBoardPath: string | undefined;
  debugOptimization: string;
  westBuildArgs: string[];
  westBuildCMakeArgs: string[];
  confFiles: WebviewConfigFiles;
  /** Active Runner Profile name (or undefined when none selected). */
  activeProfile: string | undefined;
  /** Resolved bind labels for the three slots of the active profile (or "none"). */
  slotBinds: { flash: WebviewSlotBind; debug: WebviewSlotBind; attach: WebviewSlotBind };
  /** Read-only hint from runners.yaml. */
  runnersYamlHint: {
    flashRunner?: string;
    debugRunner?: string;
    availableRunners: string[];
    runnersYamlPath: string;
    sysbuildImage?: string;
  } | undefined;
}

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

export interface WebviewTestDetails {
  name: string;
  platform: string;
  tests: string[];
  args: string;
  serialPort: string | undefined;
  serialBaud: string | undefined;
  board: string | undefined;
}

// ---------------------------------------------------------------------------
// Variable command reference (for help section)
// ---------------------------------------------------------------------------

export interface WebviewVariableCommandInfo {
  command: string;
  description: string;
  example: string;
}

// ---------------------------------------------------------------------------
// Project option for the selector
// ---------------------------------------------------------------------------

export interface WebviewProjectOption {
  name: string;
  selected: boolean;
}

// ---------------------------------------------------------------------------
// Build/test selector option
// ---------------------------------------------------------------------------

export interface WebviewBuildTestOption {
  value: string;       // "build:<name>" or "test:<name>"
  label: string;       // "Build: <name>" or "Test: <name>"
  selected: boolean;
}

// ---------------------------------------------------------------------------
// Full content payload sent from extension to webview
// ---------------------------------------------------------------------------

export interface ProjectBuildPanelData {
  /** Available projects for the dropdown */
  projectOptions: WebviewProjectOption[];

  /** Build/test selector options */
  buildTestOptions: WebviewBuildTestOption[];

  /** Project info (undefined = no project selected) */
  projectInfo: WebviewProjectInfo | undefined;
  projectVars: Record<string, string>;

  /** Currently selected build details (undefined = no build selected) */
  buildDetails: WebviewBuildDetails | undefined;
  buildVars: Record<string, string>;
  isBuildActive: boolean;

  /** Currently selected test details (undefined = no test selected) */
  testDetails: WebviewTestDetails | undefined;

  /** Variable command reference (static data for help) */
  variableCommands: WebviewVariableCommandInfo[];

  /** The selected project name */
  selectedProject: string | undefined;
}
