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

import * as vscode from 'vscode';
import { getLaunchConfigurations } from "../utilities/utils";
import { RunnerBind } from "./runner_profiles";
import { WorkspaceConfig } from "../setup_utilities/types";

/** All known west runners. */
export const KNOWN_RUNNERS = [
  "openocd", "jlink", "pyocd", "stlink", "nrfjprog", "nrfutil", "blackmagicprobe",
  "linkserver", "dfu-util", "uf2", "esp32", "qemu", "bossac", "teensy", "bflb-mcu-tool",
  "arc-jtag", "dediprog", "silabs_commander", "xsdb",
];

/** Subset of KNOWN_RUNNERS that support debug/attach (GDB server capable). */
export const DEBUG_CAPABLE_RUNNERS = [
  "openocd", "jlink", "pyocd", "stlink", "blackmagicprobe", "linkserver", "nrfjprog",
  "nrfutil", "esp32", "qemu", "arc-jtag", "xsdb",
];

export interface BindSelectorOptions {
  slot: "flash" | "debug" | "attach" | "buildDebug";
  current?: RunnerBind;
  wsConfig?: WorkspaceConfig;
}

async function appendLaunchTemplate(runner: string, request: "flash" | "launch" | "attach"): Promise<RunnerBind | undefined> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  const name = `Zephyr IDE: ${runner}`;
  const entry: vscode.DebugConfiguration = { type: "zephyr-ide", request, name, runner };
  const cfg = vscode.workspace.getConfiguration("launch", folder?.uri);
  const current = cfg.inspect<vscode.DebugConfiguration[]>("configurations")?.workspaceFolderValue
    ?? cfg.get<vscode.DebugConfiguration[]>("configurations")
    ?? [];
  const next = [...current, entry];
  await cfg.update("configurations", next, folder ? vscode.ConfigurationTarget.WorkspaceFolder : vscode.ConfigurationTarget.Workspace);
  await vscode.commands.executeCommand("workbench.action.debug.configure");
  return { kind: "launch", name, ...(folder ? { workspaceFolder: folder.name } : {}) };
}

export async function bindSelector(options: BindSelectorOptions): Promise<RunnerBind | undefined> {
  const wsConfig = options.wsConfig ?? { rootPath: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "", projects: {}, projectStates: {} } as WorkspaceConfig;
  const configs = await getLaunchConfigurations(wsConfig) ?? [];
  const isMultiRoot = (vscode.workspace.workspaceFolders?.length ?? 0) > 1;
  const items: (vscode.QuickPickItem & { bind?: RunnerBind; create?: boolean })[] = [
    { label: "Auto (runners.yaml defaults)", bind: { kind: "auto" } },
  ];
  if (configs.length > 0) {
    items.push({ label: "launch.json", kind: vscode.QuickPickItemKind.Separator });
    for (const cfg of configs) {
      if (cfg.type !== "zephyr-ide" && cfg.type !== "cortex-debug" && cfg.type !== "bmp-debug") { continue; }
      items.push({
        label: cfg.name,
        description: isMultiRoot ? cfg.workspaceFolder : undefined,
        bind: { kind: "launch", name: cfg.name, ...(cfg.workspaceFolder ? { workspaceFolder: cfg.workspaceFolder } : {}) },
      });
    }
  }
  items.push({ label: "$(add) Create new launch entry from template…", create: true });

  const picked = await vscode.window.showQuickPick(items, { ignoreFocusOut: true, placeHolder: `Select ${options.slot} launch binding` });
  if (!picked) { return undefined; }
  if (picked.bind) { return picked.bind; }
  if (!picked.create) { return undefined; }

  const runnerPool = options.slot === "flash" ? KNOWN_RUNNERS : DEBUG_CAPABLE_RUNNERS;
  const runnerPick = await vscode.window.showQuickPick(runnerPool.map(label => ({ label })), {
    ignoreFocusOut: true,
    placeHolder: "Select runner for the new zephyr-ide launch entry",
  });
  if (!runnerPick) { return undefined; }
  const request = options.slot === "flash" ? "flash" : (options.slot === "attach" ? "attach" : "launch");
  return appendLaunchTemplate(runnerPick.label, request);
}
