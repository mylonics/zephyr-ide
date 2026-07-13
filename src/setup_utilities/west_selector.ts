/*
Copyright 2024-2026 mylonics 
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

import { QuickPickItem, ExtensionContext } from 'vscode';
import * as vscode from "vscode";
import * as path from "upath";
import * as fs from "fs-extra";
import { MultiStepInput } from "../utilities/multistepQuickPick";
import { notifyError, outputInfo, outputError } from "../utilities/output";
import { WorkspaceConfig } from './types';
import * as yaml from 'js-yaml';

import { zephyrVersions, ncsVersions, zephyrHals } from "../defines";

/**
 * Configuration interface for west workspace initialization
 */
export interface WestLocation {
  /** Local path to west.yml directory (if using local file) */
  path: string | undefined;
  /** Indicates if the selection/configuration failed */
  failed: boolean;
  /** Git repository URL (if cloning from git) */
  gitRepo: string;
  /** Additional west init arguments */
  additionalArgs: string;
  /**
   * Absolute path to a vendor-supplied host-tools.json, if the selected
   * workspace template is a vendor entry that ships one.  Used by
   * postWorkspaceSetup to show a consent dialog and batch-install tools.
   */
  vendorHostToolsPath?: string;
  /**
   * True when the user intentionally abandoned the wizard without configuring
   * a workspace (e.g. by clicking "Become a Vendor" to read the contributor
   * guide).  Callers should silently exit rather than showing an error.
   */
  userAbandoned?: boolean;
}



/** Input parameters for pure west.yml manifest mutation. */
export interface ApplyManifestSelectionsParams {
  isNcsProject: boolean;
  versionLabel: string;
  /** HAL items to add to the manifest's name-allowlist (only entries with a truthy `description` are used). */
  desiredHals?: readonly QuickPickItem[];
}

/**
 * Pure function: mutate a parsed west.yml manifest document in place, applying
 * the selected Zephyr/NCS version to the matching project's `revision` and
 * appending any selected HAL descriptions to the first project's
 * `import["name-allowlist"]`. Extracted from pickVersion to enable unit
 * testing without file I/O.
 */
export function applyManifestSelections(doc: any, params: ApplyManifestSelectionsParams): void {
  doc.manifest.projects.forEach((project: any) => {
    const shouldUpdate = (params.isNcsProject && project.name === "sdk-nrf") ||
      (!params.isNcsProject && project.name === "zephyr");
    if (shouldUpdate) {
      project.revision = params.versionLabel;
    }
  });

  if (params.desiredHals && params.desiredHals.length > 0) {
    const allowList = doc.manifest.projects[0].import?.["name-allowlist"];
    if (allowList) {
      params.desiredHals.forEach((hal: any) => {
        if (hal.description && !allowList.includes(hal.description)) {
          allowList.push(hal.description);
        }
      });
    }
  }
}

/**
 * Interactive west workspace selector - allows users to choose how to initialize a west workspace
 *
 * Available template options:
 * - Full Zephyr installation
 * - Minimal Zephyr with custom HAL selection
 * - Minimal BLE Zephyr with custom HAL selection
 * - NRF Connect SDK configuration
 *
 * @param context VS Code extension context
 * @param wsConfig Current workspace configuration
 * @returns Promise resolving to WestLocation configuration
 */
export async function westSelector(context: ExtensionContext, wsConfig: WorkspaceConfig): Promise<WestLocation> {
  const title = 'Initialize West';

  const defaultState: WestLocation = {
    path: undefined,
    failed: false,
    gitRepo: "",
    additionalArgs: ""
  };

  // Shared state that is accumulated across steps
  type WestInternalState = {
    westFile?: string;
    desiredHals?: readonly QuickPickItem[];
    isNcsProject?: boolean;
    versionLabel?: string;
    completed?: boolean;
    /** Set when the user picks a vendor entry; holds the vendor's directory path. */
    vendorDir?: string;
    /** Path to the vendor's host-tools.json, if present. */
    vendorHostToolsPath?: string;
    /** Set when the user clicks "Become a Vendor" to open the contributor guide. */
    userAbandoned?: boolean;
  } & Partial<WestLocation>;

  // Compute total steps dynamically depending on whether HAL selection is required.
  // Base steps: 1) template, 2) version, 3) additional args.
  // When a minimal template is chosen we insert a HAL step between template and version.
  // Vendor entries go through a submenu (template → vendor list → additional args = 3 steps).
  function totalStepsFor(state: WestInternalState): number {
    if (state.vendorDir) {
      return 3; // step 1: template, step 2: vendor list, step 3: additional args
    }
    const needsHal = state.westFile === "minimal_west.yml" || state.westFile === "minimal_ble_west.yml";
    return needsHal ? 4 : 3;
  }

  // GitHub README link for the "Become a Vendor" menu item
  const VENDOR_README_URL = "https://github.com/mylonics/zephyr-ide/blob/main/resources/vendors/README.md";
  const BECOME_VENDOR_LABEL = "$(link-external) Become a Vendor";

  async function pickTemplate(input: MultiStepInput, state: WestInternalState) {
    if (!wsConfig.activeSetupState) {
      outputInfo("West Selector", "No active setup state found");
      state.failed = true;
      return;
    }

    type westOptionDict = { [name: string]: string };
    const westOptions: westOptionDict = {};
    westOptions["Full Zephyr"] = "default_west.yml";
    westOptions["Minimal Zephyr (Select Desired HALs)"] = "minimal_west.yml";
    westOptions["Minimal BLE Zephyr (Select Desired HALs)"] = "minimal_ble_west.yml";
    westOptions["Sim Only"] = "simulated_west.yml";

    // Internal testing template — only visible in CI/test environments
    if (process.env.CI || process.env.ZEPHYR_IDE_TESTING) {
      westOptions["Testing"] = "testing_west.yml";
    }

    const westOptionQpItems: QuickPickItem[] = Object.keys(westOptions).map(label => ({ label }));

    // Load vendor configurations from the registry JSON file
    type VendorEntry = { dir: string; label: string; description?: string; detail?: string };
    const vendorEntries: VendorEntry[] = [];
    const vendorsDir = path.join(context.extensionPath, "resources", "vendors");
    const vendorsRegistryPath = path.join(vendorsDir, "vendors.json");
    if (await fs.pathExists(vendorsRegistryPath)) {
      try {
        type VendorRegistryEntry = { id: string; displayName?: string; description?: string; url?: string; maintainer?: string };
        const registry: VendorRegistryEntry[] = JSON.parse(await fs.readFile(vendorsRegistryPath, "utf-8"));
        for (const entry of registry) {
          if (!entry.id) { continue; }
          const vendorDir = path.join(vendorsDir, entry.id);
          const westYml = path.join(vendorDir, "west.yml");
          if (!(await fs.pathExists(westYml))) { continue; }
          const detailParts: string[] = [];
          if (entry.maintainer) { detailParts.push(`Maintainer: ${entry.maintainer}`); }
          if (entry.url) { detailParts.push(`URL: ${entry.url}`); }
          vendorEntries.push({
            dir: vendorDir,
            label: entry.displayName ?? entry.id,
            description: entry.description,
            detail: detailParts.length > 0 ? detailParts.join("  |  ") : undefined,
          });
        }
      } catch { /* ignore malformed registry */ }
    }

    // Add a "Vendor Configurations" entry that opens the vendor submenu
    westOptionQpItems.push({ label: "", kind: vscode.QuickPickItemKind.Separator });
    westOptionQpItems.push({
      label: "$(organization) Vendor Configurations",
      description: vendorEntries.length > 0
        ? `${vendorEntries.length} vendor(s) available`
        : "No vendors available",
    });

    const pick = await input.showQuickPick({
      title,
      step: 1,
      totalSteps: totalStepsFor(state),
      placeholder: 'Select West manifest template',
      ignoreFocusOut: true,
      items: westOptionQpItems,
    });

    // "Vendor Configurations" entry — open the vendor submenu
    if (pick.label === "$(organization) Vendor Configurations") {
      return (input: MultiStepInput) => pickVendor(input, state, vendorEntries);
    }

    const westFile = westOptions[pick.label];
    if (!westFile) {
      notifyError("West Selector", `Failed to select workspace template`);
      state.failed = true;
      return;
    }

    state.westFile = westFile;
    const needsHal = westFile === "minimal_west.yml" || westFile === "minimal_ble_west.yml";
    if (needsHal) {
      return (input: MultiStepInput) => pickHals(input, state);
    }
    return (input: MultiStepInput) => pickVersion(input, state);
  }

  /**
   * Second step shown when the user selects "Vendor Configurations" in pickTemplate.
   * Lists all registered vendors (with description, maintainer and URL as detail) plus a
   * "Become a Vendor" link.  Selecting a vendor proceeds to handleVendorSelection;
   * selecting "Become a Vendor" opens the contributor guide and exits the wizard cleanly.
   */
  async function pickVendor(input: MultiStepInput, state: WestInternalState, vendorEntries: { dir: string; label: string; description?: string; detail?: string }[]) {
    const vendorQpItems: QuickPickItem[] = vendorEntries.map(ve => ({
      label: ve.label,
      description: ve.description,
      detail: ve.detail,
    }));
    vendorQpItems.push({ label: "", kind: vscode.QuickPickItemKind.Separator });
    vendorQpItems.push({ label: BECOME_VENDOR_LABEL, description: "Open contributor guide on GitHub" });

    const pick = await input.showQuickPick({
      title,
      step: 2,
      totalSteps: totalStepsFor(state),
      placeholder: "Select a vendor configuration",
      ignoreFocusOut: true,
      items: vendorQpItems,
    });

    // "Become a Vendor" — open the README and exit the wizard cleanly (no error)
    if (pick.label === BECOME_VENDOR_LABEL) {
      void vscode.env.openExternal(vscode.Uri.parse(VENDOR_README_URL));
      state.userAbandoned = true;
      return;
    }

    // Vendor entry selected
    const vendorEntry = vendorEntries.find(ve => ve.label === pick.label);
    if (vendorEntry) {
      state.vendorDir = vendorEntry.dir;
      return (input: MultiStepInput) => handleVendorSelection(input, state);
    }

    notifyError("West Selector", `Failed to select vendor configuration`);
    state.failed = true;
  }

  /**
   * Copy the vendor's west.yml into the workspace and (optionally) record the
   * path to the vendor's host-tools.json.  Skips the version-picker step since
   * vendors control their own SDK revisions.
   */
  async function handleVendorSelection(input: MultiStepInput, state: WestInternalState) {
    if (!state.vendorDir || !wsConfig.activeSetupState) {
      state.failed = true;
      return;
    }

    const vendorWestSrc = path.join(state.vendorDir, "west.yml");
    const westDirPath = path.join(wsConfig.activeSetupState.setupPath, "west-manifest");
    const desPath = path.join(westDirPath, "west.yml");

    const exists = await fs.pathExists(westDirPath);
    if (!exists) {
      await fs.mkdirp(westDirPath);
    }
    await fs.copyFile(vendorWestSrc, desPath);

    // Record vendor host-tools.json path if present
    const hostToolsPath = path.join(state.vendorDir, "host-tools.json");
    if (await fs.pathExists(hostToolsPath)) {
      state.vendorHostToolsPath = hostToolsPath;
    }

    state.failed = false;
    state.path = westDirPath;
    return (input: MultiStepInput) => getAdditionalArguments(input, state);
  }

  async function pickHals(input: MultiStepInput, state: WestInternalState) {
    const result = await input.showQuickPickMany({
      title,
      step: 2,
      totalSteps: totalStepsFor(state),
      ignoreFocusOut: true,
      placeholder: "Select desired HALs (toggle then press Enter)",
      items: zephyrHals,
    });
    // No custom buttons on this step, so the result is always the selected
    // items array; narrow for TypeScript.
    state.desiredHals = Array.isArray(result) ? (result as readonly QuickPickItem[]) : undefined;
    return (input: MultiStepInput) => pickVersion(input, state);
  }

  async function pickVersion(input: MultiStepInput, state: WestInternalState) {
    if (!state.westFile || !wsConfig.activeSetupState) {
      state.failed = true;
      return;
    }

    // Materialize the west.yml so we can determine whether it is an NCS project.
    const extensionPath = context.extensionPath;
    const srcPath = path.join(extensionPath, "resources", "west_templates", state.westFile);
    const westDirPath = path.join(wsConfig.activeSetupState.setupPath, "west-manifest");
    const desPath = path.join(westDirPath, "west.yml");
    const exists = await fs.pathExists(westDirPath);
    if (!exists) {
      await fs.mkdirp(westDirPath);
    }
    await fs.copyFile(srcPath, desPath, fs.constants.COPYFILE_FICLONE);

    const doc: any = yaml.load(fs.readFileSync(desPath, 'utf-8'));
    let isNcsProject = false;
    for (let i = 0; i < doc.manifest.projects.length; i++) {
      if (doc.manifest.projects[i].name === "sdk-nrf") {
        isNcsProject = true;
      }
    }
    state.isNcsProject = isNcsProject;

    const versionList = isNcsProject ? ncsVersions : zephyrVersions;
    const versionSelectionString = isNcsProject ? "Select NCS Version" : "Select Zephyr Version";

    const versionQP: QuickPickItem[] = [
      { label: "Default" },
      { label: "", kind: vscode.QuickPickItemKind.Separator },
      ...versionList.map(version => ({ label: version }))
    ];

    const needsHal = state.westFile === "minimal_west.yml" || state.westFile === "minimal_ble_west.yml";
    const versionStep = needsHal ? 3 : 2;

    const pick = await input.showQuickPick({
      title,
      step: versionStep,
      totalSteps: totalStepsFor(state),
      ignoreFocusOut: true,
      placeholder: versionSelectionString,
      items: versionQP,
    });

    let versionLabel = pick.label;
    if (versionLabel === "Other Version") {
      const version = await input.showInputBox({
        title,
        step: versionStep,
        totalSteps: totalStepsFor(state),
        ignoreFocusOut: true,
        value: "Default",
        prompt: 'Enter version (e.g., v3.7.0) or branch name (e.g., main)',
        validate: async (value: string) => {
          if (!value || value.trim() === "") {
            return "Please enter a version";
          }
          return undefined;
        }
      });

      if (version && version.trim() !== "") {
        versionLabel = version;
      } else {
        state.failed = true;
        return;
      }
    }

    if (versionLabel === "Default") {
      versionLabel = versionList[0];
    }
    state.versionLabel = versionLabel;

    // Apply the version and HAL selections to the materialized west.yml
    applyManifestSelections(doc, { isNcsProject, versionLabel, desiredHals: state.desiredHals });

    fs.writeFileSync(desPath, yaml.dump(doc));

    state.failed = false;
    state.path = westDirPath;

    return (input: MultiStepInput) => getAdditionalArguments(input, state);
  }

  async function getAdditionalArguments(input: MultiStepInput, state: WestInternalState) {
    const needsHal = state.westFile === "minimal_west.yml" || state.westFile === "minimal_ble_west.yml";
    const argsStep = state.vendorDir ? 3 : (needsHal ? 4 : 3);
    state.additionalArgs = await input.showInputBox({
      title,
      step: argsStep,
      totalSteps: totalStepsFor(state),
      ignoreFocusOut: true,
      placeholder: "--mr main",
      value: "",
      prompt: 'Additional west init arguments (optional)',
      validate: async () => undefined
    });
    // Mark completion only after the final step accepts. MultiStepInput.run
    // consumes user cancel internally, so without this flag a cancel on this
    // step would still treat the wizard as successful (state.path is set in
    // the prior pickVersion step).
    state.completed = true;
  }

  async function collectInputs(): Promise<WestLocation> {
    const state: WestInternalState = { ...defaultState };
    try {
      await MultiStepInput.run(input => pickTemplate(input, state));
      // User intentionally abandoned the wizard (e.g. clicked "Become a Vendor")
      if (state.userAbandoned) {
        return { ...defaultState, failed: false, userAbandoned: true };
      }
      if (!state.completed || state.failed || !state.path) {
        return { ...defaultState, failed: true };
      }
      return {
        path: state.path,
        failed: false,
        gitRepo: state.gitRepo ?? "",
        additionalArgs: state.additionalArgs ?? "",
        vendorHostToolsPath: state.vendorHostToolsPath,
      };
    } catch (error) {
      outputError("West Selector", `Error in west selector: ${String(error)}`);
      return { ...defaultState, failed: true };
    }
  }

  return await collectInputs();
}

