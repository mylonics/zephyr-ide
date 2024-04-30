(function () {
  const vscode = acquireVsCodeApi();
  const tree = document.querySelector('#basic-example');

  window.addEventListener('message', event => {
    const message = event.data; // The JSON data our extension sent
    tree.data = message;
  });

  tree.addEventListener('vsc-select', (event) => {
    vscode.postMessage({ command: event.detail.value.command ? event.detail.value.command : "setActive", value: event.detail.value });
  });

  tree.addEventListener("vsc-run-action", (event) => {
    vscode.postMessage({ command: event.detail.actionId, value: event.detail.value });
  });

}());