(function () {
  const vscode = acquireVsCodeApi();
  const tree = document.querySelector('#workspace-tree');
  let prevData = [];

  window.addEventListener('message', event => {
    const message = event.data; // The JSON data our extension sent
    tree.data = message;
    // Keep a deep copy to restore open states when needed
    try {
      prevData = JSON.parse(JSON.stringify(message));
    } catch {
      prevData = message;
    }
  });

  function findWorkspaceItemByPath(data, installPath) {
    if (!Array.isArray(data)) {
      return undefined;
    }
    return data.find(item => item && item.value && item.value.installPath === installPath);
  }

  function getActiveWorkspacePath(data) {
    if (!Array.isArray(data)) {
      return undefined;
    }
    const active = data.find(item => item && item.selected);
    return active && active.value ? active.value.installPath : undefined;
  }

  function revertOpenStateIfNeeded(selectedInstallPath) {
    const activeWorkspace = getActiveWorkspacePath(prevData);
    if (activeWorkspace === selectedInstallPath) {
      return false;
    }
    const currItem = findWorkspaceItemByPath(tree.data, selectedInstallPath);
    const prevItem = findWorkspaceItemByPath(prevData, selectedInstallPath);
    if (currItem && prevItem && typeof prevItem.open === 'boolean') {
      currItem.open = prevItem.open;
      tree.data = [...tree.data];
    }
    return true;
  }

  tree.addEventListener('vsc-select', (event) => {
    const val = event.detail.value;
    
    // Check if this is a click on the workspace item itself (not a sub-action)
    const isWorkspaceClick = val && val.installPath && !val.command;
    
    if (isWorkspaceClick) {
      const selectedInstallPath = val.installPath;
      // Revert open state if clicking on non-active workspace
      if (revertOpenStateIfNeeded(selectedInstallPath)) {
        // Send message to prompt user to switch workspace
        vscode.postMessage({ 
          command: 'workspace-click', 
          installPath: selectedInstallPath,
          treeData: tree.data 
        });
        return;
      }
    }
    
    // Handle sub-action clicks (these have a command property)
    if (val && val.command) {
      vscode.postMessage({
        command: val.command,
        installPath: val.installPath
      });
    }
  });

}());
