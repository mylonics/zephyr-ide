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

/** Minimal VS Code webview API surface exposed by acquireVsCodeApi(). */
export interface WebviewApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

/** Declare the global provided by VS Code's webview host. */
declare function acquireVsCodeApi(): WebviewApi;

/** Lazily acquired singleton – call once per webview entry point. */
let _api: WebviewApi | undefined;
export function getVsCodeApi(): WebviewApi {
  if (!_api) {
    _api = acquireVsCodeApi();
  }
  return _api;
}

/** Escape HTML-special characters to prevent XSS in webview. */
export function escapeHtml(str: string | null | undefined): string {
  if (!str) { return ''; }
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
