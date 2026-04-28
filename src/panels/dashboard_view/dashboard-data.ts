/*
Copyright 2026 mylonics 
Author Rijesh Augustine
SPDX-License-Identifier: Apache-2.0
*/

// Shared data types describing the JSON payload produced by
// `resources/zephyr_dashboard_json.py`.  Mirrored on the extension side
// so that the dashboard panel can post the parsed JSON to the webview
// with full type safety.

export interface DashboardSummary {
  board: string | null;
  application: string | null;
  command: string | null;
  zephyrVersion: string;
  toolchain: string;
  elfDate: string | null;
  elfSize: string | null;
  binSize: string | null;
  memorySummary: { bss: number; rodata: number; rwdata: number; text: number; other: number };
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
