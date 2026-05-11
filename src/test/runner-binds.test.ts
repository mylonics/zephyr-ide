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

import * as assert from 'assert';
import { resolveBind, RunnerBind, RunnerVariant } from '../project_utilities/runner_variants';
import { migrateRunnerConfig } from '../setup_utilities/state-management';

suite('Runner Bind Resolution', () => {
  const variants: RunnerVariant[] = [
    { name: 'my-openocd', runner: 'openocd', args: '-f board.cfg' },
    { name: 'jlink-fast', runner: 'jlink', args: '--speed 4000' },
  ];

  test('resolveBind: auto returns undefined', () => {
    const bind: RunnerBind = { kind: 'auto' };
    const result = resolveBind(bind, variants);
    assert.strictEqual(result, undefined);
  });

  test('resolveBind: runner without extraArgs', () => {
    const bind: RunnerBind = { kind: 'runner', runner: 'pyocd' };
    const result = resolveBind(bind, variants);
    assert.deepStrictEqual(result, { runner: 'pyocd', args: '' });
  });

  test('resolveBind: runner with extraArgs', () => {
    const bind: RunnerBind = { kind: 'runner', runner: 'pyocd', extraArgs: '--target stm32f103' };
    const result = resolveBind(bind, variants);
    assert.deepStrictEqual(result, { runner: 'pyocd', args: '--target stm32f103' });
  });

  test('resolveBind: variant without extraArgs', () => {
    const bind: RunnerBind = { kind: 'variant', variant: 'my-openocd' };
    const result = resolveBind(bind, variants);
    assert.deepStrictEqual(result, { runner: 'openocd', args: '-f board.cfg' });
  });

  test('resolveBind: variant with extraArgs appends', () => {
    const bind: RunnerBind = { kind: 'variant', variant: 'jlink-fast', extraArgs: '--device STM32F103' };
    const result = resolveBind(bind, variants);
    assert.deepStrictEqual(result, { runner: 'jlink', args: '--speed 4000 --device STM32F103' });
  });

  test('resolveBind: missing variant returns undefined', () => {
    const bind: RunnerBind = { kind: 'variant', variant: 'does-not-exist' };
    const result = resolveBind(bind, variants);
    assert.strictEqual(result, undefined);
  });

  test('resolveBind: launch returns undefined', () => {
    const bind: RunnerBind = { kind: 'launch', name: 'Custom Debug' };
    const result = resolveBind(bind, variants);
    assert.strictEqual(result, undefined);
  });
});

suite('Runner Config Migration', () => {
  test('Migrate legacy runner config without buildState', () => {
    const legacy = { name: 'openocd', runner: 'openocd', args: '-f board.cfg', argsMode: 'append' };
    const migrated = migrateRunnerConfig(legacy, undefined);
    
    assert.strictEqual(migrated.name, 'openocd');
    assert.deepStrictEqual(migrated.flash, { kind: 'runner', runner: 'openocd', extraArgs: '-f board.cfg' });
    assert.deepStrictEqual(migrated.build, { kind: 'auto' });
    assert.deepStrictEqual(migrated.buildDebug, { kind: 'auto' });
    assert.deepStrictEqual(migrated.attach, { kind: 'auto' });
  });

  test('Migrate legacy runner config with buildState launch targets', () => {
    const legacy = { name: 'jlink', runner: 'jlink', args: '--speed 4000' };
    const buildState = {
      launchTarget: 'Custom Launch',
      buildDebugTarget: 'Custom Debug',
      attachTarget: 'Custom Attach',
    };
    const migrated = migrateRunnerConfig(legacy, buildState);
    
    assert.strictEqual(migrated.name, 'jlink');
    assert.deepStrictEqual(migrated.flash, { kind: 'runner', runner: 'jlink', extraArgs: '--speed 4000' });
    assert.deepStrictEqual(migrated.build, { kind: 'launch', name: 'Custom Launch' });
    assert.deepStrictEqual(migrated.buildDebug, { kind: 'launch', name: 'Custom Debug' });
    assert.deepStrictEqual(migrated.attach, { kind: 'launch', name: 'Custom Attach' });
  });

  test('Migrate legacy runner config with auto launch targets', () => {
    const legacy = { name: 'pyocd', runner: 'pyocd', args: '' };
    const buildState = {
      launchTarget: 'Auto: Build',
      buildDebugTarget: 'Zephyr IDE: Debug',
      attachTarget: undefined,
    };
    const migrated = migrateRunnerConfig(legacy, buildState);
    
    assert.deepStrictEqual(migrated.build, { kind: 'auto' });
    assert.deepStrictEqual(migrated.buildDebug, { kind: 'auto' });
    assert.deepStrictEqual(migrated.attach, { kind: 'auto' });
  });

  test('New-shape config left untouched', () => {
    const newShape = {
      name: 'modern',
      flash: { kind: 'variant', variant: 'my-openocd' },
      build: { kind: 'auto' },
      buildDebug: { kind: 'launch', name: 'Custom' },
      attach: { kind: 'auto' },
    };
    const migrated = migrateRunnerConfig(newShape, undefined);
    
    assert.deepStrictEqual(migrated, newShape);
  });

  test('New-shape config strips legacy fields', () => {
    const mixed = {
      name: 'mixed',
      runner: 'openocd',  // legacy field
      args: '-f test.cfg',  // legacy field
      argsMode: 'append',  // legacy field
      flash: { kind: 'runner', runner: 'openocd' },
      build: { kind: 'auto' },
      buildDebug: { kind: 'auto' },
      attach: { kind: 'auto' },
    };
    const migrated = migrateRunnerConfig(mixed, undefined);
    
    // Should only have new-shape fields
    assert.strictEqual(migrated.name, 'mixed');
    assert.strictEqual(migrated.runner, undefined);
    assert.strictEqual(migrated.args, undefined);
    assert.strictEqual(migrated.argsMode, undefined);
    assert.deepStrictEqual(migrated.flash, { kind: 'runner', runner: 'openocd' });
  });
});
