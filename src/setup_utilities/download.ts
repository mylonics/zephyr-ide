/**
 * @author Jared Wolff <jared@circuitdojo.org>
 * @copyright Circuit Dojo LLC
 * @license Apache 2.0
 */

/*
Modifications Copyright 2024 mylonics 
Author Rijesh Augustine

Code based on https://github.com/circuitdojo/zephyr-tools/extension.ts and https://github.com/circuitdojo/zephyr-tools/Download.ts.
Modifications primarily include naming convetions of funtions

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

import { HttpClient } from "typed-rest-client/HttpClient";
import { getToolsDir } from "./setup";

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

export async function processDownload(download: DownloadEntry, output: vscode.OutputChannel) {
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
    let copytopath = path.join(getToolsDir(), download.name);

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
        let res = await exec(cmd, {}).then(
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
        let res = await exec(cmd, {}).then(
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


