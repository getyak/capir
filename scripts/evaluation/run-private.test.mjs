import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const realWrapper = resolve(dirname(fileURLToPath(import.meta.url)), "run-private.mjs");
const temporary = [];
after(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});

function workspace() {
  const root = mkdtempSync(join(tmpdir(), "run-private-"));
  temporary.push(root);
  return root;
}

function makeProductRoot(root) {
  const product = join(root, "product");
  mkdirSync(join(product, "scripts", "evaluation"), { recursive: true });
  writeFileSync(join(product, "scripts", "evaluation", "run-private.mjs"), readFileSync(realWrapper));
  writeFileSync(join(product, "tracked.txt"), "committed content\n");
  writeFileSync(join(product, ".gitignore"), "ignored-output/\n");
  const git = (args) => spawnSync("git", args, {
    cwd: product,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "run-private test",
      GIT_AUTHOR_EMAIL: "run-private@example.invalid",
      GIT_COMMITTER_NAME: "run-private test",
      GIT_COMMITTER_EMAIL: "run-private@example.invalid",
    },
  });
  assert.equal(git(["init", "-q"]).status, 0);
  assert.equal(git(["add", "-A"]).status, 0);
  assert.equal(git(["commit", "-qm", "baseline"]).status, 0);
  return {
    product: realpathSync(product),
    wrapper: join(product, "scripts", "evaluation", "run-private.mjs"),
    head: git(["rev-parse", "HEAD"]).stdout.trim(),
  };
}

function makeEvalRepo(root, options = {}) {
  const evalRepo = options.location ? join(root, options.location) : join(root, "capir-evals");
  mkdirSync(join(evalRepo, "scripts"), { recursive: true });
  if (options.marker !== false) {
    writeFileSync(
      join(evalRepo, ".capir-evaluation.json"),
      JSON.stringify({ schemaVersion: options.markerSchema ?? "capir-private-evaluation.v1", repository: options.markerRepository ?? "getyak/capir-evals" }),
    );
  }
  if (options.runner !== false) {
    const body = options.runnerBody
      ?? 'import { writeFileSync } from "node:fs"; writeFileSync(process.env.RECORD_FILE, JSON.stringify(process.argv.slice(2)));';
    writeFileSync(join(evalRepo, "scripts", "run.mjs"), `${body}\n`);
  }
  return evalRepo;
}

function run(wrapper, alias, args, environment) {
  return spawnSync(process.execPath, [wrapper, ...(alias === undefined ? [] : [alias]), ...args], {
    encoding: "utf8",
    env: { ...process.env, ...environment },
  });
}

describe("private evaluation wrapper", () => {
  it("fails clearly when CAPIR_EVAL_REPO is missing", () => {
    const { wrapper } = makeProductRoot(workspace());
    const result = run(wrapper, "eval:core", [], { CAPIR_EVAL_REPO: "" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /CAPIR_EVAL_REPO is not set/);
    assert.match(result.stderr, /never skipped silently/);
  });

  it("rejects relative, missing, and non-repository directories", () => {
    const root = workspace();
    const { wrapper } = makeProductRoot(root);

    const relative = run(wrapper, "eval:core", [], { CAPIR_EVAL_REPO: "relative/capir-evals" });
    assert.notEqual(relative.status, 0);
    assert.match(relative.stderr, /must be an absolute directory path/);

    const missing = run(wrapper, "eval:core", [], { CAPIR_EVAL_REPO: join(root, "does-not-exist") });
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /does not exist/);

    const withoutMarker = makeEvalRepo(root, { marker: false });
    const noMarker = run(wrapper, "eval:core", [], { CAPIR_EVAL_REPO: withoutMarker });
    assert.notEqual(noMarker.status, 0);
    assert.match(noMarker.stderr, /marker \.capir-evaluation\.json is missing/);

    const wrongMarker = makeEvalRepo(root, { location: "wrong-marker", markerRepository: "something-else" });
    const badMarker = run(wrapper, "eval:core", [], { CAPIR_EVAL_REPO: wrongMarker });
    assert.notEqual(badMarker.status, 0);
    assert.match(badMarker.stderr, /does not identify "getyak\/capir-evals"/);

    const withoutRunner = makeEvalRepo(root, { location: "no-runner", runner: false });
    const noRunner = run(wrapper, "eval:core", [], { CAPIR_EVAL_REPO: withoutRunner });
    assert.notEqual(noRunner.status, 0);
    assert.match(noRunner.stderr, /scripts\/run\.mjs is missing/);
  });

  it("rejects an evaluation repository inside the product checkout, including symlink escapes", () => {
    const root = workspace();
    const { product, wrapper } = makeProductRoot(root);

    const nested = makeEvalRepo(root, { location: "product/nested-evals" });
    const insideResult = run(wrapper, "eval:core", [], { CAPIR_EVAL_REPO: nested });
    assert.notEqual(insideResult.status, 0);
    assert.match(insideResult.stderr, /must live outside the product checkout/);

    const external = makeEvalRepo(root, { location: "external-evals" });
    const link = join(product, "linked-evals");
    symlinkSync(external, link);
    const linkedResult = run(wrapper, "eval:core", [], { CAPIR_EVAL_REPO: link });
    assert.notEqual(linkedResult.status, 0);
    assert.match(linkedResult.stderr, /must live outside the product checkout/);
  });

  it("rejects uncommitted tracked source with an actionable message but ignores unrelated outputs", () => {
    const root = workspace();
    const { product, wrapper } = makeProductRoot(root);
    const evalRepo = makeEvalRepo(root);

    writeFileSync(join(product, "tracked.txt"), "uncommitted change\n");
    const dirty = run(wrapper, "eval:core", [], { CAPIR_EVAL_REPO: evalRepo, RECORD_FILE: join(root, "dirty-record.json") });
    assert.notEqual(dirty.status, 0);
    assert.match(dirty.stderr, /uncommitted tracked changes/);
    assert.match(dirty.stderr, /commit or stash/i);
    assert.match(dirty.stderr, /tracked\.txt/);

    assert.equal(spawnSync("git", ["checkout", "--", "tracked.txt"], { cwd: product }).status, 0);
    mkdirSync(join(product, "ignored-output"), { recursive: true });
    writeFileSync(join(product, "ignored-output", "run.json"), "{}");
    writeFileSync(join(product, "untracked-notes.md"), "scratch\n");
    const record = join(root, "clean-record.json");
    const clean = run(wrapper, "eval:core", [], { CAPIR_EVAL_REPO: evalRepo, RECORD_FILE: record });
    assert.equal(clean.status, 0, clean.stderr);
    assert.ok(readFileSync(record, "utf8").length > 0);
  });

  it("forwards source, revision, command and arguments and propagates the runner exit status", () => {
    const root = workspace();
    const { product, wrapper, head } = makeProductRoot(root);
    const evalRepo = makeEvalRepo(root);
    const record = join(root, "record.json");
    const forwarded = run(wrapper, "eval:case", ["--suite", "p0", "extra"], {
      CAPIR_EVAL_REPO: evalRepo,
      RECORD_FILE: record,
    });
    assert.equal(forwarded.status, 0, forwarded.stderr);
    assert.deepEqual(JSON.parse(readFileSync(record, "utf8")), [
      "--source", product,
      "--revision", head,
      "--command", "eval:case",
      "--", "--suite", "p0", "extra",
    ]);
    assert.match(head, /^[a-f0-9]{40}$/);

    const failing = makeEvalRepo(root, {
      location: "failing-evals",
      runnerBody: 'process.exitCode = 7; console.error("private runner failed");',
    });
    const failed = run(wrapper, "eval:p0", [], { CAPIR_EVAL_REPO: failing });
    assert.equal(failed.status, 7);
    assert.match(failed.stderr, /private runner failed/);
  });

  it("rejects unknown command names and missing commands", () => {
    const root = workspace();
    const { wrapper } = makeProductRoot(root);
    const evalRepo = makeEvalRepo(root);
    const missing = run(wrapper, undefined, [], { CAPIR_EVAL_REPO: evalRepo });
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /no eval command given/);
    const wrongName = run(wrapper, "rm", ["-rf", "/"], { CAPIR_EVAL_REPO: evalRepo });
    assert.notEqual(wrongName.status, 0);
    assert.match(wrongName.stderr, /is not an eval:\* command name/);
  });
});
