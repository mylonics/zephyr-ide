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

// ─── Output Channel ──────────────────────────────────────────────────────────

let outputChannel: vscode.OutputChannel | undefined;

/**
 * Initialize the output channel. Must be called once during extension activation.
 */
export function initOutputChannel(channel: vscode.OutputChannel): void {
  outputChannel = channel;
}

/**
 * Get the raw output channel (for legacy callers that use `.show()` / `.append()` directly).
 */
export function getOutputChannel(): vscode.OutputChannel | undefined {
  return outputChannel;
}

// ─── Task Categories ─────────────────────────────────────────────────────────
//
// Instead of generic "[SETUP]" prefixes, callers supply a task label that
// describes the *specific* operation, e.g. "West Init", "SDK Install",
// "Build: my_project/debug", "Flash: my_project/release", etc.

function timestamp(): string {
  return new Date().toISOString();
}

function formatLine(task: string, message: string): string {
  return `[${timestamp()}] [${task}] ${message}`;
}

// ─── Logging Helpers ─────────────────────────────────────────────────────────
//
// Each logging function accepts an optional `notify` boolean as its last
// parameter.  When `true` the function also shows a VS Code notification
// (info / warning / error) with a "Show Output" button so the user can jump
// straight to the output channel.  This eliminates the need for separate
// `outputX` + `notifyX` call‑pairs.

const SHOW_OUTPUT = "Show Output";

/**
 * Write an informational line to the Zephyr IDE output channel.
 *
 * @param task     Short label for the operation, e.g. "West Update", "Build: app/debug"
 * @param message  Human‑readable description
 * @param notify   If `true`, also show an information notification to the user.
 */
export function outputInfo(task: string, message: string, notify = false): void {
  outputChannel?.appendLine(formatLine(task, message));
  if (notify) {
    vscode.window.showInformationMessage(message);
  }
}

/**
 * Write a warning line to the output channel.
 *
 * @param notify  If `true`, also show a warning notification with a "Show Output" button.
 */
export function outputWarning(task: string, message: string, notify = false): void {
  outputChannel?.appendLine(formatLine(task, `⚠ WARNING: ${message}`));
  if (notify) {
    vscode.window.showWarningMessage(message, SHOW_OUTPUT).then(selection => {
      if (selection === SHOW_OUTPUT) {
        showOutput();
      }
    });
  }
}

/**
 * Write an error block to the output channel.
 * Includes the error message and, optionally, the command that was run and the
 * raw stdout / stderr captured from it.
 *
 * @param notify  If `true`, also show an error notification with a "Show Output" button.
 *                The notification displays `message`; the extra detail from `options`
 *                is written only to the output channel.
 */
export function outputError(
  task: string,
  message: string,
  options?: { command?: string; stdout?: string; stderr?: string; detail?: string; notify?: boolean },
): void {
  const detailMsg = options?.detail ?? message;
  outputChannel?.appendLine(formatLine(task, `✖ ERROR: ${detailMsg}`));
  if (options?.command) {
    outputChannel?.appendLine(`  Command: ${options.command}`);
  }
  if (options?.stdout) {
    outputChannel?.appendLine(`  ── stdout (${options.stdout.length} chars) ──`);
    for (const line of options.stdout.split(/\r?\n/)) {
      outputChannel?.appendLine(`  ${line}`);
    }
  }
  if (options?.stderr) {
    outputChannel?.appendLine(`  ── stderr (${options.stderr.length} chars) ──`);
    for (const line of options.stderr.split(/\r?\n/)) {
      outputChannel?.appendLine(`  ${line}`);
    }
  }
  if (options?.notify) {
    vscode.window.showErrorMessage(message, SHOW_OUTPUT).then(selection => {
      if (selection === SHOW_OUTPUT) {
        showOutput();
      }
    });
  }
}

/**
 * Log the raw command that is about to be executed.
 */
export function outputCommand(task: string, cmd: string): void {
  outputChannel?.appendLine(formatLine(task, `Running command: ${cmd}`));
}

/**
 * Log raw output from a process (stdout or stderr).
 * Includes the length of the output to help identify empty results.
 */
export function outputRaw(label: string, text?: string): void {
  outputChannel?.appendLine(`  ── ${label} (${text?.length ?? 0} chars) ──`);
  if (text) {
    outputChannel?.append(text);
    // Ensure a trailing newline so the next log line starts cleanly
    if (text.length > 0 && !text.endsWith("\n")) {
      outputChannel?.appendLine("");
    }
  }
}

/**
 * Bring the Zephyr IDE output panel into view.
 *
 * Use this to proactively open the output panel at the start of long‑running
 * operations (workspace setup, builds, etc.) so the user can follow progress.
 * For error/warning notifications the "Show Output" button (via the `notify`
 * parameter on `outputError` / `outputWarning`) is preferred instead.
 */
export function showOutput(): void {
  outputChannel?.show();
}

// ─── Convenience Notification Wrappers ───────────────────────────────────────
//
// These thin wrappers exist so callers that only need a one‑line notification
// don't have to spell out `{ notify: true }` / `await` every time.

/**
 * Show an **error** notification *and* log the details to the output channel.
 * Convenience wrapper around `outputError(…, { notify: true })`.
 */
export function notifyError(
  task: string,
  message: string,
  options?: { command?: string; stdout?: string; stderr?: string; detail?: string },
): void {
  outputError(task, message, { ...options, notify: true });
}

/**
 * Show a **warning** notification *and* log the details to the output channel.
 * Convenience wrapper around `outputWarning(…, notify=true)`.
 */
export function notifyWarning(
  task: string,
  message: string,
): void {
  outputWarning(task, message, true);
}

/**
 * Show a **warning** notification with custom action buttons, *and* log the
 * details to the output channel.
 *
 * @returns The label of the button the user clicked, or `undefined`.
 */
export async function notifyWarningWithActions(
  task: string,
  message: string,
  actions: string[],
): Promise<string | undefined> {
  outputChannel?.appendLine(formatLine(task, `⚠ WARNING: ${message}`));
  return vscode.window.showWarningMessage(message, ...actions);
}

/**
 * Show a plain **information** notification *and* log to the output channel.
 * Convenience wrapper around `outputInfo(…, notify=true)`.
 */
export function notifyInfo(task: string, message: string): void {
  outputInfo(task, message, true);
}

// ─── Timestamped Line Helper ─────────────────────────────────────────────────
//
// For callers that just want a timestamped line in the output channel without
// a task prefix.  This is a drop‑in replacement for the legacy
// `output.appendLine(…)` calls scattered across the codebase.

/**
 * Write a timestamped line to the output channel **without** a task prefix.
 */
export function outputLine(message: string): void {
  outputChannel?.appendLine(`[${timestamp()}] ${message}`);
}

// ─── File / Path "Not Found" Helper ──────────────────────────────────────────

export interface FileNotFoundOptions {
  /** The path that was looked for. */
  expectedPath: string;
  /** Working directory at the time the lookup was performed, if applicable. */
  cwd?: string;
  /** A short description of *what* was expected at that path (e.g. "west.yml manifest"). */
  what?: string;
  /** A suggestion for the user on how to fix the issue. */
  suggestion?: string;
  /** Also show a VS Code error notification. */
  notify?: boolean;
}

/**
 * Log detailed context about a file or directory that could not be found.
 *
 * This should be preferred over bare `console.log("not found …")` calls so
 * that the user (and developers) get enough information to diagnose the issue.
 */
export function outputFileNotFound(
  task: string,
  options: FileNotFoundOptions,
): void {
  const what = options.what ?? "File";
  const lines: string[] = [
    `${what} not found: ${options.expectedPath}`,
  ];
  if (options.cwd) {
    lines.push(`  Working directory : ${options.cwd}`);
  }
  if (options.suggestion) {
    lines.push(`  Suggestion        : ${options.suggestion}`);
  }

  // Write every line with timestamp + task prefix
  for (const line of lines) {
    outputChannel?.appendLine(formatLine(task, line));
  }

  if (options.notify) {
    const SHOW = "Show Output";
    vscode.window.showErrorMessage(
      `${what} not found: ${options.expectedPath}`,
      SHOW,
    ).then(sel => {
      if (sel === SHOW) {
        showOutput();
      }
    });
  }
}

// ─── Shell Command Result Type & Failure Helper ──────────────────────────────

/**
 * Extended result returned by `executeShellCommand` / `executeShellCommandInPythonEnv`.
 *
 * Besides stdout/stderr it carries the command, cwd, and environment that were
 * used so that any caller can produce a rich diagnostic on failure without
 * having to re-assemble that information.
 */
export interface ShellCommandResult {
  stdout: string | undefined;
  stderr: string | undefined;
  /** The command that was executed. */
  cmd: string;
  /** The working directory the command ran in. */
  cwd: string;
  /** The environment variables the command ran with (may be large). */
  env: NodeJS.ProcessEnv;
}

/**
 * Dump everything we know about a failed shell command to the output channel.
 *
 * Call this whenever `executeShellCommand*` returns a result whose `stdout` is
 * undefined / empty and you want the user to be able to diagnose the failure.
 *
 * @param task   Short label for the operation (e.g. "West List", "Board Selection").
 * @param result The full {@link ShellCommandResult} returned by the command.
 * @param notify If `true`, also pop an error notification with a "Show Output" button.
 */
export function outputCommandFailure(
  task: string,
  result: ShellCommandResult,
  notify = false,
): void {
  outputChannel?.appendLine(formatLine(task, `✖ Command failed`));
  outputChannel?.appendLine(`  Command : ${result.cmd}`);
  outputChannel?.appendLine(`  Cwd     : ${result.cwd || '(not set)'}`);

  // Print the env vars that are most likely relevant to Zephyr/west/Python.
  // Dumping the full env would be hundreds of lines, so we filter.
  const interestingKeys = [
    'PATH', 'Path', 'path', 'VIRTUAL_ENV', 'ZEPHYR_BASE', 'ZEPHYR_SDK_INSTALL_DIR',
    'ZEPHYR_TOOLCHAIN_VARIANT', 'PYTHONPATH', 'PYTHONHOME',
    'WEST_CONFIG_FILE', 'CMAKE_PREFIX_PATH',
  ];
  const envLines: string[] = [];
  for (const key of interestingKeys) {
    if (result.env[key]) {
      envLines.push(`    ${key}=${result.env[key]}`);
    }
  }
  if (envLines.length > 0) {
    outputChannel?.appendLine(`  Env (relevant):`);
    for (const line of envLines) {
      outputChannel?.appendLine(line);
    }
  }

  if (result.stdout) {
    outputChannel?.appendLine(`  ── stdout (${result.stdout.length} chars) ──`);
    for (const line of result.stdout.split(/\r?\n/)) {
      outputChannel?.appendLine(`  ${line}`);
    }
  }
  if (result.stderr) {
    outputChannel?.appendLine(`  ── stderr (${result.stderr.length} chars) ──`);
    for (const line of result.stderr.split(/\r?\n/)) {
      outputChannel?.appendLine(`  ${line}`);
    }
  }

  if (notify) {
    vscode.window.showErrorMessage(
      `${task}: command failed — ${result.cmd}`,
      SHOW_OUTPUT,
    ).then(sel => {
      if (sel === SHOW_OUTPUT) {
        showOutput();
      }
    });
  }
}
