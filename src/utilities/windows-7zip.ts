// SPDX-License-Identifier: Apache-2.0
import { existsSync } from "fs";
import { delimiter, isAbsolute, join } from "path";

export function windows7ZipDirectory(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (process.platform !== "win32") { return undefined; }
  const searchPath = env.Path ?? env.PATH ?? "";
  for (const entry of searchPath.split(delimiter)) {
    const directory = entry.trim().replace(/^"(.*)"$/, "$1");
    if (isAbsolute(directory) && existsSync(join(directory, "7z.exe"))) { return directory; }
  }
  for (const base of [env.ProgramW6432, env.ProgramFiles, env["ProgramFiles(x86)"]]) {
    if (base && existsSync(join(base, "7-Zip", "7z.exe"))) { return join(base, "7-Zip"); }
  }
  return undefined;
}
