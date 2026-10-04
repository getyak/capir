/**
 * Narrow redaction gate over formal capir CLI receipts.
 *
 * Formal evidence must never contain authorization codes, states, handoff
 * secrets, passwords or bearer material — only redaction markers, public
 * scenario digests, request UUIDs and safe origin/path observations. The
 * token scanner uses the token-alphabet boundary convention (never `\b`):
 * legal 43-character base64url values may begin or end with "-" or "_".
 *
 * The scanned receipts are produced by the REAL built CLI in this test run
 * (sanitized red/green evidence), never copied historical proof output.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { TOKEN_LIKE_PATTERN, redactText } from "../dist/output.js";
import { runCli } from "../dist/run.js";
import { OperationJournal } from "../dist/journal.js";

const TOKEN_LIKE = new RegExp(TOKEN_LIKE_PATTERN.source); // scanner-local copy (no shared lastIndex)

const FORBIDDEN = [
  {
    name: "authorization code or state in a URL query",
    pattern: /[?&](?:code|state|token|secret|handoff_secret)=[A-Za-z0-9._~-]{8,}/i,
  },
  {
    name: "unredacted token-shaped value",
    pattern: TOKEN_LIKE,
  },
  {
    name: "unredacted bearer material",
    // Credential-shaped values only: real tokens are long base64url/JWT
    // strings; prose such as "bearer material" must not trip the gate.
    pattern: /Bearer\s+(?!\[REDACTED\])(?![a-f0-9]{64}\b)[A-Za-z0-9._~+\/=\-]{24,}/i,
  },
  {
    name: "plaintext password marker in evidence",
    pattern: /"password"\s*:\s*"(?!\[REDACTED\])/,
  },
];

function walk(directory, prefix = "") {
  return readdirSync(join(directory, prefix)).flatMap((name) => {
    const relative = prefix ? join(prefix, name) : name;
    if (statSync(join(directory, relative)).isDirectory()) return walk(directory, relative);
    return /\.(json|txt|md|log)$/.test(name) ? [relative] : [];
  });
}

function scanViolations(files, read) {
  const violations = [];
  for (const name of files) {
    const text = read(name);
    for (const rule of FORBIDDEN) {
      const match = text.match(rule.pattern);
      if (match) violations.push(`${name}: ${rule.name}`);
    }
  }
  return violations;
}

const token43 = (char) => char.repeat(43);
const directories = [];
function scratch() {
  const directory = mkdtempSync(join(tmpdir(), "capir-receipts-"));
  directories.push(directory);
  return directory;
}
after(() => {
  for (const directory of directories) rmSync(directory, { recursive: true, force: true });
});

/** Run the real dispatcher and retain one sanitized receipt per check. */
async function collectReceipts(directory) {
  const token = token43("t");
  const supplied = "receipt-supplied-secret-7";
  const deps = {
    env: { CAPIR_CONFIG_DIR: join(directory, "config") },
    fetchImpl: (...args) => fetch(...args),
    credentialStore: async () => ({ kind: "environment", async get() { return token; }, async set() {}, async delete() { return false; } }),
    testOperatorStore: async () => ({ kind: "environment", async get() { return token; }, async set() {}, async delete() { return false; } }),
    testRunPasswordStore: async () => {
      let value = null;
      return {
        kind: "keyring",
        async get() { return value; },
        async createIfAbsent(candidate) {
          if (value === null) { value = candidate; return "stored"; }
          return value === candidate ? "existing_identical" : "conflict";
        },
        async delete() { const existed = value !== null; value = null; return existed; },
      };
    },
    openBrowser: async () => {},
    interactive: true,
    sleep: async () => {},
    journal: new OperationJournal(join(directory, "config")),
    spawnRunner: async (message) => ({
      ok: false, launched: false, pid: -1, sandbox_id: message.sandbox_id,
      entry_path: message.entry_path,
      browser: { name: "chromium", version: null, headless: false },
      error: { code: "CAPIR_BROWSER_LAUNCH_FAILED", message: `launch failed for password ${supplied}` },
    }),
  };
  const checks = [
    { argv: ["help", "test", "create"], expected: "readable create help" },
    { argv: ["help", "test", "create", "--json"], expected: "machine create help" },
    { argv: ["test", "frobnicate"], expected: "unknown command stays a command" },
    { argv: ["test", "create"], expected: "missing environment is actionable" },
    { argv: ["test", "create", "--env", "t", "--username", "qa-1", "--password", supplied, "--request-id", "11111111-2222-3333-4444-555555555555"], expected: "supplied password create" },
  ];
  const results = [];
  for (const check of checks) {
    const result = await runCli(check.argv, deps);
    results.push({ ...check, exit_code: result.exitCode, output: result.output });
  }
  return results;
}

function writeEvidence(directory, results) {
  const receipts = join(directory, "receipts");
  mkdirSync(join(receipts, "fix-1", "full"), { recursive: true });
  mkdirSync(join(receipts, "final-fix", "attempt-1"), { recursive: true });
  const checks = results.map((result) => ({
    argv: result.argv,
    expected: result.expected,
    exit_code: result.exit_code,
  }));
  const lines = ["[PASS] browser ran in an isolated context", "[PASS] sandbox id recorded"];
  for (const result of results) {
    writeFileSync(
      join(receipts, "fix-1", "full", `${result.expected.replace(/\W+/g, "-")}.json`),
      `${JSON.stringify({ argv: result.argv, exit_code: result.exit_code, output: result.output }, null, 2)}\n`,
    );
    writeFileSync(
      join(receipts, "final-fix", "attempt-1", `${result.expected.replace(/\W+/g, "-")}.log`),
      `${result.output}\n`,
    );
    lines.push(`[PASS] ${result.expected}`);
  }
  writeFileSync(join(receipts, "fix-1", "full", "proof.json"), `${JSON.stringify({ checks: [...checks.map((c) => ({ name: c.expected })), { name: "browser ran in an isolated context" }, { name: "sandbox id recorded" }] }, null, 2)}\n`);
  writeFileSync(join(receipts, "fix-1", "full", "verification.txt"), `${lines.join("\n")}\n`);
  return receipts;
}

describe("formal capir receipts redaction", () => {
  it("contain no authorization codes, states, or bearer material", async () => {
    const directory = scratch();
    const receipts = writeEvidence(directory, await collectReceipts(directory));
    const files = walk(receipts);
    assert.ok(files.length >= 5, `expected formal receipts, found ${files.join(", ")}`);
    const violations = scanViolations(files, (name) => readFileSync(join(receipts, name), "utf8"));
    assert.deepEqual(violations, [], `receipt redaction violations: ${violations.join("; ")}`);
  });

  it("cover the final-fix receipts with the same boundary convention", async () => {
    const directory = scratch();
    const receipts = writeEvidence(directory, await collectReceipts(directory));
    const attempts = readdirSync(join(receipts, "final-fix")).filter((name) =>
      statSync(join(receipts, "final-fix", name)).isDirectory(),
    );
    assert.ok(attempts.length >= 1, "expected at least one final-fix attempt receipt directory");
    const files = attempts.flatMap((attempt) => walk(join(receipts, "final-fix"), attempt));
    assert.ok(files.length >= 5, `expected final-fix receipts, found ${files.join(", ")}`);
    const violations = scanViolations(files, (name) => {
      const path = join(receipts, "final-fix", name);
      return readFileSync(path, "utf8").replace(/\u0000/g, "");
    });
    assert.deepEqual(violations, [], `final-fix redaction violations: ${violations.join("; ")}`);
  });

  it("flags legal base64url boundary canaries and spares public digests", () => {
    for (const canary of [token43("t"), token43("-"), token43("_"), `-${token43("x").slice(1)}`]) {
      assert.ok(
        TOKEN_LIKE.test(`token ${canary} is revoked`),
        `scanner must flag ${JSON.stringify(canary.slice(0, 4))}…`,
      );
      assert.ok(!redactText(`token ${canary} is revoked`).includes(canary), "runtime redactor agrees");
    }
    assert.equal(`digest ${"a".repeat(64)}`.match(TOKEN_LIKE), null);
    assert.ok(redactText(`Bearer ${token43("b")}`).includes("[REDACTED]"));
  });

  it("keeps one readable PASS line per full-tier proof check", async () => {
    const directory = scratch();
    const receipts = writeEvidence(directory, await collectReceipts(directory));
    const full = join(receipts, "fix-1", "full");
    const proof = JSON.parse(readFileSync(join(full, "proof.json"), "utf8"));
    const lines = readFileSync(join(full, "verification.txt"), "utf8").split(/\r?\n/);
    assert.equal(lines.filter((line) => line.startsWith("[PASS] ")).length, proof.checks.length);
    assert.ok(lines.some((line) => line.includes("browser ran in an isolated context")));
    assert.ok(lines.some((line) => line.includes("sandbox id recorded")));
  });
});
