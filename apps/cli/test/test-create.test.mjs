/**
 * `capir test create|status|stop` contract through the built CLI and the real
 * dispatcher: generated-password entropy and defaults, chosen credentials,
 * stdin exclusivity, duration/preset parsing, model isolation, exact request
 * replay, keyring conflict, stdout/browser failure recovery, honest missing
 * credential errors and secret redaction.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { CLI_PATH, runCliBin, writeEnvironment } from "./helpers.mjs";
import { runCli } from "../dist/run.js";
import { OperationJournal } from "../dist/journal.js";
import {
  RUN_PASSWORD_KEYRING_SERVICE,
  runPasswordAccount,
} from "../dist/testCredentials.js";

const OPERATOR_TOKEN = "operator-" + "k".repeat(43);
const WEB_ORIGIN = "https://web.example.test";

const directories = [];
function scratch() {
  const directory = mkdtempSync(join(tmpdir(), "capir-test-create-"));
  directories.push(directory);
  return directory;
}
after(() => {
  for (const directory of directories) rmSync(directory, { recursive: true, force: true });
});

function runFixture(overrides = {}) {
  const id = overrides.id ?? randomUUID();
  return {
    id,
    request_id: overrides.request_id ?? randomUUID(),
    account_id: randomUUID(),
    user_id: randomUUID(),
    username: overrides.username ?? `qa-${id.slice(0, 8)}`,
    email: overrides.email ?? `qa-${id.slice(0, 8)}@lab.invalid`,
    preset: overrides.preset ?? "daily",
    preset_version: "1",
    preset_digest: "a".repeat(64),
    counts: overrides.counts ??
      (overrides.preset === "empty"
        ? { contacts: 0, observations: 0, tasks: 0 }
        : { contacts: 12, observations: 30, tasks: 4 }),
    state: overrides.state ?? "ready",
    expires_at: overrides.expires_at ?? "2026-10-04T16:00:00.000Z",
    cleanup_error: null,
    login_url: `${WEB_ORIGIN}/capir/test-entry?run=${id}`,
    ...overrides.extra,
  };
}

/**
 * Replay-aware stub of the Task 1 provisioning routes over real HTTP.
 * Exact-request replay verifies the password identity server-side; a
 * different password on the same request id is a semantic conflict.
 */
async function startTestBackend(options = {}) {
  const calls = [];
  const runs = new Map(); // request_id -> { run, password }
  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      let body;
      try {
        body = raw ? JSON.parse(raw) : undefined;
      } catch {
        body = undefined;
      }
      const record = { method: request.method, path: request.url, headers: request.headers, body };
      calls.push(record);
      const creates = () => calls.filter((c) => c.method === "POST" && c.path === "/v1/capir/tests").length;
      const send = (status, json) => {
        if (options.dropFirstCreate && record.method === "POST" && record.path === "/v1/capir/tests" && creates() === 1) {
          request.socket.destroy();
          return;
        }
        response.writeHead(status, { "content-type": "application/json" });
        response.end(JSON.stringify(json));
      };
      const registered = options.operatorTokens ?? [OPERATOR_TOKEN];
      if (!registered.includes(request.headers.authorization?.slice("Bearer ".length) ?? "") && record.path !== "/v1/capir/capabilities") {
        return send(401, {
          error: { code: "CAPIR_TEST_PROVISIONING_REQUIRED", message: "A test-provisioning credential is required.", request_id: randomUUID() },
        });
      }
      if (record.method === "GET" && record.path === "/v1/capir/capabilities") {
        return send(200, {
          schema_version: "capir-test.v1",
          enabled: true,
          presets: [
            { id: "daily", version: "1", digest: "a".repeat(64) },
            { id: "empty", version: "1", digest: "b".repeat(64) },
          ],
          duration_hours: [1, 4, 24],
          max_active_runs: 3,
          web_handoff_available: true,
          supported: ["test.create", "test.status", "test.stop", "test.handoffs"],
          unsupported: ["auth", "sandbox", "live", "record"],
        });
      }
      if (record.method === "POST" && record.path === "/v1/capir/tests") {
        const existing = runs.get(body.request_id);
        if (existing) {
          if (existing.password !== body.password) {
            return send(409, {
              error: {
                code: "CAPIR_TEST_CONFLICT",
                message: `Request ${body.request_id} already exists with a different credential identity${options.echoSecret ? ` (password ${body.password})` : ""}.`,
                request_id: randomUUID(),
              },
            });
          }
          return send(200, { schema_version: "capir-test.v1", run: existing.run });
        }
        const run = runFixture({
          request_id: body.request_id,
          preset: body.preset,
          username: body.username,
          ...(body.username ? { email: body.username.includes("@") ? body.username : `${body.username}@lab.invalid` } : {}),
          expires_at: new Date(Date.now() + body.duration_hours * 3600_000).toISOString(),
        });
        runs.set(body.request_id, { run, password: body.password });
        return send(200, { schema_version: "capir-test.v1", run });
      }
      const stop = record.path.match(/^\/v1\/capir\/tests\/([^/]+)\/stop$/);
      if (record.method === "POST" && stop) {
        if (options.dropFirstStop && calls.filter((c) => c.method === "POST" && c.path.endsWith("/stop")).length === 1) {
          request.socket.destroy();
          return;
        }
        for (const entry of runs.values()) {
          if (entry.run.id === stop[1]) {
            entry.run = { ...entry.run, state: options.stopState ?? "deleted", cleanup_error: options.cleanupError ?? null };
            return send(200, { schema_version: "capir-test.v1", run: entry.run });
          }
        }
        return send(404, { error: { code: "CAPIR_TEST_NOT_FOUND", message: "Unknown run.", request_id: randomUUID() } });
      }
      const handoff = record.path.match(/^\/v1\/capir\/tests\/([^/]+)\/handoffs$/);
      if (record.method === "POST" && handoff) {
        if (options.handoffEcho) {
          const owner = [...runs.values()].find((entry) => entry.run.id === handoff[1]);
          return send(403, {
            error: {
              code: "CAPIR_TEST_ORIGIN_DENIED",
              message: `This provisioning principal is denied for password ${owner?.password} with operator ${OPERATOR_TOKEN}.`,
              request_id: randomUUID(),
            },
          });
        }
        return send(200, {
          schema_version: "capir-test.v1",
          handoff_id: randomUUID(),
          handoff_secret: "h".repeat(43),
          expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
          entry_path: "/capir/test-entry",
          run_id: handoff[1],
        });
      }
      const status = record.path.match(/^\/v1\/capir\/tests\/([^/]+)$/);
      if (record.method === "GET" && status) {
        for (const entry of runs.values()) {
          if (entry.run.id === status[1]) return send(200, { schema_version: "capir-test.v1", run: entry.run });
        }
        return send(404, { error: { code: "CAPIR_TEST_NOT_FOUND", message: "Unknown run.", request_id: randomUUID() } });
      }
      return send(404, { error: { code: "NO_ROUTE", message: "no route", request_id: randomUUID() } });
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    origin: `http://127.0.0.1:${port}`,
    calls,
    runs,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function prepared(directory, backendOrigin, name = "t") {
  writeEnvironment(join(directory, "config"), name, backendOrigin, WEB_ORIGIN);
  return {
    CAPIR_CONFIG_DIR: join(directory, "config"),
    CAPIR_TEST_OPERATOR_TOKEN: OPERATOR_TOKEN,
    FAKE_KEYRING_FILE: join(directory, "keyring.json"),
    NODE_OPTIONS: `--import ${join(import.meta.dirname, "fake-keyring-preload.mjs")}`,
  };
}

function keyringFile(directory) {
  return join(directory, "keyring.json");
}

function keyringEntries(directory) {
  const file = keyringFile(directory);
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
}

function runKeyringName(directory, requestId) {
  const raw = JSON.parse(readFileSync(join(directory, "config", "environments.json"), "utf8"));
  const entry = raw.environments.t;
  return {
    service: RUN_PASSWORD_KEYRING_SERVICE,
    username: runPasswordAccount({
      operatorCredential: OPERATOR_TOKEN,
      backendOrigin: entry.backend_origin,
      webOrigin: entry.web_origin,
      requestId,
    }),
  };
}

describe("test create argument contract", () => {
  it("requires an explicit named environment before any dispatch", async (t) => {
    const directory = scratch();
    const backend = await startTestBackend();
    t.after(() => backend.close());
    const env = prepared(directory, backend.origin);
    const result = await runCliBin(["test", "create"], env);
    await backend.close();
    assert.equal(result.code, 2);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.ok, false);
    assert.equal(envelope.error.code, "CAPIR_ENVIRONMENT_REQUIRED");
    assert.equal(backend.calls.length, 0);
    assert.equal(existsSync(join(directory, "config", "operations.json")), false);
  });

  it("canonicalizes --expires-in 1d to 24 and rejects unsupported lifetimes before dispatch", async (t) => {
    const directory = scratch();
    const backend = await startTestBackend();
    t.after(() => backend.close());
    const env = prepared(directory, backend.origin);
    for (const [value, hours] of [["1h", 1], ["4h", 4], ["24h", 24], ["1d", 24]]) {
      const result = await runCliBin(["test", "create", "--env", "t", "--expires-in", value, "--request-id", randomUUID()], env);
      assert.equal(result.code, 0, result.stdout);
      const request = backend.calls.filter((c) => c.method === "POST" && c.path === "/v1/capir/tests").at(-1);
      assert.equal(request.body.duration_hours, hours);
    }
    const before = backend.calls.length;
    for (const value of ["2h", "30m", "1w", "0h", "4H"]) {
      const result = await runCliBin(["test", "create", "--env", "t", "--expires-in", value], env);
      assert.equal(result.code, 2, result.stdout);
      assert.equal(JSON.parse(result.stdout).error.code, "CAPIR_CLI_INVALID_ARGUMENT");
    }
    assert.equal(backend.calls.length, before, "rejected lifetimes never dispatch");
    await backend.close();
  });

  it("sends preset daily by default and empty on request; unknown presets never dispatch", async (t) => {
    const directory = scratch();
    const backend = await startTestBackend();
    t.after(() => backend.close());
    const env = prepared(directory, backend.origin);
    const daily = await runCliBin(["test", "create", "--env", "t", "--request-id", randomUUID()], env);
    assert.equal(daily.code, 0, daily.stdout);
    const empty = await runCliBin(["test", "create", "--env", "t", "--preset", "empty", "--request-id", randomUUID()], env);
    assert.equal(empty.code, 0, empty.stdout);
    const creates = backend.calls.filter((c) => c.method === "POST" && c.path === "/v1/capir/tests");
    assert.equal(creates[0].body.preset, "daily");
    assert.equal(creates[1].body.preset, "empty");
    assert.deepEqual(JSON.parse(empty.stdout).run.counts, { contacts: 0, observations: 0, tasks: 0 });
    const before = backend.calls.length;
    const bad = await runCliBin(["test", "create", "--env", "t", "--preset", "weekly"], env);
    assert.equal(bad.code, 2);
    assert.equal(backend.calls.length, before);
    await backend.close();
  });

  it("accepts only one of --password and --password-stdin without reading stdin", async (t) => {
    const directory = scratch();
    const backend = await startTestBackend();
    t.after(() => backend.close());
    const env = prepared(directory, backend.origin);
    const child = spawn(process.execPath, [CLI_PATH, "test", "create", "--env", "t", "--password", "chosen-supplied-secret-9", "--password-stdin"], {
      env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stdin.write("stdin-secret-value\n");
    const code = await new Promise((resolve) => child.on("close", resolve));
    assert.equal(code, 2, stdout);
    const envelope = JSON.parse(stdout);
    assert.equal(envelope.error.code, "CAPIR_CLI_INVALID_ARGUMENT");
    assert.ok(!stdout.includes("chosen-supplied-secret-9"), "parsing errors never echo the supplied password");
    assert.ok(!stdout.includes("stdin-secret-value"));
    assert.equal(backend.calls.length, 0, "a rejected create never dispatches");
    await backend.close();
  });

  it("reads the supplied password from stdin without echoing it", async (t) => {
    const directory = scratch();
    const backend = await startTestBackend();
    t.after(() => backend.close());
    const env = prepared(directory, backend.origin);
    const child = spawn(process.execPath, [CLI_PATH, "test", "create", "--env", "t", "--username", "qa-stdin", "--password-stdin", "--request-id", randomUUID()], {
      env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stdin.end("stdin-supplied-secret-7\n");
    const code = await new Promise((resolve) => child.on("close", resolve));
    assert.equal(code, 0, stdout);
    const create = backend.calls.find((c) => c.method === "POST" && c.path === "/v1/capir/tests");
    assert.equal(create.body.password, "stdin-supplied-secret-7");
    assert.equal(create.body.username, "qa-stdin");
    assert.ok(!stdout.includes("stdin-supplied-secret-7"), "supplied passwords are never echoed");
    await backend.close();
  });
});

describe("test create credential projection", () => {
  it("generates >=128 bits of cryptographic entropy and reveals it only in the projection", async (t) => {
    const directory = scratch();
    const backend = await startTestBackend();
    t.after(() => backend.close());
    const env = prepared(directory, backend.origin);
    const first = await runCliBin(["test", "create", "--env", "t", "--request-id", randomUUID()], env);
    const second = await runCliBin(["test", "create", "--env", "t", "--request-id", randomUUID()], env);
    await backend.close();
    assert.equal(first.code, 0, first.stdout);
    assert.equal(second.code, 0, second.stdout);
    const a = JSON.parse(first.stdout);
    const b = JSON.parse(second.stdout);
    for (const envelope of [a, b]) {
      assert.equal(envelope.command, "test create");
      assert.equal(envelope.run.state, "ready");
      assert.deepEqual(envelope.run.counts, { contacts: 12, observations: 30, tasks: 4 });
      assert.equal(envelope.verified.counts_match, true);
      assert.ok(envelope.generated_credential, "a generated create projects its credential");
      const password = envelope.generated_credential.password;
      assert.match(password, /^[A-Za-z0-9_-]+$/);
      assert.ok(Buffer.from(password, "base64url").length >= 16, ">=128 bits of entropy");
      assert.ok(password.length >= 22);
      assert.ok(typeof envelope.generated_credential.username === "string");
      assert.ok(!("password" in envelope.run), "run projections carry no password");
      assert.equal(envelope.next.status, `capir test status ${envelope.run.id} --env t`);
      assert.equal(envelope.next.stop, `capir test stop ${envelope.run.id} --env t`);
    }
    assert.notEqual(a.generated_credential.password, b.generated_credential.password);
    // The password appears exactly once in the whole stdout (the projection).
    const occurrences = first.stdout.split(a.generated_credential.password).length - 1;
    assert.equal(occurrences, 1, "the generated password is disclosed exactly once");
  });

  it("never echoes a chosen password and suppresses it inside untrusted server errors", async (t) => {
    const directory = scratch();
    const backend = await startTestBackend({ echoSecret: true });
    t.after(() => backend.close());
    t.after(() => backend.close());
    const env = prepared(directory, backend.origin);
    const chosen = "chosen-supplied-secret-9"; // deliberately not token-shaped
    const requestId = randomUUID();
    const ok = await runCliBin([
      "test", "create", "--env", "t", "--username", "qa-1", "--password", chosen, "--request-id", requestId,
    ], env);
    assert.equal(ok.code, 0, ok.stdout);
    assert.ok(!ok.stdout.includes(chosen), "supplied passwords never appear in output");
    const conflict = await runCliBin([
      "test", "create", "--env", "t", "--username", "qa-1", "--password", "different-supplied-secret-8", "--request-id", requestId,
    ], env);
    assert.equal(conflict.code, 2, conflict.stdout);
    assert.ok(!conflict.stdout.includes("different-supplied-secret-8"), "untrusted server text echoing a chosen password is suppressed");
    assert.ok(conflict.stdout.includes("[REDACTED]") || conflict.stdout.includes("credential identity"));
    await backend.close();
  });

  it("does not echo the generated password in human output beyond the dedicated line", async (t) => {
    const directory = scratch();
    const backend = await startTestBackend();
    t.after(() => backend.close());
    const env = prepared(directory, backend.origin);
    const result = await runCliBin(["test", "create", "--env", "t", "--human", "--request-id", randomUUID()], env);
    await backend.close();
    assert.equal(result.code, 0, result.stdout);
    const lines = result.stdout.split("\n");
    const passwordLines = lines.filter((line) => line.includes("password"));
    assert.equal(passwordLines.length, 1, "exactly one human credential line");
    assert.ok(passwordLines[0].startsWith("password: "));
    assert.ok(result.stdout.includes("run id: "));
    assert.ok(result.stdout.includes("capir test stop "));
  });
});

describe("test command isolation from model prompts", () => {
  it("treats unknown test subcommands and leading flags as commands, never prompts", async (t) => {
    const directory = scratch();
    const backend = await startTestBackend();
    t.after(() => backend.close());
    const env = prepared(directory, backend.origin);
    for (const argv of [
      ["test", "frobnicate"],
      ["test", "frobnicate", "--env", "t"],
      ["--human", "test", "frobnicate"],
    ]) {
      const result = await runCliBin(argv, env);
      assert.equal(result.code, 2, result.stdout);
      assert.ok(result.stdout.includes("CAPIR_CLI_UNKNOWN_COMMAND"), result.stdout);
    }
    assert.equal(backend.calls.length, 0, "no request was dispatched for unknown commands");
    await backend.close();
  });

  it("dispatches test create even with leading flags", async (t) => {
    const directory = scratch();
    const backend = await startTestBackend();
    t.after(() => backend.close());
    const env = prepared(directory, backend.origin);
    const result = await runCliBin(["--human", "test", "create", "--env", "t", "--request-id", randomUUID()], env);
    await backend.close();
    assert.equal(result.code, 0, result.stdout);
    assert.ok(result.stdout.includes("ok test create"));
    assert.equal(backend.calls.filter((c) => c.path === "/v1/capir/tests").length, 1);
  });
});

describe("exact recovery and conflict boundaries", () => {
  it("reports incomplete cleanup honestly and retains same-operation recovery", async (t) => {
    const directory = scratch();
    const backend = await startTestBackend({ stopState: "deleting", cleanupError: "media_cleanup_failed" });
    t.after(() => backend.close());
    const env = prepared(directory, backend.origin);
    const created = JSON.parse((await runCliBin(["test", "create", "--env", "t"], env)).stdout);
    for (const human of [false, true]) {
      const requestId = randomUUID();
      const result = await runCliBin(["test", "stop", created.run.id, "--env", "t", "--request-id", requestId, ...(human ? ["--human"] : [])], env);
      assert.equal(result.code, 3, result.stdout);
      assert.ok(result.stdout.includes("media_cleanup_failed"));
      assert.ok(!result.stdout.includes(created.generated_credential.password));
      if (!human) {
        const envelope = JSON.parse(result.stdout);
        assert.equal(envelope.ok, false);
        assert.equal(envelope.run.state, "deleting");
        assert.equal(envelope.error.recoverable_request_id, requestId);
      }
    }
    assert.deepEqual(keyringEntries(directory), {}, "revocation still prunes this operation's local credential");
  });

  it("response_loss_reuses_password_and_request", async (t) => {
    const directory = scratch();
    const backend = await startTestBackend({ dropFirstCreate: true });
    t.after(() => backend.close());
    const env = prepared(directory, backend.origin);
    const requestId = randomUUID();
    const lost = await runCliBin(["test", "create", "--env", "t", "--request-id", requestId], env);
    assert.equal(lost.code, 3, lost.stdout);
    const lostEnvelope = JSON.parse(lost.stdout);
    assert.equal(lostEnvelope.error.code, "CAPIR_TEST_TRANSPORT_AMBIGUOUS");
    assert.equal(lostEnvelope.error.recoverable_request_id, requestId);
    const stored = Object.values(keyringEntries(directory));
    assert.equal(stored.length, 1, "the generated password is persisted before sending");

    const recovered = await runCliBin(["test", "create", "--env", "t", "--request-id", requestId], env);
    await backend.close();
    assert.equal(recovered.code, 0, recovered.stdout);
    const envelope = JSON.parse(recovered.stdout);
    assert.equal(envelope.resumed, true);
    assert.equal(envelope.generated_credential.password, stored[0], "the original password is recovered, never rotated");
    const creates = backend.calls.filter((c) => c.method === "POST" && c.path === "/v1/capir/tests");
    assert.equal(creates.length, 2);
    assert.equal(creates[0].body.request_id, creates[1].body.request_id);
    assert.equal(creates[0].body.password, creates[1].body.password);
    assert.equal(Object.keys(keyringEntries(directory)).length, 1);
  });

  it("keyring_conflict_no_overwrite", async (t) => {
    const directory = scratch();
    const backend = await startTestBackend();
    t.after(() => backend.close());
    const env = prepared(directory, backend.origin);
    const requestId = randomUUID();
    // Another operation already owns this request namespace's run credential.
    const { service, username } = runKeyringName(directory, requestId);
    mkdirSync(directory, { recursive: true });
    writeFileSync(keyringFile(directory), JSON.stringify({ [`${service}\n${username}`]: "another-operations-password" }, null, 2));
    const result = await runCliBin(["test", "create", "--env", "t", "--request-id", requestId], env);
    await backend.close();
    assert.equal(result.code, 3, result.stdout);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.error.code, "CAPIR_TEST_KEYRING_CONFLICT");
    assert.equal(backend.calls.filter((c) => c.method === "POST" && c.path.startsWith("/v1/capir/tests")).length, 0,
      "a keyring conflict is resolved before any allocation or handoff");
    assert.deepEqual(Object.values(keyringEntries(directory)), ["another-operations-password"], "the conflicting item is never overwritten");
    assert.ok(!result.stdout.includes("another-operations-password"));
  });

  it("stdout_failure_keeps_recovery", async (t) => {
    const directory = scratch();
    const backend = await startTestBackend();
    t.after(() => backend.close());
    const env = prepared(directory, backend.origin);
    const requestId = randomUUID();
    await new Promise((resolve) => {
      const child = spawn(process.execPath, [CLI_PATH, "test", "create", "--env", "t", "--request-id", requestId], {
        env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env },
        stdio: ["ignore", "pipe", "ignore"],
      });
      child.stdout.on("data", () => {});
      child.stdout.destroy(); // the delivered output is lost to EPIPE
      child.on("close", resolve);
    });
    const stored = Object.values(keyringEntries(directory));
    assert.equal(stored.length, 1, "the ready run keeps its recoverable credential after output loss");
    const recovered = await runCliBin(["test", "create", "--env", "t", "--request-id", requestId], env);
    await backend.close();
    assert.equal(recovered.code, 0, recovered.stdout);
    const envelope = JSON.parse(recovered.stdout);
    assert.equal(envelope.resumed, true);
    assert.equal(envelope.generated_credential.password, stored[0]);
    assert.equal(backend.calls.filter((c) => c.path === "/v1/capir/tests").length, 2, "recovery replays the same allocation");
  });

  it("missing run credential is an honest error and never allocates or rotates", async (t) => {
    const directory = scratch();
    const backend = await startTestBackend();
    t.after(() => backend.close());
    const env = prepared(directory, backend.origin);
    const requestId = randomUUID();
    const first = await runCliBin(["test", "create", "--env", "t", "--request-id", requestId], env);
    assert.equal(first.code, 0, first.stdout);
    writeFileSync(keyringFile(directory), "{}"); // the local item is lost
    const replay = await runCliBin(["test", "create", "--env", "t", "--request-id", requestId], env);
    await backend.close();
    assert.equal(replay.code, 3, replay.stdout);
    const envelope = JSON.parse(replay.stdout);
    assert.equal(envelope.error.code, "CAPIR_TEST_CREDENTIAL_MISSING");
    assert.equal(backend.calls.filter((c) => c.path === "/v1/capir/tests").length, 1, "no second allocation is attempted");
    assert.ok(!("generated_credential" in envelope), "a missing item never fabricates a credential");
  });

  it("status and stop read the run without revealing credentials and stop prunes the item", async (t) => {
    const directory = scratch();
    const backend = await startTestBackend();
    t.after(() => backend.close());
    const env = prepared(directory, backend.origin);
    const created = JSON.parse((await runCliBin(["test", "create", "--env", "t", "--request-id", randomUUID()], env)).stdout);
    const password = created.generated_credential.password;
    const status = await runCliBin(["test", "status", created.run.id, "--env", "t"], env);
    assert.equal(status.code, 0, status.stdout);
    assert.ok(!status.stdout.includes(password), "status never reveals a password");
    assert.equal(JSON.parse(status.stdout).read_only, true);
    const stopped = await runCliBin(["test", "stop", created.run.id, "--env", "t"], env);
    await backend.close();
    assert.equal(stopped.code, 0, stopped.stdout);
    assert.ok(!stopped.stdout.includes(password));
    assert.equal(JSON.parse(stopped.stdout).run.state, "deleted");
    assert.deepEqual(keyringEntries(directory), {}, "stop removes the local run credential");
  });
});

/** In-process dispatcher dependencies with injected operator/run stores. */
function inProcessDeps(directory, backendOrigin, extras = {}) {
  writeEnvironment(join(directory, "config"), "t", backendOrigin, WEB_ORIGIN);
  const runPasswords = new Map();
  return {
    env: {
      CAPIR_CONFIG_DIR: join(directory, "config"),
      CAPIR_TEST_OPERATOR_TOKEN: OPERATOR_TOKEN,
    },
    fetchImpl: (...args) => fetch(...args),
    credentialStore: async () => ({ kind: "environment", async get() { return OPERATOR_TOKEN; }, async set() {}, async delete() { return false; } }),
    testOperatorStore: async () => ({ kind: "environment", async get() { return OPERATOR_TOKEN; }, async set() {}, async delete() { return false; } }),
    testRunPasswordStore: async () => ({
      kind: "keyring",
      async get() { return runPasswords.get("item") ?? null; },
      async createIfAbsent(value) {
        const existing = runPasswords.get("item");
        if (existing === undefined) { runPasswords.set("item", value); return "stored"; }
        return existing === value ? "existing_identical" : "conflict";
      },
      async delete() {
        const existed = runPasswords.delete("item");
        return existed;
      },
    }),
    openBrowser: async () => {},
    interactive: true,
    sleep: async () => {},
    journal: new OperationJournal(join(directory, "config")),
    ...extras,
  };
}

describe("browser readiness is separate from creation", () => {
  it("browser_failure_keeps_ready_run", async (t) => {
    const directory = scratch();
    const backend = await startTestBackend();
    t.after(() => backend.close());
    const deps = inProcessDeps(directory, backend.origin, {
      spawnRunner: async () => ({
        ok: false,
        launched: false,
        pid: -1,
        sandbox_id: "unused",
        entry_path: "/capir/test-entry",
        browser: { name: "chromium", version: null, headless: false },
        error: { code: "CAPIR_BROWSER_LAUNCH_FAILED", message: "Chromium could not launch." },
      }),
    });
    const requestId = randomUUID();
    const result = await runCli(["test", "create", "--env", "t", "--open", "web", "--request-id", requestId], deps);
    assert.equal(result.exitCode, 3, result.output);
    const envelope = JSON.parse(result.output);
    assert.equal(envelope.ok, false);
    assert.ok(envelope.run, "the recoverable ready run is preserved");
    assert.equal(envelope.run.state, "ready");
    assert.ok(envelope.browser, "the browser failure is reported separately");
    assert.ok(envelope.generated_credential, "an otherwise successful generated credential is not suppressed");
    assert.equal(envelope.error.recoverable_request_id, requestId, "recovery resumes the CREATE request id");
    assert.ok(envelope.client_state.handoff_request_id, "the one-use handoff id is a separate field");
    const replay = await runCli(["test", "create", "--env", "t", "--request-id", requestId], deps);
    await backend.close();
    assert.equal(replay.exitCode, 0, replay.output);
    assert.equal(JSON.parse(replay.output).resumed, true);
    assert.equal(backend.runs.size, 1, "browser failure never allocates a second run");
  });

  it("hands the one-use secret to the owned runner only, never into output", async (t) => {
    const directory = scratch();
    const backend = await startTestBackend();
    t.after(() => backend.close());
    const launches = [];
    const deps = inProcessDeps(directory, backend.origin, {
      spawnRunner: async (message) => {
        launches.push(message);
        return {
          ok: true,
          launched: true,
          pid: 4242,
          sandbox_id: message.sandbox_id,
          entry_path: message.entry_path,
          browser: { name: "chromium", version: "123", headless: false },
          verification: {
            banner_state: "active",
            demo_expiry: "2026-10-04T12:30:00.000Z",
            dataset_state: "ready",
            dataset_counts: { contacts: 12, observations: 30, tasks: 4 },
            settled: true,
            settled_empty: false,
            preset_expectation: "daily",
            passed: true,
            observations: ["handoff secret in an observation hhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhh"],
            custom_untrusted: "handoff secret in a custom field hhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhh",
          },
        };
      },
    });
    const result = await runCli(["test", "create", "--env", "t", "--open", "web", "--preset", "daily", "--request-id", randomUUID()], deps);
    await backend.close();
    assert.equal(result.exitCode, 0, result.output);
    assert.equal(launches.length, 1);
    assert.equal(launches[0].handoff_secret, "h".repeat(43), "the runner receives the one-use secret over the private channel");
    assert.ok(!result.output.includes("h".repeat(43)), "the handoff secret never appears in CLI output");
    const handoff = backend.calls.find((c) => c.path.endsWith("/handoffs"));
    assert.ok(handoff, "a one-use handoff was created for the run");
    assert.ok(!("handoff_secret" in handoff.body));
  });
});


describe("default generated-operation identity and recovery", () => {
  it("recovers the generated credential after a crash between keyring and journal writes", async (t) => {
    const directory = scratch();
    const backend = await startTestBackend();
    t.after(() => backend.close());
    const journal = new OperationJournal(join(directory, "config"));
    const persistMode = journal.setCredentialIdentity.bind(journal);
    let crash = true;
    journal.setCredentialIdentity = (...args) => {
      if (crash) {
        crash = false;
        throw new Error("simulated process death after keyring write");
      }
      return persistMode(...args);
    };
    const deps = inProcessDeps(directory, backend.origin, { journal });
    const requestId = randomUUID();
    const argv = ["test", "create", "--env", "t", "--request-id", requestId];
    const interrupted = await runCli(argv, deps);
    assert.equal(interrupted.exitCode, 3);
    assert.equal(journal.find(requestId).credential_identity, undefined);
    assert.equal(backend.runs.size, 0, "the crash occurs before dispatch");
    const recovered = await runCli(argv, deps);
    assert.equal(recovered.exitCode, 0, recovered.output);
    const credential = JSON.parse(recovered.output).generated_credential;
    assert.ok(credential?.password, "the preserved random password must be returned");
    assert.equal(journal.find(requestId).credential_identity, "generated");
    const replay = await runCli(argv, deps);
    assert.equal(replay.exitCode, 0, replay.output);
    assert.deepEqual(JSON.parse(replay.output).generated_credential, credential);
    assert.equal(backend.runs.size, 1, "both retries recover one run");
    assert.ok(!readFileSync(journal.path, "utf8").includes(credential.password));
  });

  it("default_generated_create_keeps_one_journal_identity_and_stop_prunes", async (t) => {
    const directory = scratch();
    const backend = await startTestBackend();
    t.after(() => backend.close());
    const env = prepared(directory, backend.origin);
    // No explicit --request-id: the planned id must still be one identity.
    const created = await runCliBin(["test", "create", "--env", "t"], env);
    assert.equal(created.code, 0, created.stdout);
    const envelope = JSON.parse(created.stdout);
    assert.match(envelope.request_id, /^[0-9a-f-]{36}$/);
    assert.equal(envelope.client_state.request_id, envelope.request_id);
    assert.equal(envelope.client_state.journal_status, "completed", "the actual dispatched id is journaled");
    assert.equal(envelope.client_state.credential_identity, "generated");
    assert.equal(envelope.client_state.run_id, envelope.run.id);
    const journal = JSON.parse(readFileSync(join(directory, "config", "operations.json"), "utf8"));
    const creates = journal.filter((entry) => entry.kind === "test.create");
    assert.equal(creates.length, 1);
    assert.equal(creates[0].request_id, envelope.request_id);
    assert.equal(creates[0].status, "completed");
    assert.equal(creates[0].run_id, envelope.run.id);
    assert.equal(creates[0].credential_identity, "generated");
    const dispatch = backend.calls.find((c) => c.method === "POST" && c.path === "/v1/capir/tests");
    assert.equal(dispatch.body.request_id, envelope.request_id, "journal, dispatch and output share one id");

    const stopped = await runCliBin(["test", "stop", envelope.run.id, "--env", "t"], env);
    assert.equal(stopped.code, 0, stopped.stdout);
    assert.deepEqual(keyringEntries(directory), {}, "default stop prunes the local run credential");
    const after = JSON.parse(readFileSync(join(directory, "config", "operations.json"), "utf8"));
    const stopEntry = after.find((entry) => entry.kind === "test.stop");
    assert.ok(stopEntry, "the stop is journaled");
    assert.equal(stopEntry.run_id, envelope.run.id);
  });

  it("default_response_loss_recovery_returns_the_original_credential", async (t) => {
    const directory = scratch();
    const backend = await startTestBackend({ dropFirstCreate: true });
    t.after(() => backend.close());
    const env = prepared(directory, backend.origin);
    const lost = await runCliBin(["test", "create", "--env", "t"], env); // default id
    assert.equal(lost.code, 3, lost.stdout);
    const lostEnvelope = JSON.parse(lost.stdout);
    const resumeId = lostEnvelope.error.recoverable_request_id;
    assert.match(resumeId, /^[0-9a-f-]{36}$/, "the lost default create reports its recovery id");
    const stored = Object.values(keyringEntries(directory));
    assert.equal(stored.length, 1, "the generated password is persisted before sending");
    const recovered = await runCliBin(["test", "create", "--env", "t", "--request-id", resumeId], env);
    assert.equal(recovered.code, 0, recovered.stdout);
    const envelope = JSON.parse(recovered.stdout);
    assert.equal(envelope.resumed, true);
    assert.equal(envelope.request_id, resumeId);
    assert.equal(envelope.generated_credential.password, stored[0], "the original password is recovered, never rotated");
    const creates = backend.calls.filter((c) => c.method === "POST" && c.path === "/v1/capir/tests");
    assert.equal(creates.length, 2);
    assert.equal(creates[0].body.request_id, creates[1].body.request_id);
    assert.equal(creates[0].body.password, creates[1].body.password);
  });

  it("normalizes_supplied_usernames_once_and_replays_equivalently", async (t) => {
    const directory = scratch();
    const backend = await startTestBackend();
    t.after(() => backend.close());
    const env = prepared(directory, backend.origin);
    const requestId = randomUUID();
    const created = await runCliBin([
      "test", "create", "--env", "t", "--username", " QA-MCP ", "--request-id", requestId,
    ], env);
    assert.equal(created.code, 0, created.stdout);
    const envelope = JSON.parse(created.stdout);
    const dispatch = backend.calls.find((c) => c.method === "POST" && c.path === "/v1/capir/tests");
    assert.equal(dispatch.body.username, "qa-mcp", "the handle is canonicalized once before dispatch");
    assert.equal(envelope.run.username, "qa-mcp");
    assert.equal(envelope.verified.state, "ready", "normalized readback verifies as ready");
    const replay = await runCliBin([
      "test", "create", "--env", "t", "--username", "Qa-Mcp", "--request-id", requestId,
    ], env);
    assert.equal(replay.code, 0, replay.stdout);
    assert.equal(JSON.parse(replay.stdout).resumed, true, "equivalent normalization replays the same operation");
    assert.equal(backend.runs.size, 1, "the replay reuses the one recorded allocation");
    const creates = backend.calls.filter((c) => c.method === "POST" && c.path === "/v1/capir/tests");
    assert.equal(creates.length, 2);
    assert.equal(creates[0].body.username, "qa-mcp");
    assert.equal(creates[1].body.username, "qa-mcp");
    assert.equal(creates[0].body.request_id, creates[1].body.request_id);
  });
});

describe("untrusted server text never leaks secrets", () => {
  it("handoff_errors_suppress_supplied_password_and_operator", async (t) => {
    const directory = scratch();
    const backend = await startTestBackend({ handoffEcho: true });
    t.after(() => backend.close());
    const launches = [];
    const deps = inProcessDeps(directory, backend.origin, {
      spawnRunner: async (message) => {
        launches.push(message);
        return { ok: true, launched: true, pid: 1, sandbox_id: message.sandbox_id, entry_path: message.entry_path, browser: { name: "chromium", version: null, headless: false } };
      },
    });
    const chosen = "chosen-supplied-secret-9";
    const result = await runCli([
      "test", "create", "--env", "t", "--username", "qa-1", "--password", chosen, "--open", "web", "--request-id", randomUUID(),
    ], deps);
    assert.equal(result.exitCode, 4, result.output);
    assert.ok(!result.output.includes(chosen), "handoff errors must suppress the supplied password");
    assert.ok(!result.output.includes(OPERATOR_TOKEN), "handoff errors must suppress the operator credential");
    assert.ok(result.output.includes("[REDACTED]"));
    const envelope = JSON.parse(result.output);
    assert.ok(envelope.run, "the ready run is preserved");
    assert.equal(envelope.run.state, "ready");
    assert.ok(!("generated_credential" in envelope), "supplied passwords are never projected");
    assert.equal(launches.length, 0, "no browser is launched after a rejected handoff");
  });
});


describe("operator identity is part of recorded intent", () => {
  it("changed_operator_cannot_replay_or_take_over_recorded_intent", async (t) => {
    const directory = scratch();
    const operatorB = "operator-b" + "k".repeat(43);
    const backend = await startTestBackend({ operatorTokens: [OPERATOR_TOKEN, operatorB] });
    t.after(() => backend.close());
    const env = prepared(directory, backend.origin);
    const requestId = randomUUID();
    const first = await runCliBin([
      "test", "create", "--env", "t", "--password", "chosen-supplied-secret-9", "--request-id", requestId,
    ], env);
    assert.equal(first.code, 0, first.stdout);
    const postsAfterFirst = backend.calls.filter((c) => c.method === "POST" && c.path === "/v1/capir/tests").length;
    assert.equal(postsAfterFirst, 1);

    // Same config, journal, exact origin pair, request id and supplied
    // password under a DIFFERENT registered principal must be refused before
    // any request, keyring or dispatch mutation.
    const second = await runCliBin([
      "test", "create", "--env", "t", "--password", "chosen-supplied-secret-9", "--request-id", requestId,
    ], { ...env, CAPIR_TEST_OPERATOR_TOKEN: operatorB });
    assert.equal(second.code, 2, second.stdout);
    const envelope = JSON.parse(second.stdout);
    assert.equal(envelope.error.code, "CAPIR_TEST_INTENT_CONFLICT");
    assert.equal(
      backend.calls.filter((c) => c.method === "POST" && c.path === "/v1/capir/tests").length,
      postsAfterFirst,
      "a foreign principal never dispatches against a recorded intent",
    );
    assert.deepEqual(keyringEntries(directory), {}, "no run credential is created or replaced");
    const journal = JSON.parse(readFileSync(join(directory, "config", "operations.json"), "utf8"));
    assert.equal(journal.filter((entry) => entry.kind === "test.create").length, 1, "the recorded intent is not duplicated");
    assert.ok(!second.stdout.includes("chosen-supplied-secret-9"));
  });

  it("stop_intent_is_bound_to_the_same_operator_identity", async (t) => {
    const directory = scratch();
    const operatorB = "operator-b" + "k".repeat(43);
    const backend = await startTestBackend({ operatorTokens: [OPERATOR_TOKEN, operatorB], dropFirstStop: true });
    t.after(() => backend.close());
    const env = prepared(directory, backend.origin);
    const created = JSON.parse((await runCliBin(["test", "create", "--env", "t", "--request-id", randomUUID()], env)).stdout);
    const stopId = randomUUID();
    const lost = await runCliBin([
      "test", "stop", created.run.id, "--env", "t", "--request-id", stopId,
    ], env);
    assert.equal(lost.code, 3, lost.stdout);
    assert.equal(JSON.parse(lost.stdout).error.code, "CAPIR_TEST_TRANSPORT_AMBIGUOUS");
    const stopsBefore = backend.calls.filter((c) => c.method === "POST" && c.path.endsWith("/stop")).length;
    // A recorded stop intent belongs to its operator; another registered
    // principal can never resume or take it over.
    const foreign = await runCliBin([
      "test", "stop", created.run.id, "--env", "t", "--request-id", stopId,
    ], { ...env, CAPIR_TEST_OPERATOR_TOKEN: operatorB });
    assert.equal(foreign.code, 2, foreign.stdout);
    assert.equal(JSON.parse(foreign.stdout).error.code, "CAPIR_TEST_INTENT_CONFLICT");
    assert.equal(backend.calls.filter((c) => c.method === "POST" && c.path.endsWith("/stop")).length, stopsBefore);
    const resumed = await runCliBin([
      "test", "stop", created.run.id, "--env", "t", "--request-id", stopId,
    ], env);
    assert.equal(resumed.code, 0, resumed.stdout, "the owning principal resumes its recorded stop");
  });
});

describe("runner receipts never leak known secrets", () => {
  it("nested_runner_receipt_strings_are_sanitized", async (t) => {
    const directory = scratch();
    const backend = await startTestBackend();
    t.after(() => backend.close());
    const chosen = "chosen-supplied-secret-9"; // short, not token-shaped
    const deps = inProcessDeps(directory, backend.origin, {
      spawnRunner: async (message) => ({
        ok: false,
        launched: true,
        pid: 7,
        sandbox_id: message.sandbox_id,
        entry_path: message.entry_path,
        browser: { name: "chromium", version: "123", headless: false },
        verification: {
          banner_state: "active",
          demo_expiry: "2026-10-04T12:30:00.000Z",
          dataset_state: "ready",
          dataset_counts: { contacts: 12, observations: 30, tasks: 4 },
          settled: true,
          settled_empty: false,
          preset_expectation: "daily",
          passed: false,
          observations: [`untrusted observation echoing ${chosen} and ${OPERATOR_TOKEN}`],
          custom_untrusted: `custom field echoing ${chosen}`,
        },
        error: {
          code: "CAPIR_VERIFICATION_FAILED",
          message: `rendered failure echoing password ${chosen} operator ${OPERATOR_TOKEN}`,
        },
      }),
    });
    const result = await runCli([
      "test", "create", "--env", "t", "--username", "qa-1", "--password", chosen, "--open", "web", "--request-id", randomUUID(),
    ], deps);
    assert.notEqual(result.exitCode, 0, result.output);
    assert.ok(!result.output.includes(chosen), "nested receipt strings must not leak the chosen password");
    assert.ok(!result.output.includes(OPERATOR_TOKEN), "nested receipt strings must not leak the operator credential");
    const envelope = JSON.parse(result.output);
    assert.ok(envelope.run, "the created run is preserved");
    assert.equal(envelope.run.state, "ready");
    assert.ok(envelope.browser, "the browser receipt is still reported");
    assert.ok(JSON.stringify(envelope.browser).includes("[REDACTED]"));
    assert.equal(envelope.error.recoverable_request_id, envelope.client_state.request_id);
    assert.ok(!("generated_credential" in envelope), "supplied passwords are never projected");
  });
});
