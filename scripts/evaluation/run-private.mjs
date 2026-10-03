#!/usr/bin/env node
/**
 * Thin forwarding wrapper for private evaluation runs (GET-134).
 *
 * Main keeps the `eval:*` alias commands, but the evaluation corpus and the
 * evaluation harness live in the private getyak/capir-evals repository. This
 * wrapper never clones that repository and never treats an unavailable
 * evaluation as a pass: every misconfiguration exits non-zero with an
 * actionable message.
 *
 * Contract:
 *   CAPIR_EVAL_REPO  absolute path to an existing capir-evals checkout that
 *                    contains the marker file .capir-evaluation.json
 *                    ({"schemaVersion": "capir-private-evaluation.v1", "repository": "getyak/capir-evals"}) and the runner entry
 *                    scripts/run.mjs
 *
 * Invocation forwarded to the private runner:
 *   node "$CAPIR_EVAL_REPO/scripts/run.mjs" \
 *     --source <product-root> --revision <git HEAD> --command <eval:alias> -- <args...>
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, basename, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const productRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const MARKER_FILE = ".capir-evaluation.json";
const MARKER_REPOSITORY = "getyak/capir-evals";
const MARKER_SCHEMA = "capir-private-evaluation.v1";
const RUNNER_ENTRY = "scripts/run.mjs";
const ALIAS_PATTERN = /^eval:[a-z0-9][a-z0-9:-]*$/;

function fail(message) {
  console.error(`private evaluation unavailable: ${message}`);
  console.error(
    "Evaluation is never skipped silently. Configure the private capir-evals checkout (see evals/README.md) and retry.",
  );
  process.exit(1);
}

function inside(parent, child) {
  const relative = child.startsWith(parent) ? child.slice(parent.length) : null;
  return relative === "" || (relative !== null && relative.startsWith(sep));
}

const [alias, ...forwarded] = process.argv.slice(2);
if (!alias) {
  fail("no eval command given; usage: node scripts/evaluation/run-private.mjs <eval:alias> [args...]");
}
if (!ALIAS_PATTERN.test(alias)) {
  fail(`"${alias}" is not an eval:* command name`);
}

const configured = process.env.CAPIR_EVAL_REPO;
if (!configured) {
  fail("CAPIR_EVAL_REPO is not set; point it at an absolute capir-evals checkout directory");
}
if (!isAbsolute(configured)) {
  fail(`CAPIR_EVAL_REPO must be an absolute directory path (received "${configured}")`);
}
if (!existsSync(configured)) {
  fail(`CAPIR_EVAL_REPO does not exist: "${configured}"`);
}
let evalRepo;
try {
  evalRepo = realpathSync(configured);
} catch {
  fail(`CAPIR_EVAL_REPO cannot be resolved: "${configured}"`);
}
const productRepo = realpathSync(productRoot);
// Both the configured location and its resolved target must live outside the
// product checkout; a symlink cannot smuggle the evaluation repository into
// (or out of) the audited product tree.
const configuredEntry = resolve(configured);
const evaluationCandidates = [evalRepo];
try {
  evaluationCandidates.push(join(realpathSync(dirname(configuredEntry)), basename(configuredEntry)));
} catch {
  // Unresolvable ancestors are rejected by the earlier existence checks.
}
for (const product of [productRoot, productRepo]) {
  for (const evaluation of evaluationCandidates) {
    if (inside(product, evaluation) || inside(evaluation, product)) {
      fail(
        `CAPIR_EVAL_REPO must live outside the product checkout (product "${product}", evaluation repository "${evaluation}")`,
      );
    }
  }
}

let stat;
try {
  stat = statSync(evalRepo);
} catch {
  fail(`CAPIR_EVAL_REPO cannot be read: "${evalRepo}"`);
}
if (!stat.isDirectory()) {
  fail(`CAPIR_EVAL_REPO must be a directory: "${evalRepo}"`);
}

const markerPath = resolve(evalRepo, MARKER_FILE);
if (!existsSync(markerPath)) {
  fail(
    `evaluation repository marker ${MARKER_FILE} is missing in "${evalRepo}"; this is not a capir-evals checkout`,
  );
}
let marker;
try {
  marker = JSON.parse(readFileSync(markerPath, "utf8"));
} catch {
  fail(`evaluation repository marker ${MARKER_FILE} is not valid JSON in "${evalRepo}"`);
}
if (marker?.repository !== MARKER_REPOSITORY || marker?.schemaVersion !== MARKER_SCHEMA) {
  fail(
    `evaluation repository marker ${MARKER_FILE} does not identify "${MARKER_REPOSITORY}" in "${evalRepo}"`,
  );
}
const runnerEntry = resolve(evalRepo, RUNNER_ENTRY);
if (!existsSync(runnerEntry)) {
  fail(`private runner entry ${RUNNER_ENTRY} is missing in "${evalRepo}"`);
}

const status = spawnSync("git", ["status", "--porcelain", "--untracked-files=no"], {
  cwd: productRepo,
  encoding: "utf8",
});
if (status.error || status.status !== 0) {
  fail(
    `the product source root is not a usable git checkout ("${productRepo}"); private runs pin an exact committed revision`,
  );
}
const dirty = status.stdout.split("\n").filter((line) => line.trim());
if (dirty.length > 0) {
  const shown = dirty.slice(0, 20).map((line) => `  ${line.trim()}`).join("\n");
  fail(
    `the product source checkout has uncommitted tracked changes; commit or stash them before private evaluation so the run can pin an exact revision:\n${shown}`,
  );
}
const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: productRepo, encoding: "utf8" });
const revision = head.status === 0 ? head.stdout.trim() : "";
if (!/^[a-f0-9]{40}$/.test(revision)) {
  fail(`cannot determine a 40-hex git HEAD revision in "${productRepo}"`);
}

const result = spawnSync(
  process.execPath,
  [runnerEntry, "--source", productRepo, "--revision", revision, "--command", alias, "--", ...forwarded],
  { stdio: "inherit" },
);
if (result.error) {
  fail(`private runner could not be started: ${result.error.message}`);
}
if (result.signal) {
  console.error(`private evaluation runner terminated by signal ${result.signal}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
