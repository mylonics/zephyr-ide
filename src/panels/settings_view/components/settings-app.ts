/*
Copyright 2026 mylonics 
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

import { html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { ZephyrLitElement } from "../../webview_shared/lit-base";

interface SettingState {
  key: string;
  label: string;
  description: string;
  type: "boolean" | "string" | "enum";
  defaultValue: boolean | string | null;
  options: { value: string; label: string }[] | null;
  pathType: "folder" | null;
  currentValue: boolean | string | null;
  scope: "default" | "user" | "workspace";
  userValue: boolean | string | null;
  workspaceValue: boolean | string | null;
  hasUserValue: boolean;
  hasWorkspaceValue: boolean;
}

function formatValue(value: boolean | string | null): string {
  if (value === null || value === undefined) { return "(not set)"; }
  if (typeof value === "boolean") { return value ? "true" : "false"; }
  return `"${value}"`;
}

@customElement("settings-app")
export class SettingsApp extends ZephyrLitElement {
  @state() private _settings: SettingState[] = [];
  /** Track which scope the user has selected per-key */
  private _targetScopes: Record<string, string> = {};

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("message", this._onMessage);
    this.vscodeApi.postMessage({ command: "ready" });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("message", this._onMessage);
  }

  private _onMessage = (event: MessageEvent) => {
    const msg = event.data;
    switch (msg.command) {
      case "updateSettings":
        this._settings = msg.settings;
        break;
      case "folderSelected":
        this._handleFolderSelected(msg.key, msg.path);
        break;
    }
  };

  private _handleFolderSelected(key: string, folderPath: string) {
    this._onStringChanged(key, folderPath);
    // Force a re-render to update the input value
    this._settings = [...this._settings];
  }

  private _getTargetScope(key: string, defaultScope: string): string {
    return this._targetScopes[key] ?? defaultScope;
  }

  private _onToggleChanged(key: string, e: Event) {
    const checked = (e.target as any).checked;
    const scope = this._getTargetScope(key, "workspace");
    this.vscodeApi.postMessage({ command: "updateSetting", key, value: checked, scope });
  }

  private _onEnumChanged(key: string, e: Event) {
    const value = (e.target as any).value;
    const scope = this._getTargetScope(key, "workspace");
    this.vscodeApi.postMessage({ command: "updateSetting", key, value, scope });
  }

  private _onStringChanged(key: string, value: string) {
    const scope = this._getTargetScope(key, "workspace");
    const finalValue = value.trim() === "" ? null : value.trim();
    this.vscodeApi.postMessage({ command: "updateSetting", key, value: finalValue, scope });
  }

  private _onStringInput(key: string, e: Event) {
    const value = (e.target as any).value;
    this._onStringChanged(key, value);
  }

  private _onScopeChanged(key: string, e: Event) {
    const scope = (e.target as any).value;
    this._targetScopes = { ...this._targetScopes, [key]: scope };
    this.requestUpdate();

    const setting = this._settings.find(s => s.key === key);
    if (setting && setting.scope !== "default") {
      let value: boolean | string | null;
      if (setting.type === "boolean") {
        value = setting.currentValue;
      } else {
        const strVal = setting.currentValue !== null && setting.currentValue !== undefined ? String(setting.currentValue).trim() : "";
        value = strVal === "" ? null : strVal;
      }
      this.vscodeApi.postMessage({ command: "updateSetting", key, value, scope });
    }
  }

  private _onReset(key: string) {
    this.vscodeApi.postMessage({ command: "resetSetting", key });
  }

  private _onBrowse(key: string) {
    this.vscodeApi.postMessage({ command: "browseFolder", key });
  }

  render() {
    if (this._settings.length === 0) {
      return html`<div class="container"><p>Loading…</p></div>`;
    }

    const sections: { title: string; settings: SettingState[] }[] = [
      {
        title: "Directory Settings",
        settings: this._settings.filter(s =>
          s.type === "string" && s.key !== "zephyr-ide.scaCustomVariant"),
      },
      {
        title: "General Settings",
        settings: this._settings.filter(s => [
          "zephyr-ide.activeViewKconfigButton",
          "zephyr-ide.projectViewKconfigButton",
          "zephyr-ide.automaticProjectSelection",
          "zephyr-ide.buildBeforeFlash",
          "zephyr-ide.separateBuildDebugProfile",
        ].includes(s.key)),
      },
      {
        title: "Status Bar",
        settings: this._settings.filter(s => s.key.startsWith("zephyr-ide.statusBar.")),
      },
      {
        title: "Active Project View",
        settings: this._settings.filter(s => s.key.startsWith("zephyr-ide.activeProjectPanel.")),
      },
      {
        title: "West Update Settings",
        settings: this._settings.filter(s => [
          "zephyr-ide.westNarrowUpdate",
          "zephyr-ide.westKeepDescendants",
          "zephyr-ide.westZephyrExport",
        ].includes(s.key)),
      },
      {
        title: "Workspace & Tooling",
        settings: this._settings.filter(s => [
          "zephyr-ide.suppressWorkspaceWarning",
          "zephyr-ide.useClangd",
        ].includes(s.key)),
      },
      {
        title: "Static Code Analysis",
        settings: this._settings.filter(s => [
          "zephyr-ide.scaVariant",
          "zephyr-ide.scaCustomVariant",
        ].includes(s.key)),
      },
    ].filter(section => section.settings.length > 0);

    const renderSetting = (setting: SettingState) =>
      setting.type === "boolean" ? this._renderBoolSetting(setting) :
        setting.type === "string" ? (setting.pathType === "folder" ? this._renderStringSetting(setting) : this._renderTextSetting(setting)) :
          this._renderEnumSetting(setting);

    return html`
      <div class="container">
        <div class="breadcrumb">
          <a class="breadcrumb-link" @click=${() => this.postCommand("openSetupPanel")}>← Setup & Configuration</a>
          <span class="breadcrumb-separator">/</span>
          <span class="breadcrumb-current">Settings</span>
        </div>
        <div class="page-header">
          <div>
            <h1 class="page-title">Zephyr IDE Settings</h1>
            <p class="page-subtitle">Manage extension defaults and workspace overrides.</p>
          </div>
          <div class="page-actions">
            <vscode-button appearance="secondary" @click=${() => this.postCommand("openVsCodeSettings")}>
              Open in VS Code Settings
            </vscode-button>
          </div>
        </div>

        <div class="info-box">
          <p>Configure Zephyr IDE extension settings. Changes are saved automatically.
          Use the scope selector to choose whether a setting applies to this workspace only or to all workspaces (User).</p>
        </div>

        ${sections.map((section, sectionIndex) => html`
          ${sectionIndex > 0 ? html`<vscode-divider></vscode-divider>` : nothing}
          <h2>${section.title}</h2>
          <div class="settings-group">
            ${section.settings.map((setting, settingIndex) => html`
              ${settingIndex > 0 ? html`<vscode-divider></vscode-divider>` : nothing}
              ${renderSetting(setting)}
            `)}
          </div>
        `)}
      </div>
    `;
  }

  private _renderOverrideWarning(setting: SettingState) {
    const targetScope = this._getTargetScope(setting.key, setting.scope !== "default" ? setting.scope : "workspace");
    const showWarning = targetScope === "user" && setting.hasWorkspaceValue;
    const showInfo = setting.hasUserValue && setting.hasWorkspaceValue;

    return html`
      ${showWarning
        ? html`<div class="setting-override-warning">
            <span class="codicon codicon-warning"></span>
            <span class="override-warning-text">A workspace setting (${formatValue(setting.workspaceValue)}) overrides this user value. Changes to the user setting will not take effect in this workspace.</span>
          </div>`
        : nothing}
      ${showInfo
        ? html`<div class="setting-override-info">
            <span class="override-info-label">User:</span> <span class="override-info-value">${formatValue(setting.userValue)}</span>
            <span class="override-info-sep">|</span>
            <span class="override-info-label">Workspace:</span> <span class="override-info-value">${formatValue(setting.workspaceValue)}</span>
            <span class="override-info-note">(workspace wins)</span>
          </div>`
        : nothing}
    `;
  }

  private _renderStringSetting(setting: SettingState) {
    const targetScope = this._getTargetScope(setting.key, setting.scope !== "default" ? setting.scope : "workspace");
    const isOverridden = targetScope === "user" && setting.hasWorkspaceValue;
    const currentVal = setting.currentValue !== null && setting.currentValue !== undefined ? String(setting.currentValue) : "";

    return html`
      <div class="setting-row ${isOverridden ? "setting-row-overridden" : ""}" data-key="${setting.key}" data-type="string">
        <div class="setting-header">
          <vscode-label class="setting-label">${setting.label}</vscode-label>
          <div class="setting-scope-badge scope-${setting.scope}">${setting.scope}</div>
        </div>
        <div class="setting-description">${setting.description}</div>
        ${this._renderOverrideWarning(setting)}
        <div class="setting-controls">
          <div class="input-group">
            <vscode-textfield
              .value=${currentVal}
              placeholder="Not set (using default)"
              @change=${(e: Event) => this._onStringInput(setting.key, e)}
            ></vscode-textfield>
            <vscode-button class="setting-browse-button" appearance="secondary" title="Browse for folder"
              @click=${() => this._onBrowse(setting.key)}>Browse</vscode-button>
          </div>
          <vscode-single-select class="setting-scope-select"
            .value=${targetScope}
            @change=${(e: Event) => this._onScopeChanged(setting.key, e)}>
            <vscode-option value="workspace">Workspace</vscode-option>
            <vscode-option value="user">User</vscode-option>
          </vscode-single-select>
          <vscode-button class="setting-reset-button" appearance="secondary" title="Reset to default"
            style=${setting.scope === "default" ? "display:none" : ""}
            @click=${() => this._onReset(setting.key)}>Reset</vscode-button>
        </div>
      </div>
    `;
  }

  /** Render a plain text input setting (no folder-browse button). Used for non-path string fields. */
  private _renderTextSetting(setting: SettingState) {
    const targetScope = this._getTargetScope(setting.key, setting.scope !== "default" ? setting.scope : "workspace");
    const isOverridden = targetScope === "user" && setting.hasWorkspaceValue;
    const currentVal = setting.currentValue !== null && setting.currentValue !== undefined ? String(setting.currentValue) : "";

    return html`
      <div class="setting-row ${isOverridden ? "setting-row-overridden" : ""}" data-key="${setting.key}" data-type="string">
        <div class="setting-header">
          <vscode-label class="setting-label">${setting.label}</vscode-label>
          <div class="setting-scope-badge scope-${setting.scope}">${setting.scope}</div>
        </div>
        <div class="setting-description">${setting.description}</div>
        ${this._renderOverrideWarning(setting)}
        <div class="setting-controls">
          <vscode-textfield
            .value=${currentVal}
            placeholder="Not set"
            @change=${(e: Event) => this._onStringInput(setting.key, e)}
          ></vscode-textfield>
          <vscode-single-select class="setting-scope-select"
            .value=${targetScope}
            @change=${(e: Event) => this._onScopeChanged(setting.key, e)}>
            <vscode-option value="workspace">Workspace</vscode-option>
            <vscode-option value="user">User</vscode-option>
          </vscode-single-select>
          <vscode-button class="setting-reset-button" appearance="secondary" title="Reset to default"
            style=${setting.scope === "default" ? "display:none" : ""}
            @click=${() => this._onReset(setting.key)}>Reset</vscode-button>
        </div>
      </div>
    `;
  }

  private _renderBoolSetting(setting: SettingState) {
    const targetScope = this._getTargetScope(setting.key, setting.scope !== "default" ? setting.scope : "workspace");
    const isOverridden = targetScope === "user" && setting.hasWorkspaceValue;

    return html`
      <div class="setting-row ${isOverridden ? "setting-row-overridden" : ""}" data-key="${setting.key}" data-type="boolean">
        <div class="setting-header">
          <vscode-label class="setting-label">${setting.label}</vscode-label>
          <div class="setting-scope-badge scope-${setting.scope}">${setting.scope}</div>
        </div>
        <div class="setting-description">${setting.description}</div>
        ${this._renderOverrideWarning(setting)}
        <div class="setting-controls">
          <vscode-checkbox
            ?checked=${!!setting.currentValue}
            @change=${(e: Event) => this._onToggleChanged(setting.key, e)}
          ></vscode-checkbox>
          <vscode-single-select class="setting-scope-select"
            .value=${targetScope}
            @change=${(e: Event) => this._onScopeChanged(setting.key, e)}>
            <vscode-option value="workspace">Workspace</vscode-option>
            <vscode-option value="user">User</vscode-option>
          </vscode-single-select>
          <vscode-button class="setting-reset-button" appearance="secondary" title="Reset to default"
            style=${setting.scope === "default" ? "display:none" : ""}
            @click=${() => this._onReset(setting.key)}>Reset</vscode-button>
        </div>
      </div>
    `;
  }

  private _renderEnumSetting(setting: SettingState) {
    const targetScope = this._getTargetScope(setting.key, setting.scope !== "default" ? setting.scope : "workspace");
    const isOverridden = targetScope === "user" && setting.hasWorkspaceValue;
    const currentVal = setting.currentValue !== null && setting.currentValue !== undefined ? String(setting.currentValue) : String(setting.defaultValue ?? "");
    const options = setting.options ?? [];

    return html`
      <div class="setting-row ${isOverridden ? "setting-row-overridden" : ""}" data-key="${setting.key}" data-type="enum">
        <div class="setting-header">
          <vscode-label class="setting-label">${setting.label}</vscode-label>
          <div class="setting-scope-badge scope-${setting.scope}">${setting.scope}</div>
        </div>
        <div class="setting-description">${setting.description}</div>
        ${this._renderOverrideWarning(setting)}
        <div class="setting-controls">
          <vscode-single-select class="setting-enum-select"
            .value=${currentVal}
            @change=${(e: Event) => this._onEnumChanged(setting.key, e)}>
            ${options.map(opt => html`<vscode-option value=${opt.value}>${opt.label}</vscode-option>`)}
          </vscode-single-select>
          <vscode-single-select class="setting-scope-select"
            .value=${targetScope}
            @change=${(e: Event) => this._onScopeChanged(setting.key, e)}>
            <vscode-option value="workspace">Workspace</vscode-option>
            <vscode-option value="user">User</vscode-option>
          </vscode-single-select>
          <vscode-button class="setting-reset-button" appearance="secondary" title="Reset to default"
            style=${setting.scope === "default" ? "display:none" : ""}
            @click=${() => this._onReset(setting.key)}>Reset</vscode-button>
        </div>
      </div>
    `;
  }
}
