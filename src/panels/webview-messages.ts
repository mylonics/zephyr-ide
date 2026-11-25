import { l10n } from "vscode";

/** Serialize the current language bundle without allowing a message to close the script tag. */
export function webviewMessages(nonce: string): string {
  const json = JSON.stringify(l10n.bundle ?? {}).replace(/</g, "\\u003c");
  return `<script nonce="${nonce}" type="application/json" id="zephyr-ide-messages">${json}</script>`;
}
