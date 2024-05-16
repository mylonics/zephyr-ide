(function () {
  const vscode = acquireVsCodeApi();

  const buttons = document.getElementsByTagName("vscode-button");
  for (let index = 0; index < buttons.length; index++) {
    let cmd_button = buttons[index];
    if (cmd_button !== null) {
      cmd_button.addEventListener("click", (event) => {
        event.stopPropagation();
        vscode.postMessage({
          command: cmd_button.getAttribute("name")
        });
      });
    }
  }


}());