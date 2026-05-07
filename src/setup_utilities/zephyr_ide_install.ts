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
 * Quick-pick UIs and bulk install helpers for the `toolchains` and `blobs`
 * arrays declared in `.vscode/zephyr-ide.json`.
 *
 * The "modify" entry points open a checkable quick-pick that reflects what's
 * currently in zephyr-ide.json and prioritises items that are already
 * installed locally; the "install" entry points iterate the declared list and
 * install the missing items via the Zephyr SDK setup script (toolchains) or
 * `west blobs fetch` (blobs).
 */

import * as vscode from "vscode";
import * as path from "upath";
import { WorkspaceConfig, GlobalConfig } from "./types";
import type { ProjectConfig } from "../project_utilities/project";
import { toolchainTargets } from "../defines";
import {
    listAvailableSDKs,
    installSDK,
    installToolchainsDirect,
    detectInstalledSDKVersion,
    detectSDKVersionFromZephyrDir,
} from "./west_sdk";
import {
    getZephyrIdeToolchains,
    setZephyrIdeToolchains,
    getZephyrIdeBlobs,
    setZephyrIdeBlobs,
    getZephyrIdeSdkVersion,
    getZephyrIdeSampleProjects,
    setZephyrIdeSampleProjects,
} from "./zephyr_ide_json";
import { executeShellCommandInPythonEnv, executeTaskHelperInPythonEnv } from "../utilities/utils";
import { outputInfo, outputError, outputWarning, notifyError } from "../utilities/output";
import { getSetupStateOrNotify } from "./workspace-config";
import { setGlobalState } from "./state-management";

// ---------------------------------------------------------------------------
// Toolchains
// ---------------------------------------------------------------------------

/**
 * Build the union of "known toolchain targets" plus any extra labels that
 * appear in the user's installed SDKs or in zephyr-ide.json. This makes the
 * picker surface custom / 3rd-party toolchains the extension doesn't know
 * about by name.
 */
function buildToolchainCatalog(extras: Iterable<string>): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const item of toolchainTargets) {
        if (item.kind === vscode.QuickPickItemKind.Separator) { continue; }
        if (seen.has(item.label)) { continue; }
        seen.add(item.label);
        out.push(item.label);
    }
    for (const e of extras) {
        const trimmed = e.trim();
        if (!trimmed || seen.has(trimmed)) { continue; }
        seen.add(trimmed);
        out.push(trimmed);
    }
    return out;
}

/** Open the modify-toolchains quick-pick and persist the result. */
export async function modifyZephyrIdeToolchainsInteractive(wsConfig: WorkspaceConfig): Promise<string[] | undefined> {
    if (!wsConfig.rootPath) {
        notifyError("Zephyr IDE Toolchains", "No active workspace folder.");
        return undefined;
    }

    const current = new Set(getZephyrIdeToolchains(wsConfig));

    // Discover toolchains installed locally so the picker can prioritise them.
    const installedLocal = new Set<string>();
    try {
        const sdkList = await listAvailableSDKs();
        if (sdkList.success) {
            for (const v of sdkList.versions) {
                for (const tc of v.installedToolchains ?? []) { installedLocal.add(tc); }
            }
        }
    } catch (error) {
        outputWarning("Zephyr IDE Toolchains", `Failed to list installed SDKs: ${error}`);
    }

    const allLabels = buildToolchainCatalog([...current, ...installedLocal]);

    type Item = vscode.QuickPickItem & { label: string };
    const installedItems: Item[] = [];
    const otherItems: Item[] = [];
    for (const label of allLabels) {
        const isInstalled = installedLocal.has(label);
        const item: Item = {
            label,
            description: isInstalled ? "$(check) installed" : undefined,
            picked: current.has(label),
        };
        (isInstalled ? installedItems : otherItems).push(item);
    }

    // Sort: installed first (alphabetical), then everything else (alphabetical).
    installedItems.sort((a, b) => a.label.localeCompare(b.label));
    otherItems.sort((a, b) => a.label.localeCompare(b.label));

    const items: vscode.QuickPickItem[] = [];
    if (installedItems.length > 0) {
        items.push({ label: "Installed locally", kind: vscode.QuickPickItemKind.Separator });
        items.push(...installedItems);
    }
    if (otherItems.length > 0) {
        items.push({ label: "Other available toolchains", kind: vscode.QuickPickItemKind.Separator });
        items.push(...otherItems);
    }

    const picked = await vscode.window.showQuickPick(items, {
        canPickMany: true,
        ignoreFocusOut: true,
        placeHolder: "Select toolchains to require in zephyr-ide.json (already-included items are checked)",
        title: "Modify Required Toolchains (zephyr-ide.json)",
    });

    if (!picked) {
        outputInfo("Zephyr IDE Toolchains", "Modify cancelled");
        return undefined;
    }

    const labels = picked
        .filter(i => i.kind !== vscode.QuickPickItemKind.Separator)
        .map(i => i.label);
    await setZephyrIdeToolchains(wsConfig, labels);
    outputInfo("Zephyr IDE Toolchains", `Saved ${labels.length} toolchain(s) to zephyr-ide.json`);
    return labels;
}

/**
 * Determine which declared toolchains are not yet installed in the target SDK.
 *
 * If `targetSdkVersion` is provided, only toolchains installed in that
 * specific SDK count as installed (matches the SDK that
 * `installZephyrIdeToolchains` will actually install into). Otherwise the
 * union across all installed SDKs is used.
 */
async function findMissingToolchains(declared: string[], targetSdkVersion?: string): Promise<string[]> {
    if (declared.length === 0) { return []; }
    const installed = new Set<string>();
    try {
        const sdkList = await listAvailableSDKs();
        if (sdkList.success) {
            for (const v of sdkList.versions) {
                if (targetSdkVersion && v.version !== targetSdkVersion) { continue; }
                for (const tc of v.installedToolchains ?? []) { installed.add(tc); }
            }
        }
    } catch {
        // Conservative: if we can't list, assume nothing is installed so we try.
    }
    return declared.filter(tc => !installed.has(tc));
}

/**
 * Resolve which Zephyr SDK version the workspace requires, in priority order:
 *   1. `sdkVersion` declared in `.vscode/zephyr-ide.json`.
 *   2. The version recorded in the Zephyr source tree's `SDK_VERSION` file
 *      (when an `activeSetupState.zephyrDir` is available).
 *   3. The version of an SDK that is already installed locally.
 *   4. `undefined`, meaning the install path will pick the latest released
 *      SDK from GitHub.
 */
async function resolveTargetSdkVersion(wsConfig: WorkspaceConfig): Promise<string | undefined> {
    const declared = getZephyrIdeSdkVersion(wsConfig);
    if (declared) { return declared; }

    const zephyrDir = wsConfig.activeSetupState?.zephyrDir;
    if (zephyrDir) {
        const fromZephyr = await detectSDKVersionFromZephyrDir(zephyrDir);
        if (fromZephyr) { return fromZephyr; }
    }

    const installed = await detectInstalledSDKVersion();
    if (installed) { return installed; }

    return undefined;
}

/**
 * Install every toolchain declared in zephyr-ide.json that isn't already
 * present in the resolved target SDK.
 *
 * Target SDK version resolution (see `resolveTargetSdkVersion`):
 * `zephyr-ide.json` → Zephyr `SDK_VERSION` file → installed SDK → "latest".
 *
 * When `bootstrapSdk` is true and the resolved target SDK is not yet
 * installed locally, this function downloads and installs it (along with the
 * declared toolchains) directly via `installSDK`. When called interactively
 * (`bootstrapSdk: false`) and no SDK is installed, the user is instead
 * directed to run `Zephyr IDE: Install SDK` themselves.
 *
 * @param silentIfEmpty   When true, don't show notifications if zephyr-ide.json
 *                        declares no toolchains. Used by the auto-install hook.
 * @param bootstrapSdk    When true, install the resolved target SDK if it
 *                        isn't already on disk. Used by the auto-install hook.
 */
export async function installZephyrIdeToolchains(
    wsConfig: WorkspaceConfig,
    globalConfig: GlobalConfig,
    context: vscode.ExtensionContext | undefined,
    silentIfEmpty = false,
    bootstrapSdk = false,
): Promise<boolean> {
    const declared = getZephyrIdeToolchains(wsConfig);
    if (declared.length === 0) {
        if (!silentIfEmpty) {
            void vscode.window.showInformationMessage(
                "No toolchains declared in .vscode/zephyr-ide.json. Run 'Modify zephyr-ide.json toolchains' first."
            );
        }
        return true;
    }

    // Pick the target SDK version per the documented priority list, falling
    // back to globalConfig.sdkVersion only when nothing else is available.
    let targetVersion = await resolveTargetSdkVersion(wsConfig) ?? globalConfig.sdkVersion;

    // Determine whether an SDK matching `targetVersion` is already on disk.
    const installedVersions = new Set<string>();
    try {
        const list = await listAvailableSDKs();
        if (list.success) {
            for (const v of list.versions) { installedVersions.add(v.version); }
        }
    } catch { /* tolerated — fall through */ }

    const needsBootstrap = !targetVersion || !installedVersions.has(targetVersion);

    if (needsBootstrap) {
        if (!bootstrapSdk) {
            notifyError("Zephyr IDE Toolchains",
                `Cannot install required toolchains: target Zephyr SDK ${targetVersion ?? "(latest)"} is not installed. Run 'Zephyr IDE: Install SDK' first.`);
            return false;
        }
        outputInfo("Zephyr IDE Toolchains",
            `Installing Zephyr SDK ${targetVersion ?? "(latest)"} with declared toolchains: ${declared.join(", ")}`);

        const ok = await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Installing Zephyr SDK ${targetVersion ?? "(latest)"}`,
                cancellable: false,
            },
            async (progress) => installSDK(targetVersion, declared, (msg) => progress.report({ message: msg })),
        );

        if (!ok) {
            outputWarning("Zephyr IDE Toolchains",
                `Failed to install Zephyr SDK ${targetVersion ?? "(latest)"} for declared toolchains.`);
            return false;
        }

        // installSDK doesn't update globalConfig — record the install so the
        // rest of the setup flow knows there's now an SDK to use.
        const newInstalled = targetVersion ?? await detectInstalledSDKVersion();
        if (newInstalled) {
            globalConfig.sdkInstalled = true;
            globalConfig.sdkVersion = newInstalled;
            if (context) { await setGlobalState(context, globalConfig); }
            targetVersion = newInstalled;
        }
        return true;
    }

    // SDK is already installed: just install any toolchains it's missing.
    // (We're past the `needsBootstrap` branch, so `targetVersion` is set.)
    if (!targetVersion) { return false; }
    const missing = await findMissingToolchains(declared, targetVersion);
    if (missing.length === 0) {
        outputInfo("Zephyr IDE Toolchains",
            `All declared toolchains already installed in SDK ${targetVersion}: ${declared.join(", ")}`);
        return true;
    }

    outputInfo("Zephyr IDE Toolchains",
        `Installing missing toolchains for SDK ${targetVersion}: ${missing.join(", ")}`);

    return await installToolchainsDirect(globalConfig, context, targetVersion, missing);
}

// ---------------------------------------------------------------------------
// Blobs
// ---------------------------------------------------------------------------

/**
 * Discover west modules that ship binary blobs. Returns module names suitable
 * for `west blobs fetch <module>`. Best-effort: returns an empty list if west
 * isn't available or no modules declare blobs.
 */
async function listModulesWithBlobs(wsConfig: WorkspaceConfig, _context: vscode.ExtensionContext): Promise<string[]> {
    // Silent variant: don't notify the user — listing blobs is a discovery
    // step that gracefully degrades to "no available modules" when west isn't
    // ready yet. Use activeSetupState directly to avoid the missing-environment
    // warning that getSetupState() would surface.
    const setupState = wsConfig.activeSetupState;
    if (!setupState) { return []; }

    try {
        const res = await executeShellCommandInPythonEnv(
            `west blobs list -f "{module}"`,
            setupState.setupPath,
            setupState,
            false,
        );
        if (!res.stdout) { return []; }
        const seen = new Set<string>();
        const out: string[] = [];
        for (const line of res.stdout.split(/\r?\n/)) {
            const name = line.trim();
            if (!name || seen.has(name)) { continue; }
            seen.add(name);
            out.push(name);
        }
        return out;
    } catch (error) {
        outputWarning("Zephyr IDE Blobs", `Failed to list available blobs: ${error}`);
        return [];
    }
}

/** Open the modify-blobs quick-pick and persist the result. */
export async function modifyZephyrIdeBlobsInteractive(
    wsConfig: WorkspaceConfig,
    context: vscode.ExtensionContext,
): Promise<string[] | undefined> {
    if (!wsConfig.rootPath) {
        notifyError("Zephyr IDE Blobs", "No active workspace folder.");
        return undefined;
    }

    const current = new Set(getZephyrIdeBlobs(wsConfig));
    const available = await listModulesWithBlobs(wsConfig, context);

    // Union: items currently declared but not in `west blobs list` are still
    // shown so the user can keep them.
    const seen = new Set<string>();
    const installed: string[] = [];
    const others: string[] = [];
    for (const m of available) {
        if (seen.has(m)) { continue; }
        seen.add(m);
        installed.push(m);
    }
    for (const m of current) {
        if (seen.has(m)) { continue; }
        seen.add(m);
        others.push(m);
    }
    installed.sort((a, b) => a.localeCompare(b));
    others.sort((a, b) => a.localeCompare(b));

    if (installed.length === 0 && others.length === 0) {
        void vscode.window.showInformationMessage(
            "No west modules declaring blobs were found. Run 'west update' first, or add module names manually to .vscode/zephyr-ide.json."
        );
        return undefined;
    }

    const items: vscode.QuickPickItem[] = [];
    if (installed.length > 0) {
        items.push({ label: "Modules with blobs available", kind: vscode.QuickPickItemKind.Separator });
        for (const m of installed) {
            items.push({ label: m, description: "$(package) blobs available", picked: current.has(m) });
        }
    }
    if (others.length > 0) {
        items.push({ label: "Declared in zephyr-ide.json (not currently visible to west)", kind: vscode.QuickPickItemKind.Separator });
        for (const m of others) {
            items.push({ label: m, picked: true });
        }
    }

    const picked = await vscode.window.showQuickPick(items, {
        canPickMany: true,
        ignoreFocusOut: true,
        placeHolder: "Select modules whose blobs should be required (already-included items are checked)",
        title: "Modify Required Blobs (zephyr-ide.json)",
    });

    if (!picked) {
        outputInfo("Zephyr IDE Blobs", "Modify cancelled");
        return undefined;
    }

    const labels = picked
        .filter(i => i.kind !== vscode.QuickPickItemKind.Separator)
        .map(i => i.label);
    await setZephyrIdeBlobs(wsConfig, labels);
    outputInfo("Zephyr IDE Blobs", `Saved ${labels.length} blob module(s) to zephyr-ide.json`);
    return labels;
}

/**
 * West module names are restricted by west itself to identifier-like strings.
 * Reject anything containing characters that could break out of the
 * `west blobs fetch <module>` shell command we construct below — repo
 * `.vscode/zephyr-ide.json` is contributor-controlled and should not be able
 * to inject arbitrary commands.
 */
const VALID_MODULE_NAME = /^[A-Za-z0-9_][A-Za-z0-9_.\-]*$/;

/**
 * Fetch every blob module declared in zephyr-ide.json by running
 * `west blobs fetch <module>` for each one.
 */
export async function installZephyrIdeBlobs(
    wsConfig: WorkspaceConfig,
    context: vscode.ExtensionContext,
    silentIfEmpty = false,
): Promise<boolean> {
    const declared = getZephyrIdeBlobs(wsConfig);
    if (declared.length === 0) {
        if (!silentIfEmpty) {
            void vscode.window.showInformationMessage(
                "No blobs declared in .vscode/zephyr-ide.json. Run 'Modify zephyr-ide.json blobs' first."
            );
        }
        return true;
    }

    const setupState = await getSetupStateOrNotify(context, wsConfig, "Zephyr IDE Blobs");
    if (!setupState) { return false; }

    let allOk = true;
    for (const moduleName of declared) {
        if (!VALID_MODULE_NAME.test(moduleName)) {
            outputError("Zephyr IDE Blobs",
                `Refusing to fetch blobs for invalid module name '${moduleName}'. ` +
                `Module names must match ${VALID_MODULE_NAME.source}.`);
            allOk = false;
            continue;
        }
        outputInfo("Zephyr IDE Blobs", `Fetching blobs for module '${moduleName}'...`);
        const ok = await executeTaskHelperInPythonEnv(
            setupState,
            `Zephyr IDE: Fetch Blobs (${moduleName})`,
            `west blobs fetch ${moduleName}`,
            setupState.setupPath,
        );
        if (!ok) {
            outputError("Zephyr IDE Blobs", `Failed to fetch blobs for module '${moduleName}'`);
            allOk = false;
        }
    }

    if (!allOk) {
        notifyError("Zephyr IDE Blobs", "One or more blob modules failed to fetch. Check the Zephyr IDE output for details.");
    } else {
        outputInfo("Zephyr IDE Blobs", `Fetched blobs for ${declared.length} module(s).`);
    }
    return allOk;
}

// ---------------------------------------------------------------------------
// Sample Projects
// ---------------------------------------------------------------------------

/**
 * Compare the configuration-only fields of two ProjectConfig objects
 * (build configs, conf files, and twister configs), ignoring name and rel_path
 * which are handled separately.
 */
function projectConfigContentEquals(a: ProjectConfig, b: ProjectConfig): boolean {
    return (
        JSON.stringify(a.buildConfigs) === JSON.stringify(b.buildConfigs) &&
        JSON.stringify(a.confFiles) === JSON.stringify(b.confFiles) &&
        JSON.stringify(a.twisterConfigs) === JSON.stringify(b.twisterConfigs)
    );
}

/**
 * Open a QuickPick that lets the user select which workspace projects should
 * be declared as `sampleProjects` in `.vscode/zephyr-ide.json`.
 *
 * - Projects already in `sampleProjects` at the current path AND with no
 *   configuration changes are pre-checked with a "already in sampleProjects"
 *   indicator.
 * - Projects at the same path but whose builds, args, or conf files have
 *   changed are highlighted as "settings changed" and pre-checked.
 * - Projects that exist in `sampleProjects` under the same name but at a
 *   different path (i.e. the project was moved) are shown with a "path
 *   changed" indicator and pre-checked so the user can confirm the update.
 * - Workspace projects not yet declared are shown unchecked.
 *
 * When the user confirms, the full `ProjectConfig` (including build configs,
 * args, and conf files) is saved back to `sampleProjects` in zephyr-ide.json,
 * so subsequent runs can detect settings changes.
 */
export async function modifyZephyrIdeSampleProjectsInteractive(
    wsConfig: WorkspaceConfig,
): Promise<ProjectConfig[] | undefined> {
    if (!wsConfig.rootPath) {
        notifyError("Zephyr IDE Sample Projects", "No active workspace folder.");
        return undefined;
    }

    const currentSamples = getZephyrIdeSampleProjects(wsConfig);

    // Build lookups: by path (for exact match) and by name (for path-change detection).
    const storedByPath = new Map<string, ProjectConfig>();
    const storedByName = new Map<string, ProjectConfig>();
    for (const s of currentSamples) {
        storedByPath.set(s.rel_path, s);
        storedByName.set(s.name, s);
    }

    const projects = Object.values(wsConfig.projects);
    if (projects.length === 0) {
        void vscode.window.showInformationMessage(
            "No projects in this workspace yet. Add projects first, then use this command to promote them to sample projects."
        );
        return undefined;
    }

    type Item = vscode.QuickPickItem & { relPath: string; projName: string };

    const samePathItems: Item[] = [];
    const changedItems: Item[] = [];
    const newItems: Item[] = [];

    for (const proj of projects) {
        const relPath = proj.rel_path;
        const projName = proj.name;

        if (storedByPath.has(relPath)) {
            // Same path — check whether any settings changed.
            const stored = storedByPath.get(relPath)!;
            if (projectConfigContentEquals(proj, stored)) {
                // Exact match: path and all settings are the same.
                samePathItems.push({
                    label: projName,
                    description: relPath,
                    detail: "$(check) already in sampleProjects",
                    picked: true,
                    relPath,
                    projName,
                });
            } else {
                // Same path but builds, args, or conf files changed.
                changedItems.push({
                    label: projName,
                    description: relPath,
                    detail: "$(warning) settings changed (builds, args, or conf files)",
                    picked: true,
                    relPath,
                    projName,
                });
            }
        } else if (storedByName.has(projName)) {
            // Same project name but different path — project was moved.
            const stored = storedByName.get(projName)!;
            const settingsOk = projectConfigContentEquals(proj, stored);
            const detail = settingsOk
                ? `$(warning) path changed (was: ${stored.rel_path})`
                : `$(warning) path and settings changed (was: ${stored.rel_path})`;
            changedItems.push({
                label: projName,
                description: relPath,
                detail,
                picked: true,
                relPath,
                projName,
            });
        } else {
            // Not yet in sampleProjects.
            newItems.push({
                label: projName,
                description: relPath,
                picked: false,
                relPath,
                projName,
            });
        }
    }

    samePathItems.sort((a, b) => a.label.localeCompare(b.label));
    changedItems.sort((a, b) => a.label.localeCompare(b.label));
    newItems.sort((a, b) => a.label.localeCompare(b.label));

    const items: vscode.QuickPickItem[] = [];
    if (changedItems.length > 0) {
        items.push({ label: "Path or settings changed — review and confirm", kind: vscode.QuickPickItemKind.Separator });
        items.push(...changedItems);
    }
    if (samePathItems.length > 0) {
        items.push({ label: "Already in sampleProjects", kind: vscode.QuickPickItemKind.Separator });
        items.push(...samePathItems);
    }
    if (newItems.length > 0) {
        items.push({ label: "Workspace projects not yet declared", kind: vscode.QuickPickItemKind.Separator });
        items.push(...newItems);
    }

    const picked = await vscode.window.showQuickPick(items, {
        canPickMany: true,
        ignoreFocusOut: true,
        placeHolder: "Select projects to include in sampleProjects (zephyr-ide.json)",
        title: "Modify Sample Projects (zephyr-ide.json)",
    });

    if (!picked) {
        outputInfo("Zephyr IDE Sample Projects", "Modify cancelled");
        return undefined;
    }

    // Save the full ProjectConfig for each selected project so future runs can
    // detect settings changes (not just path changes).
    const selectedProjects = (picked as Item[])
        .filter(i => i.kind !== vscode.QuickPickItemKind.Separator)
        .map(i => wsConfig.projects[i.projName])
        .filter((p): p is ProjectConfig => p !== undefined);

    await setZephyrIdeSampleProjects(wsConfig, selectedProjects);
    outputInfo("Zephyr IDE Sample Projects", `Saved ${selectedProjects.length} sample project(s) to zephyr-ide.json`);
    return selectedProjects;
}

// ---------------------------------------------------------------------------
// Workspace setup hook
// ---------------------------------------------------------------------------

/**
 * Called at the end of the workspace setup flow to install any toolchains and
 * blobs declared in zephyr-ide.json. Failures are logged but don't fail the
 * overall setup — the user can re-run via the command palette.
 */
export async function installZephyrIdeRequirements(
    wsConfig: WorkspaceConfig,
    globalConfig: GlobalConfig,
    context: vscode.ExtensionContext,
): Promise<void> {
    try {
        if (getZephyrIdeToolchains(wsConfig).length > 0) {
            await installZephyrIdeToolchains(wsConfig, globalConfig, context, true, true);
        }
    } catch (error) {
        outputError("Zephyr IDE Toolchains", `Auto-install of declared toolchains failed: ${error}`);
    }
    try {
        if (getZephyrIdeBlobs(wsConfig).length > 0) {
            await installZephyrIdeBlobs(wsConfig, context, true);
        }
    } catch (error) {
        outputError("Zephyr IDE Blobs", `Auto-install of declared blobs failed: ${error}`);
    }
}
