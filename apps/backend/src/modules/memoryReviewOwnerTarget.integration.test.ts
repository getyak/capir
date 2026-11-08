/** Real HTTP/PG regressions for independent-self previous-target resolution.
 * No accepted item, evidence, receipt, owner subject or AuthContext is
 * manufactured with fixture SQL. A second password user is only normal
 * isolated account setup.
 * Execution belongs to the explicit disposable Hosted PostgreSQL selector. */
import { randomBytes, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type {
  AgentSessionPayload, MemoryCommitRequest, MemoryCommitResponse, MemoryProposalCandidate,
  MemoryProposalStageRequest, MemoryRecallItem, MemoryRecallResponse, MemoryReviewResponse,
  MemoryUndoResponse, ResourceCaptureRequest, ResourceCaptureResponse, SessionResponse,
  UnscopedChatTaskResponse,
} from "@talent-signal/contracts";
import { CONTRACT_VERSION } from "@talent-signal/contracts";
import { describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { inTransaction } from "../database/pool.js";
import { encodePasswordCredential } from "./passwordCredential.js";
import { independentReply, savedMemoryDatabase, withSavedMemoryFixture,
  type SavedMemoryFixture } from "./fixtures/savedMemoryDiscovery.fixture.js";

if (process.env.GET_455_MEMORY_OWNER_TARGET_TEST_REQUIRED === "1" && !savedMemoryDatabase) {
  throw new Error("The owner-target regression requires the explicit disposable loopback database.");
}

type Actor = Pick<SavedMemoryFixture, "request" | "confirmReview">;
type Binding = { personID: string; contextID: string; email: string };

async function currentSelf(f: SavedMemoryFixture, itemID: string): Promise<MemoryRecallItem> {
  const item = (await f.recall()).items.find(value => value.id === itemID);
  if (!item) throw new Error("The actually accepted self item is not currently readable.");
  expect(item.scope).toBe("self");
  expect(item.relationship_context_id).toBeNull();
  expect(typeof item.subject_id === "string").toBe(true);
  const owner = (await f.pool.query<{ id: string }>(`SELECT id::text FROM subjects
    WHERE account_id=$1 AND external_ref=$2 AND status='active'`,
  [f.auth.accountId, `workspace-owner:${f.auth.userId}`])).rows[0];
  expect(Boolean(owner && owner.id === item.subject_id)).toBe(true);
  return item;
}

/** The real client Session marker and response are copied from the actual
 * unscoped reply; the human objective is the admitted source, not caller SQL. */
async function sourceCandidate(f: SavedMemoryFixture, actor: Actor, text: string): Promise<MemoryProposalCandidate> {
  f.provider.mode = "neutral";
  const source = await actor.request({ method: "POST", url: "/v1/chat/unscoped-tasks",
    payload: { idempotency_key: randomUUID(), objective: text } });
  expect(source.statusCode).toBe(201);
  const answer = source.json<UnscopedChatTaskResponse>();
  expect(answer.blocks[0]?.body).toBe(independentReply);
  const sessionID = randomUUID(), messageID = randomUUID();
  const payload: AgentSessionPayload = {
    id: sessionID, scopeKind: "unresolved_intent", personDisplayLabel: "New session",
    contextDisplayLabel: "Conversation", title: "Synthetic reviewed owner update",
    updatedAt: answer.created_at, isUnread: false, turns: [{
      id: messageID, objective: text, createdAt: answer.created_at,
      response: { contractVersion: answer.contract_version, taskID: answer.task_id,
        contextManifestID: "none-unbound-conversation", knowledgeSnapshotID: "none-unbound-conversation",
        disposition: answer.disposition, createdAt: answer.created_at,
        unboundConversationBlocks: answer.blocks.map(block => ({ id: block.id, kind: block.kind,
          title: block.title, body: block.body, status: block.status,
          citation_dependency_ids: [], requires_user_decision: false })),
      },
    }],
  };
  const saved = await actor.request({ method: "PUT", url: `/v1/agent-sessions/${sessionID}`,
    payload: { idempotency_key: randomUUID(), expected_revision: 0, payload } });
  expect(saved.statusCode).toBe(200);
  return { scope: "self", operation: "add", statement_kind: "source_statement",
    display_text: text, subject_id: null, relationship_context_id: null,
    speaker: "me", reporter: "me", valid_time: null, observed_time: null,
    time_status: "known", sensitivity: "normal", source_excerpt: text,
    source_locator: { kind: "message", session_id: sessionID, message_id: messageID },
    previous_memory_item_id: null, previous_revision: null, previous_text: null,
    reason: "The synthetic human explicitly reviews this source-grounded statement." };
}

async function stageAndOpen(f: SavedMemoryFixture, actor: Actor, text: string,
  overrides: Partial<MemoryProposalCandidate>, binding?: Binding): Promise<MemoryReviewResponse> {
  const candidate = { ...await sourceCandidate(f, actor, text), ...overrides };
  if (candidate.source_locator.kind !== "message" || !candidate.source_locator.session_id
    || !candidate.source_locator.message_id) throw new Error("The actual synthetic source identity is incomplete.");
  const request: MemoryProposalStageRequest = { idempotency_key: randomUUID(), surface: "chat",
    session_id: candidate.source_locator.session_id, source_message_id: candidate.source_locator.message_id,
    source_task_id: null, person_id: binding?.personID ?? null, relationship_context_id: binding?.contextID ?? null,
    contact_decision: binding ? "existing" : "none",
    ...(binding ? { identity_authority: "human_selection" as const,
      identity_clue: { type: "email" as const, value: binding.email } } : { identity_clue: null }),
    new_contact: null, proposer: { kind: "human", name: "Synthetic owner-target review", version: "1" },
    items: [candidate] };
  const staged = await actor.request({ method: "POST", url: "/v1/memory/proposals", payload: request });
  expect(staged.statusCode).toBe(201);
  const proposalID = staged.json<{ proposal: { proposal_id: string } }>().proposal.proposal_id;
  const opened = await actor.request({ method: "POST", url: `/v1/memory/proposals/${proposalID}/reviews`,
    payload: { purpose: "chat", person_id: binding?.personID ?? null,
      relationship_context_id: binding?.contextID ?? null } });
  expect(opened.statusCode).toBe(200);
  const review = opened.json<MemoryReviewResponse>();
  expect(review.contract_version).toBe(CONTRACT_VERSION);
  expect(review.review.items).toHaveLength(1);
  if (!review.review_credential) throw new Error("The actual review omitted its confirmation credential.");
  return review;
}

async function commit(actor: Actor, review: MemoryReviewResponse, version?: number, binding?: Binding) {
  const item = review.review.items[0];
  if (!item || !review.review_credential) throw new Error("The actual review cannot be confirmed.");
  const body: MemoryCommitRequest = { idempotency_key: randomUUID(),
    expected_proposal_revision: review.review.proposal_revision, selected_item_ids: [item.id],
    contact_decision: binding ? "existing" : "none",
    ...(binding ? { identity_authority: "human_selection" as const,
      person_id: binding.personID, relationship_context_id: binding.contextID } : {}),
    edited_text: {}, item_decisions: {}, expected_item_versions: version === undefined ? {} : { [item.id]: version },
    new_contact: null, reason: "Explicit synthetic human confirmation of the rendered review." };
  return actor.confirmReview(review.review.review_scope_id, review.review_credential, body);
}

/** Read-only complete canonical effects; comparison exposes only a boolean,
 * never credential-bearing request/review objects or receipt undo tokens. */
async function canonicalState(f: SavedMemoryFixture) {
  const result = await f.pool.query<{ state: unknown }>(`SELECT jsonb_build_object(
    'items',COALESCE((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.id) FROM memory_items m WHERE m.account_id=$1),'[]'::jsonb),
    'evidence',COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM memory_item_evidence e WHERE e.account_id=$1),'[]'::jsonb),
    'commits',COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM memory_commits c WHERE c.account_id=$1),'[]'::jsonb),
    'receipts',COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM memory_receipts r WHERE r.account_id=$1),'[]'::jsonb)
  ) AS state`, [f.auth.accountId]);
  expect(result.rowCount).toBe(1);
  return result.rows[0]!.state;
}

async function originalEvidence(f: SavedMemoryFixture, itemID: string) {
  return (await f.pool.query(`SELECT * FROM memory_item_evidence
    WHERE account_id=$1 AND memory_item_id=$2 ORDER BY id`, [f.auth.accountId, itemID])).rows;
}

/** Same account, different actual password principal. SQL creates only the
 * random user/login credential; normal login/HTTP owners create every source
 * and Memory state. No session row, proof or AuthContext is fabricated. */
async function withOtherUser(f: SavedMemoryFixture, operation: (actor: Actor) => Promise<void>) {
  const userID = randomUUID(), email = `owner-target-${userID}@example.invalid`;
  const password = randomBytes(24).toString("base64url");
  await inTransaction(f.pool, async client => {
    await client.query("INSERT INTO account_email_reservations(normalized_email,state,account_id,user_id) VALUES($1,'owned',$2,$3)",
      [email, f.auth.accountId, userID]);
    await client.query("INSERT INTO users(id,account_id,email,display_name,kind,username) VALUES($1,$2,$3,'Synthetic second Memory user','password_human',$3)",
      [userID, f.auth.accountId, email]);
    await client.query("INSERT INTO password_credentials(account_id,user_id,password_scrypt) VALUES($1,$2,$3)",
      [f.auth.accountId, userID, await encodePasswordCredential(password)]);
  });
  const app = await buildApp({ pool: f.pool, config: { databaseUrl: savedMemoryDatabase!, host: "127.0.0.1", port: 0,
    allowedOrigins: [], appleSignInAudiences: [], appleSignInEnabled: false,
    passwordAuthEnabled: true, passwordRegistrationEnabled: false, simulatedAuthEnabled: false,
    internalLabEnabled: false, retentionSweepIntervalMs: 60_000, sessionTtlSeconds: 3_600 },
  remoteChatProvider: f.provider, personResearchProvider: null, privateConversationProvider: null,
  labProviders: new Map(), labJobWorkerEnabled: false, conversationQueueWorkerEnabled: false,
  labCIVerifier: null, screenshotContact: null });
  try {
    await app.ready();
    const login = await app.inject({ method: "POST", url: "/v1/auth/password/login",
      payload: { identifier: email, password, client_label: "Synthetic owner-target negative" } });
    expect(login.statusCode).toBe(200);
    const signedIn = login.json<SessionResponse>();
    expect(signedIn.account.id === f.auth.accountId && signedIn.user.id === userID
      && signedIn.user.id !== f.auth.userId).toBe(true);
    const headers = { authorization: `Bearer ${signedIn.access_token}` };
    const actor: Actor = {
      request: options => app.inject({ ...options, headers }).then(value => value),
      confirmReview: (scopeID, credential, body) => app.inject({ method: "POST",
        url: `/v1/memory/reviews/${scopeID}/commits`,
        headers: { ...headers, "x-memory-review-credential": credential }, payload: body }).then(value => value),
    };
    expect((await actor.request({ method: "GET", url: "/v1/auth/session" })).statusCode).toBe(200);
    await operation(actor);
  } finally { await app.close(); }
}

async function acceptContactMemory(f: SavedMemoryFixture) {
  const resourceID = randomUUID(), email = `owner-target-contact-${resourceID}@example.invalid`;
  const now = new Date().toISOString();
  const capture: ResourceCaptureRequest = { contract_version: CONTRACT_VERSION, idempotency_key: randomUUID(),
    channel: "chat", purpose: "Explicit synthetic contact for the private-owner target boundary.",
    captured_at: now, source_timezone: "UTC",
    person_scope: { status: "new_person", display_label: "Synthetic target contact", relationship_context: {
      status: "proposed", label: "Synthetic notebook partner", purpose: "Synthetic owner-target regression" },
    binding_basis: "The synthetic human explicitly confirms the contact and its email." },
    resource: { client_resource_id: resourceID, kind: "contact_record", display_name: "Synthetic reviewed contact",
      media_type: "text/plain", observed_at: now, source_timezone: "UTC",
      retention: { requested_mode: "evidence_crop", source_scope: "reviewed_extracted_text" } },
    confirmed_identity_handles: [{ type: "email", value: email, source_client_resource_id: resourceID }],
    fragments: [{ client_resource_id: resourceID, kind: "contact_field", sequence: 0, text: email,
      locator: { kind: "contact_field", field: "email", source_record_version: "synthetic-owner-target-v1" },
      attribution: { actor_kind: "recruiter", status: "confirmed" }, review_status: "reviewed",
      parser: { name: "synthetic-human-contact-entry", version: "1" } }] };
  const created = await f.request({ method: "POST", url: "/v1/resource-captures", payload: capture });
  expect(created.statusCode).toBe(201);
  const identity = created.json<ResourceCaptureResponse>().identity;
  expect(identity.status).toBe("bound");
  if (!identity.person_id || !identity.relationship_context_id) throw new Error("The actual contact has no bound scope.");
  const binding = { personID: identity.person_id, contextID: identity.relationship_context_id, email };
  const text = "The synthetic target contact prefers a paper notebook.";
  const review = await stageAndOpen(f, f, text, { scope: "person", subject_id: binding.personID }, binding);
  const confirmed = await commit(f, review, undefined, binding);
  expect(confirmed.statusCode).toBe(201);
  const ids = confirmed.json<MemoryCommitResponse>().receipt.created_item_ids;
  expect(ids).toHaveLength(1);
  const recalled = await f.request({ method: "GET", url: `/v1/memory/items?surface=people&person_id=${binding.personID}&scope=person` });
  expect(recalled.statusCode).toBe(200);
  const item = recalled.json<MemoryRecallResponse>().items.find(value => value.id === ids[0]);
  if (!item) throw new Error("The actual contact Memory was not accepted and recalled.");
  expect(item.scope).toBe("person");
  expect(item.subject_id).toBe(binding.personID);
  expect(item.display_text).toBe(text);
  return { item, binding };
}

async function rejectTarget(f: SavedMemoryFixture, actor: Actor, target: MemoryRecallItem,
  subjectID: string | null, expectedCode: "MEMORY_TARGET_REVISION_STALE" | "MEMORY_SELF_SCOPE_ESCAPE") {
  const baseline = await canonicalState(f);
  const review = await stageAndOpen(f, actor, "My synthetic denied target replacement uses a blue notebook.", {
    operation: "update", subject_id: subjectID, previous_memory_item_id: target.id,
    previous_revision: target.version, previous_text: target.display_text,
  });
  expect(review.review.items[0]?.operation).toBe("update");
  expect(review.review.items[0]?.judgment_kind).toBe(expectedCode === "MEMORY_SELF_SCOPE_ESCAPE" ? "self_scope_escape" : "stale_target");
  const denied = await commit(actor, review, target.version);
  expect(denied.statusCode).toBe(409);
  // Exact static classification, never an entire response/review assertion
  // which could expose a credential or mistake an unrelated 4xx for denial.
  const error = denied.json<{ error: { code: string } }>();
  expect(error.error.code === expectedCode).toBe(true);
  expect(isDeepStrictEqual(await canonicalState(f), baseline)).toBe(true);
}

describe.skipIf(!savedMemoryDatabase)("canonical private-self owner target and reviewed undo", () => {
  it("maps a clean self update to the actual accepted owner target and restores the original item/evidence through actual review undo", async () => {
    await withSavedMemoryFixture(async f => {
      const text = "My synthetic owner-target notebook is copper.";
      const accepted = await f.acceptSelf(text), original = await currentSelf(f, accepted.itemID);
      expect(original.version).toBe(accepted.version);
      const beforeEvidence = await originalEvidence(f, original.id);
      expect(beforeEvidence).toHaveLength(1);
      const replacement = "My synthetic owner-target notebook is now silver.";
      // The caller does NOT send the owner subject UUID. The host must resolve
      // it from the authenticated account/user and the current canonical row.
      const review = await stageAndOpen(f, f, replacement, { operation: "update",
        previous_memory_item_id: original.id, previous_revision: original.version, previous_text: text });
      const reviewed = review.review.items[0]!;
      expect(reviewed.operation).toBe("update");
      expect(reviewed.previous_memory_item_id).toBe(original.id);
      expect(reviewed.previous_revision).toBe(original.version);
      expect(reviewed.admission_status).toBe("eligible");
      const confirmed = await commit(f, review, original.version);
      expect(confirmed.statusCode).toBe(201);
      const receipt = confirmed.json<MemoryCommitResponse>().receipt;
      expect(receipt.created_item_ids).toHaveLength(1);
      expect(receipt.updated_item_ids).toEqual([original.id]);
      expect(receipt.undo.allowed).toBe(true);
      const replacementID = receipt.created_item_ids[0]!;
      expect(replacementID === original.id).toBe(false);
      const recalled = await f.recall(), newer = recalled.items.find(item => item.id === replacementID);
      expect(recalled.items.some(item => item.id === original.id)).toBe(false);
      expect(Boolean(newer && newer.scope === "self" && newer.subject_id === original.subject_id
        && newer.version === original.version + 1 && newer.display_text === replacement
        && newer.supersedes_id === original.id)).toBe(true);
      const canonical = (await f.pool.query<{ revision: number }>(`SELECT revision FROM memory_commits
        WHERE account_id=$1 AND id=$2 AND committed_by_user_id=$3`,
      [f.auth.accountId, receipt.commit_id, f.auth.userId])).rows[0];
      if (!canonical) throw new Error("The actual reviewed update has no canonical commit.");
      const undone = await f.request({ method: "POST", url: `/v1/memory/commits/${receipt.commit_id}/undo`,
        payload: { idempotency_key: randomUUID(), expected_commit_revision: canonical.revision,
          reason: "Undo the actual synthetic reviewed self replacement." } });
      expect(undone.statusCode).toBe(200);
      expect(undone.json<MemoryUndoResponse>().receipt.status).toBe("undone");
      const restored = await currentSelf(f, original.id);
      expect(restored.version).toBe(original.version);
      expect(restored.display_text).toBe(text);
      expect((await f.recall()).items.some(item => item.id === replacementID)).toBe(false);
      expect(isDeepStrictEqual(await originalEvidence(f, original.id), beforeEvidence)).toBe(true);
    });
  }, 15_000);

  it("rejects another actual password user's private self target in the same account without changing accepted state or receipts", async () => {
    await withSavedMemoryFixture(async f => {
      const accepted = await f.acceptSelf("My synthetic private owner notebook is copper.");
      const target = await currentSelf(f, accepted.itemID);
      await withOtherUser(f, async other => {
        await rejectTarget(f, other, target, null, "MEMORY_TARGET_REVISION_STALE");
      });
    });
  }, 15_000);

  it("rejects a contact's actually accepted Person Memory as a clean private-self previous target", async () => {
    await withSavedMemoryFixture(async f => {
      const { item } = await acceptContactMemory(f);
      await rejectTarget(f, f, item, null, "MEMORY_TARGET_REVISION_STALE");
    });
  }, 15_000);

  it.each(["owner_uuid", "contact_uuid"] as const)(
    "does not admit a caller-supplied %s as independent self even when the previous item is genuinely owned",
    async kind => withSavedMemoryFixture(async f => {
      const accepted = await f.acceptSelf("My synthetic declared-subject notebook is copper.");
      const target = await currentSelf(f, accepted.itemID);
      const subjectID = kind === "owner_uuid" ? target.subject_id : (await acceptContactMemory(f)).binding.personID;
      if (!subjectID) throw new Error("The actual canonical subject is missing.");
      await rejectTarget(f, f, target, subjectID, "MEMORY_SELF_SCOPE_ESCAPE");
    }), 15_000,
  );
});
