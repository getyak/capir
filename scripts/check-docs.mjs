#!/usr/bin/env node
/**
 * Documentation knowledge-contract check.
 *
 * Markdown is inventoried through the Git index (`git ls-files`), never through
 * a recursive filesystem scan. That keeps ignored and untracked local output
 * (including private evaluation artifacts) out of the checked set, picks up
 * staged new documents, and fails closed when Git cannot answer: a Git
 * inventory failure is reported explicitly and never falls back to crawling
 * the working tree.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { trackedFiles } from "./check-repository-hygiene.mjs";

export const canonical = [
  "docs/README.md",
  "docs/principles.md",
  "docs/product.md",
  "docs/architecture.md",
  "docs/agent-system.md",
  "docs/capture-to-action.md",
  "docs/design-system.md",
  "docs/delivery.md",
  "docs/integrations.md",
  "docs/documentation.md",
  "docs/codex-work-system.md",
];

export const requiredRoot = ["AGENTS.md", "PLANS.md", "REVIEW.md"];

const linkPattern = /!?\[[^\]]*\]\(([^)]+)\)/g;

/** Markdown inventory: tracked and staged files only (fail-closed via git). */
export function markdownInventory(root) {
  return trackedFiles(root).filter((path) => path.endsWith(".md"));
}

export function checkDocs(root = process.cwd()) {
  const errors = [];
  const fail = (message) => errors.push(message);

  for (const relativePath of [...requiredRoot, ...canonical]) {
    if (!existsSync(resolve(root, relativePath))) {
      fail(`Missing required knowledge file: ${relativePath}`);
    }
  }

  const knowledgeMapPath = resolve(root, "docs/README.md");
  const knowledgeMap = existsSync(knowledgeMapPath)
    ? readFileSync(knowledgeMapPath, "utf8")
    : "";

  for (const relativePath of canonical.filter(
    (entry) => entry !== "docs/README.md",
  )) {
    const localName = relativePath.replace(/^docs\//, "");
    if (!knowledgeMap.includes(`(${localName})`)) {
      fail(`Knowledge map does not route to canonical document: ${relativePath}`);
    }
  }

  for (const relativePath of canonical) {
    const absolutePath = resolve(root, relativePath);
    if (!existsSync(absolutePath)) continue;
    const content = readFileSync(absolutePath, "utf8");
    const lineCount = content.split(/\r?\n/).length;

    if (lineCount > 320) {
      fail(
        `Canonical document exceeds the 320-line context budget: ${relativePath} (${lineCount})`,
      );
    }

    const disallowedFence = content.match(
      /^```(?:json|jsonc|javascript|js|typescript|ts|tsx|swift|sql|toml|yaml|yml|bash|sh|shell)\s*$/im,
    );
    if (disallowedFence) {
      fail(
        `Implementation-level code fence belongs outside canonical docs: ${relativePath} (${disallowedFence[0]})`,
      );
    }

    if (/^(?:GET|POST|PUT|PATCH|DELETE)\s+\/\S+/m.test(content)) {
      fail(`Endpoint inventory belongs in executable references: ${relativePath}`);
    }
  }

  const agentsPath = resolve(root, "AGENTS.md");
  if (existsSync(agentsPath)) {
    const agents = readFileSync(agentsPath, "utf8");
    for (const requiredReference of [
      "docs/README.md",
      "PLANS.md",
      "REVIEW.md",
      "docs/documentation.md",
    ]) {
      if (!agents.includes(requiredReference)) {
        fail(`AGENTS.md must route to ${requiredReference}`);
      }
    }
  }

  let markdownFiles;
  try {
    markdownFiles = markdownInventory(root);
  } catch (error) {
    fail(
      `Cannot inventory Markdown with git: ${error instanceof Error ? error.message : String(error)}; refusing any filesystem-scan fallback`,
    );
    markdownFiles = [];
  }

  for (const relativePath of markdownFiles) {
    const absolutePath = resolve(root, relativePath);
    // Tracked documents intentionally removed from the worktree (staged
    // deletions already leave the Git index) are not scanned as link sources.
    // Required canonical files and live link targets are still enforced above
    // and below, so a removal cannot mask a broken reference.
    if (!existsSync(absolutePath)) continue;
    const content = readFileSync(absolutePath, "utf8");
    let match;

    while ((match = linkPattern.exec(content)) !== null) {
      let target = match[1].trim();
      if (
        !target ||
        target.startsWith("#") ||
        /^(?:https?:|mailto:|data:)/i.test(target)
      ) {
        continue;
      }

      if (target.startsWith("<") && target.endsWith(">")) {
        target = target.slice(1, -1);
      }

      target = target.split("#", 1)[0];
      try {
        target = decodeURIComponent(target);
      } catch {
        fail(`Invalid encoded link in ${relativePath}: ${target}`);
        continue;
      }

      const resolvedTarget = resolve(dirname(absolutePath), target);
      if (!existsSync(resolvedTarget)) {
        fail(`Broken local link in ${relativePath}: ${match[1]}`);
        continue;
      }

      if (
        extname(target) === "" &&
        statSync(resolvedTarget).isFile() &&
        !target.endsWith(".md")
      ) {
        fail(`Ambiguous extensionless file link in ${relativePath}: ${target}`);
      }
    }
  }

  return errors;
}

function main() {
  const errors = checkDocs(process.cwd());
  if (errors.length) {
    for (const error of errors) console.error(`ERROR ${error}`);
    console.error(`Documentation check failed with ${errors.length} error(s).`);
    process.exit(1);
  }
  console.log("Documentation check passed.");
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
