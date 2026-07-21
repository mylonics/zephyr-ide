/*
Copyright 2026 mylonics
Author Rijesh Augustine
SPDX-License-Identifier: Apache-2.0
*/

/**
 * Build artifact reader — TypeScript replacement for resources/zephyr_dashboard_json.py.
 *
 * Reads Zephyr build directory artifacts directly from the filesystem without
 * spawning a Python subprocess.  All parsing is intentionally lenient: missing
 * files or parse errors produce null / empty values so the dashboard still
 * opens even on a partial or unusual build tree.
 */

import * as fs from 'fs-extra';
import * as path from 'upath';
import * as yaml from 'js-yaml';

import { resolveEffectiveBuildDir } from '../zephyr_utilities/runners-yaml';

import type {
  DashboardData,
  DashboardKconfigEntry,
  DashboardMemory,
  DashboardMemoryNode,
  DashboardMemoryRefresh,
  DashboardMemoryReport,
  DashboardSummary,
  DashboardSysInit,
  DashboardSysInitEntry,
} from './dashboard-data';

// ---------------------------------------------------------------------------
// CMake cache
// ---------------------------------------------------------------------------

/**
 * Parses CMakeCache.txt into a flat key→value map (CMake type annotations
 * like ":STRING" are stripped from keys). This is the single shared reader
 * for CMakeCache.txt — other modules that need one or two specific cache
 * variables should call this and index into the result rather than
 * re-scanning the file themselves.
 */
export function parseCMakeCache(buildFolder: string): Record<string, string> {
  const cachePath = path.join(buildFolder, 'CMakeCache.txt');
  if (!fs.existsSync(cachePath)) { return {}; }
  const cache: Record<string, string> = {};
  // Handle both LF (Linux/macOS) and CRLF (Windows) line endings.
  for (const line of fs.readFileSync(cachePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('#') || !trimmed.includes('=')) { continue; }
    const eqIdx = trimmed.indexOf('=');
    // Strip the CMake type annotation (e.g. "BOARD:STRING" → "BOARD")
    const key = trimmed.slice(0, eqIdx).split(':')[0];
    cache[key] = trimmed.slice(eqIdx + 1);
  }
  return cache;
}

/**
 * Reads CMAKE_C_COMPILER_VERSION from CMakeFiles/<cmake-ver>/CMakeCCompiler.cmake.
 * The cache itself does not contain compiler version; it lives in a per-build file.
 */
function readCCompilerVersion(buildFolder: string): string {
  const cmakeFilesDir = path.join(buildFolder, 'CMakeFiles');
  if (!fs.existsSync(cmakeFilesDir)) { return ''; }
  // Look for <cmake-version>/CMakeCCompiler.cmake (dir name is e.g. "4.0.3")
  for (const entry of fs.readdirSync(cmakeFilesDir)) {
    const candidate = path.join(cmakeFilesDir, entry, 'CMakeCCompiler.cmake');
    if (fs.existsSync(candidate)) {
      const m = fs.readFileSync(candidate, 'utf8').match(/set\(CMAKE_C_COMPILER_VERSION\s+"([^"]+)"\)/);
      if (m) { return m[1]; }
    }
  }
  return '';
}

/**
 * Formats the toolchain as a human-readable string, e.g. "GNU 14.3.0".
 * Reads the C compiler version from CMakeFiles rather than CMakeCache (where it
 * is not stored).
 */
function resolveToolchain(cache: Record<string, string>, buildFolder: string): string {
  const variant = (cache['ZEPHYR_TOOLCHAIN_VARIANT'] ?? '').toLowerCase();
  const cVersion = readCCompilerVersion(buildFolder);
  const gnuVariants = ['zephyr', 'gnuarmemb', 'cross-compile', 'xtools', 'espressif'];
  if (cVersion && gnuVariants.includes(variant)) { return `GNU ${cVersion}`; }
  if (cVersion && variant === 'llvm') { return `LLVM ${cVersion}`; }
  if (cVersion) { return cVersion; }
  return cache['ZEPHYR_TOOLCHAIN_VARIANT'] ?? 'unknown';
}

/**
 * Resolves the Zephyr version string from a CMakeCache dict, trying several
 * well-known key names in order before falling back to parsing version.h.
 */
function resolveZephyrVersion(cache: Record<string, string>, buildFolder: string): string {
  // CMAKE_PROJECT_VERSION is the most reliable: set by Zephyr's CMakeLists.txt
  const projectVersion = cache['CMAKE_PROJECT_VERSION'] || '';
  if (projectVersion) { return projectVersion; }

  // Legacy / older Zephyr versions used explicit ZEPHYR_VERSION keys
  const fromCache =
    cache['ZEPHYR_VERSION_STRING'] ||
    cache['Zephyr_VERSION'] ||
    cache['ZEPHYR_VERSION'] ||
    '';
  if (fromCache) { return fromCache; }

  // Compose from individual major/minor/patch keys
  const major = cache['ZEPHYR_VERSION_MAJOR'] || cache['CMAKE_PROJECT_VERSION_MAJOR'];
  const minor = cache['ZEPHYR_VERSION_MINOR'] || cache['CMAKE_PROJECT_VERSION_MINOR'];
  const patch = cache['ZEPHYR_VERSION_PATCH'] || cache['CMAKE_PROJECT_VERSION_PATCH'] || cache['PATCHLEVEL'];
  if (major && minor && patch) { return `${major}.${minor}.${patch}`; }

  // Last resort: read from generated version.h
  const versionHeader = path.join(buildFolder, 'zephyr', 'include', 'generated', 'version.h');
  if (fs.existsSync(versionHeader)) {
    const content = fs.readFileSync(versionHeader, 'utf8');
    const m = content.match(/#define\s+KERNEL_VERSION_STRING\s+"([^"]+)"/);
    if (m) { return m[1]; }
  }
  return 'unknown';
}

/**
 * Parses the linker map file for memory region origin+length pairs.
 * The GNU ld map contains a section like:
 *   FLASH  0x10020000  0x001e0000  xr
 *   RAM    0x20000000  0x00082000  xw
 * Returns total sizes of the first ROM-like and RAM-like regions found.
 */
function parseMapMemoryRegions(buildFolder: string, kernelBinName: string): { romTotal: number; ramTotal: number } {
  const mapPath = path.join(buildFolder, 'zephyr', `${kernelBinName}.map`);
  if (!fs.existsSync(mapPath)) { return { romTotal: 0, ramTotal: 0 }; }
  let romTotal = 0;
  let ramTotal = 0;
  const ROM_NAMES = /^(FLASH|ROM|QSPI_FLASH|SPIFLASH|XIP|CODE)/i;
  const RAM_NAMES = /^(SRAM|RAM|DTCM|OCRAM|IRAM)/i;
  for (const line of fs.readFileSync(mapPath, 'utf8').split(/\r?\n/)) {
    // Match lines like: FLASH   0x10020000   0x001e0000   xr
    const m = line.match(/^(\S+)\s+(0x[0-9a-fA-F]+)\s+(0x[0-9a-fA-F]+)\s+[a-z]/);
    if (!m) { continue; }
    const name = m[1];
    const size = parseInt(m[3], 16);
    if (ROM_NAMES.test(name) && romTotal === 0) { romTotal = size; }
    if (RAM_NAMES.test(name) && ramTotal === 0) { ramTotal = size; }
    if (romTotal && ramTotal) { break; }
  }
  return { romTotal, ramTotal };
}

// ---------------------------------------------------------------------------
// Kconfig
// ---------------------------------------------------------------------------

function inferKconfigType(raw: string): string {
  if (raw === 'y' || raw === 'n' || raw === 'm') { return 'bool'; }
  if (/^0[xX][0-9a-fA-F]+$/.test(raw)) { return 'hex'; }
  if (/^-?\d+$/.test(raw)) { return 'int'; }
  return 'string';
}

function parseKconfig(buildFolder: string): DashboardKconfigEntry[] {
  const configPath = path.join(buildFolder, 'zephyr', '.config');
  if (!fs.existsSync(configPath)) { return []; }
  const entries: DashboardKconfigEntry[] = [];
  for (const line of fs.readFileSync(configPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('# CONFIG_') && trimmed.endsWith(' is not set')) {
      // "# CONFIG_FOO is not set" → disabled bool
      const name = trimmed.slice(2, -11);
      entries.push({ name, value: 'n', type: 'bool' });
    } else if (trimmed.startsWith('CONFIG_') && trimmed.includes('=')) {
      const eqIdx = trimmed.indexOf('=');
      const name = trimmed.slice(0, eqIdx);
      const raw = trimmed.slice(eqIdx + 1);
      // Strip surrounding double-quotes for string values
      const value = raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw;
      entries.push({ name, value, type: inferKconfigType(raw) });
    }
  }
  return entries;
}

// ---------------------------------------------------------------------------
// build_info.yml — source file lists
// ---------------------------------------------------------------------------

export interface BuildInfoSourceFiles {
  kconfigFiles: string[];
  dtsFiles: string[];
}

/**
 * Reads and parses build_info.yml. Returns undefined when the file is absent
 * or malformed — the single shared reader other modules should call instead
 * of independently existsSync + readFileSync + yaml.load'ing the same file.
 */
export function loadBuildInfoYml(buildFolder: string): any | undefined {
  const buildInfoPath = path.join(buildFolder, 'build_info.yml');
  if (!fs.existsSync(buildInfoPath)) { return undefined; }
  try {
    return yaml.load(fs.readFileSync(buildInfoPath, 'utf8'));
  } catch {
    return undefined;
  }
}

/**
 * Reads build_info.yml and extracts the flat lists of Kconfig conf files and
 * DTS/overlay source files that contributed to this build.  Returns empty
 * arrays when the file is absent or malformed (lenient by design).
 */
export function readBuildInfoSourceFiles(buildFolder: string): BuildInfoSourceFiles {
  const rawData = loadBuildInfoYml(buildFolder);
  const kconfigFiles: string[] = [
    ...(rawData?.cmake?.kconfig?.files ?? []),
    ...(rawData?.cmake?.kconfig?.['user-files'] ?? []),
  ];
  const dtsFiles: string[] = [
    ...(rawData?.cmake?.devicetree?.files ?? []),
    ...(rawData?.cmake?.devicetree?.['user-files'] ?? []),
  ];
  return { kconfigFiles, dtsFiles };
}

// ---------------------------------------------------------------------------
// ELF section sizes
// ---------------------------------------------------------------------------

const SHF_WRITE = 0x1;
const SHF_ALLOC = 0x2;
const SHF_EXECINSTR = 0x4;
const SHT_PROGBITS = 1;
const SHT_NOBITS = 8;

/**
 * Format a byte count into a human-readable string ("516 Bytes", "210.4 KB", etc.).
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) { return '0 B'; }
  if (bytes < 1024) { return `${bytes} Bytes`; }
  if (bytes < 1024 * 1024) { return `${(bytes / 1024).toFixed(1)} KB`; }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface ElfHeader {
  is64: boolean;
  isLE: boolean;
  u16: (o: number) => number;
  u32: (o: number) => number;
  /** Safe 64-bit read returning a JS number (works for sizes/offsets up to 2^53). */
  u64: (o: number) => number;
  shoff: number;
  shentsize: number;
  shnum: number;
  shstrndx: number;
}

/**
 * Parses the ELF header bootstrap shared by every section/symbol-table
 * reader in this file: magic validation, 32/64-bit + endianness detection,
 * the resulting u16/u32/u64 readers, and the section-header-table geometry
 * (offset/entry-size/count/string-table-index). Returns null for a
 * too-short buffer or invalid ELF magic.
 */
function parseElfHeader(buf: Buffer): ElfHeader | null {
  if (buf.length < 64) { return null; }

  // Validate ELF magic: 0x7f 'E' 'L' 'F'
  if (buf[0] !== 0x7f || buf[1] !== 0x45 || buf[2] !== 0x4c || buf[3] !== 0x46) { return null; }

  const is64 = buf[4] === 2;
  const isLE = buf[5] === 1;
  const u16 = (o: number) => isLE ? buf.readUInt16LE(o) : buf.readUInt16BE(o);
  const u32 = (o: number) => isLE ? buf.readUInt32LE(o) : buf.readUInt32BE(o);
  const u64 = (o: number) => {
    const lo = u32(o), hi = u32(o + 4);
    return isLE ? lo + hi * 0x100000000 : hi + lo * 0x100000000;
  };

  // Section header table metadata from ELF header
  let shoff: number, shentsize: number, shnum: number, shstrndx: number;
  if (is64) {
    shoff = u64(40);
    shentsize = u16(58);
    shnum = u16(60);
    shstrndx = u16(62);
  } else {
    shoff = u32(32);
    shentsize = u16(46);
    shnum = u16(48);
    shstrndx = u16(50);
  }

  return { is64, isLE, u16, u32, u64, shoff, shentsize, shnum, shstrndx };
}

/**
 * Parse ELF section headers to compute memory sizes by category.
 * Uses ELF section flags (SHF_ALLOC, SHF_WRITE, SHF_EXECINSTR) and types
 * (SHT_PROGBITS, SHT_NOBITS) for classification — works with any toolchain
 * and does not require a pre-generated nm stat file.
 */
function parseElfSectionSizes(elfPath: string): DashboardSummary['memorySummary'] | null {
  if (!fs.existsSync(elfPath)) { return null; }
  try {
    const buf: Buffer = fs.readFileSync(elfPath);
    const header = parseElfHeader(buf);
    if (!header) { return null; }
    const { is64, u32, u64, shoff, shentsize, shnum } = header;

    if (shoff === 0 || shnum === 0 || shentsize === 0) { return null; }
    if (shoff + shnum * shentsize > buf.length) { return null; }

    const result: DashboardSummary['memorySummary'] = { text: 0, rodata: 0, rwdata: 0, bss: 0, other: 0 };
    for (let i = 0; i < shnum; i++) {
      const b = shoff + i * shentsize;
      let secType: number, secFlags: number, secSize: number;
      if (is64) {
        secType = u32(b + 4);
        secFlags = u64(b + 8);
        secSize = u64(b + 32);
      } else {
        secType = u32(b + 4);
        secFlags = u32(b + 8);
        secSize = u32(b + 20);
      }

      if (!(secFlags & SHF_ALLOC) || secSize === 0) { continue; }

      if (secFlags & SHF_EXECINSTR) {
        result.text += secSize;
      } else if (secType === SHT_NOBITS && (secFlags & SHF_WRITE)) {
        result.bss += secSize;
      } else if (secType === SHT_PROGBITS && (secFlags & SHF_WRITE)) {
        result.rwdata += secSize;
      } else if (secType === SHT_PROGBITS) {
        result.rodata += secSize;
      } else {
        result.other += secSize;
      }
    }
    return result;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// SYS_INIT extraction from ELF + map
// ---------------------------------------------------------------------------

const ZINIT_SECTION_RE = /^\s*(\.z_init_([A-Z_0-9]+)_P_(\d+)_SUB_(\d+)_)\s*$/;
const ZINIT_ADDR_RE = /^\s+(0x[0-9a-fA-F]+)\s+0x[0-9a-fA-F]+\s+(\S+)\s*$/;

/**
 * Extract SYS_INIT / device init entries by combining:
 *  - The linker map (for level / priority / source-file metadata)
 *  - The ELF symbol table (for human-readable function names)
 *
 * Works purely from files on disk — no toolchain subprocess needed.
 */
function parseSysInit(buildFolder: string, kernelBinName: string, cache: Record<string, string>): DashboardSysInit {
  const errors: string[] = [];
  const levels: Record<string, DashboardSysInitEntry[]> = {};

  const elfPath = path.join(buildFolder, 'zephyr', `${kernelBinName}.elf`);
  const mapPath = path.join(buildFolder, 'zephyr', `${kernelBinName}.map`);
  if (!fs.existsSync(elfPath) || !fs.existsSync(mapPath)) {
    return { errors, levels };
  }

  // -------------------------------------------------------------------------
  // 1. Build address→name map from ELF symbol table
  // -------------------------------------------------------------------------
  const addrToName = new Map<number, string>();
  try {
    const buf: Buffer = fs.readFileSync(elfPath);
    const header = parseElfHeader(buf);
    if (header) {
      const { is64, u32, u64, shoff, shentsize, shnum, shstrndx } = header;

      // Read section header string table (.shstrtab) to look up section names
      const shstrtabHeader = shoff + shstrndx * shentsize;
      const shstrtabOff = is64 ? u64(shstrtabHeader + 24) : u32(shstrtabHeader + 16);
      const shstrtabSize = is64 ? u64(shstrtabHeader + 32) : u32(shstrtabHeader + 20);
      const getString = (base: number, off: number) => {
        let end = off;
        while (end < base + shstrtabSize && buf[base + end] !== 0) { end++; }
        return buf.toString('utf8', base + off, base + end);
      };

      // Find .symtab and .strtab sections
      let symtabOff = 0, symtabSize = 0, symEntSize = 0;
      let strtabOff = 0, strtabSize = 0;
      for (let i = 0; i < shnum; i++) {
        const b = shoff + i * shentsize;
        const nameOff = u32(b);
        const secName = getString(shstrtabOff, nameOff);
        const secOffset = is64 ? u64(b + 24) : u32(b + 16);
        const secSize = is64 ? u64(b + 32) : u32(b + 20);
        const secEntSz = is64 ? u64(b + 56) : u32(b + 36);
        const secType = u32(b + 4);
        const SHT_SYMTAB = 2, SHT_STRTAB = 3, SHT_DYNSYM = 11;
        if (secType === SHT_SYMTAB || secType === SHT_DYNSYM) {
          symtabOff = secOffset; symtabSize = secSize; symEntSize = secEntSz;
        }
        if (secName === '.strtab' || (secType === SHT_STRTAB && i !== shstrndx && strtabOff === 0)) {
          strtabOff = secOffset; strtabSize = secSize;
        }
      }

      // Build address→name map from __init_* symbols (all types: OBJECT, NOTYPE, etc.)
      // These symbols sit at the init entry struct addresses and encode the entry name.
      if (symtabOff && symEntSize) {
        const entCount = Math.floor(symtabSize / symEntSize);
        for (let i = 0; i < entCount; i++) {
          const b = symtabOff + i * symEntSize;
          if (b + symEntSize > buf.length) { break; }
          let symNameOff: number, symValue: number;
          if (is64) {
            symNameOff = u32(b);
            symValue = u64(b + 8);
          } else {
            symNameOff = u32(b);
            symValue = u32(b + 4);
          }
          if (symValue === 0) { continue; }
          // Resolve name from .strtab
          if (strtabOff && symNameOff < strtabSize) {
            let end = strtabOff + symNameOff;
            while (end < strtabOff + strtabSize && buf[end] !== 0) { end++; }
            const name = buf.toString('utf8', strtabOff + symNameOff, end);
            // Only keep __init_* symbols (excluding level boundary markers like __init_EARLY_start)
            if (name.startsWith('__init_') && !/^__init_[A-Z_]+_start$/.test(name) && name !== '__init_start' && name !== '__init_end') {
              addrToName.set(symValue, name);
            }
          }
        }
      }
    }
  } catch (e) {
    errors.push(`ELF symbol table parse failed: ${e}`);
  }

  // -------------------------------------------------------------------------
  // 2. Build source-root map from CMakeCache for absolute path resolution
  // -------------------------------------------------------------------------
  const sourceRoots: Record<string, string> = {};
  const zephyrBase = cache['ZEPHYR_BASE'] ?? '';
  const appSourceDir = cache['APPLICATION_SOURCE_DIR'] ?? '';
  if (zephyrBase) { sourceRoots['zephyr'] = zephyrBase.replace(/\\/g, '/'); }
  if (appSourceDir) { sourceRoots['app'] = appSourceDir.replace(/\\/g, '/'); }

  // -------------------------------------------------------------------------
  // 3. Parse the linker map for .z_init_* sections
  // -------------------------------------------------------------------------

  /**
   * Resolve an init entry struct address to a display name.
   * Looks up the __init_<label> symbol at that address in the symbol table.
   * Returns the label part after "__init_", e.g. "statics_init_pre" or "__device_dts_ord_26".
   */
  const resolveInitFn = (entryAddr: number): string => {
    const symName = addrToName.get(entryAddr);
    if (!symName) { return ''; }
    return symName.slice('__init_'.length);
  };

  try {
    const mapLines = fs.readFileSync(mapPath, 'utf8').split(/\r?\n/);
    let pendingLevel = '';
    let pendingPriority = '';
    let pendingOrdinal = 0;

    for (let i = 0; i < mapLines.length; i++) {
      const line = mapLines[i];
      const sectionMatch = line.match(ZINIT_SECTION_RE);
      if (sectionMatch) {
        pendingLevel = sectionMatch[2];   // e.g. "PRE_KERNEL_1"
        pendingPriority = sectionMatch[3];   // e.g. "30"
        pendingOrdinal = parseInt(sectionMatch[4], 10);
        continue;
      }

      if (!pendingLevel) { continue; }

      const addrMatch = line.match(ZINIT_ADDR_RE);
      if (!addrMatch) { pendingLevel = ''; continue; }

      const entryAddr = parseInt(addrMatch[1], 16); // address of init_entry struct
      const srcRaw = addrMatch[2];               // e.g. "zephyr/drivers/foo/libfoo.a(bar.c.obj)"

      // Extract source file path from archive notation.
      // "zephyr/drivers/foo/libfoo.a(bar.c.obj)" → display="bar.c", path=absolute if base known
      let srcPath: string | null = null;
      const archiveMatch = srcRaw.match(/^(.+\/)?[^/(]+\.a\(([^)]+)\)$/);
      if (archiveMatch) {
        const dir = (archiveMatch[1] ?? '').replace(/\/$/, '');   // e.g. "zephyr/drivers/foo"
        const filename = archiveMatch[2].replace(/\.obj$/, '');  // e.g. "bar.c"
        const dirParts = dir.split('/');
        const leadingSegment = dirParts[0];                       // e.g. "zephyr", "app"
        const innerDir = dirParts.slice(1).join('/');             // e.g. "drivers/foo"
        const base = sourceRoots[leadingSegment];
        if (base && innerDir) {
          // Construct absolute path: {ZEPHYR_BASE}/drivers/foo/bar.c
          srcPath = `${base}/${innerDir}/${filename}`;
        } else {
          srcPath = filename;                                      // basename-only fallback
        }
      } else {
        srcPath = srcRaw;
      }

      const fnName = resolveInitFn(entryAddr);

      const levelKey = pendingLevel;
      if (!levels[levelKey]) { levels[levelKey] = []; }
      levels[levelKey].push({
        name: fnName || srcPath || '',
        priority: parseInt(pendingPriority, 10),
        ordinal: pendingOrdinal,
        path: srcPath || null,
      });

      pendingLevel = '';
    }
  } catch (e) {
    errors.push(`Map file parse failed: ${e}`);
  }

  return { errors, levels };
}

// ---------------------------------------------------------------------------
// ELF / stat file
// ---------------------------------------------------------------------------

function getElfInfo(buildFolder: string, kernelBinName: string) {
  const elfPath = path.join(buildFolder, 'zephyr', `${kernelBinName}.elf`);
  const binPath = path.join(buildFolder, 'zephyr', `${kernelBinName}.bin`);
  const hexPath = path.join(buildFolder, 'zephyr', `${kernelBinName}.hex`);
  const statPath = path.join(buildFolder, 'zephyr', `${kernelBinName}.stat`);

  let elfSize: string | null = null;
  let elfDate: string | null = null;
  let binSize: string | null = null;
  let statContents = '';
  let memorySummary: DashboardSummary['memorySummary'] = { bss: 0, rodata: 0, rwdata: 0, text: 0, other: 0 };

  if (fs.existsSync(elfPath)) {
    const stat = fs.statSync(elfPath);
    elfSize = `${stat.size.toLocaleString()} bytes`;
    elfDate = new Date(stat.mtime).toISOString().replace('T', ' ').slice(0, 19);
  }
  if (fs.existsSync(binPath)) {
    binSize = formatBytes(fs.statSync(binPath).size);
  } else if (fs.existsSync(hexPath)) {
    binSize = `${formatBytes(fs.statSync(hexPath).size)} (hex)`;
  }
  if (fs.existsSync(statPath)) {
    statContents = fs.readFileSync(statPath, 'utf8');
  }
  // Use ELF section headers for accurate memory breakdown — more reliable than nm stat output.
  const elfSections = parseElfSectionSizes(elfPath);
  if (elfSections) { memorySummary = elfSections; }

  return { elfSize, elfDate, binSize, statContents, statPath, memorySummary };
}

// ---------------------------------------------------------------------------
// Memory reports (written by cmake --build --target ram_report / rom_report)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Zephyr size_report JSON format
// The `ram_report` / `rom_report` cmake targets write a JSON file at the
// build root with this structure (produced by scripts/footprint/size_report):
//   { "total_size": N, "symbols": { "name": "Root", "size": N, "identifier": ...,
//                                   "loc": [], "children": [...] } }
// Each node has: name, size, identifier, loc (string[]), children (recursive).
// ---------------------------------------------------------------------------

interface ZephyrSymNode {
  name: string;
  size: number;
  identifier?: string;
  loc: string[];
  children?: ZephyrSymNode[];
}

interface ZephyrMemJson {
  total_size?: number;
  symbols: ZephyrSymNode;
}

function convertZephyrNode(node: ZephyrSymNode): DashboardMemoryNode {
  return {
    expanded: false,
    data: {
      name: node.name,
      size: node.size,
      displaySize: formatBytes(node.size),
      memoryType: node.loc && node.loc.length > 0 ? node.loc : undefined,
      identifier: node.identifier,
    },
    children: node.children && node.children.length > 0
      ? node.children.map((c) => convertZephyrNode(c))
      : undefined,
  };
}

function parseZephyrMemJson(raw: unknown): DashboardMemoryReport | null {
  const j = raw as ZephyrMemJson;
  if (!j || typeof j !== 'object' || !j.symbols || typeof j.symbols.size !== 'number') {
    return null;
  }
  const rootNode = convertZephyrNode(j.symbols);
  rootNode.expanded = true;
  return {
    size: j.symbols.size,
    tree: [rootNode],
  };
}

/**
 * Reads memory reports produced by the cmake `ram_report` / `rom_report`
 * targets.  These targets write `ram.json` / `rom.json` at the build root.
 * Falls back to extracting from `dashboard/memoryreport.html` if the JSON
 * files are not present (e.g. the user ran `dashboard` instead).
 */
function loadMemoryReportsFromDisk(buildFolder: string): { ram: DashboardMemoryReport | null; rom: DashboardMemoryReport | null } {
  const tryJson = (name: string): DashboardMemoryReport | null => {
    const p = path.join(buildFolder, `${name}.json`);
    if (!fs.existsSync(p)) { return null; }
    try {
      const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
      // Zephyr size_report format: { symbols: { name, size, loc, children }, total_size }
      if (raw && typeof raw === 'object' && 'symbols' in raw) {
        return parseZephyrMemJson(raw);
      }
      // Legacy / dashboard HTML extraction format: { size, tree }
      if (raw && typeof raw === 'object' && 'size' in raw && 'tree' in raw) {
        return raw as DashboardMemoryReport;
      }
      return null;
    }
    catch { return null; }
  };

  const ram = tryJson('ram');
  const rom = tryJson('rom');
  if (ram || rom) { return { ram, rom }; }

  // Fallback: extract from dashboard HTML (written by `cmake --target dashboard`)
  const htmlPath = path.join(buildFolder, 'dashboard', 'memoryreport.html');
  if (!fs.existsSync(htmlPath)) { return { ram: null, rom: null }; }
  const html = fs.readFileSync(htmlPath, 'utf8');
  const extract = (varName: string): DashboardMemoryReport | null => {
    const match = html.match(new RegExp(`let\\s+${varName}\\s*=\\s*(\\{[\\s\\S]*?\\});\\s*\n`));
    if (!match) { return null; }
    try { return JSON.parse(match[1]) as DashboardMemoryReport; }
    catch { return null; }
  };
  return { ram: extract('ramReport'), rom: extract('romReport') };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Merges two memory reports into a combined "all" view by concatenating their
 * trees and summing sizes.  Returns null if both inputs are null.
 */
function mergeMemoryReports(
  ram: DashboardMemoryReport | null,
  rom: DashboardMemoryReport | null,
): DashboardMemoryReport | null {
  if (!ram && !rom) { return null; }
  // Zephyr size_report uses "Root" as the top-level name for both ram.json and
  // rom.json.  When merged side-by-side the duplicate names cause key collisions
  // in the sunburst / tree-table.  Rename each top-level tree to "RAM" / "ROM"
  // so they are always distinct in the "All" (Total) view.
  const tagTree = (nodes: DashboardMemoryNode[], tag: string): DashboardMemoryNode[] =>
    nodes.map((n) => ({ ...n, data: { ...n.data, name: tag } }));
  return {
    size: (ram?.size ?? 0) + (rom?.size ?? 0),
    tree: [...(ram ? tagTree(ram.tree, 'RAM') : []), ...(rom ? tagTree(rom.tree, 'ROM') : [])],
  };
}

/**
 * Reads the memory reports from disk (ram.json / rom.json) for the given
 * build directory.  Automatically resolves the effective (per-image) build
 * directory when sysbuild is in use (domains.yaml present).
 * Returns null entries if the report files are absent.
 * The "all" view is synthesised by merging ram + rom trees.
 */
export function readMemoryReports(buildFolder: string): DashboardMemory {
  const effectiveFolder = resolveEffectiveBuildDir(buildFolder);
  const { ram, rom } = loadMemoryReportsFromDisk(effectiveFolder);
  return { all: mergeMemoryReports(ram, rom), ram, rom };
}

/**
 * Reads the memory summary from the ELF section headers.
 * Automatically resolves the effective (per-image) build directory when
 * sysbuild is in use (domains.yaml present).
 * Returns a zeroed summary if the ELF file does not exist yet.
 */
export function readMemorySummary(buildFolder: string, kernelBinName = 'zephyr'): DashboardSummary['memorySummary'] {
  const effectiveFolder = resolveEffectiveBuildDir(buildFolder);
  const elfPath = path.join(effectiveFolder, 'zephyr', `${kernelBinName}.elf`);
  return parseElfSectionSizes(elfPath) ?? { bss: 0, rodata: 0, rwdata: 0, text: 0, other: 0 };
}

/**
 * Combines readMemoryReports + readMemorySummary into the DashboardMemoryRefresh
 * shape used by DashboardPanel.refreshMemory().
 */
export function readMemoryRefresh(buildFolder: string, kernelBinName = 'zephyr'): DashboardMemoryRefresh {
  return {
    memory: readMemoryReports(buildFolder),
    memorySummary: readMemorySummary(buildFolder, kernelBinName),
  };
}

/**
 * Reads all Zephyr build artifacts for the given build directory and
 * assembles a `DashboardData` object ready to post to the webview.
 *
 * When sysbuild is in use (domains.yaml is present in buildFolder) all
 * per-image artifact paths are resolved against the default domain's build
 * directory automatically.
 *
 * Memory report data (ram/rom tree) is loaded from any pre-existing
 * *_report.json files; call `runMemoryReports()` to generate them first.
 */
export async function readDashboardData(
  buildFolder: string,
  projectName: string,
  buildName: string,
  kernelBinName = 'zephyr',
  command: string | null = null,
): Promise<DashboardData> {
  // Resolve the per-image build directory so that sysbuild projects point to
  // the correct subdirectory (e.g. <build>/hello_world/) instead of the
  // top-level sysbuild directory which does not contain Zephyr artifacts.
  const effectiveFolder = resolveEffectiveBuildDir(buildFolder);

  const cache = parseCMakeCache(effectiveFolder);
  const board = cache['BOARD'] ?? cache['CACHED_BOARD'] ?? null;
  const application = cache['APPLICATION_SOURCE_DIR'] ?? null;
  const zephyrBase = cache['ZEPHYR_BASE'] ?? null;
  const zephyrVersion = resolveZephyrVersion(cache, effectiveFolder);
  const toolchain = resolveToolchain(cache, effectiveFolder);

  const elfInfo = getElfInfo(effectiveFolder, kernelBinName);
  const kconfig = parseKconfig(effectiveFolder);
  const { romTotal, ramTotal } = parseMapMemoryRegions(effectiveFolder, kernelBinName);
  const sysInit = parseSysInit(effectiveFolder, kernelBinName, cache);
  const buildInfoFiles = readBuildInfoSourceFiles(effectiveFolder);

  const dtsPath = path.join(effectiveFolder, 'zephyr', 'zephyr.dts');
  const dtsSource = fs.existsSync(dtsPath) ? fs.readFileSync(dtsPath, 'utf8') : '';

  const { ram: memRam, rom: memRom } = loadMemoryReportsFromDisk(effectiveFolder);
  const memory = { all: mergeMemoryReports(memRam, memRom), ram: memRam, rom: memRom };

  return {
    summary: {
      board,
      application,
      command,
      outputDir: buildFolder,
      zephyrBase,
      zephyrVersion,
      toolchain,
      elfDate: elfInfo.elfDate,
      elfSize: elfInfo.elfSize,
      binSize: elfInfo.binSize,
      memorySummary: elfInfo.memorySummary,
      romTotal,
      ramTotal,
    },
    kconfig,
    kconfigSourceFiles: buildInfoFiles.kconfigFiles,
    sysInit,
    memory,
    dts: { source: dtsSource, sourcePath: dtsPath, sourceFiles: buildInfoFiles.dtsFiles },
    elfStats: { contents: elfInfo.statContents, path: elfInfo.statPath },
    meta: {
      projectName,
      buildName,
      generatedAt: new Date().toISOString(),
    },
  };
}
