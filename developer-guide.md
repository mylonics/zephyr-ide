# Zephyr IDE for VS Code Developer's Guide

## Prerequisites

* Git (https://git-scm.com/)
* Node.js (https://nodejs.org/)
* Visual Studio Code (https://code.visualstudio.com/)

## Getting Started

### 1. Clone git repository

* Clone this git repository in the current directory of your choice using:
```
git clone https://github.com/mylonics/zephyr-ide.git
```

### 2. Install package dependencies

* Change directories to the `zephyr-ide` directory cloned in Step 1:
```
cd zephyr-ide
```

* Install all the required packages locally to `zephyr-ide/node_modules` using:
```
npm install
```

* (Optional) Install all the required packages globally using:
```
npm install -g
```
This eliminates the need to reinstall packages after a `git clean` of this directory, or any future `git clone` of this repository.


It is recommended that you run `npm install [-g]` again after switching git checkouts, as the required packages may have changed between revisions.

### 3. Open the Extension in VS Code

* Run Visual Studio Code, and close any existing workspaces.
* Select 'File'->'Add Folder to Workspace...' from the top menu bar
* Browse and select to the `zephyr-ide` directory that was cloned in Step 1.

### 4. Run and Debug in VS Code

* Use the Explorer view to open the source file `zephyr-ide/src/extension.ts`
* Run the extension and start debugging:
    - Select 'Run'->'Start Debugging (F5)' from the top menu bar, or
    - Use the Run and Debug view, and click the green 'Start Debugging (F5)' button next to the configuration 'Run Extension (zephyr-ide)'
* A separate VS Code instance will launch to allow you to start debugging the Zephyr IDE extension.

---
## Publishing

### Prepublishing
`vsce publish --pre-release patch`


### Publish
`vsce publish patch`