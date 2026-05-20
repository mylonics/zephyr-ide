/*
Copyright 2025-2026 mylonics 
Author Rijesh Augustine

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import * as vscode from "vscode";
import * as fs from "fs-extra";

export interface MockInteraction {
    type: 'quickpick' | 'input' | 'opendialog';
    value: string | string[]; // For quickpick: selection text, for input: input text, for opendialog: file path(s)
    description?: string; // Optional description for logging
    multiSelect?: boolean; // For quickpick: whether multiple items can be selected
}

export class UIMockInterface {
    private mockQueue: MockInteraction[];
    private currentIndex: number = 0;
    private originalImplementations: any = {};
    private isActive: boolean = false;
    private pendingTimeouts: Set<NodeJS.Timeout> = new Set();
    private lastAsyncError: Error | undefined;

    /**
     * Returns and clears any error that was thrown inside a scheduled (setTimeout)
     * mock callback. Tests should call this before asserting success so that
     * board-not-found and items-never-populated errors are surfaced.
     */
    public getAndClearAsyncError(): Error | undefined {
        const err = this.lastAsyncError;
        this.lastAsyncError = undefined;
        return err;
    }

    constructor() {
        this.mockQueue = [];
        this.saveOriginalImplementations();
    }

    /**
     * Safely extract string representation from QuickPick item
     */
    private getItemString(item: any): string {
        if (typeof item === 'string') {
            return item;
        }
        if (item && typeof item.label === 'string') {
            return item.label;
        }
        if (item && typeof item.toString === 'function') {
            return item.toString();
        }
        return String(item || '');
    }

    /**
     * Prime the mock interface with expected interactions for the next test step
     */
    public primeInteractions(interactions: MockInteraction[]): void {
        this.mockQueue = interactions;
        this.currentIndex = 0;
        console.log(`🎭 Primed ${interactions.length} mock interactions:`, interactions.map(i => `${i.type}:${i.description || i.value}`).join(', '));
    }

    /**
     * Activate the mocking system
     */
    public activate(): void {
        if (this.isActive) { return; }

        try {
            // Override vscode window methods with our mocks
            Object.defineProperty(vscode.window, 'createQuickPick', {
                value: this.createQuickPickMock.bind(this),
                writable: true,
                configurable: true
            });

            Object.defineProperty(vscode.window, 'createInputBox', {
                value: this.createInputBoxMock.bind(this),
                writable: true,
                configurable: true
            });

            Object.defineProperty(vscode.window, 'showQuickPick', {
                value: this.showQuickPickMock.bind(this),
                writable: true,
                configurable: true
            });

            Object.defineProperty(vscode.window, 'showInputBox', {
                value: this.showInputBoxMock.bind(this),
                writable: true,
                configurable: true
            });

            Object.defineProperty(vscode.window, 'showOpenDialog', {
                value: this.showOpenDialogMock.bind(this),
                writable: true,
                configurable: true
            });

            this.isActive = true;
            console.log('🎭 UI Mock Interface activated');
        } catch (error) {
            console.error('❌ Failed to activate UI Mock Interface:', error);
        }
    }

    /**
     * Deactivate the mocking system and restore original implementations
     */
    public deactivate(): void {
        if (!this.isActive) { return; }

        try {
            for (const timeoutId of this.pendingTimeouts) {
                clearTimeout(timeoutId);
            }
            this.pendingTimeouts.clear();

            Object.defineProperty(vscode.window, 'createQuickPick', {
                value: this.originalImplementations.createQuickPick,
                writable: true,
                configurable: true
            });

            Object.defineProperty(vscode.window, 'createInputBox', {
                value: this.originalImplementations.createInputBox,
                writable: true,
                configurable: true
            });

            Object.defineProperty(vscode.window, 'showQuickPick', {
                value: this.originalImplementations.showQuickPick,
                writable: true,
                configurable: true
            });

            Object.defineProperty(vscode.window, 'showInputBox', {
                value: this.originalImplementations.showInputBox,
                writable: true,
                configurable: true
            });

            Object.defineProperty(vscode.window, 'showOpenDialog', {
                value: this.originalImplementations.showOpenDialog,
                writable: true,
                configurable: true
            });

            this.isActive = false;
            console.log('🎭 UI Mock Interface deactivated');
        } catch (error) {
            console.error('❌ Failed to deactivate UI Mock Interface:', error);
        }
    }

    private scheduleTimeout(callback: () => void, delayMs: number): NodeJS.Timeout {
        const timeoutId = setTimeout(() => {
            this.pendingTimeouts.delete(timeoutId);
            try {
                callback();
            } catch (err) {
                // Store errors from scheduled callbacks; they cannot propagate
                // through the event-loop boundary on their own.
                const error = err instanceof Error ? err : new Error(String(err));
                console.error(`❌ UI Mock async error: ${error.message}`);
                this.lastAsyncError = error;
            }
        }, delayMs);
        this.pendingTimeouts.add(timeoutId);
        return timeoutId;
    }

    private getMatchingItems(items: any[], expectedValue: string): any[] {
        const needle = expectedValue.toLowerCase().trim();
        const withLabel = items.map((item) => ({ item, label: this.getItemString(item).toLowerCase().trim() }));

        const exact = withLabel.filter((entry) => entry.label === needle).map((entry) => entry.item);
        if (exact.length > 0) {
            return exact;
        }

        const startsWith = withLabel.filter((entry) => entry.label.startsWith(needle)).map((entry) => entry.item);
        if (startsWith.length > 0) {
            return startsWith;
        }

        const includes = withLabel.filter((entry) => entry.label.includes(needle)).map((entry) => entry.item);
        return includes;
    }

    private selectSingleItemOrThrow(items: any[], expectedValue: string, context: string): any {
        const matches = this.getMatchingItems(items, expectedValue);
        if (matches.length === 1) {
            return matches[0];
        }

        const available = items.map((item) => this.getItemString(item)).join(', ');
        if (matches.length === 0) {
            throw new Error(`${context}: No match for "${expectedValue}". Available: [${available}]`);
        }

        const matched = matches.map((item) => this.getItemString(item)).join(', ');
        throw new Error(`${context}: Ambiguous match for "${expectedValue}". Matched: [${matched}]`);
    }

    private selectManyItemsOrThrow(items: any[], expectedValues: string[], context: string): any[] {
        const selected = expectedValues.map((value) => this.selectSingleItemOrThrow(items, value, context));
        return selected;
    }

    /**
     * Get the next mock interaction from the queue
     */
    private getNextInteraction(expectedType: MockInteraction['type']): MockInteraction | null {
        if (this.currentIndex >= this.mockQueue.length) {
            console.warn(`⚠️  No more mock interactions available for ${expectedType}`);
            return null;
        }

        const interaction = this.mockQueue[this.currentIndex];
        if (interaction.type !== expectedType) {
            console.warn(`⚠️  Expected ${expectedType}, but got ${interaction.type} at index ${this.currentIndex}`);
        }

        this.currentIndex++;
        return interaction;
    }

    private saveOriginalImplementations(): void {
        this.originalImplementations = {
            createQuickPick: vscode.window.createQuickPick,
            createInputBox: vscode.window.createInputBox,
            showQuickPick: vscode.window.showQuickPick,
            showInputBox: vscode.window.showInputBox,
            showOpenDialog: vscode.window.showOpenDialog,
        };
    }

    private createQuickPickMock<T extends vscode.QuickPickItem>(): vscode.QuickPick<T> {
        const mockQuickPick: any = {
            title: "",
            step: 0,
            totalSteps: 0,
            items: [],
            activeItems: [],
            selectedItems: [],
            canSelectMany: false,
            ignoreFocusOut: false,
            placeholder: "",
            buttons: [],
            busy: false,
            enabled: true,
            value: "",
            keepScrollPosition: false,
            matchOnDescription: false,
            matchOnDetail: false,
            sortByLabel: true,
            validationMessage: "",
            hide: () => { },
            _disposed: false,
            dispose: () => { mockQuickPick._disposed = true; },
            show: () => {
                this.scheduleTimeout(() => {
                    this.processQuickPickSelection(mockQuickPick);
                }, 100);
            },
            onDidTriggerButton: () => ({ dispose: () => { } }),
            onDidChangeSelection: (callback: any) => {
                mockQuickPick._onDidChangeSelectionCallback = callback;
                return {
                    dispose: () => {
                        mockQuickPick._onDidChangeSelectionCallback = undefined;
                    }
                };
            },
            onDidAccept: (callback: any) => {
                mockQuickPick._onDidAcceptCallback = callback;
                return {
                    dispose: () => {
                        mockQuickPick._onDidAcceptCallback = undefined;
                    }
                };
            },
            onDidChangeValue: () => ({ dispose: () => { } }),
            onDidChangeActive: () => ({ dispose: () => { } }),
            onDidHide: () => ({ dispose: () => { } }),
        };

        return mockQuickPick;
    }

    private createInputBoxMock(): vscode.InputBox {
        const mockInputBox: any = {
            title: "",
            step: 0,
            totalSteps: 0,
            value: "",
            prompt: "",
            placeholder: "",
            buttons: [],
            ignoreFocusOut: false,
            busy: false,
            enabled: true,
            hide: () => { },
            dispose: () => { },
            show: () => {
                this.scheduleTimeout(() => {
                    this.processInputBoxValue(mockInputBox);
                }, 100);
            },
            onDidAccept: (callback: any) => {
                mockInputBox._onDidAcceptCallback = callback;
                return {
                    dispose: () => {
                        mockInputBox._onDidAcceptCallback = undefined;
                    }
                };
            },
            onDidChangeValue: (callback: any) => {
                mockInputBox._onDidChangeValueCallback = callback;
                return {
                    dispose: () => {
                        mockInputBox._onDidChangeValueCallback = undefined;
                    }
                };
            },
            onDidTriggerButton: () => ({ dispose: () => { } }),
            onDidHide: () => ({ dispose: () => { } }),
        };

        return mockInputBox;
    }

    private async showQuickPickMock(items: any, options?: any): Promise<any> {
        const itemsArray = Array.isArray(items) ? items : await items;
        const interaction = this.getNextInteraction('quickpick');

        if (!interaction) {
            throw new Error('QuickPick requested but no mock interaction was primed');
        }

        const value = interaction.value as string;

        if (interaction.multiSelect || options?.canPickMany) {
            // Handle multiple selection
            const values = Array.isArray(interaction.value) ? interaction.value : [value];
            const selectedItems = this.selectManyItemsOrThrow(itemsArray, values, 'showQuickPickMock');

            console.log(`   → QuickPick (multi): Selected [${selectedItems.map((item: any) => this.getItemString(item)).join(', ')}] (${interaction.description || 'auto'})`);
            return selectedItems;
        } else {
            // Handle single selection
            const selectedItem = this.selectSingleItemOrThrow(itemsArray, value, 'showQuickPickMock');

            console.log(`   → QuickPick: Selected "${this.getItemString(selectedItem)}" (${interaction.description || 'auto'})`);
            return selectedItem;
        }
    }

    private async showInputBoxMock(options?: vscode.InputBoxOptions): Promise<string | undefined> {
        const interaction = this.getNextInteraction('input');

        if (!interaction) {
            throw new Error('InputBox requested but no mock interaction was primed');
        }

        const value = interaction.value as string;
        console.log(`   → InputBox: Entered "${value}" (${interaction.description || 'auto'})`);
        return value;
    }

    private async showOpenDialogMock(options?: vscode.OpenDialogOptions): Promise<vscode.Uri[] | undefined> {
        const interaction = this.getNextInteraction('opendialog');

        if (!interaction) {
            throw new Error('OpenDialog requested but no mock interaction was primed');
        }

        const paths = Array.isArray(interaction.value) ? interaction.value : [interaction.value as string];
        const uris = [];

        for (const filePath of paths) {
            // Check if file exists if it's a real path
            if (await fs.pathExists(filePath)) {
                uris.push(vscode.Uri.file(filePath));
                console.log(`   → OpenDialog: Selected existing file "${filePath}" (${interaction.description || 'auto'})`);
            } else {
                // Create URI anyway for mock purposes
                uris.push(vscode.Uri.file(filePath));
                console.log(`   → OpenDialog: Selected mock file "${filePath}" (${interaction.description || 'auto'})`);
            }
        }

        return uris;
    }

    private processQuickPickSelection(mockQuickPick: any, retryCount = 0): void {
        const maxRetries = 30; // 30 seconds max wait
        if (mockQuickPick.items && mockQuickPick.items.length > 0) {
            const interaction = this.getNextInteraction('quickpick');

            if (!interaction) {
                throw new Error('QuickPick created but no mock interaction was primed');
            }

            const value = interaction.value as string;

            if (interaction.multiSelect) {
                // Handle multiple selection
                const values = Array.isArray(interaction.value) ? interaction.value : [value];
                const selectedItems = this.selectManyItemsOrThrow(mockQuickPick.items, values, 'createQuickPickMock');

                console.log(`   → QuickPick (multi): Selected [${selectedItems.map((item: any) => this.getItemString(item)).join(', ')}] (${interaction.description || 'auto'})`);
                this.triggerQuickPickCallbacks(mockQuickPick, selectedItems);
            } else {
                // Handle single selection
                const selectedItem = this.selectSingleItemOrThrow(mockQuickPick.items, value, 'createQuickPickMock');

                console.log(`   → QuickPick: Selected "${this.getItemString(selectedItem)}" (${interaction.description || 'auto'})`);
                this.triggerQuickPickCallbacks(mockQuickPick, selectedItem);
            }
        } else {
            // Retry if items not populated yet, with max retry limit
            if (mockQuickPick._disposed) {
                // Loading-indicator QuickPicks (intentionally empty) are disposed
                // before items are ever populated.  Stop retrying silently.
                return;
            }
            if (retryCount >= maxRetries) {
                throw new Error(`QuickPick items were never populated after ${maxRetries} retries`);
            }
            this.scheduleTimeout(() => this.processQuickPickSelection(mockQuickPick, retryCount + 1), 1000);
        }
    }

    private processInputBoxValue(mockInputBox: any): void {
        const interaction = this.getNextInteraction('input');

        if (!interaction) {
            throw new Error('InputBox created but no mock interaction was primed');
        } else {
            const value = interaction.value as string;
            mockInputBox.value = value;
            console.log(`   → InputBox: Entered "${value}" (${interaction.description || 'auto'})`);
        }

        if (mockInputBox._onDidChangeValueCallback) {
            mockInputBox._onDidChangeValueCallback(mockInputBox.value);
        }
        if (mockInputBox._onDidAcceptCallback) {
            mockInputBox._onDidAcceptCallback();
        }
    }

    private triggerQuickPickCallbacks(mockQuickPick: any, selectedItem: any): void {
        const selectedItems = Array.isArray(selectedItem) ? selectedItem : [selectedItem];
        mockQuickPick.selectedItems = selectedItems;
        mockQuickPick.activeItems = selectedItems;

        if (mockQuickPick._onDidChangeSelectionCallback) {
            mockQuickPick._onDidChangeSelectionCallback(selectedItems);
        }
        if (mockQuickPick._onDidAcceptCallback) {
            mockQuickPick._onDidAcceptCallback();
        }
    }

    /**
     * Get remaining interactions in the queue (useful for debugging)
     */
    public getRemainingInteractions(): MockInteraction[] {
        return this.mockQueue.slice(this.currentIndex);
    }

    /**
     * Reset the queue index (useful for reusing the same queue)
     */
    public resetQueue(): void {
        this.currentIndex = 0;
    }
}
