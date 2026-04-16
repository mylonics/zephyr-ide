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

export type BuildArgValue = string | string[] | undefined;

/** Convert build args to a normalized array representation. */
export function normalizeBuildArgs(value: BuildArgValue): string[] {
  if (Array.isArray(value)) {
    return value
      .map((entry) => String(entry).trim())
      .filter((entry) => entry.length > 0);
  }
  if (typeof value !== "string") {
    return [];
  }
  return splitBuildArgs(value);
}

/** Split a shell-like argument string into individual arguments. */
export function splitBuildArgs(value: string): string[] {
  const input = value.trim();
  if (!input) {
    return [];
  }

  const parts: string[] = [];
  let current = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let tokenStarted = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (char === "\\") {
      const next = input[i + 1];
      if (next !== undefined) {
        current += next;
        tokenStarted = true;
        i++;
      } else {
        current += char;
        tokenStarted = true;
      }
      continue;
    }

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      tokenStarted = true;
      continue;
    }

    if (char === "\"" && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      tokenStarted = true;
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote && /\s/.test(char)) {
      if (tokenStarted) {
        parts.push(current);
        current = "";
        tokenStarted = false;
      }
      continue;
    }

    current += char;
    tokenStarted = true;
  }

  if (tokenStarted) {
    parts.push(current);
  }

  return parts;
}

/** Quote an argument for shell command construction when needed. */
export function quoteBuildArgForShell(arg: string): string {
  if (arg.length === 0) {
    return "\"\"";
  }
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(arg)) {
    return arg;
  }
  return `"${arg.replace(/(["\\$`])/g, "\\$1")}"`;
}

/**
 * Build a CMake -D flag, single-quoted.
 * Backslashes in the value are normalized to forward slashes so that CMake
 * receives valid paths on Windows without shell-escaping issues.
 * Single quotes are used because PowerShell preserves them as literal strings,
 * whereas double quotes are stripped before cmake sees them.
 */
export function quoteCMakeDef(key: string, value: string): string {
  const normalized = value.replace(/\\/g, '/');
  return `-D${key}='${normalized}'`;
}

/** Join argument list safely for shell command usage. */
export function joinBuildArgsForShell(value: BuildArgValue): string {
  return normalizeBuildArgs(value)
    .map((entry) => quoteBuildArgForShell(entry))
    .join(" ");
}

/** Join argument list for display usage. */
export function joinBuildArgsForDisplay(value: BuildArgValue): string {
  return normalizeBuildArgs(value).join(" ");
}

/** @deprecated Use joinBuildArgsForDisplay() or joinBuildArgsForShell(). */
export function joinBuildArgs(value: BuildArgValue): string {
  return joinBuildArgsForDisplay(value);
}
