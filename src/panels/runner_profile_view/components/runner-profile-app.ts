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
import "../../webview_shared/runner-args-editor";
import type { ArgValue } from "../../webview_shared/runner-args-editor";
import { getSchemaFor, hasSchema } from "../../../project_utilities/runner_arg_schema";

// ---------------------------------------------------------------------------
// Common arguments catalogue
// ---------------------------------------------------------------------------

type RunnerArgChoice =
  | { separator: true; label: string }
  | { label: string; arg: string; description?: string };

interface RunnerArgSuggestion {
  /** Short display label shown in the picker. */
  label: string;
  /** The argument text that gets appended to extraArgs (include trailing space where appropriate). */
  arg: string;
  /** One-line description shown alongside the label. */
  description: string;
  /**
   * Which bind slots this suggestion applies to. Omit (or leave undefined)
   * to show in all slots (flash, debug, attach, buildDebug).
   * Use this to hide flash-only args from debug slots and vice-versa.
   */
  slots?: ("flash" | "debug" | "attach" | "buildDebug")[];
  /**
   * When present the suggestion row becomes expandable: clicking it reveals
   * these sub-choices instead of immediately appending `arg`. Each choice
   * can be a separator header or a concrete value the user can pick.
   */
  choices?: RunnerArgChoice[];
}

const RUNNER_COMMON_ARGS: Record<string, RunnerArgSuggestion[]> = {
  openocd: [
    // ── Common (flash + debug) ────────────────────────────────────────────────
    // Note: --openocd-config is translated to `configFiles` in the cortex-debug launch config.
    // Multiple can be added (one for interface, one for target).
    {
      label: "--openocd-config", arg: "--openocd-config ",
      description: "OpenOCD config file → configFiles in cortex-debug (may be given multiple times; pick or type a path)",
      choices: [
        // ── Interfaces ──────────────────────────────────────────────────────
        { separator: true, label: "Interfaces" },
        { label: "interface/stlink.cfg", arg: "--openocd-config interface/stlink.cfg", description: "ST-LINK v2/v3 (most common for STM32 / nRF52 with SWD)" },
        { label: "interface/cmsis-dap.cfg", arg: "--openocd-config interface/cmsis-dap.cfg", description: "CMSIS-DAP (DAPLink, ULINK2, MCU-Link, …)" },
        { label: "interface/jlink.cfg", arg: "--openocd-config interface/jlink.cfg", description: "SEGGER J-Link via OpenOCD" },
        { label: "interface/ftdi.cfg", arg: "--openocd-config interface/ftdi.cfg", description: "FTDI-based probe (generic)" },
        { label: "interface/picoprobe.cfg", arg: "--openocd-config interface/picoprobe.cfg", description: "Raspberry Pi Pico used as SWD/JTAG probe" },
        { label: "interface/raspberrypi-swd.cfg", arg: "--openocd-config interface/raspberrypi-swd.cfg", description: "Raspberry Pi GPIO bit-banged SWD" },
        { label: "interface/buspirate.cfg", arg: "--openocd-config interface/buspirate.cfg", description: "Bus Pirate USB probe" },
        // ── Targets ─────────────────────────────────────────────────────────
        { separator: true, label: "Targets" },
        { label: "target/nrf52.cfg", arg: "--openocd-config target/nrf52.cfg", description: "Nordic nRF52xxx (nRF52832, nRF52840, …)" },
        { label: "target/nrf5340.cfg", arg: "--openocd-config target/nrf5340.cfg", description: "Nordic nRF5340" },
        { label: "target/rp2040.cfg", arg: "--openocd-config target/rp2040.cfg", description: "Raspberry Pi RP2040 (Pico)" },
        { label: "target/stm32f1x.cfg", arg: "--openocd-config target/stm32f1x.cfg", description: "STM32F1xx series" },
        { label: "target/stm32f4x.cfg", arg: "--openocd-config target/stm32f4x.cfg", description: "STM32F4xx series" },
        { label: "target/stm32g0x.cfg", arg: "--openocd-config target/stm32g0x.cfg", description: "STM32G0xx series" },
        { label: "target/stm32g4x.cfg", arg: "--openocd-config target/stm32g4x.cfg", description: "STM32G4xx series" },
        { label: "target/stm32h7x.cfg", arg: "--openocd-config target/stm32h7x.cfg", description: "STM32H7xx series" },
        { label: "target/stm32l4x.cfg", arg: "--openocd-config target/stm32l4x.cfg", description: "STM32L4xx series" },
        { label: "target/esp32s3.cfg", arg: "--openocd-config target/esp32s3.cfg", description: "Espressif ESP32-S3" },
      ],
    },
    { label: "--cmd-pre-init", arg: "--cmd-pre-init \"\"", description: "OpenOCD command to run before calling init (may repeat)" },
    { label: "--serial", arg: "--serial ", description: "Limit to a specific FTDI/USB serial number" },
    { label: "--tcl-port", arg: "--tcl-port 6333", description: "Override TCL port (default: 6333)" },
    { label: "--telnet-port", arg: "--telnet-port 4444", description: "Override Telnet port (default: 4444)" },
    // ── Flash-only ───────────────────────────────────────────────────────────
    { label: "--cmd-pre-init-flash", arg: "--cmd-pre-init-flash \"\"", description: "Command before init when flashing; overrides --cmd-pre-init during flash (may repeat)", slots: ["flash"] },
    { label: "--cmd-pre-load", arg: "--cmd-pre-load \"\"", description: "OpenOCD command to run before loading/flashing (may repeat)", slots: ["flash"] },
    { label: "--use-elf", arg: "--use-elf", description: "Flash ELF instead of HEX/BIN", slots: ["flash"] },
    { label: "--verify", arg: "--verify", description: "Verify flash contents after programming", slots: ["flash"] },
    // ── Debug/attach-only ────────────────────────────────────────────────────
    { label: "--gdb-port", arg: "--gdb-port 3333", description: "Override GDB server port (default: 3333)", slots: ["debug", "attach", "buildDebug"] },
    { label: "--gdb-client-port", arg: "--gdb-client-port 3333", description: "GDB client port when multiple ports are open (default: 3333)", slots: ["debug", "attach", "buildDebug"] },
    { label: "--tui", arg: "--tui", description: "Use GDB -tui mode", slots: ["debug", "attach", "buildDebug"] },
    { label: "--no-halt", arg: "--no-halt", description: "Skip halt command in GDB server startup", slots: ["debug", "attach", "buildDebug"] },
    { label: "--rtt-port", arg: "--rtt-port 5555", description: "OpenOCD RTT server port (default: 5555)", slots: ["debug", "attach", "buildDebug"] },
    { label: "--rtt-server", arg: "--rtt-server", description: "Start RTT server while debugging (connect with telnet)", slots: ["debug", "attach", "buildDebug"] },
    // Zephyr IDE translation: sets rttConfig in the cortex-debug launch config.
    { label: "--enable-rtt", arg: "--enable-rtt", description: "Enable RTT → rttConfig in cortex-debug (address: auto, rtt_start_retry: 1000, channel 0 console decoder)", slots: ["debug", "attach", "buildDebug"] },
  ],
  jlink: [
    // ── Common ───────────────────────────────────────────────────────────────
    { label: "--device", arg: "--device=", description: "Target MCU name (e.g. STM32F401RE) — required" },
    { label: "--speed", arg: "--speed=4000", description: "SWD/JTAG speed in kHz (or 'auto')" },
    { label: "--iface", arg: "--iface=SWD", description: "Debug interface: SWD or JTAG (default: swd)" },
    { label: "--id", arg: "--id=", description: "J-Link serial number (obsolete synonym for --dev-id)" },
    { label: "--pre-script-cmd", arg: "--pre-script-cmd ", description: "Custom J-Link command prepended to runner.jlink (may repeat)" },
    // ── Flash-only ───────────────────────────────────────────────────────────
    { label: "--flash-script", arg: "--flash-script ", description: "Path to a custom J-Link Commander flash script", slots: ["flash"] },
    { label: "--loader", arg: "--loader=", description: "J-Link loader type (e.g. NorFlash)", slots: ["flash"] },
    { label: "--reset-after-load", arg: "--reset-after-load", description: "Reset target after flashing (deprecated synonym for --reset/--no-reset)", slots: ["flash"] },
    { label: "--erase", arg: "--erase", description: "Erase whole chip before flashing", slots: ["flash"] },
    { label: "--flash-sram", arg: "--flash-sram", description: "Flash image to SRAM and set PC to SRAM base address", slots: ["flash"] },
    // ── Debug/attach-only ────────────────────────────────────────────────────
    { label: "--gdb-port", arg: "--gdb-port 2331", description: "Override GDB server port (default: 2331)", slots: ["debug", "attach", "buildDebug"] },
    { label: "--rtt-port", arg: "--rtt-port 19021", description: "J-Link RTT telnet port (default: 19021)", slots: ["debug", "attach", "buildDebug"] },
    { label: "--tui", arg: "--tui", description: "Use GDB -tui mode", slots: ["debug", "attach", "buildDebug"] },
  ],
  pyocd: [
    // ── Common ───────────────────────────────────────────────────────────────
    { label: "--target", arg: "--target=", description: "Target device pack name (e.g. stm32f401re) — required" },
    { label: "--board-id", arg: "--board-id=", description: "Probe board ID / serial number (alias for --dev-id)" },
    { label: "--frequency", arg: "--frequency=4000000", description: "Probe clock frequency in Hz" },
    { label: "--daparg", arg: "--daparg=", description: "Additional -da argument passed to the pyocd tool" },
    // ── Flash-only ───────────────────────────────────────────────────────────
    { label: "--flash-opt", arg: "--flash-opt=", description: "Extra option for pyocd flash (e.g. --flash-opt=--pack=path/to.pack; may repeat)", slots: ["flash"] },
    { label: "--erase", arg: "--erase", description: "Chip-erase before flashing", slots: ["flash"] },
    // ── Debug/attach-only ────────────────────────────────────────────────────
    { label: "--gdb-port", arg: "--gdb-port=3333", description: "Override GDB server port (default: 3333)", slots: ["debug", "attach", "buildDebug"] },
    { label: "--telnet-port", arg: "--telnet-port=4444", description: "Override Telnet port (default: 4444)", slots: ["debug", "attach", "buildDebug"] },
    { label: "--tui", arg: "--tui", description: "Use GDB -tui mode", slots: ["debug", "attach", "buildDebug"] },
  ],
  stm32cubeprogrammer: [
    { label: "--port", arg: "--port=swd", description: "Interface identifier: swd, jtag, /dev/ttyS0, usb1, etc. — required" },
    { label: "--frequency", arg: "--frequency=4000", description: "Programmer frequency in KHz" },
    { label: "--download-address", arg: "--download-address=", description: "Flash location address; causes .bin to be used instead of .hex" },
    { label: "--conn-modifiers", arg: "--conn-modifiers=", description: "Additional options appended to the --connect argument" },
    { label: "--download-modifiers", arg: "--download-modifiers=", description: "Additional options appended to the --download argument (may repeat)" },
    { label: "--use-elf", arg: "--use-elf", description: "Flash ELF file instead of HEX file" },
    { label: "--start-address", arg: "--start-address=", description: "Address where execution begins after flashing" },
    { label: "--reset-type", arg: "--reset-type=sw", description: "Reset mode after flashing: sw (software), hw (hardware), or core (core reset)" },
  ],
  nrfjprog: [
    { label: "--snr", arg: "--snr=", description: "J-Link serial number for nRF probe (alias for --dev-id)" },
    { label: "--nrf-family", arg: "--nrf-family=NRF52", description: "Device family: NRF51, NRF52, NRF53, NRF54L, NRF54H, NRF71, NRF91, NRF92" },
    { label: "--erase", arg: "--erase", description: "Chip-erase before programming (same as --erase-mode=all)" },
    { label: "--erase-mode", arg: "--erase-mode=ranges", description: "Erase mode for internal flash: none, ranges (sectors touched), or all (chip)" },
    { label: "--ext-erase-mode", arg: "--ext-erase-mode=ranges", description: "Erase mode for external flash: none, ranges (sectors touched), or all (chip)" },
    { label: "--softreset", arg: "--softreset", description: "Use soft reset instead of pin reset after flashing" },
    { label: "--pinreset", arg: "--pinreset", description: "Use pin reset instead of soft reset after flashing" },
    { label: "--recover", arg: "--recover", description: "Erase all and disable readback protection before flashing" },
    { label: "--force", arg: "--force", description: "Flash even if the result cannot be guaranteed" },
    { label: "--qspiini", arg: "--qspiini=", description: "Path to a .ini file with QSPI configuration (nrfjprog only)" },
  ],
  nrfutil: [
    { label: "--snr", arg: "--snr=", description: "J-Link serial number for nRF probe (alias for --dev-id; may repeat for bulk)" },
    { label: "--nrf-family", arg: "--nrf-family=NRF52", description: "Device family: NRF51, NRF52, NRF53, NRF54L, NRF54H, NRF71, NRF91, NRF92" },
    { label: "--erase", arg: "--erase", description: "Chip-erase before programming" },
    { label: "--erase-mode", arg: "--erase-mode=ranges", description: "Erase mode: none, ranges (sectors touched), or all (chip)" },
    { label: "--softreset", arg: "--softreset", description: "Use soft reset instead of pin reset after flashing" },
    { label: "--pinreset", arg: "--pinreset", description: "Use pin reset instead of soft reset after flashing" },
    { label: "--recover", arg: "--recover", description: "Erase all and disable readback protection before flashing" },
    { label: "--force", arg: "--force", description: "Flash even if the result cannot be guaranteed" },
    { label: "--ext-mem-config-file", arg: "--ext-mem-config-file=", description: "Path to JSON file with external memory configuration" },
  ],
  blackmagicprobe: [
    // ── Common ───────────────────────────────────────────────────────────────
    // Note: BMP uses GDB for both flash and debug, so --gdb-serial applies to both.
    // bmp-debug (mylonics.bmp-debug) auto-discovers the probe; cortex-debug requires this.
    { label: "--gdb-serial", arg: "--gdb-serial=/dev/ttyACM0", description: "BMP GDB serial port → BMPGDBSerialPort in cortex-debug (auto-discovered by bmp-debug)" },
    { label: "--connect-srst", arg: "--connect-srst", description: "Assert SRST while connecting (also accepted as --connect-rst)" },
    // ── Debug/attach-only (cortex-debug / bmp-debug translations) ────────────
    // These are Zephyr IDE-specific flags that are translated to cortex-debug/bmp-debug
    // launch config properties when the debug session is started. They have no effect
    // on west flash.
    { label: "--enable-rtt", arg: "--enable-rtt", description: "Enable RTT → rttEnabled: true in bmp-debug launch config", slots: ["debug", "attach", "buildDebug"] },
    { label: "--rtt-port", arg: "--rtt-port=0", description: "RTT channel port → rttConfig decoder port in cortex-debug/bmp-debug (default: 0)", slots: ["debug", "attach", "buildDebug"] },
  ],
  linkserver: [
    { label: "--device", arg: "--device=", description: "Target MCU device string (required, e.g. MIMXRT1060xxxxx:cm7)" },
    { label: "--probe", arg: "--probe=#1", description: "Probe index or serial number (default: #1)" },
    { label: "--core", arg: "--core=", description: "Core to target on multi-core devices (e.g. cm33_core0)" },
    { label: "--gdb-port", arg: "--gdb-port=3333", description: "Override GDB server port (default: 3333)" },
    { label: "--semihost-port", arg: "--semihost-port=8888", description: "Semihosting port (default: 8888)" },
    { label: "--override", arg: "--override=", description: "Configuration override (e.g. /device/memory/0/location=0xCAFECAFE)" },
  ],
  "dfu-util": [
    { label: "--alt", arg: "--alt=", description: "DFU interface alternate setting number or name — required" },
    { label: "--pid", arg: "--pid=", description: "USB VID:PID of the target device (e.g. 0483:df11)" },
    { label: "--dfuse", arg: "--dfuse", description: "Use DfuSe protocol extensions (STMicroelectronics devices)" },
    { label: "--dfuse-modifiers", arg: "--dfuse-modifiers=leave", description: "Colon-separated DfuSe modifiers appended to -s (default: leave)" },
    { label: "--img", arg: "--img=", description: "Binary file to flash (defaults to build-system bin file)" },
  ],
  uf2: [
    { label: "--board-id", arg: "--board-id=", description: "Board-ID string to match against INFO_UF2.TXT on the UF2 volume" },
  ],
  esp32: [
    { label: "--esp-device", arg: "--esp-device=/dev/ttyUSB0", description: "Serial port for ESP32 (or set ESPTOOL_PORT env var)" },
    { label: "--esp-baud-rate", arg: "--esp-baud-rate=921600", description: "Flash baud rate (default: 921600)" },
    { label: "--esp-flash-size", arg: "--esp-flash-size=detect", description: "Flash size: detect or explicit size (e.g. 4MB)" },
    { label: "--esp-flash-freq", arg: "--esp-flash-freq=40m", description: "Flash clock frequency (default: 40m)" },
    { label: "--esp-flash-mode", arg: "--esp-flash-mode=dio", description: "Flash mode: dio, dout, qio, qout (default: dio)" },
    { label: "--esp-idf-path", arg: "--esp-idf-path=", description: "Path to ESP-IDF installation — required" },
    { label: "--esp-boot-address", arg: "--esp-boot-address=0x1000", description: "Bootloader load address (default: 0x1000)" },
    { label: "--esp-partition-table-address", arg: "--esp-partition-table-address=0x8000", description: "Partition table load address (default: 0x8000)" },
    { label: "--esp-app-address", arg: "--esp-app-address=0x10000", description: "Application load address (default: 0x10000)" },
    { label: "--esp-encrypt", arg: "--esp-encrypt", description: "Encrypt firmware while flashing (requires correct eFuses)" },
    { label: "--esp-no-stub", arg: "--esp-no-stub", description: "Disable launching flasher stub; use ROM bootloader only" },
  ],
  bossac: [
    { label: "--bossac-port", arg: "--bossac-port=", description: "Serial port to use for flashing" },
    { label: "--speed", arg: "--speed=115200", description: "Serial port speed (default: 115200)" },
    { label: "--erase", arg: "--erase", description: "Erase flash before programming" },
    { label: "--delay", arg: "--delay=0.5", description: "Delay in seconds to wait after entering bootloader mode" },
  ],
};

type BindKind = "auto" | "runner" | "launch";

interface ProfileBind {
  kind: BindKind;
  runner?: string;
  extraArgs?: string[];
  /** Structured args (new schema-driven editor). When present, takes precedence over `extraArgs`. */
  args?: { structured: ArgValue[]; raw?: string[] };
  name?: string; // launch.json configuration name
}

interface Profile {
  name: string;
  flash: ProfileBind;
  buildDebug?: ProfileBind;
  debug: ProfileBind;
  attach: ProfileBind;
}

type Scope = "user" | "workspace";

interface PanelData {
  userProfiles: Profile[];
  workspaceProfiles: Profile[];
  hasWorkspace: boolean;
  knownRunners: string[];
  knownDebugRunners: string[];
  launchConfigNames: string[];
  activeProfileName?: string;
  activeBuildLabel?: string;
  /** profile name -> list of "<project> / <build>" strings using it */
  usageByName?: Record<string, string[]>;
  /** Mirror of `zephyr-ide.separateBuildDebugProfile` setting. */
  separateBuildDebugProfile?: boolean;
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

  /** Tracks which suggestion choices sub-lists are expanded.
   *  Key: `<scope>:<originalName>:<slot>|<suggestionLabel>` */
  @state() private _expandedArgSuggestion: Set<string> = new Set();

  /** Tracks which arg editors are showing the variable substitution help.
   *  Key: `<scope>:<originalName>:<slot>` */
  @state() private _showVarHelp: Set<string> = new Set();

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

  private _onDuplicate(scope: Scope, name: string) {
    this.vscodeApi.postMessage({ command: "duplicateProfile", scope, name });
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
    slot: "flash" | "buildDebug" | "debug" | "attach", e: Event,
  ) {
    const value = stringFromEvent(e);
    this._updateDraft(scope, originalName, (p) => {
      const existingBind: ProfileBind = p[slot] ?? { kind: "auto" };
      let newBind: ProfileBind;
      if (value === "auto") {
        newBind = { kind: "auto" };
      } else if (value.startsWith("launch:")) {
        newBind = { kind: "launch", name: value.slice(7) };
      } else if (value.startsWith("runner:")) {
        const runnerName = value.slice(7);
        const extraArgs = existingBind.kind === "runner" ? (existingBind.extraArgs ?? []) : [];
        newBind = { kind: "runner", runner: runnerName, extraArgs };
      } else {
        newBind = { kind: "auto" };
      }
      return { ...p, [slot]: newBind };
    });
  }

  private _onArgItemChange(
    scope: Scope, originalName: string,
    slot: "flash" | "buildDebug" | "debug" | "attach", index: number, e: Event,
  ) {
    const value = stringFromEvent(e);
    this._updateDraft(scope, originalName, (p) => {
      const current: ProfileBind = p[slot] ?? { kind: "auto" };
      const args = [...(current.extraArgs ?? [])];
      if (value.trim()) {
        args[index] = value.trim();
      } else {
        args.splice(index, 1);
      }
      return { ...p, [slot]: { ...current, extraArgs: args } };
    });
  }

  private _onArgItemDelete(
    scope: Scope, originalName: string,
    slot: "flash" | "buildDebug" | "debug" | "attach", index: number,
  ) {
    this._updateDraft(scope, originalName, (p) => {
      const current: ProfileBind = p[slot] ?? { kind: "auto" };
      const args = [...(current.extraArgs ?? [])];
      args.splice(index, 1);
      return { ...p, [slot]: { ...current, extraArgs: args } };
    });
  }

  private _onNewArgCommit(
    scope: Scope, originalName: string,
    slot: "flash" | "buildDebug" | "debug" | "attach", e: Event,
  ) {
    const value = stringFromEvent(e).trim();
    if (!value) { return; }
    this._updateDraft(scope, originalName, (p) => {
      const current: ProfileBind = p[slot] ?? { kind: "auto" };
      const args = [...(current.extraArgs ?? [])];
      args.push(value);
      return { ...p, [slot]: { ...current, extraArgs: args } };
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

  private _toggleVarHelp(scope: Scope, originalName: string, slot: string) {
    const key = this._argPickerKey(scope, originalName, slot);
    const next = new Set(this._showVarHelp);
    if (next.has(key)) { next.delete(key); } else { next.add(key); }
    this._showVarHelp = next;
  }

  private _closeVarHelp(scope: Scope, originalName: string, slot: string) {
    const key = this._argPickerKey(scope, originalName, slot);
    const next = new Set(this._showVarHelp);
    next.delete(key);
    this._showVarHelp = next;
  }

  private _toggleChoices(pickerKey: string, suggestionLabel: string) {
    const k = `${pickerKey}|${suggestionLabel}`;
    const next = new Set(this._expandedArgSuggestion);
    if (next.has(k)) { next.delete(k); } else { next.add(k); }
    this._expandedArgSuggestion = next;
  }

  private _onSecondarySelectChange(
    scope: Scope, originalName: string,
    slot: "flash" | "buildDebug" | "debug" | "attach",
    runner: string, cfgIndex: number, e: Event,
  ) {
    const value = stringFromEvent(e);
    const cfg = RUNNER_SECONDARY_SELECTS[runner]?.[cfgIndex];
    if (!cfg) { return; }
    this._updateDraft(scope, originalName, (p) => {
      const current: ProfileBind = p[slot] ?? { kind: "auto" };
      const filtered = cfg.filterOut(current.extraArgs ?? []);
      const newArg = cfg.buildArg(value);
      const args = newArg ? [...filtered, newArg] : filtered;
      return { ...p, [slot]: { ...current, extraArgs: args } };
    });
  }

  private _renderSecondarySelect(
    scope: Scope, originalName: string,
    slot: "flash" | "buildDebug" | "debug" | "attach",
    runner: string, bind: ProfileBind,
  ) {
    const configs = RUNNER_SECONDARY_SELECTS[runner];
    if (!configs?.length) { return nothing; }
    return html`${configs.map((cfg, idx) => {
      const current = cfg.detect(bind.extraArgs ?? []);
      const isCustom = !!current && !cfg.options.some(o => o.value === current);
      return html`
        <div class="slot-secondary-select">
          <span class="slot-secondary-label" title=${cfg.hint}>
            ${cfg.label}
            ${cfg.required && !current
          ? html`<i class="codicon codicon-warning slot-secondary-req-icon"></i>`
          : nothing}
          </span>
          <vscode-single-select class="profile-slot-select slot-secondary-dropdown"
            .value=${current}
            @change=${(e: Event) => this._onSecondarySelectChange(scope, originalName, slot, runner, idx, e)}>
            <vscode-option value="" ?selected=${!current}>${cfg.placeholder}</vscode-option>
            ${cfg.options.map(o => html`
              <vscode-option
                value=${o.value}
                ?selected=${current === o.value}
                title=${o.description ?? o.label}>${o.label}</vscode-option>
            `)}
            ${isCustom ? html`
              <vscode-option value=${current} ?selected=${true}>${current} (custom)</vscode-option>
            ` : nothing}
          </vscode-single-select>
        </div>
      `;
    })}`;
  }

  private _copySlot(
    scope: Scope, originalName: string,
    fromSlot: "flash" | "buildDebug" | "debug" | "attach",
    toSlot: "flash" | "buildDebug" | "debug" | "attach",
    draft: Profile,
  ) {
    const sourceBind = (draft[fromSlot] as ProfileBind | undefined) ?? { kind: "auto" as const };
    this._updateDraft(scope, originalName, (p) => ({
      ...p,
      [toSlot]: JSON.parse(JSON.stringify(sourceBind)),
    }));
  }

  private _appendArg(scope: Scope, originalName: string, slot: "flash" | "buildDebug" | "debug" | "attach", arg: string) {
    const trimmed = arg.trim();
    if (!trimmed) { return; }
    this._updateDraft(scope, originalName, (p) => {
      const current: ProfileBind = p[slot] ?? { kind: "auto" };
      const args = [...(current.extraArgs ?? [])];
      args.push(trimmed);
      return { ...p, [slot]: { ...current, kind: "runner", runner: (current as any).runner ?? "", extraArgs: args } };
    });
    this._closeArgPicker(scope, originalName, slot);
  }

  private _renderVarHelpPanel(scope: Scope, originalName: string, slot: string) {
    return html`
      <div class="var-help-panel">
        <div class="arg-picker-header">
          <span>Available variable substitutions</span>
          <vscode-button appearance="icon" icon="close"
            @click=${() => this._closeVarHelp(scope, originalName, slot)}>
          </vscode-button>
        </div>
        <table class="var-help-table">
          <thead><tr><th>Expression</th><th>Resolves to</th></tr></thead>
          <tbody>
            <tr><td><code>\${workspaceFolder}</code></td><td>Workspace root path</td></tr>
            <tr><td><code>\${buildFolder}</code></td><td>Build output directory</td></tr>
            <tr><td><code>\${board}</code></td><td>Board name (e.g. <code>nucleo_f401re</code>)</td></tr>
            <tr><td><code>\${boardRevision}</code></td><td>Board revision, or <code>""</code> when not set</td></tr>
            <tr><td><code>\${project}</code></td><td>Project name</td></tr>
            <tr><td><code>\${build}</code></td><td>Build configuration name</td></tr>
            <tr><td><code>\${buildvar:<em>key</em>}</code></td><td>Per-build custom variable (<code>BuildConfig.customVars</code>)</td></tr>
            <tr><td><code>\${projectvar:<em>key</em>}</code></td><td>Per-project custom variable (<code>ProjectConfig.customVars</code>)</td></tr>
            <tr><td><code>\${cmake:<em>VAR</em>}</code></td><td>Value from <code>CMakeCache.txt</code> (case-insensitive)</td></tr>
            <tr><td><code>\${kconfig:<em>VAR</em>}</code></td><td>Kconfig value from <code>zephyr/.config</code> (strings unquoted; <code>CONFIG_</code> prefix optional)</td></tr>
            <tr><td><code>\${env:<em>VAR</em>}</code></td><td><code>process.env</code> value, or <code>""</code> when unset</td></tr>
            <tr><td><code>\${config:<em>some.key</em>}</code></td><td>VS Code workspace/user configuration value</td></tr>
            <tr class="var-help-row-muted"><td><em>anything else</em></td><td>Left unchanged (VS Code resolves later)</td></tr>
          </tbody>
        </table>
      </div>
    `;
  }

  private _onStructuredArgsChanged(
    scope: Scope, originalName: string,
    slot: "flash" | "buildDebug" | "debug" | "attach",
    e: CustomEvent,
  ) {
    const newArgs = e.detail as { structured: ArgValue[]; raw?: string[] };
    this._updateDraft(scope, originalName, (p) => {
      const current: ProfileBind = p[slot] ?? { kind: "auto" };
      return { ...p, [slot]: { ...current, args: newArgs } };
    });
  }

  /** Render per-arg rows plus a generic "add argument" row and optional suggestion picker. */
  private _renderArgEditor(
    scope: Scope, originalName: string,
    slot: "flash" | "buildDebug" | "debug" | "attach",
    bind: ProfileBind,
    currentRunner: string,
  ) {
    // If the runner has a known schema, use the structured editor.
    if (hasSchema(currentRunner)) {
      const schema = getSchemaFor(currentRunner);
      const profileArgs = bind.args?.structured ?? [];
      return html`
        <runner-args-editor
          mode="profile"
          runner=${currentRunner}
          slot=${slot}
          .schema=${schema}
          .profileArgs=${profileArgs}
          @args-changed=${(e: CustomEvent) => this._onStructuredArgsChanged(scope, originalName, slot, e)}>
        </runner-args-editor>
      `;
    }

    // Legacy free-text editor for runners without a known schema.
    const key = this._argPickerKey(scope, originalName, slot);
    const pickerOpen = this._showArgPicker.has(key);
    const varHelpOpen = this._showVarHelp.has(key);
    // Filter suggestions by slot first (flash-only args hidden in debug slots, etc.),
    // then filter out suggestions whose flag is already present in the current args.
    const slotSuggestions = (RUNNER_COMMON_ARGS[currentRunner] ?? []).filter(
      s => !s.slots || s.slots.includes(slot),
    );
    const args = bind.extraArgs ?? [];
    const availableSuggestions = slotSuggestions.filter(
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
          <vscode-button appearance="icon" icon="question"
            title="Variable substitution reference"
            @click=${() => this._toggleVarHelp(scope, originalName, slot)}>
          </vscode-button>
        </div>
        ${varHelpOpen ? this._renderVarHelpPanel(scope, originalName, slot) : nothing}
        ${pickerOpen && availableSuggestions.length > 0 ? html`
          <div class="arg-picker-panel">
            <div class="arg-picker-header">
              <span>Common <strong>${currentRunner}</strong> arguments</span>
              <vscode-button appearance="icon" icon="close"
                @click=${() => this._closeArgPicker(scope, originalName, slot)}>
              </vscode-button>
            </div>
            <div class="arg-picker-list">
              ${availableSuggestions.map(s => {
      if (!s.choices?.length) {
        return html`
                    <button class="arg-picker-item"
                      title=${s.description}
                      @click=${() => this._appendArg(scope, originalName, slot, s.arg)}>
                      <code class="arg-picker-flag">${s.label}</code>
                      <span class="arg-picker-desc">${s.description}</span>
                    </button>`;
      }
      const choicesKey = `${key}|${s.label}`;
      const choicesOpen = this._expandedArgSuggestion.has(choicesKey);
      return html`
                  <button class="arg-picker-item arg-picker-item--expandable"
                    title=${s.description}
                    @click=${() => this._toggleChoices(key, s.label)}>
                    <code class="arg-picker-flag">${s.label}</code>
                    <span class="arg-picker-desc">${s.description}</span>
                    <i class="codicon codicon-chevron-${choicesOpen ? 'up' : 'right'} arg-picker-expand-icon"></i>
                  </button>
                  ${choicesOpen ? html`
                    <div class="arg-picker-choices">
                      ${s.choices.map(c => 'separator' in c
        ? html`<div class="arg-picker-choice-sep">${c.label}</div>`
        : html`
                          <button class="arg-picker-item arg-picker-choice-item"
                            title=${c.description ?? c.label}
                            @click=${() => this._appendArg(scope, originalName, slot, c.arg)}>
                            <code class="arg-picker-flag">${c.label}</code>
                            ${c.description ? html`<span class="arg-picker-desc">${c.description}</span>` : nothing}
                          </button>`)}
                    </div>` : nothing}`;
    })}
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
              Reusable bundles of <strong>flash</strong>,
              ${d.separateBuildDebugProfile ? html`<strong>build &amp; debug</strong>, ` : nothing}<strong>debug</strong>, and <strong>attach</strong> binds.
              Workspace profiles live in <code>.vscode/zephyr-ide.json</code>; user profiles live in
              <code>zephyr-ide.runnerProfiles</code> settings. Workspace overrides user on name collision.
              ${d.separateBuildDebugProfile ? nothing : html`
                <br><span class="scope-section-hint">Tip: enable <code>zephyr-ide.separateBuildDebugProfile</code> to configure Build&#8202;&amp;&#8202;Debug separately from Debug.</span>`}
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
          ${this._data?.separateBuildDebugProfile
        ? this._renderSlot(scope, original.name, draft, "buildDebug", "debug-all",
          draft.buildDebug ?? { kind: "auto" })
        : nothing}
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
          <vscode-button appearance="icon" icon="copy" title="Duplicate profile"
            @click=${() => this._onDuplicate(scope, original.name)}>
          </vscode-button>
          <vscode-button appearance="icon" icon="trash" title="Delete profile"
            @click=${() => this._onDelete(scope, original.name)}>
          </vscode-button>
        </div>
      </div>
    `;
  }

  private _renderSlot(
    scope: Scope, originalName: string, draft: Profile,
    slot: "flash" | "buildDebug" | "debug" | "attach", icon: string,
    bindOverride?: ProfileBind,
  ) {
    // For buildDebug, use the passed-in override bind (which defaults to auto when unset).
    const bind = bindOverride ?? (draft[slot] as ProfileBind | undefined) ?? { kind: "auto" as const };
    const labelMap: Record<string, string> = {
      flash: "Flash",
      buildDebug: "Build & Debug",
      debug: "Debug",
      attach: "Attach",
    };
    const label = labelMap[slot] ?? (slot.charAt(0).toUpperCase() + slot.slice(1));
    const allowLaunch = slot !== "flash";
    const d = this._data!;
    const currentValue = bindToSelectValue(bind);
    const isDebugSlot = slot === "debug" || slot === "attach" || slot === "buildDebug";
    const runnerPool = isDebugSlot ? (d.knownDebugRunners ?? d.knownRunners) : d.knownRunners;
    const knownRunners = runnerPool.length > 0 ? runnerPool : (bind.kind === "runner" ? [bind.runner ?? "openocd"] : ["openocd"]);

    // If the saved bind is a launch config not in the known list, keep it selectable.
    const syntheticLaunch = allowLaunch && bind.kind === "launch" && bind.name
      && !d.launchConfigNames.includes(bind.name);

    return html`
      <div class="profile-slot-section">
        <div class="profile-slot-header">
          <i class="codicon codicon-${icon}"></i>
          <span class="profile-slot-title">${label}</span>
          ${slot === "debug" ? html`
            <vscode-button appearance="icon" icon="arrow-down"
              title="Copy Debug → Attach"
              @click=${() => this._copySlot(scope, originalName, "debug", "attach", draft)}>
            </vscode-button>` : nothing}
          ${slot === "attach" ? html`
            <vscode-button appearance="icon" icon="arrow-up"
              title="Copy Attach → Debug"
              @click=${() => this._copySlot(scope, originalName, "attach", "debug", draft)}>
            </vscode-button>` : nothing}
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
          ${bind.kind === "runner" && bind.runner
        ? this._renderSecondarySelect(scope, originalName, slot, bind.runner, bind)
        : nothing}
          ${bind.kind === "runner"
        ? this._renderArgEditor(scope, originalName, slot, bind, bind.runner ?? "")
        : nothing}
          ${bind.kind === "auto" && slot === "buildDebug"
        ? html`<span class="scope-section-hint">Falls back to the <strong>Debug</strong> slot.</span>`
        : bind.kind === "auto" && slot === "debug" && !this._data?.separateBuildDebugProfile
          ? html`<span class="scope-section-hint">Uses runners.yaml defaults. Drives both Debug and Build&#8202;&amp;&#8202;Debug.</span>`
          : bind.kind === "auto"
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
// Runner secondary selects (interface / probe / target dropdowns)
// ---------------------------------------------------------------------------

interface SecondarySelectOption {
  value: string;
  label: string;
  description?: string;
}

interface SecondarySelectConfig {
  /** Label shown to the left of the dropdown. */
  label: string;
  /** Tooltip shown on the label. */
  hint: string;
  /** When true, a warning icon appears if nothing is selected. */
  required: boolean;
  /** Label for the empty / "none" option. */
  placeholder: string;
  options: SecondarySelectOption[];
  /** Extract the currently-active secondary value from extraArgs (return "" when absent). */
  detect(args: string[]): string;
  /** Return args with this selection's arg removed. */
  filterOut(args: string[]): string[];
  /** Build the extraArgs entry for the given value (return "" for the placeholder). */
  buildArg(value: string): string;
}

const RUNNER_SECONDARY_SELECTS: Partial<Record<string, SecondarySelectConfig[]>> = {
  openocd: [
    {
      label: "Interface / Probe",
      hint: "OpenOCD interface config. Leave blank if runners.yaml already specifies one.",
      required: false,
      placeholder: "runners.yaml / auto-detect",
      options: [
        { value: "interface/stlink.cfg", label: "ST-LINK v2/v3", description: "Most common for STM32 / nRF52 with SWD" },
        { value: "interface/cmsis-dap.cfg", label: "CMSIS-DAP", description: "DAPLink, ULINK2, MCU-Link, …" },
        { value: "interface/jlink.cfg", label: "SEGGER J-Link", description: "J-Link via OpenOCD" },
        { value: "interface/ftdi.cfg", label: "FTDI", description: "FTDI-based probe (generic)" },
        { value: "interface/picoprobe.cfg", label: "Raspberry Pi Pico (probe)", description: "RP2040 Pico used as SWD/JTAG probe" },
        { value: "interface/raspberrypi-swd.cfg", label: "Raspberry Pi GPIO SWD", description: "Bit-banged SWD via RPi GPIO" },
        { value: "interface/buspirate.cfg", label: "Bus Pirate", description: "Bus Pirate USB probe" },
      ],
      detect(args) {
        for (let i = 0; i < args.length; i++) {
          const a = args[i];
          // Matches: "-- -f interface/x.cfg", "--openocd-config interface/x.cfg", "-f interface/x.cfg"
          const m = a.match(/^(?:--\s+-f|--openocd-config|-f)\s+(interface\/\S+)/);
          if (m) { return m[1]; }
          if ((a === "--openocd-config" || a === "-f") && i + 1 < args.length && args[i + 1].startsWith("interface/")) {
            return args[i + 1];
          }
          if (a.startsWith("interface/") && a.endsWith(".cfg")) { return a; }
        }
        return "";
      },
      filterOut(args) {
        const result: string[] = [];
        for (let i = 0; i < args.length; i++) {
          const a = args[i];
          if (/^(?:--\s+-f|--openocd-config|-f)\s+interface\//.test(a)) { continue; }
          if ((a === "--openocd-config" || a === "-f") && i + 1 < args.length && args[i + 1].startsWith("interface/")) {
            i++; continue;
          }
          if (a.startsWith("interface/") && a.endsWith(".cfg")) { continue; }
          result.push(a);
        }
        return result;
      },
      buildArg(value) { return value ? `--openocd-config ${value}` : ""; },
    },
  ],
  pyocd: [
    {
      label: "Probe / Interface",
      hint: "pyOCD probe selection. Specify the probe type or leave blank to auto-detect the first available.",
      required: true,
      placeholder: "— select probe (required) —",
      options: [
        { value: "cmsis_dap", label: "CMSIS-DAP (generic)", description: "Any CMSIS-DAP probe — STLink, DAPLink, MCU-Link, ULINK2, …" },
        { value: "jlink", label: "SEGGER J-Link", description: "First J-Link probe (requires pyocd-jlink plugin)" },
        { value: "picoprobe", label: "Raspberry Pi Pico (picoprobe)", description: "RP2040 Pico running picoprobe firmware" },
      ],
      detect(args) {
        for (let i = 0; i < args.length; i++) {
          const a = args[i];
          // Matches: "-- --probe stlink", "-- --probe=stlink", "--probe=stlink"
          const m = a.match(/^(?:--\s+)?--probe[= ](\S+)/);
          if (m) { return m[1]; }
          if (a === "--probe" && i + 1 < args.length) { return args[i + 1]; }
        }
        return "";
      },
      filterOut(args) {
        const result: string[] = [];
        for (let i = 0; i < args.length; i++) {
          const a = args[i];
          if (/^(?:--\s+)?--probe[= ]\S+/.test(a)) { continue; }
          if (a === "--probe" && i + 1 < args.length) { i++; continue; }
          result.push(a);
        }
        return result;
      },
      buildArg(value) { return value ? `--probe=${value}` : ""; },
    },
    {
      label: "Target (MCU)",
      hint: "pyOCD target device name. Usually auto-detected from the Zephyr build — only set if auto-detection fails.",
      required: false,
      placeholder: "auto (from build)",
      options: [
        { value: "nrf52840", label: "Nordic nRF52840" },
        { value: "nrf52833", label: "Nordic nRF52833" },
        { value: "nrf52832", label: "Nordic nRF52832" },
        { value: "nrf52820", label: "Nordic nRF52820" },
        { value: "nrf5340_application", label: "Nordic nRF5340 (App Core)" },
        { value: "nrf9160", label: "Nordic nRF9160" },
        { value: "rp2040", label: "Raspberry Pi RP2040" },
        { value: "stm32f401re", label: "STM32F401RE" },
        { value: "stm32f429zi", label: "STM32F429ZI" },
        { value: "stm32g474re", label: "STM32G474RE" },
        { value: "stm32h743xx", label: "STM32H743xx" },
        { value: "stm32l4r5zi", label: "STM32L4R5ZI" },
        { value: "stm32l552ze", label: "STM32L552ZE" },
        { value: "mimxrt1060evk", label: "NXP MIMXRT1060-EVK" },
        { value: "lpc55s69", label: "NXP LPC55S69" },
      ],
      detect(args) {
        for (let i = 0; i < args.length; i++) {
          const a = args[i];
          if (a.startsWith("--target=")) { return a.slice(9); }
          if (a.startsWith("--target ")) { return a.slice(9); }
          if (a === "--target" && i + 1 < args.length) { return args[i + 1]; }
        }
        return "";
      },
      filterOut(args) {
        const result: string[] = [];
        for (let i = 0; i < args.length; i++) {
          const a = args[i];
          if (a.startsWith("--target=") || a.startsWith("--target ")) { continue; }
          if (a === "--target" && i + 1 < args.length) { i++; continue; }
          result.push(a);
        }
        return result;
      },
      buildArg(value) { return value ? `--target=${value}` : ""; },
    },
  ],
};

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
  const out: Profile = {
    name: p.name,
    flash: { ...p.flash },
    debug: { ...p.debug },
    attach: { ...p.attach },
  };
  if (p.buildDebug) { out.buildDebug = { ...p.buildDebug }; }
  return out;
}

function bindsEqual(a: ProfileBind, b: ProfileBind): boolean {
  if (a.kind !== b.kind) { return false; }
  if (a.kind === "auto") { return true; }
  if (a.kind === "runner") {
    return (a.runner ?? "") === (b.runner ?? "")
      && JSON.stringify(a.extraArgs ?? []) === JSON.stringify(b.extraArgs ?? []);
  }
  return (a.name ?? "") === (b.name ?? "");
}

function profilesEqual(a: Profile, b: Profile): boolean {
  // Both having undefined buildDebug counts as equal; treat undefined as auto for comparison.
  const aBuildDebug = a.buildDebug ?? { kind: "auto" as const };
  const bBuildDebug = b.buildDebug ?? { kind: "auto" as const };
  // Profiles with no buildDebug are equal regardless of whether one is auto.
  const buildDebugEqual = (!a.buildDebug && !b.buildDebug) || bindsEqual(aBuildDebug, bBuildDebug);
  return a.name === b.name
    && bindsEqual(a.flash, b.flash)
    && buildDebugEqual
    && bindsEqual(a.debug, b.debug)
    && bindsEqual(a.attach, b.attach);
}
