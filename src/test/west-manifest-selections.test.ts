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
import { applyManifestSelections } from "../setup_utilities/west_selector";

const extensionPath = path.resolve(__dirname, "..", "..");
const templatesDir = path.join(extensionPath, "resources", "west_templates");

function loadTemplate(filename: string): any {
    const raw = fs.readFileSync(path.join(templatesDir, filename), "utf-8");
    return yaml.load(raw);
}

suite("applyManifestSelections", () => {
    test("updates the zephyr project's revision when isNcsProject is false", () => {
        const doc = loadTemplate("default_west.yml");
        applyManifestSelections(doc, { isNcsProject: false, versionLabel: "v4.5.0" });
        assert.strictEqual(doc.manifest.projects[0].revision, "v4.5.0");
    });

    test("updates the sdk-nrf project's revision when isNcsProject is true", () => {
        const doc = loadTemplate("ncs_west.yml");
        applyManifestSelections(doc, { isNcsProject: true, versionLabel: "v2.8.0" });
        const ncsProject = doc.manifest.projects.find((p: any) => p.name === "sdk-nrf");
        assert.strictEqual(ncsProject.revision, "v2.8.0");
    });

    test("does not touch a project's revision when the name doesn't match isNcsProject's target", () => {
        // default_west.yml has a "zephyr" project, not "sdk-nrf" — requesting an
        // NCS update must leave the (mismatched) project's revision untouched.
        const doc = loadTemplate("default_west.yml");
        const originalRevision = doc.manifest.projects[0].revision;
        applyManifestSelections(doc, { isNcsProject: true, versionLabel: "v2.8.0" });
        assert.strictEqual(doc.manifest.projects[0].revision, originalRevision);
    });

    test("appends a selected HAL description to an existing name-allowlist", () => {
        const doc = loadTemplate("minimal_west.yml");
        const before = [...doc.manifest.projects[0].import["name-allowlist"]];
        applyManifestSelections(doc, {
            isNcsProject: false,
            versionLabel: "v4.4.0",
            desiredHals: [{ label: "MCUboot", description: "mcuboot" }],
        });
        const after = doc.manifest.projects[0].import["name-allowlist"];
        assert.deepStrictEqual(after, [...before, "mcuboot"]);
    });

    test("does not duplicate a HAL that's already in the allowlist", () => {
        const doc = loadTemplate("minimal_west.yml");
        const before = [...doc.manifest.projects[0].import["name-allowlist"]];
        assert.ok(before.includes("cmsis_6"), "test fixture assumption: minimal_west.yml already allows cmsis_6");

        applyManifestSelections(doc, {
            isNcsProject: false,
            versionLabel: "v4.4.0",
            desiredHals: [{ label: "CMSIS", description: "cmsis_6" }],
        });

        assert.deepStrictEqual(doc.manifest.projects[0].import["name-allowlist"], before);
    });

    test("HAL items with no description are ignored", () => {
        const doc = loadTemplate("minimal_west.yml");
        const before = [...doc.manifest.projects[0].import["name-allowlist"]];
        applyManifestSelections(doc, {
            isNcsProject: false,
            versionLabel: "v4.4.0",
            desiredHals: [{ label: "No description here" }],
        });
        assert.deepStrictEqual(doc.manifest.projects[0].import["name-allowlist"], before);
    });

    test("multiple selected HALs are all appended in order", () => {
        const doc = loadTemplate("minimal_west.yml");
        applyManifestSelections(doc, {
            isNcsProject: false,
            versionLabel: "v4.4.0",
            desiredHals: [
                { label: "a", description: "hal_a" },
                { label: "b", description: "hal_b" },
            ],
        });
        const allowList = doc.manifest.projects[0].import["name-allowlist"];
        assert.ok(allowList.includes("hal_a"));
        assert.ok(allowList.includes("hal_b"));
    });

    test("empty desiredHals array leaves the allowlist unchanged", () => {
        const doc = loadTemplate("minimal_west.yml");
        const before = [...doc.manifest.projects[0].import["name-allowlist"]];
        applyManifestSelections(doc, { isNcsProject: false, versionLabel: "v4.4.0", desiredHals: [] });
        assert.deepStrictEqual(doc.manifest.projects[0].import["name-allowlist"], before);
    });

    test("undefined desiredHals leaves the allowlist unchanged", () => {
        const doc = loadTemplate("minimal_west.yml");
        const before = [...doc.manifest.projects[0].import["name-allowlist"]];
        applyManifestSelections(doc, { isNcsProject: false, versionLabel: "v4.4.0" });
        assert.deepStrictEqual(doc.manifest.projects[0].import["name-allowlist"], before);
    });

    test("HAL selection on a template with no name-allowlist (e.g. default_west.yml) is a no-op, not a throw", () => {
        const doc = loadTemplate("default_west.yml");
        assert.strictEqual(doc.manifest.projects[0].import?.["name-allowlist"], undefined, "test fixture assumption");
        assert.doesNotThrow(() => {
            applyManifestSelections(doc, {
                isNcsProject: false,
                versionLabel: "v4.4.0",
                desiredHals: [{ label: "MCUboot", description: "mcuboot" }],
            });
        });
    });

    test("simulated_west.yml's __none__ sentinel is left in place when no HALs are selected", () => {
        const doc = loadTemplate("simulated_west.yml");
        applyManifestSelections(doc, { isNcsProject: false, versionLabel: "v4.4.0" });
        assert.deepStrictEqual(doc.manifest.projects[0].import["name-allowlist"], ["__none__"]);
    });

    test("mutates the document in place and returns undefined", () => {
        const doc = loadTemplate("default_west.yml");
        const result = applyManifestSelections(doc, { isNcsProject: false, versionLabel: "v4.4.0" });
        assert.strictEqual(result, undefined);
        assert.strictEqual(doc.manifest.projects[0].revision, "v4.4.0");
    });
});
