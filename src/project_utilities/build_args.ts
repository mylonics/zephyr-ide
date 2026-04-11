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
  const tokenRegex = /[^\s"']+|"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'/g;
  let match: RegExpExecArray | null;
  while ((match = tokenRegex.exec(input)) !== null) {
    const token = (match[1] ?? match[2] ?? match[0]).trim();
    if (token.length > 0) {
      parts.push(token);
    }
  }

  return parts;
}

/** Join argument list for display/CLI usage. */
export function joinBuildArgs(value: BuildArgValue): string {
  return normalizeBuildArgs(value).join(" ");
}
