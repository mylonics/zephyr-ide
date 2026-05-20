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

import * as assert from "assert";
import * as vscode from "vscode";
import { SetupProgressTracker, SetupProgressEvent } from "../setup_utilities/setup-progress";

suite("Setup Progress Tracker Test Suite", () => {
    test("failInProgressSteps marks active step as failed", () => {
        const emitter = new vscode.EventEmitter<SetupProgressEvent>();
        const events: SetupProgressEvent[] = [];
        emitter.event((e) => events.push(e));

        const tracker = new SetupProgressTracker("Test", [
            { id: "step-a", label: "Step A" },
            { id: "step-b", label: "Step B" },
        ], emitter);

        tracker.startStep("step-a", "Running...");

        const changed = tracker.failInProgressSteps("Unexpected failure");
        assert.strictEqual(changed, true);

        const last = events[events.length - 1];
        assert.strictEqual(last.type, "failed");
        const stepA = last.steps.find(s => s.id === "step-a");
        const stepB = last.steps.find(s => s.id === "step-b");
        assert.strictEqual(stepA?.status, "failed");
        assert.strictEqual(stepA?.detail, "Unexpected failure");
        assert.strictEqual(stepB?.status, "pending");
    });

    test("failInProgressSteps returns false when no step is active", () => {
        const emitter = new vscode.EventEmitter<SetupProgressEvent>();
        const events: SetupProgressEvent[] = [];
        emitter.event((e) => events.push(e));

        const tracker = new SetupProgressTracker("Test", [
            { id: "step-a", label: "Step A" },
        ], emitter);

        const countBefore = events.length;
        const changed = tracker.failInProgressSteps("No active step");
        assert.strictEqual(changed, false);
        assert.strictEqual(events.length, countBefore);
    });
});
