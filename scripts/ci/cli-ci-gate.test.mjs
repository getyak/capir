import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";

const workflow = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
const required = workflow.split("  required:\n")[1];
const body = required.split("      - name: Enforce required job results\n        run: |\n")[1]
  .split("\n").map((line) => line.replace(/^          /, "")).join("\n");

test("the aggregate waits for CLI quality and reads that job's result", () => {
  const dependencies = required.match(/needs: \[([^\]]+)\]/)[1].split(",").map((value) => value.trim());
  assert.ok(dependencies.includes("cli"));
  assert.match(required, /CLI_RESULT: \$\{\{ needs\.cli\.result \}\}/);
});

test("the actual aggregate denies failed, cancelled, missing or skipped runtime CLI checks", () => {
  for (const [docsOnly, cliResult, expected] of [
    ["false", "success", 0], ["false", "failure", 1],
    ["false", "cancelled", 1], ["false", "skipped", 1], ["false", "", 1],
    ["true", "skipped", 0], ["true", "success", 0], ["true", "failure", 1],
  ]) {
    const result = spawnSync("bash", ["-e", "-c", body], {
      encoding: "utf8",
      env: {
        PATH: process.env.PATH, CHANGES_RESULT: "success", REPOSITORY_RESULT: "success",
        WEB_RESULT: "success", BACKEND_RESULT: "success", PHASE_ONE_RESULT: "success",
        IOS_REQUIRED: "false", IOS_RESULT: "skipped", MACOS_HYBRID_REQUIRED: "false",
        MACOS_HYBRID_RESULT: "skipped", DOCS_ONLY: docsOnly, CLI_RESULT: cliResult,
      },
    });
    assert.equal(result.status, expected, `${docsOnly}/${cliResult || "missing"}`);
  }
});
