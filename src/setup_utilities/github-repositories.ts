// SPDX-License-Identifier: Apache-2.0
import { l10n } from "vscode";
import { HttpClient } from "typed-rest-client/HttpClient";

export interface GitHubRepository {
  full_name: string;
  default_branch: string;
}

const owners = new Map<string, { expires: number; items: Promise<GitHubRepository[]> }>();
const api = new HttpClient("Zephyr-IDE", undefined, { socketTimeout: 12000 });

async function getPage<T>(route: string): Promise<T> {
  const response = await api.get("https://api.github.com/" + route, { Accept: "application/vnd.github+json" });
  const body = await response.readBody();
  if (response.message.statusCode !== 200) {
    throw Error("GitHub HTTP " + response.message.statusCode + ": " + JSON.parse(body).message);
  }
  return JSON.parse(body);
}

async function listOwner(owner: string) {
  const repositories: GitHubRepository[] = [];
  for (let page = 1; ; page++) {
    const batch = await getPage<GitHubRepository[]>(`users/${owner}/repos?per_page=100&page=${page}`);
    repositories.push(...batch.map(({ full_name, default_branch }) => ({ full_name, default_branch })));
    if (batch.length < 100) { return repositories; }
  }
}

export async function findRepositories(owner: string, query?: string): Promise<GitHubRepository[]> {
  if (query !== undefined) {
    const params = new URLSearchParams({ q: query.slice(0, 200) + " in:name", per_page: "100" });
    const result = await getPage<{ items: GitHubRepository[] }>("search/repositories?" + params);
    return result.items.map(({ full_name, default_branch }) => ({ full_name, default_branch }));
  }
  if (!/^[a-z0-9-]{1,39}$/i.test(owner)) { throw Error(l10n.t("Invalid GitHub owner")); }
  const key = owner.toLowerCase();
  const cached = owners.get(key);
  if (cached && cached.expires > Date.now()) { return cached.items; }
  const items = listOwner(key);
  owners.set(key, { expires: Date.now() + 300000, items });
  try { return await items; }
  catch (error) { owners.delete(key); throw error; }
}
