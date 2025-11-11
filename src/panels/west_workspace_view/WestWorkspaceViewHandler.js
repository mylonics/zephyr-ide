(function () {
  const vscode = acquireVsCodeApi();
  const tree = document.querySelector('#workspace-tree');

  window.addEventListener('message', event => {
    const message = event.data; // The JSON data our extension sent
    tree.data = message;
  });

  tree.addEventListener('vsc-select', (event) => {
    const val = event.detail.value;
    
    // Handle sub-item clicks (these have a command property)
    if (val && val.command) {
      vscode.postMessage({
        command: val.command,
        installPath: val.installPath
      });
    }
  });

  tree.addEventListener('vsc-run-action', (event) => {
    vscode.postMessage({ 
      actionId: event.detail.actionId, 
      value: event.detail.value 
    });
  });

}());
