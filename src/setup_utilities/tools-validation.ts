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

import * as vscode from "vscode";
import { outputInfo, outputError, notifyError, showOutput } from "../utilities/output";
import { WorkspaceConfig, GlobalConfig } from "./types";
import { saveSetupState } from "./state-management";
import { checkAllPackages } from "./host_tools";

export let pathdivider = process.platform === "win32" ? ";" : ":";

/**
 * Check if all required tools are available using the new host tools system
 */
export async function checkIfToolsAvailable(
  context: vscode.ExtensionContext,
  wsConfig: WorkspaceConfig,
  globalConfig: GlobalConfig,
  solo = true
): Promise<boolean> {
  globalConfig.toolsAvailable = false;
  saveSetupState(context, wsConfig, globalConfig);
  showOutput();

  outputInfo("Tools Check",
    "Checking if build tools are installed and available in system path."
  );

  outputInfo("Tools Check",
    "Please follow the section Install Dependencies. https://docs.zephyrproject.org/latest/develop/getting_started/index.html#install-dependencies."
  );

  try {
    const packageStatuses = await checkAllPackages();
    const missingPackages = packageStatuses.filter(s => !s.available);
    
    if (missingPackages.length > 0) {
      outputInfo("Tools Check", `Missing ${missingPackages.length} required tools:`);
      for (const pkg of missingPackages) {
        outputInfo("Tools Check", `  - ${pkg.name} (${pkg.package})`);
      }
      
      if (solo) {
        notifyError("Tools Check",
          `Missing ${missingPackages.length} required tools. Check output for details or use Host Tools Install panel.`
        );
      }
      return false;
    }

    outputInfo("Tools Check", "All required tools are available");
    globalConfig.toolsAvailable = true;
    saveSetupState(context, wsConfig, globalConfig);
    
    if (solo) {
      vscode.window.showInformationMessage("Zephyr IDE: Build Tools are available");
    }

    return true;
  } catch (error) {
    outputError("Tools Check", `Error checking tools: ${error}`);
    if (solo) {
      notifyError("Tools Check", `Failed to check tools: ${error}`);
    }
    return false;
  }
}

