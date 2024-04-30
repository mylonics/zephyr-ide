(function () {
  const vscode = acquireVsCodeApi();
  const tree = document.querySelector('#basic-example');

  window.addEventListener('message', event => {
    const message = event.data; // The JSON data our extension sent
    tree.data = message;
  });



  tree.addEventListener('vsc-select', (event) => {
    vscode.postMessage({ command: event.detail.value.cmd ? event.detail.value.cmd : "setActive", value: event.detail.value, treeData: tree.data });
  });

  tree.addEventListener("vsc-run-action", (event) => {
    vscode.postMessage({ command: event.detail.actionId, value: event.detail.value, treeData: tree.data });
  });

  document.getElementById('button-1').addEventListener('click', (ev) => {
    console.log(ev);
    vscode.postMessage({
      command: 'alert',
      text: 'Button Pushed'
    });
  });

}());