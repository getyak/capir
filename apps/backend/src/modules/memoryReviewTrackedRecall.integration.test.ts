/** Real canonical producers and PostgreSQL snapshots. The reader returns a
 * private candidate, never a post-withdrawal permission to expose its text. */
import { randomBytes, randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { describe, expect, it } from "vitest";
import { CONTRACT_VERSION, type MemoryCommitRequest, type MemoryCommitResponse,
  type MemoryProposalCandidate, type MemoryProposalStageRequest,
  type MemoryReviewResponse, type ResourceCaptureRequest, type ResourceCaptureResponse,
  type SessionResponse, type UnscopedChatTaskResponse } from "@talent-signal/contracts";
import { buildApp } from "../app.js";
import { inTransaction } from "../database/pool.js";
import type { AuthContext } from "./auth.js";
import { encodePasswordCredential } from "./passwordCredential.js";
import { recallMemoriesTracked } from "./memoryReviewTrackedRecall.js";
import { MEMORY_EVIDENCE_AVAILABLE_SQL } from "./memoryReviewStore.js";
import { savedMemoryDatabase, withSavedMemoryFixture,
  type SavedMemoryFixture } from "./fixtures/savedMemoryDiscovery.fixture.js";

if (process.env.GET_455_TRACKED_RECALL_TEST_REQUIRED === "1" && !savedMemoryDatabase) {
  throw new Error("Tracked Memory recall requires the explicit disposable loopback database.");
}

async function actualEpoch(f: SavedMemoryFixture, itemID: string) {
  const row = (await f.pool.query<{ version: number; epoch: string; subject_id: string | null; owner_user_id: string }>(
    `SELECT m.version,l.epoch::text,m.subject_id,m.owner_user_id
     FROM memory_items m JOIN memory_item_lineage l ON l.account_id=m.account_id AND l.memory_item_id=m.id
     WHERE m.account_id=$1 AND m.id=$2`, [f.auth.accountId, itemID])).rows[0];
  if (!row) throw new Error("The actual accepted Memory has no original epoch.");
  return row;
}
async function deleteActualSource(f: SavedMemoryFixture, sourceSessionID: string) {
  const row = (await f.pool.query<{ revision: number }>(
    "SELECT revision FROM agent_sessions WHERE account_id=$1 AND id=$2", [f.auth.accountId, sourceSessionID])).rows[0];
  if (!row) throw new Error("The actual admitted source Session is missing.");
  const deleted = await f.request({ method: "DELETE", url: `/v1/agent-sessions/${sourceSessionID}`,
    payload: { idempotency_key: randomUUID(), expected_revision: row.revision } });
  expect(deleted.statusCode).toBe(200);
  const session = deleted.json<{ session: { deleted_at: string | null; payload: unknown } }>().session;
  expect(typeof session.deleted_at === "string" && session.payload === null).toBe(true);
}

async function contact(f: SavedMemoryFixture) {
  const resourceID = randomUUID(), email = `tracked-recall-${resourceID}@example.invalid`, now = new Date().toISOString();
  const payload: ResourceCaptureRequest = { contract_version: CONTRACT_VERSION, idempotency_key: randomUUID(),
    channel: "chat", purpose: "The synthetic human confirms a contact for tracked recall.", captured_at: now, source_timezone: "UTC",
    person_scope: { status: "new_person", display_label: "Synthetic tracked contact", relationship_context: {
      status: "proposed", label: "Synthetic tracked conversation", purpose: "Verify current purpose-bound Memory recall" },
    binding_basis: "The synthetic human confirms the contact and email." },
    resource: { client_resource_id: resourceID, kind: "contact_record", display_name: "Synthetic tracked contact",
      media_type: "text/plain", observed_at: now, source_timezone: "UTC",
      retention: { requested_mode: "evidence_crop", source_scope: "reviewed_extracted_text" } },
    confirmed_identity_handles: [{ type: "email", value: email, source_client_resource_id: resourceID }],
    fragments: [{ client_resource_id: resourceID, kind: "contact_field", sequence: 0, text: email,
      locator: { kind: "contact_field", field: "email", source_record_version: "synthetic-tracked-v1" },
      attribution: { actor_kind: "recruiter", status: "confirmed" }, review_status: "reviewed",
      parser: { name: "synthetic-human-contact", version: "1" } }] };
  const created = await f.request({ method: "POST", url: "/v1/resource-captures", payload });
  expect(created.statusCode).toBe(201);
  const identity = created.json<ResourceCaptureResponse>().identity;
  expect(identity.status).toBe("bound");
  if (!identity.person_id || !identity.relationship_context_id) throw new Error("The actual contact has no bound scope.");
  return { personID: identity.person_id, contextID: identity.relationship_context_id, email };
}
type Contact = Awaited<ReturnType<typeof contact>>;
async function acceptScoped(f: SavedMemoryFixture, binding: Contact, scope: "person" | "relationship", text: string) {
  f.provider.mode = "neutral";
  const source = await f.post({ idempotency_key: randomUUID(), objective: text });
  expect(source.statusCode).toBe(201);
  const sourceSessionID = randomUUID();
  const sourceSession = await f.saveAnswer(sourceSessionID, text, source.json<UnscopedChatTaskResponse>());
  const messageID = sourceSession.payload!.turns[0]!.id;
  const candidate: MemoryProposalCandidate = { scope, operation: "add", statement_kind: "source_statement",
    display_text: text, source_excerpt: text, subject_id: binding.personID,
    relationship_context_id: scope === "relationship" ? binding.contextID : null,
    speaker: "synthetic-contact", reporter: "me", valid_time: null, observed_time: null,
    time_status: "known", sensitivity: "normal", previous_memory_item_id: null,
    previous_revision: null, previous_text: null, reason: "Explicit synthetic review before tracked recall.",
    source_locator: { kind: "message", session_id: sourceSessionID, message_id: messageID } };
  const stage: MemoryProposalStageRequest = { idempotency_key: randomUUID(), surface: "chat", session_id: sourceSessionID,
    source_message_id: messageID, source_task_id: null, person_id: binding.personID, relationship_context_id: binding.contextID,
    contact_decision: "existing", identity_authority: "human_selection", identity_clue: { type: "email", value: binding.email },
    new_contact: null, proposer: { kind: "human", name: "Synthetic tracked acceptance", version: "1" }, items: [candidate] };
  const staged = await f.request({ method: "POST", url: "/v1/memory/proposals", payload: stage });
  expect(staged.statusCode).toBe(201);
  const proposalID = staged.json<{ proposal: { proposal_id: string } }>().proposal.proposal_id;
  const opened = await f.request({ method: "POST", url: `/v1/memory/proposals/${proposalID}/reviews`,
    payload: { purpose: "chat", person_id: binding.personID, relationship_context_id: binding.contextID } });
  expect(opened.statusCode).toBe(200);
  const review = opened.json<MemoryReviewResponse>();
  if (!review.review_credential || review.review.items.length !== 1) throw new Error("The real Review omitted its candidate or credential.");
  const body: MemoryCommitRequest = { idempotency_key: randomUUID(), expected_proposal_revision: review.review.proposal_revision,
    selected_item_ids: review.review.items.map(item => item.id), contact_decision: "existing", identity_authority: "human_selection",
    person_id: binding.personID, relationship_context_id: binding.contextID,
    edited_text: {}, item_decisions: {}, expected_item_versions: {}, new_contact: null,
    reason: "Explicit synthetic scoped confirmation for tracked recall." };
  const committed = await f.confirmReview(review.review.review_scope_id, review.review_credential, body);
  expect(committed.statusCode).toBe(201);
  const ids = committed.json<MemoryCommitResponse>().receipt.created_item_ids;
  expect(ids).toHaveLength(1);
  return ids[0]!;
}

/** Only normal isolated user/password setup uses SQL. The returned AuthContext
 * is copied from an actual password login and independently read-back session. */
async function withOtherPrincipal(f: SavedMemoryFixture, operation: (auth: AuthContext) => Promise<void>) {
  const id = randomUUID(), email = `tracked-reader-${id}@example.invalid`, password = randomBytes(24).toString("base64url");
  await inTransaction(f.pool, async client => {
    await client.query("INSERT INTO account_email_reservations(normalized_email,state,account_id,user_id) VALUES($1,'owned',$2,$3)",
      [email, f.auth.accountId, id]);
    await client.query("INSERT INTO users(id,account_id,email,display_name,kind,username) VALUES($1,$2,$3,'Synthetic tracked reader','password_human',$3)",
      [id, f.auth.accountId, email]);
    await client.query("INSERT INTO password_credentials(account_id,user_id,password_scrypt) VALUES($1,$2,$3)",
      [f.auth.accountId, id, await encodePasswordCredential(password)]);
  });
  const app = await buildApp({ pool: f.pool, config: { databaseUrl: savedMemoryDatabase!, host: "127.0.0.1", port: 0,
    allowedOrigins: [], appleSignInAudiences: [], appleSignInEnabled: false, passwordAuthEnabled: true,
    passwordRegistrationEnabled: false, simulatedAuthEnabled: false, internalLabEnabled: false,
    retentionSweepIntervalMs: 60_000, sessionTtlSeconds: 3_600 }, remoteChatProvider: f.provider,
  personResearchProvider: null, privateConversationProvider: null, labProviders: new Map(), labJobWorkerEnabled: false,
  conversationQueueWorkerEnabled: false, labCIVerifier: null, screenshotContact: null });
  try {
    await app.ready();
    const login = await app.inject({ method: "POST", url: "/v1/auth/password/login",
      payload: { identifier: email, password, client_label: "Synthetic tracked reader" } });
    expect(login.statusCode).toBe(200);
    const signedIn = login.json<SessionResponse>();
    if (!signedIn.session_id) throw new Error("The actual tracked-reader login omitted its session.");
    expect(signedIn.account.id === f.auth.accountId && signedIn.user.id === id && id !== f.auth.userId).toBe(true);
    const current = await app.inject({ method: "GET", url: "/v1/auth/session", headers: { authorization: `Bearer ${signedIn.access_token}` } });
    expect(current.statusCode).toBe(200);
    await operation({ accountId: signedIn.account.id, accountSlug: signedIn.account.slug, userId: signedIn.user.id,
      userEmail: signedIn.user.email, userKind: signedIn.user.kind, sessionId: signedIn.session_id });
  } finally { await app.close(); }
}

describe.skipIf(!savedMemoryDatabase)("same-snapshot tracked canonical Memory recall", { concurrent: false }, () => {
  it("preserves the complete legacy DTO and captures the canonical self stamp beside its actual owner-bound row", async () => {
    await withSavedMemoryFixture(async f => {
      const accepted = await f.acceptSelf("My synthetic tracked notebook uses copper pages.");
      const original = await actualEpoch(f, accepted.itemID);
      const expected = await f.recall();
      const read = await recallMemoriesTracked(f.pool, f.auth, { surface: "chat", scope: "self" });
      expect(read.page).toEqual(expected);
      expect(read.originalStamps).toEqual([{ item_id: accepted.itemID, item_version: accepted.version,
        lineage_epoch: original.epoch, memory_owner_id: f.auth.userId, scope: "self", subject_id: null, relationship_context_id: null }]);
      expect(original.subject_id !== null && read.page.items[0]?.subject_id === original.subject_id).toBe(true);
      expect(Object.hasOwn(read.page, "originalStamps") || Object.hasOwn(read.page.items[0]!, "lineage_epoch")).toBe(false);
      expect(Object.isFrozen(read) && Object.isFrozen(read.page) && Object.isFrozen(read.page.items)
        && Object.isFrozen(read.page.items[0]?.evidence_refs) && Object.isFrozen(read.originalStamps[0])).toBe(true);
    });
  }, 15_000);

  it("preserves shared Person recall without leaking another user's private self or relationship Memory", async () => {
    await withSavedMemoryFixture(async f => {
      const self = await f.acceptSelf("My synthetic private tracked notebook is copper.");
      const binding = await contact(f);
      const personID = await acceptScoped(f, binding, "person", "The synthetic tracked contact prefers a paper notebook.");
      const relationshipID = await acceptScoped(f, binding, "relationship", "We explicitly discussed a synthetic notebook together.");
      const own = await recallMemoriesTracked(f.pool, f.auth, { surface: "chat", person_id: binding.personID,
        relationship_context_id: binding.contextID });
      expect(new Set(own.page.items.map(item => item.id))).toEqual(new Set([self.itemID, personID, relationshipID]));
      const ownPeople = await recallMemoriesTracked(f.pool, f.auth, { surface: "people", person_id: binding.personID });
      expect(new Set(ownPeople.page.items.map(item => item.id))).toEqual(new Set([personID, relationshipID]));
      await withOtherPrincipal(f, async other => {
        const shared = await recallMemoriesTracked(f.pool, other, { surface: "relationship", person_id: binding.personID,
          relationship_context_id: binding.contextID });
        expect(shared.page.items.map(item => item.id)).toEqual([personID]);
        expect(shared.page.items[0]?.can_edit).toBe(false);
        expect(shared.originalStamps[0]?.memory_owner_id === f.auth.userId
          && shared.originalStamps[0]?.subject_id === binding.personID
          && shared.originalStamps[0]?.relationship_context_id === null).toBe(true);
        const privateSelf = await recallMemoriesTracked(f.pool, other, { surface: "chat", scope: "self" });
        expect(privateSelf.page.items).toEqual([]);
        expect(privateSelf.originalStamps).toEqual([]);
      });
    });
  }, 15_000);

  it("never assigns a post-withdrawal epoch or evidence lookup to the already selected old text", async () => {
    await withSavedMemoryFixture(async f => {
      const accepted = await f.acceptSelf("My synthetic snapshot notebook is copper.");
      const before = await actualEpoch(f, accepted.itemID), expected = await f.recall();
      const pool = new Pool({ connectionString: savedMemoryDatabase, max: 1,
        connectionTimeoutMillis: 2_000, statement_timeout: 10_000, query_timeout: 12_000 });
      let client: PoolClient | undefined;
      let statements = 0, withdrew = false;
      try {
        client = await pool.connect();
        // Delegate every statement to the real PG client unchanged. Only after
        // its first real SELECT completes, another real HTTP owner withdraws
        // the source before the reader can project/return that original result.
        const observed = new Proxy(client, { get(target, key, receiver) {
          if (key !== "query") return Reflect.get(target, key, receiver);
          return async (text: string, values: unknown[]) => {
            statements += 1;
            const result = await target.query(text, values);
            if (statements === 1) { await deleteActualSource(f, accepted.sourceSessionID); withdrew = true; }
            return result;
          };
        } });
        const read = await recallMemoriesTracked(observed, f.auth, { surface: "chat", scope: "self" });
        expect(withdrew).toBe(true);
        expect(statements).toBe(1);
        expect(read.page).toEqual(expected);
        expect(read.originalStamps[0]?.lineage_epoch).toBe(before.epoch);
        expect(read.originalStamps[0]?.item_version).toBe(before.version);
        const after = await actualEpoch(f, accepted.itemID);
        expect(BigInt(after.epoch) > BigInt(before.epoch)).toBe(true);
        expect(read.originalStamps[0]?.lineage_epoch === after.epoch).toBe(false);
        const fresh = await recallMemoriesTracked(f.pool, f.auth, { surface: "chat", scope: "self" });
        expect(fresh.page.items).toEqual([]);
        expect(fresh.originalStamps).toEqual([]);
        // No claim that the old private candidate may be exposed now: the
        // real entry's joined final fence must reject its original stale epoch.
      } finally { client?.release(); await pool.end(); }
    });
  }, 15_000);

  it("preserves whole-item ordering and continuation while stamping only the actually returned page", async () => {
    await withSavedMemoryFixture(async f => {
      await f.acceptSelf("My synthetic first tracked notebook uses copper pages.");
      await f.acceptSelf("My synthetic second tracked notebook uses silver pages.");
      const expected = await f.recall();
      const first = await recallMemoriesTracked(f.pool, f.auth, { surface: "chat", scope: "self", limit: 1 });
      expect(first.page.items).toEqual(expected.items.slice(0, 1));
      expect(first.originalStamps.map(stamp => stamp.item_id)).toEqual(first.page.items.map(item => item.id));
      expect(first.page.has_more).toBe(true);
      if (!first.page.next_cursor) throw new Error("The actual first page omitted its continuation.");
      const second = await recallMemoriesTracked(f.pool, f.auth, { surface: "chat", scope: "self", limit: 1, cursor: first.page.next_cursor });
      expect(second.page.items).toEqual(expected.items.slice(1));
      expect(second.originalStamps.map(stamp => stamp.item_id)).toEqual(second.page.items.map(item => item.id));
      expect(second.page.has_more).toBe(false);
      expect(second.page.next_cursor).toBeNull();
    });
  }, 15_000);

  it("keeps actually accepted retained evidence readable after natural raw Session expiry", async () => {
    await withSavedMemoryFixture(async f => {
      const accepted = await f.acceptSelf("My synthetic retained notebook uses copper pages.");
      const original = await actualEpoch(f, accepted.itemID), expected = await f.recall();
      // Expire only the real source's raw retention clock; do not insert any
      // accepted item, evidence, epoch, permission or replacement proof.
      const expired = await f.pool.query("UPDATE agent_sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE account_id=$1 AND id=$2",
        [f.auth.accountId, accepted.sourceSessionID]);
      expect(expired.rowCount).toBe(1);
      const read = await recallMemoriesTracked(f.pool, f.auth, { surface: "chat", scope: "self" });
      expect(read.page).toEqual(expected);
      expect(read.originalStamps[0]?.lineage_epoch).toBe(original.epoch);
      expect(read.page.items[0]?.evidence_retained).toBe(true);
    });
  }, 15_000);

  it("keeps the existing malformed-cursor refusal instead of silently returning an empty page", async () => {
    await withSavedMemoryFixture(async f => {
      let denied = false;
      try { await recallMemoriesTracked(f.pool, f.auth, { surface: "chat", cursor: "not-a-returned-cursor" }); }
      catch (error) { denied = error !== null && typeof error === "object"
        && Reflect.get(error, "statusCode") === 400 && Reflect.get(error, "code") === "MEMORY_CURSOR_INVALID"; }
      expect(denied).toBe(true);
    });
  }, 15_000);

  it("excludes a relationship after its actual active context is rebound to another canonical Person", async () => {
    await withSavedMemoryFixture(async f => {
      const self = await f.acceptSelf("My synthetic context-bound notebook uses copper pages.");
      const first = await contact(f), second = await contact(f);
      expect(first.personID !== second.personID && first.contextID !== second.contextID).toBe(true);
      const firstPerson = await acceptScoped(f, first, "person", "The first synthetic contact prefers copper notebooks.");
      const firstRelationship = await acceptScoped(f, first, "relationship", "We discussed the first synthetic notebook together.");
      const secondPerson = await acceptScoped(f, second, "person", "The second synthetic contact prefers silver notebooks.");
      const secondRelationship = await acceptScoped(f, second, "relationship", "We discussed the second synthetic notebook together.");
      const originalSelf = await actualEpoch(f, self.itemID);
      const before = await recallMemoriesTracked(f.pool, f.auth, { surface: "chat", person_id: first.personID,
        relationship_context_id: first.contextID });
      expect(new Set(before.page.items.map(item => item.id))).toEqual(new Set([self.itemID, firstPerson, firstRelationship]));
      expect(before.originalStamps.every(stamp => stamp.memory_owner_id === f.auth.userId)).toBe(true);
      expect(before.originalStamps.find(stamp => stamp.item_id === firstRelationship)?.subject_id).toBe(first.personID);
      expect(before.originalStamps.find(stamp => stamp.item_id === firstRelationship)?.relationship_context_id).toBe(first.contextID);

      // Only this negative state transition uses SQL. Both Persons, contexts,
      // accepted items and evidence above came from their real HTTP owners;
      // keep every database transition trigger enabled during the rebind.
      const rebound = await f.pool.query<{ subject_id: string; status: string }>(
        `UPDATE assignments SET subject_id=$3
         WHERE account_id=$1 AND id=$2 AND subject_id=$4 AND status='active'
         RETURNING subject_id,status`, [f.auth.accountId, first.contextID, second.personID, first.personID]);
      expect(rebound.rowCount).toBe(1);
      expect(rebound.rows).toEqual([{ subject_id: second.personID, status: "active" }]);
      const retained = await f.pool.query<{ status: string; subject_id: string; relationship_context_id: string;
        evidence_available: boolean; current_readable: boolean }>(
        `SELECT m.status,m.subject_id,m.relationship_context_id,
           EXISTS (SELECT 1 FROM memory_item_evidence active_evidence
             WHERE active_evidence.account_id=m.account_id AND active_evidence.memory_item_id=m.id
               AND active_evidence.status='active')
           AND NOT EXISTS (SELECT 1 FROM memory_item_evidence e
             WHERE e.account_id=m.account_id AND e.memory_item_id=m.id
               AND NOT ${MEMORY_EVIDENCE_AVAILABLE_SQL}) AS evidence_available,
           saved_memory_item_readable($1,$3,m.id,false) AS current_readable
         FROM memory_items m WHERE m.account_id=$1 AND m.id=$2`,
        [f.auth.accountId, firstRelationship, f.auth.userId]);
      expect(retained.rows).toEqual([{ status: "active", subject_id: first.personID,
        relationship_context_id: first.contextID, evidence_available: true, current_readable: false }]);

      const after = await recallMemoriesTracked(f.pool, f.auth, { surface: "chat", person_id: first.personID,
        relationship_context_id: first.contextID });
      expect(new Set(after.page.items.map(item => item.id))).toEqual(new Set([self.itemID, firstPerson]));
      expect(new Set(after.originalStamps.map(stamp => stamp.item_id))).toEqual(new Set([self.itemID, firstPerson]));
      expect(after.originalStamps.every(stamp => stamp.memory_owner_id === f.auth.userId)).toBe(true);
      const selfItem = after.page.items.find(item => item.id === self.itemID);
      expect(originalSelf.subject_id !== null && selfItem?.subject_id === originalSelf.subject_id).toBe(true);
      expect(after.originalStamps.find(stamp => stamp.item_id === self.itemID)?.subject_id).toBeNull();
      const unaffected = await recallMemoriesTracked(f.pool, f.auth, { surface: "chat", person_id: second.personID,
        relationship_context_id: second.contextID });
      expect(new Set(unaffected.page.items.map(item => item.id))).toEqual(new Set([self.itemID, secondPerson, secondRelationship]));
      expect(new Set(unaffected.originalStamps.map(stamp => stamp.item_id))).toEqual(new Set([self.itemID, secondPerson, secondRelationship]));
      expect(unaffected.originalStamps.every(stamp => stamp.memory_owner_id === f.auth.userId)).toBe(true);
      const reboundScope = await recallMemoriesTracked(f.pool, f.auth, { surface: "relationship", person_id: second.personID,
        relationship_context_id: first.contextID });
      expect(reboundScope.page.items.map(item => item.id)).toEqual([secondPerson]);
      expect(reboundScope.originalStamps.map(stamp => stamp.item_id)).toEqual([secondPerson]);
    });
  }, 15_000);
});
