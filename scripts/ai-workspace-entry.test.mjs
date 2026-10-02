import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

function fixture(t, args, denied = false) {
  const dir = mkdtempSync(join(tmpdir(), "capir-entry-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bin = join(dir, "capir");
  const log = join(dir, "calls.jsonl");
  writeFileSync(bin, `#!/usr/bin/env node
import {appendFileSync} from 'node:fs';
appendFileSync(process.env.ENTRY_CALL_LOG, JSON.stringify(process.argv.slice(2))+'\\n');
console.log(JSON.stringify({schema_version:'capir.v1',command:process.argv.slice(2,4).join(' ')}));
process.exit(process.env.ENTRY_DENIED==='1'?4:0);
`, { mode: 0o700 });
  const result = spawnSync(process.execPath, ["scripts/ai-workspace-entry.mjs", ...args], {
    encoding: "utf8", env: { ...process.env, CAPIR_BIN: bin, ENTRY_CALL_LOG: log, ENTRY_DENIED: denied ? "1" : "0" },
  });
  let calls = [];
  try { calls = readFileSync(log, "utf8").trim().split("\n").map(JSON.parse); } catch {}
  return { ...result, calls };
}

test("requires explicit environment before dispatch", t => {
  const result = fixture(t, []);
  assert.equal(result.status, 2); assert.deepEqual(result.calls, []);
});
test("valid authorization enters replay without another login", t => {
  const result = fixture(t, ["--env", "proof"]);
  assert.equal(result.status, 0);
  assert.deepEqual(result.calls, [["auth", "status", "--env", "proof"], ["sandbox", "start", "--scenario", "daily", "--model-policy", "replay", "--open", "web", "--env", "proof"]]);
});
test("expired authorization stops before any allocation or login", t => {
  const result = fixture(t, ["--env", "proof"], true);
  assert.equal(result.status, 4); assert.equal(result.calls.length, 1);
});
test("check-only is read-only", t => {
  const result = fixture(t, ["--env", "proof", "--check-only"]);
  assert.equal(result.status, 0); assert.equal(result.calls.length, 1);
});
test("existing sandbox is reopened without creating another", t => {
  const id = "10000000-0000-4000-8000-000000000001";
  const result = fixture(t, ["--env", "proof", "--sandbox", id]);
  assert.equal(result.status, 0);
  assert.deepEqual(result.calls[1], ["sandbox", "status", id, "--open", "web", "--env", "proof"]);
});
test("ambiguous or invalid arguments dispatch nothing", t => {
  for (const args of [["--env", "a", "--env", "b"], ["--env", "a", "--sandbox", "bad"], ["--env", "a", "--unknown"], ["--env", "a", "--check-only", "--sandbox", "10000000-0000-4000-8000-000000000001"]]) {
    const result = fixture(t, args); assert.equal(result.status, 2); assert.deepEqual(result.calls, []);
  }
});

test("installed capir accepts the real entry command shapes", { skip: !process.env.CAPIR_CONTRACT_BIN }, t => {
  const dir = mkdtempSync(join(tmpdir(), "capir-contract-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const id = "10000000-0000-4000-8000-000000000001";
  for (const args of [["auth", "status"], ["sandbox", "start", "--scenario", "daily", "--model-policy", "replay", "--open", "web"], ["sandbox", "status", id, "--open", "web"], ["sandbox", "stop", id]]) {
    const result = spawnSync(process.env.CAPIR_CONTRACT_BIN, [...args, "--env", "contract-smoke"], {
      encoding: "utf8", timeout: 15_000, env: { ...process.env, CAPIR_CONFIG_DIR: dir },
    });
    assert.equal(result.status, 2);
    assert.equal(JSON.parse(result.stdout).error.code, "CAPIR_ENVIRONMENT_MISSING");
  }
});
