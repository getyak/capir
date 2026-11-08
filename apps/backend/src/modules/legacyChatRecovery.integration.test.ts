import { randomBytes, randomUUID } from "node:crypto";
import { request as httpRequest } from "node:http";
import type { LightMyRequestResponse } from "fastify";
import { Pool, type PoolClient } from "pg";
import { describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { inTransaction } from "../database/pool.js";
import { encodePasswordCredential } from "./passwordCredential.js";
import type { RemoteChatAnswerProviding, RemoteChatAnswerResult } from "./chatAnswerProvider.js";

const database = process.env.CONTACT_AGENT_TEST_DATABASE_URL;
if (database) {
  let parsed: URL;
  try { parsed = new URL(database); } catch { throw new Error("Use only the owned disposable loopback lab_regression_ci database."); }
  if (!["postgres:","postgresql:"].includes(parsed.protocol) || parsed.search || parsed.hash
    || !["localhost","127.0.0.1"].includes(parsed.hostname) || parsed.pathname !== "/lab_regression_ci") {
    throw new Error("Use only the owned disposable loopback lab_regression_ci database.");
  }
}
function barrier() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise,resolve };
}
async function enteredWithin(promise: Promise<void>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { await Promise.race([promise,new Promise<never>((_resolve,reject) => {
    timer = setTimeout(() => reject(new Error("Synthetic provider did not enter.")),2_000);
  })]); } finally { if (timer) clearTimeout(timer); }
}
type Headers = { authorization: string };
interface Fixture {
  app: Awaited<ReturnType<typeof buildApp>>; pool: Pool; control: Pool; accountId: string; userId: string;
  headers: Headers; login: () => Promise<Headers>; hold: () => void; release: () => void; entered: Promise<void>;
  controlApp: (pool?: Pool) => Promise<Awaited<ReturnType<typeof buildApp>>>;
  calls: () => number; answerBody: (body: string) => void;
  post: (key: string,headers?: Headers,objective?: string) => Promise<LightMyRequestResponse>;
}
async function withFixture(operation: (f: Fixture) => Promise<void>,checkpointAck?: {
  entered: ReturnType<typeof barrier>; release: ReturnType<typeof barrier>; loseAck?: boolean;
},disabled = false) {
  const actualPool = new Pool({ connectionString: database!,max: 1,connectionTimeoutMillis: 2_000,statement_timeout: 5_000,query_timeout: 6_000 });
  // Real PostgreSQL COMMIT first, controlled acknowledgement second. Pool.query
  // keeps its genuine callback implementation; only this app's explicit
  // borrowed client is wrapped. This is not a fake DB or production fault hook.
  const pool = checkpointAck ? new Proxy(actualPool,{ get(target,key) {
    if (key !== "connect") { const value = Reflect.get(target,key,target); return typeof value === "function" ? value.bind(target) : value; }
    return async () => {
      const client = await target.connect(); let checkpoint = false;
      return new Proxy(client,{ get(owner,name) {
        if (name !== "query") { const value = Reflect.get(owner,name,owner); return typeof value === "function" ? value.bind(owner) : value; }
        return (...args: unknown[]) => {
          const sql = typeof args[0] === "string" ? args[0] : "";
          if (sql.includes("state='result_ready',checkpoint=")) checkpoint = true;
          const result = Reflect.apply(owner.query,owner,args);
          if (sql === "COMMIT" && checkpoint) return Promise.resolve(result).then(async value => {
            checkpointAck.entered.resolve(); await checkpointAck.release.promise;
            if (checkpointAck.loseAck) throw new Error("Synthetic lost checkpoint acknowledgement.");
            return value;
          });
          return result;
        };
      } }) as PoolClient;
    };
  } }) : actualPool;
  const control = new Pool({ connectionString: database!,max: 2,connectionTimeoutMillis: 2_000,statement_timeout: 5_000,query_timeout: 6_000 });
  const accountId = randomUUID(),userId = randomUUID(),email = `legacy-recovery-${userId}@example.invalid`;
  const password = randomBytes(24).toString("base64url"),entered = barrier(),release = barrier();
  let app: Fixture["app"] | undefined,held = false,calls = 0,body = "Synthetic durable answer.";
  const pending: Promise<LightMyRequestResponse>[] = [];
  const otherApps: Awaited<ReturnType<typeof buildApp>>[] = [];
  const provider: RemoteChatAnswerProviding = { providerId: "deepseek-chat-completions",model: "synthetic-durable-recovery",
    supportsImageInput: false,answer: async (): Promise<RemoteChatAnswerResult> => {
      calls++; if (held) { entered.resolve(); await release.promise; }
      return { kind: "answer",title: "Synthetic reply",body,citation_ids: [],provider_id: "deepseek-chat-completions",
        model: provider.model,provider_request_id: null,input_tokens: 1,output_tokens: 1 };
    } };
  try {
    await inTransaction(control,async client => {
      await client.query("INSERT INTO accounts(id,slug,name) VALUES($1,$2,'Synthetic durable recovery')",[accountId,`legacy-recovery-${accountId}`]);
      await client.query("INSERT INTO account_email_reservations(normalized_email,state,account_id,user_id) VALUES($1,'owned',$2,$3)",[email,accountId,userId]);
      await client.query("INSERT INTO users(id,account_id,email,display_name,kind,username) VALUES($1,$2,$3,'Synthetic owner','password_human',$3)",[userId,accountId,email]);
      await client.query("INSERT INTO password_credentials(account_id,user_id,password_scrypt) VALUES($1,$2,$3)",[accountId,userId,await encodePasswordCredential(password)]);
    });
    const makeApp = (using: Pool) => buildApp({ pool: using,config: { databaseUrl: database!,host: "127.0.0.1",port: 0,allowedOrigins: [],
      appleSignInAudiences: [],appleSignInEnabled: false,passwordAuthEnabled: true,passwordRegistrationEnabled: false,
      simulatedAuthEnabled: false,internalLabEnabled: false,retentionSweepIntervalMs: 60_000,sessionTtlSeconds: 3_600 },
    remoteChatProvider: disabled ? null : provider,personResearchProvider: null,privateConversationProvider: null,labProviders: new Map(),
    labJobWorkerEnabled: false,conversationQueueWorkerEnabled: false,labCIVerifier: null,screenshotContact: null });
    app = await makeApp(pool);
    await app.ready();
    const product = app;
    const login = async () => {
      const result = await product.inject({ method: "POST",url: "/v1/auth/password/login",
        payload: { identifier: email,password,client_label: "Synthetic durable recovery" } });
      expect(result.statusCode).toBe(200); // Never include login body/credential in failure output.
      return { authorization: `Bearer ${result.json<{ access_token: string }>().access_token}` };
    };
    const headers = await login();
    await operation({ app: product,pool,control,accountId,userId,headers,login,hold: () => { held = true; },
      controlApp: async using => { const other = await makeApp(using ?? control); otherApps.push(other); await other.ready(); return other; },
      release: release.resolve,entered: entered.promise,calls: () => calls,answerBody: value => { body = value; },
      post: (key,current = headers,objective = "Reply with a synthetic greeting.") => {
        const result = product.inject({ method: "POST",url: "/v1/chat/unscoped-tasks",headers: current,
          payload: { idempotency_key: key,objective } }).then(response => response);
        pending.push(result); void result.catch(() => {}); return result;
      } });
  } finally {
    release.resolve(); checkpointAck?.release.resolve(); await Promise.allSettled(pending);
    try { await Promise.all(otherApps.map(other => other.close())); await app?.close(); }
    finally { await Promise.all([pool.end(),control.end()]); }
    // Only the Hosted owner destroys this generated disposable CI database.
  }
}

function rawPost(f: Fixture,key: string) {
  const address = f.app.server.address();
  if (!address || typeof address === "string") throw new Error("Synthetic loopback app is not listening.");
  const request = httpRequest({ hostname: "127.0.0.1",port: address.port,method: "POST",path: "/v1/chat/unscoped-tasks",
    agent: false,headers: { ...f.headers,"content-type": "application/json" } });
  const result = new Promise<{ status: number; body: string } | { closed: true }>(resolve => {
    request.on("error",() => resolve({ closed: true }));
    request.on("response",response => {
      let body = ""; response.setEncoding("utf8"); response.on("data",chunk => { body += chunk; });
      response.on("end",() => resolve({ status: response.statusCode!,body }));
      response.on("error",() => resolve({ closed: true }));
    });
  });
  request.end(JSON.stringify({ idempotency_key: key,objective: "Reply with a synthetic greeting." }));
  return { request,result };
}

async function mcpSession(f: Fixture,withReference = true) {
  const sessionID = randomUUID(),requestID = randomUUID(),stamp = new Date().toISOString();
  const created = await f.app.inject({ method: "PUT",url: `/v1/agent-sessions/${sessionID}`,headers: f.headers,
    payload: { expected_revision: 0,idempotency_key: randomUUID(),payload: { id: sessionID,scopeKind: "unresolved_intent",
      personDisplayLabel: "",contextDisplayLabel: "",title: "Synthetic source",turns: [],isUnread: false,createdAt: stamp,updatedAt: stamp } } });
  expect(created.statusCode).toBe(200);
  const revision = created.json<{ session: { revision: number } }>().session.revision;
  if (withReference) {
    // Canonical generated-only MCP staging fixture, with the real Session
    // created above. No invented HTTP AuthContext, remote tool or network call.
    const options = [{ id: "keep",label: "Keep" },{ id: "skip",label: "Skip" }];
    await f.control.query(`INSERT INTO mcp_interaction_requests(account_id,id,created_by_user_id,call_id,
      kind,state,purpose,target,arguments_display,choices,session_id,bound_arguments,expires_at)
      VALUES($1,$2,$3,$2,'choice','pending','Synthetic choice',$4::jsonb,$5,$6::jsonb,$7,$5,clock_timestamp()+interval '1 hour')`,
    [f.accountId,requestID,f.userId,JSON.stringify({ auth_mode: null,connection_label: "Choice",server_origin: "internal:choice",tool_name: null }),
      JSON.stringify({ options }),JSON.stringify(options),sessionID]);
  }
  expect((await f.control.query("SELECT count(*)::int AS count FROM memory_items WHERE account_id=$1",[f.accountId])).rows[0]?.count).toBe(0);
  const generation = async () => (await f.control.query<{ generation: string }>(
    "SELECT generation::text AS generation FROM harness_source_generations WHERE account_id=$1",[f.accountId])).rows[0]!.generation;
  return { sessionID,requestID,generation,async remove(using = f.app) {
    const deleted = await using.inject({ method: "DELETE",url: `/v1/agent-sessions/${sessionID}`,headers: f.headers,
      payload: { expected_revision: revision,idempotency_key: randomUUID() } });
    expect(deleted.statusCode).toBe(200);
  } };
}

async function assertRetiredMcpCopy(f: Fixture,key: string,completed: boolean) {
  const row = (await f.control.query<{ state: string; scrubbed: boolean; private_copy: boolean; paid_completion: boolean }>(`
    SELECT e.state,e.original_proof IS NULL AND e.source_snapshot IS NULL AND e.checkpoint IS NULL
      AND e.checkpoint_bytes IS NULL AND e.checkpoint_sha256 IS NULL AND e.checkpoint_expires_at IS NULL AS scrubbed,
      COALESCE(p.response_body::text LIKE '%Synthetic withdrawn%',false) AS private_copy,
      e.completed_at IS NOT NULL AS paid_completion
    FROM legacy_chat_executions e JOIN idempotency_records p ON p.account_id=e.account_id AND p.id=e.idempotency_id
    WHERE p.account_id=$1 AND p.idempotency_key=$2`,[f.accountId,key])).rows[0];
  expect(row).toEqual({ state: "content_unavailable",scrubbed: true,private_copy: false,paid_completion: completed });
}

describe.skipIf(!database)("durable legacy same-attempt recovery over actual handlers and PostgreSQL",() => {
  it("preserves disabled local201 without inventing a model descriptor or dispatch",async () => {
    await withFixture(async f => {
      const key = randomUUID(),first = await f.post(key); expect(first.statusCode).toBe(201); expect(f.calls()).toBe(0);
      const row = (await f.control.query<{ state: string; no_provider: boolean; no_dispatch: boolean; status: string }>(`
        SELECT e.state,e.frozen_provider IS NULL AS no_provider,e.dispatch_started_at IS NULL AS no_dispatch,
          a.metadata->>'remote_chat_status' AS status FROM legacy_chat_executions e
        JOIN idempotency_records p ON p.account_id=e.account_id AND p.id=e.idempotency_id
        JOIN audit_events a ON a.account_id=e.account_id AND a.entity_id=e.task_id AND a.event_type='unscoped_chat_task.completed'
        WHERE p.account_id=$1 AND p.idempotency_key=$2`,[f.accountId,key])).rows[0];
      expect(row).toEqual({ state: "completed",no_provider: true,no_dispatch: true,status: "disabled" });
      const replay = await f.post(key); expect(replay.statusCode).toBe(201); expect(replay.json()).toEqual(first.json()); expect(f.calls()).toBe(0);
    },undefined,true);
  });
  it("lets a duplicate wait without retaining the only client and publishes one canonical answer/audit",async () => {
    await withFixture(async f => {
      f.hold(); const key = randomUUID(),owner = f.post(key); await enteredWithin(f.entered);
      const waiter = f.post(key); await new Promise(resolve => setTimeout(resolve,30));
      expect((await f.pool.query("SELECT 1 AS heartbeat")).rows[0]?.heartbeat).toBe(1);
      const mismatch = await f.post(key,f.headers,"A different synthetic intent.");
      expect(mismatch.statusCode).toBe(409); expect(mismatch.json<{ error: { code: string } }>().error.code).toBe("IDEMPOTENCY_KEY_REUSED");
      expect(f.calls()).toBe(1); f.release();
      const [first,second] = await Promise.all([owner,waiter]);
      expect(first.statusCode).toBe(201); expect(second.statusCode).toBe(201);
      const taskID = first.json<{ task_id: string }>().task_id;
      expect(second.json<{ task_id: string }>().task_id).toBe(taskID);
      expect(second.headers["idempotent-replayed"]).toBe("true"); expect(f.calls()).toBe(1);
      const row = (await f.control.query<{ attempts: number; audits: number; scrubbed: boolean }>(`SELECT
        (SELECT count(*)::int FROM legacy_chat_executions WHERE account_id=$1 AND task_id=$2) AS attempts,
        (SELECT count(*)::int FROM audit_events WHERE account_id=$1 AND entity_id=$2 AND event_type='unscoped_chat_task.completed') AS audits,
        (SELECT state='completed' AND original_proof IS NULL AND source_snapshot IS NULL AND checkpoint IS NULL
          FROM legacy_chat_executions WHERE account_id=$1 AND task_id=$2) AS scrubbed`,[f.accountId,taskID])).rows[0];
      expect(row).toEqual({ attempts: 1,audits: 1,scrubbed: true });
    });
  });

  it("keeps a paid-dispatch key terminal when its result cannot enter PostgreSQL JSONB",async () => {
    await withFixture(async f => {
      expect((await f.post(randomUUID())).statusCode).toBe(201);
      f.answerBody("Synthetic private NUL\0tail."); const key = randomUUID();
      expect((await f.post(key)).statusCode).toBe(409); expect(f.calls()).toBe(2);
      const status = await f.app.inject({ method: "GET",url: `/v1/chat/unscoped-task-status?idempotency_key=${key}`,headers: f.headers });
      expect(status.statusCode).toBe(200); expect(status.json<{ state: string }>().state).toBe("result_unavailable");
      expect(status.body.includes("Synthetic private")).toBe(false);
      expect((await f.post(key)).statusCode).toBe(409);
      expect((await f.app.inject({ method: "POST",url: "/v1/chat/unscoped-task-resolve",headers: f.headers,
        payload: { idempotency_key: key } })).statusCode).toBe(409); expect(f.calls()).toBe(2);
      const row = (await f.control.query<{ scrubbed: boolean }>(`SELECT e.original_proof IS NULL
        AND e.source_snapshot IS NULL AND e.checkpoint IS NULL AND e.checkpoint_sha256 IS NULL AS scrubbed
        FROM legacy_chat_executions e JOIN idempotency_records p ON p.account_id=e.account_id AND p.id=e.idempotency_id
        WHERE p.account_id=$1 AND p.idempotency_key=$2`,[f.accountId,key])).rows[0];
      expect(row?.scrubbed).toBe(true);
    });
  });

  it("permits a fresh same-actor login to cancel without renewing the dead original dispatch proof",async () => {
    await withFixture(async f => {
      f.hold(); const key = randomUUID(),pending = f.post(key); await enteredWithin(f.entered);
      expect((await f.app.inject({ method: "POST",url: "/v1/auth/logout",headers: f.headers })).statusCode).toBe(200);
      const fresh = await f.login();
      const cancelled = await f.app.inject({ method: "POST",url: "/v1/chat/unscoped-task-cancel",headers: fresh,
        payload: { idempotency_key: key } });
      expect(cancelled.statusCode).toBe(200); expect(cancelled.json<{ state: string }>().state).toBe("cancelled");
      f.release(); expect((await pending).statusCode).toBe(409);
      expect((await f.post(key,fresh)).statusCode).toBe(409); expect(f.calls()).toBe(1);
    });
  });

  it("reads the same lawful completed answer with a new login after its original credential is revoked",async () => {
    await withFixture(async f => {
      const key = randomUUID(),first = await f.post(key); expect(first.statusCode).toBe(201);
      expect((await f.app.inject({ method: "POST",url: "/v1/auth/logout",headers: f.headers })).statusCode).toBe(200);
      const fresh = await f.login();
      for (const operation of ["status","resolve"] as const) {
        const replay = operation === "status"
          ? await f.app.inject({ method: "GET",url: `/v1/chat/unscoped-task-status?idempotency_key=${key}`,headers: fresh })
          : await f.app.inject({ method: "POST",url: "/v1/chat/unscoped-task-resolve",headers: fresh,payload: { idempotency_key: key } });
        expect(replay.statusCode).toBe(201); expect(replay.json()).toEqual(first.json());
        expect(replay.headers["idempotent-replayed"]).toBe("true");
      }
      expect(f.calls()).toBe(1);
    });
  });

  it("does not cancel owner A when duplicate waiter B disconnects over real TCP",async () => {
    await withFixture(async f => {
      await f.app.listen({ host: "127.0.0.1",port: 0 });
      f.hold(); const key = randomUUID(),owner = rawPost(f,key); await enteredWithin(f.entered);
      const waiter = rawPost(f,key);
      try {
        let returned = false; void waiter.result.then(() => { returned = true; });
        await new Promise(resolve => setTimeout(resolve,40)); expect(returned).toBe(false);
        waiter.request.destroy(); expect(await waiter.result).toEqual({ closed: true });
        expect((await f.pool.query("SELECT 1 AS tcp_waiter_heartbeat")).rows[0]?.tcp_waiter_heartbeat).toBe(1);
        f.release(); const answer = await owner.result;
        expect(answer).toHaveProperty("status",201); expect(f.calls()).toBe(1);
        const row = (await f.control.query<{ state: string }>(`SELECT e.state FROM legacy_chat_executions e
          JOIN idempotency_records p ON p.account_id=e.account_id AND p.id=e.idempotency_id
          WHERE p.account_id=$1 AND p.idempotency_key=$2`,[f.accountId,key])).rows[0];
        expect(row?.state).toBe("completed");
      } finally { waiter.request.destroy(); owner.request.destroy(); }
    });
  });

  it("retires the actual TCP owner and rejects a provider that ignores the disconnect",async () => {
    await withFixture(async f => {
      await f.app.listen({ host: "127.0.0.1",port: 0 });
      f.hold(); const key = randomUUID(),owner = rawPost(f,key); await enteredWithin(f.entered);
      try {
        owner.request.destroy(); expect(await owner.result).toEqual({ closed: true });
        let state: string | undefined;
        const until = performance.now()+2_000;
        do {
          state = (await f.control.query<{ state: string }>(`SELECT e.state FROM legacy_chat_executions e
            JOIN idempotency_records p ON p.account_id=e.account_id AND p.id=e.idempotency_id
            WHERE p.account_id=$1 AND p.idempotency_key=$2`,[f.accountId,key])).rows[0]?.state;
          if (state !== "cancelled") await new Promise(resolve => setTimeout(resolve,20));
        } while (state !== "cancelled" && performance.now()<until);
        expect(state).toBe("cancelled"); f.release();
        const retry = await f.post(key); expect(retry.statusCode).toBe(409); expect(f.calls()).toBe(1);
        const row = (await f.control.query<{ saved: number; scrubbed: boolean }>(`SELECT
          (SELECT count(*)::int FROM idempotency_records WHERE account_id=$1 AND idempotency_key=$2 AND status='completed') AS saved,
          (SELECT e.checkpoint IS NULL AND e.original_proof IS NULL AND e.source_snapshot IS NULL
            FROM legacy_chat_executions e JOIN idempotency_records p ON p.account_id=e.account_id AND p.id=e.idempotency_id
            WHERE p.account_id=$1 AND p.idempotency_key=$2) AS scrubbed`,[f.accountId,key])).rows[0];
        expect(row).toEqual({ saved: 0,scrubbed: true });
      } finally { owner.request.destroy(); }
    });
  });

  it.each(["delete","expire"] as const)("prevents future private backfill when the MCP Session is withdrawn during dispatch by %s",async kind => {
    await withFixture(async f => {
      const source = await mcpSession(f),before = await source.generation(),key = randomUUID();
      f.answerBody(`Synthetic withdrawn future ${source.requestID}`); f.hold();
      const pending = f.post(key); await enteredWithin(f.entered);
      if (kind === "delete") await source.remove();
      else {
        await f.control.query(`UPDATE agent_sessions SET created_at=LEAST(created_at,clock_timestamp()-interval '2 days'),
          expires_at=clock_timestamp()-interval '1 second' WHERE account_id=$1 AND id=$2`,[f.accountId,source.sessionID]);
        const swept = await f.app.inject({ method: "GET",url: `/v1/agent-sessions/${source.sessionID}`,headers: f.headers });
        expect(swept.statusCode).toBe(200); expect(swept.json<{ session: { deleted_at: string | null } }>().session.deleted_at).not.toBeNull();
      }
      expect(BigInt(await source.generation())).toBeGreaterThan(BigInt(before));
      f.release(); const denied = await pending;
      expect(denied.statusCode).toBe(409); expect(denied.body.includes("Synthetic withdrawn")).toBe(false);
      await assertRetiredMcpCopy(f,key,false);
      expect((await f.post(key)).statusCode).toBe(409); expect(f.calls()).toBe(1);
    });
  });

  it.each([false,true])("scrubs an actually committed ready checkpoint while its acknowledgement is delayed (lost=%s)",async loseAck => {
    const ack = { entered: barrier(),release: barrier(),loseAck };
    await withFixture(async f => {
      const source = await mcpSession(f),key = randomUUID(); f.answerBody(`Synthetic withdrawn ready ${source.requestID}`);
      const pending = f.post(key); await enteredWithin(ack.entered.promise);
      const ready = (await f.control.query<{ state: string; durable: boolean }>(`SELECT e.state,
        e.checkpoint LIKE '%'||$3||'%' AND p.response_body IS NULL AS durable FROM legacy_chat_executions e
        JOIN idempotency_records p ON p.account_id=e.account_id AND p.id=e.idempotency_id
        WHERE p.account_id=$1 AND p.idempotency_key=$2`,[f.accountId,key,source.requestID])).rows[0];
      expect(ready).toEqual({ state: "result_ready",durable: true });
      const controlApp = await f.controlApp(); await source.remove(controlApp);
      await assertRetiredMcpCopy(f,key,false); ack.release.resolve();
      expect((await pending).statusCode).toBe(409); expect(f.calls()).toBe(1);
      expect((await f.post(key)).statusCode).toBe(409); expect(f.calls()).toBe(1);
    },ack);
  });

  it("retires a completed private copy without erasing its truthful paid-completion fact or key",async () => {
    await withFixture(async f => {
      const source = await mcpSession(f),key = randomUUID(); f.answerBody(`Synthetic withdrawn completed ${source.requestID}`);
      const completed = await f.post(key); expect(completed.statusCode).toBe(201);
      expect(completed.json<{ blocks: { body: string }[] }>().blocks[0].body)
        .toBe(`Synthetic withdrawn completed ${source.requestID}`);
      await source.remove(); await assertRetiredMcpCopy(f,key,true);
      expect((await f.post(key)).statusCode).toBe(409);
      const status = await f.app.inject({ method: "GET",url: `/v1/chat/unscoped-task-status?idempotency_key=${key}`,headers: f.headers });
      expect(status.statusCode).toBe(200); expect(status.json<{ state: string }>().state).toBe("content_unavailable");
      expect(status.body.includes("Synthetic withdrawn")).toBe(false); expect(f.calls()).toBe(1);
    });
  });

  it("keeps unrelated lawful completed content and does not revoke active work for an empty Session",async () => {
    await withFixture(async f => {
      const source = await mcpSession(f),key = randomUUID();
      f.answerBody(`Unrelated completed ${randomUUID()}`); const completed = await f.post(key); expect(completed.statusCode).toBe(201);
      await source.remove(); const replay = await f.post(key); expect(replay.statusCode).toBe(201); expect(replay.json()).toEqual(completed.json());
      const empty = await mcpSession(f,false),before = await empty.generation();
      f.hold(); const next = f.post(randomUUID()); await enteredWithin(f.entered); await empty.remove();
      expect(await empty.generation()).toBe(before); f.release(); expect((await next).statusCode).toBe(201); expect(f.calls()).toBe(2);
    });
  });

  it("keeps original publisher A live but denies a resolve reader B revoked after its initial read",async () => {
    const ack = { entered: barrier(),release: barrier() },restoring = barrier(),continueRestore = barrier();
    await withFixture(async f => {
      const readerB = await f.login(),key = randomUUID(),owner = f.post(key);
      let resolving: Promise<LightMyRequestResponse> | undefined;
      try {
        await enteredWithin(ack.entered.promise); // Real ready checkpoint committed under original login A.
        // Only narrow the dead-lease fixture; original proof/source/execution
        // deadlines remain unchanged and no replacement attempt is permitted.
        await f.control.query(`UPDATE legacy_chat_executions e SET lease_until=clock_timestamp()-interval '1 millisecond'
          FROM idempotency_records p WHERE p.account_id=e.account_id AND p.id=e.idempotency_id
            AND p.account_id=$1 AND p.idempotency_key=$2 AND e.state='result_ready'`,[f.accountId,key]);
        const resolverPool = new Proxy(f.control,{ get(target,name) {
          const value = Reflect.get(target,name,target);
          if (name !== "query") return typeof value === "function" ? value.bind(target) : value;
          return (...args: unknown[]) => {
            const result = Reflect.apply(target.query,target,args),sql = args[0];
            if (typeof sql === "string" && sql.includes("LEAST($9::timestamptz")) return Promise.resolve(result).then(async row => {
              restoring.resolve(); await continueRestore.promise; return row;
            });
            return result;
          };
        } });
        const resolver = await f.controlApp(resolverPool),control = await f.controlApp();
        resolving = resolver.inject({ method: "POST",url: "/v1/chat/unscoped-task-resolve",headers: readerB,
          payload: { idempotency_key: key } }).then(response => response);
        void resolving.catch(() => {}); await enteredWithin(restoring.promise);
        expect((await control.inject({ method: "POST",url: "/v1/auth/logout",headers: readerB })).statusCode).toBe(200);
        expect((await control.inject({ method: "GET",url: "/v1/auth/session",headers: readerB })).statusCode).toBe(401);
        expect((await control.inject({ method: "GET",url: "/v1/auth/session",headers: f.headers })).statusCode).toBe(200);
        continueRestore.resolve(); const denied = await resolving;
        expect(denied.statusCode).toBe(409); expect(denied.body.includes("Synthetic durable answer")).toBe(false);
        ack.release.resolve(); await owner;
        const lawful = await control.inject({ method: "GET",url: `/v1/chat/unscoped-task-status?idempotency_key=${key}`,headers: f.headers });
        expect(lawful.statusCode).toBe(201); expect(lawful.json<{ blocks: { body: string }[] }>().blocks[0]?.body).toBe("Synthetic durable answer.");
        expect(f.calls()).toBe(1);
      } finally { continueRestore.resolve(); ack.release.resolve(); await resolving?.catch(() => undefined); }
    },ack);
  });
});
