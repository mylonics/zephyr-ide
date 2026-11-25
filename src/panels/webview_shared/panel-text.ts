const data = document.getElementById("zephyr-ide-messages")?.textContent;
const messages: Record<string, string> = data ? JSON.parse(data) : {};

/** Use the message bundle already selected by the extension host for this window. */
export function panelText(message: string, ...values: unknown[]): string {
  const template = messages[message] ?? message;
  return values.length ? template.replace(/\{(\d+)\}/g, (token, index) =>
    Number(index) < values.length ? String(values[Number(index)]) : token) : template;
}
