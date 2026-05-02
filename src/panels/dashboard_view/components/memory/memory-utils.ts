/*
Copyright 2026 mylonics
Author Rijesh Augustine
SPDX-License-Identifier: Apache-2.0
*/

import type { DashboardMemoryNode } from "../../dashboard-data";

export type SortKey = "size" | "name" | "pct";
export type SortDir = "asc" | "desc";

/**
 * A node-key uniquely identifies a node by its path from the root.
 * Format: "Root/Sub/Leaf" — joined with "/".  Components with embedded
 * slashes are escaped (rare for symbol names but possible for paths).
 */
export function pathToKey(path: string[]): string {
  return path.map((p) => p.replace(/\//g, "\\u002F")).join("/");
}

/** Build the key for a node given the ancestor names that lead to it. */
export function nodeKey(ancestorNames: string[], node: DashboardMemoryNode): string {
  return pathToKey([...ancestorNames, node.data.name]);
}

/** Walk the tree and run `visit` on every node with its computed key + ancestors. */
export function walkNodes(
  nodes: DashboardMemoryNode[] | undefined,
  visit: (node: DashboardMemoryNode, key: string, ancestors: string[]) => void,
  ancestors: string[] = [],
): void {
  if (!nodes) { return; }
  for (const n of nodes) {
    const key = nodeKey(ancestors, n);
    visit(n, key, ancestors);
    if (n.children && n.children.length) {
      walkNodes(n.children, visit, [...ancestors, n.data.name]);
    }
  }
}

/** Find a node by its key.  Returns the node + ancestor names, or null. */
export function findNodeByKey(
  nodes: DashboardMemoryNode[] | undefined,
  key: string,
): { node: DashboardMemoryNode; ancestors: string[] } | null {
  let result: { node: DashboardMemoryNode; ancestors: string[] } | null = null;
  walkNodes(nodes, (node, k, ancestors) => {
    if (!result && k === key) { result = { node, ancestors }; }
  });
  return result;
}

/** Sum sizes of all descendant leaves (or the node's own size if leaf). */
export function totalSize(node: DashboardMemoryNode): number {
  if (!node.children || node.children.length === 0) { return node.data.size; }
  return node.children.reduce((acc, c) => acc + totalSize(c), 0) || node.data.size;
}

/**
 * Recursively sort children of every branch in-place by the given key.
 * Returns a new tree (does not mutate input).
 */
export function sortTree(
  nodes: DashboardMemoryNode[],
  key: SortKey,
  dir: SortDir,
  total: number,
): DashboardMemoryNode[] {
  const sign = dir === "asc" ? 1 : -1;
  const cmp = (a: DashboardMemoryNode, b: DashboardMemoryNode): number => {
    if (key === "name") {
      return sign * a.data.name.localeCompare(b.data.name);
    }
    // size and pct sort identically on raw bytes (pct is monotonic w/ size).
    return sign * (a.data.size - b.data.size);
  };
  return [...nodes]
    .sort(cmp)
    .map((n) => ({
      ...n,
      children: n.children ? sortTree(n.children, key, dir, total) : n.children,
    }));
}

/**
 * Returns true if `node` (or any descendant) matches the search query.
 * Uses simple case-insensitive substring matching on the node name.
 */
export function nodeMatchesQuery(node: DashboardMemoryNode, q: string): boolean {
  if (!q) { return true; }
  const ql = q.toLowerCase();
  if (node.data.name.toLowerCase().includes(ql)) { return true; }
  if (node.children) {
    for (const c of node.children) {
      if (nodeMatchesQuery(c, ql)) { return true; }
    }
  }
  return false;
}

/**
 * Returns the set of keys whose subtree contains a match for `q`.
 * Used to decide which rows to keep visible while filtering.
 */
export function filterKeys(nodes: DashboardMemoryNode[] | undefined, q: string): Set<string> {
  const out = new Set<string>();
  if (!q) { return out; }
  const ql = q.toLowerCase();
  const visit = (
    arr: DashboardMemoryNode[] | undefined,
    ancestors: string[],
  ): boolean => {
    if (!arr) { return false; }
    let anyChildMatch = false;
    for (const n of arr) {
      const key = nodeKey(ancestors, n);
      const selfMatch = n.data.name.toLowerCase().includes(ql);
      const childMatch = visit(n.children, [...ancestors, n.data.name]);
      if (selfMatch || childMatch) {
        out.add(key);
        anyChildMatch = true;
      }
    }
    return anyChildMatch;
  };
  visit(nodes, []);
  return out;
}

/**
 * Returns the set of ancestor keys that should be expanded so that a target
 * key (or any of a list of keys) becomes visible.
 */
export function ancestorKeys(targetKey: string): Set<string> {
  const parts = targetKey.split("/");
  const out = new Set<string>();
  for (let i = 1; i < parts.length; i++) {
    out.add(parts.slice(0, i).join("/"));
  }
  return out;
}

/** Returns the immediate parent key of `key`, or "" if at root. */
export function parentKey(key: string): string {
  const idx = key.lastIndexOf("/");
  return idx === -1 ? "" : key.slice(0, idx);
}

/** Format a number of bytes as a human-readable string. */
export function formatBytes(n: number): string {
  if (n < 1024) { return `${n} B`; }
  if (n < 1024 * 1024) { return `${(n / 1024).toFixed(1)} KB`; }
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}
