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

import * as assert from "assert";
import * as vscode from "vscode";
import * as fs from "fs-extra";
import * as path from "path";
import * as os from "os";
import {
  logTestEnvironment,
  printWorkspaceStructure,
  setupTestWorkspace,
  cleanupTestWorkspace,
  activateExtension,
  executeTestWithErrorHandling
} from "./test-runner";
import { UIMockInterface, MockInteraction } from "./ui-mock-interface";

/*
 * BASIC WORKSPACE TEST:
 * 
 * This is a simple test that just creates some directories and files
 * to test the workspace structure printing functionality without
 * waiting for full Zephyr workspace setup.
 */

suite("Basic Workspace Test Suite", () => {
  let testWorkspaceDir: string;
  let originalWorkspaceFolders: readonly vscode.WorkspaceFolder[] | undefined;

  suiteSetup(() => {
    logTestEnvironment();
    console.log("🔬 Testing basic workspace directory structure");
  });

  setup(async () => {
    const workspace = await setupTestWorkspace("basic");
    testWorkspaceDir = workspace.testWorkspaceDir;
    originalWorkspaceFolders = workspace.originalWorkspaceFolders;
  });

  teardown(async () => {
    await cleanupTestWorkspace(testWorkspaceDir, originalWorkspaceFolders);
  });

  test("Basic Workspace: Create Directory Structure → Print Structure", async function () {
    this.timeout(60000); // Much shorter timeout since we're not doing real setup

    console.log("🚀 Starting basic workspace test...");

    const uiMock = new UIMockInterface();

    await executeTestWithErrorHandling(
      "Basic Workspace Test",
      testWorkspaceDir,
      uiMock,
      async () => {
        await activateExtension();
        uiMock.activate();

        console.log("🏗️ Step 1: Creating mock workspace structure...");

        // Create a simple directory structure to mimic a Zephyr workspace
        await fs.ensureDir(path.join(testWorkspaceDir, ".vscode"));
        await fs.ensureDir(path.join(testWorkspaceDir, "zephyr"));
        await fs.ensureDir(path.join(testWorkspaceDir, "modules", "hal", "nordic"));
        await fs.ensureDir(path.join(testWorkspaceDir, "tools"));
        await fs.ensureDir(path.join(testWorkspaceDir, "blinky"));
        await fs.ensureDir(path.join(testWorkspaceDir, "blinky", "src"));

        // Create some mock files
        await fs.writeFile(path.join(testWorkspaceDir, "west.yml"), `
manifest:
  defaults:
    remote: upstream
  remotes:
    - name: upstream
      url-base: https://github.com/zephyrproject-rtos
  projects:
    - name: zephyr
      remote: upstream
      revision: main
      import: true
`);

        await fs.writeFile(path.join(testWorkspaceDir, ".vscode", "zephyr-ide.json"), `{
  "version": "2.0.0",
  "build": {
    "board": "qemu_x86",
    "pristine": "auto"
  }
}`);

        await fs.writeFile(path.join(testWorkspaceDir, "blinky", "CMakeLists.txt"), `
cmake_minimum_required(VERSION 3.20.0)
find_package(Zephyr REQUIRED HINTS $ENV{ZEPHYR_BASE})
project(blinky)

target_sources(app PRIVATE src/main.c)
`);

        await fs.writeFile(path.join(testWorkspaceDir, "blinky", "src", "main.c"), `
#include <zephyr/kernel.h>
#include <zephyr/drivers/gpio.h>

int main(void)
{
    printk("Hello World! %s\\n", CONFIG_BOARD);
    return 0;
}
`);

        console.log("✅ Step 2: Mock workspace structure created!");

        // Verify the structure was created
        const workspaceContents = await fs.readdir(testWorkspaceDir);
        console.log(`📁 Created workspace contents: ${workspaceContents.join(', ')}`);

        // Check if VS Code workspace folder points to the right place
        const vsCodeWorkspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        console.log(`🔧 VS Code workspace folder: ${vsCodeWorkspace}`);
        console.log(`🔧 Test workspace directory: ${testWorkspaceDir}`);
        console.log(`🔧 Paths match: ${vsCodeWorkspace === testWorkspaceDir}`);
      }
    );
  }).timeout(120000);

});
