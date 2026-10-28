import { createHash, randomUUID } from "node:crypto";
import { ScriptedAgentProvider, type AgentProvider, type AgentToolResult } from "@talent-signal/agent";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { AuthContext } from "./auth.js";
import { admitConversationQueueEntry, mutateConversationQueueEntry } from "./conversationQueueAdmission.js";
import { claimNextConversationQueueEntry, finalizeConversationQueueEntry, readConversationQueueSnapshot,
  reclaimStaleConversationQueueEntry,
  type ClaimedConversationQueueEntry } from "./conversationQueueState.js";
import { executeWorkspaceConversationAgent } from "./workspaceConversationAgent.js";
import { openMemoryReview } from "./memoryReviewRead.js";
import { ConversationQueueRunner } from "./conversationQueueRunner.js";
import { getAgentSession, mutateAgentSession } from "./agentSessions.js";
import type { RemoteChatAnswerProviding } from "./chatAnswerProvider.js";
import { digestValue } from "../lib/hash.js";

// This suite never consumes the general/resident database variable. Provision
// and migrate one disposable database specifically for GET-298 before opting in.
// It creates random isolated accounts and deletes only those accounts' rows;
// there is no DROP/TRUNCATE or shared database reset in this test.
const url = process.env.GET_298_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname)
    || !/^\/talent_signal_get298_[a-z0-9_]+$/u.test(parsed.pathname)) {
    throw new Error("GET_298_TEST_DATABASE_URL must name an isolated local talent_signal_get298_* database.");
  }
}
const pool = url ? new Pool({ connectionString: url, max: 4, connectionTimeoutMillis: 5000, query_timeout: 15000 }) : null;
const suite = url ? describe : describe.skip;
beforeAll(async () => {
  if (!pool) return;
  expect((await pool.query("SELECT current_database() AS name")).rows[0]?.name).toBe(new URL(url!).pathname.slice(1));
});
afterAll(async () => { await pool?.end(); });
const cleanupFailures: unknown[] = [];
afterEach(() => {
  const errors = cleanupFailures.splice(0);
  // A hook failure is reported alongside a failing test body, rather than
  // replacing its assertion error from inside a finally block.
  if (errors.length) throw new AggregateError(errors, "GET-298 synthetic fixture cleanup failed");
});

async function fixture() {
  const accountId = randomUUID(), userId = randomUUID(), sessionId = randomUUID(), personId = randomUUID();
  const auth: AuthContext = { accountId, accountSlug: `get298-${accountId}`, userId,
    userEmail: `${userId}@synthetic.example.test`, userKind: "simulated_human", sessionId: randomUUID() };
  await pool!.query("INSERT INTO accounts(id,slug,name) VALUES($1,$2,'GET-298 synthetic proof')", [accountId, auth.accountSlug]);
  await pool!.query("INSERT INTO users(id,account_id,email,display_name,kind) VALUES($1,$2,$3,'Synthetic owner','simulated_human')",
    [userId, accountId, auth.userEmail]);
  await pool!.query("INSERT INTO subjects(id,account_id,external_ref,display_label,status) VALUES($1,$2,$3,'Synthetic Lin','active')",
    [personId, accountId, `get298:${personId}`]);
  const now = new Date().toISOString();
  await pool!.query(`INSERT INTO agent_sessions(account_id,id,created_by_user_id,revision,payload,created_at,expires_at)
    VALUES($1,$2,$3,1,$4::jsonb,now(),now()+interval '1 day')`, [accountId, sessionId, userId, JSON.stringify({ id: sessionId,
    scopeKind: "unresolved_intent", personDisplayLabel: "", contextDisplayLabel: "", title: "", turns: [], updatedAt: now, createdAt: now })]);
  return { auth, accountId, sessionId, personId };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function removeFixture(f: Fixture) {
  try {
  const tables = (await pool!.query<{ table_name: string }>(
    "SELECT table_name FROM lab_test_workspace_table_manifest WHERE scope='account' ORDER BY table_name",
  )).rows.map(row => row.table_name).filter(table => table !== "harness_source_generations");
  const targets = [...tables, "sessions"];
  await pool!.query(`WITH ${targets.map((table, i) => `d${i} AS (DELETE FROM "${table}" WHERE account_id=$1 RETURNING 1)`).join(",")}
    SELECT ${targets.map((_, i) => `(SELECT count(*) FROM d${i})`).join("+")}`, [f.accountId]);
  await pool!.query("DELETE FROM users WHERE account_id=$1", [f.accountId]);
  // Deletes from source tables invalidate the harness and upsert its account
  // generation. Remove that control-plane row only after those triggers and
  // user cleanup have finished; deleting it in the same CTE lets it reappear.
  await pool!.query("DELETE FROM harness_source_generations WHERE account_id=$1", [f.accountId]);
  await pool!.query("DELETE FROM accounts WHERE id=$1", [f.accountId]);
  } catch (error) { cleanupFailures.push(error); }
}
const text = "Lin prefers written agendas before meetings. Prepare a Memory draft for review.";
async function admit(f: Fixture, overrides: Record<string, unknown> = {}) {
  const request = { session_id: f.sessionId, message_id: randomUUID(), idempotency_key: randomUUID(), objective: text,
    memory_draft_target: { person_id: f.personId }, ...overrides };
  return { request, ...(await admitConversationQueueEntry(pool!, f.auth, request)) };
}
async function claim(f: Fixture) {
  return (await claimNextConversationQueueEntry(pool!, { accountId: f.accountId, sessionId: f.sessionId,
    workerId: "get298-synthetic", acceptsSteering: true }))!;
}
function provider(f: Fixture, claim: Pick<ClaimedConversationQueueEntry, "messageId">, replacement: Record<string, unknown> = {},
  onResults?: (results: readonly AgentToolResult[]) => void) {
  return new ScriptedAgentProvider([{ tool: "memory_review", input: { operation: "propose", person_id: f.personId,
    contact_decision: "existing", relationship_context_id: null, items: [{ scope: "person", operation: "add",
      statement_kind: "source_statement", subject_id: f.personId, display_text: "Prefers written agendas before meetings",
      speaker: "Lin", source_excerpt: "Lin prefers written agendas before meetings",
      source_locator: { kind: "message", session_id: f.sessionId, message_id: claim.messageId },
      time_status: "unknown", sensitivity: "normal", reason: "Current authored text" }], ...replacement } }], results => {
    onResults?.(results); return { outcome: "reply", title: "Review", body: "Draft prepared for review." };
  });
}
function execute(f: Fixture, c: ClaimedConversationQueueEntry, p = provider(f, c)) {
  return executeWorkspaceConversationAgent({ database: pool!, auth: f.auth, sessionID: f.sessionId, messageID: c.messageId,
    runID: c.runId, objective: c.objective, sourceText: c.objective, memoryDraftTarget: c.memoryDraftTarget,
    hostAuthority: { fence: c, sessionId: c.sessionId, messageId: c.messageId }, provider: p });
}

suite("GET-298 isolated durable target and real Memory producer", () => {
  it("round-trips a text-only pending proposal to the exact Person and current message without saving facts", async () => {
    const f = await fixture();
    try {
      await admit(f);
      const c = await claim(f);
      expect(c.memoryDraftTarget).toEqual({ person_id: f.personId });
      const snapshot = await readConversationQueueSnapshot(pool!, f.auth, f.sessionId);
      expect(snapshot.active).toMatchObject({ memory_draft_target: { person_id: f.personId }, accepts_steering: false });
      const result = await execute(f, c);
      expect(result.memoryProposal).toBeTruthy();
      const stored = (await pool!.query("SELECT target_person_id,source_message_id,source_task_id,contact_decision FROM memory_proposals WHERE account_id=$1 AND id=$2",
        [f.accountId, result.memoryProposal!.proposal_id])).rows[0];
      expect(stored).toEqual({ target_person_id: f.personId, source_message_id: c.messageId, source_task_id: c.runId, contact_decision: "existing" });
      const review = await openMemoryReview(pool!, f.auth, result.memoryProposal!.proposal_id, { purpose: "chat", session_id: f.sessionId });
      expect(review.review.items).toHaveLength(1);
      expect(review.review.items[0]).toMatchObject({ scope: "person", source_excerpt: "Lin prefers written agendas before meetings" });
      expect((await pool!.query("SELECT count(*)::int AS count FROM memory_items WHERE account_id=$1", [f.accountId])).rows[0]?.count).toBe(0);
      expect((await pool!.query("SELECT count(*)::int AS count FROM subjects WHERE account_id=$1", [f.accountId])).rows[0]?.count).toBe(1);
    } finally { await removeFixture(f); }
  });

  it("preserves retries, conflicts on target replacement, and independently queues around a steering leader", async () => {
    const f = await fixture();
    try {
      const ordinary = await admit(f, { memory_draft_target: undefined });
      expect((await pool!.query("SELECT request_hash FROM idempotency_records WHERE account_id=$1 AND idempotency_key=$2",
        [f.accountId, ordinary.request.idempotency_key])).rows[0]?.request_hash).toBe(digestValue({ session_id: f.sessionId,
        message_id: ordinary.request.message_id, objective: text, time_zone: null }));
      const leader = await claim(f);
      const targeted = await admit(f);
      expect(targeted.response).not.toHaveProperty("steers_run_id");
      expect(await admitConversationQueueEntry(pool!, f.auth, targeted.request)).toMatchObject({ replayed: true });
      await expect(admitConversationQueueEntry(pool!, f.auth, { ...targeted.request,
        memory_draft_target: { person_id: randomUUID() } })).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
      await expect(admitConversationQueueEntry(pool!, f.auth, { ...targeted.request, idempotency_key: randomUUID(),
        memory_draft_target: { person_id: randomUUID() } })).rejects.toMatchObject({ code: "CONVERSATION_QUEUE_MESSAGE_CONFLICT" });
      const snapshot = await readConversationQueueSnapshot(pool!, f.auth, f.sessionId);
      expect(snapshot.active?.queue_entry_id).toBe(ordinary.response.queue_entry_id);
      expect(snapshot.active).not.toHaveProperty("memory_draft_target");
      await finalizeConversationQueueEntry(pool!, { fence: leader, status: "cancelled" });
      // A plain cancellation pauses the queue; explicitly continue the work.
      const paused = await readConversationQueueSnapshot(pool!, f.auth, f.sessionId);
      await mutateConversationQueueEntry(pool!, f.auth, f.sessionId, { kind: "continue", idempotency_key: randomUUID(), expected_revision: paused.revision });
      const selected = await claim(f);
      expect(selected.memoryDraftTarget?.person_id).toBe(f.personId);
      const following = await admit(f, { memory_draft_target: undefined });
      expect(following.response).not.toHaveProperty("steers_run_id");
      await finalizeConversationQueueEntry(pool!, { fence: selected, status: "failed", failureCode: "SYNTHETIC_RETRY" });
      const failed = await readConversationQueueSnapshot(pool!, f.auth, f.sessionId);
      await mutateConversationQueueEntry(pool!, f.auth, f.sessionId, { kind: "retry", queue_entry_id: selected.entryId,
        expected_revision: failed.revision, idempotency_key: randomUUID() });
      const retryQueued = await readConversationQueueSnapshot(pool!, f.auth, f.sessionId);
      await mutateConversationQueueEntry(pool!, f.auth, f.sessionId, { kind: "continue", expected_revision: retryQueued.revision,
        idempotency_key: randomUUID() });
      const retried = await claim(f);
      expect(retried.memoryDraftTarget?.person_id).toBe(f.personId);
      await finalizeConversationQueueEntry(pool!, { fence: retried, status: "cancelled" });
      expect((await pool!.query("SELECT memory_draft_target_person_id,objective,content_state FROM conversation_queue_entries WHERE account_id=$1 AND id=$2",
        [f.accountId, retried.entryId])).rows[0]).toEqual({ memory_draft_target_person_id: null, objective: null, content_state: "scrubbed" });
    } finally { await removeFixture(f); }
  });

  it("rejects cross-account, deleted, empty-text and host-result target admissions", async () => {
    const f = await fixture(), foreign = await fixture();
    try {
      await expect(admit(f, { memory_draft_target: { person_id: foreign.personId } })).rejects.toMatchObject({ code: "MEMORY_DRAFT_TARGET_UNAVAILABLE" });
      await expect(admit(f, { objective: " " })).rejects.toMatchObject({ code: "MEMORY_DRAFT_TARGET_TEXT_REQUIRED" });
      await expect(admit(f, { images: [{}] })).rejects.toMatchObject({ code: "MEMORY_DRAFT_TARGET_TEXT_ONLY" });
      await expect(admit(f, { host_result: { request_id: randomUUID() } })).rejects.toMatchObject({ code: "MEMORY_DRAFT_TARGET_TEXT_REQUIRED" });
      await pool!.query("UPDATE subjects SET status='deleted' WHERE account_id=$1 AND id=$2", [f.accountId, f.personId]);
      await expect(admit(f)).rejects.toMatchObject({ code: "MEMORY_DRAFT_TARGET_UNAVAILABLE" });
    } finally { await removeFixture(f); await removeFixture(foreign); }
  });

  it.each(["deleted", "cancelled", "source-revoked"] as const)("rechecks %s state after admission and before provider execution", async mode => {
    const f = await fixture();
    try {
      await admit(f); const c = await claim(f); const p = provider(f, c);
      if (mode === "deleted") await pool!.query("UPDATE subjects SET status='deleted' WHERE account_id=$1 AND id=$2", [f.accountId, f.personId]);
      if (mode === "cancelled") await pool!.query("UPDATE conversation_queue_entries SET cancel_requested=true WHERE account_id=$1 AND id=$2", [f.accountId, c.entryId]);
      if (mode === "source-revoked") await pool!.query("UPDATE agent_sessions SET deleted_at=now(),payload=NULL WHERE account_id=$1 AND id=$2", [f.accountId, f.sessionId]);
      await expect(execute(f, c, p)).rejects.toThrow();
      expect((await pool!.query("SELECT count(*)::int AS count FROM memory_proposals WHERE account_id=$1", [f.accountId])).rows[0]?.count).toBe(0);
    } finally { await removeFixture(f); }
  });

  it.each(["target-deleted", "message-cancelled", "source-deleted"] as const)("rechecks %s during the model run before staging", async mode => {
    const f = await fixture();
    try {
      await admit(f); const c = await claim(f); const scripted = provider(f, c);
      const run: AgentProvider["run"] = async (request, invoke, signal) => {
        if (mode === "target-deleted") await pool!.query("UPDATE subjects SET status='deleted' WHERE account_id=$1 AND id=$2", [f.accountId, f.personId]);
        if (mode === "message-cancelled") await pool!.query("UPDATE conversation_queue_entries SET cancel_requested=true WHERE account_id=$1 AND id=$2", [f.accountId, c.entryId]);
        if (mode === "source-deleted") await pool!.query("UPDATE agent_sessions SET deleted_at=now(),payload=NULL WHERE account_id=$1 AND id=$2", [f.accountId, f.sessionId]);
        return scripted.run(request, invoke, signal);
      };
      await expect(executeWorkspaceConversationAgent({ database: pool!, auth: f.auth, sessionID: f.sessionId,
        messageID: c.messageId, runID: c.runId, objective: c.objective, sourceText: c.objective,
        memoryDraftTarget: c.memoryDraftTarget, hostAuthority: { fence: c, sessionId: c.sessionId, messageId: c.messageId },
        provider: { id: scripted.id, model: scripted.model, sdkVersion: scripted.sdkVersion, run },
      })).rejects.toThrow();
      expect((await pool!.query("SELECT count(*)::int AS count FROM memory_proposals WHERE account_id=$1", [f.accountId])).rows[0]?.count).toBe(0);
    } finally { await removeFixture(f); }
  });

  it.each(["session", "artifact", "task"] as const)("rejects a %s source tombstone while the Session remains readable", async kind => {
    const f = await fixture();
    try {
      await admit(f); const c = await claim(f);
      if (kind === "task") await pool!.query("INSERT INTO agent_session_retracted_tasks(account_id,task_id) VALUES($1,$2)", [f.accountId, c.runId]);
      else await pool!.query("INSERT INTO memory_source_revocations(id,account_id,source_kind,source_id,reason) VALUES($1,$2,$3,$4,'source_revoked')",
        [randomUUID(), f.accountId, kind, kind === "session" ? f.sessionId : `${f.sessionId}:message:${c.messageId}`]);
      await expect(execute(f, c)).rejects.toMatchObject({ code: "MEMORY_SOURCE_REVOKED" });
      expect((await pool!.query("SELECT count(*)::int AS count FROM memory_proposals WHERE account_id=$1", [f.accountId])).rows[0]?.count).toBe(0);
    } finally { await removeFixture(f); }
  });

  it("does not persist a fallback new-contact proposal when the model ignores the selected target", async () => {
    const f = await fixture();
    try {
      await admit(f); const c = await claim(f); let tool: AgentToolResult | undefined;
      await expect(execute(f, c, provider(f, c, { person_id: null, contact_decision: "new", person_display_label: "Wrong person" },
        results => { tool = results[0]; }))).rejects.toMatchObject({ code: "MEMORY_DRAFT_TARGET_NOT_STAGED" });
      expect(tool).toMatchObject({ ok: false, error: { code: "MEMORY_DRAFT_TARGET_SCOPE_MISMATCH" } });
      expect((await pool!.query("SELECT count(*)::int AS count FROM memory_proposals WHERE account_id=$1", [f.accountId])).rows[0]?.count).toBe(0);
    } finally { await removeFixture(f); }
  });

  it("fences real legacy claim/reclaim SQL and still permits legacy source scrubbing", async () => {
    const f = await fixture();
    try {
      const queued = await admit(f);
      // Exact old UPDATE fields: no new internal claim revision is authored.
      const oldClaim = await pool!.query(`UPDATE conversation_queue_entries
        SET status='running',run_id=$3,lease_owner=$4,lease_generation=lease_generation+1,
          lease_expires_at=now()+interval '90 seconds',attempt=attempt+1,revision=revision+1,claimed_at=now(),updated_at=now(),
          cancel_requested=false,cancel_auto_continue=false,steer_closed_at=NULL
        WHERE account_id=$1 AND id=$2 AND status='queued' RETURNING *`,
      [f.accountId, queued.response.queue_entry_id, randomUUID(), "legacy-worker"]);
      expect(oldClaim.rowCount).toBe(0);
      expect((await pool!.query("SELECT status,memory_draft_target_claim_revision FROM conversation_queue_entries WHERE account_id=$1 AND id=$2",
        [f.accountId, queued.response.queue_entry_id])).rows[0]).toEqual({ status: "queued", memory_draft_target_claim_revision: 0 });
      const c = await claim(f);
      await pool!.query("UPDATE conversation_queue_entries SET lease_expires_at=now()-interval '1 second' WHERE account_id=$1 AND id=$2", [f.accountId, c.entryId]);
      const oldReclaim = await pool!.query(`UPDATE conversation_queue_entries SET lease_owner=$3,lease_generation=lease_generation+1,
        lease_expires_at=now()+interval '90 seconds',updated_at=now()
        WHERE account_id=$1 AND id=$2 AND status='running' AND (lease_expires_at IS NULL OR lease_expires_at<=now()) RETURNING *`,
      [f.accountId, c.entryId, "legacy-recovery"]);
      expect(oldReclaim.rowCount).toBe(0);
      const recovered = await reclaimStaleConversationQueueEntry(pool!, { accountId: f.accountId, sessionId: f.sessionId,
        entryId: c.entryId, workerId: "get298-recovery" });
      expect(recovered?.memoryDraftTarget).toEqual({ person_id: f.personId });
      expect((await pool!.query("SELECT memory_draft_target_claim_revision FROM conversation_queue_entries WHERE account_id=$1 AND id=$2",
        [f.accountId, c.entryId])).rows[0]?.memory_draft_target_claim_revision).toBe(2);
      await pool!.query("UPDATE conversation_queue_entries SET status='cancelled',content_state='scrubbed',objective=NULL WHERE account_id=$1 AND id=$2", [f.accountId, c.entryId]);
      expect((await pool!.query("SELECT memory_draft_target_person_id,objective FROM conversation_queue_entries WHERE account_id=$1 AND id=$2",
        [f.accountId, c.entryId])).rows[0]).toEqual({ memory_draft_target_person_id: null, objective: null });
    } finally { await removeFixture(f); }
  });

  it("runs through queue completion/reload without sending an earlier image to the targeted model call", async () => {
    const f = await fixture();
    let runner: ConversationQueueRunner | undefined;
    try {
      const bytes = Buffer.alloc(64, 1); bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
      const images = [{ attachment_id: randomUUID(), file_name: "synthetic.png", media_type: "image/png" as const,
        byte_size: bytes.length, content_hash: createHash("sha256").update(bytes).digest("hex"), data_base64: bytes.toString("base64") }];
      await admit(f, { memory_draft_target: undefined, objective: "Describe the attached synthetic image.", images });
      const selected = await admit(f);
      const scripted = provider(f, { messageId: selected.request.message_id });
      let calls = 0;
      const run: AgentProvider["run"] = async (request, invoke, signal) => {
        calls += 1;
        if (calls === 1) {
          expect(request.inputParts?.filter(part => part.kind === "image")).toHaveLength(1);
          return new ScriptedAgentProvider([], { outcome: "reply", title: "Image", body: "Synthetic image received." }).run(request, invoke, signal);
        }
        expect(request.inputParts?.filter(part => part.kind === "image") ?? []).toEqual([]);
        return scripted.run(request, invoke, signal);
      };
      const remote: RemoteChatAnswerProviding & AgentProvider = { id: "deterministic", model: "synthetic-target",
        sdkVersion: "synthetic", providerId: "zhipu-chat-completions", supportsImageInput: true,
        inputCapabilities: { text: true, image: true, imageUnderstanding: false, steering: true }, run,
        answer: async () => { throw new Error("The actual Agent producer path is required"); } };
      runner = new ConversationQueueRunner({ pool: pool!, provider: remote, logger: { info() {}, warn() {}, error() {} },
        workerId: "get298-runner-proof", pollIntervalMs: 15, heartbeatMs: 100, recoveryIntervalMs: 10000 });
      runner.start();
      const deadline = Date.now() + 15000;
      let status: string | undefined;
      do {
        status = (await pool!.query("SELECT status FROM conversation_queue_entries WHERE account_id=$1 AND id=$2",
          [f.accountId, selected.response.queue_entry_id])).rows[0]?.status;
        if (["completed", "failed", "interrupted"].includes(status ?? "")) break;
        await new Promise(resolve => setTimeout(resolve, 25));
      } while (Date.now() < deadline);
      expect(status).toBe("completed");
      expect(calls).toBe(2);
      const session = await getAgentSession(pool!, f.auth, f.sessionId);
      expect(session.payload?.turns[0]).not.toHaveProperty("memoryDraftTarget");
      const turn = session.payload!.turns[1]!;
      expect(turn.memoryDraftTarget).toEqual({ person_id: f.personId });
      expect(turn.response.memoryProposal).toBeTruthy();
      const review = await openMemoryReview(pool!, f.auth, turn.response.memoryProposal!.proposal_id,
        { purpose: "chat", session_id: f.sessionId });
      expect(review.review).toMatchObject({ person_id: f.personId, source_message_id: selected.request.message_id,
        source_status: "available", visible_item_count: 1 });
      expect((await pool!.query("SELECT memory_draft_target_person_id,objective FROM conversation_queue_entries WHERE account_id=$1 AND id=$2",
        [f.accountId, selected.response.queue_entry_id])).rows[0]).toEqual({ memory_draft_target_person_id: null, objective: null });
      const legacyPayload = structuredClone(session.payload!);
      delete legacyPayload.turns[1]!.memoryDraftTarget;
      const restored = await mutateAgentSession(pool!, f.auth, f.sessionId, { expected_revision: session.revision,
        idempotency_key: randomUUID(), payload: legacyPayload });
      expect(restored.payload!.turns[1]!.memoryDraftTarget).toEqual({ person_id: f.personId });
      const counterfeit = structuredClone(restored.payload!);
      counterfeit.turns[1]!.memoryDraftTarget = { person_id: randomUUID() };
      await expect(mutateAgentSession(pool!, f.auth, f.sessionId, { expected_revision: restored.revision,
        idempotency_key: randomUUID(), payload: counterfeit })).rejects.toMatchObject({ statusCode: 409 });
      await pool!.query("INSERT INTO agent_session_retracted_tasks(account_id,task_id) VALUES($1,$2)", [f.accountId, turn.response.taskID]);
      const retracted = await getAgentSession(pool!, f.auth, f.sessionId);
      expect(retracted.payload!.turns[1]).not.toHaveProperty("memoryDraftTarget");
      await expect(mutateAgentSession(pool!, f.auth, f.sessionId, { expected_revision: retracted.revision,
        idempotency_key: randomUUID(), payload: restored.payload! })).rejects.toMatchObject({ statusCode: 409 });
    } finally { await runner?.close(); await removeFixture(f); }
  }, 25000);
});
