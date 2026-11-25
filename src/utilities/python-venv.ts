// SPDX-License-Identifier: Apache-2.0
import { join } from "path";

export function pythonInVenv(directory: string): string {
  return process.platform === "win32"
    ? join(directory, "Scripts", "python.exe")
    : join(directory, "bin", "python");
}
