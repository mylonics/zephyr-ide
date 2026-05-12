/*
Copyright 2026 mylonics 
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

/**
 * Unit tests for the runner-variants management helpers introduced in
 * Stage 2 (Runner Variants management UI). These cover the pure helpers
 * (no I/O) and the user-scope persistence path which uses VS Code's
 * configuration API and is safe to exercise from the test runner.
 *
 * The full host-side message handlers (addVariant / updateVariant /
 * removeVariant) live on `ProjectBuildPanel` and `SettingsPanel` and
 * delegate to these helpers.
 */

import * as assert from 'assert';
import * as vscode from 'vscode';
import {
  readUserVariants,
  writeUserVariants,
  uniqueVariantName,
  validateVariant,
} from '../project_utilities/runner_variants_io';
import { RunnerVariant } from '../project_utilities/runner_variants';

const SETTINGS_KEY = 'zephyr-ide.runnerVariants';

async function clearUserVariants(): Promise<void> {
  await vscode.workspace.getConfiguration().update(
    SETTINGS_KEY,
    undefined,
    vscode.ConfigurationTarget.Global,
  );
}

suite('Runner Variants — pure helpers', () => {
  test('uniqueVariantName: returns base when not in use', () => {
    assert.strictEqual(uniqueVariantName('foo', []), 'foo');
    assert.strictEqual(uniqueVariantName('foo', ['bar', 'baz']), 'foo');
  });

  test('uniqueVariantName: appends numeric suffix on collision', () => {
    assert.strictEqual(uniqueVariantName('foo', ['foo']), 'foo-2');
    assert.strictEqual(uniqueVariantName('foo', ['foo', 'foo-2']), 'foo-3');
  });

  test('uniqueVariantName: trims and falls back to "variant" when empty', () => {
    assert.strictEqual(uniqueVariantName('   ', []), 'variant');
    assert.strictEqual(uniqueVariantName('', []), 'variant');
  });

  test('validateVariant: rejects empty name', () => {
    const err = validateVariant({ name: '   ', runner: 'openocd', args: '' }, []);
    assert.ok(err);
    assert.strictEqual(err!.field, 'name');
  });

  test('validateVariant: rejects empty runner', () => {
    const err = validateVariant({ name: 'foo', runner: '', args: '' }, []);
    assert.ok(err);
    assert.strictEqual(err!.field, 'runner');
  });

  test('validateVariant: rejects same-scope duplicates (new entry)', () => {
    const existing: RunnerVariant[] = [{ name: 'foo', runner: 'openocd', args: '' }];
    const err = validateVariant({ name: 'foo', runner: 'jlink', args: '' }, existing);
    assert.ok(err);
    assert.strictEqual(err!.field, 'name');
  });

  test('validateVariant: allows rename to same name (originalName matches)', () => {
    const existing: RunnerVariant[] = [{ name: 'foo', runner: 'openocd', args: '' }];
    const err = validateVariant({ name: 'foo', runner: 'jlink', args: '' }, existing, 'foo');
    assert.strictEqual(err, undefined);
  });

  test('validateVariant: rejects rename to existing other entry', () => {
    const existing: RunnerVariant[] = [
      { name: 'foo', runner: 'openocd', args: '' },
      { name: 'bar', runner: 'jlink', args: '' },
    ];
    const err = validateVariant({ name: 'bar', runner: 'openocd', args: '' }, existing, 'foo');
    assert.ok(err);
    assert.strictEqual(err!.field, 'name');
  });
});

suite('Runner Variants — user scope persistence', () => {
  // Snapshot whatever the user already has so we restore at the end.
  let snapshot: RunnerVariant[] = [];

  suiteSetup(async () => {
    snapshot = readUserVariants();
    await clearUserVariants();
  });

  suiteTeardown(async () => {
    await writeUserVariants(snapshot);
  });

  setup(async () => {
    await clearUserVariants();
  });

  test('readUserVariants: empty by default', () => {
    assert.deepStrictEqual(readUserVariants(), []);
  });

  test('writeUserVariants then readUserVariants round-trips', async () => {
    const v: RunnerVariant[] = [
      { name: 'a', runner: 'openocd', args: '-f a.cfg' },
      { name: 'b', runner: 'jlink', args: '--speed 4000' },
    ];
    await writeUserVariants(v);
    assert.deepStrictEqual(readUserVariants(), v);
  });

  test('writeUserVariants([]) clears the setting', async () => {
    await writeUserVariants([{ name: 'a', runner: 'openocd', args: '' }]);
    assert.strictEqual(readUserVariants().length, 1);
    await writeUserVariants([]);
    assert.deepStrictEqual(readUserVariants(), []);
  });

  test('readUserVariants drops malformed entries', async () => {
    // Write directly with junk fields mixed in.
    await vscode.workspace.getConfiguration().update(
      SETTINGS_KEY,
      [
        { name: 'good', runner: 'openocd', args: '' },
        { name: '', runner: 'openocd', args: '' },         // empty name -> dropped
        { name: 'bad', runner: '', args: '' },             // empty runner -> dropped
        { runner: 'jlink', args: '' },                     // missing name -> dropped
        'not-an-object',                                   // wrong type -> dropped
      ] as any,
      vscode.ConfigurationTarget.Global,
    );
    const variants = readUserVariants();
    assert.strictEqual(variants.length, 1);
    assert.strictEqual(variants[0].name, 'good');
  });
});
