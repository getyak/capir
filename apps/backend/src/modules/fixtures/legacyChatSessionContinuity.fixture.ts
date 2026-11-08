/** Test-only real HTTP/PG fixture. No provider network or invented AuthContext.
 * The only fault windows delay acknowledged real SQL, never fabricate rows. */
import { randomBytes, randomUUID } from "node:crypto";
import { fork, type ChildProcess } from "node:child_process";
import { request as nodeRequest, type ClientRequest } from "node:http";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { expect } from "vitest";
import { buildApp } from "../../app.js";
import { inTransaction } from "../../database/pool.js";
import { encodePasswordCredential } from "../passwordCredential.js";
import type { RemoteChatAnswerProviding, RemoteChatAnswerResult } from "../chatAnswerProvider.js";
import type { ProcessNotice, ProcessPhase, ProcessState } from "./legacyChatLifecycleProcess.fixture.js";

export const sessionDatabase = process.env.CONTACT_AGENT_TEST_DATABASE_URL;
if (sessionDatabase) {
  let parsed: URL;
  try { parsed = new URL(sessionDatabase); } catch { throw new Error("Owned disposable loopback database required."); }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol) || parsed.search || parsed.hash
    || !["localhost", "127.0.0.1"].includes(parsed.hostname) || parsed.pathname !== "/lab_regression_ci") {
    throw new Error("Owned disposable loopback lab_regression_ci without URL options required.");
  }
}
export function sessionBarrier() {
  let done!: () => void, settled = false;
  const promise = new Promise<void>(resolve => { done = resolve; });
  return { promise, resolve() { settled = true; done(); }, settled: () => settled };
}
export async function waitSessionCondition(read: () => Promise<boolean> | boolean, milliseconds = 2_000): Promise<void> {
  const deadline = performance.now() + milliseconds;
  while (performance.now() < deadline) {
    if (await read()) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error("Synthetic Session condition was not observed within its bounded budget.");
}
export const emptySessionPayload = (id: string) => {
  const stamp = new Date().toISOString();
  return { id, scopeKind: "unresolved_intent" as const, personDisplayLabel: "", contextDisplayLabel: "",
    title: "Synthetic empty Session", turns: [], isUnread: false, createdAt: stamp, updatedAt: stamp };
};
export interface SessionLedger extends QueryResultRow {
  state: string; task_id: string; attempt_id: string; scrubbed: boolean; dispatched: boolean;
  snapshot_version: number | null; exact_session: boolean; fixed_deadline: string; lease_elapsed: boolean;
}
export async function withEmptySessionScenario(options: { disabled?: boolean; internalLab?: boolean },
  run: (fixture: Awaited<ReturnType<typeof scenario>>) => Promise<void>): Promise<void> {
  const fixture = await scenario(options);
  try { await run(fixture); }
  finally { await fixture.close(); }
}
async function scenario(options: { disabled?: boolean; internalLab?: boolean }) {
  const accountId = randomUUID(), userId = randomUUID(), password = randomBytes(24).toString("base64url");
  const email = "empty-session-" + userId + "@example.invalid";
  const pool = new Pool({ connectionString: sessionDatabase!, max: 4, connectionTimeoutMillis: 2_000,
    statement_timeout: 5_000, query_timeout: 6_000 });
  const control = new Pool({ connectionString: sessionDatabase!, max: 2, connectionTimeoutMillis: 2_000,
    statement_timeout: 5_000, query_timeout: 6_000 });
  let poolError = false, calls = 0, readyCount = 0, holdReady = false, holdSource = false;
  const heldCalls = new Map<number, ReturnType<typeof sessionBarrier>>(), requests: Promise<unknown>[] = [];
  const readyRelease = sessionBarrier(), sourceEntered = sessionBarrier(), sourceRelease = sessionBarrier();
  pool.on("error", () => { poolError = true; }); control.on("error", () => { poolError = true; });
  const q = async <T extends QueryResultRow>(sql: string, args: unknown[] = []) => {
    try { return await control.query<T>(sql, args); }
    catch { throw new Error("Synthetic Session control query failed; private row detail withheld."); }
  };
  const productPool = new Proxy(pool, { get(target, key) {
    if (key !== "connect") {
      const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
    }
    return async () => {
      const client = await target.connect(); let readyTransaction = false;
      return new Proxy(client, { get(owner, name) {
        if (name !== "query") {
          const value = Reflect.get(owner, name, owner); return typeof value === "function" ? value.bind(owner) : value;
        }
        return (...args: unknown[]) => {
          const sql = typeof args[0] === "string" ? args[0] : "";
          if (sql === "BEGIN") readyTransaction = false;
          if (sql.includes("SET state='result_ready',checkpoint=")) readyTransaction = true;
          const actual = Reflect.apply(owner.query, owner, args);
          if (sql === "COMMIT" && readyTransaction && holdReady) {
            if (!actual || typeof actual.then !== "function") throw new Error("Synthetic ready barrier requires an acknowledged Promise COMMIT.");
            return Promise.resolve(actual).then(async value => { readyCount++; await readyRelease.promise; return value; });
          }
          if (holdSource && sql.includes("FROM agent_sessions") && sql.includes("FOR UPDATE NOWAIT")) {
            if (!actual || typeof actual.then !== "function") throw new Error("Synthetic source barrier requires the real completed row-lock query.");
            holdSource = false;
            return Promise.resolve(actual).then(async value => { sourceEntered.resolve(); await sourceRelease.promise; return value; });
          }
          return actual;
        };
      } }) as PoolClient;
    };
  } });
  const answer: RemoteChatAnswerResult = { kind: "answer", title: "Synthetic empty Session reply",
    body: "Synthetic empty Session durable result.", citation_ids: [], provider_id: "deepseek-chat-completions",
    model: "synthetic-session-continuity", provider_request_id: null, input_tokens: 1, output_tokens: 1 };
  const provider: RemoteChatAnswerProviding = { providerId: answer.provider_id, model: answer.model, supportsImageInput: false,
    answer: async () => { const call = ++calls; await heldCalls.get(call)?.promise; return answer; } };
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  try {
    await inTransaction(control, async client => {
      await client.query("INSERT INTO accounts(id,slug,name) VALUES($1,$2,'Synthetic empty Session continuity')", [accountId, "empty-session-" + accountId]);
      await client.query("INSERT INTO account_email_reservations(normalized_email,state,account_id,user_id) VALUES($1,'owned',$2,$3)", [email, accountId, userId]);
      await client.query("INSERT INTO users(id,account_id,email,display_name,kind,username) VALUES($1,$2,$3,'Synthetic owner','password_human',$3)", [userId, accountId, email]);
      await client.query("INSERT INTO password_credentials(account_id,user_id,password_scrypt) VALUES($1,$2,$3)", [accountId, userId, await encodePasswordCredential(password)]);
    });
    app = await buildApp({ pool: productPool, config: { databaseUrl: sessionDatabase!, host: "127.0.0.1", port: 0,
      allowedOrigins: [], appleSignInAudiences: [], appleSignInEnabled: false, passwordAuthEnabled: true,
      passwordRegistrationEnabled: false, simulatedAuthEnabled: false, internalLabEnabled: options.internalLab ?? false,
      retentionSweepIntervalMs: 60_000, sessionTtlSeconds: 3_600 }, remoteChatProvider: options.disabled ? null : provider,
    personResearchProvider: null, privateConversationProvider: null, labProviders: new Map(), labJobWorkerEnabled: false,
    conversationQueueWorkerEnabled: false, labCIVerifier: null, screenshotContact: null });
    await app.ready();
    const login = await app.inject({ method: "POST", url: "/v1/auth/password/login", payload: { identifier: email, password, client_label: "Synthetic empty Session continuity" } });
    expect(login.statusCode).toBe(200);
    const headers = { authorization: "Bearer " + login.json<{ access_token: string }>().access_token };
    const activeApp = app;
    const start = (sessionID: string | undefined, key = randomUUID(), messageID?: string) => {
      const promise = activeApp.inject({ method: "POST", url: "/v1/chat/unscoped-tasks", headers,
        payload: { idempotency_key: key, objective: "Give a synthetic greeting.", ...(sessionID ? { session_id: sessionID } : {}),
          ...(messageID ? { message_id: messageID } : {}) } }).then(response => response);
      requests.push(promise); void promise.catch(() => {}); return { key, promise };
    };
    return { app: activeApp, pool, control, q, accountId, userId, headers, answer, start,
      calls: () => calls, holdCall(index: number) { heldCalls.set(index, sessionBarrier()); },
      releaseCall(index: number) { heldCalls.get(index)?.resolve(); },
      waitCalls: (count: number) => waitSessionCondition(() => calls === count),
      holdReady() { holdReady = true; }, readyCount: () => readyCount, releaseReady() { readyRelease.resolve(); },
      holdNextSource() { holdSource = true; }, sourceEntered, releaseSource() { sourceRelease.resolve(); },
      async createSession() {
        const id = randomUUID(), payload = emptySessionPayload(id);
        const response = await activeApp.inject({ method: "PUT", url: "/v1/agent-sessions/" + id, headers,
          payload: { expected_revision: 0, idempotency_key: randomUUID(), payload } });
        expect(response.statusCode).toBe(200);
        return { id, payload, revision: response.json<{ session: { revision: number } }>().session.revision };
      },
      async loginChild(child: SessionRecoveryProcess) {
        const response = await child.http("POST", "/v1/auth/password/login", undefined,
          { identifier: email, password, client_label: "Synthetic Session replacement" });
        expect(response.status).toBe(200);
        const token = (response.body as { access_token?: unknown } | null)?.access_token;
        if (typeof token !== "string" || !token.length) throw new Error("Synthetic child login failed without exposing its credential body.");
        return { authorization: "Bearer " + token };
      },
      async ledger(key: string, sessionID: string) {
        return (await q<SessionLedger>(`SELECT e.state,e.task_id::text,e.attempt_id::text,
          e.original_proof IS NULL AND e.source_snapshot IS NULL AND e.checkpoint IS NULL
            AND e.checkpoint_bytes IS NULL AND e.checkpoint_sha256 IS NULL AND e.checkpoint_expires_at IS NULL AS scrubbed,
          e.dispatch_started_at IS NOT NULL AS dispatched,(e.source_snapshot->>'version')::int AS snapshot_version,
          COALESCE(e.source_snapshot->>'sessionID'=$4,false) AS exact_session,
          to_char(e.execution_deadline AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS fixed_deadline,
          e.lease_until<=clock_timestamp() AS lease_elapsed
          FROM legacy_chat_executions e JOIN idempotency_records p ON p.account_id=e.account_id AND p.id=e.idempotency_id
          WHERE p.account_id=$1 AND p.actor_user_id=$2 AND p.idempotency_key=$3`, [accountId, userId, key, sessionID])).rows[0];
      },
      async counts(sessionID: string) {
        return (await q<{ lineage: number; audits: number }>(`SELECT
          (SELECT count(*)::int FROM agent_session_chat_tasks WHERE account_id=$1 AND origin_session_id=$2) AS lineage,
          (SELECT count(*)::int FROM audit_events WHERE account_id=$1 AND event_type='unscoped_chat_task.completed'
            AND metadata->>'conversation_session_id'=$2) AS audits`, [accountId, sessionID])).rows[0]!;
      },
      async close() {
        for (const barrier of heldCalls.values()) barrier.resolve(); readyRelease.resolve(); sourceRelease.resolve();
        try { await Promise.allSettled(requests); }
        finally { try { await activeApp.close(); } finally { await Promise.all([pool.end(), control.end()]); } }
        expect(poolError, "No task-owned Pool may fail silently.").toBe(false);
      },
    };
  } catch {
    for (const barrier of heldCalls.values()) barrier.resolve(); readyRelease.resolve(); sourceRelease.resolve();
    await app?.close().catch(() => {}); await Promise.allSettled([pool.end(), control.end()]);
    throw new Error("Synthetic empty Session fixture setup failed; credentials/private rows withheld.");
  }
}

/** Uses the existing unchanged real app child, never a fabricated restored
 * execution or live-process disconnect presented as owner death. */
export class SessionRecoveryProcess {
  private readonly child: ChildProcess;
  private readonly exit: Promise<void>;
  private notices: ProcessNotice[] = [];
  private listeners = new Set<() => void>();
  private requests = new Set<ClientRequest>();
  private invalid = false;
  private ended: { code: number | null; signal: NodeJS.Signals | null } | null = null;
  private killedByTask = false;
  private requestedShutdown = false;
  private port = 0;
  constructor(phase: ProcessPhase) {
    const loader = createRequire(import.meta.url).resolve("tsx");
    this.child = fork(fileURLToPath(new URL("./legacyChatLifecycleProcess.fixture.ts", import.meta.url)), [], {
      cwd: fileURLToPath(new URL("../../../", import.meta.url)), execArgv: ["--import", pathToFileURL(loader).href],
      env: { PATH: process.env.PATH ?? "", GET449_PROCESS_DATABASE: sessionDatabase!, GET449_PROCESS_PHASE: phase },
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
    this.exit = new Promise(resolve => this.child.once("exit", (code, signal) => {
      this.ended = { code, signal }; resolve(); this.wake();
    }));
    this.child.on("error", () => { this.invalid = true; this.wake(); });
    this.child.on("message", (raw: unknown) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).some(k => !["state", "port", "calls"].includes(k))) {
        this.invalid = true; this.wake(); return;
      }
      const message = raw as ProcessNotice;
      const states: readonly ProcessState[] = ["listening", "admission_committed", "dispatch_committed", "rpc_entered", "ready_committed", "final_committed", "calls", "closed"];
      if (!states.includes(message.state) || !Number.isSafeInteger(message.calls) || message.calls! < 0 || message.calls! > 1_000
        || (message.state === "listening" ? !Number.isInteger(message.port) || message.port! < 1 || message.port! > 65_535 : message.port !== undefined)
        || this.notices.length >= 64) { this.invalid = true; this.wake(); return; }
      this.notices.push(message); this.wake();
    });
  }
  private wake() { for (const fn of this.listeners) fn(); }
  private hasExited() { return this.ended !== null; }
  async notice(state: ProcessState, after = 0): Promise<ProcessNotice> {
    return new Promise((resolve, reject) => {
      const finish = (value?: ProcessNotice) => {
        clearTimeout(timer); this.listeners.delete(check);
        if (value) resolve(value); else reject(new Error("Synthetic child required state was not observed."));
      };
      const check = () => {
        if (this.invalid) return finish();
        const value = this.notices.slice(after).find(n => n.state === state);
        if (value) return finish(value);
        if (this.ended) finish();
      };
      const timer = setTimeout(() => finish(), 15_000);
      this.listeners.add(check); check();
    });
  }
  async ready() { const note = await this.notice("listening"); this.port = note.port!; expect(note.calls).toBe(0); }
  async calls() {
    const after = this.notices.length;
    if (this.ended || !this.child.connected) throw new Error("Synthetic dead child cannot supply a counter.");
    this.child.send({ state: "call_count" }); return (await this.notice("calls", after)).calls!;
  }
  http(method: string, path: string, headers?: { authorization: string }, body?: unknown, timeoutMs = 8_000) {
    if (this.port < 1 || this.port > 65_535 || this.hasExited()) throw new Error("Synthetic child has no current owned loopback listener.");
    return new Promise<{ status: number | null; body: unknown; closed: boolean }>(resolve => {
      let finished = false, timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (value: { status: number | null; body: unknown; closed: boolean }) => {
        if (finished) return; finished = true; if (timer) clearTimeout(timer); resolve(value);
      };
      const failed = () => finish({ status: null, body: null, closed: true });
      const client = nodeRequest({ hostname: "127.0.0.1", port: this.port, method, path, agent: false,
        headers: { ...headers, ...(body === undefined ? {} : { "content-type": "application/json" }) } }, response => {
        const chunks: Buffer[] = []; let bytes = 0;
        response.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > 1024 * 1024) { client.destroy(); failed(); } else chunks.push(chunk);
        });
        response.on("error", failed);
        response.on("end", () => {
          let parsed: unknown; try { parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { failed(); return; }
          finish({ status: response.statusCode ?? null, body: parsed, closed: false });
        });
      });
      this.requests.add(client); client.once("close", () => this.requests.delete(client)); client.on("error", failed);
      if (timeoutMs) timer = setTimeout(() => { client.destroy(); failed(); }, timeoutMs);
      client.end(body === undefined ? undefined : JSON.stringify(body));
    });
  }
  private async exitedWithin(ms: number) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([this.exit.then(() => true), new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), ms); })]); }
    finally { if (timer) clearTimeout(timer); }
  }
  async killOwner() {
    if (this.hasExited() || !this.child.pid || !this.child.kill("SIGKILL")) throw new Error("Synthetic owner death could not be requested.");
    this.killedByTask = true;
    if (!await this.exitedWithin(5_000) || this.ended?.signal !== "SIGKILL") throw new Error("Synthetic owner death was not observed.");
  }
  async close() {
    for (const request of this.requests) request.destroy();
    if (!this.hasExited()) {
      this.requestedShutdown = true;
      if (this.child.connected) this.child.send({ state: "shutdown" });
      if (!await this.exitedWithin(3_000)) {
        this.child.kill("SIGKILL"); await this.exitedWithin(5_000);
        throw new Error("Synthetic child required forced cleanup.");
      }
    }
    if (!((this.killedByTask && this.ended?.signal === "SIGKILL")
      || (this.requestedShutdown && this.ended?.code === 0 && this.ended.signal === null))) throw new Error("Synthetic child cleanup exit was not verified.");
  }
}
