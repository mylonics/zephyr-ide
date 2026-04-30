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
  // Escape ", \, and ` (shell special chars inside double quotes).
  // Also escape $( to block command substitution in POSIX shells (bash/sh/zsh).
  // ${VAR} and $VAR are intentionally left unescaped so environment variable
  // references in build args are expanded at runtime by the shell.
  // NOTE: PowerShell also treats $() as a subexpression inside double quotes.
  // Users should rely on VS Code workspace trust to prevent malicious configs
  // from exploiting this; only open workspaces from trusted sources.
  return `"${arg.replace(/(["\\`]|\$\()/g, "\\$1")}"`;
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

/**
 * Normalize a user-specified cmake -D argument before it is shell-quoted.
 *
 * Two transformations are applied so that array-format entries behave
 * identically to the legacy shell-string format:
 *
 * 1. Strip surrounding shell quotes from the value portion.
 *    e.g. -DKEY='val'  → -DKEY=val
 *         -DKEY="val"  → -DKEY=val
 *    The legacy string format went through splitBuildArgs which stripped
 *    these quotes; the array format must do the same so that cmake receives
 *    the value without literal quote characters.
 *    Only a cleanly quoted value (no embedded matching quote) is stripped,
 *    so -DKEY='it''s' is left untouched.
 *
 * 2. Normalize backslashes to forward slashes in the value, matching what
 *    quoteCMakeDef does for compiler-generated defs like CONF_FILE.
 *    This prevents Windows paths from being double-escaped when the arg is
 *    subsequently wrapped in double quotes by quoteBuildArgForShell.
 *
 * Non -D arguments (e.g. -GNinja) are returned unchanged.
 */
export function normalizeCMakeArg(arg: string): string {
  // Strip surrounding shell quotes from value: -DKEY='val' or -DKEY="val"
  const stripped = arg.replace(
    /^(-D[^=]+=)('([^']*)'|"([^"]*)")$/,
    (_full, prefix: string, _quoted: string, sq?: string, dq?: string) => prefix + (sq ?? dq ?? ""),
  );
  // Normalize backslashes to forward slashes (same as quoteCMakeDef)
  return stripped.replace(/\\/g, '/');
}

/**
 * Quote a user-supplied cmake -D argument for shell use.
 *
 * The value portion is single-quoted, matching the strategy used by
 * quoteCMakeDef for all internally-generated defs (CONF_FILE, BOARD_ROOT,
 * DTC_OVERLAY_FILE, etc.). Single quotes protect the value from shell expansion
 * identically on bash, zsh, AND PowerShell — so ${ZEPHYR_BASE}-style references
 * are passed literally to CMake, which then expands them as CMake variables
 * (set by west during configuration) or as CMake env-var syntax ($ENV{VAR}).
 *
 * Non -D arguments (e.g. -GNinja, --sysbuild) fall through to
 * quoteBuildArgForShell so that west flags are handled correctly.
 *
 * Embedded single quotes in the value are escaped with the POSIX '\''
 * sequence, which also works in PowerShell.
 */
export function quoteUserCMakeArgForShell(arg: string): string {
  const match = arg.match(/^(-D[^=]+=)([\s\S]*)$/);
  if (!match) {
    return quoteBuildArgForShell(arg);
  }
  const prefix = match[1]; // e.g. -DKCONFIG_ROOT=
  const value  = match[2]; // everything after the first =

  // No quoting needed when the value contains only shell-safe chars.
  if (/^[A-Za-z0-9_@%+=:,./-]*$/.test(value)) {
    return arg;
  }
  // Single-quote the value. Embedded single quotes use the POSIX '\'' escape
  // (terminate the single-quoted string, emit a literal ', reopen).
  return `${prefix}'${value.replace(/'/g, "'\\''")}'`;
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
