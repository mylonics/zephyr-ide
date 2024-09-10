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
import * as path from 'path';
import * as fs from 'fs-extra';
import * as os from "os";

import { compareVersions } from 'compare-versions';

import { getToolsDir, GlobalConfig, setGlobalState } from "./setup";
import { toolchainTargets } from "../defines";
import { FileDownload, DownloadEntry, processDownload } from "./download";

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

export async function installSdk(context: vscode.ExtensionContext, globalConfig: GlobalConfig, output: vscode.OutputChannel, installLatest = false, toolchainsToInstall: string[] | undefined, solo = true) {
    // Show setup progress..
    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: "Installing Zephyr SDK",
            cancellable: false,
        },
        async (progress, token) => {
            output.show();

            progress.report({ increment: 5 });

            if (getPlatformName() === undefined) {
                vscode.window.showErrorMessage("Unsupported platform for Zephyr IDE");
                return;
            }
            let exists = await fs.pathExists(getToolsDir());
            if (!exists) {
                await fs.mkdirp(getToolsDir());
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


            globalConfig.sdkInstalled = false;
            setGlobalState(context, globalConfig);

            let selectedToolchainFile = context.asAbsolutePath("manifest/sdk_md5/" + toolchainVersion + ".sum");

            // Set up downloader path
            FileDownload.init(path.join(getToolsDir(), "downloads"));

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
                            "cmd": "zephyr-sdk-" + toolchainVersion + "/setup.sh -t " + targetName + (targetName.includes("xtensa") ? "_" : "-") + "zephyr-" + (targetName === "arm" ? "eabi" : "elf"),
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
            let res: boolean = await processDownload(toolchainMinimalDownloadEntry, output);
            if (!res) {
                vscode.window.showErrorMessage("Error downloading minimal toolchain file. Check output for more info.");
                return;
            }
            progress.report({ increment: 5 });


            if (globalConfig.toolchains[toolchainVersion] === undefined) {
                globalConfig.toolchains[toolchainVersion] = {
                    version: toolchainVersion,
                    basePath: path.join(getToolsDir(), toolchainBasePath),
                    targetsInstalled: [],
                };
                setGlobalState(context, globalConfig);
            }

            for (const entry in toolchainTargetDownloadEntries) {
                // Download arm sdk file
                res = await processDownload(toolchainTargetDownloadEntries[entry], output);
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

            globalConfig.armGdbPath = path.join(getToolsDir(), toolchainBasePath, "arm-zephyr-eabi", "bin", "arm-zephyr-eabi-gdb");

            globalConfig.sdkInstalled = true;
            await setGlobalState(context, globalConfig);
            if (solo) {
                vscode.window.showInformationMessage(`Zephyr IDE: Toolchain Setup Complete!`);
            }
        }
    );
};
