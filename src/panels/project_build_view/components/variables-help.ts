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

import { html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { ZephyrLitElement } from "../../webview_shared/lit-base";
import type { WebviewVariableCommandInfo } from "../project-build-data";

@customElement("variables-help")
export class VariablesHelp extends ZephyrLitElement {
  @property({ type: Array }) commands: WebviewVariableCommandInfo[] = [];

  private get _builtInCommands() {
    return this.commands.filter(c =>
      !c.command.includes("get-active-project-variable") &&
      !c.command.includes("get-active-build-variable") &&
      !c.command.includes("get-zephyr-ide-json-variable"),
    );
  }

  private get _customVarCommands() {
    return this.commands.filter(c =>
      c.command.includes("get-active-project-variable") ||
      c.command.includes("get-active-build-variable") ||
      c.command.includes("get-zephyr-ide-json-variable"),
    );
  }

  private _renderTable(cmds: WebviewVariableCommandInfo[]) {
    return html`
      <vscode-table zebra bordered-rows>
        <vscode-table-header slot="header">
          <vscode-table-header-cell>Variable</vscode-table-header-cell>
          <vscode-table-header-cell>Description</vscode-table-header-cell>
        </vscode-table-header>
        <vscode-table-body slot="body">
          ${cmds.map(
      (c) => html`
            <vscode-table-row>
              <vscode-table-cell><code>${c.command}</code></vscode-table-cell>
              <vscode-table-cell>${c.description}</vscode-table-cell>
            </vscode-table-row>
          `,
    )}
        </vscode-table-body>
      </vscode-table>
    `;
  }

  render() {
    return html`
      <div class="variables-help-content">
        <p>
          Zephyr IDE exposes project and build information as VS Code command variables.
          Use them in <code>launch.json</code> and <code>tasks.json</code> with the <code>\${command:...}</code> syntax.
        </p>

        <h4>Built-in Variables</h4>
        ${this._renderTable(this._builtInCommands)}

        <div class="help-example">
          <h4>Example: launch.json</h4>
          <pre><code>{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Zephyr IDE: Debug",
      "type": "cortex-debug",
      "request": "launch",
      "gdbPath": "\${command:zephyr-ide.get-gdb-path}",
      "executable": "\${command:zephyr-ide.get-zephyr-elf}"
    }
  ]
}</code></pre>
        </div>

        <h4>Custom Variables</h4>
        <p>
          Define custom key-value pairs in the project or build variable tables
          and reference them with these commands.
        </p>
        ${this._renderTable(this._customVarCommands)}

        <div class="help-example">
          <h4>Example: tasks.json</h4>
          <pre><code>{
  "version": "2.0.0",
  "inputs": [
    {
      "id": "myProjectVar",
      "type": "command",
      "command": "zephyr-ide.get-active-project-variable",
      "args": "my_var"
    },
    {
      "id": "myBuildVar",
      "type": "command",
      "command": "zephyr-ide.get-active-build-variable",
      "args": "bmp_port"
    }
  ]
}</code></pre>
        </div>

        <div class="help-example">
          <h4>Example: launch.json using custom variables</h4>
          <pre><code>{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "My Custom Debug",
      "type": "cortex-debug",
      "request": "launch",
      "BMPGDBSerialPort": "\${input:myBuildVar}",
      "executable": "\${command:zephyr-ide.get-zephyr-elf}"
    }
  ]
}</code></pre>
        </div>
      </div>
    `;
  }
}
