(function () {
  const vscode = acquireVsCodeApi();
  const tree = document.querySelector('#setup-tree');

  window.addEventListener('message', event => {
    const message = event.data; // The JSON data our extension sent
    tree.data = message;
  });

  tree.addEventListener('vsc-select', (event) => {
    vscode.postMessage({
      command: event.detail.value.command
    });
  });

}());