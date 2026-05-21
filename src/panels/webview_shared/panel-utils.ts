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

/** Preferred column for opening/revealing panels (active editor when available). */
export function getActiveEditorColumn(): vscode.ViewColumn | undefined {
  return vscode.window.activeTextEditor?.viewColumn;
}

/** Dispose and drain a panel-local disposable collection. */
export function disposeDisposables(disposables: vscode.Disposable[]): void {
  while (disposables.length > 0) {
    const disposable = disposables.pop();
    if (disposable) {
      disposable.dispose();
    }
  }
}
