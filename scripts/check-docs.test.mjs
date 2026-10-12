import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { canonical, requiredRoot } from "./check-docs.mjs";

const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
const checker = resolve(scriptsDirectory, "check-docs.mjs");

// Disposable repositories live under the inherited task TMPDIR and are removed
// after the run. GIT_CEILING_DIRECTORIES keeps git discovery inside that tree so
// the failure scenario cannot resolve a parent repository or any private file.
const temporaryRoot = mkdtempSync(join(tmpdir(), "check-docs-test-"));
const gitEnvironment = {
  ...process.env,
  GIT_CEILING_DIRECTORIES: temporaryRoot,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
};

after(() => {
  rmSync(temporaryRoot, { recursive: true, force: true });
});

function write(root, relativePath, content) {
  const absolutePath = join(root, relativePath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content);
}

function git(root, args) {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    env: gitEnvironment,
  });
  assert.equal(
    result.status,
    0,
    `git ${args.join(" ")} failed: ${result.stderr}`,
  );
  return result;
}

function createRepository(name, { initializeGit = true } = {}) {
  const root = join(temporaryRoot, name);
  mkdirSync(root, { recursive: true });
  for (const relativePath of requiredRoot) {
    write(root, relativePath, `# ${relativePath}\n\nProject contract stub.\n`);
  }
  write(
    root,
    "AGENTS.md",
    "Route through docs/README.md, PLANS.md, REVIEW.md and docs/documentation.md.\n",
  );
  const routed = canonical.filter((entry) => entry !== "docs/README.md");
  write(
    root,
    "docs/README.md",
    `# Project knowledge map\n\n${routed
      .map((entry) => `- [${entry.replace(/^docs\//, "")}](${entry.replace(/^docs\//, "")})`)
      .join("\n")}\n`,
  );
  for (const entry of canonical) {
    if (entry === "docs/README.md") continue;
    write(root, entry, `# ${entry}\n\nCanonical stub.\n`);
  }
  if (initializeGit) {
    git(root, ["init", "-q"]);
  }
  return root;
}

function runChecker(root) {
  return spawnSync(process.execPath, [checker], {
    cwd: root,
    encoding: "utf8",
    env: gitEnvironment,
  });
}

describe("documentation check", () => {
  it("passes when ignored nested local output carries a bogus link", () => {
    const root = createRepository("ignored-output");
    write(root, ".gitignore", "output/\nscratch/\n");
    write(
      root,
      "output/run-notes/local.md",
      "# Local output\n\n[stale](definitely-not-tracked.md)\n",
    );
    write(
      root,
      "scratch/untracked.md",
      "# Untracked\n\n[stale](also-not-tracked.md)\n",
    );
    git(root, ["add", ".gitignore", "AGENTS.md", "PLANS.md", "REVIEW.md", "docs"]);
    git(root, [
      "-c", "user.name=Docs Test",
      "-c", "user.email=docs-test@example.invalid",
      "commit", "-q", "--no-gpg-sign", "-m", "baseline",
    ]);

    const result = runChecker(root);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Documentation check passed/);
  });

  it("fails on a staged new Markdown file with a real broken link", () => {
    const root = createRepository("staged-broken-link");
    git(root, ["add", "."]);
    git(root, [
      "-c", "user.name=Docs Test",
      "-c", "user.email=docs-test@example.invalid",
      "commit", "-q", "--no-gpg-sign", "-m", "baseline",
    ]);
    write(
      root,
      "docs/staged-note.md",
      "# Staged note\n\nSee [missing](missing-target.md).\n",
    );
    git(root, ["add", "docs/staged-note.md"]);

    const result = runChecker(root);
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /Broken local link in docs\/staged-note\.md: missing-target\.md/,
    );
  });

  it("passes for tracked and committed Markdown with correct links", () => {
    const root = createRepository("correct-links");
    write(
      root,
      "docs/linked-note.md",
      "# Linked note\n\nSee [principles](principles.md) and [self](#linked-note) and [web](https://example.invalid).\n",
    );
    git(root, ["add", "."]);
    git(root, [
      "-c", "user.name=Docs Test",
      "-c", "user.email=docs-test@example.invalid",
      "commit", "-q", "--no-gpg-sign", "-m", "baseline",
    ]);

    const result = runChecker(root);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Documentation check passed/);
  });

  it("fails when required canonical knowledge is missing after an intentional removal", () => {
    const root = createRepository("missing-canonical");
    git(root, ["add", "."]);
    git(root, [
      "-c", "user.name=Docs Test",
      "-c", "user.email=docs-test@example.invalid",
      "commit", "-q", "--no-gpg-sign", "-m", "baseline",
    ]);
    git(root, ["rm", "-q", "docs/principles.md"]);

    const result = runChecker(root);
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /Missing required knowledge file: docs\/principles\.md/,
    );
  });

  it("fails when a removed tracked file is still a live link target", () => {
    const root = createRepository("removed-link-target");
    write(
      root,
      "docs/retiring.md",
      "# Retiring\n\nHistorical note.\n",
    );
    write(
      root,
      "docs/linked-note.md",
      "# Linked note\n\nSee [retiring](retiring.md).\n",
    );
    git(root, ["add", "."]);
    git(root, [
      "-c", "user.name=Docs Test",
      "-c", "user.email=docs-test@example.invalid",
      "commit", "-q", "--no-gpg-sign", "-m", "baseline",
    ]);
    git(root, ["rm", "-q", "docs/retiring.md"]);

    const result = runChecker(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Broken local link in docs\/linked-note\.md/);
  });

  it("reports a Git inventory failure explicitly without a filesystem fallback", () => {
    const root = createRepository("no-git-inventory", { initializeGit: false });
    write(
      root,
      "docs/broken.md",
      "# Broken\n\n[stale](never-tracked.md)\n",
    );

    const result = runChecker(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Cannot inventory Markdown with git/);
    assert.match(result.stderr, /refusing any filesystem-scan fallback/);
    assert.doesNotMatch(result.stderr, /Broken local link/);
  });
});
