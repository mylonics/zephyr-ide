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

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import { ChildProcess, spawn } from "child_process";
import type { BuildConfig } from "../project_utilities/build_selector";
import { outputInfo, outputWarning } from "./output";

export function getBuildLogPath(rootPath: string, projectName: string, build: Pick<BuildConfig, "name" | "saveBuildLog" | "buildLogDir">): string | undefined {
  if (build.saveBuildLog !== true) { return undefined; }
  const safeName = (name: string) => name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `${safeName(projectName)}-${safeName(build.name)}-${timestamp}-${randomUUID()}.log`;
  return path.join(path.resolve(rootPath, build.buildLogDir || "logs"), filename);
}

/** A build task that streams output to both the terminal and disk without buffering the whole build. */
export class LoggedTaskTerminal implements vscode.Pseudoterminal {
  private readonly writeEmitter = new vscode.EventEmitter<string>();
  private readonly closeEmitter = new vscode.EventEmitter<number>();
  readonly onDidWrite = this.writeEmitter.event;
  readonly onDidClose = this.closeEmitter.event;
  private child?: ChildProcess;
  private cancelled = false;

  constructor(
    private readonly command: string,
    private readonly cwd: string | undefined,
    private readonly env: NodeJS.ProcessEnv | undefined,
    readonly logFile: string,
  ) {}

  open(): void {
    void this.run().catch(error => {
      this.writeEmitter.fire(`Build logging failed: ${error}\r\n`);
      outputWarning("Build Log", String(error));
      this.closeEmitter.fire(1);
    });
  }

  private async run(): Promise<void> {
    await fs.promises.mkdir(path.dirname(this.logFile), { recursive: true });
    const log = fs.createWriteStream(this.logFile, { flags: "wx" });
    const logClosed = new Promise<void>(resolve => log.once("close", resolve));
    let logFailed = false;
    log.on("error", error => {
      logFailed = true;
      this.writeEmitter.fire(`Build log write failed: ${error.message}\r\n`);
      outputWarning("Build Log", error.message);
      this.child?.stdout?.resume();
      this.child?.stderr?.resume();
    });
    const opened = await new Promise<boolean>(resolve => {
      log.once("open", () => resolve(true));
      log.once("error", () => resolve(false));
    });
    if (!opened || this.cancelled) {
      log.end();
      await logClosed;
      this.closeEmitter.fire(1);
      return;
    }

    outputInfo("Build Log", `Saving build output to ${this.logFile}`);
    this.writeEmitter.fire(`Build log: ${this.logFile}\r\n${this.command}\r\n`);
    const env: NodeJS.ProcessEnv = { ...process.env, ...this.env, PYTHONUNBUFFERED: "1" };
    if (process.platform === "win32") {
      const pathKey = Object.keys(this.env ?? {}).find(key => key.toLowerCase() === "path");
      const value = (pathKey ? this.env?.[pathKey] : undefined) ?? process.env.Path ?? process.env.PATH;
      for (const key of Object.keys(env)) {
        if (key.toLowerCase() === "path") { delete env[key]; }
      }
      if (value) { Object.assign(env, { Path: value }); }
    }
    const windows = process.platform === "win32";
    const executable = windows ? "powershell.exe" : this.command;
    // Pass PowerShell's full parameter names explicitly and preserve west's exit code.
    const args = windows ? ["-NoLogo", "-NoProfile", "-Command", `$ErrorActionPreference = 'Stop'; ${this.command}; exit $LASTEXITCODE`] : [];
    const child = this.child = spawn(executable, args, {
      cwd: this.cwd || undefined,
      env,
      shell: !windows,
      detached: !windows,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const write = (data: string) => {
      this.writeEmitter.fire(data.replace(/\r?\n/g, "\r\n"));
      if (!logFailed && !log.write(data)) {
        child.stdout?.pause();
        child.stderr?.pause();
      }
    };
    log.on("drain", () => {
      child.stdout?.resume();
      child.stderr?.resume();
    });
    child.stdout?.setEncoding("utf8").on("data", write);
    child.stderr?.setEncoding("utf8").on("data", write);
    child.on("error", error => write(`Build process failed: ${error.message}\n`));
    const exitCode = await new Promise<number>(resolve => child.once("close", code => resolve(code ?? 1)));
    this.child = undefined;
    log.end();
    await logClosed;
    this.closeEmitter.fire(this.cancelled ? 1 : exitCode);
  }

  handleInput(data: string): void {
    if (data.includes("\x03")) {
      this.close();
    } else {
      this.child?.stdin?.write(data);
    }
  }

  close(): void {
    this.cancelled = true;
    const child = this.child;
    if (!child?.pid) { return; }
    if (process.platform === "win32") {
      const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      killer.on("error", () => child.kill());
    } else {
      try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill(); }
    }
  }
}
