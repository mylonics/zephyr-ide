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

import { VariableCommandInfo, getAvailableVariableCommands } from "../../project_utilities/project_info";
import { escapeHtml } from "../webview_shared/webviewTypes";

export function getVariablesReferenceSectionHtml(): string {
  const commands = getAvailableVariableCommands();

  const rows = commands
    .map(
      (c) => `
      <tr>
        <td><code>${escapeHtml(c.command)}</code></td>
        <td>${escapeHtml(c.description)}</td>
      </tr>`,
    )
    .join("\n");

  return `
    <div class="panel-section">
      <div class="collapsible-header" data-toggle="variables-ref">
        <i class="codicon codicon-chevron-right toggle-icon"></i>
        <h3><i class="codicon codicon-symbol-variable"></i> Variable Reference</h3>
      </div>
      <div class="collapsible-body" data-section="variables-ref" style="display:none;">
        <div class="section-body">
          <p class="help-text">
            Zephyr IDE exposes project and build information as VS Code command variables.
            Use them in <code>launch.json</code> and <code>tasks.json</code> with the <code>\${command:...}</code> syntax.
          </p>
          <table class="variables-ref-table">
            <thead>
              <tr>
                <th>Variable</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              ${rows}
            </tbody>
          </table>

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

          <div class="help-example">
            <h4>Example: Custom Variables in tasks.json</h4>
            <pre><code>{
  "version": "2.0.0",
  "inputs": [
    {
      "id": "myBuildVar",
      "type": "command",
      "command": "zephyr-ide.get-active-build-variable",
      "args": "bmp_port"
    }
  ],
  "tasks": [
    {
      "label": "Flash via BMP",
      "type": "shell",
      "command": "arm-none-eabi-gdb",
      "args": ["-ex", "target extended-remote \${input:myBuildVar}"]
    }
  ]
}</code></pre>
          </div>

          <p class="help-text">
            Custom variables are stored in <code>.vscode/zephyr-ide.json</code> under the project or build
            <code>vars</code> key. Edit them using the variable tables above, or directly in the JSON file.
          </p>
        </div>
      </div>
    </div>`;
}
