// Generates AI-powered release notes for an official zephyr-ide release.
//
// Compares the current release with the previous official (non-prerelease)
// release and produces a concise, structured Markdown summary highlighting:
//   - Major new features / highlights
//   - Bug fixes
//   - Breaking changes & migration notes (only when actually present)
//
// The script is intentionally pure-Node (no extra dependencies) so it can run
// in any GitHub Actions runner without an `npm ci`. It calls the GitHub Models
// API (https://models.github.ai/inference) using the workflow's GITHUB_TOKEN,
// which requires `permissions: models: read` in the calling workflow.
//
// Inputs (env vars):
//   GITHUB_TOKEN       Required. Token with `models:read` permission.
//   PREV_VERSION       Required. e.g. "v2.4.0"
//   CURR_VERSION       Required. e.g. "v2.4.6"
//   CHANGELOG_CONTENT  Optional. CHANGELOG.md section between the two tags.
//   CONTEXT_DIR        Optional. Directory containing diff/log files written
//                      by the workflow. Default: ".release-notes-context".
//                      Files looked up (all optional):
//                        git-log.txt              commit log
//                        diff-stat.txt            `git diff --stat` overview
//                        package-json.diff        package.json diff
//                        host-tools-manifest.diff host-tools manifest diff
//                        source.diff              filtered src/+resources/ diff
//                        docs.diff                README + docs diff
//   MODEL              Optional. Override model id. Default: openai/gpt-4o.
//   OUTPUT_FILE        Optional. Path to write the notes. Default: release-notes.md.
//
// Behavior on failure: writes a fallback notes file containing the raw
// CHANGELOG section so the workflow can still update the release body, and
// exits with code 0 unless GITHUB_TOKEN is missing.

"use strict";

const fs = require("fs");
const path = require("path");

const MODELS_ENDPOINT =
  "https://models.github.ai/inference/chat/completions";
// Default to Claude Sonnet 4.6 — strong at large-context code review and
// summarization. Override with the MODEL env var (e.g. "openai/gpt-4o").
const DEFAULT_MODEL = "anthropic/claude-sonnet-4.6";
const DEFAULT_CONTEXT_DIR = ".release-notes-context";

// Per-section character caps. Source diffs are the largest and most likely to
// blow past model context windows, so they get the tightest cap. Sonnet 4.5
// has a 200K token window so we can afford a generous source-diff budget.
const CAPS = {
  changelog: 20000,
  gitLog: 20000,
  diffStat: 10000,
  pkgDiff: 10000,
  manifestDiff: 10000,
  sourceDiff: 400000,
  docsDiff: 30000,
};

function truncate(str, max) {
  if (!str) {
    return "";
  }
  if (str.length <= max) {
    return str;
  }
  return (
    str.slice(0, max) +
    `\n\n... [truncated ${str.length - max} characters of ${str.length} total] ...`
  );
}

function readContextFile(dir, name) {
  if (!dir) {
    return "";
  }
  const p = path.join(dir, name);
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return "";
  }
}

function buildPrompt(ctx) {
  const sections = [];
  sections.push(
    `You are performing a code review and writing release notes for the ` +
    `"Zephyr IDE" Visual Studio Code extension. Your audience is embedded ` +
    `firmware developers using Zephyr RTOS.`
  );
  sections.push(`Previous release: ${ctx.prev}`);
  sections.push(`New release:      ${ctx.curr}`);
  sections.push("");
  sections.push(
    "You have access to: the CHANGELOG section for this release, the full " +
    "commit log, a `git diff --stat` overview of every changed file, the " +
    "raw diff for high-signal config files, a filtered source-code diff " +
    "(src/ and resources/), and a docs/README diff. Read them like a " +
    "reviewer: identify what actually changed in the code, infer user-" +
    "facing impact, and call out anything that requires user action."
  );
  sections.push("");
  sections.push("Use ONLY the data below. Do not invent features.");
  sections.push("");
  if (ctx.changelog) {
    sections.push("## CHANGELOG entries for this release");
    sections.push("```markdown");
    sections.push(truncate(ctx.changelog, CAPS.changelog));
    sections.push("```");
    sections.push("");
  }
  if (ctx.gitLog) {
    sections.push("## Commit messages between releases");
    sections.push("```");
    sections.push(truncate(ctx.gitLog, CAPS.gitLog));
    sections.push("```");
    sections.push("");
  }
  if (ctx.diffStat) {
    sections.push("## Diff stat (overview of every changed file)");
    sections.push("```");
    sections.push(truncate(ctx.diffStat, CAPS.diffStat));
    sections.push("```");
    sections.push("");
  }
  if (ctx.pkgDiff) {
    sections.push("## package.json diff (dependency / version / contributions changes)");
    sections.push("```diff");
    sections.push(truncate(ctx.pkgDiff, CAPS.pkgDiff));
    sections.push("```");
    sections.push("");
  }
  if (ctx.manifestDiff) {
    sections.push(
      "## host-tools-manifest.json diff (SDK / toolchain version changes)"
    );
    sections.push("```diff");
    sections.push(truncate(ctx.manifestDiff, CAPS.manifestDiff));
    sections.push("```");
    sections.push("");
  }
  if (ctx.docsDiff) {
    sections.push("## README / docs diff");
    sections.push("```diff");
    sections.push(truncate(ctx.docsDiff, CAPS.docsDiff));
    sections.push("```");
    sections.push("");
  }
  if (ctx.sourceDiff) {
    sections.push(
      "## Source diff (src/ and resources/, excluding bundled output, lockfiles, and binary assets)"
    );
    sections.push("```diff");
    sections.push(truncate(ctx.sourceDiff, CAPS.sourceDiff));
    sections.push("```");
    sections.push("");
  }
  sections.push("## Output format");
  sections.push(
    "Produce GitHub-flavored Markdown using EXACTLY the structure below. " +
    "Omit any section that has no real content (do not write 'None'). " +
    "Be specific: cite the actual setting / command / API names from the diffs."
  );
  sections.push("");
  sections.push("```");
  sections.push(`## What's New in ${ctx.curr}`);
  sections.push("");
  sections.push("### Highlights");
  sections.push(
    "- Bullet list of the most user-visible improvements (new features, major UX changes, performance wins). 3-7 bullets max."
  );
  sections.push("");
  sections.push("### Bug Fixes");
  sections.push("- Bullet list of notable fixes. Group small fixes if helpful.");
  sections.push("");
  sections.push("### Under the Hood");
  sections.push(
    "- Optional. Internal refactors, dependency bumps, or test/CI changes worth mentioning to power users. Skip if uninteresting."
  );
  sections.push("");
  sections.push("### Breaking Changes & Migration");
  sections.push(
    "- ONLY include this section when there are real migrations: setting renames, " +
    "config-file format changes, required SDK / toolchain version bumps, removed commands, etc."
  );
  sections.push(
    "- For each item, give one line describing the change AND one line telling the user what to do."
  );
  sections.push("```");
  sections.push("");
  sections.push(
    "Do not add a preamble, do not repeat the version header twice, do not link to PRs (the GitHub auto-generated notes already do that). Be terse and concrete."
  );
  return sections.join("\n");
}

async function callModel({ token, model, prompt }) {
  const body = {
    model,
    messages: [
      {
        role: "system",
        content:
          "You are a senior code reviewer. You read diffs carefully, identify " +
          "user-facing impact, and write concise, accurate release notes for " +
          "developer tools. You never invent features or claim changes that " +
          "are not visible in the diff.",
      },
      { role: "user", content: prompt },
    ],
    temperature: 0.2,
    max_tokens: 4000,
  };

  const res = await fetch(MODELS_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/vnd.github+json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `GitHub Models API returned ${res.status} ${res.statusText}: ${text}`
    );
  }

  const json = await res.json();
  const content = json && json.choices && json.choices[0] &&
    json.choices[0].message && json.choices[0].message.content;
  if (!content) {
    throw new Error("Model response did not contain message content");
  }
  return content.trim();
}

function fallbackNotes(ctx) {
  const lines = [];
  lines.push(`## What's New in ${ctx.curr}`);
  lines.push("");
  lines.push(
    `_AI-generated summary unavailable; showing CHANGELOG entries between ${ctx.prev} and ${ctx.curr}._`
  );
  lines.push("");
  if (ctx.changelog) {
    lines.push(ctx.changelog.trim());
  } else {
    lines.push("(No CHANGELOG content available.)");
  }
  return lines.join("\n");
}

async function main() {
  const token = process.env.GITHUB_TOKEN;
  const prev = process.env.PREV_VERSION;
  const curr = process.env.CURR_VERSION;
  const outputFile = process.env.OUTPUT_FILE || "release-notes.md";
  const model = process.env.MODEL || DEFAULT_MODEL;
  const contextDir = process.env.CONTEXT_DIR || DEFAULT_CONTEXT_DIR;

  if (!token) {
    console.error("GITHUB_TOKEN is required");
    process.exit(1);
  }
  if (!prev || !curr) {
    console.error("PREV_VERSION and CURR_VERSION are required");
    process.exit(1);
  }

  const ctx = {
    prev,
    curr,
    changelog: process.env.CHANGELOG_CONTENT || "",
    gitLog: readContextFile(contextDir, "git-log.txt"),
    diffStat: readContextFile(contextDir, "diff-stat.txt"),
    pkgDiff: readContextFile(contextDir, "package-json.diff"),
    manifestDiff: readContextFile(contextDir, "host-tools-manifest.diff"),
    sourceDiff: readContextFile(contextDir, "source.diff"),
    docsDiff: readContextFile(contextDir, "docs.diff"),
  };

  console.error(`Context sizes (chars):`);
  for (const [k, v] of Object.entries(ctx)) {
    if (k === "prev" || k === "curr") {
      continue;
    }
    console.error(`  ${k.padEnd(14)} ${(v || "").length}`);
  }

  const prompt = buildPrompt(ctx);
  console.error(`Prompt size: ${prompt.length} chars`);

  let notes;
  try {
    console.error(`Calling model ${model} for release notes...`);
    notes = await callModel({ token, model, prompt });
    console.error("Model call succeeded.");
  } catch (err) {
    console.error(`Model call failed: ${err.message}`);
    console.error("Writing fallback notes from CHANGELOG.");
    notes = fallbackNotes(ctx);
  }

  fs.writeFileSync(outputFile, notes + "\n", "utf8");
  console.error(`Wrote ${notes.length} characters to ${outputFile}`);
  // Also echo to stdout for easy log inspection.
  process.stdout.write(notes + "\n");
}

main().catch((err) => {
  console.error(`Unexpected error: ${err.stack || err.message}`);
  process.exit(1);
});
