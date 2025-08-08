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

import * as http from 'http';
import * as url from 'url';
import * as vscode from 'vscode';

import {
  ApiResponse,
  ApiServerConfig,
  ExtensionStatus,
  ProjectInfo,
  CreateProjectRequest,
  AddBuildRequest,
  BuildRequest,
  FlashRequest
} from './api-types';

import { WorkspaceConfig } from '../setup_utilities/types';
import { buildHelper } from '../zephyr_utilities/build';
import { flashActive } from '../zephyr_utilities/flash';
import * as project from '../project_utilities/project';

export class ZephyrIdeApiServer {
  private server: http.Server | null = null;
  private config: ApiServerConfig;
  private wsConfig: WorkspaceConfig;
  private context: vscode.ExtensionContext;

  constructor(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, config: ApiServerConfig) {
    this.context = context;
    this.wsConfig = wsConfig;
    this.config = config;
  }

  public start(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.server) {
        reject(new Error('Server is already running'));
        return;
      }

      if (!this.config.enabled) {
        reject(new Error('API server is disabled'));
        return;
      }

      this.server = http.createServer(this.handleRequest.bind(this));

      this.server.listen(this.config.port, () => {
        console.log(`Zephyr IDE API server listening on port ${this.config.port}`);
        resolve();
      });

      this.server.on('error', (error) => {
        reject(error);
      });
    });
  }

  public stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.server = null;
          console.log('Zephyr IDE API server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  public updateConfig(wsConfig: WorkspaceConfig): void {
    this.wsConfig = wsConfig;
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      // Enable CORS
      this.setCorsHeaders(res);

      // Handle preflight requests
      if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
      }

      // Check API key if configured
      if (this.config.apiKey && !this.verifyApiKey(req)) {
        this.sendError(res, 401, 'Unauthorized');
        return;
      }

      const parsedUrl = url.parse(req.url || '', true);
      const pathname = parsedUrl.pathname || '';
      const method = req.method || 'GET';

      console.log(`API Request: ${method} ${pathname}`);

      // Route requests
      if (pathname === '/api/status' && method === 'GET') {
        await this.handleStatus(req, res);
      } else if (pathname === '/api/projects' && method === 'GET') {
        await this.handleGetProjects(req, res);
      } else if (pathname === '/api/projects' && method === 'POST') {
        await this.handleCreateProject(req, res);
      } else if (pathname.startsWith('/api/projects/') && pathname.endsWith('/builds') && method === 'GET') {
        await this.handleGetBuilds(req, res, pathname);
      } else if (pathname.startsWith('/api/projects/') && pathname.endsWith('/builds') && method === 'POST') {
        await this.handleAddBuild(req, res, pathname);
      } else if (pathname === '/api/build' && method === 'POST') {
        await this.handleBuild(req, res);
      } else if (pathname === '/api/flash' && method === 'POST') {
        await this.handleFlash(req, res);
      } else if (pathname === '/api/workspace/config' && method === 'GET') {
        await this.handleGetWorkspaceConfig(req, res);
      } else {
        this.sendError(res, 404, 'Not Found');
      }
    } catch (error) {
      console.error('API Error:', error);
      this.sendError(res, 500, error instanceof Error ? error.message : 'Internal Server Error');
    }
  }

  private setCorsHeaders(res: http.ServerResponse): void {
    const allowedOrigins = this.config.allowedOrigins || ['*'];
    res.setHeader('Access-Control-Allow-Origin', allowedOrigins.join(','));
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');
  }

  private verifyApiKey(req: http.IncomingMessage): boolean {
    const apiKey = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');
    return apiKey === this.config.apiKey;
  }

  private async handleStatus(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const status: ExtensionStatus = {
      version: vscode.extensions.getExtension('mylonics.zephyr-ide')?.packageJSON.version || 'unknown',
      initialized: this.wsConfig.initialSetupComplete || false,
      westUpdated: this.wsConfig.activeSetupState?.westUpdated || false,
      activeProject: this.wsConfig.activeProject,
      activeBuild: this.wsConfig.activeProject ? 
        this.wsConfig.projectStates[this.wsConfig.activeProject]?.activeBuildConfig : undefined,
      rootPath: this.wsConfig.rootPath,
      zephyrDir: this.wsConfig.activeSetupState?.zephyrDir
    };

    this.sendSuccess(res, status);
  }

  private async handleGetProjects(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const projects: { [key: string]: ProjectInfo } = {};
    
    for (const [name, projectData] of Object.entries(this.wsConfig.projects)) {
      projects[name] = {
        name,
        rel_path: projectData.rel_path,
        buildConfigs: projectData.buildConfigs
      };
    }

    this.sendSuccess(res, projects);
  }

  private async handleCreateProject(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const body = await this.getRequestBody(req);
    const request: CreateProjectRequest = JSON.parse(body);

    try {
      // Execute the create project command
      await vscode.commands.executeCommand('zephyr-ide.create-project');
      this.sendSuccess(res, { message: 'Project creation initiated' });
    } catch (error) {
      this.sendError(res, 500, error instanceof Error ? error.message : 'Failed to create project');
    }
  }

  private async handleGetBuilds(req: http.IncomingMessage, res: http.ServerResponse, pathname: string): Promise<void> {
    const projectName = this.extractProjectName(pathname);
    const projectData = this.wsConfig.projects[projectName];

    if (!projectData) {
      this.sendError(res, 404, 'Project not found');
      return;
    }

    this.sendSuccess(res, projectData.buildConfigs);
  }

  private async handleAddBuild(req: http.IncomingMessage, res: http.ServerResponse, pathname: string): Promise<void> {
    const projectName = this.extractProjectName(pathname);
    const body = await this.getRequestBody(req);
    const request: AddBuildRequest = JSON.parse(body);

    if (!this.wsConfig.projects[projectName]) {
      this.sendError(res, 404, 'Project not found');
      return;
    }

    try {
      // Execute the add build command
      await vscode.commands.executeCommand('zephyr-ide.add-build');
      this.sendSuccess(res, { message: 'Build configuration addition initiated' });
    } catch (error) {
      this.sendError(res, 500, error instanceof Error ? error.message : 'Failed to add build');
    }
  }

  private async handleBuild(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const body = await this.getRequestBody(req);
    const request: BuildRequest = JSON.parse(body);

    try {
      // Set active project/build if specified
      if (request.projectName) {
        this.wsConfig.activeProject = request.projectName;
        if (request.buildName) {
          this.wsConfig.projectStates[request.projectName].activeBuildConfig = request.buildName;
        }
      }

      const result = await buildHelper(this.context, this.wsConfig, request.pristine || false);
      this.sendSuccess(res, { message: 'Build completed', result });
    } catch (error) {
      this.sendError(res, 500, error instanceof Error ? error.message : 'Build failed');
    }
  }

  private async handleFlash(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const body = await this.getRequestBody(req);
    const request: FlashRequest = JSON.parse(body);

    try {
      // Check if west is updated
      if (!this.wsConfig.activeSetupState?.westUpdated) {
        this.sendError(res, 400, 'West is not updated. Run west update first.');
        return;
      }

      // Set active project/build if specified
      if (request.projectName) {
        this.wsConfig.activeProject = request.projectName;
        if (request.buildName) {
          this.wsConfig.projectStates[request.projectName].activeBuildConfig = request.buildName;
        }
      }

      await flashActive(this.wsConfig);
      this.sendSuccess(res, { message: 'Flash completed' });
    } catch (error) {
      this.sendError(res, 500, error instanceof Error ? error.message : 'Flash failed');
    }
  }

  private async handleGetWorkspaceConfig(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    // Return a sanitized version of the workspace config
    const sanitizedConfig = {
      initialSetupComplete: this.wsConfig.initialSetupComplete,
      rootPath: this.wsConfig.rootPath,
      activeProject: this.wsConfig.activeProject,
      projects: Object.keys(this.wsConfig.projects),
      projectStates: Object.fromEntries(
        Object.entries(this.wsConfig.projectStates).map(([key, state]) => [
          key,
          {
            activeBuildConfig: state.activeBuildConfig,
            activeTwisterConfig: state.activeTwisterConfig
          }
        ])
      )
    };

    this.sendSuccess(res, sanitizedConfig);
  }

  private extractProjectName(pathname: string): string {
    const parts = pathname.split('/');
    return parts[3]; // /api/projects/{projectName}/builds
  }

  private async getRequestBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk.toString();
      });
      req.on('end', () => {
        resolve(body);
      });
      req.on('error', (error) => {
        reject(error);
      });
    });
  }

  private sendSuccess<T>(res: http.ServerResponse, data?: T, message?: string): void {
    const response: ApiResponse<T> = {
      success: true,
      data,
      message
    };
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response, null, 2));
  }

  private sendError(res: http.ServerResponse, statusCode: number, error: string): void {
    const response: ApiResponse = {
      success: false,
      error
    };
    
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response, null, 2));
  }
}