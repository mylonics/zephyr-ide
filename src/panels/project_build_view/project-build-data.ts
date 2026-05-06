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

export interface WebviewRunnerInfo {
  name: string;
  runner: string;
  args: string;
  argsMode: "append" | "override";
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
  runners: WebviewRunnerInfo[];
  /** Project-level runners (inherited by same-named build runners). */
  projectRunners: WebviewRunnerInfo[];
  /** Currently active runner name at build level. */
  activeRunner: string | undefined;
  /** Read-only hint from runners.yaml. */
  runnersYamlHint: { flashRunner?: string; debugRunner?: string; availableRunners: string[] } | undefined;
  launchTarget: string;
  launchTargetFolder: string | undefined;
  buildDebugTarget: string;
  buildDebugTargetFolder: string | undefined;
  attachTarget: string;
  attachTargetFolder: string | undefined;
  // Pre-resolved display names (computed server-side)
  debugDisplay: string;
  buildDebugDisplay: string;
  attachDisplay: string;
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
