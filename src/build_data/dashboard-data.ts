/*
Copyright 2026 mylonics
Author Rijesh Augustine
SPDX-License-Identifier: Apache-2.0
*/

// Shared data types for Zephyr build artifact data surfaced by the dashboard.
// Consumed by both the extension side (build-artifact-reader.ts) and the
// webview side (dashboard panel Lit components).

export interface DashboardSummary {
  board: string | null;
  application: string | null;
  command: string | null;
  outputDir: string | null;
  zephyrBase: string | null;
  zephyrVersion: string;
  toolchain: string;
  elfDate: string | null;
  elfSize: string | null;
  binSize: string | null;
  memorySummary: { bss: number; rodata: number; rwdata: number; text: number; other: number };
  /** Total flash (ROM) region size in bytes from the linker map, or 0 if unknown. */
  romTotal: number;
  /** Total RAM region size in bytes from the linker map, or 0 if unknown. */
  ramTotal: number;
}

export interface DashboardKconfigEntry {
  name: string;
  /** Inferred Kconfig type: "bool" | "int" | "hex" | "string" */
  type?: string;
  value: string;
}

export interface DashboardSysInitEntry {
  name: string;
  priority: number | string | null;
  ordinal: number | string | null;
  path: string | null;
}

export interface DashboardSysInit {
  errors: string[];
  levels: Record<string, DashboardSysInitEntry[]>;
}

export interface DashboardMemoryNode {
  expanded?: boolean;
  data: {
    name: string;
    size: number;
    displaySize: string;
    memoryType?: string[];
    /** Optional source location identifier from Zephyr size_report (e.g. "path/to/file.c:42"). */
    identifier?: string;
  };
  children?: DashboardMemoryNode[];
}

export interface DashboardMemoryReport {
  size: number;
  tree: DashboardMemoryNode[];
}

export interface DashboardMemory {
  all: DashboardMemoryReport | null;
  ram: DashboardMemoryReport | null;
  rom: DashboardMemoryReport | null;
}

export interface DashboardDts {
  /** Raw .dts source text. */
  source: string;
  sourcePath: string;
}

export interface DashboardElfStats {
  contents: string;
  path: string;
}

export interface DashboardData {
  summary: DashboardSummary;
  kconfig: DashboardKconfigEntry[];
  sysInit: DashboardSysInit;
  memory: DashboardMemory;
  dts: DashboardDts;
  elfStats: DashboardElfStats;
  meta: {
    projectName: string;
    buildName: string;
    generatedAt: string;
  };
}

/**
 * Payload returned by a memory refresh operation.
 * Includes the updated memory tree AND the updated symbol-level memory bar
 * (memorySummary) so the Summary page bar updates without a full reload.
 */
export interface DashboardMemoryRefresh {
  memory: DashboardMemory;
  memorySummary: DashboardSummary['memorySummary'];
}
