/*
Copyright 2025-2026 mylonics 
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
import * as path from "upath";
import * as nativePath from "path";
import * as fs from "fs-extra";
import * as https from "https";
import * as http from "http";
import * as crypto from "crypto";
import * as os from "os";
import * as cp from "child_process";

import { WorkspaceConfig, GlobalConfig } from "./types";
import { getToolchainDir } from "./workspace-config";
import { setGlobalState } from "./state-management";
import { outputInfo, outputWarning, outputError, notifyError } from "../utilities/output";
import { sdkVersions, toolchainTargets } from "../defines";
import { SetupProgressTracker } from "./setup-progress";
import { MultiStepInput, InputStep } from "../utilities/multistepQuickPick";
import { compareVersions } from "compare-versions";

/** Event emitter for SDK install progress, mirroring the workspace setup progress pattern. */
const _onSDKProgress = new vscode.EventEmitter<import("./setup-progress").SetupProgressEvent>();
export const onSDKProgress: vscode.Event<import("./setup-progress").SetupProgressEvent> = _onSDKProgress.event;

export interface ParsedSDKVersion {
    version: string;
    path: string;
    installedToolchains: string[];
    availableToolchains: string[];
}

export interface ParsedSDKList {
    success: boolean;
    versions: ParsedSDKVersion[];
    error?: string;
}

interface ResolvedSDKInstallState {
    sdkInstalled: boolean;
    sdkVersion?: string;
}

// ---------------------------------------------------------------------------
// GitHub API types (internal)
// ---------------------------------------------------------------------------

interface GithubRelease {
    tag_name: string;
    assets: GithubAsset[];
    assets_url: string;
}

interface GithubAsset {
    name: string;
    browser_download_url: string;
    size: number;
}

// ---------------------------------------------------------------------------
// Platform helpers
// ---------------------------------------------------------------------------

function getSdkPlatform(): { osname: string; arch: string } {
    const platform = os.platform();
    const machine = os.arch();

    let osname: string;
    if (platform === "win32") {
        osname = "windows";
    } else if (platform === "darwin") {
        osname = "macos";
    } else {
        osname = "linux";
    }

    let arch: string;
    if (machine === "arm64" || (machine as string) === "aarch64") {
        arch = "aarch64";
    } else {
        arch = "x86_64";
    }

    return { osname, arch };
}

function getSdkArchiveName(version: string, osname: string, arch: string): string {
    let ext: string;
    if (compareVersions(version, "0.16.0") >= 0) {
        ext = osname === "windows" ? ".7z" : ".tar.xz";
    } else {
        ext = osname === "windows" ? ".zip" : ".tar.gz";
    }
    return `zephyr-sdk-${version}_${osname}-${arch}_minimal${ext}`;
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function httpsGet(url: string, headers: Record<string, string> = {}): Promise<{ statusCode: number; body: string }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const options = {
            hostname: parsed.hostname,
            path: parsed.pathname + parsed.search,
            headers: { "User-Agent": "zephyr-ide-vscode", ...headers },
        };

        const req = https.get(options, (res) => {
            if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
                const location = res.headers.location;
                if (location) {
                    httpsGet(location, headers).then(resolve, reject);
                    return;
                }
            }
            let body = "";
            res.on("data", (chunk: Buffer) => body += chunk.toString());
            res.on("end", () => resolve({ statusCode: res.statusCode ?? 0, body }));
            res.on("error", reject);
        });
        req.on("error", reject);
    });
}

function downloadFile(
    url: string,
    destPath: string,
    headers: Record<string, string> = {},
    onProgress?: (downloaded: number, total: number) => void
): Promise<void> {
    return new Promise((resolve, reject) => {
        // originHost is used to strip auth headers on cross-origin redirects
        // (GitHub asset URLs redirect to S3/CloudFront CDN).
        const originHost = new URL(url).hostname;

        const follow = (currentUrl: string) => {
            const parsed = new URL(currentUrl);
            const mod: typeof https | typeof http = parsed.protocol === "https:" ? https : http;
            // Strip auth headers when redirected to a different hostname to
            // avoid leaking the GitHub token to third-party CDNs.
            const safeHeaders = parsed.hostname === originHost
                ? { "User-Agent": "zephyr-ide-vscode", ...headers }
                : { "User-Agent": "zephyr-ide-vscode" };
            const options = {
                hostname: parsed.hostname,
                path: parsed.pathname + parsed.search,
                headers: safeHeaders,
            };
            const req = mod.get(options, (res) => {
                if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
                    const location = res.headers.location;
                    if (location) { follow(location); return; }
                }
                if (res.statusCode !== 200) {
                    reject(new Error(`HTTP ${res.statusCode} downloading ${currentUrl}`));
                    return;
                }
                const total = parseInt(res.headers["content-length"] ?? "0", 10);
                let downloaded = 0;
                const out = fs.createWriteStream(destPath);
                res.on("data", (chunk: Buffer) => {
                    downloaded += chunk.length;
                    if (onProgress) { onProgress(downloaded, total); }
                });
                res.pipe(out);
                out.on("finish", () => resolve());
                out.on("error", reject);
                res.on("error", reject);
            });
            req.on("error", reject);
        };
        follow(url);
    });
}

// ---------------------------------------------------------------------------
// GitHub releases
// ---------------------------------------------------------------------------

async function fetchGithubReleases(
    apiUrl: string,
    authHeaders: Record<string, string>
): Promise<GithubRelease[]> {
    const releases: GithubRelease[] = [];
    let page = 1;

    while (true) {
        const url = `${apiUrl}?page=${page}&per_page=100`;
        const res = await httpsGet(url, authHeaders);
        if (res.statusCode !== 200) {
            throw new Error(`GitHub API error ${res.statusCode}: ${res.body.slice(0, 200)}`);
        }
        const data = JSON.parse(res.body) as GithubRelease[];
        if (!data || data.length === 0) { break; }
        releases.push(...data);
        if (data.length < 100) { break; }
        page++;
    }

    return releases;
}

async function fetchFullReleaseAssets(
    release: GithubRelease,
    authHeaders: Record<string, string>
): Promise<GithubAsset[]> {
    const embedded = release.assets ?? [];
    // If fewer than 100 assets, we got them all in the releases listing
    if (embedded.length < 100) { return embedded; }

    // Paginate through /releases/<id>/assets
    const assetsUrl = release.assets_url;
    if (!assetsUrl) { return embedded; }

    const all: GithubAsset[] = [];
    let page = 1;

    while (true) {
        const url = `${assetsUrl}?page=${page}&per_page=100`;
        const res = await httpsGet(url, authHeaders);
        if (res.statusCode !== 200) {
            outputWarning("SDK Install", `Could not paginate assets for ${release.tag_name} (HTTP ${res.statusCode}), using embedded list`);
            return embedded;
        }
        const data = JSON.parse(res.body) as GithubAsset[];
        if (!data || data.length === 0) { break; }
        all.push(...data);
        if (data.length < 100) { break; }
        page++;
    }

    return all.length > 0 ? all : embedded;
}

// ---------------------------------------------------------------------------
// Archive extraction
// ---------------------------------------------------------------------------

function runProcessSync(
    cmd: string,
    args: string[],
    cwd: string,
    env?: NodeJS.ProcessEnv
): Promise<{ code: number; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
        const isWindows = os.platform() === "win32";

        // If 7-Zip is installed, add it to PATH as an optional fallback for
        // platforms/commands that explicitly request it.
        let effectiveEnv = env ?? { ...process.env };
        if (isWindows) {
            const sevenZipDir = "C:\\Program Files\\7-Zip";
            const currentPath = (effectiveEnv["PATH"] ?? effectiveEnv["Path"] ?? "") as string;
            if (fs.existsSync(sevenZipDir) && !currentPath.toLowerCase().includes(sevenZipDir.toLowerCase())) {
                effectiveEnv = { ...effectiveEnv, Path: `${sevenZipDir};${currentPath}` };
            }
        }

        const proc = cp.spawn(cmd, args, {
            cwd,
            env: effectiveEnv,
            shell: false,
            stdio: ["ignore", "pipe", "pipe"],
        });

        let stdout = "";
        let stderr = "";
        proc.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
        proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
        proc.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
        proc.on("error", (err) => resolve({ code: 1, stdout, stderr: stderr + String(err) }));
    });
}

async function extractArchive(archivePath: string, outDir: string): Promise<void> {
    outputInfo("SDK Install", `Extracting ${nativePath.basename(archivePath)}...`);

    // Try tar first — Windows 11's built-in bsdtar (libarchive) supports
    // .tar.xz, .tar.gz, .zip, and .7z. On Linux/macOS tar handles everything.
    const tarResult = await runProcessSync("tar", ["-xf", archivePath, "-C", outDir], outDir);
    if (tarResult.code === 0) {
        return;
    }

    outputInfo("SDK Install", `tar failed (exit ${tarResult.code}), trying 7z fallback...`);

    // Fall back to 7-Zip if installed (older Windows or tar unavailable)
    const ext = archivePath.toLowerCase();
    if (ext.endsWith(".7z") || ext.endsWith(".zip")) {
        const sevenZResult = await runProcessSync("7z", ["x", archivePath, `-o${outDir}`, "-y"], outDir);
        if (sevenZResult.code === 0) {
            return;
        }
        throw new Error(
            `Archive extraction failed.\ntar (exit ${tarResult.code}): ${tarResult.stderr || tarResult.stdout}\n7z (exit ${sevenZResult.code}): ${sevenZResult.stderr || sevenZResult.stdout}`
        );
    }

    throw new Error(`Archive extraction failed (exit ${tarResult.code}):\n${tarResult.stderr || tarResult.stdout}`);
}

// ---------------------------------------------------------------------------
// SDK setup script
// ---------------------------------------------------------------------------

async function runSdkSetup(
    sdkDir: string,
    toolchains: string[],
    onProgress?: (msg: string) => void
): Promise<void> {
    const isWindows = os.platform() === "win32";
    const setupScript = nativePath.join(sdkDir, isWindows ? "setup.cmd" : "setup.sh");

    if (!(await fs.pathExists(setupScript))) {
        outputWarning("SDK Setup", `Setup script not found at ${setupScript}; skipping CMake registration`);
        return;
    }

    const sep = isWindows ? "/" : "-";
    const runSetup = async (extraArgs: string[]): Promise<void> => {
        let cmd: string;
        let args: string[];
        if (isWindows) {
            cmd = "cmd.exe";
            args = ["/c", setupScript, ...extraArgs];
        } else {
            cmd = "bash";
            args = [setupScript, ...extraArgs];
        }
        outputInfo("SDK Setup", `Running: ${cmd} ${args.join(" ")}`);
        const result = await runProcessSync(cmd, args, sdkDir);
        if (result.code !== 0) {
            throw new Error(`Setup script failed (exit ${result.code}):\n${result.stderr || result.stdout}`);
        }
    };

    // Step 1: register CMake packages
    onProgress?.("Registering SDK with CMake...");
    await runSetup([`${sep}c`]);

    // Step 2: install toolchains (only if requested)
    if (toolchains.length > 0) {
        if (toolchains.includes("all")) {
            onProgress?.("Installing all toolchains...");
            await runSetup([`${sep}t`, "all"]);
        } else {
            const tcArgs: string[] = [];
            for (const tc of toolchains) {
                tcArgs.push(`${sep}t`, tc);
            }
            onProgress?.(`Installing toolchains: ${toolchains.join(", ")}...`);
            await runSetup(tcArgs);
        }
    }
}

// ---------------------------------------------------------------------------
// SHA-256 verification
// ---------------------------------------------------------------------------

async function computeSha256(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash("sha256");
        const stream = fs.createReadStream(filePath);
        stream.on("data", (chunk: Buffer) => hash.update(chunk));
        stream.on("end", () => resolve(hash.digest("hex")));
        stream.on("error", reject);
    });
}

function parseSha256File(content: string, filename: string): string | undefined {
    for (const line of content.split("\n")) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 2 && parts[1] === filename) {
            return parts[0];
        }
    }
    return undefined;
}

// ---------------------------------------------------------------------------
// Installed SDK filesystem scan
// ---------------------------------------------------------------------------

/**
 * Scans the toolchains directory and returns structured information about every
 * installed SDK.  No subprocess calls — pure filesystem.
 */
export async function listAvailableSDKs(): Promise<ParsedSDKList> {
    try {
        const toolchainsDir = getToolchainDir();
        if (!(await fs.pathExists(toolchainsDir))) {
            return { success: true, versions: [] };
        }

        const entries = await fs.readdir(toolchainsDir);
        const sdkDirs = entries.filter(e => e.startsWith("zephyr-sdk-"));
        const versions: ParsedSDKVersion[] = [];

        for (const dir of sdkDirs) {
            const sdkPath = path.join(toolchainsDir, dir);
            const versionFile = path.join(sdkPath, "sdk_version");
            if (!(await fs.pathExists(versionFile))) { continue; }

            const version = (await fs.readFile(versionFile, "utf-8")).trim();

            // Detect installed toolchains.
            // SDK 0.x: toolchain dirs are at the SDK root (<sdk>/<tc>/bin/<tc>-gcc)
            // SDK 1.x: toolchain dirs live under gnu/ (<sdk>/gnu/<tc>/bin/<tc>-gcc)
            const gccSuffix = os.platform() === "win32" ? "-gcc.exe" : "-gcc";
            const installed: string[] = [];
            const searchRoots = [sdkPath];
            const gnuDir = path.join(sdkPath, "gnu");
            if (await fs.pathExists(gnuDir)) { searchRoots.push(gnuDir); }

            for (const root of searchRoots) {
                let dirEntries: string[];
                try { dirEntries = await fs.readdir(root); } catch { continue; }
                for (const tc of dirEntries) {
                    const gccBin = path.join(root, tc, "bin", tc + gccSuffix);
                    if (await fs.pathExists(gccBin) && !installed.includes(tc)) {
                        installed.push(tc);
                    }
                }
            }

            // Read available toolchains from the manifest bundled with the SDK archive.
            // SDK 1.x uses sdk_gnu_toolchains; SDK 0.x uses sdk_toolchains.
            const available: string[] = [];
            for (const manifestName of ["sdk_gnu_toolchains", "sdk_toolchains"]) {
                const manifestPath = path.join(sdkPath, manifestName);
                if (await fs.pathExists(manifestPath)) {
                    const lines = (await fs.readFile(manifestPath, "utf-8"))
                        .split("\n").map(l => l.trim()).filter(l => l.length > 0);
                    available.push(...lines.filter(tc => !installed.includes(tc)));
                    break;
                }
            }

            versions.push({ version, path: sdkPath, installedToolchains: installed, availableToolchains: available });
        }

        return { success: true, versions };
    } catch (error) {
        return { success: false, versions: [], error: `Error listing SDKs: ${error}` };
    }
}

// ---------------------------------------------------------------------------
// SDK version detection helpers
// ---------------------------------------------------------------------------

/**
 * Reads SDK_VERSION from a Zephyr source tree to auto-detect which SDK to install.
 */
export async function detectSDKVersionFromZephyrDir(zephyrDir: string): Promise<string | undefined> {
    try {
        const sdkVersionFile = path.join(zephyrDir, "SDK_VERSION");
        if (await fs.pathExists(sdkVersionFile)) {
            return (await fs.readFile(sdkVersionFile, "utf-8")).trim();
        }
    } catch { /* ignore */ }
    return undefined;
}

/**
 * Detects the newest installed SDK version from the toolchains directory.
 * Exported so workspace-setup flows can use it to auto-heal the sdkInstalled flag.
 */
export async function detectInstalledSDKVersion(): Promise<string | undefined> {
    try {
        const toolchainsDir = getToolchainDir();
        if (!(await fs.pathExists(toolchainsDir))) { return undefined; }
        const entries = await fs.readdir(toolchainsDir);
        const sdkDirs = entries.filter(e => e.startsWith("zephyr-sdk-"));
        if (sdkDirs.length === 0) { return undefined; }
        const versions = sdkDirs
            .map(d => d.replace("zephyr-sdk-", ""))
            .sort((a, b) => compareVersions(b, a));
        return versions[0];
    } catch (error) {
        outputError("SDK Install", `Error detecting installed SDK version: ${error}`);
    }
    return undefined;
}

function getNewestSDKVersion(versions: ParsedSDKVersion[]): string | undefined {
    const ordered = versions
        .map(v => v.version)
        .filter((version): version is string => !!version)
        .sort((a, b) => compareVersions(b, a));
    return ordered[0];
}

function resolveSDKInstallState(sdkList: ParsedSDKList): ResolvedSDKInstallState | undefined {
    if (!sdkList.success) { return undefined; }

    const installedVersions = sdkList.versions
        .filter(v => (v.installedToolchains?.length ?? 0) > 0);
    const sdkVersion = getNewestSDKVersion(installedVersions) ?? getNewestSDKVersion(sdkList.versions);

    return {
        sdkInstalled: installedVersions.length > 0,
        sdkVersion,
    };
}

/**
 * Refreshes the persisted SDK availability state from the filesystem scan.
 *
 * An SDK counts as installed only when at least one toolchain is present.
 * When only the base SDK directory exists, `sdkInstalled` remains false but
 * the discovered version is still retained as a fallback for follow-up
 * toolchain installs.
 */
export async function syncSDKInstallState(
    globalConfig: GlobalConfig,
    context?: vscode.ExtensionContext,
    sdkList?: ParsedSDKList,
): Promise<ResolvedSDKInstallState & { changed: boolean }> {
    const resolved = resolveSDKInstallState(sdkList ?? await listAvailableSDKs());
    if (!resolved) {
        return {
            sdkInstalled: globalConfig.sdkInstalled ?? false,
            sdkVersion: globalConfig.sdkVersion,
            changed: false,
        };
    }

    const nextInstalled = resolved.sdkInstalled;
    const nextVersion = resolved.sdkVersion;
    const changed = (globalConfig.sdkInstalled ?? false) !== nextInstalled
        || globalConfig.sdkVersion !== nextVersion;

    globalConfig.sdkInstalled = nextInstalled;
    globalConfig.sdkVersion = nextVersion;

    if (changed && context) {
        await setGlobalState(context, globalConfig);
    }

    return { ...resolved, changed };
}

// ---------------------------------------------------------------------------
// Core SDK install — pure TypeScript, no west/Python required
// ---------------------------------------------------------------------------

const SDK_GITHUB_API = "https://api.github.com/repos/zephyrproject-rtos/sdk-ng/releases";
const MIN_SUPPORTED_VERSION = "0.14.1";

/**
 * Downloads and installs the Zephyr SDK minimal archive then runs the SDK's
 * own setup script to register CMake packages and install the requested toolchains.
 *
 * No Python / west / venv required — uses the GitHub REST API and system
 * tar / 7z for extraction, both of which are installed as host tools.
 *
 * @param sdkVersion  Explicit semver string, or undefined to install "latest".
 * @param toolchains  ["all"] to install all toolchains, or specific names.
 * @param onProgress  Optional callback for progress messages (forwarded to the VS Code notification).
 */
export async function installSDK(
    sdkVersion: string | undefined,
    toolchains: string[],
    onProgress?: (msg: string) => void
): Promise<boolean> {
    try {
        const toolchainsDir = getToolchainDir();
        const { osname, arch } = getSdkPlatform();
        const ghToken = process.env.GITHUB_TOKEN;
        const authHeaders: Record<string, string> = ghToken
            ? { Authorization: `Bearer ${ghToken}` }
            : {};

        if (ghToken) { outputInfo("SDK Install", "Using GITHUB_TOKEN for authenticated GitHub API access"); }

        // ------------------------------------------------------------------
        // 1. Resolve the target release
        // ------------------------------------------------------------------
        onProgress?.("Fetching Zephyr SDK release list...");
        const releases = await fetchGithubReleases(SDK_GITHUB_API, authHeaders);
        const semverReleases = releases.filter(r => {
            const v = r.tag_name.replace(/^v/, "");
            return /^\d+\.\d+\.\d+/.test(v);
        });

        let version: string;
        if (sdkVersion) {
            version = sdkVersion;
        } else {
            // "latest" — pick the highest semver tag
            version = semverReleases
                .map(r => r.tag_name.replace(/^v/, ""))
                .sort((a, b) => compareVersions(b, a))[0];
            outputInfo("SDK Install", `Resolved "latest" to SDK ${version}`);
        }

        if (compareVersions(version, MIN_SUPPORTED_VERSION) < 0) {
            outputError("SDK Install", `SDK ${version} is older than minimum supported version ${MIN_SUPPORTED_VERSION}`);
            return false;
        }

        const targetRelease = semverReleases.find(r => r.tag_name === `v${version}`);
        if (!targetRelease) {
            outputError("SDK Install", `SDK version ${version} not found in GitHub releases`);
            return false;
        }

        // ------------------------------------------------------------------
        // 2. Fetch all assets (SDK 1.x has > 100 assets)
        // ------------------------------------------------------------------
        onProgress?.("Fetching SDK asset list...");
        const assets = await fetchFullReleaseAssets(targetRelease, authHeaders);

        // ------------------------------------------------------------------
        // 3. Check if SDK base is already installed; skip download if so
        // ------------------------------------------------------------------
        const sdkDir = path.join(toolchainsDir, `zephyr-sdk-${version}`);
        const versionFile = path.join(sdkDir, "sdk_version");
        const sdkBaseExists = await fs.pathExists(versionFile);

        if (!sdkBaseExists) {
            // ----------------------------------------------------------------
            // 4. Locate archive and SHA-256 URLs
            // ----------------------------------------------------------------
            const archiveName = getSdkArchiveName(version, osname, arch);
            const archiveAsset = assets.find(a => a.name === archiveName);
            const sha256Asset = assets.find(a => a.name === "sha256.sum");

            if (!archiveAsset) {
                outputError("SDK Install", `Could not find asset "${archiveName}" in SDK ${version} release`);
                return false;
            }

            // ----------------------------------------------------------------
            // 5. Download SHA-256 manifest
            // ----------------------------------------------------------------
            onProgress?.("Fetching checksum file...");
            outputInfo("SDK Install", `Fetching sha256.sum for SDK ${version}...`);
            let expectedHash: string | undefined;
            if (sha256Asset) {
                const sha256Res = await httpsGet(sha256Asset.browser_download_url, authHeaders);
                if (sha256Res.statusCode === 200) {
                    expectedHash = parseSha256File(sha256Res.body, archiveName);
                } else {
                    outputWarning("SDK Install", `Could not download sha256.sum (HTTP ${sha256Res.statusCode}); skipping verification`);
                }
            }

            // ----------------------------------------------------------------
            // 6. Download the minimal archive
            // ----------------------------------------------------------------
            await fs.ensureDir(toolchainsDir);

            // Use a temp directory inside the toolchains dir so the final move
            // stays on the same filesystem and is atomic.
            const tmpDir = nativePath.join(toolchainsDir, `.sdk-tmp-${Date.now()}`);
            await fs.ensureDir(tmpDir);

            try {
                const archivePath = nativePath.join(tmpDir, archiveName);
                const archiveSize = archiveAsset.size;
                let lastReportedPct = -1;

                outputInfo("SDK Install", `Downloading ${archiveName} (${Math.round(archiveSize / 1024 / 1024)} MB)...`);
                await downloadFile(
                    archiveAsset.browser_download_url,
                    archivePath,
                    authHeaders,
                    (downloaded, total) => {
                        const pct = total > 0 ? Math.floor((downloaded / total) * 100) : 0;
                        if (pct !== lastReportedPct && pct % 5 === 0) {
                            lastReportedPct = pct;
                            onProgress?.(`Downloading SDK ${version}... ${pct}%`);
                        }
                    }
                );
                outputInfo("SDK Install", `Downloaded ${archiveName}`);

                // ----------------------------------------------------------------
                // 7. Verify SHA-256
                // ----------------------------------------------------------------
                if (expectedHash) {
                    onProgress?.("Verifying checksum...");
                    const actualHash = await computeSha256(archivePath);
                    if (actualHash !== expectedHash) {
                        throw new Error(`SHA-256 mismatch for ${archiveName}: expected ${expectedHash}, got ${actualHash}`);
                    }
                    outputInfo("SDK Install", "SHA-256 verification passed");
                }

                // ----------------------------------------------------------------
                // 8. Extract archive
                // ----------------------------------------------------------------
                onProgress?.("Extracting SDK archive...");
                await extractArchive(archivePath, tmpDir);

                // Find the single extracted directory (zephyr-sdk-x.y.z)
                const allEntries = await fs.readdir(tmpDir);
                const extracted: string[] = [];
                for (const e of allEntries) {
                    try {
                        const stat = await fs.stat(nativePath.join(tmpDir, e));
                        if (stat.isDirectory()) { extracted.push(e); }
                    } catch { /* skip */ }
                }
                if (extracted.length !== 1) {
                    throw new Error(`Unexpected archive layout: found ${extracted.length} directories in extracted archive`);
                }

                // ----------------------------------------------------------------
                // 9. Move to final destination
                // ----------------------------------------------------------------
                onProgress?.("Moving SDK to install directory...");
                const extractedDir = nativePath.join(tmpDir, extracted[0]);
                if (await fs.pathExists(sdkDir)) {
                    await fs.remove(sdkDir);
                }
                await fs.move(extractedDir, sdkDir);
                outputInfo("SDK Install", `SDK extracted to: ${sdkDir}`);
            } finally {
                // Clean up temp dir regardless of success/failure
                await fs.remove(tmpDir).catch(() => { /* ignore cleanup errors */ });
            }
        } else {
            outputInfo("SDK Install", `SDK ${version} base already installed at ${sdkDir}, skipping download`);
        }

        // ------------------------------------------------------------------
        // 10. Run setup script (CMake registration + toolchain installation)
        // ------------------------------------------------------------------
        await runSdkSetup(sdkDir, toolchains, onProgress);

        outputInfo("SDK Install", `SDK ${version} installation complete`);
        return true;
    } catch (error) {
        outputError("SDK Install", `Error installing SDK: ${error}`);
        return false;
    }
}

// ---------------------------------------------------------------------------
// Interactive QuickPick flows
// ---------------------------------------------------------------------------

async function selectSDKVersionAndToolchains(zephyrDir?: string): Promise<{ sdkVersion: string | undefined; toolchains: string[] } | null> {
    const title = "Install Zephyr SDK";

    type State = {
        sdkVersion?: string | undefined;
        sdkVersionChosen?: boolean;
        toolchains?: string[];
    };
    const state: State = {};

    async function pickSDKVersion(input: MultiStepInput): Promise<InputStep | void> {
        while (true) {
            const selected = await input.showQuickPick({
                title,
                step: 1,
                totalSteps: 2,
                placeholder: "Select SDK version to install",
                ignoreFocusOut: true,
                items: sdkVersions,
            });

            if (selected.label === "automatic") {
                const detectedVersion = zephyrDir
                    ? await detectSDKVersionFromZephyrDir(zephyrDir)
                    : undefined;
                if (!detectedVersion) {
                    notifyError("SDK Install",
                        "Could not auto-detect SDK version from workspace. Please select a specific version."
                    );
                    continue;
                }
                void vscode.window.showInformationMessage(`Auto-detected SDK version: ${detectedVersion}`);
                state.sdkVersion = detectedVersion;
            } else if (selected.label === "latest") {
                state.sdkVersion = undefined;
            } else {
                state.sdkVersion = selected.label;
            }
            break;
        }
        state.sdkVersionChosen = true;
        return (input: MultiStepInput) => pickInstallChoice(input);
    }

    async function pickInstallChoice(input: MultiStepInput) {
        const installAllOption = { label: "Install All Toolchains", description: "Install all available toolchains" };
        const selectSpecificOption = { label: "Select Specific Toolchains", description: "Choose which toolchains to install" };

        const selected = await input.showQuickPick({
            title,
            step: 2,
            totalSteps: 3,
            placeholder: "Choose toolchain installation option",
            ignoreFocusOut: true,
            items: [installAllOption, selectSpecificOption],
        });

        if (selected.label === "Install All Toolchains") {
            state.toolchains = ["all"];
            return;
        }
        return (input: MultiStepInput) => pickSpecificToolchains(input);
    }

    async function pickSpecificToolchains(input: MultiStepInput) {
        const selected = await input.showQuickPickMany({
            title,
            step: 3,
            totalSteps: 3,
            placeholder: "Select toolchains to install (toggle then press Enter)",
            ignoreFocusOut: true,
            items: toolchainTargets.filter(item => item.kind !== vscode.QuickPickItemKind.Separator),
        });

        if (!selected || !Array.isArray(selected) || selected.length === 0) { return; }
        state.toolchains = (selected as readonly vscode.QuickPickItem[]).map(item => item.label);
    }

    await MultiStepInput.run(input => pickSDKVersion(input));

    if (!state.sdkVersionChosen || !state.toolchains || state.toolchains.length === 0) {
        return null;
    }
    return { sdkVersion: state.sdkVersion, toolchains: state.toolchains };
}

async function selectToolchainsWithoutVersionStep(titlePrefix: string): Promise<string[] | null> {
    const installAllOption = { label: "Install All Toolchains", description: "Install all available toolchains for this version" };
    const selectSpecificOption = { label: "Select Specific Toolchains", description: "Choose which toolchains to install" };

    let toolchains: string[] | null = null;

    await MultiStepInput.run(async (input: MultiStepInput) => {
        const choice = await input.showQuickPick({
            title: titlePrefix,
            step: 1,
            totalSteps: 2,
            placeholder: "Choose toolchain installation option",
            ignoreFocusOut: true,
            items: [installAllOption, selectSpecificOption],
        });

        if (choice.label === "Install All Toolchains") {
            toolchains = ["all"];
            return;
        }

        return async (inner: MultiStepInput) => {
            const selected = await inner.showQuickPickMany({
                title: titlePrefix,
                step: 2,
                totalSteps: 2,
                placeholder: "Select toolchains to install (toggle then press Enter)",
                ignoreFocusOut: true,
                items: toolchainTargets.filter(item => item.kind !== vscode.QuickPickItemKind.Separator),
            });
            if (selected && Array.isArray(selected) && selected.length > 0) {
                toolchains = (selected as readonly vscode.QuickPickItem[]).map(item => item.label);
            }
        };
    });

    return toolchains;
}

// ---------------------------------------------------------------------------
// Public interactive install entry points
// ---------------------------------------------------------------------------

export async function installSDKInteractive(wsConfig: WorkspaceConfig, globalConfig: GlobalConfig, context?: vscode.ExtensionContext) {
    const tracker = new SetupProgressTracker("SDK Installation", [
        { id: 'version', label: 'Selecting SDK version' },
        { id: 'toolchains', label: 'Selecting toolchains' },
        { id: 'install', label: 'Downloading and installing SDK' },
        { id: 'verify', label: 'Verifying installation' },
    ], _onSDKProgress);

    try {
        outputInfo("SDK Install", "Starting interactive SDK installation...");

        // Derive the Zephyr source dir for auto-detection if a workspace is active
        const zephyrDir = wsConfig.activeSetupState?.zephyrDir;

        tracker.startStep('version');
        const selection = await selectSDKVersionAndToolchains(zephyrDir);
        if (!selection) {
            outputInfo("SDK Install", "SDK version/toolchain selection cancelled");
            tracker.failStep('version', 'Selection cancelled');
            return;
        }
        const sdkVersion = selection.sdkVersion;
        const toolchains = selection.toolchains;
        tracker.completeStep('version', sdkVersion ?? 'latest');

        tracker.startStep('toolchains');
        tracker.completeStep('toolchains', toolchains.includes('all') ? 'All toolchains' : toolchains.join(', '));

        tracker.startStep('install', 'Starting...');
        return await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: "Installing Zephyr SDK", cancellable: false },
            async (progress) => {
                const result = await installSDK(sdkVersion, toolchains, (msg) => {
                    progress.report({ message: msg });
                    tracker.updateStep('install', msg);
                });
                if (result) {
                    tracker.completeStep('install');
                    tracker.startStep('verify', 'Updating global state...');
                    globalConfig.sdkInstalled = true;
                    if (sdkVersion) {
                        globalConfig.sdkVersion = sdkVersion;
                    } else {
                        const detected = await detectInstalledSDKVersion();
                        if (detected) { globalConfig.sdkVersion = detected; }
                    }
                    if (context) { await setGlobalState(context, globalConfig); }
                    tracker.completeStep('verify', `SDK ${globalConfig.sdkVersion || ''} ready`);
                    tracker.complete('Zephyr SDK installed successfully!');
                    void vscode.window.showInformationMessage("Zephyr SDK installed successfully!");
                } else {
                    tracker.failStep('install', 'SDK installation failed');
                    tracker.fail('SDK installation failed. Check the Output panel for details.');
                    notifyError("SDK Install", "Failed to install SDK");
                }
                return result;
            }
        );
    } catch (error) {
        outputError("SDK Install", `SDK installation threw an error: ${error}`);
        tracker.fail(`Error: ${error}`);
        notifyError("SDK Install", `Failed to install SDK: ${error}`);
    }
}

export async function installToolchainsDirect(
    globalConfig: GlobalConfig,
    context: vscode.ExtensionContext | undefined,
    version: string,
    toolchains: string[],
): Promise<boolean> {
    const tracker = new SetupProgressTracker(`SDK ${version} — Install Toolchains`, [
        { id: 'install', label: 'Downloading and installing toolchains' },
        { id: 'verify', label: 'Verifying installation' },
    ], _onSDKProgress);

    try {
        tracker.startStep('install', `Installing ${toolchains.join(', ')}...`);
        const result = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: `Adding toolchains to SDK ${version}`, cancellable: false },
            async (progress) => installSDK(version, toolchains, (msg) => {
                progress.report({ message: msg });
                tracker.updateStep('install', msg);
            })
        );

        if (result) {
            tracker.completeStep('install');
            tracker.startStep('verify', 'Updating global state...');
            globalConfig.sdkInstalled = true;
            globalConfig.sdkVersion = version;
            if (context) { await setGlobalState(context, globalConfig); }
            tracker.completeStep('verify', `SDK ${version} toolchains ready`);
            tracker.complete(`Toolchains added to SDK ${version} successfully!`);
            void vscode.window.showInformationMessage(`Toolchains added to SDK ${version} successfully!`);
        } else {
            tracker.failStep('install', 'Toolchain installation failed');
            tracker.fail('Toolchain installation failed. Check the Output panel for details.');
        }
        return result ?? false;
    } catch (error) {
        outputError("SDK Install", `Toolchain install error: ${error}`);
        tracker.fail(`Error: ${error}`);
        return false;
    }
}

export async function uninstallSDKVersion(
    version: string,
): Promise<{ success: boolean; error?: string }> {
    const toolchainsDir = getToolchainDir();
    const sdkDir = path.join(toolchainsDir, `zephyr-sdk-${version}`);
    try {
        if (!await fs.pathExists(sdkDir)) {
            return { success: false, error: `SDK directory not found: ${sdkDir}` };
        }
        await fs.remove(sdkDir);
        outputInfo("SDK Uninstall", `Removed SDK directory: ${sdkDir}`);
        return { success: true };
    } catch (error) {
        const msg = `Failed to remove SDK ${version}: ${error}`;
        outputError("SDK Uninstall", msg);
        return { success: false, error: msg };
    }
}

export async function uninstallToolchains(
    version: string,
    toolchains: string[],
): Promise<{ removed: string[]; notFound: string[]; errors: string[] }> {
    const toolchainsDir = getToolchainDir();
    const sdkDir = path.join(toolchainsDir, `zephyr-sdk-${version}`);
    const removed: string[] = [];
    const notFound: string[] = [];
    const errors: string[] = [];

    for (const tc of toolchains) {
        // SDK 1.x: toolchains live under gnu/<tc>; SDK 0.x: under <sdk>/<tc>
        const candidates = [
            path.join(sdkDir, "gnu", tc),
            path.join(sdkDir, tc),
        ];
        let tcDir: string | undefined;
        for (const candidate of candidates) {
            if (await fs.pathExists(candidate)) { tcDir = candidate; break; }
        }
        try {
            if (tcDir) {
                await fs.remove(tcDir);
                outputInfo("SDK Uninstall", `Removed toolchain directory: ${tcDir}`);
                removed.push(tc);
            } else {
                outputWarning("SDK Uninstall", `Toolchain directory not found (already removed?): ${tc}`);
                notFound.push(tc);
            }
        } catch (error) {
            const msg = `Failed to remove ${tc}: ${error}`;
            outputError("SDK Uninstall", msg);
            errors.push(msg);
        }
    }

    return { removed, notFound, errors };
}

export async function installSDKToolchainsInteractive(
    wsConfig: WorkspaceConfig,
    globalConfig: GlobalConfig,
    context: vscode.ExtensionContext | undefined,
    prefilledVersion: string,
) {
    outputInfo("SDK Install", `Adding toolchains to SDK ${prefilledVersion}...`);

    const toolchains = await selectToolchainsWithoutVersionStep(`Add Toolchains — SDK ${prefilledVersion}`);
    if (!toolchains || toolchains.length === 0) {
        outputInfo("SDK Install", "Toolchain selection cancelled");
        return;
    }

    const tracker = new SetupProgressTracker(`SDK ${prefilledVersion} Toolchains`, [
        { id: 'install', label: 'Downloading and installing toolchains' },
        { id: 'verify', label: 'Verifying installation' },
    ], _onSDKProgress);

    try {
        tracker.startStep('install', 'Starting download...');
        const result = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: `Adding toolchains to SDK ${prefilledVersion}`, cancellable: false },
            async (progress) => installSDK(prefilledVersion, toolchains, (msg) => {
                progress.report({ message: msg });
                tracker.updateStep('install', msg);
            })
        );

        if (result) {
            tracker.completeStep('install');
            tracker.startStep('verify', 'Updating global state...');
            globalConfig.sdkInstalled = true;
            globalConfig.sdkVersion = prefilledVersion;
            if (context) { await setGlobalState(context, globalConfig); }
            tracker.completeStep('verify', `SDK ${prefilledVersion} toolchains ready`);
            tracker.complete(`Toolchains added to SDK ${prefilledVersion} successfully!`);
            void vscode.window.showInformationMessage(`Toolchains added to SDK ${prefilledVersion} successfully!`);
        } else {
            tracker.failStep('install', 'Toolchain installation failed');
            tracker.fail('Toolchain installation failed. Check the Output panel for details.');
            notifyError("SDK Install", `Failed to add toolchains to SDK ${prefilledVersion}`);
        }
    } catch (error) {
        outputError("SDK Install", `SDK toolchain installation threw an error: ${error}`);
        tracker.fail(`Error: ${error}`);
        notifyError("SDK Install", `Failed to add toolchains: ${error}`);
    }
}
