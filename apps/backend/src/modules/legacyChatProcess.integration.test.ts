import { fork, type ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { request, type ClientRequest } from "node:http";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";
import { describe, expect, it } from "vitest";
import { inTransaction } from "../database/pool.js";
import { encodePasswordCredential } from "./passwordCredential.js";
import type { ProcessNotice, ProcessPhase, ProcessState } from "./fixtures/legacyChatLifecycleProcess.fixture.js";

// This file deliberately does not import buildApp/recovery into the test worker.
// Both the killed owner and its replacement run the real app in distinct Node
// processes. All data belongs to generated accounts in the disposable CI DB.
const database = process.env.CONTACT_AGENT_TEST_DATABASE_URL;
if (database) {
  let parsed: URL;
  try { parsed = new URL(database); } catch { throw new Error("Disposable loopback test database required."); }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)
    || !["localhost", "127.0.0.1"].includes(parsed.hostname) || parsed.pathname !== "/lab_regression_ci"
    || parsed.search || parsed.hash) {
    throw new Error("Disposable loopback lab_regression_ci database without URL options required.");
  }
}
const fixedError = (message: string) => new Error("Synthetic process fixture: " + message);
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
type Response = { status: number | null; body: unknown; closed: boolean };
type Headers = { authorization: string };
interface Execution extends QueryResultRow {
  state: string; task_id: string; attempt_id: string; owner_instance: string;
  owner_generation: string; owner_nonce: string; deadline: string; lease: string; lease_elapsed: boolean;
  deadline_live: boolean; deadline_bounded: boolean; dispatched: boolean; ready_bytes: boolean;
  scrubbed: boolean; parent_status: string; response_status: number | null; response_body: unknown;
}
async function safeQuery<T extends QueryResultRow>(client: Pick<Pool, "query"> | PoolClient,
  sql: string, values: unknown[]): Promise<QueryResult<T>> {
  try { return await client.query<T>(sql, values); }
  // PG constraint detail can contain an entire private row. Never attach it,
  // a URL, values, proof, hash or cause to a test failure/log.
  catch { throw fixedError("control query failed"); }
}

class AppProcess {
  readonly child: ChildProcess;
  private notices: ProcessNotice[] = [];
  private listeners = new Set<() => void>();
  private invalid = false;
  private exited = false;
  private intentionalKill = false;
  private requestedShutdown = false;
  private exitResult: { code: number | null; signal: NodeJS.Signals | null } | undefined;
  private readonly exit: Promise<void>;
  port = 0;
  constructor(phase: ProcessPhase) {
    const loader = createRequire(import.meta.url).resolve("tsx");
    this.child = fork(fileURLToPath(new URL("./fixtures/legacyChatLifecycleProcess.fixture.ts", import.meta.url)), [], {
      cwd: fileURLToPath(new URL("../../", import.meta.url)),
      execArgv: ["--import", pathToFileURL(loader).href],
      // Do not inherit real provider secrets or a Vitest/Node preload hook.
      env: { PATH: process.env.PATH ?? "", GET449_PROCESS_DATABASE: database!, GET449_PROCESS_PHASE: phase },
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
    this.exit = new Promise(resolve => {
      this.child.once("exit", (code, signal) => {
        this.exited = true; this.exitResult = { code, signal }; resolve(); this.wake();
      });
    });
    this.child.on("error", () => { this.invalid = true; this.wake(); });
    this.child.on("message", (raw: unknown) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)
        || Object.keys(raw).some(key => !["state", "port", "calls"].includes(key))) {
        this.invalid = true; this.wake(); return;
      }
      const value = raw as ProcessNotice;
      const states: readonly ProcessState[] = ["listening", "admission_committed", "dispatch_committed", "rpc_entered",
        "ready_committed", "final_committed", "calls", "closed", "fixture_error"];
      if (!states.includes(value.state) || value.state === "fixture_error"
        || !Number.isSafeInteger(value.calls) || value.calls! < 0 || value.calls! > 1_000
        || (value.state === "listening" ? !Number.isInteger(value.port) || value.port! < 1 || value.port! > 65_535
          : value.port !== undefined) || this.notices.length >= 64) {
        this.invalid = true; this.wake(); return;
      }
      this.notices.push(value); this.wake();
    });
  }
  private wake(): void { for (const listener of this.listeners) listener(); }
  async notice(state: ProcessState, after = 0): Promise<ProcessNotice> {
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout>;
      const finish = (error?: Error, value?: ProcessNotice) => {
        clearTimeout(timer); this.listeners.delete(check);
        if (error) reject(error); else resolve(value!);
      };
      const check = () => {
        if (this.invalid) return finish(fixedError("invalid child state"));
        const value = this.notices.slice(after).find(row => row.state === state);
        if (value) return finish(undefined, value);
        if (this.exited) return finish(fixedError("child exited before required state"));
      };
      timer = setTimeout(() => finish(fixedError("required child state timed out")), 15_000);
      this.listeners.add(check); check();
    });
  }
  async ready(): Promise<void> {
    const started = await this.notice("listening"); this.port = started.port!;
    expect(started.calls).toBe(0);
  }
  async calls(): Promise<number> {
    const after = this.notices.length;
    if (!this.child.connected || this.exited) throw fixedError("counter requested from dead child");
    this.child.send({ state: "call_count" });
    return (await this.notice("calls", after)).calls!;
  }
  async killOwner(): Promise<void> {
    if (this.exited || !this.child.pid) throw fixedError("owner could not be killed");
    this.intentionalKill = true;
    if (!this.child.kill("SIGKILL")) throw fixedError("owner could not be killed");
    if (!await this.exitedWithin(5_000)) throw fixedError("owner death not observed");
    // child.killed alone is not proof of death. Await the exact fork's exit.
    expect(this.exitResult?.signal).toBe("SIGKILL");
  }
  private async exitedWithin(ms: number): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([this.exit.then(() => true), new Promise<false>(resolve => {
      timer = setTimeout(() => resolve(false), ms);
    })]); } finally { if (timer) clearTimeout(timer); }
  }
  async close(): Promise<boolean> {
    if (this.exited) return (this.intentionalKill && this.exitResult?.signal === "SIGKILL")
      || (this.requestedShutdown && this.exitResult?.code === 0 && this.exitResult.signal === null);
    this.requestedShutdown = true;
    if (this.child.connected) this.child.send({ state: "shutdown" });
    if (await this.exitedWithin(3_000)) return this.exitResult?.code === 0 && this.exitResult.signal === null;
    // Never kill by a received PID, a process group or a global process name.
    if (!this.child.pid || !this.child.kill("SIGKILL")) return false;
    await this.exitedWithin(5_000);
    return false; // forced cleanup is a failing gate, not silent success
  }
}

interface Scenario {
  accountId: string; userId: string; key: string; control: Pool;
  start: (phase: ProcessPhase) => Promise<AppProcess>;
  login: (app: AppProcess) => Promise<Headers>;
  http: (app: AppProcess, method: string, path: string, headers?: Headers, body?: unknown,
    timeoutMs?: number) => { request: ClientRequest; result: Promise<Response> };
  execution: () => Promise<Execution>;
  counts: () => Promise<{ attempts: number; audits: number }>;
}
async function withScenario(run: (scenario: Scenario) => Promise<void>): Promise<void> {
  const accountId = randomUUID(), userId = randomUUID(), key = randomUUID();
  const email = `legacy-process-${userId}@example.invalid`, password = randomBytes(24).toString("base64url");
  const control = new Pool({ connectionString: database!, max: 2, connectionTimeoutMillis: 2_000,
    statement_timeout: 5_000, query_timeout: 6_000 });
  const children: AppProcess[] = [], requests: ClientRequest[] = [];
  let backgroundError = false;
  control.on("error", () => { backgroundError = true; });
  const http: Scenario["http"] = (app, method, path, headers, body, timeoutMs = 8_000) => {
    let client!: ClientRequest;
    const result = new Promise<Response>(resolve => {
      let settled = false, timer: ReturnType<typeof setTimeout> | undefined;
      const done = (value: Response) => { if (settled) return; settled = true; if (timer) clearTimeout(timer); resolve(value); };
      client = request({ hostname: "127.0.0.1", port: app.port, method, path, agent: false,
        headers: { ...headers, ...(body === undefined ? {} : { "content-type": "application/json" }) } }, response => {
        const chunks: Buffer[] = []; let length = 0;
        response.on("data", (chunk: Buffer) => {
          length += chunk.length;
          if (length > 1024 * 1024) { client.destroy(); done({ status: null, body: undefined, closed: true }); }
          else chunks.push(chunk);
        });
        response.on("error", () => done({ status: null, body: undefined, closed: true }));
        response.on("end", () => {
          let parsed: unknown;
          try { parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
          catch { done({ status: null, body: undefined, closed: true }); return; }
          done({ status: response.statusCode ?? null, body: parsed, closed: false });
        });
      });
      client.on("error", () => done({ status: null, body: undefined, closed: true }));
      if (timeoutMs > 0) timer = setTimeout(() => {
        client.destroy(); done({ status: null, body: undefined, closed: true });
      }, timeoutMs);
      client.end(body === undefined ? undefined : JSON.stringify(body));
    });
    requests.push(client); return { request: client, result };
  };
  try {
    try {
      await inTransaction(control, async client => {
        await safeQuery(client, "INSERT INTO accounts(id,slug,name) VALUES($1,$2,'Synthetic process recovery')",
          [accountId, `legacy-process-${accountId}`]);
        await safeQuery(client, "INSERT INTO account_email_reservations(normalized_email,state,account_id,user_id) VALUES($1,'owned',$2,$3)",
          [email, accountId, userId]);
        await safeQuery(client, "INSERT INTO users(id,account_id,email,display_name,kind,username) VALUES($1,$2,$3,'Synthetic owner','password_human',$3)",
          [userId, accountId, email]);
        await safeQuery(client, "INSERT INTO password_credentials(account_id,user_id,password_scrypt) VALUES($1,$2,$3)",
          [accountId, userId, await encodePasswordCredential(password)]);
      });
    } catch { throw fixedError("generated account setup failed"); }
    const execution = async () => {
      const row = (await safeQuery<Execution>(control, `SELECT e.state,e.task_id,e.attempt_id,e.owner_instance,
        e.owner_generation::text,e.owner_nonce,to_char(e.execution_deadline AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS deadline,
        to_char(e.lease_until AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS lease,
        e.lease_until<=clock_timestamp() AS lease_elapsed,e.execution_deadline>clock_timestamp() AS deadline_live,
        e.execution_deadline<=e.created_at+interval '60 seconds' AS deadline_bounded,
        e.dispatch_started_at IS NOT NULL AS dispatched,e.checkpoint IS NOT NULL AND e.checkpoint_sha256 IS NOT NULL AS ready_bytes,
        e.original_proof IS NULL AND e.source_snapshot IS NULL AND e.checkpoint IS NULL
          AND e.checkpoint_sha256 IS NULL AND e.checkpoint_bytes IS NULL AND e.checkpoint_expires_at IS NULL AS scrubbed,
        p.status AS parent_status,p.response_status,p.response_body
        FROM legacy_chat_executions e JOIN idempotency_records p ON p.account_id=e.account_id AND p.id=e.idempotency_id
        WHERE p.account_id=$1 AND p.idempotency_key=$2`, [accountId, key])).rows[0];
      if (!row) throw fixedError("durable attempt not visible");
      return row;
    };
    await run({ accountId, userId, key, control, http, execution,
      start: async phase => { const app = new AppProcess(phase); children.push(app); await app.ready(); return app; },
      login: async app => {
        const response = await http(app, "POST", "/v1/auth/password/login", undefined,
          { identifier: email, password, client_label: "Synthetic process recovery" }).result;
        expect(response.status).toBe(200);
        const token = (response.body as { access_token?: unknown } | null)?.access_token;
        if (typeof token !== "string" || !token.length) throw fixedError("password login did not return a credential");
        return { authorization: `Bearer ${token}` };
      },
      counts: async () => (await safeQuery<{ attempts: number; audits: number }>(control, `SELECT
        (SELECT count(*)::int FROM legacy_chat_executions e JOIN idempotency_records p
          ON p.account_id=e.account_id AND p.id=e.idempotency_id WHERE p.account_id=$1 AND p.idempotency_key=$2) AS attempts,
        (SELECT count(*)::int FROM audit_events a JOIN legacy_chat_executions e ON a.account_id=e.account_id AND a.entity_id=e.task_id
          JOIN idempotency_records p ON p.account_id=e.account_id AND p.id=e.idempotency_id
          WHERE p.account_id=$1 AND p.idempotency_key=$2 AND a.event_type='unscoped_chat_task.completed') AS audits`,
      [accountId, key])).rows[0]!,
    });
    expect(backgroundError).toBe(false);
  } finally {
    for (const client of requests) client.destroy();
    let cleanupFailures = 0;
    for (const child of [...children].reverse()) if (!await child.close()) cleanupFailures += 1;
    try { await control.end(); } catch { cleanupFailures += 1; }
    expect(cleanupFailures).toBe(0);
    // Generated accounts/keys are retained only in this disposable Hosted DB;
    // its owning PG job destroys it, never a real account/service database.
  }
}

async function crashAt(s: Scenario, phase: Exclude<ProcessPhase, "normal">) {
  const owner = await s.start(phase), headers = await s.login(owner);
  const pending = s.http(owner, "POST", "/v1/chat/unscoped-tasks", headers,
    { idempotency_key: s.key, objective: "Reply with a synthetic greeting." }, 0);
  const notice = await owner.notice(phase);
  const before = await s.execution(); // separate actual connection sees committed state
  expect(before.deadline_bounded).toBe(true); expect(before.deadline_live).toBe(true);
  expect(notice.calls).toBe(phase === "admission_committed" || phase === "dispatch_committed" ? 0 : 1);
  await owner.killOwner();
  expect((await pending.result).closed).toBe(true);
  return { before, headers };
}
async function shortenDeadLease(s: Scenario): Promise<void> {
  // Called only after crashAt has awaited SIGKILL exit of the exact owner.
  // This shortens a dead lease, never extends any expiry or original proof.
  const result = await safeQuery(s.control, `UPDATE legacy_chat_executions e SET lease_until=clock_timestamp()-interval '1 second'
    FROM idempotency_records p WHERE p.account_id=e.account_id AND p.id=e.idempotency_id
      AND p.account_id=$1 AND p.idempotency_key=$2`, [s.accountId, s.key]);
  expect(result.rowCount).toBe(1);
}
function sameAttempt(before: Execution, after: Execution): void {
  expect(after.task_id === before.task_id && after.attempt_id === before.attempt_id).toBe(true);
  expect(after.deadline === before.deadline).toBe(true);
}
function unavailable(response: Response): void {
  expect(response.status).toBe(409);
  const code = (response.body as { error?: { code?: unknown } } | null)?.error?.code;
  expect(code).toBe("LEGACY_CHAT_EXECUTION_UNAVAILABLE");
}

describe.skipIf(!database)("durable legacy recovery after real Node process death", () => {
  // 90s is a test setup/real lease-wait budget. Product deadlines remain60s,
  // original lease30s and existing DeepSeek request15s, with no production hook.
  it.each(["admission_committed", "dispatch_committed", "rpc_entered"] as const)(
    "retires %s after actual owner death without another attempt or RPC", async phase => {
      await withScenario(async s => {
        const { before } = await crashAt(s, phase);
        expect(before.state).toBe(phase === "admission_committed" ? "admitted" : "dispatch_started");
        expect(before.dispatched).toBe(phase !== "admission_committed");
        expect(before.ready_bytes).toBe(false);
        await shortenDeadLease(s);
        const replacement = await s.start("normal"); // actual onReady janitor
        const current = await s.execution(); sameAttempt(before, current);
        expect(current.state).toBe(phase === "admission_committed" ? "expired" : "unknown");
        expect(current.scrubbed).toBe(true);
        const fresh = await s.login(replacement);
        const status = await s.http(replacement, "GET", `/v1/chat/unscoped-task-status?idempotency_key=${s.key}`, fresh).result;
        expect(status.status).toBe(200);
        expect((status.body as { state?: string }).state).toBe(current.state);
        unavailable(await s.http(replacement, "POST", "/v1/chat/unscoped-task-resolve", fresh, { idempotency_key: s.key }).result);
        unavailable(await s.http(replacement, "POST", "/v1/chat/unscoped-tasks", fresh,
          { idempotency_key: s.key, objective: "Reply with a synthetic greeting." }).result);
        expect(await replacement.calls()).toBe(0);
        expect(await s.counts()).toEqual({ attempts: 1, audits: 0 });
      });
    }, 90_000);

  it("resolves the same ready attempt after a real unmodified30s database lease expires", async () => {
    await withScenario(async s => {
      const { before } = await crashAt(s, "ready_committed");
      expect(before.state).toBe("result_ready"); expect(before.ready_bytes).toBe(true);
      expect(before.lease_elapsed).toBe(false);
      const replacement = await s.start("normal");
      // No SQL clock, lease or deadline mutation in this positive test. Warm
      // the replacement app before the lease ends, but login only afterwards.
      const until = performance.now() + 40_000;
      for (;;) {
        const row = await s.execution();
        expect(row.deadline_live).toBe(true); sameAttempt(before, row);
        expect(row.lease === before.lease).toBe(true);
        if (row.lease_elapsed) break;
        if (performance.now() >= until) throw fixedError("real lease did not expire within its envelope");
        await delay(200);
      }
      const fresh = await s.login(replacement);
      const resolved = await s.http(replacement, "POST", "/v1/chat/unscoped-task-resolve", fresh, { idempotency_key: s.key }).result;
      expect(resolved.status).toBe(201);
      const rendered = JSON.stringify(resolved.body);
      expect(typeof rendered === "string" && rendered.includes("Synthetic process durable answer.")).toBe(true);
      const current = await s.execution(); sameAttempt(before, current);
      expect(current.state).toBe("completed"); expect(current.scrubbed).toBe(true);
      expect(BigInt(current.owner_generation) > BigInt(before.owner_generation)).toBe(true);
      expect(current.owner_nonce !== before.owner_nonce && current.owner_instance !== before.owner_instance).toBe(true);
      expect(isDeepStrictEqual(resolved.body, current.response_body)).toBe(true);
      const replay = await s.http(replacement, "POST", "/v1/chat/unscoped-tasks", fresh,
        { idempotency_key: s.key, objective: "Reply with a synthetic greeting." }).result;
      expect(replay.status).toBe(201); expect(isDeepStrictEqual(replay.body, resolved.body)).toBe(true);
      expect(await replacement.calls()).toBe(0);
      expect(await s.counts()).toEqual({ attempts: 1, audits: 1 });
    });
  }, 90_000);

  it("replays an actually committed final answer after its owner dies before receiving COMMIT ACK", async () => {
    await withScenario(async s => {
      const { before } = await crashAt(s, "final_committed");
      expect(before.state).toBe("completed"); expect(before.parent_status).toBe("completed");
      expect(before.response_status).toBe(201); expect(before.scrubbed).toBe(true);
      expect(await s.counts()).toEqual({ attempts: 1, audits: 1 });
      const replacement = await s.start("normal"), fresh = await s.login(replacement);
      for (const path of ["/v1/chat/unscoped-task-status", "/v1/chat/unscoped-task-resolve"]) {
        const status = path.endsWith("status");
        const response = await s.http(replacement, status ? "GET" : "POST",
          status ? `${path}?idempotency_key=${s.key}` : path, fresh, status ? undefined : { idempotency_key: s.key }).result;
        expect(response.status).toBe(201);
        expect(isDeepStrictEqual(response.body, before.response_body)).toBe(true);
      }
      sameAttempt(before, await s.execution());
      const replay = await s.http(replacement, "POST", "/v1/chat/unscoped-tasks", fresh,
        { idempotency_key: s.key, objective: "Reply with a synthetic greeting." }).result;
      expect(replay.status).toBe(201); expect(isDeepStrictEqual(replay.body, before.response_body)).toBe(true);
      expect(await replacement.calls()).toBe(0);
      expect(await s.counts()).toEqual({ attempts: 1, audits: 1 });
    });
  }, 90_000);

  it.each(["generation", "expired_original", "revoked_original"] as const)(
    "does not revive a ready result with a fresh login after %s", async fault => {
      await withScenario(async s => {
        const { before, headers } = await crashAt(s, "ready_committed");
        expect(before.state).toBe("result_ready");
        await shortenDeadLease(s);
        if (fault === "generation") {
          const changed = await safeQuery(s.control,
            "UPDATE harness_source_generations SET generation=generation+1 WHERE account_id=$1", [s.accountId]);
          expect(changed.rowCount).toBe(1);
        }
        if (fault === "expired_original") {
          const changed = await safeQuery(s.control,
            "UPDATE sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE account_id=$1 AND user_id=$2", [s.accountId, s.userId]);
          expect(changed.rowCount).toBe(1); // only original login exists yet
        }
        const replacement = await s.start("normal");
        if (fault === "revoked_original") {
          expect((await s.http(replacement, "POST", "/v1/auth/logout", headers).result).status).toBe(200);
        }
        const fresh = await s.login(replacement);
        const response = await s.http(replacement, "POST", "/v1/chat/unscoped-task-resolve", fresh, { idempotency_key: s.key }).result;
        unavailable(response);
        const current = await s.execution(); sameAttempt(before, current);
        expect(current.state).toBe("authority_lost"); expect(current.scrubbed).toBe(true);
        unavailable(await s.http(replacement, "POST", "/v1/chat/unscoped-tasks", fresh,
          { idempotency_key: s.key, objective: "Reply with a synthetic greeting." }).result);
        expect(await replacement.calls()).toBe(0);
        expect(await s.counts()).toEqual({ attempts: 1, audits: 0 });
      });
    }, 90_000);
});
