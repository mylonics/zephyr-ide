import { QuickPickItem, QuickPickItemKind, window, Disposable, QuickInputButton, QuickInput, QuickInputButtons } from 'vscode';

class InputFlowAction {
  static back = new InputFlowAction();
  static cancel = new InputFlowAction();
  static resume = new InputFlowAction();
}

interface QuickPickParameters<T extends QuickPickItem> {
  title: string;
  step: number;
  totalSteps: number;
  items: T[];
  activeItem?: T;
  ignoreFocusOut?: boolean;
  placeholder: string;
  buttons?: QuickInputButton[];
  canSelectMany?: boolean;
  dispose?: boolean;
}

interface InputBoxParameters {
  title: string;
  step: number;
  totalSteps: number;
  value: string;
  prompt: string;
  validate: (value: string) => Promise<string | undefined>;
  buttons?: QuickInputButton[];
  ignoreFocusOut?: boolean;
  placeholder?: string;
  dispose?: boolean;
}

export type InputStep = (input: MultiStepInput) => Thenable<InputStep | void>;


export class MultiStepInput {

  static async run<T>(start: InputStep) {
    const input = new MultiStepInput();
    return input.stepThrough(start);
  }

  private current?: QuickInput;
  private steps: InputStep[] = [];

  private async stepThrough<T>(start: InputStep) {
    let step: InputStep | void = start;
    while (step) {
      this.steps.push(step);
      if (this.current) {
        this.current.enabled = false;
        this.current.busy = true;
      }
      try {
        step = await step(this);
      } catch (err) {
        if (err === InputFlowAction.back) {
          this.steps.pop();
          step = this.steps.pop();
        } else if (err === InputFlowAction.resume) {
          step = this.steps.pop();
        } else if (err === InputFlowAction.cancel) {
          step = undefined;
        } else {
          throw err;
        }
      }
    }
    if (this.current) {
      this.current.dispose();
    }
  }

  async showQuickPick<T extends QuickPickItem, P extends Omit<QuickPickParameters<T>, 'canSelectMany'>>({ title, step, totalSteps, items, activeItem, ignoreFocusOut, placeholder, buttons }: P) {
    const disposables: Disposable[] = [];
    try {
      return await new Promise<T | (P extends { buttons: (infer I)[] } ? I : never)>((resolve, reject) => {
        const input = window.createQuickPick<T>();
        input.title = title;
        input.step = step;
        input.totalSteps = totalSteps;
        input.ignoreFocusOut = ignoreFocusOut ?? false;
        input.placeholder = placeholder;
        input.items = items;
        // canSelectMany is intentionally not supported here; use showQuickPickMany
        // for multi-select so the promise is resolved via explicit accept (Enter).
        input.canSelectMany = false;
        if (activeItem) {
          input.activeItems = [activeItem];
        }
        input.buttons = [
          ...(this.steps.length > 1 ? [QuickInputButtons.Back] : []),
          ...(buttons || [])
        ];
        disposables.push(
          input.onDidTriggerButton(item => {
            if (item === QuickInputButtons.Back) {
              reject(InputFlowAction.back);
            } else {
              resolve(<any>item);
            }
          }),
          input.onDidChangeSelection(items => resolve(items[0])),
          input.onDidHide(() => {
            reject(InputFlowAction.cancel);
          })
        );
        if (this.current) {
          this.current.dispose();
        }
        this.current = input;
        this.current.show();
      });
    } finally {
      disposables.forEach(d => d.dispose());
    }
  }

  /**
   * Show a QuickPick that is usable the instant it appears (`pinnedItem`, e.g. a
   * manual-entry option, is always present and selectable) while `fetchItems` runs
   * in the background to populate the rest of the list. `loadingItem`/`failedItem`
   * are status rows, not real choices — selecting one is a no-op and leaves the
   * picker open.
   */
  async showQuickPickWithBackgroundFetch({
    title, step, totalSteps, placeholder, ignoreFocusOut,
    pinnedItem, loadingItem, failedItem, fetchItems,
  }: {
    title: string;
    step: number;
    totalSteps: number;
    placeholder: string;
    ignoreFocusOut?: boolean;
    pinnedItem: QuickPickItem;
    loadingItem: QuickPickItem;
    failedItem: QuickPickItem;
    fetchItems: () => Promise<QuickPickItem[] | undefined>;
  }): Promise<QuickPickItem> {
    const disposables: Disposable[] = [];
    try {
      return await new Promise<QuickPickItem>((resolve, reject) => {
        const input = window.createQuickPick<QuickPickItem>();
        input.title = title;
        input.step = step;
        input.totalSteps = totalSteps;
        input.ignoreFocusOut = ignoreFocusOut ?? false;
        input.placeholder = placeholder;
        input.canSelectMany = false;
        input.busy = true;
        const separator: QuickPickItem = { label: "", kind: QuickPickItemKind.Separator };
        input.items = [pinnedItem, separator, loadingItem];
        input.buttons = this.steps.length > 1 ? [QuickInputButtons.Back] : [];

        // Identity-based: the same object references are reused when items
        // are rebuilt below, so a Set lookup reliably tells a real pick apart
        // from a click on a status row.
        const sentinels = new Set([loadingItem, failedItem]);
        let settled = false;

        disposables.push(
          input.onDidTriggerButton(item => {
            if (item === QuickInputButtons.Back) {
              settled = true;
              reject(InputFlowAction.back);
            }
          }),
          input.onDidChangeSelection(items => {
            const picked = items[0];
            if (!picked || sentinels.has(picked)) {
              return;
            }
            settled = true;
            resolve(picked);
          }),
          input.onDidHide(() => {
            settled = true;
            reject(InputFlowAction.cancel);
          })
        );

        if (this.current) {
          this.current.dispose();
        }
        this.current = input;
        this.current.show();

        fetchItems().then(fetched => {
          // The user may have already picked the pinned item (or navigated
          // away) before the background fetch resolves; don't touch a
          // picker nobody is looking at anymore.
          if (settled) {
            return;
          }
          input.busy = false;
          input.items = fetched && fetched.length > 0
            ? [pinnedItem, separator, ...fetched]
            : [pinnedItem, separator, failedItem];
        });
      });
    } finally {
      disposables.forEach(d => d.dispose());
    }
  }

  async showQuickPickMany<T extends QuickPickItem, P extends QuickPickParameters<T>>({ title, step, totalSteps, items, activeItem, ignoreFocusOut, placeholder, buttons }: P): Promise<readonly T[] | (P extends { buttons: (infer I)[] } ? I : never)> {
    const disposables: Disposable[] = [];
    try {
      return await new Promise<readonly T[] | (P extends { buttons: (infer I)[] } ? I : never)>((resolve, reject) => {
        const input = window.createQuickPick<T>();
        input.title = title;
        input.step = step;
        input.totalSteps = totalSteps;
        input.ignoreFocusOut = ignoreFocusOut ?? false;
        input.placeholder = placeholder;
        input.items = items;
        input.canSelectMany = true;
        if (activeItem) {
          input.activeItems = [activeItem];
        }
        input.buttons = [
          ...(this.steps.length > 1 ? [QuickInputButtons.Back] : []),
          ...(buttons || [])
        ];
        disposables.push(
          input.onDidTriggerButton(item => {
            if (item === QuickInputButtons.Back) {
              reject(InputFlowAction.back);
            } else {
              resolve(<any>item);
            }
          }),
          input.onDidAccept(() => {
            resolve(input.selectedItems);
          }),
          input.onDidHide(() => {
            reject(InputFlowAction.cancel);
          })
        );
        if (this.current) {
          this.current.dispose();
        }
        this.current = input;
        this.current.show();
      });
    } finally {
      disposables.forEach(d => d.dispose());
    }
  }

  async showInputBox<P extends InputBoxParameters>({ title, step, totalSteps, value, prompt, validate, buttons, ignoreFocusOut, placeholder }: P) {
    const disposables: Disposable[] = [];
    try {
      return await new Promise<string | (P extends { buttons: (infer I)[] } ? I : never)>((resolve, reject) => {
        const input = window.createInputBox();
        input.title = title;
        input.step = step;
        input.totalSteps = totalSteps;
        input.value = value || '';
        input.prompt = prompt;
        input.ignoreFocusOut = ignoreFocusOut ?? false;
        input.placeholder = placeholder;
        input.buttons = [
          ...(this.steps.length > 1 ? [QuickInputButtons.Back] : []),
          ...(buttons || [])
        ];
        let validating = validate('');
        disposables.push(
          input.onDidTriggerButton(item => {
            if (item === QuickInputButtons.Back) {
              reject(InputFlowAction.back);
            } else {
              resolve(<any>item);
            }
          }),
          input.onDidAccept(async () => {
            const value = input.value;
            input.enabled = false;
            input.busy = true;
            if (!(await validate(value))) {
              resolve(value);
            }
            input.enabled = true;
            input.busy = false;
          }),
          input.onDidChangeValue(async text => {
            const current = validate(text);
            validating = current;
            const validationMessage = await current;
            if (current === validating) {
              input.validationMessage = validationMessage;
            }
          }),
          input.onDidHide(() => {
            reject(InputFlowAction.cancel);
          })
        );
        if (this.current) {
          this.current.dispose();
        }
        this.current = input;
        this.current.show();
      });
    } finally {
      disposables.forEach(d => d.dispose());
    }
  }
}

export async function showQuickPick<T extends QuickPickItem, P extends QuickPickParameters<T>>({ title, step, totalSteps, items, activeItem, ignoreFocusOut, placeholder, dispose = true }: P) {

  const disposables: Disposable[] = [];
  try {
    return await new Promise<T>((resolve, reject) => {
      const input = window.createQuickPick<T>();
      input.title = title;
      input.step = step;
      input.totalSteps = totalSteps;
      input.ignoreFocusOut = ignoreFocusOut ?? false;
      input.placeholder = placeholder;
      input.items = items;
      input.canSelectMany = false;
      if (activeItem) {
        input.activeItems = [activeItem];
      }
      disposables.push(
        input.onDidAccept(async () => {
          const selected = input.selectedItems[0];
          input.enabled = false;
          input.busy = true;
          resolve(selected);
          if (dispose) {
            input.dispose();
          }
        }),
        input.onDidHide(() => {
          reject(new Error('Quick pick dismissed'));
        }));
      input.show();
    });
  } finally {
    disposables.forEach(d => d.dispose());
  }

}

export async function showQuickPickMany<T extends QuickPickItem, P extends QuickPickParameters<T>>({ title, step, totalSteps, items, activeItem, ignoreFocusOut, placeholder, dispose = true }: P) {

  const disposables: Disposable[] = [];
  try {
    return await new Promise<readonly T[]>((resolve, reject) => {
      const input = window.createQuickPick<T>();
      input.title = title;
      input.step = step;
      input.totalSteps = totalSteps;
      input.ignoreFocusOut = ignoreFocusOut ?? false;
      input.placeholder = placeholder;
      input.items = items;
      input.canSelectMany = true;
      if (activeItem) {
        input.activeItems = [activeItem];
      }
      disposables.push(
        input.onDidAccept(async () => {
          const selected = input.selectedItems;
          input.enabled = false;
          input.busy = true;
          resolve(selected);
          if (dispose) {
            input.dispose();
          }
        }),
        input.onDidHide(() => {
          reject(new Error('Quick pick dismissed'));
        }));
      input.show();
    });
  } finally {
    disposables.forEach(d => d.dispose());
  }
}

/** No-op validation: accepts all input values. */
export async function noOpValidate(_name: string): Promise<string | undefined> {
  return undefined;
}

/** Map an array of strings to an array of QuickPickItems. */
export function mapToQuickPickItems(labels: string[]): QuickPickItem[] {
  return labels.map(label => ({ label }));
}

export async function showInputBox<P extends InputBoxParameters>({ title, step, totalSteps, ignoreFocusOut, placeholder, prompt, value, dispose = true }: P) {

  const disposables: Disposable[] = [];
  try {
    return await new Promise<string>((resolve, reject) => {
      const input = window.createInputBox();
      input.title = title;
      input.step = step;
      input.totalSteps = totalSteps;
      input.ignoreFocusOut = ignoreFocusOut ?? false;
      input.placeholder = placeholder;
      input.prompt = prompt;
      if (value !== "") {
        input.value = value;
      }
      disposables.push(
        input.onDidAccept(async () => {
          input.enabled = false;
          input.busy = true;
          resolve(input.value);
          if (dispose) {
            input.dispose();
          }
        }),
        input.onDidHide(() => {
          reject(new Error('Input box dismissed'));
        }));
      input.show();
    });
  } finally {
    disposables.forEach(d => d.dispose());
  }

}
