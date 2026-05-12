// Zephyr IDE Settings Panel — Webview entry point
// Registers @vscode-elements custom elements and Lit components.

import '@vscode-elements/elements/dist/vscode-button/index.js';
import '@vscode-elements/elements/dist/vscode-checkbox/index.js';
import '@vscode-elements/elements/dist/vscode-textfield/index.js';
import '@vscode-elements/elements/dist/vscode-single-select/index.js';
import '@vscode-elements/elements/dist/vscode-option/index.js';
import '@vscode-elements/elements/dist/vscode-badge/index.js';
import '@vscode-elements/elements/dist/vscode-divider/index.js';
import '@vscode-elements/elements/dist/vscode-label/index.js';

// Import Lit components — side-effect registrations via @customElement
import './components/settings-app';
import '../webview_shared/runner-variants-editor';
