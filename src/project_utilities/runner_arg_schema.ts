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

/**
 * Neutral canonical schema for Zephyr west runner arguments.
 *
 * Each `ArgDef` describes a single known argument for a specific runner with:
 *   - A canonical `id` used internally as a stable key.
 *   - How to emit it as a `west flash` / `west debug` CLI flag.
 *   - How to map it to a `cortex-debug` launch configuration property.
 *   - UI metadata: human label, description, input type, preset suggestions.
 *
 * This schema is the **single source of truth** for:
 *   1. The structured arg editor in the Runner Profile panel.
 *   2. The three-layer merge resolver (`runner_arg_resolver.ts`).
 *   3. The cortex-debug translation layer (replacing the ad-hoc switch/case
 *      in debug-provider.ts).
 *   4. Tooltip text shown to users in both the profile and build editors.
 *
 * ## Adding new runners / args
 * Append an `ArgDef` entry to the relevant `RUNNER_ARG_SCHEMAS` array.
 * No other files need changing — the resolver and UIs consume this map generically.
 */

// ---------------------------------------------------------------------------
// Type definitions
// ---------------------------------------------------------------------------

/** UI control type for an arg value. */
export type ArgType =
  /** Rendered as a checkbox / toggle — no value, presence = true. */
  | "bool"
  /** Free-text single-line input. */
  | "string"
  /** Integer-only input. */
  | "int"
  /** Dropdown with a fixed set of options (value must be one of enumOptions). */
  | "enum"
  /** Free-text + preset suggestions dropdown (combo-box style). */
  | "combo"
  /** File path input with optional browse button. */
  | "path";

/** How this arg maps to a cortex-debug launch configuration property. */
export type CortexDebugMapping =
  | { kind: "property"; prop: string }                // cfg[prop] = value
  | { kind: "arrayPush"; prop: string }               // cfg[prop].push(value)
  | { kind: "serverArgPair"; flag: string }           // cfg.serverArgs.push(flag, value)
  | { kind: "rttEnable" }                             // Enables RTT block in cfg.rttConfig
  | { kind: "rttPort" }                               // Sets decoder port in cfg.rttConfig
  | { kind: "rttAddress" }                            // Sets cfg.rttConfig.address
  | { kind: "rttSearchRange" }                        // Sets cfg.rttConfig.searchSize
  | { kind: "none" };                                 // No cortex-debug equivalent

/**
 * Full definition of one known argument for a runner.
 */
export interface ArgDef {
  /** Stable canonical identifier, unique within a runner. e.g. "device", "rtt-enable", "interface-cfg". */
  id: string;
  /** Short human-readable label shown in the UI. */
  label: string;
  /** Full description shown as tooltip / help text. */
  description: string;
  /** UI grouping label (e.g. "Probe", "RTT", "Flash", "Debug"). */
  group?: string;
  /** Input control type. */
  type: ArgType;
  /** Fixed choices for `enum` type. */
  enumOptions?: string[];
  /** Preset suggestions for `combo` type (user can also type freely). */
  suggestions?: string[];
  /** Default/placeholder value shown to new users. */
  defaultValue?: string;
  /** Whether this arg can appear multiple times (e.g. --openocd-config). */
  multi?: boolean;
  /**
   * Which bind slots this arg applies to.
   * Omit (or undefined) = valid for all slots.
   */
  slots?: Array<"flash" | "debug" | "attach" | "buildDebug">;

  // ── West CLI emission ────────────────────────────────────────────────────
  west: {
    /** The CLI flag, e.g. "--device", "--openocd-config", "--enable-rtt". */
    flag: string;
    /** Whether this flag takes a separate value argument. False for bool/toggle flags. */
    takesValue: boolean;
    /**
     * Secondary west flags that are aliases / equivalent to `flag`.
     * Used only for *parsing* (incoming runners.yaml args) — output always uses `flag`.
     */
    aliases?: string[];
  };

  // ── cortex-debug translation ─────────────────────────────────────────────
  /** How to translate this arg into a cortex-debug property. Omit = `{ kind: "none" }`. */
  cortexDebug?: CortexDebugMapping;
}

// ---------------------------------------------------------------------------
// Schema registry
// ---------------------------------------------------------------------------

/**
 * Per-runner arg schemas. Runners not listed here get a "raw only" editor.
 * Keys match the west runner name exactly (as stored in RunnerBind.runner).
 */
export const RUNNER_ARG_SCHEMAS: Record<string, ArgDef[]> = {

  // ──────────────────────────────────────────────────────────────────────────
  openocd: [
    // ── Probe ───────────────────────────────────────────────────────────────
    {
      id: "interface-cfg",
      label: "Interface config",
      description: "OpenOCD interface (probe) config file — maps to configFiles in cortex-debug (interface/ entries first). Can be given multiple times.",
      group: "Probe",
      type: "combo",
      multi: true,
      suggestions: [
        "interface/stlink.cfg",
        "interface/stlink-dap.cfg",
        "interface/cmsis-dap.cfg",
        "interface/jlink.cfg",
        "interface/ftdi.cfg",
        "interface/picoprobe.cfg",
        "interface/raspberrypi-swd.cfg",
        "interface/buspirate.cfg",
        "interface/ch347_spi.cfg",
      ],
      west: { flag: "--openocd-config", takesValue: true, aliases: ["-f"] },
      cortexDebug: { kind: "arrayPush", prop: "configFiles" },
    },
    {
      id: "target-cfg",
      label: "Target config",
      description: "OpenOCD target/board config file — maps to configFiles in cortex-debug (after interface/ entries). Can be given multiple times.",
      group: "Probe",
      type: "combo",
      multi: true,
      suggestions: [
        "target/nrf52.cfg",
        "target/nrf5340.cfg",
        "target/rp2040.cfg",
        "target/stm32f0x.cfg",
        "target/stm32f1x.cfg",
        "target/stm32f4x.cfg",
        "target/stm32g0x.cfg",
        "target/stm32g4x.cfg",
        "target/stm32h7x.cfg",
        "target/stm32l4x.cfg",
        "target/stm32l5x.cfg",
        "target/stm32wb.cfg",
        "target/esp32s3.cfg",
        "target/esp32c3.cfg",
        "target/gd32f1x.cfg",
        "target/lpc176x.cfg",
        "target/saml21.cfg",
        "target/sama5d2.cfg",
      ],
      west: { flag: "--openocd-config", takesValue: true, aliases: ["-f"] },
      cortexDebug: { kind: "arrayPush", prop: "configFiles" },
    },
    {
      id: "search-dir",
      label: "Search directory",
      description: "Additional OpenOCD config search path — maps to searchDir in cortex-debug.",
      group: "Probe",
      type: "path",
      multi: true,
      west: { flag: "--openocd-search", takesValue: true, aliases: ["-s"] },
      cortexDebug: { kind: "arrayPush", prop: "searchDir" },
    },
    {
      id: "serial",
      label: "Serial number",
      description: "Limit to a specific FTDI/USB serial number.",
      group: "Probe",
      type: "string",
      west: { flag: "--serial", takesValue: true },
      cortexDebug: { kind: "none" },
    },
    // ── Ports ────────────────────────────────────────────────────────────────
    {
      id: "gdb-port",
      label: "GDB port",
      description: "Override GDB server port (default: 3333).",
      group: "Debug",
      type: "int",
      defaultValue: "3333",
      slots: ["debug", "attach", "buildDebug"],
      west: { flag: "--gdb-port", takesValue: true },
      cortexDebug: { kind: "none" },
    },
    {
      id: "tcl-port",
      label: "TCL port",
      description: "Override OpenOCD TCL port (default: 6333).",
      group: "Debug",
      type: "int",
      defaultValue: "6333",
      west: { flag: "--tcl-port", takesValue: true },
      cortexDebug: { kind: "none" },
    },
    {
      id: "telnet-port",
      label: "Telnet port",
      description: "Override OpenOCD Telnet port (default: 4444).",
      group: "Debug",
      type: "int",
      defaultValue: "4444",
      west: { flag: "--telnet-port", takesValue: true },
      cortexDebug: { kind: "none" },
    },
    // ── RTT ─────────────────────────────────────────────────────────────────
    {
      id: "rtt-enable",
      label: "Enable RTT",
      description: "Enable Real-Time Transfer (RTT) — populates rttConfig in cortex-debug and auto-launches RTT terminal on debug start.",
      group: "RTT",
      type: "bool",
      slots: ["debug", "attach", "buildDebug"],
      west: { flag: "--enable-rtt", takesValue: false },
      cortexDebug: { kind: "rttEnable" },
    },
    {
      id: "rtt-port",
      label: "RTT port",
      description: "OpenOCD RTT server port (default: 5555).",
      group: "RTT",
      type: "int",
      defaultValue: "5555",
      slots: ["debug", "attach", "buildDebug"],
      west: { flag: "--rtt-port", takesValue: true },
      cortexDebug: { kind: "rttPort" },
    },
    {
      id: "rtt-address",
      label: "RTT control block address",
      description: "Explicit RTT control block address (hex or 'auto'). Use 'auto' to let OpenOCD search.",
      group: "RTT",
      type: "string",
      defaultValue: "auto",
      slots: ["debug", "attach", "buildDebug"],
      west: { flag: "--rtt-address", takesValue: true },
      cortexDebug: { kind: "rttAddress" },
    },
    // ── Flash ────────────────────────────────────────────────────────────────
    {
      id: "use-elf",
      label: "Flash ELF",
      description: "Flash ELF file instead of HEX/BIN.",
      group: "Flash",
      type: "bool",
      slots: ["flash"],
      west: { flag: "--use-elf", takesValue: false },
      cortexDebug: { kind: "none" },
    },
    {
      id: "verify",
      label: "Verify after flash",
      description: "Verify flash contents after programming.",
      group: "Flash",
      type: "bool",
      slots: ["flash"],
      west: { flag: "--verify", takesValue: false },
      cortexDebug: { kind: "none" },
    },
    {
      id: "cmd-pre-init",
      label: "Pre-init command",
      description: "OpenOCD command to run before calling init (may be given multiple times).",
      group: "Advanced",
      type: "string",
      multi: true,
      west: { flag: "--cmd-pre-init", takesValue: true },
      cortexDebug: { kind: "none" },
    },
  ],

  // ──────────────────────────────────────────────────────────────────────────
  jlink: [
    // ── Probe ───────────────────────────────────────────────────────────────
    {
      id: "device",
      label: "Device",
      description: "Target MCU name as expected by J-Link (e.g. STM32F401RE, nRF52840_xxAA). Required.",
      group: "Probe",
      type: "string",
      west: { flag: "--device", takesValue: true },
      cortexDebug: { kind: "property", prop: "device" },
    },
    {
      id: "interface",
      label: "Interface",
      description: "Debug interface type.",
      group: "Probe",
      type: "enum",
      enumOptions: ["SWD", "JTAG", "cJTAG"],
      defaultValue: "SWD",
      west: { flag: "--iface", takesValue: true, aliases: ["--interface"] },
      cortexDebug: { kind: "property", prop: "interface" },
    },
    {
      id: "speed",
      label: "Speed (kHz)",
      description: "SWD/JTAG clock speed in kHz, or 'auto'.",
      group: "Probe",
      type: "combo",
      suggestions: ["auto", "4000", "8000", "12000", "15000", "20000", "25000", "50000"],
      defaultValue: "4000",
      west: { flag: "--speed", takesValue: true },
      cortexDebug: { kind: "serverArgPair", flag: "-speed" },
    },
    {
      id: "id",
      label: "Serial number",
      description: "J-Link serial number — use when multiple probes are connected.",
      group: "Probe",
      type: "string",
      west: { flag: "--id", takesValue: true },
      cortexDebug: { kind: "none" },
    },
    // ── Debug ────────────────────────────────────────────────────────────────
    {
      id: "gdb-port",
      label: "GDB port",
      description: "Override GDB server port (default: 2331).",
      group: "Debug",
      type: "int",
      defaultValue: "2331",
      slots: ["debug", "attach", "buildDebug"],
      west: { flag: "--gdb-port", takesValue: true },
      cortexDebug: { kind: "none" },
    },
    // ── RTT ─────────────────────────────────────────────────────────────────
    {
      id: "rtt-enable",
      label: "Enable RTT",
      description: "Enable Real-Time Transfer (RTT) — auto-launches RTT terminal on debug start.",
      group: "RTT",
      type: "bool",
      slots: ["debug", "attach", "buildDebug"],
      west: { flag: "--enable-rtt", takesValue: false },
      cortexDebug: { kind: "rttEnable" },
    },
    {
      id: "rtt-port",
      label: "RTT telnet port",
      description: "J-Link RTT telnet port (default: 19021).",
      group: "RTT",
      type: "int",
      defaultValue: "19021",
      slots: ["debug", "attach", "buildDebug"],
      west: { flag: "--rtt-port", takesValue: true },
      cortexDebug: { kind: "rttPort" },
    },
    // ── Flash ────────────────────────────────────────────────────────────────
    {
      id: "erase",
      label: "Chip erase",
      description: "Erase the entire chip before flashing.",
      group: "Flash",
      type: "bool",
      slots: ["flash"],
      west: { flag: "--erase", takesValue: false },
      cortexDebug: { kind: "none" },
    },
  ],

  // ──────────────────────────────────────────────────────────────────────────
  pyocd: [
    // ── Probe ───────────────────────────────────────────────────────────────
    {
      id: "target",
      label: "Target",
      description: "PyOCD target device pack name (e.g. stm32f401re, nrf52840). Required.",
      group: "Probe",
      type: "string",
      west: { flag: "--target", takesValue: true, aliases: ["-t"] },
      cortexDebug: { kind: "property", prop: "targetId" },
    },
    {
      id: "board-id",
      label: "Board ID / serial",
      description: "Probe board ID or serial number — use when multiple probes are connected.",
      group: "Probe",
      type: "string",
      west: { flag: "--board-id", takesValue: true },
      cortexDebug: { kind: "none" },
    },
    {
      id: "frequency",
      label: "Frequency (Hz)",
      description: "Probe clock frequency in Hz (default: 1000000).",
      group: "Probe",
      type: "int",
      defaultValue: "4000000",
      west: { flag: "--frequency", takesValue: true },
      cortexDebug: { kind: "none" },
    },
    // ── Debug ────────────────────────────────────────────────────────────────
    {
      id: "gdb-port",
      label: "GDB port",
      description: "Override GDB server port (default: 3333).",
      group: "Debug",
      type: "int",
      defaultValue: "3333",
      slots: ["debug", "attach", "buildDebug"],
      west: { flag: "--gdb-port", takesValue: true },
      cortexDebug: { kind: "none" },
    },
    // ── RTT ─────────────────────────────────────────────────────────────────
    {
      id: "rtt-enable",
      label: "Enable RTT",
      description: "Enable Real-Time Transfer (RTT) — auto-launches RTT terminal on debug start.",
      group: "RTT",
      type: "bool",
      slots: ["debug", "attach", "buildDebug"],
      west: { flag: "--enable-rtt", takesValue: false },
      cortexDebug: { kind: "rttEnable" },
    },
    // ── Flash ────────────────────────────────────────────────────────────────
    {
      id: "erase",
      label: "Chip erase",
      description: "Chip-erase before flashing.",
      group: "Flash",
      type: "bool",
      slots: ["flash"],
      west: { flag: "--erase", takesValue: false },
      cortexDebug: { kind: "none" },
    },
  ],

  // ──────────────────────────────────────────────────────────────────────────
  stlink: [
    // ── Probe ───────────────────────────────────────────────────────────────
    {
      id: "device",
      label: "Device",
      description: "Target MCU name (e.g. STM32F401RE) — used by cortex-debug to configure the STLink GDB server.",
      group: "Probe",
      type: "string",
      west: { flag: "--device", takesValue: true },
      cortexDebug: { kind: "property", prop: "device" },
    },
    {
      id: "gdb-port",
      label: "GDB port",
      description: "Override GDB server port (default: 61234).",
      group: "Debug",
      type: "int",
      defaultValue: "61234",
      slots: ["debug", "attach", "buildDebug"],
      west: { flag: "--gdb-port", takesValue: true },
      cortexDebug: { kind: "none" },
    },
  ],

  // ──────────────────────────────────────────────────────────────────────────
  nrfjprog: [
    {
      id: "snr",
      label: "Serial number",
      description: "J-Link serial number for the nRF probe.",
      group: "Probe",
      type: "string",
      west: { flag: "--snr", takesValue: true },
      cortexDebug: { kind: "none" },
    },
    {
      id: "nrf-family",
      label: "nRF family",
      description: "Target device family.",
      group: "Probe",
      type: "enum",
      enumOptions: ["NRF51", "NRF52", "NRF53", "NRF54L", "NRF54H", "NRF71", "NRF91", "NRF92"],
      west: { flag: "--nrf-family", takesValue: true },
      cortexDebug: { kind: "none" },
    },
    {
      id: "erase",
      label: "Chip erase",
      description: "Erase entire chip before programming.",
      group: "Flash",
      type: "bool",
      slots: ["flash"],
      west: { flag: "--erase", takesValue: false },
      cortexDebug: { kind: "none" },
    },
    {
      id: "erase-mode",
      label: "Erase mode",
      description: "Erase mode for internal flash.",
      group: "Flash",
      type: "enum",
      enumOptions: ["none", "ranges", "all"],
      defaultValue: "ranges",
      slots: ["flash"],
      west: { flag: "--erase-mode", takesValue: true },
      cortexDebug: { kind: "none" },
    },
    {
      id: "softreset",
      label: "Soft reset",
      description: "Use software reset after flashing instead of pin reset.",
      group: "Flash",
      type: "bool",
      slots: ["flash"],
      west: { flag: "--softreset", takesValue: false },
      cortexDebug: { kind: "none" },
    },
    {
      id: "recover",
      label: "Recover",
      description: "Erase all and disable readback protection before flashing.",
      group: "Flash",
      type: "bool",
      slots: ["flash"],
      west: { flag: "--recover", takesValue: false },
      cortexDebug: { kind: "none" },
    },
  ],

  // ──────────────────────────────────────────────────────────────────────────
  blackmagicprobe: [
    // ── Probe ───────────────────────────────────────────────────────────────
    {
      id: "gdb-serial",
      label: "GDB serial port",
      description: "Black Magic Probe GDB serial port (e.g. /dev/ttyACM0, COM3). Maps to BMPGDBSerialPort in cortex-debug.",
      group: "Probe",
      type: "string",
      west: { flag: "--gdb-serial", takesValue: true },
      cortexDebug: { kind: "property", prop: "BMPGDBSerialPort" },
    },
    {
      id: "interface",
      label: "Interface",
      description: "Debug interface type (default: SWD).",
      group: "Probe",
      type: "enum",
      enumOptions: ["SWD", "JTAG"],
      defaultValue: "SWD",
      west: { flag: "--iface", takesValue: true, aliases: ["--interface"] },
      cortexDebug: { kind: "property", prop: "interface" },
    },
    {
      id: "connect-srst",
      label: "Connect with SRST",
      description: "Assert SRST while connecting (for targets that misbehave without reset).",
      group: "Probe",
      type: "bool",
      west: { flag: "--connect-srst", takesValue: false },
      cortexDebug: { kind: "none" },
    },
    // ── RTT ─────────────────────────────────────────────────────────────────
    {
      id: "rtt-enable",
      label: "Enable RTT",
      description: "Enable RTT — sets rttEnabled in bmp-debug / rttConfig in cortex-debug. Auto-launches RTT terminal on debug start.",
      group: "RTT",
      type: "bool",
      slots: ["debug", "attach", "buildDebug"],
      west: { flag: "--enable-rtt", takesValue: false },
      cortexDebug: { kind: "rttEnable" },
    },
    {
      id: "rtt-port",
      label: "RTT port",
      description: "RTT channel port (default: 0).",
      group: "RTT",
      type: "int",
      defaultValue: "0",
      slots: ["debug", "attach", "buildDebug"],
      west: { flag: "--rtt-port", takesValue: true },
      cortexDebug: { kind: "rttPort" },
    },
  ],

  // ──────────────────────────────────────────────────────────────────────────
  linkserver: [
    {
      id: "device",
      label: "Device",
      description: "Target MCU device string (e.g. MIMXRT1060xxxxx:cm7). Required.",
      group: "Probe",
      type: "string",
      west: { flag: "--device", takesValue: true },
      cortexDebug: { kind: "property", prop: "device" },
    },
    {
      id: "probe",
      label: "Probe index",
      description: "Probe index or serial number (default: #1).",
      group: "Probe",
      type: "string",
      defaultValue: "#1",
      west: { flag: "--probe", takesValue: true },
      cortexDebug: { kind: "none" },
    },
    {
      id: "core",
      label: "Core",
      description: "Core to target on multi-core devices (e.g. cm33_core0).",
      group: "Probe",
      type: "string",
      west: { flag: "--core", takesValue: true },
      cortexDebug: { kind: "none" },
    },
    {
      id: "gdb-port",
      label: "GDB port",
      description: "Override GDB server port (default: 3333).",
      group: "Debug",
      type: "int",
      defaultValue: "3333",
      slots: ["debug", "attach", "buildDebug"],
      west: { flag: "--gdb-port", takesValue: true },
      cortexDebug: { kind: "none" },
    },
  ],

  // ──────────────────────────────────────────────────────────────────────────
  nrfutil: [
    {
      id: "snr",
      label: "Serial number",
      description: "J-Link serial number for the nRF probe.",
      group: "Probe",
      type: "string",
      west: { flag: "--snr", takesValue: true },
      cortexDebug: { kind: "none" },
    },
    {
      id: "nrf-family",
      label: "nRF family",
      description: "Target device family.",
      group: "Probe",
      type: "enum",
      enumOptions: ["NRF51", "NRF52", "NRF53", "NRF54L", "NRF54H", "NRF71", "NRF91", "NRF92"],
      west: { flag: "--nrf-family", takesValue: true },
      cortexDebug: { kind: "none" },
    },
    {
      id: "erase",
      label: "Chip erase",
      description: "Chip-erase before programming.",
      group: "Flash",
      type: "bool",
      slots: ["flash"],
      west: { flag: "--erase", takesValue: false },
      cortexDebug: { kind: "none" },
    },
    {
      id: "recover",
      label: "Recover",
      description: "Erase all and disable readback protection before flashing.",
      group: "Flash",
      type: "bool",
      slots: ["flash"],
      west: { flag: "--recover", takesValue: false },
      cortexDebug: { kind: "none" },
    },
  ],

  // ──────────────────────────────────────────────────────────────────────────
  esp32: [
    {
      id: "esp-device",
      label: "Serial port",
      description: "Serial port for ESP32 (e.g. /dev/ttyUSB0, COM3). Overrides ESPTOOL_PORT env var.",
      group: "Probe",
      type: "string",
      west: { flag: "--esp-device", takesValue: true },
      cortexDebug: { kind: "none" },
    },
    {
      id: "esp-baud-rate",
      label: "Baud rate",
      description: "Serial flash baud rate.",
      group: "Flash",
      type: "combo",
      suggestions: ["460800", "921600", "1500000"],
      defaultValue: "921600",
      slots: ["flash"],
      west: { flag: "--esp-baud-rate", takesValue: true },
      cortexDebug: { kind: "none" },
    },
    {
      id: "esp-idf-path",
      label: "ESP-IDF path",
      description: "Path to ESP-IDF installation directory. Required when not using env var.",
      group: "Probe",
      type: "path",
      west: { flag: "--esp-idf-path", takesValue: true },
      cortexDebug: { kind: "none" },
    },
  ],

  // ──────────────────────────────────────────────────────────────────────────
  "dfu-util": [
    {
      id: "alt",
      label: "Alternate setting",
      description: "DFU interface alternate setting number or name. Required.",
      group: "Probe",
      type: "string",
      west: { flag: "--alt", takesValue: true },
      cortexDebug: { kind: "none" },
    },
    {
      id: "pid",
      label: "USB VID:PID",
      description: "USB Vendor:Product ID of the target device (e.g. 0483:df11).",
      group: "Probe",
      type: "string",
      west: { flag: "--pid", takesValue: true },
      cortexDebug: { kind: "none" },
    },
    {
      id: "dfuse",
      label: "DfuSe mode",
      description: "Use DfuSe protocol extensions (STMicroelectronics devices).",
      group: "Probe",
      type: "bool",
      west: { flag: "--dfuse", takesValue: false },
      cortexDebug: { kind: "none" },
    },
  ],
};

// ---------------------------------------------------------------------------
// Schema lookup helpers
// ---------------------------------------------------------------------------

/** Return the schema entries for a runner, or an empty array when unknown. */
export function getSchemaFor(runner: string): ArgDef[] {
  return RUNNER_ARG_SCHEMAS[runner] ?? [];
}

/** Find a single ArgDef by id for a runner. */
export function findArgDef(runner: string, id: string): ArgDef | undefined {
  return getSchemaFor(runner).find(d => d.id === id);
}

/**
 * Find an ArgDef by a west CLI flag (including aliases).
 * Returns the first match since flags should be unique per runner.
 */
export function findArgDefByWestFlag(runner: string, flag: string): ArgDef | undefined {
  return getSchemaFor(runner).find(
    d => d.west.flag === flag || (d.west.aliases?.includes(flag) ?? false),
  );
}

/** Return all schema groups for a runner in declaration order (deduplicated). */
export function getArgGroups(runner: string): string[] {
  const seen = new Set<string>();
  const groups: string[] = [];
  for (const def of getSchemaFor(runner)) {
    const g = def.group ?? "General";
    if (!seen.has(g)) { seen.add(g); groups.push(g); }
  }
  return groups;
}

/** Check whether a runner has any schema-known args. */
export function hasSchema(runner: string): boolean {
  return (RUNNER_ARG_SCHEMAS[runner]?.length ?? 0) > 0;
}
