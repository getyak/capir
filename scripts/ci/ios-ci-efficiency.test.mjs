import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const classifier = fileURLToPath(new URL("./has-ios-changes.sh", import.meta.url));
const run = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" }).trim();

test("simulator CI ignores release-only inputs and docs but detects runtime removal", () => {
  const cwd = mkdtempSync(join(tmpdir(), "ios-ci-scope-"));
  const commit = (path, contents) => {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), contents);
    run(cwd, "add", ".");
    run(cwd, "commit", "-m", path);
    return run(cwd, "rev-parse", "HEAD");
  };
  const classify = (base, head, mode = "--ci-files") =>
    execFileSync(classifier, [base, head, mode], { cwd, encoding: "utf8" }).trim();
  try {
    run(cwd, "init", "--initial-branch=main");
    run(cwd, "config", "user.name", "CI test");
    run(cwd, "config", "user.email", "ci@example.invalid");
    let base = commit("README.md", "initial");
    for (const [path, expected] of [
      ["apps/ios/README.md", "false"],
      ["scripts/ios/notes.md", "false"],
      ["fastlane/Fastfile", "false"],
      ["Gemfile.lock", "false"],
      [".github/workflows/release-ios.yml", "false"],
      ["scripts/ci/wait-for-testflight-build.mjs", "false"],
      ["apps/web/src/page.tsx", "false"],
      ["apps/ios/Sources/App.swift", "true"],
      ["apps/ios/Resources/Localizable.xcstrings", "true"],
      ["apps/ios/project.yml", "true"],
      ["scripts/ios/check.sh", "true"],
      [".github/workflows/ci.yml", "true"],
      ["scripts/ci/ios-ci-efficiency.test.mjs", "true"],
    ]) {
      const head = commit(path, "fixture\n");
      assert.equal(classify(base, head), expected, path);
      base = head;
    }
    // Target-branch-only iOS changes must not inflate a web-only PR.
    run(cwd, "branch", "feature");
    const target = commit("apps/ios/Sources/New.swift", "struct New {}\n");
    run(cwd, "checkout", "feature");
    const head = commit("apps/web/src/page.tsx", "web change\n");
    assert.equal(classify(target, head, "--pr-files"), "false");
    run(cwd, "mv", "apps/ios/Sources/App.swift", "apps/ios/Removed.md");
    run(cwd, "commit", "-m", "Remove runtime source");
    assert.equal(classify(head, "HEAD"), "true");
    assert.equal(classify("missing", "HEAD"), "true");
    // Publication classification keeps the signing and release boundary.
    const releaseBase = run(cwd, "rev-parse", "HEAD");
    const releaseHead = commit("fastlane/Fastfile", "updated signing\n");
    assert.equal(classify(releaseBase, releaseHead, "--release-files"), "true");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});


test("required gate rejects skipped or failed iOS when its scope requires execution", () => {
  const workflow = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
  const body = workflow.split("      - name: Enforce required job results\n        run: |\n")[1]
    .split("\n").map((line) => line.replace(/^          /, "")).join("\n");
  for (const [required, result, passes] of [
    ["true", "success", true], ["true", "skipped", false],
    ["true", "failure", false], ["true", "cancelled", false],
    ["false", "skipped", true], ["false", "failure", false],
  ]) {
    const outcome = spawnSync("bash", ["-e", "-c", body], {
      encoding: "utf8",
      env: { ...process.env, CHANGES_RESULT: "success", REPOSITORY_RESULT: "success",
        WEB_RESULT: "success", CLI_RESULT: "success", BACKEND_RESULT: "success", PHASE_ONE_RESULT: "success",
        DOCS_ONLY: "false", MACOS_HYBRID_REQUIRED: "false", MACOS_HYBRID_RESULT: "skipped",
        IOS_REQUIRED: required, IOS_RESULT: result },
    });
    assert.equal(outcome.status === 0, passes, `${required}/${result}: ${outcome.stderr}`);
  }
});
