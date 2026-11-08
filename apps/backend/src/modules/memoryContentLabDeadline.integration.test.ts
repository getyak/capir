import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONTRACT_VERSION, type MemoryReviewResponse, type SessionResponse } from "@talent-signal/contracts";
import { describe, expect, it } from "vitest";
import type { PoolClient } from "pg";
import { buildApp } from "../app.js";
import type { BackendConfig } from "../config.js";
import { ApiError } from "../lib/apiError.js";
import { createAuthGuard, type AuthContext } from "./auth.js";
import { LocalChatMediaStorage } from "./chatMediaStorage.js";
import { LabWorkspaceService } from "./labWorkspaces.js";
import { barrier, bounded, database, observedClient, requiredContentAPIs, withReviewFixture, type PreparedReview } from "./fixtures/memoryContentReadEnvelope.fixture.js";

type Kind = "human" | "grant-v2" | "grant-v3" | "operator";
type TTL = "human_workspace" | "human_entry" | "parent" | "grant" | "operator_workspace" | "operator_entry";
const sentence = "Synthetic Lab evidence stays purpose bound until delivery.";
const web = "https://memory-content-lab-web.example.invalid", backend = "https://memory-content-lab-api.example.invalid";

/** The parent is the existing real password/HTTP fixture. Child workspaces,
 * entries, grants/PKCE, operator provisioning, child auth, Session stage/open all
 * use production handlers; only entitlements and finite clock faults use SQL.
 * This imports no .test module and never fabricates request.auth or Lab grants. */
async function withLabReview(kind: Kind, run: (f: {
  parent: Parameters<Parameters<typeof withReviewFixture>[0]>[0]; config: BackendConfig;
  auth: AuthContext; authorization: string; scopeID: string; credential: string;
  workspaceID: string; entryID: string; parentSessionID: string; grantID: string | null;
  shorten(change: TTL): Promise<string>; extend(change: TTL): Promise<void>;
}) => Promise<void>) {
  await withReviewFixture(async parent => {
    const directory = await mkdtemp(join(tmpdir(), "capir-memory-content-lab-"));
    const storage = new LocalChatMediaStorage(directory);
    const provisioningKey = randomBytes(32).toString("base64url");
    const config: BackendConfig = { ...parent.config, internalLabEnabled: true, allowedOrigins: [web],
      chatMediaStorage: { provider: "local", directory },
      capirAuth: { enabled: true, webOrigin: web, backendOrigin: backend, codeTtlSeconds: 60,
        accessTtlSeconds: 60, refreshIdleTtlSeconds: 600, refreshAbsoluteTtlSeconds: 3600 },
      capirTests: { enabled: true, provisioningKey, provisioningGeneration: 1, webOrigin: web,
        backendOrigin: backend, webConsumerKey: randomBytes(32).toString("base64url"), maxActiveRuns: 8 } };
    let app: Awaited<ReturnType<typeof buildApp>> | undefined, workspaceID: string | undefined;
    let captured: AuthContext | undefined;
    try {
      app = await buildApp({ pool: parent.pool, config, chatMediaStorage: storage,
        remoteChatProvider: null, personResearchProvider: null, privateConversationProvider: null,
        labProviders: new Map(), labJobWorkerEnabled: false, conversationQueueWorkerEnabled: false,
        labCIVerifier: null, screenshotContact: null });
      app.get("/__get451_lab_content_auth", { preHandler: createAuthGuard(parent.pool, undefined, config) }, async request => {
        captured = request.auth; return { accepted: true };
      });
      await app.ready();
      const parentHeaders = { authorization: parent.authorization };
      let childToken: string, grantID: string | null = null, parentSessionID = parent.auth.sessionId;
      if (kind === "human") {
        workspaceID = randomUUID();
        const created = await app.inject({ method: "POST", url: "/v1/lab/workspaces", headers: parentHeaders,
          payload: { id: workspaceID, duration_hours: 1 } });
        expect(created.statusCode).toBe(200);
        childToken = randomBytes(32).toString("base64url");
        const entered = await app.inject({ method: "POST", url: `/v1/lab/workspaces/${workspaceID}/entries`, headers: parentHeaders,
          payload: { id: randomUUID(), access_token: childToken } });
        expect(entered.statusCode).toBe(200);
      } else {
        let provisionToken = provisioningKey;
        if (kind !== "operator") {
          await parent.control.query(`INSERT INTO capir_user_test_entitlements(id,account_id,user_id,scopes,state,granted_by)
            VALUES($1,$2,$3,ARRAY['test.create','test.status','test.stop','test.handoff'],'active','Synthetic Memory Lab deadline fixture')`,
          [randomUUID(), parent.accountId, parent.userId]);
          const schema_version = kind === "grant-v3" ? "capir-auth.v3" : "capir-auth.v2";
          const verifier = randomBytes(32).toString("base64url"), state = randomBytes(32).toString("base64url");
          const redirect_uri = "http://127.0.0.1:49381/capir/callback";
          const authorized = await app.inject({ method: "POST", url: "/v1/capir/auth/authorize", headers: parentHeaders,
            payload: { schema_version, redirect_uri, state, code_challenge: createHash("sha256").update(verifier, "ascii").digest("base64url"),
              code_challenge_method: "S256", web_origin: web, backend_origin: backend,
              scopes: ['grants.read','grants.revoke','test.create','test.status','test.stop','test.handoff'],
              consent: true, client_label: "Synthetic Memory Lab deadline" } });
          expect(authorized.statusCode).toBe(200);
          const exchanged = await app.inject({ method: "POST", url: "/v1/capir/auth/exchange", payload: {
            schema_version, code: authorized.json<{ code: string }>().code, code_verifier: verifier,
            state, redirect_uri, web_origin: web, backend_origin: backend } });
          expect(exchanged.statusCode).toBe(200);
          const grant = exchanged.json<{ access_token: string; grant: { id: string } }>();
          provisionToken = grant.access_token; grantID = grant.grant.id;
          const actual = (await parent.control.query<{ backing_session_id: string }>(
            "SELECT backing_session_id FROM capir_auth_grants WHERE id=$1 AND account_id=$2 AND user_id=$3",
            [grantID, parent.accountId, parent.userId])).rows[0];
          if (!actual) throw new Error("The actual synthetic grant omitted its canonical backing Session.");
          parentSessionID = actual.backing_session_id;
        }
        const password = randomBytes(32).toString("base64url");
        const created = await app.inject({ method: "POST", url: "/v1/capir/tests",
          headers: { authorization: `Bearer ${provisionToken}`, "x-capir-backend-origin": backend },
          payload: { request_id: randomUUID(), password, preset: "empty", duration_hours: 1, web_origin: web, backend_origin: backend } });
        expect(created.statusCode).toBe(200);
        const target = created.json<{ run: { id: string; username: string; state: string } }>().run;
        expect(target.state === "ready").toBe(true); workspaceID = target.id;
        const admitted = await app.inject({ method: "POST", url: "/v1/auth/password/login",
          payload: { identifier: target.username, password, client_label: "Synthetic Memory Lab child" } });
        expect(admitted.statusCode).toBe(200); childToken = admitted.json<SessionResponse>().access_token;
      }
      const authorization = `Bearer ${childToken}`, headers = { authorization };
      const actualAuth = await app.inject({ method: "GET", url: "/__get451_lab_content_auth", headers });
      expect(actualAuth.statusCode).toBe(200); expect(actualAuth.json()).toEqual({ accepted: true });
      if (!captured || captured.userKind !== "lab_human") throw new Error("The real configured authenticator did not admit the synthetic Lab child.");
      const auth = captured;
      const entry = (await parent.control.query<{ id: string }>(
        "SELECT id FROM lab_test_workspace_entries WHERE workspace_id=$1 AND session_id=$2", [workspaceID, auth.sessionId])).rows;
      expect(entry.length).toBe(1); const entryID = entry[0]!.id;
      const sessionID = randomUUID(), messageID = randomUUID(), stamp = new Date().toISOString();
      const source = await app.inject({ method: "PUT", url: `/v1/agent-sessions/${sessionID}`, headers, payload: {
        expected_revision: 0, idempotency_key: randomUUID(), payload: { id: sessionID, scopeKind: "unresolved_intent",
          personDisplayLabel: "", contextDisplayLabel: "", title: "Synthetic Lab source", updatedAt: stamp, createdAt: stamp,
          isUnread: false, turns: [{ id: messageID, objective: sentence, createdAt: stamp, response: {
            contractVersion: CONTRACT_VERSION, taskID: randomUUID(), contextManifestID: "none-unbound-conversation",
            knowledgeSnapshotID: "none-unbound-conversation", disposition: "answer", createdAt: stamp } }] } } });
      expect(source.statusCode).toBe(200);
      const staged = await app.inject({ method: "POST", url: "/v1/memory/proposals", headers, payload: {
        idempotency_key: randomUUID(), surface: "chat", session_id: sessionID, source_message_id: messageID,
        person_id: null, relationship_context_id: null, contact_decision: "none", new_contact: null,
        proposer: { kind: "human", name: "synthetic-lab-reader", version: "1" }, items: [{ scope: "self", operation: "add",
          statement_kind: "fact", display_text: sentence, subject_id: null, relationship_context_id: null, speaker: null, reporter: null,
          valid_time: null, observed_time: null, time_status: "unknown", sensitivity: "normal", source_excerpt: sentence,
          source_locator: { kind: "message", session_id: sessionID, message_id: messageID }, previous_memory_item_id: null,
          previous_text: null, previous_revision: null, reason: "Synthetic Lab reviewed evidence" }] } });
      expect(staged.statusCode).toBe(201);
      const proposalID = staged.json<{ proposal: { proposal_id: string } }>().proposal.proposal_id;
      const opened = await app.inject({ method: "POST", url: `/v1/memory/proposals/${proposalID}/reviews`, headers,
        payload: { purpose: "chat", session_id: sessionID } });
      expect(opened.statusCode).toBe(200);
      const review = opened.json<MemoryReviewResponse>();
      expect(review.review.items[0]?.display_text).toBe(sentence);
      if (!review.review_credential) throw new Error("Actual synthetic Lab review omitted its credential.");
      const scopeID = review.review.review_scope_id, credential = review.review_credential;
      const target = (change: TTL) => {
        if (change === "human_workspace" || change === "operator_workspace") return { table: "lab_test_workspaces", column: "expires_at", id: workspaceID! };
        if (change === "human_entry" || change === "operator_entry") return { table: "lab_test_workspace_entries", column: "expires_at", id: entryID };
        if (change === "parent") return { table: "sessions", column: "expires_at", id: parentSessionID };
        if (!grantID || kind !== "grant-v2") throw new Error("Only actual bounded v2 grants have an absolute deadline fault.");
        return { table: "capir_auth_grants", column: "absolute_expires_at", id: grantID };
      };
      await run({ parent, config, auth, authorization, scopeID, credential, workspaceID, entryID, parentSessionID, grantID,
        async shorten(change) {
          const value = target(change);
          const row = (await parent.control.query<{ deadline: string }>(`UPDATE ${value.table} SET ${value.column}=clock_timestamp()+interval '3 seconds'
            WHERE id=$1 RETURNING to_char(${value.column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS deadline`, [value.id])).rows;
          expect(row.length).toBe(1); return row[0]!.deadline;
        }, async extend(change) {
          const value = target(change);
          expect((await parent.control.query(`UPDATE ${value.table} SET ${value.column}=clock_timestamp()+interval '1 hour' WHERE id=$1`, [value.id])).rowCount).toBe(1);
        } });
    } finally {
      try {
        // Exact task-owned workspace only; canonical server cleanup remains
        // possible when the deliberately expired parent can no longer log in.
        if (workspaceID) await new LabWorkspaceService(parent.control, storage, 3600).stopOperatorRun(workspaceID, randomUUID());
      } finally { try { await app?.close(); } finally { await rm(directory, { recursive: true, force: false }); } }
    }
  });
}

function denied(result: { error: unknown; value?: PreparedReview }) {
  expect(result.value === undefined).toBe(true);
  expect(result.error instanceof ApiError && result.error.statusCode === 409).toBe(true);
}
const ttls: readonly TTL[] = ["human_workspace", "human_entry", "parent", "grant", "operator_workspace", "operator_entry"];
const kindFor = (ttl: TTL): Kind => ttl === "grant" ? "grant-v2" : ttl.startsWith("operator") ? "operator" : "human";

async function prepare(f: Parameters<Parameters<typeof withLabReview>[1]>[0], client: PoolClient) {
  const { prepare: actual } = requiredContentAPIs();
  await client.query("BEGIN"); let value: PreparedReview;
  try { value = await actual(client, f.auth, f.scopeID, f.credential); }
  catch (error) { await client.query("ROLLBACK"); throw error; }
  await client.query("COMMIT"); return value;
}

describe.skipIf(!database)("joint Memory content delivery clips original and current actual Lab authority deadlines", () => {
  it.each(ttls.flatMap(ttl => [false, true].map(expired => ({ ttl, expired }))))("handles the same genuine final ACK with $ttl expired=$expired", async ({ ttl, expired }) => {
    await withLabReview(kindFor(ttl), async f => {
      const { create } = requiredContentAPIs(), deadline = await f.shorten(ttl);
      const entered = barrier(), release = barrier(); f.parent.releaseOnClose(release.resolve);
      const connection = observedClient(await f.parent.pool.connect(), { phase: "final", entered, release });
      const pending = f.parent.track(create({ config: f.config })(f.auth, f.authorization).run(connection.client, client => prepare(f, client))
        .then(value => ({ value, error: null }), error => ({ error })));
      try {
        await bounded(entered.promise); expect(connection.state.finalHasActualPositiveRow).toBe(true);
        if (expired) await f.parent.waitExpiry(deadline);
        release.resolve(); const result = await pending;
        if (expired) denied(result);
        else { expect(result.error === null).toBe(true); expect("value" in result && result.value.body.review.items[0]?.display_text === sentence).toBe(true); }
        expect(connection.state.queriesAfterFinal).toBe(0);
      } finally { release.resolve(); await pending; connection.release(); }
    });
  }, 25_000);

  it.each(ttls)("cannot renew the original %s horizon by extending it after initial admission", async ttl => {
    await withLabReview(kindFor(ttl), async f => {
      const { create } = requiredContentAPIs(), deadline = await f.shorten(ttl);
      const connection = observedClient(await f.parent.pool.connect());
      try {
        const result = await create({ config: f.config })(f.auth, f.authorization).run(connection.client, async client => {
          const value = await prepare(f, client); await f.extend(ttl); await f.parent.waitExpiry(deadline); return value;
        }).then(value => ({ value, error: null }), error => ({ error }));
        denied(result); expect(connection.state.queriesAfterFinal).toBe(0);
      } finally { connection.release(); }
    });
  }, 25_000);

  it.each([false, true])("keeps genuine v3 expired-parent substitution while retaining its actual workspace bound (expireWorkspace=%s)", async expireWorkspace => {
    await withLabReview("grant-v3", async f => {
      expect(f.grantID !== null).toBe(true);
      const grant = (await f.parent.control.query<{ protocol_version: string; absolute_expires_at: unknown }>(
        "SELECT protocol_version,absolute_expires_at FROM capir_auth_grants WHERE id=$1", [f.grantID])).rows[0]!;
      expect(grant.protocol_version === "capir-auth.v3" && grant.absolute_expires_at === null).toBe(true);
      expect((await f.parent.control.query("UPDATE sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [f.parentSessionID])).rowCount).toBe(1);
      const deadline = expireWorkspace ? await f.shorten("human_workspace") : null;
      const { create } = requiredContentAPIs(), entered = barrier(), release = barrier(); f.parent.releaseOnClose(release.resolve);
      const connection = observedClient(await f.parent.pool.connect(), { phase: "final", entered, release });
      const pending = f.parent.track(create({ config: f.config })(f.auth, f.authorization).run(connection.client, client => prepare(f, client))
        .then(value => ({ value, error: null }), error => ({ error })));
      try {
        await bounded(entered.promise); expect(connection.state.finalHasActualPositiveRow).toBe(true);
        if (deadline) await f.parent.waitExpiry(deadline);
        release.resolve(); const result = await pending;
        if (expireWorkspace) denied(result);
        else { expect(result.error === null).toBe(true); expect("value" in result && result.value.body.review.items[0]?.display_text === sentence).toBe(true); }
      } finally { release.resolve(); await pending; connection.release(); }
    });
  }, 25_000);
});
