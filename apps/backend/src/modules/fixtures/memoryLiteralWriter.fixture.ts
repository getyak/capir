/** Private canonical-engine fixture. Normal password HTTP Auth and Session PUT
 * are real; no authority, literal manifest, accepted row or receipt is seeded.
 * This is not an opt-in production HTTP route or a final-publication adapter. */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { expect } from "vitest";
import { CONTRACT_VERSION, type MemoryLiteralReviewItemV2 } from "@talent-signal/contracts";
import { buildApp } from "../../app.js";
import type { BackendConfig } from "../../config.js";
import { inTransaction } from "../../database/pool.js";
import { createAuthGuard, type AuthContext } from "../auth.js";
import { encodePasswordCredential } from "../passwordCredential.js";
import * as memoryReview from "../memoryReview.js";
import { sourceRevisionHash } from "../memoryReviewStore.js";

export const database = process.env.CONTACT_AGENT_TEST_DATABASE_URL;
if (process.env.MEMORY_LITERAL_WRITER_TEST_REQUIRED === "1" && !database)
  throw new Error("The required literal writer gate needs its owned disposable database.");
if (database) {
  let parsed: URL;
  try { parsed = new URL(database); } catch { throw new Error("Owned disposable loopback database required."); }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol) || parsed.search || parsed.hash
    || !["localhost", "127.0.0.1"].includes(parsed.hostname) || parsed.pathname !== "/lab_regression_ci")
    throw new Error("Owned disposable loopback lab_regression_ci without URL options required.");
}
export type Capture = (value: unknown) => Readonly<Record<string, unknown>>;
export type CurrentReview = Readonly<{ content_protocol: "literal-v2"; review_credential: string;
  review: Readonly<{ review_scope_id: string; review_revision: number; proposal_id: string; proposal_revision: number;
    source_session_id: string; items: readonly MemoryLiteralReviewItemV2[]; draft: unknown }> }>;
export type StageResult = Readonly<{ proposal: Readonly<{ proposal_id: string }>; replayed: boolean }>;
export type CommitResult = Readonly<{ status: number; replayed: boolean; body: Readonly<{ content_protocol: "literal-v2";
  receipt: Readonly<{ commit_id: string; operation_key: string }> }> }>;
export function writerAPIs() {
  function required<T>(name: string): T {
    const value: unknown = Reflect.get(memoryReview, name);
    expect(typeof value, `New canonical writer API availability: ${name}; no semantics have run.`).toBe("function");
    return value as T;
  }
  return {
    captureStage: required<Capture>("captureMemoryLiteralStageRequest"),
    captureCommit: required<Capture>("captureMemoryLiteralCommitRequest"),
    stage: required<(client: PoolClient, auth: AuthContext, request: unknown) => Promise<StageResult>>("stageMemoryLiteralProposalOnClient"),
    open: required<(client: PoolClient, auth: AuthContext, proposalID: string, request: unknown) => Promise<CurrentReview>>("openMemoryLiteralReviewOnClient"),
    commit: required<(client: PoolClient, auth: AuthContext, scopeID: string, renderedCredential: string, request: unknown) => Promise<CommitResult>>("commitMemoryLiteralReviewOnClient"),
  };
}
export const hash = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
export const descriptor = (value: string) => ({ sha256: hash(value), utf8_bytes: Buffer.byteLength(value, "utf8"),
  utf16_code_units: value.length, unicode_scalar_count: [...value].length });
export const descriptorTuple = (value: string) => {
  const d = descriptor(value); return [d.sha256, d.utf8_bytes, d.utf16_code_units, d.unicode_scalar_count];
};
export function messageLocatorHash(sessionID: string, messageID: string, start: number, end: number) {
  // Restricted locator's ASCII keys in canonical order, independent of its producer.
  return hash(JSON.stringify({ character_end: end, character_start: start, kind: "message", message_id: messageID, session_id: sessionID }));
}

export interface ProposalRow { id: string; proposal_id: string; display_text: string; original_display_text: string;
  source_excerpt: string; source_excerpt_hash: string; source_revision_hash: string; locator: unknown; added_revision: number;
  content_protocol: string; content_manifest: unknown; content_manifest_digest: string; status: string; account_id: string }
export interface AcceptedRow { id: string; account_id: string; source_proposal_item_id: string; display_text: string;
  original_display_text: string; content_protocol: string; content_manifest: unknown; content_manifest_digest: string; version: number; status: string }
export interface EvidenceRow { id: string; account_id: string; memory_item_id: string; excerpt: string; content_hash: string;
  content_protocol: string; content_version: number; content_manifest: unknown; content_manifest_digest: string; status: string; locator: unknown }
export interface ReceiptRow { id: string; commit_id: string; operation_key: string; created_item_ids: string[];
  changes: Array<Record<string, unknown>> }

export async function withWriterFixture(source: string, run: (fixture: Awaited<ReturnType<typeof setup>>) => Promise<void>) {
  const fixture = await setup(source);
  try { await run(fixture); } finally { await fixture.close(); }
}

async function setup(initialSource: string) {
  if (!database || initialSource.length > 12_000) throw new Error("A real admitted Session source must fit12000 UTF16 units.");
  const pool = new Pool({ connectionString: database, max: 1, connectionTimeoutMillis: 2_000, statement_timeout: 5_000, query_timeout: 6_000 });
  const control = new Pool({ connectionString: database, max: 2, connectionTimeoutMillis: 2_000, statement_timeout: 5_000, query_timeout: 6_000 });
  const accountId = randomUUID(), userId = randomUUID(), sessionID = randomUUID(), messageID = randomUUID();
  const email = `literal-writer-${userId}@example.invalid`, password = randomBytes(24).toString("base64url");
  const createdAt = new Date().toISOString(), taskID = randomUUID();
  const config: BackendConfig = { databaseUrl: database, host: "127.0.0.1", port: 0, allowedOrigins: [],
    appleSignInAudiences: [], appleSignInEnabled: false, passwordAuthEnabled: true, passwordRegistrationEnabled: false,
    simulatedAuthEnabled: false, internalLabEnabled: false, retentionSweepIntervalMs: 60_000, sessionTtlSeconds: 3_600 };
  let app: Awaited<ReturnType<typeof buildApp>> | undefined, admitted: AuthContext | undefined;
  try {
    await inTransaction(control, async client => {
      await client.query("INSERT INTO accounts(id,slug,name) VALUES($1,$2,'Synthetic literal writer')", [accountId, `literal-${accountId}`]);
      await client.query("INSERT INTO account_email_reservations(normalized_email,state,account_id,user_id) VALUES($1,'owned',$2,$3)", [email, accountId, userId]);
      await client.query("INSERT INTO users(id,account_id,email,display_name,kind,username) VALUES($1,$2,$3,'Synthetic owner','password_human',$3)", [userId, accountId, email]);
      await client.query("INSERT INTO password_credentials(account_id,user_id,password_scrypt) VALUES($1,$2,$3)", [accountId, userId, await encodePasswordCredential(password)]);
    });
    app = await buildApp({ pool, config, remoteChatProvider: null, personResearchProvider: null, privateConversationProvider: null,
      labProviders: new Map(), labJobWorkerEnabled: false, conversationQueueWorkerEnabled: false, labCIVerifier: null, screenshotContact: null });
    app.get("/__literal_writer_test_auth", { preHandler: createAuthGuard(pool, undefined, config) }, async request => {
      admitted = request.auth; return { accepted: true };
    });
    await app.ready();
    const login = await app.inject({ method: "POST", url: "/v1/auth/password/login", payload: { identifier: email, password,
      client_label: "Synthetic literal writer" } });
    expect(login.statusCode).toBe(200); // Never assert/print the credential-bearing body.
    const headers = { authorization: `Bearer ${login.json<{ access_token: string }>().access_token}` };
    async function currentAuth(): Promise<AuthContext> {
      admitted = undefined;
      const result = await app!.inject({ method: "GET", url: "/__literal_writer_test_auth", headers });
      expect(result.statusCode).toBe(200);
      if (!admitted) throw new Error("The actual password authenticator did not admit this operation.");
      return admitted;
    }
    function payload(source: string) {
      return { id: sessionID, scopeKind: "unresolved_intent", personDisplayLabel: "", contextDisplayLabel: "", title: "Synthetic raw source",
        updatedAt: new Date().toISOString(), createdAt, isUnread: false, turns: [{ id: messageID, objective: source, createdAt, response: {
          contractVersion: CONTRACT_VERSION, taskID, contextManifestID: "none-unbound-conversation",
          knowledgeSnapshotID: "none-unbound-conversation", disposition: "answer", createdAt } }] };
    }
    async function saveInitialSource(source: string) {
      if (source.length > 12_000) throw new Error("Synthetic Session source exceeds the actual admission contract.");
      const existing = await control.query<{ revision: number }>("SELECT revision FROM agent_sessions WHERE account_id=$1 AND id=$2", [accountId, sessionID]);
      const result = await app!.inject({ method: "PUT", url: `/v1/agent-sessions/${sessionID}`, headers,
        payload: { expected_revision: existing.rows[0]?.revision ?? 0, idempotency_key: randomUUID(), payload: payload(source) } });
      expect(result.statusCode).toBe(200);
    }
    await saveInitialSource(initialSource);
    const originalAuth = await currentAuth();
    const originalAuthority = await inTransaction(pool, client => memoryReview.resolveSessionSourceAuthority(client, originalAuth, sessionID, messageID));
    expect(originalAuthority.text === initialSource).toBe(true);
    expect(originalAuthority.messageTextHash === hash(initialSource)).toBe(true);
    const sourceRevision = sourceRevisionHash(originalAuthority);

    async function withdrawSource() {
      const current = await control.query<{ revision: number }>("SELECT revision FROM agent_sessions WHERE account_id=$1 AND id=$2", [accountId, sessionID]);
      expect(current.rows).toHaveLength(1); const revision = current.rows[0]!.revision;
      const result = await app!.inject({ method: "DELETE", url: `/v1/agent-sessions/${sessionID}`, headers,
        payload: { expected_revision: revision, idempotency_key: randomUUID() } });
      expect(result.statusCode).toBe(200);
      const body = result.json<{ contract_version: string; session: { session_id: string; revision: number; deleted_at: string | null; payload: unknown } }>();
      expect(body.contract_version).toBe(CONTRACT_VERSION); expect(body.session.session_id).toBe(sessionID);
      expect(body.session.revision).toBe(revision + 1);
      expect(typeof body.session.deleted_at === "string" && body.session.payload === null).toBe(true);
      const stored = await control.query<{ deleted: boolean; scrubbed: boolean; revision: number }>(
        "SELECT deleted_at IS NOT NULL AS deleted,payload IS NULL AS scrubbed,revision FROM agent_sessions WHERE account_id=$1 AND id=$2", [accountId, sessionID]);
      expect(stored.rows).toEqual([{ deleted: true, scrubbed: true, revision: revision + 1 }]);
      const revoked = await control.query<{ revoked: boolean }>(`SELECT EXISTS(SELECT 1 FROM memory_source_revocations
        WHERE account_id=$1 AND source_kind='session' AND source_id=$2 AND reason='source_deleted' AND source_version IS NULL) AS revoked`, [accountId, sessionID]);
      expect(revoked.rows).toEqual([{ revoked: true }]);
    }

    function candidate(text: string, start: number, excerpt = text) {
      return { scope: "self", operation: "add", statement_kind: "fact", display_text: text, source_excerpt: excerpt,
        subject_id: null, relationship_context_id: null, speaker: null, reporter: null, valid_time: null, observed_time: null,
        time_status: "unknown", sensitivity: "normal", previous_memory_item_id: null, previous_text: null, previous_revision: null,
        reason: "Explicit synthetic authored preference", source_locator: { kind: "message", session_id: sessionID, message_id: messageID,
          character_start: start, character_end: start + excerpt.length } };
    }
    function request(items: unknown[], key = randomUUID()) {
      return { content_protocol: "literal-v2", idempotency_key: key, surface: "chat", session_id: sessionID, source_message_id: messageID,
        person_id: null, relationship_context_id: null, contact_decision: "none", new_contact: null,
        proposer: { kind: "human", name: "synthetic-literal-writer", version: "1" }, items };
    }
    async function stage(api: ReturnType<typeof writerAPIs>, value: unknown) {
      const captured = api.captureStage(value); // Before this operation's first await.
      const auth = await currentAuth(); // Never acquire another pool client inside the held transaction.
      return inTransaction(pool, client => api.stage(client, auth, captured));
    }
    async function open(api: ReturnType<typeof writerAPIs>, proposalID: string) {
      const auth = await currentAuth();
      const result = await inTransaction(pool, client => api.open(client, auth, proposalID, { purpose: "chat", session_id: sessionID }));
      expect(result.content_protocol).toBe("literal-v2");
      expect(typeof result.review_credential === "string" && result.review_credential.length >= 16).toBe(true);
      return result; // Do not pass this credential-bearing object to an assertion formatter.
    }
    async function commit(api: ReturnType<typeof writerAPIs>, review: CurrentReview, value: unknown) {
      const captured = api.captureCommit(value);
      const auth = await currentAuth();
      return inTransaction(pool, client => api.commit(client, auth, review.review.review_scope_id, review.review_credential, captured));
    }
    async function proposalItems(proposalID: string) {
      return (await control.query<ProposalRow>("SELECT * FROM memory_proposal_items WHERE account_id=$1 AND proposal_id=$2 ORDER BY id", [accountId, proposalID])).rows;
    }
    async function canonicalRows(proposalID: string) {
      const items = (await control.query<AcceptedRow>("SELECT * FROM memory_items WHERE account_id=$1 AND source_proposal_id=$2 ORDER BY id", [accountId, proposalID])).rows;
      const evidence = (await control.query<EvidenceRow>("SELECT e.* FROM memory_item_evidence e JOIN memory_items m ON m.account_id=e.account_id AND m.id=e.memory_item_id WHERE m.account_id=$1 AND m.source_proposal_id=$2 ORDER BY e.id", [accountId, proposalID])).rows;
      const receipts = (await control.query<ReceiptRow>("SELECT r.* FROM memory_receipts r JOIN memory_commits c ON c.account_id=r.account_id AND c.id=r.commit_id WHERE c.account_id=$1 AND c.proposal_id=$2 ORDER BY r.id", [accountId, proposalID])).rows;
      return { items, evidence, receipts };
    }
    async function effects() {
      const result = await control.query<Record<string, unknown>>(`SELECT
        (SELECT COALESCE(jsonb_agg(jsonb_build_array(id,status,revision,expires_at) ORDER BY id),'[]') FROM memory_proposals WHERE account_id=$1) AS proposals,
        (SELECT COALESCE(jsonb_agg(jsonb_build_array(id,status,content_manifest_digest) ORDER BY id),'[]') FROM memory_proposal_items WHERE account_id=$1) AS proposal_items,
        (SELECT COALESCE(jsonb_agg(jsonb_build_array(id,status,version,content_manifest_digest) ORDER BY id),'[]') FROM memory_items WHERE account_id=$1) AS items,
        (SELECT COALESCE(jsonb_agg(jsonb_build_array(id,status,content_manifest_digest) ORDER BY id),'[]') FROM memory_item_evidence WHERE account_id=$1) AS evidence,
        (SELECT COALESCE(jsonb_agg(id ORDER BY id),'[]') FROM memory_commits WHERE account_id=$1) AS commits,
        (SELECT COALESCE(jsonb_agg(id ORDER BY id),'[]') FROM memory_commit_items WHERE account_id=$1) AS commit_items,
        (SELECT COALESCE(jsonb_agg(id ORDER BY id),'[]') FROM memory_receipts WHERE account_id=$1) AS receipts,
        (SELECT COALESCE(jsonb_agg(jsonb_build_array(id,status) ORDER BY id),'[]') FROM idempotency_records WHERE account_id=$1) AS idempotency,
        (SELECT COUNT(*)::integer FROM audit_events WHERE account_id=$1) AS audit_count,
        (SELECT COUNT(*)::integer FROM memory_projection_jobs WHERE account_id=$1) AS projection_count`, [accountId]);
      return result.rows[0]!;
    }
    async function actualLegacyDraft() {
      const text = "I prefer complete source notes before a decision.";
      // It must be real legacy content in the already admitted source, not a
      // counterfeit literal-v2 row. Callers choose an initial source containing it.
      const offset = initialSource.indexOf(text); expect(offset >= 0).toBe(true);
      const legacy: Record<string, unknown> = { ...request([candidate(text, offset)]) };
      delete legacy.content_protocol;
      const staged = await app!.inject({ method: "POST", url: "/v1/memory/proposals", headers, payload: legacy });
      expect(staged.statusCode).toBe(201);
      const proposalID = staged.json<{ proposal: { proposal_id: string } }>().proposal.proposal_id;
      const opened = await app!.inject({ method: "POST", url: `/v1/memory/proposals/${proposalID}/reviews`, headers,
        payload: { purpose: "chat", session_id: sessionID } }); expect(opened.statusCode).toBe(200);
      const body = opened.json<{ review_credential: string; review: { review_scope_id: string; review_revision: number; items: Array<{ id: string }> } }>();
      const itemID = body.review.items[0]!.id;
      await memoryReview.saveMemoryReviewDraft(pool, await currentAuth(), body.review.review_scope_id, body.review_credential, {
        expected_review_revision: body.review.review_revision, contact_decision: "none", selected_item_ids: [itemID],
        edited_text: { [itemID]: text }, item_decisions: { [itemID]: "accept" } });
      const row = await control.query<{ id: string; revision: number; content_protocol: string }>("SELECT id,revision,content_protocol FROM memory_review_drafts WHERE account_id=$1 AND proposal_id=$2 AND reader_user_id=$3", [accountId, proposalID, userId]);
      expect(row.rows).toHaveLength(1); expect(row.rows[0]!.content_protocol).toBe("legacy-v1");
      return { draftID: row.rows[0]!.id, revision: row.rows[0]!.revision, scopeID: body.review.review_scope_id, itemID };
    }
    return { accountId, userId, sessionID, messageID, sourceText: initialSource, sourceRevision, pool, control, candidate, request, stage, open, commit,
      proposalItems, canonicalRows, effects, withdrawSource, actualLegacyDraft,
      async close() { try { await app!.close(); } finally { await Promise.all([pool.end(), control.end()]); } } };
  } catch (error) {
    try { await app?.close(); } finally { await Promise.all([pool.end(), control.end()]); }
    throw error;
  }
}

export type WriterFixture = Awaited<ReturnType<typeof setup>>;
