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

import { LitElement } from "lit";
import { getVsCodeApi, WebviewApi } from "./webviewTypes";

/**
 * Base class for all Zephyr IDE webview Lit components.
 *
 * Renders into light DOM so that the external panel CSS and codicon
 * stylesheets apply to all Lit-rendered content.
 *
 * - Provides access to the VS Code webview API via `this.vscodeApi`.
 * - Includes a `postCommand()` helper for sending messages.
 */
export class ZephyrLitElement extends LitElement {
  protected readonly vscodeApi: WebviewApi = getVsCodeApi();

  /** Render into light DOM — external CSS applies to component content. */
  protected createRenderRoot(): this {
    return this;
  }

  /** Send a command message to the extension host. */
  protected postCommand(command: string, data: Record<string, string> = {}): void {
    this.vscodeApi.postMessage({ command, ...data });
  }
}
