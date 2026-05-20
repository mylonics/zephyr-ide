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

// ---------------------------------------------------------------------------
// Common arguments catalogue
// ---------------------------------------------------------------------------

interface RunnerArgSuggestion {
  /** Short display label shown in the picker. */
  label: string;
  /** The argument text that gets appended to extraArgs (include trailing space where appropriate). */
  arg: string;
  /** One-line description shown alongside the label. */
  description: string;
}

const RUNNER_COMMON_ARGS: Record<string, RunnerArgSuggestion[]> = {
  openocd: [
    { label: "--config", arg: "--config ", description: "Extra OpenOCD config file (-f path/to.cfg)" },
    { label: "--cmd-pre-init", arg: "--cmd-pre-init \"\"", description: "Command to run before init" },
    { label: "--cmd-post-init", arg: "--cmd-post-init \"\"", description: "Command to run after init" },
    { label: "--use-elf", arg: "--use-elf", description: "Flash ELF instead of HEX/BIN" },
    { label: "--serial", arg: "--serial ", description: "Limit to specific USB serial number" },
    { label: "--gdb-port", arg: "--gdb-port 3333", description: "Override GDB server port" },
    { label: "--tcl-port", arg: "--tcl-port 6333", description: "Override TCL port" },
    { label: "--telnet-port", arg: "--telnet-port 4444", description: "Override Telnet port" },
    { label: "--tui", arg: "--tui", description: "Show OpenOCD in a text UI" },
  ],
  jlink: [
    { label: "--device", arg: "--device=", description: "Target MCU name (e.g. STM32F401RE)" },
    { label: "--speed", arg: "--speed=4000", description: "SWD/JTAG speed in kHz" },
    { label: "--iface", arg: "--iface=SWD", description: "Debug interface: SWD or JTAG" },
    { label: "--serial", arg: "--serial=", description: "Limit to a specific J-Link serial number" },
    { label: "--jlink-script", arg: "--jlink-script ", description: "Path to a JLink script file" },
    { label: "--reset-after-load", arg: "--reset-after-load", description: "Reset target after flashing" },
    { label: "--erase", arg: "--erase", description: "Erase whole chip before flashing" },
    { label: "--gdb-port", arg: "--gdb-port 2331", description: "Override GDB server port" },
    { label: "--swd-dp-id", arg: "--swd-dp-id=", description: "SWD DP ID override" },
  ],
  pyocd: [
    { label: "--target", arg: "--target=", description: "Target device pack name (e.g. stm32f401re)" },
    { label: "--probe", arg: "--probe=", description: "Probe UID / serial number" },
    { label: "--frequency", arg: "--frequency=4000000", description: "Probe clock frequency in Hz" },
    { label: "--pack", arg: "--pack=", description: "Path to CMSIS pack to use" },
    { label: "--port", arg: "--port=3333", description: "Override GDB server port" },
    { label: "--reset-type", arg: "--reset-type=hw", description: "Reset type: hw, sw, or core" },
    { label: "--erase", arg: "--erase=chip", description: "Erase policy: chip, sector, or auto" },
    { label: "--no-debug", arg: "--no-debug", description: "Do not enable debug (flash only)" },
  ],
  stlink: [
    { label: "--serial", arg: "--serial=", description: "ST-Link serial number (from st-info)" },
    { label: "--connect-under-reset", arg: "--connect-under-reset", description: "Hold RESET while connecting" },
    { label: "--speed", arg: "--speed=4000", description: "SWD speed in kHz" },
    { label: "--freq", arg: "--freq=4000", description: "Alias for --speed" },
    { label: "--port", arg: "--port=4242", description: "GDB server listen port" },
    { label: "--no-reset", arg: "--no-reset", description: "Do not reset after flashing" },
  ],
  nrfjprog: [
    { label: "--snr", arg: "--snr=", description: "J-Link serial number for nRF probe" },
    { label: "--family", arg: "--family=NRF52", description: "Device family (NRF51, NRF52, NRF53, NRF91)" },
    { label: "--coprocessor", arg: "--coprocessor=CP_APPLICATION", description: "Coprocessor to target on nRF53 (CP_APPLICATION or CP_NETWORK)" },
    { label: "--sectorerase", arg: "--sectorerase", description: "Erase only sectors written during programming" },
    { label: "--chiperase", arg: "--chiperase", description: "Erase the entire chip before programming" },
  ],
  nrfutil: [
    { label: "--serial-number", arg: "--serial-number=", description: "J-Link/nRF serial number" },
    { label: "--core", arg: "--core=\"Application\"", description: "Core to target on multi-core devices" },
    { label: "--traits", arg: "--traits=jlink", description: "Probe traits (jlink, nrfutil-probe, etc.)" },
  ],
  blackmagicprobe: [
    { label: "--gdb-serial", arg: "--gdb-serial=/dev/ttyACM0", description: "BMP GDB serial port" },
    { label: "--connect-srst", arg: "--connect-srst", description: "Assert SRST while attaching" },
    { label: "--bmp-product-id", arg: "--bmp-product-id=", description: "BMP USB Product ID (if multiple)" },
    { label: "--bmp-serial", arg: "--bmp-serial=", description: "BMP serial number (if multiple)" },
  ],
  linkserver: [
    { label: "--device", arg: "--device=", description: "Target MCU device string" },
    { label: "--probe", arg: "--probe=0", description: "Probe index (0 = first)" },
    { label: "--core-index", arg: "--core-index=0", description: "Core index on multi-core devices" },
    { label: "--gdb-port", arg: "--gdb-port=3333", description: "Override GDB server port" },
    { label: "--semihost-port", arg: "--semihost-port=4567", description: "Semihosting port" },
  ],
  "dfu-util": [
    { label: "--alt", arg: "--alt=", description: "DFU interface alternate setting" },
    { label: "--serial", arg: "--serial=", description: "Limit to a specific USB serial number" },
    { label: "--pid", arg: "--pid=", description: "Target USB VID:PID (e.g. 0483:df11)" },
    { label: "--dfuse-address", arg: "--dfuse-address=", description: "DfuSe flash start address" },
    { label: "--reset", arg: "--reset", description: "Issue USB reset after transfer" },
  ],
  uf2: [
    { label: "--mount", arg: "--mount=", description: "Path to UF2 drive mount point" },
  ],
  esp32: [
    { label: "--esp-device", arg: "--esp-device=/dev/ttyUSB0", description: "Serial port for ESP32" },
    { label: "--esp-baud-rate", arg: "--esp-baud-rate=921600", description: "Flash baud rate" },
    { label: "--esp-flash-size", arg: "--esp-flash-size=detect", description: "Flash size: detect or size in MB" },
    { label: "--esp-flash-freq", arg: "--esp-flash-freq=40m", description: "Flash frequency: 40m, 80m, etc." },
    { label: "--esp-flash-mode", arg: "--esp-flash-mode=dio", description: "Flash mode: dio, dout, qio, qout" },
    { label: "--esp-tool", arg: "--esp-tool=esptool", description: "ESP flash tool: esptool or espidf" },
  ],
  qemu: [
    { label: "-machine", arg: "-machine=", description: "QEMU machine type (e.g. mps2-an385)" },
    { label: "-cpu", arg: "-cpu=", description: "QEMU CPU type" },
    { label: "-m", arg: "-m 256", description: "RAM size in MB" },
    { label: "-serial stdio", arg: "-serial stdio", description: "Route serial output to host stdio" },
    { label: "-nographic", arg: "-nographic", description: "Disable graphical output" },
    { label: "-s", arg: "-s", description: "Enable GDB server on :1234" },
    { label: "-S", arg: "-S", description: "Pause at startup until GDB connects" },
  ],
  bossac: [
    { label: "--offset", arg: "--offset=", description: "Flash write offset" },
    { label: "--port", arg: "--port=", description: "Serial port to use" },
    { label: "--erase", arg: "--erase", description: "Erase flash before programming" },
    { label: "--write", arg: "--write", description: "Write to flash" },
  ],
};

type BindKind = "auto" | "runner" | "launch";

interface ProfileBind {
  kind: BindKind;
  runner?: string;
  extraArgs?: string;
  name?: string; // launch.json configuration name
}

interface Profile {
  name: string;
  flash: ProfileBind;
  debug: ProfileBind;
  attach: ProfileBind;
}

type Scope = "user" | "workspace";

interface PanelData {
  userProfiles: Profile[];
  workspaceProfiles: Profile[];
  hasWorkspace: boolean;
  knownRunners: string[];
  launchConfigNames: string[];
  activeProfileName?: string;
  activeBuildLabel?: string;
  /** profile name -> list of "<project> / <build>" strings using it */
  usageByName?: Record<string, string[]>;
}

/**
 * Single-page editor for Runner Profiles. Profiles are listed grouped by
 * scope (workspace + user); each card has an inline editor that posts a
 * `saveProfile` message on demand. Deletes and creates round-trip through
 * the extension host which prompts for confirmation when destructive.
 */
@customElement("runner-profile-app")
export class RunnerProfileApp extends ZephyrLitElement {
  @state() private _data: PanelData | undefined;

  /** Local working copy of every profile keyed by `<scope>:<originalName>`.
   *  Drives "Save" / "Revert" affordances and lets users abandon edits. */
  @state() private _drafts: Map<string, Profile> = new Map();

  /** Tracks which slot arg-suggestion panels are open.
   *  Key: `<scope>:<originalName>:<slot>` */
  @state() private _showArgPicker: Set<string> = new Set();

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
    if (msg?.command === "updateContent" && msg.data) {
      this._data = msg.data as PanelData;
      // Drop drafts whose original profile no longer exists in the new payload,
      // and drop drafts that now match the saved server state (e.g. after a
      // successful save the panel should revert to clean).
      const next = new Map<string, Profile>();
      for (const [k, v] of this._drafts) {
        const [scopeStr, ...nameParts] = k.split(":");
        const pName = nameParts.join(":");
        const serverList = scopeStr === "user"
          ? this._data.userProfiles
          : this._data.workspaceProfiles;
        const serverProfile = serverList.find(p => p.name === pName);
        // Keep draft only if profile still exists AND the draft differs from server.
        if (serverProfile && !profilesEqual(v, serverProfile)) {
          next.set(k, v);
        }
      }
      this._drafts = next;
    }
  };

  // -- Draft helpers --

  private _key(scope: Scope, originalName: string): string {
    return `${scope}:${originalName}`;
  }

  private _draftFor(scope: Scope, original: Profile): Profile {
    const key = this._key(scope, original.name);
    return this._drafts.get(key) ?? original;
  }

  private _updateDraft(scope: Scope, originalName: string, patch: (p: Profile) => Profile) {
    const key = this._key(scope, originalName);
    const original = this._findOriginal(scope, originalName);
    if (!original) { return; }
    const base = this._drafts.get(key) ?? cloneProfile(original);
    const updated = patch(cloneProfile(base));
    const next = new Map(this._drafts);
    if (profilesEqual(updated, original)) {
      next.delete(key);
    } else {
      next.set(key, updated);
    }
    this._drafts = next;
  }

  private _findOriginal(scope: Scope, name: string): Profile | undefined {
    const list = scope === "user"
      ? this._data?.userProfiles ?? []
      : this._data?.workspaceProfiles ?? [];
    return list.find(p => p.name === name);
  }

  private _isDirty(scope: Scope, originalName: string): boolean {
    return this._drafts.has(this._key(scope, originalName));
  }

  // -- Action handlers --

  private _onCreate(scope: Scope) {
    this.postCommand("createProfile", { scope });
  }

  private _onSave(scope: Scope, originalName: string) {
    const draft = this._drafts.get(this._key(scope, originalName));
    if (!draft) { return; }
    // Posting a non-string nested object is fine via raw postMessage.
    this.vscodeApi.postMessage({
      command: "saveProfile",
      scope,
      originalName,
      profile: draft,
    });
  }

  private _onRevert(scope: Scope, originalName: string) {
    const next = new Map(this._drafts);
    next.delete(this._key(scope, originalName));
    this._drafts = next;
  }

  private _onDelete(scope: Scope, name: string) {
    this.vscodeApi.postMessage({ command: "deleteProfile", scope, name });
  }

  private _onSelectActiveProfile() {
    // Omit `name` -> host opens the QuickPick.
    this.vscodeApi.postMessage({ command: "setActiveProfile" });
  }

  private _onUseForActiveBuild(name: string) {
    this.vscodeApi.postMessage({ command: "setActiveProfile", name });
  }

  private _onClearActiveBuildProfile() {
    this.vscodeApi.postMessage({ command: "setActiveProfile", name: null });
  }

  // -- Field editors --

  private _onNameInput(scope: Scope, originalName: string, e: Event) {
    const value = stringFromEvent(e);
    this._updateDraft(scope, originalName, (p) => ({ ...p, name: value }));
  }

  private _onBindSelectChange(
    scope: Scope, originalName: string,
    slot: "flash" | "debug" | "attach", e: Event,
  ) {
    const value = stringFromEvent(e);
    this._updateDraft(scope, originalName, (p) => {
      const existingBind = p[slot];
      let newBind: ProfileBind;
      if (value === "auto") {
        newBind = { kind: "auto" };
      } else if (value.startsWith("launch:")) {
        newBind = { kind: "launch", name: value.slice(7) };
      } else if (value.startsWith("runner:")) {
        const runnerName = value.slice(7);
        const extraArgs = existingBind.kind === "runner" ? (existingBind.extraArgs ?? "") : "";
        newBind = { kind: "runner", runner: runnerName, extraArgs };
      } else {
        newBind = { kind: "auto" };
      }
      return { ...p, [slot]: newBind };
    });
  }

  private _onArgItemChange(
    scope: Scope, originalName: string,
    slot: "flash" | "debug" | "attach", index: number, e: Event,
  ) {
    const value = stringFromEvent(e);
    this._updateDraft(scope, originalName, (p) => {
      const args = parseArgs(p[slot].extraArgs ?? "");
      if (value.trim()) {
        args[index] = value.trim();
      } else {
        args.splice(index, 1);
      }
      return { ...p, [slot]: { ...p[slot], extraArgs: joinArgs(args) } };
    });
  }

  private _onArgItemDelete(
    scope: Scope, originalName: string,
    slot: "flash" | "debug" | "attach", index: number,
  ) {
    this._updateDraft(scope, originalName, (p) => {
      const args = parseArgs(p[slot].extraArgs ?? "");
      args.splice(index, 1);
      return { ...p, [slot]: { ...p[slot], extraArgs: joinArgs(args) } };
    });
  }

  private _onNewArgCommit(
    scope: Scope, originalName: string,
    slot: "flash" | "debug" | "attach", e: Event,
  ) {
    const value = stringFromEvent(e).trim();
    if (!value) { return; }
    this._updateDraft(scope, originalName, (p) => {
      const args = parseArgs(p[slot].extraArgs ?? "");
      args.push(value);
      return { ...p, [slot]: { ...p[slot], extraArgs: joinArgs(args) } };
    });
  }

  // -- Arg picker helpers --

  private _argPickerKey(scope: Scope, originalName: string, slot: string): string {
    return `${scope}:${originalName}:${slot}`;
  }

  private _toggleArgPicker(scope: Scope, originalName: string, slot: string) {
    const key = this._argPickerKey(scope, originalName, slot);
    const next = new Set(this._showArgPicker);
    if (next.has(key)) { next.delete(key); } else { next.add(key); }
    this._showArgPicker = next;
  }

  private _closeArgPicker(scope: Scope, originalName: string, slot: string) {
    const key = this._argPickerKey(scope, originalName, slot);
    const next = new Set(this._showArgPicker);
    next.delete(key);
    this._showArgPicker = next;
  }

  private _appendArg(scope: Scope, originalName: string, slot: "flash" | "debug" | "attach", arg: string) {
    const trimmed = arg.trim();
    if (!trimmed) { return; }
    this._updateDraft(scope, originalName, (p) => {
      const args = parseArgs(p[slot].extraArgs ?? "");
      args.push(trimmed);
      return { ...p, [slot]: { ...p[slot], kind: "runner", runner: p[slot].runner ?? "", extraArgs: joinArgs(args) } };
    });
    this._closeArgPicker(scope, originalName, slot);
  }

  /** Render per-arg rows plus a generic "add argument" row and optional suggestion picker. */
  private _renderArgEditor(
    scope: Scope, originalName: string,
    slot: "flash" | "debug" | "attach",
    bind: ProfileBind,
    currentRunner: string,
  ) {
    const key = this._argPickerKey(scope, originalName, slot);
    const pickerOpen = this._showArgPicker.has(key);
    const allSuggestions = RUNNER_COMMON_ARGS[currentRunner] ?? [];
    const args = parseArgs(bind.extraArgs ?? "");
    // Filter out suggestions whose flag is already present in the current args.
    const availableSuggestions = allSuggestions.filter(
      s => !args.some(a => a === s.label || a.startsWith(s.label + "=") || a.startsWith(s.label + " ")),
    );

    return html`
      <div class="arg-editor">
        ${args.map((arg, i) => html`
          <div class="arg-row">
            <vscode-textfield class="arg-row-input"
              .value=${arg}
              placeholder="argument"
              @change=${(e: Event) => this._onArgItemChange(scope, originalName, slot, i, e)}>
            </vscode-textfield>
            <vscode-button appearance="icon" icon="close"
              title="Remove argument"
              @click=${() => this._onArgItemDelete(scope, originalName, slot, i)}>
            </vscode-button>
          </div>
        `)}
        <div class="arg-row arg-row-new">
          <vscode-textfield class="arg-row-input"
            .value=${""}
            placeholder="Add argument…"
            @change=${(e: Event) => this._onNewArgCommit(scope, originalName, slot, e)}>
          </vscode-textfield>
          ${availableSuggestions.length > 0 ? html`
            <vscode-button appearance="icon" icon="chevron-down"
              title="Browse common arguments for ${currentRunner}"
              @click=${() => this._toggleArgPicker(scope, originalName, slot)}>
            </vscode-button>` : nothing}
        </div>
        ${pickerOpen && availableSuggestions.length > 0 ? html`
          <div class="arg-picker-panel">
            <div class="arg-picker-header">
              <span>Common <strong>${currentRunner}</strong> arguments</span>
              <vscode-button appearance="icon" icon="close"
                @click=${() => this._closeArgPicker(scope, originalName, slot)}>
              </vscode-button>
            </div>
            <div class="arg-picker-list">
              ${availableSuggestions.map(s => html`
                <button class="arg-picker-item"
                  title=${s.description}
                  @click=${() => this._appendArg(scope, originalName, slot, s.arg)}>
                  <code class="arg-picker-flag">${s.label}</code>
                  <span class="arg-picker-desc">${s.description}</span>
                </button>
              `)}
            </div>
          </div>` : nothing}
      </div>
    `;
  }

  // -- Render --

  render() {
    if (!this._data) {
      return html`<div class="panel-container"><p>Loading…</p></div>`;
    }
    const d = this._data;

    return html`
      <div class="panel-container">
        <div class="page-header">
          <div>
            <h1 class="page-title">
              <i class="codicon codicon-debug-alt-small"></i> Runner Profiles
            </h1>
            <p class="page-subtitle">
              Reusable bundles of <strong>flash</strong>, <strong>debug</strong>, and <strong>attach</strong> binds.
              Workspace profiles live in <code>.vscode/zephyr-ide.json</code>; user profiles live in
              <code>zephyr-ide.runnerProfiles</code> settings. Workspace overrides user on name collision.
            </p>
          </div>
        </div>

        ${d.activeProfileName || d.activeBuildLabel
        ? html`
              <div class="active-build-banner">
                <i class="codicon codicon-pin"></i>
                <span>
                  ${d.activeBuildLabel
            ? html`Active build: <strong>${d.activeBuildLabel}</strong>`
            : html`No active build`}
                  ${d.activeProfileName
            ? html` &mdash; using profile <strong>${d.activeProfileName}</strong>`
            : html` &mdash; <em>no profile selected (auto / runners.yaml defaults)</em>`}
                </span>
                <vscode-button appearance="secondary" icon="settings-gear"
                  @click=${() => this._onSelectActiveProfile()}
                  ?disabled=${!d.activeBuildLabel}>
                  Change active profile
                </vscode-button>
                ${d.activeProfileName
            ? html`<vscode-button appearance="icon" icon="close"
                title="Clear active profile (revert to runners.yaml defaults)"
                @click=${() => this._onClearActiveBuildProfile()}></vscode-button>`
            : nothing}
              </div>`
        : nothing}

        ${this._renderScope("workspace", d.workspaceProfiles)}
        ${this._renderScope("user", d.userProfiles)}
      </div>
    `;
  }

  private _renderScope(scope: Scope, profiles: Profile[]) {
    const d = this._data!;
    if (scope === "workspace" && !d.hasWorkspace) {
      return html`
        <section class="scope-section">
          <div class="scope-section-header">
            <h2 class="scope-section-title">
              <i class="codicon codicon-folder"></i> Workspace
            </h2>
            <span class="scope-section-hint">Open a workspace to add workspace-scoped profiles.</span>
          </div>
        </section>`;
    }

    const heading = scope === "workspace"
      ? html`<i class="codicon codicon-folder"></i> Workspace`
      : html`<i class="codicon codicon-account"></i> User`;
    const hint = scope === "workspace"
      ? html`Saved to <code>.vscode/zephyr-ide.json</code>. Shared with anyone who clones the repo.`
      : html`Saved to <code>zephyr-ide.runnerProfiles</code> user setting. Available across all workspaces.`;

    return html`
      <section class="scope-section">
        <div class="scope-section-header">
          <h2 class="scope-section-title">${heading}</h2>
          <span class="scope-section-hint">${hint}</span>
          <vscode-button appearance="primary" icon="add"
            @click=${() => this._onCreate(scope)}>
            New profile
          </vscode-button>
        </div>
        ${profiles.length === 0
        ? html`<div class="scope-section-empty">
              No ${scope} profiles yet. Click <strong>New profile</strong> to add one.
            </div>`
        : html`<div class="profile-list">
              ${profiles.map(p => this._renderProfileCard(scope, p))}
            </div>`}
      </section>
    `;
  }

  private _renderProfileCard(scope: Scope, original: Profile) {
    const draft = this._draftFor(scope, original);
    const dirty = this._isDirty(scope, original.name);
    const isActive = !!this._data?.activeProfileName && this._data.activeProfileName === original.name;
    const usage = this._data?.usageByName?.[original.name] ?? [];
    const hasActiveBuild = !!this._data?.activeBuildLabel;

    return html`
      <div class="profile-card ${isActive ? "active" : ""}">
        <div class="profile-card-header">
          <vscode-textfield class="profile-card-name"
            .value=${draft.name}
            placeholder="Profile name"
            @change=${(e: Event) => this._onNameInput(scope, original.name, e)}
            @input=${(e: Event) => this._onNameInput(scope, original.name, e)}>
          </vscode-textfield>
          ${isActive ? html`<span class="profile-active-badge" title="Active profile for the current build"><i class="codicon codicon-pin"></i> active</span>` : nothing}
          ${usage.length > 0
        ? html`<span class="profile-usage-badge"
              title=${`Used by ${usage.length} build${usage.length === 1 ? "" : "s"}:\n${usage.join("\n")}`}>
              <i class="codicon codicon-link"></i> ${usage.length}
            </span>`
        : nothing}
        </div>

        <div class="profile-slots">
          ${this._renderSlot(scope, original.name, draft, "flash", "zap")}
          ${this._renderSlot(scope, original.name, draft, "debug", "debug-alt")}
          ${this._renderSlot(scope, original.name, draft, "attach", "debug-console")}
        </div>

        <div class="profile-card-actions">
          ${dirty ? html`<span class="dirty-hint">Unsaved changes</span>` : nothing}
          ${!dirty && hasActiveBuild && !isActive
        ? html`<vscode-button appearance="secondary" icon="pin"
              title="Set as active profile for the current build"
              @click=${() => this._onUseForActiveBuild(original.name)}>
              Use for active build
            </vscode-button>`
        : nothing}
          ${dirty ? html`
            <vscode-button appearance="secondary" icon="discard"
              @click=${() => this._onRevert(scope, original.name)}>
              Revert
            </vscode-button>
            <vscode-button appearance="primary" icon="save"
              @click=${() => this._onSave(scope, original.name)}>
              Save
            </vscode-button>
          ` : nothing}
          <vscode-button appearance="icon" icon="trash" title="Delete profile"
            @click=${() => this._onDelete(scope, original.name)}>
          </vscode-button>
        </div>
      </div>
    `;
  }

  private _renderSlot(
    scope: Scope, originalName: string, draft: Profile,
    slot: "flash" | "debug" | "attach", icon: string,
  ) {
    const bind = draft[slot];
    const label = slot.charAt(0).toUpperCase() + slot.slice(1);
    const allowLaunch = slot !== "flash";
    const d = this._data!;
    const currentValue = bindToSelectValue(bind);
    const knownRunners = d.knownRunners.length > 0 ? d.knownRunners : (bind.kind === "runner" ? [bind.runner ?? "openocd"] : ["openocd"]);

    // If the saved bind is a launch config not in the known list, keep it selectable.
    const syntheticLaunch = allowLaunch && bind.kind === "launch" && bind.name
      && !d.launchConfigNames.includes(bind.name);

    return html`
      <div class="profile-slot-section">
        <div class="profile-slot-header">
          <i class="codicon codicon-${icon}"></i>
          <span class="profile-slot-title">${label}</span>
        </div>
        <div class="profile-slot-body">
          <vscode-single-select class="profile-slot-select"
            .value=${currentValue}
            @change=${(e: Event) => this._onBindSelectChange(scope, originalName, slot, e)}>
            <vscode-option value="auto" ?selected=${bind.kind === "auto"}>Auto (runners.yaml)</vscode-option>
            ${allowLaunch && d.launchConfigNames.length > 0 ? html`
              <vscode-option value="" disabled>─── launch.json ───</vscode-option>
              ${d.launchConfigNames.map(n => html`
                <vscode-option
                  value=${"launch:" + n}
                  ?selected=${bind.kind === "launch" && bind.name === n}>${n}</vscode-option>
              `)}
            ` : nothing}
            ${syntheticLaunch ? html`
              <vscode-option value="" disabled>─── launch.json ───</vscode-option>
              <vscode-option
                value=${"launch:" + bind.name}
                ?selected=${true}>${bind.name}</vscode-option>
            ` : nothing}
            <vscode-option value="" disabled>─── Runners ───</vscode-option>
            ${knownRunners.map(r => html`
              <vscode-option
                value=${"runner:" + r}
                ?selected=${bind.kind === "runner" && bind.runner === r}>${r}</vscode-option>
            `)}
          </vscode-single-select>
          ${bind.kind === "runner"
        ? this._renderArgEditor(scope, originalName, slot, bind, bind.runner ?? "")
        : nothing}
          ${bind.kind === "auto"
        ? html`<span class="scope-section-hint">Uses runners.yaml defaults.</span>`
        : nothing}
          ${bind.kind === "launch" && allowLaunch && d.launchConfigNames.length === 0 && !syntheticLaunch
        ? html`<span class="no-launch-warning">No launch.json configs detected.</span>`
        : nothing}
        </div>
      </div>
    `;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stringFromEvent(e: Event): string {
  const target = e.target as { value?: unknown } | null;
  if (target && typeof target.value === "string") { return target.value; }
  return "";
}

function bindToSelectValue(bind: ProfileBind): string {
  if (bind.kind === "auto") { return "auto"; }
  if (bind.kind === "launch") { return `launch:${bind.name ?? ""}`; }
  return `runner:${bind.runner ?? ""}`;
}

/** Split an extraArgs string into individual argument tokens, respecting quoted strings. */
function parseArgs(extraArgs: string): string[] {
  const s = extraArgs.trim();
  if (!s) { return []; }
  const result: string[] = [];
  let current = "";
  let inQuote = false;
  let quoteChar = "";
  for (const ch of s) {
    if (inQuote) {
      current += ch;
      if (ch === quoteChar) { inQuote = false; }
    } else if (ch === '"' || ch === "'") {
      inQuote = true;
      quoteChar = ch;
      current += ch;
    } else if (/\s/.test(ch)) {
      if (current) { result.push(current); current = ""; }
    } else {
      current += ch;
    }
  }
  if (current) { result.push(current); }
  return result;
}

function joinArgs(args: string[]): string {
  return args.join(" ");
}

function cloneProfile(p: Profile): Profile {
  return {
    name: p.name,
    flash: { ...p.flash },
    debug: { ...p.debug },
    attach: { ...p.attach },
  };
}

function bindsEqual(a: ProfileBind, b: ProfileBind): boolean {
  if (a.kind !== b.kind) { return false; }
  if (a.kind === "auto") { return true; }
  if (a.kind === "runner") {
    return (a.runner ?? "") === (b.runner ?? "")
      && (a.extraArgs ?? "") === (b.extraArgs ?? "");
  }
  return (a.name ?? "") === (b.name ?? "");
}

function profilesEqual(a: Profile, b: Profile): boolean {
  return a.name === b.name
    && bindsEqual(a.flash, b.flash)
    && bindsEqual(a.debug, b.debug)
    && bindsEqual(a.attach, b.attach);
}
