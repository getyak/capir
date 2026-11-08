import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SessionResponse } from "@talent-signal/contracts";
import type { LightMyRequestResponse } from "fastify";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";

import { buildApp } from "../app.js";
import type { BackendConfig } from "../config.js";
import { inTransaction } from "../database/pool.js";
import type { RemoteChatAnswerProviding, RemoteChatAnswerResult } from "./chatAnswerProvider.js";
import { LocalChatMediaStorage } from "./chatMediaStorage.js";
import { LabWorkspaceService } from "./labWorkspaces.js";
import { encodePasswordCredential } from "./passwordCredential.js";

const database = process.env.CONTACT_AGENT_TEST_DATABASE_URL;
if (database) {
  let parsed: URL;
  try { parsed = new URL(database); } catch { throw new Error("Use only the owned disposable loopback lab_regression_ci database."); }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol) || parsed.search || parsed.hash
    || !["localhost", "127.0.0.1"].includes(parsed.hostname) || parsed.pathname !== "/lab_regression_ci") {
    throw new Error("Use only the owned disposable loopback lab_regression_ci database.");
  }
}

function barrier() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

async function within<T>(work: Promise<T>, code: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(code)), 2_000);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

type Provisioning = "human-workspace" | "user-grant";
type Headers = { authorization: string };
type ProductApp = Awaited<ReturnType<typeof buildApp>>;
interface Fixture {
  pool: Pool;
  control: Pool;
  storage: LocalChatMediaStorage;
  accountId: string;
  userId: string;
  childSessionId: string;
  workspaceId: string;
  parentAccountId: string;
  parentUserId: string;
  parentSessionId: string;
  grantId: string | null;
  entered: Promise<void>;
  calls(): number;
  heldCalls(): number;
  released(): boolean;
  hold(): void;
  release(): void;
  post(key: string): Promise<LightMyRequestResponse>;
  childAuth(): Promise<number>;
  parentAuth(): Promise<number>;
  stop(): Promise<LightMyRequestResponse>;
  revokeGrant(): Promise<LightMyRequestResponse>;
}

// This fixture deliberately does not import another .test module. It uses the
// same real password/PKCE/create/entry owners as the phase1 Lab regressions,
// with a different actual answer-only adapter and a genuine max=1 product pool.
async function withLabFixture(kind: Provisioning, operation: (fixture: Fixture) => Promise<void>) {
  const pool = new Pool({ connectionString: database!, max: 1, connectionTimeoutMillis: 2_000,
    statement_timeout: 5_000, query_timeout: 6_000 });
  const control = new Pool({ connectionString: database!, max: 3, connectionTimeoutMillis: 2_000,
    statement_timeout: 5_000, query_timeout: 6_000 });
  const entered = barrier(), released = barrier();
  const parentAccountId = randomUUID(), parentUserId = randomUUID();
  const email = `legacy-short-lab-${parentUserId}@example.invalid`;
  const password = randomBytes(24).toString("base64url");
  const web = "https://legacy-short-lab-web.test.invalid", backend = "https://legacy-short-lab-api.test.invalid";
  const requests: Promise<LightMyRequestResponse>[] = [];
  let directory: string | undefined, storage: LocalChatMediaStorage | undefined;
  let app: ProductApp | undefined, observer: ProductApp | undefined;
  let held = false, releaseCalled = false, calls = 0, heldCalls = 0;
  const release = () => { releaseCalled = true; released.resolve(); };
  const answer: RemoteChatAnswerResult = { kind: "answer", title: "Synthetic short Lab reply",
    body: "Synthetic short-slice Lab answer.", citation_ids: [], provider_id: "deepseek-chat-completions",
    model: "synthetic-short-lab", provider_request_id: null, input_tokens: 3, output_tokens: 2 };
  // No run, runWithPromptPreset, tools or product Session. This synthetic
  // delegate ignores cancellation until explicitly released; no model/network.
  const provider: RemoteChatAnswerProviding = { providerId: answer.provider_id, model: answer.model,
    supportsImageInput: false, answer: async () => {
      calls++;
      if (held) { heldCalls++; entered.resolve(); await released.promise; }
      return answer;
    } };
  const track = (request: PromiseLike<LightMyRequestResponse>) => {
    const pending = Promise.resolve(request); requests.push(pending);
    void pending.catch(() => {}); return pending;
  };
  try {
    directory = await mkdtemp(join(tmpdir(), "capir-legacy-short-lab-"));
    storage = new LocalChatMediaStorage(directory);
    const config: BackendConfig = { databaseUrl: database!, host: "127.0.0.1", port: 0, allowedOrigins: [web],
      appleSignInAudiences: [], appleSignInEnabled: false, simulatedAuthEnabled: false,
      passwordAuthEnabled: true, passwordRegistrationEnabled: false, internalLabEnabled: true,
      retentionSweepIntervalMs: 60_000, sessionTtlSeconds: 3_600,
      chatMediaStorage: { provider: "local", directory },
      capirAuth: { enabled: true, webOrigin: web, backendOrigin: backend, codeTtlSeconds: 60,
        accessTtlSeconds: 60, refreshIdleTtlSeconds: 600, refreshAbsoluteTtlSeconds: 3_600 },
      capirTests: { enabled: true, provisioningKey: randomBytes(32).toString("base64url"), provisioningGeneration: 1,
        webOrigin: web, backendOrigin: backend, webConsumerKey: randomBytes(32).toString("base64url"), maxActiveRuns: 8 } };
    await inTransaction(control, async client => {
      await client.query("INSERT INTO accounts(id,slug,name) VALUES($1,$2,'Synthetic short-slice Lab parent')",
        [parentAccountId, `legacy-short-lab-${parentAccountId}`]);
      await client.query("INSERT INTO account_email_reservations(normalized_email,state,account_id,user_id) VALUES($1,'owned',$2,$3)",
        [email, parentAccountId, parentUserId]);
      await client.query("INSERT INTO users(id,account_id,email,display_name,kind,username) VALUES($1,$2,$3,'Synthetic parent','password_human',$3)",
        [parentUserId, parentAccountId, email]);
      await client.query("INSERT INTO password_credentials(account_id,user_id,password_scrypt) VALUES($1,$2,$3)",
        [parentAccountId, parentUserId, await encodePasswordCredential(password)]);
    });
    const dependencies = { config, chatMediaStorage: storage, personResearchProvider: null, privateConversationProvider: null,
      labProviders: new Map(), labJobWorkerEnabled: false, conversationQueueWorkerEnabled: false,
      labCIVerifier: null, screenshotContact: null };
    app = await buildApp({ ...dependencies, pool, remoteChatProvider: provider });
    observer = await buildApp({ ...dependencies, pool: control, remoteChatProvider: null });
    await app.ready(); await observer.ready();
    const product = app, owner = observer;
    const login = await owner.inject({ method: "POST", url: "/v1/auth/password/login",
      payload: { identifier: email, password, client_label: "Synthetic short Lab parent" } });
    expect(login.statusCode).toBe(200); // Never print login body or bearer.
    const parent = login.json<SessionResponse>();
    const parentHeaders = { authorization: `Bearer ${parent.access_token}` };
    const parentCurrent = await owner.inject({ method: "GET", url: "/v1/auth/session", headers: parentHeaders });
    expect(parentCurrent.statusCode).toBe(200);
    const parentSessionId = parentCurrent.json<SessionResponse>().session_id;
    if (!parentSessionId) throw new Error("The real synthetic parent session identity was not returned.");
    let child: SessionResponse, workspaceId: string, grantId: string | null = null;
    if (kind === "user-grant") {
      // Only server-owned entitlement is generated setup; actual consent, PKCE,
      // grant, provisioning and child login all go through production handlers.
      await control.query(`INSERT INTO capir_user_test_entitlements(id,account_id,user_id,scopes,state,granted_by)
        VALUES($1,$2,$3,ARRAY['test.create','test.status','test.stop','test.handoff'],'active','Synthetic GET449 short Lab proof')`,
      [randomUUID(), parentAccountId, parentUserId]);
      const verifier = randomBytes(32).toString("base64url"), state = randomBytes(32).toString("base64url");
      const redirect = "http://127.0.0.1:49381/capir/callback";
      const authorized = await owner.inject({ method: "POST", url: "/v1/capir/auth/authorize", headers: parentHeaders,
        payload: { schema_version: "capir-auth.v2", redirect_uri: redirect, state,
          code_challenge: createHash("sha256").update(verifier, "ascii").digest("base64url"), code_challenge_method: "S256",
          web_origin: web, backend_origin: backend, scopes: ["grants.read", "grants.revoke", "test.create", "test.status", "test.stop", "test.handoff"],
          consent: true, client_label: "Synthetic short Lab grant" } });
      expect(authorized.statusCode).toBe(200);
      const exchanged = await owner.inject({ method: "POST", url: "/v1/capir/auth/exchange",
        payload: { schema_version: "capir-auth.v2", code: authorized.json<{ code: string }>().code,
          code_verifier: verifier, state, redirect_uri: redirect, web_origin: web, backend_origin: backend } });
      expect(exchanged.statusCode).toBe(200);
      const grant = exchanged.json<{ access_token: string; grant: { id: string } }>(); grantId = grant.grant.id;
      const childPassword = randomBytes(32).toString("base64url");
      const created = await owner.inject({ method: "POST", url: "/v1/capir/tests",
        headers: { authorization: `Bearer ${grant.access_token}`, "x-capir-backend-origin": backend },
        payload: { request_id: randomUUID(), password: childPassword, preset: "empty", duration_hours: 1, web_origin: web, backend_origin: backend } });
      expect(created.statusCode).toBe(200);
      const run = created.json<{ run: { id: string; username: string; state: string } }>().run;
      expect(run.state).toBe("ready"); workspaceId = run.id;
      const admitted = await owner.inject({ method: "POST", url: "/v1/auth/password/login",
        payload: { identifier: run.username, password: childPassword, client_label: "Synthetic short Lab child" } });
      expect(admitted.statusCode).toBe(200); child = admitted.json<SessionResponse>();
    } else {
      workspaceId = randomUUID();
      const created = await owner.inject({ method: "POST", url: "/v1/lab/workspaces", headers: parentHeaders,
        payload: { id: workspaceId, duration_hours: 1 } });
      expect(created.statusCode).toBe(200);
      expect(created.json<{ workspace: { state: string } }>().workspace.state).toBe("active");
      const entryToken = randomBytes(32).toString("base64url");
      const admitted = await owner.inject({ method: "POST", url: `/v1/lab/workspaces/${workspaceId}/entries`, headers: parentHeaders,
        payload: { id: randomUUID(), access_token: entryToken } });
      expect(admitted.statusCode).toBe(200);
      expect(admitted.json<{ entry: { state: string } }>().entry.state).toBe("active");
      const current = await owner.inject({ method: "GET", url: "/v1/auth/session", headers: { authorization: `Bearer ${entryToken}` } });
      expect(current.statusCode).toBe(200); child = { ...current.json<SessionResponse>(), access_token: entryToken };
    }
    const childHeaders = { authorization: `Bearer ${child.access_token}` };
    const currentChild = await owner.inject({ method: "GET", url: "/v1/auth/session", headers: childHeaders });
    expect(currentChild.statusCode).toBe(200);
    const observed = currentChild.json<SessionResponse>();
    expect(observed.account.id).toBe(child.account.id); expect(observed.user.id).toBe(child.user.id);
    expect(observed.user.kind).toBe("lab_human");
    if (!observed.session_id) throw new Error("The real synthetic Lab child session identity was not returned.");
    await operation({ pool, control, storage, accountId: child.account.id, userId: child.user.id,
      childSessionId: observed.session_id, workspaceId, parentAccountId, parentUserId, parentSessionId, grantId,
      entered: entered.promise, calls: () => calls, heldCalls: () => heldCalls, released: () => releaseCalled,
      hold: () => { held = true; }, release,
      post: key => track(product.inject({ method: "POST", url: "/v1/chat/unscoped-tasks", headers: childHeaders,
        payload: { idempotency_key: key, objective: "Reply with a synthetic short greeting." } })),
      childAuth: async () => (await owner.inject({ method: "GET", url: "/v1/auth/session", headers: childHeaders })).statusCode,
      parentAuth: async () => (await owner.inject({ method: "GET", url: "/v1/auth/session", headers: parentHeaders })).statusCode,
      stop: () => track(owner.inject({ method: "POST", url: `/v1/lab/workspaces/${workspaceId}/stop`, headers: parentHeaders,
        payload: { id: randomUUID() } })),
      revokeGrant: () => {
        if (grantId === null) throw new Error("This synthetic fixture has no grant to revoke.");
        return track(owner.inject({ method: "POST", url: "/v1/capir/auth/grants/revoke", headers: parentHeaders,
          payload: { schema_version: "capir-auth.v2", grant_id: grantId } }));
      },
    });
  } finally {
    release();
    try { await Promise.allSettled(requests); }
    finally {
      try {
        if (storage) {
          // Finally-only hygiene uses the canonical owner, never unguarded SQL
          // graph deletion. Parent remains valid until the test DB owner drops it.
          const service = new LabWorkspaceService(control, storage, 3_600);
          const owned = await control.query<{ id: string }>(`SELECT id FROM lab_test_workspaces
            WHERE owner_account_id=$1 AND owner_user_id=$2 AND state<>'deleted'`, [parentAccountId, parentUserId]);
          for (const row of owned.rows) await service.stopOperatorRun(row.id, randomUUID());
        }
      } finally {
        try { await app?.close(); }
        finally {
          try { await observer?.close(); }
          finally {
            try { await Promise.all([pool.end(), control.end()]); }
            finally { if (directory) await rm(directory, { recursive: true, force: true }); }
          }
        }
      }
    }
  }
}

async function assertParent(f: Fixture) {
  expect(await f.parentAuth()).toBe(200);
  const row = (await f.control.query<{ live: number }>(`SELECT count(*)::int AS live FROM accounts a
    JOIN users u ON u.account_id=a.id AND u.id=$2 JOIN sessions s ON s.account_id=a.id AND s.user_id=u.id AND s.id=$3
    WHERE a.id=$1 AND a.retired_at IS NULL AND u.status='active' AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp()`,
  [f.parentAccountId, f.parentUserId, f.parentSessionId])).rows[0];
  expect(row?.live).toBe(1);
}

async function assertEmpty(f: Fixture) {
  const service = new LabWorkspaceService(f.control, f.storage, 3_600);
  expect(await service.dataRows(f.control, f.accountId, await service.tables())).toBe(0);
  const row = (await f.control.query<{ ledgers: number; canonical: number; sessions: number; credentials: number; revoked_children: number }>(`SELECT
    (SELECT count(*)::int FROM legacy_chat_executions WHERE account_id=$1) AS ledgers,
    (SELECT count(*)::int FROM idempotency_records WHERE account_id=$1) AS canonical,
    (SELECT count(*)::int FROM sessions WHERE account_id=$1) AS sessions,
    (SELECT count(*)::int FROM password_credentials WHERE account_id=$1) AS credentials,
    (SELECT count(*)::int FROM users WHERE account_id=$1 AND id=$2 AND kind='lab_human' AND status='revoked') AS revoked_children`,
  [f.accountId, f.userId])).rows[0];
  expect(row).toEqual({ ledgers: 0, canonical: 0, sessions: 0, credentials: 0, revoked_children: 1 });
}

function assertStopped(response: LightMyRequestResponse) {
  expect(response.statusCode).toBe(200);
  const workspace = response.json<{ workspace: { state: string; data_rows: number | null; active_sessions: number;
    cleanup_error: string | null; pending_media_writes: number } }>().workspace;
  expect(workspace).toMatchObject({ state: "deleted", data_rows: 0, active_sessions: 0, cleanup_error: null, pending_media_writes: 0 });
}

function assertDenied(response: LightMyRequestResponse) {
  expect(response.statusCode).toBe(409);
  expect(response.json<{ error: { code: string } }>().error.code).toBe("LEGACY_CHAT_AUTHORITY_UNAVAILABLE");
  expect(response.body.includes("Synthetic short-slice Lab answer.")).toBe(false);
}

describe.skipIf(!database)("durable answer-only Lab lifecycle through actual HTTP/auth and PostgreSQL", () => {
  it.each(["human-workspace", "user-grant"] as const)("releases max1 and prevents late publication after actual %s withdrawal", async kind => {
    await withLabFixture(kind, async f => {
      expect(await f.childAuth()).toBe(200); await assertParent(f);
      const positiveKey = randomUUID(), key = randomUUID(), positive = await f.post(positiveKey);
      expect(positive.statusCode).toBe(201);
      expect(positive.json<{ blocks: { body: string }[] }>().blocks[0]?.body === "Synthetic short-slice Lab answer.").toBe(true);
      expect(f.calls()).toBe(1);
      f.hold(); const pending = f.post(key); await within(f.entered, "Synthetic Lab provider did not enter.");
      expect(f.calls()).toBe(2); expect(f.heldCalls()).toBe(1); expect(f.released()).toBe(false);
      expect((await f.pool.query("SELECT 1 AS short_lab_heartbeat")).rows[0]?.short_lab_heartbeat).toBe(1);
      const held = (await f.control.query<{ state: string; provider: boolean; no_session: boolean; product_sessions: number }>(`SELECT
        e.state,e.frozen_provider->>'providerID'='deepseek-chat-completions' AS provider,
        e.source_snapshot->'sessionStamp'='null'::jsonb AND e.source_snapshot->'personIDs'='[]'::jsonb AS no_session,
        (SELECT count(*)::int FROM agent_sessions WHERE account_id=$1) AS product_sessions
        FROM legacy_chat_executions e JOIN idempotency_records p ON p.account_id=e.account_id AND p.id=e.idempotency_id
        WHERE p.account_id=$1 AND p.actor_user_id=$2 AND p.idempotency_key=$3`, [f.accountId, f.userId, key])).rows[0];
      expect(held).toEqual({ state: "dispatch_started", provider: true, no_session: true, product_sessions: 0 });
      if (kind === "human-workspace") {
        // Unlike the old ineligible/atomic phase1 fixture, a short-slice owner
        // holds no workspace SHARE while its real answer delegate is waiting.
        assertStopped(await within(f.stop(), "Lab stop did not complete while its answer was held."));
        expect(f.released()).toBe(false); expect(await f.childAuth()).toBe(401);
        await assertEmpty(f); await assertParent(f);
        f.release(); assertDenied(await pending);
        await assertEmpty(f); // Late callback cannot regrow any private data.
      } else {
        expect((await within(f.revokeGrant(), "Grant withdrawal did not complete while its answer was held.")).statusCode).toBe(200);
        expect(f.released()).toBe(false); expect(await f.childAuth()).toBe(401); await assertParent(f);
        const lineage = (await f.control.query<{ state: string; grant_revoked: boolean; child_session_live: boolean; entry_live: boolean }>(`SELECT
          w.state,EXISTS(SELECT 1 FROM capir_auth_grants g JOIN sessions s ON s.id=g.backing_session_id
            WHERE g.id=$3 AND g.account_id=$4 AND g.user_id=$5 AND g.state='revoked' AND s.revoked_at IS NOT NULL) AS grant_revoked,
          EXISTS(SELECT 1 FROM sessions WHERE account_id=$1 AND id=$2 AND revoked_at IS NULL AND expires_at>clock_timestamp()) AS child_session_live,
          EXISTS(SELECT 1 FROM lab_test_workspace_entries WHERE workspace_id=w.id AND session_id=$2 AND revoked_at IS NULL
            AND expires_at>clock_timestamp()) AS entry_live
          FROM lab_test_workspaces w WHERE w.id=$6 AND w.target_account_id=$1`,
        [f.accountId, f.childSessionId, f.grantId, f.parentAccountId, f.parentUserId, f.workspaceId])).rows[0];
        expect(lineage).toEqual({ state: "active", grant_revoked: true, child_session_live: true, entry_live: true });
        f.release(); assertDenied(await pending);
        const attempts = (await f.control.query<{ attempts: number; completed: number; scrubbed: boolean;
          canonical_private_absent: boolean; completion_audits: number; prior_unchanged: boolean }>(`SELECT
          (SELECT count(*)::int FROM idempotency_records WHERE account_id=$1 AND actor_user_id=$2 AND idempotency_key=$3) AS attempts,
          (SELECT count(*)::int FROM idempotency_records WHERE account_id=$1 AND actor_user_id=$2 AND idempotency_key=$3
            AND status='completed' AND response_status<400) AS completed,
          (SELECT e.state='authority_lost' AND e.original_proof IS NULL AND e.source_snapshot IS NULL AND e.checkpoint IS NULL
            AND e.checkpoint_bytes IS NULL AND e.checkpoint_sha256 IS NULL AND e.checkpoint_expires_at IS NULL
            FROM legacy_chat_executions e JOIN idempotency_records p ON p.account_id=e.account_id AND p.id=e.idempotency_id
            WHERE p.account_id=$1 AND p.actor_user_id=$2 AND p.idempotency_key=$3) AS scrubbed,
          (SELECT status='processing' AND response_body IS NULL AND response_status IS NULL FROM idempotency_records
            WHERE account_id=$1 AND actor_user_id=$2 AND idempotency_key=$3) AS canonical_private_absent,
          (SELECT count(*)::int FROM audit_events a JOIN legacy_chat_executions e ON a.account_id=e.account_id AND a.entity_id=e.task_id
            JOIN idempotency_records p ON p.account_id=e.account_id AND p.id=e.idempotency_id
            WHERE p.account_id=$1 AND p.actor_user_id=$2 AND p.idempotency_key=$3
              AND a.event_type='unscoped_chat_task.completed') AS completion_audits,
          (SELECT status='completed' AND response_status=201 AND response_body=$5::jsonb FROM idempotency_records
            WHERE account_id=$1 AND actor_user_id=$2 AND idempotency_key=$4) AS prior_unchanged`,
        [f.accountId, f.userId, key, positiveKey, JSON.stringify(positive.json())])).rows[0];
        expect(attempts).toEqual({ attempts: 1, completed: 0, scrubbed: true,
          canonical_private_absent: true, completion_audits: 0, prior_unchanged: true });
        // A revoked child cannot use its key to redispatch. This must leave the
        // lawful prior completion intact until canonical workspace cleanup.
        expect((await f.post(key)).statusCode).toBe(401);
        assertStopped(await within(f.stop(), "The owned revoked-grant workspace did not clean up."));
        await assertEmpty(f);
      }
      expect(f.calls()).toBe(2); expect(f.heldCalls()).toBe(1); await assertParent(f);
    });
  }, 15_000);
});
