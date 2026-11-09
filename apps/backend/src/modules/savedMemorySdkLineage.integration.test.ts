/** Genuine PostgreSQL/public SDK Session descendants. Only the remote model is
 * synthetic: password admission, accepted Memory, canonical V2 parents, Session
 * saves, Core/tools, completion and retained readers are production owners.
 * These tests must reach a successful SDK child before diagnosing its proof. */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { ScriptedAgentProvider, type AgentToolResult } from "@talent-signal/agent";
import { CONTRACT_VERSION, type MemoryCommitRequest, type MemoryCommitResponse,
  type MemoryProposalCandidate, type MemoryProposalStageRequest, type MemoryRecallResponse,
  type MemoryReviewResponse, type ResourceCaptureRequest, type ResourceCaptureResponse,
  type SessionResponse, type UnscopedChatTaskRequest, type UnscopedChatTaskResponse } from "@talent-signal/contracts";
import { describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { buildApp } from "../app.js";
import { readAgentSessionConversation } from "./agentSessions.js";
import type { RemoteChatAnswerProviding } from "./chatAnswerProvider.js";
import { createUnscopedChatTask } from "./unscopedChat.js";
import { assertDenied, type RuntimeStamp, type ToolOnlyMemory } from "./fixtures/savedMemoryRuntime.fixture.js";
import { independentReply, savedMemoryDatabase, withSavedMemoryFixture,
  type SavedMemoryFixture } from "./fixtures/savedMemoryDiscovery.fixture.js";

if (process.env.GET_462_MEMORY_AUTHORITY_TEST_REQUIRED === "1" && !savedMemoryDatabase)
  throw new Error("SDK Memory lineage verification requires the explicit disposable loopback PostgreSQL database.");

type Page = { entries: Array<{ message_id: string; role: string; text: string }> };
type Frame = { runID: string; page: Page; self: Array<{ id: string; version: number; display_text: string }>;
  manifest: readonly string[]; search: AgentToolResult; tools: readonly AgentToolResult[] };
type Publication = { claim_id: string; required: boolean; format_version: number | null;
  reader_actor_id: string | null; dependency_count: number | null; proof_digest: string | null;
  retention_kind: string | null; source_origin_session_id: string | null; expires_at: string | null;
  completion_bound: boolean | null; canonical_same_tx: boolean | null; dependencies_same_tx: boolean;
  retention_matches_source: boolean | null };
type Candidate = Omit<MemoryProposalCandidate, "source_locator">;
const responseBody = (value: { json<T>(): T }) => value.json<UnscopedChatTaskResponse>();
const scope = { personId: null, relationshipContextId: null };
const childReply = "A synthetic SDK child derived from the actually read notebook history.";
const legacyReply = "A lawful independent synthetic reply from the existing untracked writer.";

type SdkTransaction = {
  taskID: string; sessionID: string; claimID: string | null; deadline: string | null; expectedXid: string | null;
  client: PoolClient | null; lease: object | null; backend: string | null;
  registrations: number; registered: boolean; heldChecks: number; heldValid: boolean;
  commitAttempts: number; commitACK: boolean; rolledBack: boolean; http201: boolean;
  postcommitChecks: number; postcommitExact: boolean; observerFailed: boolean;
};
const sdkTransactions = new WeakMap<SavedMemoryFixture, ReturnType<typeof observeSdkTransactions>>();
const uuid = (value: unknown): value is string => typeof value === "string"
  && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(value);
function queryText(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  const text: unknown = value && typeof value === "object" ? Object.getOwnPropertyDescriptor(value, "text")?.value : undefined;
  return typeof text === "string" ? text : undefined;
}
function resultRows(value: unknown): Array<Record<string, unknown>> {
  return value && typeof value === "object" && "rows" in value && Array.isArray(value.rows) ? value.rows : [];
}

/** Observe actual driver acknowledgements, preserving both query signatures,
 * callback this/error/result tuples and the driver's original result objects.
 * Observer failures are mandatory receipt failures, never fabricated DB errors. */
function observeQuery(original: PoolClient["query"], receiver: unknown, args: unknown[],
  after: (actual: unknown) => void | Promise<void>, failed: () => void): unknown {
  const callback = args.at(-1);
  if (typeof callback === "function") {
    const forwarded = [...args];
    forwarded[forwarded.length - 1] = function(this: unknown, ...values: unknown[]) {
      if (values[0]) { failed(); return Reflect.apply(callback, this, values); }
      const callbackThis = this;
      void Promise.resolve().then(() => after(values[1])).then(
        () => Reflect.apply(callback, callbackThis, values),
        () => { failed(); return Reflect.apply(callback, callbackThis, values); },
      );
    };
    return Reflect.apply(original, receiver, forwarded);
  }
  const result: unknown = Reflect.apply(original, receiver, args);
  if (!result || typeof (result as { then?: unknown }).then !== "function") { failed(); return result; }
  return (result as Promise<unknown>).then(async actual => {
    try { await after(actual); } catch { failed(); }
    return actual;
  }, error => { failed(); throw error; });
}

/** No raw client identity is replaced. acquire covers pg's real callback and
 * promise checkouts; only bounded task/claim/origin/xid metadata is retained.
 * The independent pool performs SELECTs only against the admitted fixture DB. */
function observeSdkTransactions(f: SavedMemoryFixture) {
  const control = new Pool({ connectionString: savedMemoryDatabase, max: 1,
    connectionTimeoutMillis: 2_000, statement_timeout: 5_000, query_timeout: 6_000 });
  const receipts = new Map<string, SdkTransaction>();
  const clients = new Map<PoolClient, { original: PoolClient["query"]; wrapped: PoolClient["query"];
    lease: object; current: SdkTransaction | null }>();
  const held = (client: PoolClient, receipt: SdkTransaction) => {
    const state = clients.get(client);
    return Boolean(state && receipt.client === client && receipt.lease === state.lease && state.current === receipt);
  };
  const metadata = (receipt: SdkTransaction) => [f.auth.accountId, f.auth.userId,
    receipt.taskID, receipt.claimID, receipt.sessionID, receipt.deadline, receipt.expectedXid];
  const visibility = async (receipt: SdkTransaction) => {
    const rows = (await control.query<{ backend: string; canonical: boolean; source: boolean; lineage: boolean }>(`SELECT
      pg_backend_pid()::text AS backend,
      EXISTS(SELECT 1 FROM idempotency_records i WHERE i.account_id=$1 AND i.actor_user_id=$2
        AND i.id=$4 AND i.operation_scope='create_unscoped_chat_task' AND i.status='completed'
        AND i.response_status=201 AND i.response_body->>'task_id'=$3::text) AS canonical,
      EXISTS(SELECT 1 FROM agent_session_chat_tasks s WHERE s.account_id=$1 AND s.actor_user_id=$2
        AND s.task_id=$3::text) AS source,
      EXISTS(SELECT 1 FROM agent_task_memory_lineage t WHERE t.account_id=$1 AND t.reader_actor_id=$2
        AND t.task_id=$3::uuid) AS lineage`, metadata(receipt).slice(0, 4))).rows;
    if (rows.length !== 1) throw new Error("The real external visibility probe omitted its one metadata row.");
    return rows[0]!;
  };
  const inspectHeld = async (client: PoolClient, receipt: SdkTransaction, actual: unknown) => {
    receipt.heldChecks++;
    const original = clients.get(client)!.original;
    const rows = resultRows(actual);
    const before = resultRows(await Reflect.apply(original, client, [`SELECT
      pg_backend_pid()::text AS backend,pg_current_xact_id_if_assigned()::text AS outer_xid,
      s.xmin::text::numeric=mod($7::numeric,4294967296::numeric) AS source_at_outer,
      s.origin_session_id=$5::uuid AND to_char(s.expires_at AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')=$6::text AS exact_source,
      t.source_origin_session_id=s.origin_session_id AND t.expires_at=s.expires_at AS exact_retention
      FROM idempotency_records i JOIN agent_session_chat_tasks s ON s.account_id=i.account_id
        AND s.actor_user_id=i.actor_user_id AND s.task_id=$3::text
      JOIN agent_task_memory_lineage t ON t.account_id=i.account_id AND t.reader_actor_id=i.actor_user_id
        AND t.task_id=$3::uuid AND t.completion_idempotency_id=i.id
      WHERE i.account_id=$1 AND i.actor_user_id=$2 AND i.id=$4
        AND i.operation_scope='create_unscoped_chat_task' AND i.status='completed' AND i.response_status=201
        AND i.response_body->>'task_id'=$3::text AND i.saved_memory_lineage_required
        AND t.format_version=2 AND t.retention_kind='session_bound'`, metadata(receipt)]));
    const outside = await visibility(receipt);
    const after = resultRows(await Reflect.apply(original, client, [
      "SELECT pg_backend_pid()::text AS backend,pg_current_xact_id_if_assigned()::text AS outer_xid"]));
    const first = before[0], last = after[0];
    const backend = first?.backend;
    const valid = held(client, receipt) && receipt.registered && rows.length === 1 && rows[0]?.available === true
      && before.length === 1 && after.length === 1 && typeof backend === "string" && backend !== outside.backend
      && first?.outer_xid === receipt.expectedXid && last?.outer_xid === receipt.expectedXid
      && last?.backend === backend && receipt.backend === backend
      && first?.source_at_outer === true && first.exact_source === true && first.exact_retention === true
      && outside.canonical === false && outside.source === false && outside.lineage === false;
    receipt.heldValid = receipt.heldChecks === 1 ? valid : receipt.heldValid && valid;
    if (typeof backend === "string") receipt.backend = backend;
  };
  const acquired = (client: PoolClient) => {
    const previous = clients.get(client);
    if (previous) { previous.lease = {}; previous.current = null; return; }
    const original = client.query;
    const state = { original, wrapped: original, lease: {}, current: null as SdkTransaction | null };
    const wrapped = new Proxy(original, { apply(target, receiver, args: unknown[]) {
      const text = queryText(args[0]);
      const values: unknown = typeof args[0] === "string" ? args[1]
        : args[0] && typeof args[0] === "object" ? Object.getOwnPropertyDescriptor(args[0], "values")?.value : undefined;
      if (text && /^\s*SELECT\s+register_saved_memory_durable_lineage\s*\(/iu.test(text) && Array.isArray(values)) {
        // Deliberately do not inspect/copy proof JSON, digest or credential data.
        const receipt = typeof values[2] === "string" ? receipts.get(values[2]) : undefined;
        if (receipt) {
          receipt.registrations++; receipt.client = client; receipt.lease = state.lease; state.current = receipt;
          const valid = values.length === 11 && values[0] === f.auth.accountId && values[1] === f.auth.userId
            && uuid(values[3]) && values[4] === "session_bound" && values[5] === receipt.sessionID
            && typeof values[6] === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/u.test(values[6])
            && typeof values[10] === "string" && /^[1-9][0-9]{0,19}$/u.test(values[10]);
          if (valid) { receipt.claimID = values[3]; receipt.deadline = values[6]; receipt.expectedXid = values[10]; }
          else receipt.observerFailed = true;
          return observeQuery(target, receiver, args, async actual => {
            const rows = resultRows(actual);
            receipt.registered = false;
            if (!valid || rows.length !== 1 || rows[0]?.recorded !== true) return;
            // Observe the real backend/top xid at registration itself, before
            // delivering its unchanged positive acknowledgement to production.
            const stamp = resultRows(await Reflect.apply(target, client, [
              "SELECT pg_backend_pid()::text AS backend,pg_current_xact_id_if_assigned()::text AS outer_xid"]));
            const current = stamp[0];
            receipt.registered = held(client, receipt) && receipt.registrations === 1 && stamp.length === 1
              && typeof current?.backend === "string" && current.outer_xid === receipt.expectedXid;
            if (typeof current?.backend === "string") receipt.backend = current.backend;
          }, () => { receipt.observerFailed = true; });
        }
      }
      const receipt = state.current;
      if (text && receipt) {
        if (/^\s*ROLLBACK\b/iu.test(text)) receipt.rolledBack = true;
        if (text.includes("d.stamps=$12::jsonb->'proof'->'stamps'")) {
          // Attribute this real ACK only to its actual final-task parameter.
          // Inspect no credential slot or proof JSON, and never wash a wrong
          // target away with a later correctly targeted positive ACK.
          const taskSlot = Array.isArray(values) && values.length === 13
            ? Object.getOwnPropertyDescriptor(values, "12") : undefined;
          if (!taskSlot || !("value" in taskSlot) || taskSlot.value !== receipt.taskID) {
            receipt.observerFailed = true;
            return Reflect.apply(target, receiver, args);
          }
          return observeQuery(target, receiver, args, actual => inspectHeld(client, receipt, actual),
            () => { receipt.observerFailed = true; });
        }
        if (/^\s*COMMIT\s*;?\s*$/iu.test(text)) {
          receipt.commitAttempts++;
          return observeQuery(target, receiver, args, actual => {
            const command = actual && typeof actual === "object" ? Object.getOwnPropertyDescriptor(actual, "command")?.value : undefined;
            receipt.commitACK = held(client, receipt) && receipt.commitAttempts === 1 && command === "COMMIT";
          }, () => { receipt.observerFailed = true; });
        }
      }
      return Reflect.apply(target, receiver, args);
    } });
    state.wrapped = wrapped; clients.set(client, state); client.query = wrapped;
  };
  f.pool.on("acquire", acquired);
  return {
    enter: (taskID: string, sessionID: string | null | undefined) => {
      if (!uuid(taskID) || !uuid(sessionID) || receipts.has(taskID) || receipts.size >= 8)
        throw new Error("The SDK transaction observer requires one bounded actual Run identity.");
      receipts.set(taskID, { taskID, sessionID, claimID: null, deadline: null, expectedXid: null,
        client: null, lease: null, backend: null, registrations: 0, registered: false,
        heldChecks: 0, heldValid: false, commitAttempts: 0, commitACK: false, rolledBack: false,
        http201: false, postcommitChecks: 0, postcommitExact: false, observerFailed: false });
    },
    afterHTTP: async (taskID: string, sessionID: string) => {
      const receipt = receipts.get(taskID);
      if (!receipt) return; // expectDurable requires it; a legacy/no-register201 cannot invent one here.
      receipt.http201 = true;
      if (receipt.sessionID !== sessionID) { receipt.observerFailed = true; return; }
      if (!receipt.registered) return;
      receipt.postcommitChecks++;
      const outside = await visibility(receipt);
      const exact = (await control.query<{ present: boolean }>(`SELECT EXISTS(
        SELECT 1 FROM idempotency_records i JOIN agent_session_chat_tasks s ON s.account_id=i.account_id
          AND s.actor_user_id=i.actor_user_id AND s.task_id=$3::text
        JOIN agent_task_memory_lineage t ON t.account_id=i.account_id AND t.reader_actor_id=i.actor_user_id
          AND t.task_id=$3::uuid AND t.completion_idempotency_id=i.id
        WHERE i.account_id=$1 AND i.actor_user_id=$2 AND i.id=$4 AND i.status='completed' AND i.response_status=201
          AND i.operation_scope='create_unscoped_chat_task' AND i.response_body->>'task_id'=$3::text
          AND i.saved_memory_lineage_required AND t.format_version=2 AND t.retention_kind='session_bound'
          AND s.origin_session_id=$5::uuid AND t.source_origin_session_id=s.origin_session_id
          AND t.expires_at=s.expires_at AND to_char(s.expires_at AT TIME ZONE 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')=$6::text
          AND s.xmin::text::numeric=mod($7::numeric,4294967296::numeric)) AS present`, metadata(receipt))).rows;
      const valid = receipt.commitACK && outside.backend !== receipt.backend
        && outside.canonical && outside.source && outside.lineage && exact.length === 1 && exact[0]?.present === true;
      receipt.postcommitExact = receipt.postcommitChecks === 1 ? valid : receipt.postcommitExact && valid;
    },
    require: (taskID: string, claimID: string, sessionID: string, deadline: string | null) => {
      const receipt = receipts.get(taskID);
      expect(receipt, "The actual SDK task omitted its mandatory transaction observation receipt.").toBeDefined();
      // Never serialize raw clients/pools or private query arguments in assertion output.
      expect(receipt?.claimID).toBe(claimID); expect(receipt?.sessionID).toBe(sessionID); expect(receipt?.deadline).toBe(deadline);
      expect({ registrations: receipt?.registrations, registered: receipt?.registered,
        held: (receipt?.heldChecks ?? 0) > 0 && receipt?.heldValid, commitAttempts: receipt?.commitAttempts,
        commitACK: receipt?.commitACK, rolledBack: receipt?.rolledBack, http201: receipt?.http201,
        postcommitExact: receipt?.postcommitExact, observerFailed: receipt?.observerFailed }).toEqual({
        registrations: 1, registered: true, held: true, commitAttempts: 1, commitACK: true,
        rolledBack: false, http201: true, postcommitExact: true, observerFailed: false,
      });
    },
    dispose: async () => {
      f.pool.off("acquire", acquired);
      let replaced = false;
      for (const [client, state] of clients) {
        if (client.query === state.wrapped) client.query = state.original;
        else replaced = true;
      }
      try { await control.end(); }
      finally { if (replaced) throw new Error("An owned SDK query observer was replaced before restoration."); }
    },
  };
}

function page(output: unknown): Page {
  if (!output || typeof output !== "object" || !("content" in output) || !Array.isArray(output.content))
    throw new Error("The actual complete-history tool omitted its text envelope.");
  const block = output.content.find(value => value?.type === "text" && typeof value.text === "string");
  if (!block) throw new Error("The actual complete-history tool omitted its result.");
  const result = JSON.parse(block.text) as Page;
  if (!Array.isArray(result.entries)) throw new Error("The actual complete-history tool omitted its entries.");
  return result;
}

async function dependencies(f: SavedMemoryFixture, taskID: string): Promise<RuntimeStamp[]> {
  return (await f.pool.query<RuntimeStamp>(`SELECT memory_item_id::text,item_version,lineage_epoch::text,
    memory_owner_id::text,scope,subject_id::text,relationship_context_id::text
    FROM agent_task_saved_memory_dependencies WHERE account_id=$1 AND task_id=$2 ORDER BY memory_item_id`,
  [f.auth.accountId, taskID])).rows;
}

async function stamp(f: SavedMemoryFixture, id: string): Promise<RuntimeStamp> {
  const rows = (await f.pool.query<RuntimeStamp>(`SELECT m.id::text AS memory_item_id,m.version AS item_version,
    l.epoch::text AS lineage_epoch,m.owner_user_id::text AS memory_owner_id,m.scope,
    CASE WHEN m.scope='self' THEN NULL::text ELSE m.subject_id::text END AS subject_id,
    m.relationship_context_id::text FROM memory_items m
    JOIN memory_item_lineage l ON l.account_id=m.account_id AND l.memory_item_id=m.id
    WHERE m.account_id=$1 AND m.id=$2 AND (m.scope<>'self' OR
      (m.owner_user_id=$3 AND m.relationship_context_id IS NULL AND EXISTS (
        SELECT 1 FROM subjects owner_subject WHERE owner_subject.account_id=m.account_id
          AND owner_subject.id=m.subject_id AND owner_subject.status='active'
          AND owner_subject.external_ref='workspace-owner:' || $3::text)))`,
  [f.auth.accountId, id, f.auth.userId])).rows;
  expect(rows).toHaveLength(1);
  return rows[0]!;
}

async function publication(f: SavedMemoryFixture, taskID: string, key: string): Promise<Publication> {
  const rows = (await f.pool.query<Publication>(`SELECT i.id::text AS claim_id,
    i.saved_memory_lineage_required AS required,t.format_version,t.reader_actor_id::text,
    t.dependency_count,t.proof_digest,t.retention_kind,t.source_origin_session_id::text,
    CASE WHEN t.expires_at IS NULL THEN NULL ELSE
      to_char(t.expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END AS expires_at,
    t.completion_idempotency_id=i.id AS completion_bound,t.xmin=i.xmin AS canonical_same_tx,
    NOT EXISTS(SELECT 1 FROM agent_task_saved_memory_dependencies d WHERE d.account_id=i.account_id
      AND d.task_id=$3::uuid AND d.xmin<>t.xmin) AS dependencies_same_tx,
    t.expires_at=s.expires_at AND t.source_origin_session_id=s.origin_session_id AS retention_matches_source
    FROM idempotency_records i LEFT JOIN agent_task_memory_lineage t ON t.account_id=i.account_id
      AND t.reader_actor_id=i.actor_user_id AND t.task_id=$3::uuid
    LEFT JOIN agent_session_chat_tasks s ON s.account_id=i.account_id AND s.actor_user_id=i.actor_user_id AND s.task_id=$3::text
    WHERE i.account_id=$1 AND i.actor_user_id=$2 AND i.operation_scope='create_unscoped_chat_task'
      AND i.idempotency_key=$4 AND i.status='completed' AND i.response_status=201 AND i.response_body->>'task_id'=$3::text`,
  [f.auth.accountId, f.auth.userId, taskID, key])).rows;
  expect(rows).toHaveLength(1);
  return rows[0]!;
}

function expectDurable(f: SavedMemoryFixture, row: Publication, taskID: string,
  sessionID: string | null, stamps: readonly RuntimeStamp[]): void {
  expect(row).toMatchObject({ required: true, format_version: 2, reader_actor_id: f.auth.userId,
    dependency_count: stamps.length, completion_bound: true, canonical_same_tx: true,
    dependencies_same_tx: true, retention_kind: sessionID ? "session_bound" : "canonical_no_session",
    source_origin_session_id: sessionID });
  if (sessionID) {
    expect(row.expires_at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/);
    expect(row.retention_matches_source).toBe(true);
    const observed = sdkTransactions.get(f);
    expect(observed, "A session-bound SDK V2 requires its actual-client transaction observer.").toBeDefined();
    observed!.require(taskID, row.claim_id, sessionID, row.expires_at);
  } else expect(row.expires_at).toBeNull();
  // Independent hand-built V2 tuple, never the production codec/digest helper.
  const tuple = ["saved-memory-durable.v2", f.auth.accountId, f.auth.userId, taskID,
    row.claim_id, sessionID ? "session_bound" : "canonical_no_session", sessionID, row.expires_at,
    stamps.map(s => [s.memory_item_id, s.item_version, s.lineage_epoch,
      s.memory_owner_id, s.scope, s.subject_id, s.relationship_context_id])];
  expect(row.proof_digest).toBe(createHash("sha256").update(JSON.stringify(tuple), "utf8").digest("hex"));
}

/** Normal human review/confirmation, shared only by this new test file. */
async function commitCandidate(f: SavedMemoryFixture, text: string, candidate: Candidate,
  person: { personID: string; contextID: string; email: string } | null = null) {
  f.provider.mode = "neutral";
  const source = await f.post({ idempotency_key: randomUUID(), objective: text });
  expect(source.statusCode).toBe(201);
  const sessionID = randomUUID(), saved = await f.saveAnswer(sessionID, text, responseBody(source));
  const messageID = saved.payload!.turns[0]!.id;
  const stagedBody: MemoryProposalStageRequest = { idempotency_key: randomUUID(), surface: "chat", session_id: sessionID,
    source_message_id: messageID, source_task_id: null, person_id: person?.personID ?? null,
    relationship_context_id: person?.contextID ?? null, contact_decision: person ? "existing" : "none",
    ...(person ? { identity_authority: "human_selection" as const } : {}),
    identity_clue: person ? { type: "email", value: person.email } : null, new_contact: null,
    proposer: { kind: "human", name: "Synthetic SDK lineage acceptance", version: "1" },
    items: [{ ...candidate, source_locator: { kind: "message", session_id: sessionID, message_id: messageID } }] };
  const staged = await f.request({ method: "POST", url: "/v1/memory/proposals", payload: stagedBody });
  expect(staged.statusCode).toBe(201);
  const proposalID = staged.json<{ proposal: { proposal_id: string } }>().proposal.proposal_id;
  const opened = await f.request({ method: "POST", url: `/v1/memory/proposals/${proposalID}/reviews`,
    payload: { purpose: "chat", person_id: person?.personID ?? null, relationship_context_id: person?.contextID ?? null } });
  expect(opened.statusCode).toBe(200);
  const reviewed = opened.json<MemoryReviewResponse>(), item = reviewed.review.items[0];
  if (!item || !reviewed.review_credential) throw new Error("The actual synthetic review omitted its item/credential.");
  expect(item.operation).toBe(candidate.operation);
  expect(item.previous_memory_item_id).toBe(candidate.previous_memory_item_id);
  const commit: MemoryCommitRequest = { idempotency_key: randomUUID(), expected_proposal_revision: reviewed.review.proposal_revision,
    selected_item_ids: [item.id], contact_decision: person ? "existing" : "none",
    ...(person ? { identity_authority: "human_selection" as const, person_id: person.personID,
      relationship_context_id: person.contextID } : {}), edited_text: {}, item_decisions: {},
    expected_item_versions: candidate.operation === "update" ? { [item.id]: candidate.previous_revision! } : {},
    new_contact: null, reason: "Explicit synthetic human confirmation for SDK lineage regression." };
  const committed = await f.confirmReview(reviewed.review.review_scope_id, reviewed.review_credential, commit);
  expect(committed.statusCode).toBe(201);
  const receipt = committed.json<MemoryCommitResponse>().receipt;
  const rows = (await f.pool.query<{ revision: number }>(`SELECT revision FROM memory_commits
    WHERE account_id=$1 AND id=$2 AND committed_by_user_id=$3`,
  [f.auth.accountId, receipt.commit_id, f.auth.userId])).rows;
  expect(rows).toHaveLength(1);
  return { receipt, revision: rows[0]!.revision };
}

function candidate(text: string): Candidate {
  return { scope: "self", operation: "add", statement_kind: "source_statement", display_text: text,
    subject_id: null, relationship_context_id: null, speaker: "me", reporter: "me", valid_time: null,
    observed_time: null, time_status: "known", sensitivity: "normal", source_excerpt: text,
    previous_memory_item_id: null, previous_revision: null, previous_text: null,
    reason: "The synthetic human explicitly accepts this notebook statement." };
}

async function acceptPerson(f: SavedMemoryFixture, label: string): Promise<ToolOnlyMemory> {
  const clientID = randomUUID(), email = `sdk-lineage-${clientID}@example.invalid`, now = new Date().toISOString();
  const capture: ResourceCaptureRequest = { contract_version: CONTRACT_VERSION, idempotency_key: randomUUID(), channel: "chat",
    purpose: "Explicit synthetic identity for the SDK legacy-recall regression.", captured_at: now, source_timezone: "UTC",
    person_scope: { status: "new_person", display_label: label, relationship_context: {
      status: "proposed", label: "SDK notebook partner", purpose: "Synthetic notebook collaboration" },
    binding_basis: "The synthetic human explicitly selects this new contact and its email." },
    resource: { client_resource_id: clientID, kind: "contact_record", display_name: "Synthetic SDK contact card",
      media_type: "text/plain", observed_at: now, source_timezone: "UTC",
      retention: { requested_mode: "evidence_crop", source_scope: "reviewed_extracted_text" } },
    confirmed_identity_handles: [{ type: "email", value: email, source_client_resource_id: clientID }],
    fragments: [{ client_resource_id: clientID, kind: "contact_field", sequence: 0, text: email,
      locator: { kind: "contact_field", field: "email", source_record_version: "synthetic-sdk-v1" },
      attribution: { actor_kind: "recruiter", status: "confirmed" }, review_status: "reviewed",
      parser: { name: "synthetic-human-contact-entry", version: "1" } }] };
  const created = await f.request({ method: "POST", url: "/v1/resource-captures", payload: capture });
  expect(created.statusCode).toBe(201);
  const identity = created.json<ResourceCaptureResponse>().identity;
  expect(identity.status).toBe("bound");
  if (!identity.person_id || !identity.relationship_context_id) throw new Error("The real contact intake omitted its bound scope.");
  const personID = identity.person_id, contextID = identity.relationship_context_id;
  const text = `${label} prefers the synthetic SDK-only notebook.`;
  const accepted = await commitCandidate(f, text, { ...candidate(text), scope: "person", subject_id: personID },
    { personID, contextID, email });
  expect(accepted.receipt.created_item_ids).toHaveLength(1);
  const itemID = accepted.receipt.created_item_ids[0]!;
  const recalled = await f.request({ method: "GET", url: `/v1/memory/items?surface=people&person_id=${personID}&scope=person` });
  expect(recalled.statusCode).toBe(200);
  const item = recalled.json<MemoryRecallResponse>().items.find(value => value.id === itemID);
  expect(item).toMatchObject({ id: itemID, display_text: text, scope: "person", subject_id: personID });
  if (!item) throw new Error("The actual accepted person statement was not readable by its owner.");
  expect((await f.recall()).items.some(value => value.id === itemID)).toBe(false);
  return { itemID, version: item.version, text, personID, contextID, email };
}

async function publishPersonParent(f: SavedMemoryFixture, memory: ToolOnlyMemory) {
  const original = f.provider.run;
  let tools: readonly AgentToolResult[] = [];
  f.provider.run = async (...args: Parameters<typeof original>) => new ScriptedAgentProvider([
    { tool: "contact_workspace", input: { operation: "search", query: memory.email } },
    { tool: "contact_workspace", input: { operation: "read", person_id: memory.personID, relationship_context_id: memory.contextID } },
    { tool: "memory_review", input: { operation: "recall", scope: "person", person_id: memory.personID,
      relationship_context_id: memory.contextID } },
  ], results => { tools = results; return { outcome: "reply", title: "Synthetic ancestor", body: memory.text }; }).run(...args);
  try {
    const key = randomUUID(), objective = `Read the accepted notebook for ${memory.email} in SDK notebook partner.`;
    const posted = await f.post({ idempotency_key: key, objective });
    expect(posted.statusCode).toBe(201);
    expect(responseBody(posted).blocks[0]?.body).toBe(memory.text);
    expect(tools.map(tool => tool.name)).toEqual(["contact_workspace", "contact_workspace", "memory_review"]);
    for (const tool of tools) expect(tool.ok).toBe(true);
    expect((tools[2]!.data as MemoryRecallResponse).items).toContainEqual(expect.objectContaining({
      id: memory.itemID, version: memory.version, display_text: memory.text }));
    return { key, objective, body: responseBody(posted) };
  } finally { f.provider.run = original; }
}

async function withSDK<T>(f: SavedMemoryFixture, operation: (sdk: {
  configure(answer: string, recall?: ToolOnlyMemory): void;
  post(request: UnscopedChatTaskRequest): ReturnType<SavedMemoryFixture["post"]>;
  frames: Frame[];
  calls(): number;
}) => Promise<T>): Promise<T> {
  const enrolled = await f.request({ method: "POST", url: "/v1/auth/persistent/enroll",
    payload: { renewal_secret: randomBytes(32).toString("base64url"), client_kind: "web" } });
  expect(enrolled.statusCode).toBe(200); // Never print or persist the credential-bearing response.
  const login = enrolled.json<SessionResponse>();
  expect(login.session_id === f.auth.sessionId && login.account.id === f.auth.accountId
    && login.user.id === f.auth.userId && login.user.kind === "password_human").toBe(true);
  let answer = childReply, recalled: ToolOnlyMemory | undefined, calls = 0, fallbackCalls = 0;
  const frames: Frame[] = [];
  const provider = Object.assign(new ScriptedAgentProvider([], { outcome: "reply", title: "Synthetic SDK reply", body: childReply }),
    { providerId: "claude-agent-sdk" as const, supportsImageInput: false,
      answer: async () => { fallbackCalls++; throw new Error("The synthetic SDK must never use answer fallback."); } });
  provider.run = async (...args: Parameters<ScriptedAgentProvider["run"]>) => {
    calls++;
    const [input, invokeTool, signal] = args;
    observed.enter(input.runID, input.scopeSummary.kind === "workspace_conversation" ? input.scopeSummary.sessionID : null);
    const history = input.supplementalTools?.find(tool => tool.name === "read_session_history");
    if (!history) throw new Error("The real public SDK Session entry omitted its complete-history tool.");
    const captured = page(await history.execute({ operation: "page" }, signal));
    // Exercise the actual disabled search guard as well as its absent manifest.
    // This is not a positive search grant or a replacement of the Core dispatch.
    const search = await invokeTool("search_saved_memory", { terms: ["unexposed-sdk-lineage"], limit: 10 });
    const frame: Frame = { runID: input.runID, page: captured,
      self: (input.selfMemoryContext?.items ?? []).map(item => ({ id: item.id, version: item.version, display_text: item.display_text })),
      manifest: [...input.toolManifest], search, tools: [] };
    frames.push(frame);
    const steps = recalled ? [
      { tool: "contact_workspace", input: { operation: "search", query: recalled.email } },
      { tool: "contact_workspace", input: { operation: "read", person_id: recalled.personID, relationship_context_id: recalled.contextID } },
      { tool: "memory_review", input: { operation: "recall", scope: "person", person_id: recalled.personID,
        relationship_context_id: recalled.contextID } },
    ] : [];
    return new ScriptedAgentProvider(steps, results => {
      frame.tools = results;
      return { outcome: "reply", title: "Synthetic SDK reply", body: answer };
    }).run(...args);
  };
  const observed = observeSdkTransactions(f);
  sdkTransactions.set(f, observed);
  let sdk: Awaited<ReturnType<typeof buildApp>> | undefined;
  try {
    sdk = await buildApp({ pool: f.pool, config: { databaseUrl: savedMemoryDatabase!, host: "127.0.0.1", port: 0,
      allowedOrigins: [], appleSignInAudiences: [], appleSignInEnabled: false,
      passwordAuthEnabled: true, passwordRegistrationEnabled: false, simulatedAuthEnabled: false,
      internalLabEnabled: false, retentionSweepIntervalMs: 60_000, sessionTtlSeconds: 3_600 },
    remoteChatProvider: provider, personResearchProvider: null, privateConversationProvider: null,
    labProviders: new Map(), labJobWorkerEnabled: false, conversationQueueWorkerEnabled: false,
    labCIVerifier: null, screenshotContact: null });
    await sdk.ready();
    const active = sdk;
    return await operation({ configure: (value, memory) => { answer = value; recalled = memory; }, frames,
      calls: () => calls, post: async payload => {
        const result = await active.inject({ method: "POST", url: "/v1/chat/unscoped-tasks",
          headers: { authorization: `Bearer ${login.access_token}` }, payload });
        if (result.statusCode === 201 && payload.session_id)
          await observed.afterHTTP(responseBody(result).task_id, payload.session_id);
        return result;
      } });
  } finally {
    try { await sdk?.close(); }
    finally {
      try { await observed.dispose(); }
      finally { sdkTransactions.delete(f); expect(fallbackCalls).toBe(0); }
    }
  }
}

function expectSearchClosed(frame: Frame): void {
  expect(frame.manifest).not.toContain("search_saved_memory");
  expect(frame.search).toMatchObject({ name: "search_saved_memory", ok: false,
    error: { code: "SAVED_MEMORY_UNAVAILABLE" } });
  expect(frame.search.data).toBeUndefined();
}

async function prepare(f: SavedMemoryFixture) {
  const independentKey = randomUUID(), independentObjective = "Preserve my independent original synthetic greeting.";
  const independent = await f.post({ idempotency_key: independentKey, objective: independentObjective });
  expect(independent.statusCode).toBe(201);
  expect(responseBody(independent).blocks[0]?.body).toBe(independentReply);
  expectDurable(f, await publication(f, responseBody(independent).task_id, independentKey), responseBody(independent).task_id, null, []);
  // Use the existing real trusted writer for lawful marker-false compatibility,
  // before any Memory exists. No successful canonical/lineage row is inserted.
  const legacyKey = randomUUID(), legacyObjective = "Preserve my lawful old independent synthetic request.";
  const legacyProvider: RemoteChatAnswerProviding = { providerId: "zhipu-chat-completions", model: "synthetic-legacy",
    supportsImageInput: false, async answer() { return { kind: "answer", title: "Synthetic legacy reply", body: legacyReply,
      citation_ids: [], provider_id: "zhipu-chat-completions", model: "synthetic-legacy", provider_request_id: null,
      input_tokens: 0, output_tokens: 0, usage_reported: false }; } };
  const legacy = await createUnscopedChatTask(f.pool, f.auth, { idempotency_key: legacyKey, objective: legacyObjective }, legacyProvider);
  expect(legacy.status).toBe(201);
  expect(legacy.body.blocks[0]?.body).toBe(legacyReply);
  expect(await publication(f, legacy.body.task_id, legacyKey)).toMatchObject({ required: false, format_version: null });
  const statement = "My synthetic SDK ancestor notebook is violet.", memory = await f.acceptSelf(statement);
  const original = await stamp(f, memory.itemID);
  f.provider.mode = "recall"; f.provider.selectedMemoryID = memory.itemID;
  const human = "Preserve my original human notebook request after Memory withdrawal.", parentKey = randomUUID();
  const parent = await f.post({ idempotency_key: parentKey, objective: human });
  expect(parent.statusCode).toBe(201);
  const parentBody = responseBody(parent);
  expect(parentBody.blocks[0]?.body).toBe(statement);
  expect(await dependencies(f, parentBody.task_id)).toEqual([original]);
  expectDurable(f, await publication(f, parentBody.task_id, parentKey), parentBody.task_id, null, [original]);
  const sessionID = randomUUID();
  const first = await f.saveAnswer(sessionID, independentObjective, responseBody(independent));
  const second = await f.saveAnswer(sessionID, legacyObjective, legacy.body,
    { expectedRevision: first.revision, priorTurns: first.payload!.turns });
  const saved = await f.saveAnswer(sessionID, human, parentBody,
    { expectedRevision: second.revision, priorTurns: second.payload!.turns });
  return { sessionID, saved, human, statement, memory, original, parentKey, parentBody,
    independentKey, independentObjective, independent: responseBody(independent), legacyKey, legacyObjective, legacy: legacy.body };
}

function expectHistory(entries: Page["entries"], human: string, absent: readonly string[]): void {
  expect(entries).toContainEqual(expect.objectContaining({ role: "user", text: human }));
  expect(entries).toContainEqual(expect.objectContaining({ role: "assistant", text: independentReply }));
  expect(entries).toContainEqual(expect.objectContaining({ role: "assistant", text: legacyReply }));
  for (const text of absent) expect(entries.some(entry => entry.role === "assistant" && entry.text === text)).toBe(false);
}

describe.skipIf(!savedMemoryDatabase)("successful public SDK Session durable Memory lineage", { concurrent: false }, () => {
  it("registers the exact original ancestor plus actual new Self and legacy recall union on the child's canonical transaction without opening SDK search",
    async () => withSavedMemoryFixture(async f => {
      const p = await prepare(f);
      const a = await acceptPerson(f, "Synthetic SDK history-only ancestor");
      const inherited = await stamp(f, a.itemID), parent = await publishPersonParent(f, a);
      const parentStamps = [p.original, inherited].sort((x, y) => x.memory_item_id.localeCompare(y.memory_item_id));
      expectDurable(f, await publication(f, parent.body.task_id, parent.key), parent.body.task_id, null, parentStamps);
      expect(await dependencies(f, parent.body.task_id)).toEqual(parentStamps);
      const ancestorSaved = await f.saveAnswer(p.sessionID, parent.objective, parent.body,
        { expectedRevision: p.saved.revision, priorTurns: p.saved.payload!.turns });
      const b = await f.acceptSelf("My synthetic new SDK Self notebook is silver.");
      const c = await acceptPerson(f, "Synthetic SDK recalled partner");
      const d = await acceptPerson(f, "unexposed-sdk-lineage partner");
      const expected = [p.original, inherited, await stamp(f, b.itemID), await stamp(f, c.itemID)]
        .sort((x, y) => x.memory_item_id.localeCompare(y.memory_item_id));
      await withSDK(f, async sdk => {
        sdk.configure(childReply, c);
        const key = randomUUID(), request = { idempotency_key: key, objective: `Read my notebook history and ${c.email} in SDK notebook partner.`,
          session_id: p.sessionID, message_id: randomUUID() };
        const answer = await sdk.post(request);
        expect(answer.statusCode).toBe(201);
        expect(responseBody(answer).blocks[0]?.body).toBe(childReply);
        expect(sdk.frames).toHaveLength(1);
        const frame = sdk.frames[0]!;
        expect(frame.runID).toBe(responseBody(answer).task_id);
        expect(frame.page.entries).toContainEqual(expect.objectContaining({ role: "assistant", text: p.statement }));
        expect(frame.page.entries).toContainEqual(expect.objectContaining({ role: "assistant", text: a.text }));
        expectHistory(frame.page.entries, p.human, []);
        expectSearchClosed(frame);
        expect(frame.self.map(item => item.id).sort()).toEqual([p.memory.itemID, b.itemID].sort());
        expect(frame.self).toContainEqual({ id: b.itemID, version: b.version, display_text: "My synthetic new SDK Self notebook is silver." });
        expect(frame.tools.map(tool => tool.name)).toEqual(["contact_workspace", "contact_workspace", "memory_review"]);
        for (const tool of frame.tools) expect(tool.ok).toBe(true);
        const items = (frame.tools[2]!.data as MemoryRecallResponse).items;
        expect(items).toContainEqual(expect.objectContaining({ id: c.itemID, version: c.version, display_text: c.text }));
        expect(items.some(item => item.id === a.itemID)).toBe(false);
        expect(items.some(item => item.id === d.itemID)).toBe(false);
        expect(frame.self.some(item => item.id === a.itemID || item.id === c.itemID || item.id === d.itemID)).toBe(false);
        const task = responseBody(answer).task_id;
        // Intended first baseline RED: the successful SDK child has no marker/V2.
        const registered = await publication(f, task, key);
        expectDurable(f, registered, task, p.sessionID, expected);
        expect(await dependencies(f, task)).toEqual(expected);
        expect(await dependencies(f, p.parentBody.task_id)).toEqual([p.original]);
        expect(await dependencies(f, parent.body.task_id)).toEqual(parentStamps);
        const replay = await sdk.post(request);
        expect(replay.statusCode).toBe(201);
        expect(responseBody(replay)).toEqual(responseBody(answer));
        expect(sdk.calls()).toBe(1);
        expect(await publication(f, task, key)).toEqual(registered);
        expect(await dependencies(f, task)).toEqual(expected);
        // The next real descendant must inherit C from this SDK child's proof,
        // although that later Run never recalls C and never receives it as Self.
        await f.saveAnswer(p.sessionID, "Preserve my successful synthetic SDK child.", responseBody(answer),
          { expectedRevision: ancestorSaved.revision, priorTurns: ancestorSaved.payload!.turns });
        sdk.configure(independentReply);
        const nextKey = randomUUID(), next = await sdk.post({ idempotency_key: nextKey,
          objective: "Continue the synthetic SDK child without another person recall.",
          session_id: p.sessionID, message_id: randomUUID() });
        expect(next.statusCode).toBe(201); expect(sdk.calls()).toBe(2);
        expect(sdk.frames[1]!.page.entries).toContainEqual(expect.objectContaining({ role: "assistant", text: childReply }));
        expect(sdk.frames[1]!.tools).toEqual([]);
        expect(sdk.frames[1]!.self.some(item => item.id === c.itemID)).toBe(false);
        expectSearchClosed(sdk.frames[1]!);
        const nextTask = responseBody(next).task_id;
        expectDurable(f, await publication(f, nextTask, nextKey), nextTask, p.sessionID, expected);
        expect(await dependencies(f, nextTask)).toEqual(expected);
        expect(await f.current()).toBe(200);
      });
    }), 15_000);

  it.each(["delete", "replacement-undo"] as const)(
    "refuses real SDK child replay and new complete/inline/history-tool reads after normal %s while preserving human, independent and lawful untracked history",
    async operation => withSavedMemoryFixture(async f => {
      const p = await prepare(f);
      await withSDK(f, async sdk => {
        const key = randomUUID(), childHuman = "Preserve my human SDK continuation request.", request = {
          idempotency_key: key, objective: childHuman, session_id: p.sessionID, message_id: randomUUID() };
        const answer = await sdk.post(request);
        expect(answer.statusCode).toBe(201);
        expect(responseBody(answer).blocks[0]?.body).toBe(childReply);
        expect(sdk.frames).toHaveLength(1);
        expect(sdk.frames[0]!.page.entries).toContainEqual(expect.objectContaining({ role: "assistant", text: p.statement }));
        expectSearchClosed(sdk.frames[0]!);
        await f.saveAnswer(p.sessionID, childHuman, responseBody(answer),
          { expectedRevision: p.saved.revision, priorTurns: p.saved.payload!.turns });
        for (const complete of [false, true]) {
          const before = await readAgentSessionConversation(f.pool, f.auth, p.sessionID, scope, { complete });
          expect(before.messages).toContainEqual(expect.objectContaining({ role: "assistant", text: childReply }));
        }
        const assertWithdrawn = async () => {
          const calls = sdk.calls();
          const retry = await sdk.post(request);
          // Retry is a retained read, not authorization to execute another model.
          expect(sdk.calls()).toBe(calls);
          const reads = await Promise.all([false, true].map(complete =>
            readAgentSessionConversation(f.pool, f.auth, p.sessionID, scope, { complete })));
          for (const read of reads) {
            expectHistory(read.messages, p.human, [p.statement, childReply]);
            expect(read.messages).toContainEqual(expect.objectContaining({ role: "user", text: childHuman }));
          }
          assertDenied(retry, childReply);
          assertDenied(await f.post({ idempotency_key: p.parentKey, objective: p.human }), p.statement);
          const independent = await sdk.post({ idempotency_key: p.independentKey, objective: p.independentObjective });
          expect(independent.statusCode).toBe(201); expect(responseBody(independent)).toEqual(p.independent);
          const legacy = await sdk.post({ idempotency_key: p.legacyKey, objective: p.legacyObjective });
          expect(legacy.statusCode).toBe(201); expect(responseBody(legacy)).toEqual(p.legacy);
          expect(sdk.calls()).toBe(calls);
          sdk.configure(independentReply);
          const fresh = await sdk.post({ idempotency_key: randomUUID(), objective: "Read only current synthetic notebook history.",
            session_id: p.sessionID, message_id: randomUUID() });
          expect(fresh.statusCode).toBe(201);
          expect(sdk.calls()).toBe(calls + 1);
          const frame = sdk.frames.at(-1)!;
          expectHistory(frame.page.entries, p.human, [p.statement, childReply]);
          expectSearchClosed(frame);
          expect(await f.current()).toBe(200);
        };
        if (operation === "delete") {
          const removed = await f.request({ method: "POST", url: `/v1/memory/items/${p.memory.itemID}/mutations`, payload: {
            idempotency_key: randomUUID(), expected_version: p.memory.version, operation: "delete",
            reason: "Normal synthetic human withdrawal after a successful SDK child." } });
          expect(removed.statusCode).toBe(200);
          expect(BigInt((await stamp(f, p.memory.itemID)).lineage_epoch)).toBeGreaterThan(BigInt(p.original.lineage_epoch));
          await assertWithdrawn();
        } else {
          const replacement = "My synthetic SDK ancestor notebook is now copper.";
          const changed = await commitCandidate(f, replacement, { ...candidate(replacement), operation: "update",
            previous_memory_item_id: p.memory.itemID, previous_revision: p.memory.version, previous_text: p.statement });
          expect((await f.recall()).items.some(item => item.id === p.memory.itemID)).toBe(false);
          await assertWithdrawn();
          const undone = await f.request({ method: "POST", url: `/v1/memory/commits/${changed.receipt.commit_id}/undo`, payload: {
            idempotency_key: randomUUID(), expected_commit_revision: changed.revision,
            reason: "Normal synthetic undo restores the original item/version, never its old epoch." } });
          expect(undone.statusCode).toBe(200);
          expect((await f.recall()).items).toContainEqual(expect.objectContaining({ id: p.memory.itemID,
            version: p.memory.version, display_text: p.statement }));
          const restored = await stamp(f, p.memory.itemID);
          expect(restored.item_version).toBe(p.original.item_version);
          expect(BigInt(restored.lineage_epoch)).toBeGreaterThan(BigInt(p.original.lineage_epoch));
          await assertWithdrawn();
          expect(await dependencies(f, responseBody(answer).task_id)).toEqual([p.original]);
        }
      });
    }), 15_000);

  it.each(["dependency", "lineage"] as const)(
    "keeps the real SDK child's required marker fail-closed after %s metadata loss without a Memory/login/source mutation",
    async loss => withSavedMemoryFixture(async f => {
      const p = await prepare(f);
      await withSDK(f, async sdk => {
        const key = randomUUID(), request = { idempotency_key: key, objective: "Read my synthetic original notebook history.",
          session_id: p.sessionID, message_id: randomUUID() };
        const answer = await sdk.post(request);
        expect(answer.statusCode).toBe(201);
        expect(responseBody(answer).blocks[0]?.body).toBe(childReply);
        expect(sdk.frames).toHaveLength(1); expectSearchClosed(sdk.frames[0]!);
        const task = responseBody(answer).task_id, published = await publication(f, task, key);
        expectDurable(f, published, task, p.sessionID, [p.original]);
        expect(await dependencies(f, task)).toEqual([p.original]);
        await f.saveAnswer(p.sessionID, "Keep my synthetic child question.", responseBody(answer),
          { expectedRevision: p.saved.revision, priorTurns: p.saved.payload!.turns });
        const witness = async () => (await f.pool.query(`SELECT
          md5(jsonb_build_array(s.payload->'turns',s.payload->'personID',s.payload->'relationshipContextID')::text) AS stamp,
          s.revision,s.expires_at::text,COALESCE(g.generation,0)::text AS generation,
          a.revoked_at IS NULL AND a.expires_at>clock_timestamp() AS live,
          md5(i.response_body::text) AS canonical_body,i.saved_memory_lineage_required AS required
          FROM agent_sessions s JOIN sessions a ON a.account_id=s.account_id AND a.user_id=s.created_by_user_id AND a.id=$3
          JOIN idempotency_records i ON i.account_id=s.account_id AND i.id=$4
          LEFT JOIN harness_source_generations g ON g.account_id=s.account_id
          WHERE s.account_id=$1 AND s.id=$2`, [f.auth.accountId, p.sessionID, f.auth.sessionId, published.claim_id])).rows;
        const before = await witness();
        expect(before).toHaveLength(1); expect(before[0]).toMatchObject({ live: true, required: true });
        // Negative loss only, after genuine registration. Never create or repair
        // a positive proof/receipt by SQL; keep all original source data intact.
        const client = await f.pool.connect();
        try {
          await client.query("BEGIN");
          const removed = await client.query(`DELETE FROM agent_task_saved_memory_dependencies
            WHERE account_id=$1 AND task_id=$2 AND memory_item_id=$3 RETURNING memory_item_id`,
          [f.auth.accountId, task, p.memory.itemID]);
          expect(removed.rowCount).toBe(1);
          if (loss === "lineage") {
            await client.query("DELETE FROM agent_task_memory_session_copies WHERE account_id=$1 AND task_id=$2", [f.auth.accountId, task]);
            const lineage = await client.query(`DELETE FROM agent_task_memory_lineage
              WHERE account_id=$1 AND reader_actor_id=$2 AND task_id=$3 RETURNING task_id`, [f.auth.accountId, f.auth.userId, task]);
            expect(lineage.rowCount).toBe(1);
          }
          await client.query("COMMIT");
        } catch (error) { await client.query("ROLLBACK"); throw error; }
        finally { client.release(); }
        expect(await witness()).toEqual(before);
        expect(await stamp(f, p.memory.itemID)).toEqual(p.original);
        expect((await f.recall()).items).toContainEqual(expect.objectContaining({ id: p.memory.itemID, display_text: p.statement }));
        assertDenied(await sdk.post(request), childReply);
        expect(sdk.calls()).toBe(1);
        for (const complete of [false, true]) {
          const current = await readAgentSessionConversation(f.pool, f.auth, p.sessionID, scope, { complete });
          expectHistory(current.messages, p.human, [childReply]);
          expect(current.messages).toContainEqual(expect.objectContaining({ role: "assistant", text: p.statement }));
        }
        sdk.configure(independentReply);
        const fresh = await sdk.post({ idempotency_key: randomUUID(), objective: "Read the currently retained synthetic history.",
          session_id: p.sessionID, message_id: randomUUID() });
        expect(fresh.statusCode).toBe(201); expect(sdk.calls()).toBe(2);
        expectHistory(sdk.frames[1]!.page.entries, p.human, [childReply]);
        expect(sdk.frames[1]!.page.entries).toContainEqual(expect.objectContaining({ role: "assistant", text: p.statement }));
        expectSearchClosed(sdk.frames[1]!);
      });
    }), 15_000);

  it("publishes a genuine empty SDK V2 and replays it without another model call when its actual history and Self contain no Memory",
    async () => withSavedMemoryFixture(async f => {
      const firstKey = randomUUID(), first = await f.post({ idempotency_key: firstKey, objective: "Give a synthetic greeting without Memory." });
      expect(first.statusCode).toBe(201);
      expectDurable(f, await publication(f, responseBody(first).task_id, firstKey), responseBody(first).task_id, null, []);
      const sessionID = randomUUID();
      await f.saveAnswer(sessionID, "Preserve this synthetic greeting.", responseBody(first));
      await withSDK(f, async sdk => {
        sdk.configure(independentReply);
        const key = randomUUID(), request = { idempotency_key: key, objective: "Continue my independent synthetic greeting.",
          session_id: sessionID, message_id: randomUUID() };
        const answer = await sdk.post(request);
        expect(answer.statusCode).toBe(201);
        expect(responseBody(answer).blocks[0]?.body).toBe(independentReply);
        expect(sdk.frames).toHaveLength(1); expect(sdk.frames[0]!.self).toEqual([]);
        expectSearchClosed(sdk.frames[0]!);
        const task = responseBody(answer).task_id, published = await publication(f, task, key);
        expectDurable(f, published, task, sessionID, []);
        expect(await dependencies(f, task)).toEqual([]);
        const replay = await sdk.post(request);
        expect(replay.statusCode).toBe(201); expect(responseBody(replay)).toEqual(responseBody(answer));
        expect(sdk.calls()).toBe(1); expect(await publication(f, task, key)).toEqual(published);
      });
    }), 15_000);
});
