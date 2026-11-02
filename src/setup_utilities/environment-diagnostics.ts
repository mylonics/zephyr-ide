import { execFile } from "child_process";
import * as path from "path";
import { promisify } from "util";

type Environment = Record<string, string | undefined>;

export interface WindowsEnvironmentSnapshot {
  user: Environment;
  machine: Environment;
  process: Environment;
}

export interface EnvironmentIssue {
  code: "missingVariables" | "missingPathEntries" | "tempMismatch" | "duplicatePathEntries" | "systemPathEntries" | "pathTooLong";
  message: string;
}

function caseInsensitiveEnvironment(env: Environment): Environment {
  return Object.fromEntries(Object.entries(env).map(([key, value]) => [key.toLowerCase(), value]));
}

function expand(value: string, env: Environment): string {
  const seen = new Set<string>();
  for (let i = 0; i < 10 && !seen.has(value); i++) {
    seen.add(value);
    value = value.replace(/%([^%]+)%/g, (match, name: string) => env[name.toLowerCase()] ?? match);
  }
  return value;
}

function normalizePath(value: string): string {
  const unquoted = value.trim().replace(/^"(.*)"$/, "$1");
  if (!unquoted) {
    return "";
  }
  const normalized = path.win32.normalize(unquoted);
  return (normalized === path.win32.parse(normalized).root ? normalized : normalized.replace(/\\$/, "")).toLowerCase();
}

function pathEntries(value: string, env: Environment): string[] {
  return expand(value, env).split(";").filter(entry => entry.trim() !== "").map(normalizePath);
}

export function analyzeWindowsEnvironment(snapshot: WindowsEnvironmentSnapshot): EnvironmentIssue[] {
  const user = caseInsensitiveEnvironment(snapshot.user);
  const machine = caseInsensitiveEnvironment(snapshot.machine);
  const session = caseInsensitiveEnvironment(snapshot.process);
  const registered = { ...session, ...machine, ...user };
  const userEntries = pathEntries(user.path ?? "", registered);
  const systemEntries = new Set(pathEntries(machine.path ?? "", { ...session, ...machine }));
  const sessionEntries = new Set(pathEntries(session.path ?? "", session));
  const issues: EnvironmentIssue[] = [];

  const missingVariables = Object.keys(user).filter(name => session[name] === undefined);
  if (missingVariables.length) {
    issues.push({ code: "missingVariables", message: `User environment variables missing from PowerShell: ${missingVariables.join(", ")}.` });
  }
  const missingEntries = new Set(userEntries.filter(entry => !sessionEntries.has(entry)));
  if (missingEntries.size) {
    issues.push({ code: "missingPathEntries", message: `${missingEntries.size} user PATH entry/entries are missing from PowerShell PATH.` });
  }
  if (user.temp !== undefined && normalizePath(expand(user.temp, registered)) !== normalizePath(expand(session.temp ?? "", session))) {
    issues.push({ code: "tempMismatch", message: "PowerShell TEMP does not match the registered user TEMP value." });
  }
  const duplicates = userEntries.length - new Set(userEntries).size;
  if (duplicates) {
    issues.push({ code: "duplicatePathEntries", message: `User PATH contains ${duplicates} repeated entry/entries.` });
  }
  const systemDuplicates = new Set(userEntries.filter(entry => systemEntries.has(entry)));
  if (systemDuplicates.size) {
    issues.push({ code: "systemPathEntries", message: `User PATH repeats ${systemDuplicates.size} system PATH entry/entries; Windows already combines these paths.` });
  }
  if (expand(`${machine.path ?? ""};${user.path ?? ""}`, registered).length >= 32767) {
    issues.push({ code: "pathTooLong", message: "The combined system and user PATH reaches the Windows environment-variable length limit (32,767 characters)." });
  }
  return issues;
}

export async function readWindowsEnvironment(): Promise<WindowsEnvironmentSnapshot> {
  // Bypass PATH lookup and shell profiles so broken inherited settings cannot hide the problem.
  const powershell = path.win32.join(
    process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"
  );
  const script = `
    $ErrorActionPreference = 'Stop'
    [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding
    @{
      user = [Environment]::GetEnvironmentVariables('User')
      machine = [Environment]::GetEnvironmentVariables('Machine')
      process = [Environment]::GetEnvironmentVariables('Process')
    } | ConvertTo-Json -Depth 3 -Compress
  `;
  const { stdout } = await promisify(execFile)(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 10000,
    maxBuffer: 4 * 1024 * 1024,
  });
  const snapshot: WindowsEnvironmentSnapshot = JSON.parse(stdout.trim().replace(/^\uFEFF/, ""));
  for (const env of [snapshot.user, snapshot.machine, snapshot.process]) {
    if (!env || typeof env !== "object" || Array.isArray(env) || Object.values(env).some(value => typeof value !== "string")) {
      throw new Error("Invalid Windows environment snapshot");
    }
  }
  return snapshot;
}
