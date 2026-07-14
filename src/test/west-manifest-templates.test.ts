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

import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";

/*
 * These templates are the actual west.yml files shipped in
 * resources/west_templates/ and copied verbatim (then version/HAL-mutated)
 * during workspace setup by westSelector's pickTemplate/pickVersion
 * (src/setup_utilities/west_selector.ts:111-195, 286-389). The label→file
 * mapping asserted below (west_selector.ts:120-127) is what the workspace
 * setup integration tests drive via CommonUIInteractions in test-runner.ts
 * ('minimal zephyr', 'sim only', 'testing', etc). This suite validates the
 * fixture files stay well-formed and internally consistent — a malformed
 * template would only otherwise surface as a confusing `west update`
 * failure deep into a 10+ minute integration test.
 */

const extensionPath = path.resolve(__dirname, "..", "..");
const templatesDir = path.join(extensionPath, "resources", "west_templates");

interface WestManifestDoc {
    manifest: {
        remotes: { name: string; "url-base": string }[];
        projects: {
            name: string;
            remote: string;
            revision: string;
            import?: { "path-prefix"?: string; "name-allowlist"?: string[] };
        }[];
    };
}

function loadTemplate(filename: string): WestManifestDoc {
    const raw = fs.readFileSync(path.join(templatesDir, filename), "utf-8");
    return yaml.load(raw) as WestManifestDoc;
}

// Mirrors the label -> filename mapping in west_selector.ts pickTemplate (lines 120-127).
// "Testing" is intentionally excluded here since it's gated behind
// process.env.CI / ZEPHYR_IDE_TESTING at runtime, not a permanent option.
const nonNcsTemplates: { label: string; file: string }[] = [
    { label: "Full Zephyr", file: "default_west.yml" },
    { label: "Minimal Zephyr (Select Desired HALs)", file: "minimal_west.yml" },
    { label: "Minimal BLE Zephyr (Select Desired HALs)", file: "minimal_ble_west.yml" },
    { label: "Sim Only", file: "simulated_west.yml" },
    { label: "Testing", file: "testing_west.yml" },
];

suite("West Manifest Templates Test Suite", () => {

    test("every template referenced by west_selector.ts exists on disk", () => {
        for (const { file } of nonNcsTemplates) {
            const filePath = path.join(templatesDir, file);
            assert.ok(fs.existsSync(filePath), `Missing template file: ${file}`);
        }
    });

    for (const { label, file } of nonNcsTemplates) {
        test(`${file} (${label}): parses to a valid manifest with a zephyr project pinned to a revision`, () => {
            const doc = loadTemplate(file);

            assert.ok(doc.manifest, `${file}: missing top-level 'manifest' key`);
            assert.ok(Array.isArray(doc.manifest.remotes) && doc.manifest.remotes.length > 0, `${file}: missing manifest.remotes`);
            assert.ok(Array.isArray(doc.manifest.projects) && doc.manifest.projects.length > 0, `${file}: missing manifest.projects`);

            const zephyrProject = doc.manifest.projects.find((p) => p.name === "zephyr");
            assert.ok(zephyrProject, `${file}: no project named 'zephyr' — pickVersion's revision-update logic (west_selector.ts:364-370) matches on project name "zephyr" and would silently no-op`);
            assert.ok(
                typeof zephyrProject!.revision === "string" && zephyrProject!.revision.length > 0,
                `${file}: zephyr project has no pinned revision`
            );

            const remoteNames = doc.manifest.remotes.map((r) => r.name);
            assert.ok(
                remoteNames.includes(zephyrProject!.remote),
                `${file}: zephyr project references remote "${zephyrProject!.remote}" which is not declared in manifest.remotes`
            );
        });
    }

    test("minimal_west.yml and minimal_ble_west.yml declare a HAL allowlist that pickVersion can append to", () => {
        for (const file of ["minimal_west.yml", "minimal_ble_west.yml"]) {
            const doc = loadTemplate(file);
            const allowList = doc.manifest.projects[0].import?.["name-allowlist"];
            // west_selector.ts:372-380 only appends selected HALs when
            // `doc.manifest.projects[0].import["name-allowlist"]` is already
            // an array; if a future edit removes it, HAL selection would
            // silently become a no-op instead of failing loudly.
            assert.ok(
                Array.isArray(allowList) && allowList.length > 0,
                `${file}: projects[0].import.name-allowlist must be a non-empty array for HAL selection to work`
            );
        }
    });

    test("minimal_ble_west.yml allowlist is a superset of minimal_west.yml's (BLE adds HALs, doesn't replace them)", () => {
        const minimal = loadTemplate("minimal_west.yml").manifest.projects[0].import!["name-allowlist"]!;
        const minimalBle = loadTemplate("minimal_ble_west.yml").manifest.projects[0].import!["name-allowlist"]!;
        for (const hal of minimal) {
            assert.ok(minimalBle.includes(hal), `minimal_ble_west.yml is missing "${hal}" from minimal_west.yml's allowlist`);
        }
    });

    test("simulated_west.yml uses the __none__ sentinel to skip all HAL imports", () => {
        const doc = loadTemplate("simulated_west.yml");
        const allowList = doc.manifest.projects[0].import?.["name-allowlist"];
        assert.deepStrictEqual(allowList, ["__none__"]);
    });

    test("testing_west.yml includes hal_rpi_pico (used by the RPi Pico scenario in combined-installation.test.ts)", () => {
        const doc = loadTemplate("testing_west.yml");
        const allowList = doc.manifest.projects[0].import?.["name-allowlist"] ?? [];
        assert.ok(allowList.includes("hal_rpi_pico"), "testing_west.yml must include hal_rpi_pico for the rpi_pico/rp2040 board used in the testing workspace scenario");
    });

    test("ncs_west.yml pins sdk-nrf to a revision (isNcsProject detection matches on project name 'sdk-nrf', west_selector.ts:306)", () => {
        const raw = fs.readFileSync(path.join(templatesDir, "ncs_west.yml"), "utf-8");
        const doc = yaml.load(raw) as WestManifestDoc;
        const ncsProject = doc.manifest.projects.find((p) => p.name === "sdk-nrf");
        assert.ok(ncsProject, "ncs_west.yml must have a project named 'sdk-nrf'");
        assert.ok(typeof ncsProject!.revision === "string" && ncsProject!.revision.length > 0, "sdk-nrf project has no pinned revision");
    });
});
