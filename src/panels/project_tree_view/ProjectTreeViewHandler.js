(function () {
  const vscode = acquireVsCodeApi();
  const tree = document.querySelector('#project-tree');
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

  function findProjectItemByName(data, name) {
    if (!Array.isArray(data)) {
      return undefined;
    }
    return data.find(item => item && item.value && item.value.project === name);
  }

  function getActiveProjectName(data) {
    if (!Array.isArray(data)) {
      return undefined;
    }
    const active = data.find(item => item && item.selected);
    return active && active.value ? active.value.project : undefined;
  }

  function revertOpenStateIfNeeded(selectedProject) {
    const activeProject = getActiveProjectName(prevData);
    if (activeProject === selectedProject) {
      return false;
    }
    const currItem = findProjectItemByName(tree.data, selectedProject);
    const prevItem = findProjectItemByName(prevData, selectedProject);
    if (currItem && prevItem && typeof prevItem.open === 'boolean') {
      currItem.open = prevItem.open;
      tree.data = [...tree.data];
    }
    return true;
  }

  tree.addEventListener('vsc-select', (event) => {
    const val = event.detail.value;
    const isProjectClick = val && val.project && !val.build && !val.runner && !val.test && !val.cmd;
    if (isProjectClick) {
      const selectedProject = val.project;
      if (revertOpenStateIfNeeded(selectedProject)) {
        vscode.postMessage({ command: "setActive", value: val, treeData: tree.data });
        return;
      }
    }
    vscode.postMessage({ command: val && val.cmd ? val.cmd : "setActive", value: val, treeData: tree.data });
  });

  // No additional toggle listeners needed; we already revert open-state on project click when switching active.

  tree.addEventListener("vsc-run-action", (event) => {
    vscode.postMessage({ command: event.detail.actionId, value: event.detail.value, treeData: tree.data });
  });
}());