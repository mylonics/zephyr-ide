/**
 * @author Jared Wolff <jared@circuitdojo.org>
 * @copyright Circuit Dojo LLC
 * @license Apache 2.0
 */

/*
Modifications Copyright 2024 mylonics 
Author Rijesh Augustine

Code based on https://github.com/circuitdojo/zephyr-tools/extension.ts and https://github.com/circuitdojo/zephyr-tools/Download.ts.
Modifications include additional functionality to allow zephyr ide to provide more feedback during the sdk install process, 
the ability to install different versions of sdks from .md5 files and the ability to install nonarm sdks.

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
import * as unzip from "node-stream-zip";
import * as sevenzip from "7zip-bin";
import * as node7zip from "node-7z";
import * as path from 'path';
import * as fs from 'fs-extra';
import * as crypto from 'crypto';
import * as cp from "child_process";
import * as util from "util";
import * as os from "os";

import { compareVersions } from 'compare-versions';

import { HttpClient } from "typed-rest-client/HttpClient";
import { toolsdir, GlobalConfig, WorkspaceConfig, setWorkspaceState, setGlobalState } from "./setup";
import { getShellEnvironment } from "../utilities/utils";
import { toolchainTargets } from "../defines";

export class FileDownload {

    private static downloadsdir: string = "";

    // Set the download target directory
    public static init(dir: string) {
        this.downloadsdir = dir;
    }

    // Exists
    public static async exists(file: string): Promise<string | null> {
        const dest = path.join(this.downloadsdir, file);

        if (await fs.pathExists(dest)) {
            return dest;
        } else {
            return null;
        }
    }

    // Compares file with provided hash
    public static async check(file: string, hash: string): Promise<boolean> {

        const dest = path.join(this.downloadsdir, file);

        // Check if exists first
        if (!await fs.pathExists(dest)) {
            console.log("doesn't exist! " + dest);
            return false;
        }

        // Get file contents 
        const fileBuffer = fs.readFileSync(dest);

        // Create hash
        const hashSum = crypto.createHash('md5');
        hashSum.update(fileBuffer);

        // Get hex representation 
        const hex = hashSum.digest('hex');

        // console.log(`hex ${hex}`);

        if (hex === hash) {
            return true;
        } else {
            return false;
        }

    }

    // Delets files in download
    public static async clean() {
        await fs.remove(this.downloadsdir);
    }

    // Downloads file to filestore
    public static async fetch(url: string): Promise<string> {

        const client = new HttpClient("download");
        const response = await client.get(url);

        // Get file name
        const filename = path.basename(url);

        // Determine dest
        const dest = path.join(this.downloadsdir, filename);

        // Make sure downloadsdir exists
        let exists = await fs.pathExists(this.downloadsdir);
        if (!exists) {
            console.log("downloadsdir not found");
            // Otherwise create home directory
            await fs.mkdirp(this.downloadsdir);
        }

        // Set up file stream
        const file: NodeJS.WritableStream = fs.createWriteStream(dest);

        if (response.message.statusCode !== 200) {
            const err: Error = new Error(`Unexpected HTTP response: ${response.message.statusCode}`);
            // err["httpStatusCode"] = response.message.statusCode;
            throw err;
        }
        return new Promise((resolve, reject) => {
            file.on("error", (err) => reject(err));
            const stream = response.message.pipe(file);
            stream.on("close", () => {
                try { resolve(dest); } catch (err) {
                    reject(err);
                }
            });
        });

    }

}

type CmdEntry = {
    cmd: string;
    usepath: boolean;
};

export type DownloadEntry = {
    name: string;
    url: string;
    md5: string;
    cmd?: CmdEntry[];
    filename: string;
    clearTarget?: boolean;
    targetName: string;
};

export async function processDownload(download: DownloadEntry, output: vscode.OutputChannel, wsConfig: WorkspaceConfig) {
    // Promisified exec
    let exec = util.promisify(cp.exec);

    // Check if it already exists
    let filepath = await FileDownload.exists(download.filename);

    // Download if doesn't exist _or_ hash doesn't match
    if (filepath === null || (await FileDownload.check(download.filename, download.md5)) === false) {
        output.appendLine("[SETUP] downloading " + download.url);
        filepath = await FileDownload.fetch(download.url);

        // Check again
        if ((await FileDownload.check(download.filename, download.md5)) === false) {
            vscode.window.showErrorMessage("Error downloading " + download.filename + ". Checksum mismatch.");
            return false;
        }
    }

    // Get the path to copy the contents to..
    let copytopath = path.join(toolsdir, download.name);

    // Check if copytopath exists and create if not
    if (!(await fs.pathExists(copytopath))) {
        await fs.mkdirp(copytopath);
    }

    // Unpack and place into `$HOME/.zephyr_ide`
    if (download.url.includes(".zip")) {
        // Unzip and copy
        output.appendLine(`[SETUP] unzip ${filepath} to ${copytopath}`);
        const zip = new unzip.async({ file: filepath });
        zip.on("extract", (entry, file) => {
            // Make executable
            fs.chmodSync(file, 0o755);
        });
        await zip.extract(null, copytopath);
        await zip.close();
    } else if (download.url.includes("tar")) {
        // Then untar
        const cmd = `tar -xvf "${filepath}" -C "${copytopath}"`;
        output.appendLine(cmd);
        let res = await exec(cmd, { env: getShellEnvironment(wsConfig) }).then(
            value => {
                output.append(value.stdout);
                return true;
            },
            reason => {
                output.append(reason.stdout);
                output.append(reason.stderr);

                // Error message
                vscode.window.showErrorMessage("Error un-tar of download. Check output for more info.");

                return false;
            }
        );

        // Return if untar was unsuccessful
        if (!res) {
            return false;
        }
    } else if (download.url.includes("7z")) {
        // Unzip and copy
        output.appendLine(`[SETUP] 7z extract ${filepath} to ${copytopath}`);
        const pathTo7zip = sevenzip.path7za;
        const seven = await node7zip.extractFull(filepath, copytopath, {
            $bin: pathTo7zip,
        });
    }

    // Run any commands that are needed..
    for (let entry of download.cmd ?? []) {
        output.appendLine(entry.cmd);

        // Prepend
        let cmd = entry.cmd;
        if (entry.usepath) {
            cmd = path.join(copytopath, entry.cmd ?? "");
        }

        // Run the command
        let res = await exec(cmd, { env: getShellEnvironment(wsConfig) }).then(
            value => {
                output.append(value.stdout);
                return true;
            },
            reason => {
                output.append(reason.stdout);
                output.append(reason.stderr);

                // Error message
                vscode.window.showErrorMessage("Error for sdk command.");

                return false;
            }
        );

        if (!res) {
            return false;
        }
    }

    return true;
}

// Platform
let platform: NodeJS.Platform = os.platform();

// Arch
let arch: string = os.arch();

export function getPlatformName() {
    // Determine what sdk/toolchain to download
    switch (platform) {
        case "darwin":
            return "macos";
        case "linux":
            return "linux";
        case "win32":
            return "windows";
    }
    return;
}

export function getPlatformArch() {
    switch (arch) {
        case "x64":
            return "x86_64";
        case "arm64":
            return "aarch64";
    }
    return;
}

export interface ToolChainEntry {
    version: string,
    basePath: string,
    targetsInstalled: string[];
}

export type ToolChainDictionary = { [name: string]: ToolChainEntry };

export async function pickToolchainTarget(context: vscode.ExtensionContext, globalConfig: GlobalConfig, toolchainVersion?: string) {
    if (toolchainVersion === undefined) {
        let toolchainVersionList = await getToolchainVersionList(context);
        toolchainVersion = toolchainVersionList[0];
    }
    console.log(globalConfig.toolchains);
    let currentToolchain = globalConfig.toolchains[toolchainVersion];
    if (currentToolchain) {
        for (const obj of toolchainTargets) {
            if (currentToolchain.targetsInstalled.includes(obj.label)) {
                obj.description = "installed";
            }
        }
    }

    const toolchainTargetPicks = await vscode.window.showQuickPick(toolchainTargets, { canPickMany: true, ignoreFocusOut: true, title: "Select Toolchain Target Architecture" });
    if (toolchainTargetPicks) {
        return toolchainTargetPicks.map(x => (x.label));
    }
    return;
}

export async function getToolchainVersionList(context: vscode.ExtensionContext) {
    let toolchainVersionList: string[] = [];
    let toolchainMd5Path = context.asAbsolutePath("manifest/sdk_md5");
    let toolchainMd5Files = await vscode.workspace.fs.readDirectory(vscode.Uri.file(toolchainMd5Path));
    for (const [index, [filename, type]] of toolchainMd5Files.entries()) {
        if (path.parse(filename).ext === ".sum") {
            toolchainVersionList.push(path.parse(filename).name);
        }
    }

    return toolchainVersionList.sort(compareVersions).reverse();
}

export async function installSdk(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, globalConfig: GlobalConfig, output: vscode.OutputChannel, installLatest = false, toolchainsToInstall: string[] | undefined, solo = true) {
    // Show setup progress..
    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: "Setting up Zephyr sdk",
            cancellable: false,
        },
        async (progress, token) => {
            output.show();

            progress.report({ increment: 5 });

            // Skip out if not found
            if (getPlatformName() === undefined) {
                vscode.window.showErrorMessage("Unsupported platform for Zephyr IDE!");
                return;
            }
            let exists = await fs.pathExists(toolsdir);
            if (!exists) {
                await fs.mkdirp(toolsdir);
            }

            let toolchainVersionList = await getToolchainVersionList(context);
            let toolchainVersion: string | undefined = toolchainVersionList[0];
            if (!installLatest) {
                // Pick options
                const pickOptions: vscode.QuickPickOptions = {
                    ignoreFocusOut: true,
                    placeHolder: "Which toolchain version would you like to install?",
                };
                toolchainVersion = await vscode.window.showQuickPick(toolchainVersionList, pickOptions);
            }

            // Check if user canceled
            if (toolchainVersion === undefined) {
                vscode.window.showErrorMessage("Zephyr IDE Setup canceled. Toolchain version not specified.");
                return;
            }

            if (toolchainsToInstall === undefined) {
                toolchainsToInstall = await pickToolchainTarget(context, globalConfig, toolchainVersion);
            }

            if (toolchainsToInstall === undefined) {
                vscode.window.showErrorMessage("Zephyr IDE Setup canceled. Toolchain targets not specified");
                return;
            }


            wsConfig.sdkInstalled = false;
            setWorkspaceState(context, wsConfig);

            let selectedToolchainFile = context.asAbsolutePath("manifest/sdk_md5/" + toolchainVersion + ".sum");

            // Set up downloader path
            FileDownload.init(path.join(toolsdir, "downloads"));

            let toolchainFileRawText = fs.readFileSync(selectedToolchainFile, 'utf8');
            let toolchainMinimalDownloadEntry: DownloadEntry | undefined;

            let toolchainTargetDownloadEntries: DownloadEntry[] = [];
            let toolchainTargetFileNames = toolchainsToInstall.map(targetName => ({ name: targetName, fileName: "toolchain_" + getPlatformName() + "-" + getPlatformArch() + "_" + targetName + (targetName.includes("xtensa") ? "_" : "-") + "zephyr-" + (targetName === "arm" ? "eabi" : "elf") }));

            let toolchainBasePath = "toolchains/zephyr-sdk-" + toolchainVersion;
            for (const line of toolchainFileRawText.trim().split('\n')) {
                let s = line.trim().split(/[\s\s]+/g);
                let md5 = s[0];
                let fileName = s[1];
                let parsedFileName = path.parse(fileName);
                if (parsedFileName.ext === ".xz") {
                    parsedFileName = path.parse(parsedFileName.name);
                }

                if (parsedFileName.name === "zephyr-sdk-" + toolchainVersion + "_" + getPlatformName() + "-" + getPlatformArch() + "_minimal") {
                    toolchainMinimalDownloadEntry = {
                        "name": "toolchains",
                        "filename": fileName,
                        "url": "https://github.com/zephyrproject-rtos/sdk-ng/releases/download/v" + toolchainVersion + "/" + fileName,
                        "md5": md5,
                        "clearTarget": true,
                        "targetName": "minimal"
                    };
                    if (getPlatformName() === "macos") {
                        toolchainMinimalDownloadEntry.cmd = toolchainsToInstall.map(targetName => ({
                            "cmd": "zephyr-sdk-" + toolchainVersion + "/setup.sh -t " + targetName + "-zephyr-" + (targetName === "arm" ? "eabi" : "elf"),
                            "usepath": true
                        }));
                    }
                }

                for (const e in toolchainTargetFileNames) {
                    if (toolchainTargetFileNames[e].fileName === parsedFileName.name) {
                        toolchainTargetDownloadEntries.push({
                            "name": toolchainBasePath,
                            "filename": fileName,
                            "url": "https://github.com/zephyrproject-rtos/sdk-ng/releases/download/v" + toolchainVersion + "/" + fileName,
                            "md5": md5,
                            "clearTarget": false,
                            "targetName": toolchainTargetFileNames[e].name
                        });
                        break;
                    }
                }
            }


            if (toolchainTargetDownloadEntries.length === 0 || toolchainMinimalDownloadEntry === undefined) {
                vscode.window.showErrorMessage("Error finding appropriate toolchain file");
                return;
            }

            // Output indicating toolchain install
            output.appendLine(`[SETUP] Installing zephyr-sdk-${toolchainVersion} toolchain...`);

            // Download minimal sdk file
            let res: boolean = await processDownload(toolchainMinimalDownloadEntry, output, wsConfig);
            if (!res) {
                vscode.window.showErrorMessage("Error downloading minimal toolchain file. Check output for more info.");
                return;
            }
            progress.report({ increment: 5 });


            if (globalConfig.toolchains[toolchainVersion] === undefined) {
                globalConfig.toolchains[toolchainVersion] = {
                    version: toolchainVersion,
                    basePath: path.join(toolsdir, toolchainBasePath),
                    targetsInstalled: [],
                };
                setGlobalState(context, globalConfig);
            }

            for (const entry in toolchainTargetDownloadEntries) {
                // Download arm sdk file
                res = await processDownload(toolchainTargetDownloadEntries[entry], output, wsConfig);
                if (!res) {
                    vscode.window.showErrorMessage("Error downloading arm toolchain file. Check output for more info.");
                    return;
                } else {
                    let targetName = toolchainTargetDownloadEntries[entry].targetName;
                    if (!globalConfig.toolchains[toolchainVersion].targetsInstalled.includes(targetName)) {
                        globalConfig.toolchains[toolchainVersion].targetsInstalled.push(targetName);
                        setGlobalState(context, globalConfig);
                    }
                }
            }


            progress.report({ increment: 10 });

            // Setup flag complete
            progress.report({ increment: 100 });
            output.appendLine(`[SETUP] Installing zephyr-sdk-${toolchainVersion} complete`);

            globalConfig.armGdbPath = path.join(toolsdir, toolchainBasePath, "arm-zephyr-eabi\\bin\\arm-zephyr-eabi-gdb");
            wsConfig.sdkInstalled = true;
            await setWorkspaceState(context, wsConfig);
            if (solo) {
                vscode.window.showInformationMessage(`Zephyr IDE: Toolchain Setup Complete!`);
            }
        }
    );
};
