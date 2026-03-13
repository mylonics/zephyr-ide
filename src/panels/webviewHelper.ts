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

import * as vscode from 'vscode';
import path from 'upath';
import { getNonce } from "../utilities/getNonce";

export interface WebviewHtmlOptions {
  /** Relative path to the handler JS file from the extension root (e.g. 'src/panels/active_project_view/ActiveProjectViewHandler.js') */
  handlerJsPath: string;
  /** The tree element HTML to place in the body (e.g. '<vscode-tree id="basic-example"></vscode-tree>') */
  treeElementHtml: string;
  /** Whether to include Content Security Policy meta tag (default: true) */
  includeCSP?: boolean;
}

/**
 * Generate the standard webview HTML used by all sidebar panel views.
 * Centralizes the boilerplate of nonce generation, URI resolution, CSP, and
 * linking of shared CSS/JS resources.
 */
export function generateWebviewHtml(
  view: vscode.WebviewView,
  extensionPath: string,
  body: string,
  options: WebviewHtmlOptions
): string {
  const fileUri = (fp: string) => {
    const fragments = fp.split('/');
    return vscode.Uri.file(path.join(extensionPath, ...fragments));
  };

  const assetUri = (fp: string) => {
    return view.webview.asWebviewUri(fileUri(fp));
  };

  const nonce = getNonce();
  const includeCSP = options.includeCSP !== false;

  const cspMeta = includeCSP
    ? `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${view.webview.cspSource}; font-src ${view.webview.cspSource}; img-src ${view.webview.cspSource} https:; script-src 'nonce-${nonce}';">`
    : '';

  return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Zephyr IDE</title>
      <link rel="stylesheet" href="${assetUri('node_modules/@vscode/codicons/dist/codicon.css')}"  id="vscode-codicon-stylesheet">
      <link rel="stylesheet" href="${assetUri('src/panels/view.css')}">
      ${cspMeta}
      <script nonce="${nonce}" src="${assetUri('node_modules/@vscode-elements/elements/dist/bundled.js')}"  type="module"></script>
      <script nonce="${nonce}" src="${assetUri(options.handlerJsPath)}"  type="module"></script>
    </head>
    <body>
    ${options.treeElementHtml}
    ${body}
    </body>
    </html>`;
}

/**
 * Standard resolveWebviewView initialization shared by all sidebar panels.
 * Sets webview options, stores the view reference, registers the visibility
 * change handler, attaches the message listener, and performs the initial render.
 */
export function initWebviewView(
  provider: { view: vscode.WebviewView | undefined },
  webviewView: vscode.WebviewView,
  onVisibilityChange: () => void,
  onMessage: (message: any) => void,
  initialRender: () => void
): void {
  webviewView.webview.options = {
    enableScripts: true,
    enableCommandUris: true,
  };

  provider.view = webviewView;

  webviewView.onDidChangeVisibility(() => {
    if (webviewView.visible) {
      onVisibilityChange();
    }
  });

  webviewView.webview.onDidReceiveMessage(onMessage);

  initialRender();
}
