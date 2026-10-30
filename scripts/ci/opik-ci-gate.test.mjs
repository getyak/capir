import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";

const workflow = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
const required = workflow.split("  required:\n")[1];
const body = required.split("      - name: Enforce required job results\n        run: |\n")[1]
  .split("\n").map((line) => line.replace(/^          /, "")).join("\n");

function runGate(requiredScope, result, docsOnly = "false") {
  return spawnSync("bash", ["-e", "-c", body], {
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      CHANGES_RESULT: "success", REPOSITORY_RESULT: "success",
      WEB_RESULT: "success", CLI_RESULT: "success", BACKEND_RESULT: "success",
      PHASE_ONE_RESULT: "success", IOS_REQUIRED: "false", IOS_RESULT: "skipped",
      MACOS_HYBRID_REQUIRED: "false", MACOS_HYBRID_RESULT: "skipped",
      DOCS_ONLY: docsOnly,
      OPIK_BACKPORT_REQUIRED: requiredScope, OPIK_BACKPORT_RESULT: result,
    },
  }).status;
}

test("the actual aggregate refuses missing or unsuccessful required Opik regressions", () => {
  for (const docsOnly of ["false", "true"]) {
    assert.equal(runGate("true", "success", docsOnly), 0);
    for (const result of ["failure", "cancelled", "skipped", ""]) {
      assert.equal(runGate("true", result, docsOnly), 1, `${docsOnly}/${result || "missing"}`);
    }
  }
});

test("an unrelated change can skip Opik but cannot ignore an actual failed job", () => {
  assert.equal(runGate("false", "skipped"), 0);
  assert.equal(runGate("false", "success"), 0);
  for (const result of ["failure", "cancelled", ""]) {
    assert.equal(runGate("false", result), 1, result || "missing");
  }
});

test("missing or malformed Opik scope cannot silently bypass the aggregate", () => {
  for (const requiredScope of ["", "unknown", "TRUE"]) {
    assert.equal(runGate(requiredScope, "skipped"), 1, requiredScope || "missing");
  }
});
