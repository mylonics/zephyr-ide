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
import { toolsdir, WorkspaceConfig, setWorkspaceState } from "./setup";
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

export async function pickToolchainTarget() {
    const pickOptions: vscode.QuickPickOptions = {
        ignoreFocusOut: true,
        placeHolder: "Select Toolchain Target Architecture",
    };

    let selectedToolchainTarget = await vscode.window.showQuickPick(toolchainTargets, pickOptions);
    if (selectedToolchainTarget) {
        return selectedToolchainTarget.label;
    }
}

export async function installSdk(context: vscode.ExtensionContext, wsConfig: WorkspaceConfig, output: vscode.OutputChannel, installLatestArm = false, solo = true) {
    // Show setup progress..
    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: "Setting up Zephyr sdk",
            cancellable: false,
        },
        async (progress, token) => {
            // Clear output before beginning
            output.clear();
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

            let toolchainVersionList: string[] = [];
            let toolchainMd5Path = context.asAbsolutePath("manifest/sdk_md5");
            let toolchainMd5Files = await vscode.workspace.fs.readDirectory(vscode.Uri.file(toolchainMd5Path));
            for (const [index, [filename, type]] of toolchainMd5Files.entries()) {
                if (path.parse(filename).ext === ".sum") {
                    toolchainVersionList.push(path.parse(filename).name);
                }
            }

            toolchainVersionList = toolchainVersionList.sort(compareVersions).reverse();
            let toolchainSelection: string | undefined = toolchainVersionList[0];
            let toolchainTargetArch = "arm";
            if (!installLatestArm) {
                // Pick options
                const pickOptions: vscode.QuickPickOptions = {
                    ignoreFocusOut: true,
                    placeHolder: "Which toolchain version would you like to install?",
                };
                toolchainSelection = await vscode.window.showQuickPick(toolchainVersionList, pickOptions);
                let targ = await pickToolchainTarget();
                if (targ) {
                    toolchainTargetArch = targ;
                } else {
                    return;
                }
            }

            // Check if user canceled
            if (toolchainSelection === undefined) {
                vscode.window.showErrorMessage("Zephyr IDE Setup canceled.");
                return;
            }

            wsConfig.sdkInstalled = false;
            setWorkspaceState(context, wsConfig);

            let selectedToolchainFile = context.asAbsolutePath("manifest/sdk_md5/" + toolchainSelection + ".sum");

            // Set up downloader path
            FileDownload.init(path.join(toolsdir, "downloads"));

            let toolchainFileRawText = fs.readFileSync(selectedToolchainFile, 'utf8');
            let toolchainMinimalDownloadEntry: DownloadEntry | undefined;
            let toolchainArmDownloadEntry: DownloadEntry | undefined;

            let toolchainBasePath = "toolchains/zephyr-sdk-" + toolchainSelection;
            for (const line of toolchainFileRawText.trim().split('\n')) {
                let s = line.trim().split(/[\s\s]+/g);
                let md5 = s[0];
                let fileName = s[1];
                let parsedFileName = path.parse(fileName);
                if (parsedFileName.ext === ".xz") {
                    parsedFileName = path.parse(parsedFileName.name);
                }

                if (parsedFileName.name === "zephyr-sdk-" + toolchainSelection + "_" + getPlatformName() + "-" + getPlatformArch() + "_minimal") {
                    toolchainMinimalDownloadEntry = {
                        "name": "toolchains",
                        "filename": fileName,
                        "url": "https://github.com/zephyrproject-rtos/sdk-ng/releases/download/v" + toolchainSelection + "/" + fileName,
                        "md5": md5,
                        "clearTarget": true,
                    };
                    if (getPlatformName() === "macos") {
                        toolchainMinimalDownloadEntry.cmd = [{
                            "cmd": "zephyr-sdk-" + toolchainSelection + "/setup.sh -t " + toolchainTargetArch + "-zephyr-" + (toolchainTargetArch === "arm" ? "eabi" : "elf"),
                            "usepath": true
                        }];
                    }
                } else if (parsedFileName.name === "toolchain_" + getPlatformName() + "-" + getPlatformArch() + "_" + toolchainTargetArch + (toolchainTargetArch.includes("xtensa") ? "_" : "-") + "zephyr-" + (toolchainTargetArch === "arm" ? "eabi" : "elf")) {
                    toolchainArmDownloadEntry = {
                        "name": toolchainBasePath,
                        "filename": fileName,
                        "url": "https://github.com/zephyrproject-rtos/sdk-ng/releases/download/v" + toolchainSelection + "/" + fileName,
                        "md5": md5,
                        "clearTarget": false,
                    };
                }
            }


            if (toolchainArmDownloadEntry === undefined || toolchainMinimalDownloadEntry === undefined) {
                vscode.window.showErrorMessage("Error finding appropriate toolchain file");
                return;
            }

            // Output indicating toolchain install
            output.appendLine(`[SETUP] Installing zephyr-sdk-${toolchainSelection} toolchain...`);

            // Download minimal sdk file
            let res: boolean = await processDownload(toolchainMinimalDownloadEntry, output, wsConfig);
            if (!res) {
                vscode.window.showErrorMessage("Error downloading minimal toolchain file. Check output for more info.");
                return;
            }
            progress.report({ increment: 5 });

            // Download arm sdk file
            res = await processDownload(toolchainArmDownloadEntry, output, wsConfig);
            if (!res) {
                vscode.window.showErrorMessage("Error downloading arm toolchain file. Check output for more info.");
                return;
            }
            progress.report({ increment: 10 });

            // Setup flag complete
            wsConfig.toolchains[toolchainSelection] = path.join(toolsdir, toolchainBasePath);

            progress.report({ increment: 100 });
            output.appendLine(`[SETUP] Installing zephyr-sdk-${toolchainSelection} complete`);

            if (toolchainTargetArch !== "arm") {
                wsConfig.onlyArm = false;
            }
            wsConfig.armGdbPath = path.join(toolsdir, toolchainBasePath, "arm-zephyr-eabi\\bin\\arm-zephyr-eabi-gdb");
            wsConfig.sdkInstalled = true;
            await setWorkspaceState(context, wsConfig);
            if (solo) {
                vscode.window.showInformationMessage(`Zephyr IDE: Toolchain Setup Complete!`);
            }
        }
    );
};
