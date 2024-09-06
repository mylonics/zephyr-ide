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

import { workspace } from "vscode";
import * as vscode from "vscode";
import * as path from "path";
import * as util from "util";
import * as cp from "child_process";

import { pathdivider, SetupState, getToolchainDir } from "../setup_utilities/setup";
import { getShellEnvironment } from "./utils";
import { getPlatformName } from "../setup_utilities/setup_toolchain";

export function getRootPath() {
  let rootPaths = workspace.workspaceFolders;
  if (rootPaths === undefined) {
    return;
  } else {
    return rootPaths[0].uri;
  }
}

class Defer<T> {
  promise: Promise<T>;
  resolve!: (value: T | PromiseLike<T>) => void;
  reject!: (reason?: any) => void;

  constructor() {
    this.promise = new Promise<T>((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
  }
}


class Task {
  term: vscode.Terminal;
  cmd: string | undefined;
  deferPromise: Defer<{ code: number | undefined, stdout: string }> = new Defer<{ code: number | undefined, stdout: string }>;
  ready: boolean = false;
  sourceTerminal: boolean;
  inputStream!: AsyncIterable<string>;
  startedExecution: boolean = false;

  constructor(cmd: string | undefined, term: vscode.Terminal, sourceTerminal: boolean) {
    this.cmd = cmd;
    this.term = term;
    this.sourceTerminal = sourceTerminal;
  }

  getResult() {
    return this.deferPromise.promise;;
  }

}

class TaskManager {
  tasks: Set<Task> = new Set<Task>;

  constructor(message: string) {
    this.loadSetupTerminal();
  }

  addTask(terminal: vscode.Terminal) {
    for (const t of this.tasks) {
      if (t.term.processId === terminal.processId) {
        return true;
      }
    }
    this.tasks.add(new Task("", terminal, true));
    return false;
  }

  getTask(terminal: vscode.Terminal) {
    for (let c of this.tasks) {
      if (c.term === terminal) {
        return c;
      }
    }
  }

  async loadSetupTerminal() {
    vscode.window.onDidChangeTerminalShellIntegration(async ({ terminal, shellIntegration }) => {
      if (terminal.name === "Zephyr IDE Terminal") {
        this.addTask(terminal);
        let task = this.getTask(terminal);
        if (task && !task.ready) {
          let execution: vscode.TerminalShellExecution | undefined = undefined;
          if (!task.ready && task.sourceTerminal) {
            if (getPlatformName() === "windows") {
              execution = shellIntegration.executeCommand(".\\.venv\\Scripts\\activate; ");
            } else {
              execution = shellIntegration.executeCommand("source .\\.venv\\Scripts\\activate && clc;");
            }
          } else if (task.cmd && terminal.shellIntegration) {
            execution = terminal.shellIntegration.executeCommand(task.cmd);
            task.startedExecution = true;
          }
          if (execution) {
            task.ready = true;
            task.inputStream = execution.read();
          }

          vscode.window.onDidEndTerminalShellExecution(async event => {
            if (event.execution === execution) {
              let outputstring: string = "";
              for await (const data of task.inputStream) {
                outputstring = outputstring + data;
                console.log(data);
              }
              if (task.cmd && !task.startedExecution && terminal.shellIntegration) {
                console.log(`Terminal for task ${task.cmd} is ready`);
                task.startedExecution = true;
                execution = terminal.shellIntegration.executeCommand(task.cmd);
                task.inputStream = execution.read();
                outputstring = "";
              } else {
                task.deferPromise.resolve({ code: event.exitCode, stdout: outputstring });
                console.log(`Setup ${task?.cmd} exited with code ${event.exitCode}`);
              }
            }
          });
        }
      }
    }
    );
  };



  async createTerminal(cmd: string, setupState: SetupState | undefined, show = false) {
    let opts: vscode.TerminalOptions = {
      name: "Zephyr IDE Terminal",
      env: getShellEnvironment(setupState, true),
      strictEnv: true,
      hideFromUser: !show
    };

    let setup_terminal = await vscode.window.createTerminal(opts);
    if (show) {
      setup_terminal.show();
    }
    let command = new Task(cmd, setup_terminal, setupState !== undefined);
    if (this.tasks.has(command)) {
      console.log("command already in termianls");
    }
    this.tasks.add(command);

    vscode.window.onDidCloseTerminal(t => {
      let task = this.getTask(t);
      if (task) {
        this.tasks.delete(task);
      }
    });
    return command;
  }

};


export let t = new TaskManager("world");
