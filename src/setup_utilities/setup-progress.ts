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

export interface SetupProgressStep {
  id: string;
  label: string;
  status: 'pending' | 'in-progress' | 'completed' | 'failed' | 'skipped';
  detail?: string;
}

export interface SetupProgressEvent {
  type: 'start' | 'step-update' | 'complete' | 'failed';
  operationLabel: string;
  steps: SetupProgressStep[];
  message?: string;
}

const _onProgress = new vscode.EventEmitter<SetupProgressEvent>();

/** Subscribe to workspace setup progress events. */
export const onSetupProgress: vscode.Event<SetupProgressEvent> = _onProgress.event;

/**
 * Tracks and emits progress for multi-step workspace setup operations.
 * 
 * Usage:
 * ```ts
 * const tracker = new SetupProgressTracker("My Operation", [
 *   { id: 'step1', label: 'First step' },
 *   { id: 'step2', label: 'Second step' },
 * ]);
 * tracker.startStep('step1');
 * // ... do work ...
 * tracker.completeStep('step1');
 * tracker.startStep('step2');
 * // ... do work ...
 * tracker.completeStep('step2');
 * tracker.complete('All done!');
 * ```
 */
export class SetupProgressTracker {
  private steps: SetupProgressStep[];
  private label: string;

  constructor(label: string, stepDefs: { id: string; label: string }[]) {
    this.label = label;
    this.steps = stepDefs.map(s => ({ ...s, status: 'pending' as const }));
    this.emit('start');
  }

  startStep(id: string, detail?: string) {
    const step = this.steps.find(s => s.id === id);
    if (step) {
      step.status = 'in-progress';
      step.detail = detail;
    }
    this.emit('step-update');
  }

  completeStep(id: string, detail?: string) {
    const step = this.steps.find(s => s.id === id);
    if (step) {
      step.status = 'completed';
      if (detail !== undefined) {
        step.detail = detail;
      }
    }
    this.emit('step-update');
  }

  failStep(id: string, detail?: string) {
    const step = this.steps.find(s => s.id === id);
    if (step) {
      step.status = 'failed';
      if (detail !== undefined) {
        step.detail = detail;
      }
    }
    this.emit('failed', detail);
  }

  skipStep(id: string) {
    const step = this.steps.find(s => s.id === id);
    if (step) {
      step.status = 'skipped';
      step.detail = 'Skipped';
    }
    this.emit('step-update');
  }

  complete(message?: string) {
    this.emit('complete', message);
  }

  fail(message?: string) {
    this.emit('failed', message);
  }

  private emit(type: SetupProgressEvent['type'], message?: string) {
    _onProgress.fire({
      type,
      operationLabel: this.label,
      steps: this.steps.map(s => ({ ...s })),
      message,
    });
  }
}

export function disposeSetupProgress() {
  _onProgress.dispose();
}
