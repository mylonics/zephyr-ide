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
 * Shared plain-text logging helpers for test output. Centralizing formatting
 * here keeps console output consistent (no emoji, one indentation scheme)
 * across test-runner.ts, ui-mock-interface.ts, and the workspace-*.test.ts
 * integration suites. This is a leaf module (no project imports) so it can
 * be imported by both test-runner.ts and ui-mock-interface.ts without a
 * circular dependency.
 */

const BANNER_RULE = "-".repeat(60);

/** Top-level action line: "[context] message". */
export function logStep(context: string, message: string): void {
    console.log(`[${context}] ${message}`);
}

/** Indented sub-detail line, meant to follow a preceding logStep call. */
export function logDetail(message: string): void {
    console.log(`  ${message}`);
}

/** Non-fatal warning; always routed through console.warn. */
export function logWarn(context: string, message: string): void {
    console.warn(`[${context}] ${message}`);
}

/** Failure/error output; always routed through console.error. */
export function logError(context: string, message: string): void {
    console.error(`[${context}] ${message}`);
}

/** Fixed-width labeled block for larger dumps (extension output, diagnostics, failure reports). */
export function logBanner(title: string, body: string): void {
    console.log(`\n${BANNER_RULE}\n${title}\n${BANNER_RULE}\n${body}\n${BANNER_RULE}\n`);
}
