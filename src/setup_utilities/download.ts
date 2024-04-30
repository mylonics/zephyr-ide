/**
 * @author Jared Wolff <jared@circuitdojo.org>
 * @copyright Circuit Dojo LLC
 * @license Apache 2.0
 */

import * as path from 'path';
import * as fs from 'fs-extra';
import * as crypto from 'crypto';

import { HttpClient } from "typed-rest-client/HttpClient";

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