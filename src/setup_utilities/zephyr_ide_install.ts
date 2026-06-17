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
    getZephyrIdePipPackages,
    setZephyrIdePipPackages,
    getZephyrIdePipRequirements,
    setZephyrIdePipRequirements,
    getZephyrIdeCommands,
    setZephyrIdeCommands,
    ZephyrIdeCommands,
} from "./zephyr_ide_json";
import { executeShellCommandInPythonEnv, executeTaskHelper, executeTaskHelperInPythonEnv, getPlatformNameAsync } from "../utilities/utils";
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
            async (progress) => installSDK(targetVersion, declared, (msg) => progress.report({ message: msg }), context?.extensionPath),
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
 * Describes a west blob module and whether its blobs have already been fetched.
 */
export interface BlobModuleInfo {
    moduleName: string;
    isFetched: boolean;
    /** The module path (populated from `west blobs list` when available). */
    path?: string;
}

/**
 * Discover west modules that ship binary blobs, along with their fetch status.
 * Uses `west blobs list -f "{module}\t{status}\t{path}"` to detect whether each
 * blob module has already been fetched.
 *
 * Best-effort: returns an empty array if west isn't available or no modules
 * declare blobs. Uses activeSetupState directly to avoid the missing-environment
 * warning that getSetupState() would surface.
 */
export async function listModulesWithBlobs(wsConfig: WorkspaceConfig, _context: vscode.ExtensionContext): Promise<BlobModuleInfo[]> {
    const setupState = wsConfig.activeSetupState;
    if (!setupState) { return []; }

    try {
        // Format: {module}\t{status}\t{path} where status is usually "Fetched" or empty
        // for modules that haven't been fetched yet.
        const res = await executeShellCommandInPythonEnv(
            `west blobs list -f "{module}\t{status}\t{path}"`,
            setupState.setupPath,
            setupState,
            false,
        );
        if (!res.stdout) { return []; }
        const seen = new Set<string>();
        const out: BlobModuleInfo[] = [];
        for (const line of res.stdout.split(/\r?\n/)) {
            const [moduleName, rawStatus = "", blobPath] = line.trim().split("\t");
            if (!moduleName || seen.has(moduleName)) { continue; }
            seen.add(moduleName);
            const status = rawStatus.toLowerCase();
            const isFetched = status === "fetched" || status === "y";
            out.push({ moduleName, isFetched, path: blobPath || undefined });
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
        if (seen.has(m.moduleName)) { continue; }
        seen.add(m.moduleName);
        installed.push(m.moduleName);
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
// Pip Packages
// ---------------------------------------------------------------------------

/**
 * Package specifiers accepted for direct insertion into `pip install <specs...>`.
 *
 * This intentionally rejects whitespace and shell metacharacters because
 * `.vscode/zephyr-ide.json` can be edited by contributors and must not be able
 * to inject arbitrary shell content.
 */
const VALID_PIP_SPEC = /^(?!-)[A-Za-z0-9_.\-\[\],<>=!~]+$/;

function parsePipPackageInput(value: string): string[] {
    if (!value.trim()) { return []; }
    const parts = value
        .split(/[\r\n,\s]+/)
        .map(v => v.trim())
        .filter(v => v.length > 0);
    return Array.from(new Set(parts));
}

/** Open the modify-pip-packages input and persist the result. */
export async function modifyZephyrIdePipPackagesInteractive(wsConfig: WorkspaceConfig): Promise<string[] | undefined> {
    if (!wsConfig.rootPath) {
        notifyError("Zephyr IDE Pip Packages", "No active workspace folder.");
        return undefined;
    }

    const current = getZephyrIdePipPackages(wsConfig);
    const value = await vscode.window.showInputBox({
        title: "Modify Pip Packages (zephyr-ide.json)",
        prompt: "Enter package specifiers separated by spaces, commas, or new lines.",
        placeHolder: "west pyelftools==0.31 cryptography>=42",
        value: current.join(" "),
        ignoreFocusOut: true,
    });

    if (value === undefined) {
        outputInfo("Zephyr IDE Pip Packages", "Modify cancelled");
        return undefined;
    }

    const packages = parsePipPackageInput(value);
    const invalid = packages.filter(p => !VALID_PIP_SPEC.test(p));
    if (invalid.length > 0) {
        notifyError(
            "Zephyr IDE Pip Packages",
            `Invalid package specifier(s): ${invalid.join(", ")}. Allowed pattern: ${VALID_PIP_SPEC.source}`,
        );
        return undefined;
    }

    await setZephyrIdePipPackages(wsConfig, packages);
    outputInfo("Zephyr IDE Pip Packages", `Saved ${packages.length} pip package(s) to zephyr-ide.json`);
    return packages;
}

/**
 * Install every pip package declared in zephyr-ide.json via `pip install ...`.
 */
export async function installZephyrIdePipPackages(
    wsConfig: WorkspaceConfig,
    context: vscode.ExtensionContext,
    silentIfEmpty = false,
): Promise<boolean> {
    const declared = getZephyrIdePipPackages(wsConfig);
    if (declared.length === 0) {
        if (!silentIfEmpty) {
            void vscode.window.showInformationMessage(
                "No pip packages declared in .vscode/zephyr-ide.json. Run 'Modify zephyr-ide.json pip packages' first.",
            );
        }
        return true;
    }

    const invalid = declared.filter(p => !VALID_PIP_SPEC.test(p));
    if (invalid.length > 0) {
        notifyError(
            "Zephyr IDE Pip Packages",
            `Refusing to install invalid package specifier(s): ${invalid.join(", ")}`,
        );
        return false;
    }

    const setupState = await getSetupStateOrNotify(context, wsConfig, "Zephyr IDE Pip Packages");
    if (!setupState) { return false; }

    const command = `pip install ${declared.join(" ")}`;
    outputInfo("Zephyr IDE Pip Packages", `Installing ${declared.length} package(s): ${declared.join(", ")}`);
    const ok = await executeTaskHelperInPythonEnv(
        setupState,
        "Zephyr IDE: Install pip packages",
        command,
        setupState.setupPath,
        true,
    );

    if (!ok) {
        notifyError("Zephyr IDE Pip Packages", "Failed to install one or more pip packages. Check output for details.");
        return false;
    }

    outputInfo("Zephyr IDE Pip Packages", "Installed pip packages declared in zephyr-ide.json.");
    return true;
}

/**
 * Validate a single requirements file path.
 * Paths must be relative, end in `.txt`, contain only safe characters, and
 * must not contain any path traversal (`..`) component.
 */
function isValidRequirementsPath(p: string): boolean {
    if (!p || !p.endsWith(".txt")) { return false; }
    if (!/^[A-Za-z0-9_.\/\-]+$/.test(p)) { return false; }
    return !p.split("/").includes("..");
}

/** Open the modify-pip-requirements input and persist the result. */
export async function modifyZephyrIdePipRequirementsInteractive(wsConfig: WorkspaceConfig): Promise<string[] | undefined> {
    if (!wsConfig.rootPath) {
        notifyError("Zephyr IDE Pip Requirements", "No active workspace folder.");
        return undefined;
    }

    const current = getZephyrIdePipRequirements(wsConfig);
    const value = await vscode.window.showInputBox({
        title: "Modify Pip Requirements Files (zephyr-ide.json)",
        prompt: "Enter relative paths to requirements.txt files, separated by spaces, commas, or new lines.",
        placeHolder: "external/nrf/scripts/requirements.txt scripts/requirements.txt",
        value: current.join(" "),
        ignoreFocusOut: true,
    });

    if (value === undefined) {
        outputInfo("Zephyr IDE Pip Requirements", "Modify cancelled");
        return undefined;
    }

    const paths = parsePipPackageInput(value);
    const invalid = paths.filter(p => !isValidRequirementsPath(p));
    if (invalid.length > 0) {
        notifyError(
            "Zephyr IDE Pip Requirements",
            `Invalid requirements path(s): ${invalid.join(", ")}. Paths must be relative, end in .txt, and contain only alphanumeric characters, dots, slashes, underscores, or hyphens.`,
        );
        return undefined;
    }

    await setZephyrIdePipRequirements(wsConfig, paths);
    outputInfo("Zephyr IDE Pip Requirements", `Saved ${paths.length} requirements path(s) to zephyr-ide.json`);
    return paths;
}

/**
 * Install every requirements file declared in zephyr-ide.json via `pip install -r ...`.
 */
export async function installZephyrIdePipRequirements(
    wsConfig: WorkspaceConfig,
    context: vscode.ExtensionContext,
    silentIfEmpty = false,
): Promise<boolean> {
    const declared = getZephyrIdePipRequirements(wsConfig);
    if (declared.length === 0) {
        if (!silentIfEmpty) {
            void vscode.window.showInformationMessage(
                "No requirements files declared in .vscode/zephyr-ide.json. Run 'Modify zephyr-ide.json pip requirements' first.",
            );
        }
        return true;
    }

    const invalid = declared.filter(p => !isValidRequirementsPath(p));
    if (invalid.length > 0) {
        notifyError(
            "Zephyr IDE Pip Requirements",
            `Refusing to install invalid requirements path(s): ${invalid.join(", ")}`,
        );
        return false;
    }

    const setupState = await getSetupStateOrNotify(context, wsConfig, "Zephyr IDE Pip Requirements");
    if (!setupState) { return false; }

    const reqFlags = declared.map(r => `-r "${path.join(wsConfig.rootPath, r)}"`).join(" ");
    const command = `pip install ${reqFlags}`;
    outputInfo("Zephyr IDE Pip Requirements", `Installing requirements from: ${declared.join(", ")}`);
    const ok = await executeTaskHelperInPythonEnv(
        setupState,
        "Zephyr IDE: Install pip requirements",
        command,
        setupState.setupPath,
        true,
    );

    if (!ok) {
        notifyError("Zephyr IDE Pip Requirements", "Failed to install one or more requirements files. Check output for details.");
        return false;
    }

    outputInfo("Zephyr IDE Pip Requirements", "Installed requirements files declared in zephyr-ide.json.");
    return true;
}

/**
 * Install both pip packages and requirements files declared in zephyr-ide.json
 * in a single command with no additional prompts. Used by the manager panel
 * "Install" button and the workspace setup auto-install flow.
 */
export async function installZephyrIdePipPackagesAndRequirements(
    wsConfig: WorkspaceConfig,
    context: vscode.ExtensionContext,
    silentIfEmpty = false,
): Promise<boolean> {
    const packages = getZephyrIdePipPackages(wsConfig);
    const requirements = getZephyrIdePipRequirements(wsConfig);

    if (packages.length === 0 && requirements.length === 0) {
        if (!silentIfEmpty) {
            void vscode.window.showInformationMessage(
                "No pip packages or requirements files declared in .vscode/zephyr-ide.json.",
            );
        }
        return true;
    }

    const invalidPackages = packages.filter(p => !VALID_PIP_SPEC.test(p));
    if (invalidPackages.length > 0) {
        notifyError(
            "Zephyr IDE Pip Packages",
            `Refusing to install invalid package specifier(s): ${invalidPackages.join(", ")}`,
        );
        return false;
    }

    const invalidRequirements = requirements.filter(p => !isValidRequirementsPath(p));
    if (invalidRequirements.length > 0) {
        notifyError(
            "Zephyr IDE Pip Requirements",
            `Refusing to install invalid requirements path(s): ${invalidRequirements.join(", ")}`,
        );
        return false;
    }

    const setupState = await getSetupStateOrNotify(context, wsConfig, "Zephyr IDE Pip Packages");
    if (!setupState) { return false; }

    const parts: string[] = [];
    if (packages.length > 0) { parts.push(packages.join(" ")); }
    if (requirements.length > 0) {
        parts.push(requirements.map(r => `-r "${path.join(wsConfig.rootPath, r)}"`).join(" "));
    }
    const command = `pip install ${parts.join(" ")}`;

    outputInfo("Zephyr IDE Pip Packages", `Installing packages=[${packages.join(", ")}] requirements=[${requirements.join(", ")}]`);
    const ok = await executeTaskHelperInPythonEnv(
        setupState,
        "Zephyr IDE: Install pip packages and requirements",
        command,
        setupState.setupPath,
        true,
    );

    if (!ok) {
        notifyError("Zephyr IDE Pip Packages", "Failed to install pip packages/requirements. Check output for details.");
        return false;
    }

    outputInfo("Zephyr IDE Pip Packages", "Installed pip packages and requirements declared in zephyr-ide.json.");
    return true;
}
const _onBlobProgress = new vscode.EventEmitter<string>();
export const onBlobProgress: vscode.Event<string> = _onBlobProgress.event;

/**
 * Interactive blob installation: runs `west blobs fetch <module>` for each
 * selected module name, emitting progress events for the SDK panel webview.
 *
 * @returns true if all modules succeeded, false if any failed.
 */
export async function installBlobModulesInteractive(
    wsConfig: WorkspaceConfig,
    context: vscode.ExtensionContext,
    modules: string[],
): Promise<boolean> {
    if (modules.length === 0) {
        return true;
    }

    const setupState = await getSetupStateOrNotify(context, wsConfig, "Zephyr IDE Blobs");
    if (!setupState) { return false; }

    let allOk = true;
    for (const moduleName of modules) {
        if (!VALID_MODULE_NAME.test(moduleName)) {
            outputError("Zephyr IDE Blobs",
                `Refusing to fetch blobs for invalid module name '${moduleName}'. ` +
                `Module names must match ${VALID_MODULE_NAME.source}.`);
            allOk = false;
            continue;
        }
        _onBlobProgress.fire(`Fetching blobs for ${moduleName}...`);
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
        _onBlobProgress.fire(`Fetched blobs for ${modules.length} module(s).`);
        outputInfo("Zephyr IDE Blobs", `Fetched blobs for ${modules.length} module(s).`);
    }
    return allOk;
}

// ---------------------------------------------------------------------------
// Sample Projects
// ---------------------------------------------------------------------------

/**
 * Recursively sort object keys so that JSON.stringify produces a stable,
 * insertion-order-independent result for deep equality comparisons.
 */
function canonicalize(v: unknown): unknown {
    if (Array.isArray(v)) {
        return v.map(canonicalize);
    }
    if (v !== null && typeof v === "object") {
        return Object.fromEntries(
            Object.entries(v as Record<string, unknown>)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([k, val]) => [k, canonicalize(val)])
        );
    }
    return v;
}

/**
 * Compare the configuration-only fields of two ProjectConfig objects
 * (build configs, conf files, and twister configs), ignoring name and rel_path
 * which are handled separately.
 *
 * Object keys are sorted at every nesting level before serialization to avoid
 * false positives from insertion-order differences.
 */
function projectConfigContentEquals(a: ProjectConfig, b: ProjectConfig): boolean {
    const stable = (v: unknown) => JSON.stringify(canonicalize(v));
    return (
        stable(a.buildConfigs) === stable(b.buildConfigs) &&
        stable(a.confFiles) === stable(b.confFiles) &&
        stable(a.twisterConfigs) === stable(b.twisterConfigs)
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
                    detail: "$(warning) settings changed (build configs, conf files, or twister configs)",
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
// Commands
// ---------------------------------------------------------------------------

/**
 * Return the platform-specific command list from the `commands` key of
 * zephyr-ide.json for the current host operating system.
 */
export function getPlatformSpecificCommands(wsConfig: WorkspaceConfig): string[] {
    const commands = getZephyrIdeCommands(wsConfig);
    const plat = process.platform;
    if (plat === "win32") {
        return commands.windows ?? [];
    } else if (plat === "darwin") {
        return commands.mac ?? [];
    } else if (plat === "linux") {
        return commands.linux ?? [];
    }
    return [];
}

type CommandPlatformKey = keyof ZephyrIdeCommands;

function getCommandPlatformLabels(): Array<{ key: CommandPlatformKey; label: string }> {
    return [
        { key: "linux", label: "Linux" },
        { key: "windows", label: "Windows" },
        { key: "mac", label: "macOS" },
    ];
}

function parseCommandList(value: string): string[] {
    return value
        .split(/\r?\n/)
        .map(v => v.trim())
        .filter(v => v.length > 0);
}

/**
 * Interactive editor for the `commands` object in zephyr-ide.json.
 * Shows three sequential input boxes (one per platform) so the user can
 * enter commands as a comma- or newline-separated list.
 */
export async function modifyZephyrIdeCommandsInteractive(wsConfig: WorkspaceConfig): Promise<ZephyrIdeCommands | undefined> {
    if (!wsConfig.rootPath) {
        notifyError("Zephyr IDE Commands", "No active workspace folder.");
        return undefined;
    }

    const current = getZephyrIdeCommands(wsConfig);

    const targetPlatform = await vscode.window.showQuickPick(
        getCommandPlatformLabels().map(p => ({ label: p.label, platform: p.key })),
        {
            ignoreFocusOut: true,
            title: "Manage zephyr-ide.json Commands",
            placeHolder: "Select target OS",
        },
    );
    if (!targetPlatform) {
        outputInfo("Zephyr IDE Commands", "Manage cancelled");
        return undefined;
    }

    const action = await vscode.window.showQuickPick(
        [
            { label: "Add", description: `Add a command for ${targetPlatform.label}`, value: "add" as const },
            { label: "Modify", description: `Modify one command for ${targetPlatform.label}`, value: "modify" as const },
            { label: "Delete", description: `Delete one command for ${targetPlatform.label}`, value: "delete" as const },
        ],
        {
            ignoreFocusOut: true,
            title: `Manage Commands - ${targetPlatform.label}`,
            placeHolder: "Choose action",
        },
    );
    if (!action) {
        outputInfo("Zephyr IDE Commands", "Manage cancelled");
        return undefined;
    }

    const platformKey = targetPlatform.platform;
    const existing = current[platformKey] ?? [];
    const updated: ZephyrIdeCommands = {
        linux: [...(current.linux ?? [])],
        windows: [...(current.windows ?? [])],
        mac: [...(current.mac ?? [])],
    };

    if (action.value === "add") {
        const value = await vscode.window.showInputBox({
            title: `Add Command - ${targetPlatform.label}`,
            prompt: "Enter a single terminal command to add",
            placeHolder: "west --version",
            ignoreFocusOut: true,
        });
        if (value === undefined) {
            outputInfo("Zephyr IDE Commands", "Add cancelled");
            return undefined;
        }

        const parsed = parseCommandList(value);
        if (parsed.length === 0) {
            outputInfo("Zephyr IDE Commands", "No command entered.");
            return current;
        }

        const first = parsed[0];
        const next = [...existing];
        if (!next.includes(first)) {
            next.push(first);
        }
        if (next.length === 0) {
            delete updated[platformKey];
        } else {
            updated[platformKey] = next;
        }
    } else {
        if (existing.length === 0) {
            void vscode.window.showInformationMessage(`No commands configured for ${targetPlatform.label}.`);
            return current;
        }

        const picked = await vscode.window.showQuickPick(
            existing.map(cmd => ({ label: cmd })),
            {
                ignoreFocusOut: true,
                title: `${action.label} Command - ${targetPlatform.label}`,
                placeHolder: `Select a command to ${action.value}`,
            },
        );
        if (!picked) {
            outputInfo("Zephyr IDE Commands", `${action.label} cancelled`);
            return undefined;
        }

        if (action.value === "delete") {
            const next = existing.filter(cmd => cmd !== picked.label);
            if (next.length === 0) {
                delete updated[platformKey];
            } else {
                updated[platformKey] = next;
            }
        } else {
            const replacement = await vscode.window.showInputBox({
                title: `Modify Command - ${targetPlatform.label}`,
                prompt: "Update the selected command",
                value: picked.label,
                placeHolder: "west --version",
                ignoreFocusOut: true,
            });
            if (replacement === undefined) {
                outputInfo("Zephyr IDE Commands", "Modify cancelled");
                return undefined;
            }

            const parsed = parseCommandList(replacement);
            if (parsed.length === 0) {
                void vscode.window.showInformationMessage("Command cannot be empty.");
                return current;
            }

            const next = existing.map(cmd => cmd === picked.label ? parsed[0] : cmd);
            // Remove duplicates while preserving order after modification.
            updated[platformKey] = Array.from(new Set(next));
        }
    }

    await setZephyrIdeCommands(wsConfig, updated);
    const total = (updated.linux?.length ?? 0) + (updated.windows?.length ?? 0) + (updated.mac?.length ?? 0);
    outputInfo("Zephyr IDE Commands", `Saved ${total} command(s) to zephyr-ide.json`);
    return updated;
}

/**
 * Run one command from zephyr-ide.json after explicit user confirmation.
 */
export async function runSingleZephyrIdeCommandInteractive(
    wsConfig: WorkspaceConfig,
    platform: CommandPlatformKey,
    command: string,
): Promise<boolean> {
    const commands = getZephyrIdeCommands(wsConfig);
    const allowed = commands[platform] ?? [];
    const normalized = command.trim();
    if (!normalized || !allowed.includes(normalized)) {
        outputWarning("Zephyr IDE Commands", `Refusing to run undeclared command for ${platform}: ${command}`);
        return false;
    }

    const platformLabel = getCommandPlatformLabels().find(p => p.key === platform)?.label ?? platform;
    const answer = await vscode.window.showWarningMessage(
        `Run this ${platformLabel} command from zephyr-ide.json?\n\n${normalized}`,
        { modal: false },
        "Run Command",
        "Cancel",
    );
    if (answer !== "Run Command") {
        outputInfo("Zephyr IDE Commands", "User cancelled single-command execution.");
        return true;
    }

    outputInfo("Zephyr IDE Commands", `Running (${platformLabel}): ${normalized}`);
    const ok = await executeTaskHelper(
        `Zephyr IDE: Run Command (${platformLabel})`,
        normalized,
        wsConfig.rootPath || undefined,
    );
    if (!ok) {
        outputError("Zephyr IDE Commands", `Command failed: ${normalized}`);
        notifyError("Zephyr IDE Commands", "The command failed. Check the Zephyr IDE output for details.");
    }
    return ok;
}

/**
 * Prompt the user at the end of workspace setup to decide whether to review
 * platform-specific commands from zephyr-ide.json. If they choose to review,
 * show a multiselect quickpick to approve commands, then execute selected
 * commands in order using VS Code's task execution (ShellExecution).
 *
 * Commands are run one at a time in the workspace root, maintaining the order
 * from the JSON file.  Returns true if all selected commands succeeded.
 */
export async function runZephyrIdeCommandsInteractive(
    wsConfig: WorkspaceConfig,
    context: vscode.ExtensionContext,
): Promise<boolean> {
    const platformCmds = getPlatformSpecificCommands(wsConfig);
    if (platformCmds.length === 0) {
        outputInfo("Zephyr IDE Commands", "No commands declared for this platform in zephyr-ide.json.");
        return true;
    }

    const answer = await vscode.window.showInformationMessage(
        "zephyr-ide.json would like to run additional terminal commands. Only run commands you understand and ensure you trust the origin of this workspace.",
        { modal: false },
        "Select Commands",
        "Skip",
    );
    if (answer !== "Select Commands") {
        outputInfo("Zephyr IDE Commands", "User skipped command review.");
        return true;
    }

    const items: vscode.QuickPickItem[] = platformCmds.map(cmd => ({
        label: cmd,
        picked: false,
    }));

    const picked = await vscode.window.showQuickPick(items, {
        canPickMany: true,
        ignoreFocusOut: true,
        placeHolder: "Select commands to approve and run, then press Enter",
        title: "Run zephyr-ide.json Commands (select commands to approve)",
    });

    if (!picked || picked.length === 0) {
        outputInfo("Zephyr IDE Commands", "No commands selected; skipping.");
        return true;
    }

    // Maintain JSON-file order by filtering against the original ordered list.
    const selectedSet = new Set(picked.map(p => p.label));
    const toRun = platformCmds.filter(cmd => selectedSet.has(cmd));
    const confirmRun = await vscode.window.showWarningMessage(
        `Run ${toRun.length} selected command(s) from zephyr-ide.json now?`,
        { modal: true },
        "Run Selected",
        "Cancel",
    );
    if (confirmRun !== "Run Selected") {
        outputInfo("Zephyr IDE Commands", "User cancelled command execution.");
        return true;
    }

    const cwd = wsConfig.rootPath;
    let allOk = true;

    for (const cmd of toRun) {
        outputInfo("Zephyr IDE Commands", `Running: ${cmd}`);
        const ok = await executeTaskHelper(
            `Zephyr IDE: Run Command`,
            cmd,
            cwd || undefined,
        );
        if (!ok) {
            outputError("Zephyr IDE Commands", `Command failed: ${cmd}`);
            allOk = false;
        }
    }

    if (!allOk) {
        notifyError("Zephyr IDE Commands", "One or more commands failed. Check the Zephyr IDE output for details.");
    } else {
        outputInfo("Zephyr IDE Commands", `Ran ${toRun.length} command(s) successfully.`);
    }
    return allOk;
}

// ---------------------------------------------------------------------------
// Workspace setup hook
// ---------------------------------------------------------------------------

/**
 * Called at the end of the workspace setup flow to install any toolchains and
 * blobs declared in zephyr-ide.json. Toolchains and blobs are installed
 * automatically. Pip packages prompt the user for approval before installation.
 */
export async function installZephyrIdeRequirements(
    wsConfig: WorkspaceConfig,
    globalConfig: GlobalConfig,
    context: vscode.ExtensionContext,
): Promise<void> {
    async function ensureSdkInstalledForWorkspaceSetup(): Promise<boolean> {
        try {
            const sdkList = await listAvailableSDKs();
            const hasSdkWithToolchains = sdkList.success
                && sdkList.versions.some(v => (v.installedToolchains?.length ?? 0) > 0);

            if (hasSdkWithToolchains) {
                if (!globalConfig.sdkInstalled) {
                    globalConfig.sdkInstalled = true;
                    globalConfig.sdkVersion = globalConfig.sdkVersion ?? await detectInstalledSDKVersion();
                    await setGlobalState(context, globalConfig);
                }
                return true;
            }

            const declaredToolchains = getZephyrIdeToolchains(wsConfig);
            const bootstrapToolchains = declaredToolchains.length > 0 ? declaredToolchains : ["all"];
            const targetVersion = await resolveTargetSdkVersion(wsConfig) ?? globalConfig.sdkVersion;

            outputInfo(
                "Workspace Setup",
                `No installed SDK detected. Bootstrapping SDK ${targetVersion ?? "(latest)"} with ${bootstrapToolchains.length === 1 && bootstrapToolchains[0] === "all" ? "all toolchains" : `toolchains: ${bootstrapToolchains.join(", ")}`}.`,
            );

            const ok = await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: `Installing Zephyr SDK ${targetVersion ?? "(latest)"}`,
                    cancellable: false,
                },
                async (progress) => installSDK(targetVersion, bootstrapToolchains, (msg) => progress.report({ message: msg }), context.extensionPath),
            );

            if (!ok) {
                notifyError("SDK Install", "Automatic SDK installation failed during workspace setup. Check the Zephyr IDE output for details.");
                return false;
            }

            globalConfig.sdkInstalled = true;
            globalConfig.sdkVersion = targetVersion ?? await detectInstalledSDKVersion();
            await setGlobalState(context, globalConfig);
            return true;
        } catch (error) {
            outputError("SDK Install", `Automatic SDK bootstrap failed: ${error}`);
            return false;
        }
    }

    try {
        if (getZephyrIdeToolchains(wsConfig).length > 0) {
            const ok = await installZephyrIdeToolchains(wsConfig, globalConfig, context, true, true);
            if (!ok) {
                outputWarning("Zephyr IDE Toolchains", "Auto-install of declared toolchains failed during workspace setup.");
            }
        }
    } catch (error) {
        outputError("Zephyr IDE Toolchains", `Auto-install of declared toolchains failed: ${error}`);
    }

    // Ensure the workspace setup flow leaves the user with an installed SDK,
    // even when zephyr-ide.json does not declare explicit toolchains.
    await ensureSdkInstalledForWorkspaceSetup();

    try {
        if (getZephyrIdeBlobs(wsConfig).length > 0) {
            await installZephyrIdeBlobs(wsConfig, context, true);
        }
    } catch (error) {
        outputError("Zephyr IDE Blobs", `Auto-install of declared blobs failed: ${error}`);
    }
    try {
        const packages = getZephyrIdePipPackages(wsConfig);
        const requirements = getZephyrIdePipRequirements(wsConfig);
        if (packages.length > 0 || requirements.length > 0) {
            const parts: string[] = [];
            if (packages.length > 0) {
                parts.push(`${packages.length} pip package(s): ${packages.join(", ")}`);
            }
            if (requirements.length > 0) {
                parts.push(`${requirements.length} requirements file(s): ${requirements.join(", ")}`);
            }
            const answer = await vscode.window.showInformationMessage(
                `zephyr-ide.json declares ${parts.join(" and ")}. Install them now?`,
                { modal: false },
                "Install",
                "Skip",
            );
            if (answer === "Install") {
                await installZephyrIdePipPackagesAndRequirements(wsConfig, context, true);
            } else {
                outputInfo("Zephyr IDE Pip Packages", "User skipped pip packages/requirements installation.");
            }
        }
    } catch (error) {
        outputError("Zephyr IDE Pip Packages", `Pip packages/requirements installation failed: ${error}`);
    }
}
