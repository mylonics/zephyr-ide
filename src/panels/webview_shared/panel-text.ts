const data = document.getElementById("zephyr-ide-messages")?.textContent;
const messages: Record<string, string> = data ? JSON.parse(data) : {};

/** Use the message bundle already selected by the extension host for this window. */
export function panelText(message: string, ...values: unknown[]): string {
  const template = messages[message] ?? message;
  return values.length ? template.replace(/\{(\d+)\}/g, (token, index) =>
    Number(index) < values.length ? String(values[Number(index)]) : token) : template;
}

/** Interleave localized text with Lit values, preserving the translator's word order. */
export function panelParts(template: string, ...values: unknown[]): unknown[] {
  return template.split(/(\{\d+\})/g).map(part => {
    const index = /^\{(\d+)\}$/.exec(part);
    return index ? values[Number(index[1])] : part;
  });
}
