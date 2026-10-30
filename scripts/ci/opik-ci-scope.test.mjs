import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const detector = fileURLToPath(new URL("./has-opik-backport-changes.py", import.meta.url));

function fixture(run) {
  const root = mkdtempSync(join(process.env.OPIK_GIT_FIXTURE_ROOT || tmpdir(), "opik-scope-"));
  function git(...args) {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  }
  function commit(path) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), `${path}\n`);
    git("add", "--all");
    git("-c", "user.name=Scope fixture", "-c", "user.email=scope@example.invalid", "commit", "-qm", "fixture");
    return git("rev-parse", "HEAD");
  }
  function detect(base, head, event = "pull_request") {
    const result = spawnSync("python3", [detector, base, head], {
      cwd: root, encoding: "utf8", env: { PATH: process.env.PATH, EVENT_NAME: event },
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  }
  try {
    git("init", "-q");
    const base = commit("README.md");
    run({ root, git, commit, detect, base });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("Opik source, pin, runner and gate edits require the actual Java regression", () => {
  for (const path of [
    "deploy/opik/compose.json", "deploy/opik/backport/test.patch",
    "scripts/prompts/test-opik-backport.py", "scripts/ci/has-opik-backport-changes.py",
    "scripts/prompts/test_opik_backport.py",
    ".github/workflows/ci.yml",
  ]) {
    fixture(({ base, commit, detect }) => assert.equal(detect(base, commit(path)), "true", path));
  }
});

test("unrelated Web or documentation changes do not start the Java build", () => {
  for (const path of ["docs/example.md", "apps/web/example.tsx", "docs/\ndeploy/opik/example.patch"]) {
    fixture(({ base, commit, detect }) => assert.equal(detect(base, commit(path)), "false", path));
  }
});

test("renaming a backport away still checks the removed source", () => {
  fixture(({ git, commit, detect }) => {
    const base = commit("deploy/opik/backport/old.patch");
    git("mv", "deploy/opik/backport/old.patch", "removed.patch");
    git("-c", "user.name=Scope fixture", "-c", "user.email=scope@example.invalid", "commit", "-qm", "rename");
    assert.equal(detect(base, git("rev-parse", "HEAD")), "true");
  });
});

test("manual, missing-reference and empty-diff runs fail closed to Java coverage", () => {
  fixture(({ base, commit, detect }) => {
    const head = commit("docs/example.md");
    assert.equal(detect(base, head, "workflow_dispatch"), "true");
    assert.equal(detect("", head), "true");
    assert.equal(detect(base, "invalid"), "true");
    assert.equal(detect(base, base), "true");
  });
});
