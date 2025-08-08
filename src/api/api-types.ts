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

// API types and interfaces for Zephyr IDE REST API

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface ExtensionStatus {
  version: string;
  initialized: boolean;
  westUpdated: boolean;
  activeProject?: string;
  activeBuild?: string;
  rootPath?: string;
  zephyrDir?: string;
}

export interface ProjectInfo {
  name: string;
  rel_path: string;
  buildConfigs: { [key: string]: BuildConfig };
}

export interface BuildConfig {
  board: string;
  runner?: string;
  conf_files?: string[];
  overlay_files?: string[];
  args?: string[];
}

export interface CreateProjectRequest {
  name: string;
  template?: string;
  location?: string;
}

export interface AddBuildRequest {
  projectName: string;
  buildName: string;
  board: string;
  runner?: string;
  conf_files?: string[];
  overlay_files?: string[];
  args?: string[];
}

export interface BuildRequest {
  projectName?: string;
  buildName?: string;
  pristine?: boolean;
}

export interface FlashRequest {
  projectName?: string;
  buildName?: string;
}

export interface ApiServerConfig {
  enabled: boolean;
  port: number;
  apiKey?: string;
  allowedOrigins?: string[];
}