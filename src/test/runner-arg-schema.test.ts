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
import {
  getSchemaFor,
  findArgDef,
  findArgDefByWestFlag,
  getArgGroups,
  hasSchema,
} from "../project_utilities/runner_arg_schema";

suite("runner-arg-schema", () => {

  suite("hasSchema()", () => {
    test("returns true for known runners", () => {
      assert.strictEqual(hasSchema("openocd"), true);
      assert.strictEqual(hasSchema("jlink"), true);
      assert.strictEqual(hasSchema("pyocd"), true);
    });

    test("returns false for unknown runners", () => {
      assert.strictEqual(hasSchema("unknown-runner"), false);
      assert.strictEqual(hasSchema(""), false);
    });
  });

  suite("getSchemaFor()", () => {
    test("returns ArgDef[] for openocd", () => {
      const schema = getSchemaFor("openocd");
      assert.ok(Array.isArray(schema));
      assert.ok(schema.length > 0);
    });

    test("returns empty array for unknown runner", () => {
      const schema = getSchemaFor("nonexistent");
      assert.deepStrictEqual(schema, []);
    });

    test("each ArgDef has required fields", () => {
      const schema = getSchemaFor("jlink");
      for (const def of schema) {
        assert.ok(typeof def.id === "string" && def.id.length > 0, `id missing on ${def.id}`);
        assert.ok(typeof def.label === "string" && def.label.length > 0, `label missing on ${def.id}`);
        assert.ok(typeof def.description === "string", `description missing on ${def.id}`);
        assert.ok(typeof def.type === "string", `type missing on ${def.id}`);
        assert.ok(typeof def.west.flag === "string", `west.flag missing on ${def.id}`);
        assert.ok(typeof def.west.takesValue === "boolean", `west.takesValue missing on ${def.id}`);
      }
    });

    test("jlink schema contains device arg", () => {
      const schema = getSchemaFor("jlink");
      const deviceDef = schema.find(d => d.id === "device");
      assert.ok(deviceDef !== undefined, "jlink schema should have 'device' arg");
      assert.strictEqual(deviceDef.west.flag, "--device");
      assert.strictEqual(deviceDef.west.takesValue, true);
      assert.strictEqual(deviceDef.type, "string");
    });

    test("jlink schema contains rtt-enable bool arg", () => {
      const schema = getSchemaFor("jlink");
      const rttDef = schema.find(d => d.id === "rtt-enable");
      assert.ok(rttDef !== undefined, "jlink schema should have 'rtt-enable'");
      assert.strictEqual(rttDef.type, "bool");
      assert.strictEqual(rttDef.west.takesValue, false);
      assert.strictEqual(rttDef.west.flag, "--enable-rtt");
    });

    test("openocd interface-cfg is multi: true", () => {
      const def = findArgDef("openocd", "interface-cfg");
      assert.ok(def !== undefined, "openocd should have interface-cfg");
      assert.strictEqual(def.multi, true);
    });
  });

  suite("findArgDef()", () => {
    test("finds existing arg by id", () => {
      const def = findArgDef("jlink", "device");
      assert.ok(def !== undefined);
      assert.strictEqual(def.id, "device");
    });

    test("returns undefined for unknown id", () => {
      const def = findArgDef("jlink", "nonexistent-id");
      assert.strictEqual(def, undefined);
    });

    test("returns undefined for unknown runner", () => {
      const def = findArgDef("unknown-runner", "device");
      assert.strictEqual(def, undefined);
    });

    test("finds gdb-port with slot restriction on jlink", () => {
      const def = findArgDef("jlink", "gdb-port");
      assert.ok(def !== undefined);
      assert.ok(def.slots !== undefined);
      assert.ok(def.slots!.includes("debug"));
      assert.ok(!def.slots!.includes("flash"));
    });
  });

  suite("findArgDefByWestFlag()", () => {
    test("finds arg by exact west flag", () => {
      const def = findArgDefByWestFlag("jlink", "--device");
      assert.ok(def !== undefined);
      assert.strictEqual(def.id, "device");
    });

    test("finds arg by alias flag", () => {
      const def = findArgDefByWestFlag("jlink", "--interface");
      assert.ok(def !== undefined);
      assert.strictEqual(def.id, "interface");
    });

    test("returns undefined for unknown flag", () => {
      const def = findArgDefByWestFlag("jlink", "--nonexistent");
      assert.strictEqual(def, undefined);
    });

    test("finds openocd arg by -f alias", () => {
      const def = findArgDefByWestFlag("openocd", "-f");
      assert.ok(def !== undefined, "Should find openocd arg with -f alias");
      // -f is an alias for --openocd-config (both interface-cfg and target-cfg use it)
      assert.ok(def.west.aliases?.includes("-f"));
    });

    test("finds bool flag with takesValue: false", () => {
      const def = findArgDefByWestFlag("jlink", "--enable-rtt");
      assert.ok(def !== undefined);
      assert.strictEqual(def.id, "rtt-enable");
      assert.strictEqual(def.west.takesValue, false);
    });
  });

  suite("getArgGroups()", () => {
    test("returns groups for jlink", () => {
      const groups = getArgGroups("jlink");
      assert.ok(groups.includes("Probe"), "jlink should have Probe group");
    });

    test("returns empty array for unknown runner", () => {
      const groups = getArgGroups("unknown-runner");
      assert.deepStrictEqual(groups, []);
    });

    test("groups are unique", () => {
      const groups = getArgGroups("openocd");
      const unique = [...new Set(groups)];
      assert.deepStrictEqual(groups, unique, "groups should not have duplicates");
    });
  });
});
