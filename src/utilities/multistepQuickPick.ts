import { QuickPickItem, window, Disposable, QuickInputButton, QuickInput, QuickInputButtons } from 'vscode';

class InputFlowAction {
  static back = new InputFlowAction();
  static cancel = new InputFlowAction();
  static resume = new InputFlowAction();
}

type InputStep = (input: MultiStepInput) => Thenable<InputStep | void>;

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

function shouldResume() {
  // Could show a notification with the option to resume.
  return new Promise<boolean>((resolve, reject) => {
    reject();
  });
}


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

  async showQuickPick<T extends QuickPickItem, P extends QuickPickParameters<T>>({ title, step, totalSteps, items, activeItem, ignoreFocusOut, placeholder, buttons, canSelectMany = false }: P) {
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
        input.canSelectMany = canSelectMany;
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
            (async () => {
              reject(shouldResume && await shouldResume() ? InputFlowAction.resume : InputFlowAction.cancel);
            })()
              .catch(reject);
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
            (async () => {
              reject(shouldResume && await shouldResume() ? InputFlowAction.resume : InputFlowAction.cancel);
            })()
              .catch(reject);
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

export async function showQuickPick<T extends QuickPickItem, P extends QuickPickParameters<T>, O>({ title, step, totalSteps, items, activeItem, ignoreFocusOut, placeholder, dispose = true }: P) {

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
          disposables.forEach(d => d.dispose());
          if (dispose) {
            input.dispose();
          }
        }));
      input.show();
    });
  } finally {
    disposables.forEach(d => d.dispose());
  }

}

export async function showQuickPickMany<T extends QuickPickItem, P extends QuickPickParameters<T>, O>({ title, step, totalSteps, items, activeItem, ignoreFocusOut, placeholder, dispose = true }: P) {

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
          disposables.forEach(d => d.dispose());
          if (dispose) {
            input.dispose();
          }
        }));
      input.show();
    });
  } finally {
    disposables.forEach(d => d.dispose());
  }
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
      if (value != "") {
        input.value = value;
      }
      disposables.push(
        input.onDidAccept(async () => {
          input.enabled = false;
          input.busy = true;
          resolve(input.value);
          disposables.forEach(d => d.dispose());
          if (dispose) {
            input.dispose();
          }
        }));
      input.show();
    });
  } finally {
    disposables.forEach(d => d.dispose());
  }

}
