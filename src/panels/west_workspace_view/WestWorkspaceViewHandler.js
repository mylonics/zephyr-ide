(function () {
  const vscode = acquireVsCodeApi();
  const tree = document.querySelector('#workspace-tree');

  window.addEventListener('message', event => {
    const message = event.data; // The JSON data our extension sent
    tree.data = message;
  });

  tree.addEventListener('vsc-select', (event) => {
    if (event.detail.value && event.detail.value.command) {
      vscode.postMessage({
        command: event.detail.value.command,
        installPath: event.detail.value.installPath
      });
    }
  });

}());
