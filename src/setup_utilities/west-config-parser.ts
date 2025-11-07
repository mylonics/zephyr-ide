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

import * as fs from "fs";
import * as path from "path";

/**
 * Parse the manifest path from .west/config file
 * Returns the full path to west.yml or null if not found
 */
export function parseWestConfigManifestPath(setupPath: string): string | null {
    const westConfigPath = path.join(setupPath, ".west", "config");

    try {
        // Check if .west/config exists
        if (!fs.existsSync(westConfigPath)) {
            console.log(".west/config not found at:", westConfigPath);
            return null;
        }

        // Read .west/config file
        const configContent = fs.readFileSync(westConfigPath, "utf8");
        
        // Parse the manifest path from the INI-style config
        let manifestPath = "";
        let inManifestSection = false;
        
        for (const line of configContent.split('\n')) {
            const trimmedLine = line.trim();
            
            // Check if we're entering the [manifest] section
            if (trimmedLine === '[manifest]') {
                inManifestSection = true;
                continue;
            }
            
            // Check if we're entering a different section
            if (trimmedLine.startsWith('[') && trimmedLine !== '[manifest]') {
                inManifestSection = false;
                continue;
            }
            
            // If we're in the manifest section, look for the path key
            if (inManifestSection && trimmedLine.includes('=')) {
                // Handle values that may contain '=' characters
                const eqIndex = trimmedLine.indexOf('=');
                if (eqIndex > 0) {
                    const key = trimmedLine.substring(0, eqIndex).trim();
                    const value = trimmedLine.substring(eqIndex + 1).trim();
                    if (key === 'path') {
                        manifestPath = value;
                        break;
                    }
                }
            }
        }
        
        if (manifestPath) {
            const westYmlPath = path.join(setupPath, manifestPath, "west.yml");
            
            // Verify the file exists
            if (fs.existsSync(westYmlPath)) {
                return westYmlPath;
            }
            
            console.log("west.yml not found at expected location:", westYmlPath);
            console.log("Parsed manifest path:", manifestPath);
        } else {
            console.log("manifest path not found in .west/config");
        }
    } catch (error) {
        console.error("Error reading .west/config:", error);
    }

    return null;
}
