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

import * as assert from 'assert';
import * as http from 'http';
import { ZephyrIdeApiServer } from '../api/api-server';
import { ApiServerConfig } from '../api/api-types';
import { WorkspaceConfig } from '../setup_utilities/types';

// Mock VS Code context for testing
const mockContext = {
  subscriptions: [],
  workspaceState: new Map(),
  globalState: new Map(),
  extensionPath: '',
  extensionUri: {} as any,
  environmentVariableCollection: {} as any,
  extensionMode: 1 as any,
  storageUri: undefined,
  globalStorageUri: {} as any,
  logUri: {} as any,
  asAbsolutePath: () => '',
  storagePath: ''
} as any;

// Mock workspace config
const mockWsConfig: WorkspaceConfig = {
  initialSetupComplete: false,
  rootPath: '',
  projects: {},
  projectStates: {},
  activeProject: undefined,
  activeSetupState: undefined,
  automaticProjectSelction: false
};

suite('API Server Tests', () => {
  let apiServer: ZephyrIdeApiServer;
  const testPort = 18080; // Use a different port for testing

  const testConfig: ApiServerConfig = {
    enabled: true,
    port: testPort,
    apiKey: 'test-key',
    allowedOrigins: ['*']
  };

  suiteSetup(async () => {
    apiServer = new ZephyrIdeApiServer(mockContext, mockWsConfig, testConfig);
    await apiServer.start();
  });

  suiteTeardown(async () => {
    if (apiServer) {
      await apiServer.stop();
    }
  });

  test('API server should respond to status endpoint', async () => {
    const response = await makeRequest('GET', '/api/status');
    assert.strictEqual(response.statusCode, 200);
    
    const data = JSON.parse(response.body);
    assert.strictEqual(data.success, true);
    assert.ok(data.data);
    assert.ok(data.data.hasOwnProperty('version'));
    assert.ok(data.data.hasOwnProperty('initialized'));
  });

  test('API server should require authentication when API key is set', async () => {
    const response = await makeRequest('GET', '/api/status', {}, {});
    assert.strictEqual(response.statusCode, 401);
  });

  test('API server should accept valid API key', async () => {
    const response = await makeRequest('GET', '/api/status', {}, {
      'X-API-Key': 'test-key'
    });
    assert.strictEqual(response.statusCode, 200);
  });

  test('API server should respond to projects endpoint', async () => {
    const response = await makeRequest('GET', '/api/projects', {}, {
      'X-API-Key': 'test-key'
    });
    assert.strictEqual(response.statusCode, 200);
    
    const data = JSON.parse(response.body);
    assert.strictEqual(data.success, true);
    assert.ok(data.data);
  });

  test('API server should handle CORS preflight requests', async () => {
    const response = await makeRequest('OPTIONS', '/api/status');
    assert.strictEqual(response.statusCode, 200);
  });

  test('API server should return 404 for unknown endpoints', async () => {
    const response = await makeRequest('GET', '/api/unknown', {}, {
      'X-API-Key': 'test-key'
    });
    assert.strictEqual(response.statusCode, 404);
  });
});

// Helper function to make HTTP requests
function makeRequest(
  method: string,
  path: string,
  data: any = {},
  headers: { [key: string]: string } = {}
): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 18080, // Use test port directly
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode || 0,
          body: body
        });
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    if (method !== 'GET' && method !== 'OPTIONS') {
      req.write(JSON.stringify(data));
    }

    req.end();
  });
}