import { randomUUID, createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import rateLimit from "@fastify/rate-limit";
import { Pool } from "pg";
import Fastify from "fastify";
import {
  CONTRACT_VERSION,
  type AgentSessionPayload,
} from "@talent-signal/contracts";
import {
  cleanupExpiredAgentSessionListSnapshots,
  getAgentSession,
  listAgentSessions,
  mutateAgentSession,
  readAgentSessionConversation,
  sweepAgentSessions,
} from "./agentSessions.js";
import { registerAgentSessionRoutes } from "./agentSessionRoutes.js";
import type { AuthContext } from "./auth.js";
import { ApiError } from "../lib/apiError.js";
import { createUnscopedChatTask } from "./unscopedChat.js";
import { createChatTask, getChatTaskReadback } from "./chat.js";
import { compileRelationshipWiki } from "./wiki.js";
import type {
  RemoteChatAnswerProviding,
  RemoteChatAnswerRequest,
} from "./chatAnswerProvider.js";
import {
  createScreenshotContactTask,
  loadScreenshotContactTask,
} from "./screenshotContactTasks.js";

const database = process.env.AGENT_SESSION_TEST_DATABASE_URL;
const pool = database ? new Pool({ connectionString: database }) : null;
const auth: AuthContext = {
  accountId: randomUUID(),
  accountSlug: `session-proof-${randomUUID()}`,
  userId: randomUUID(),
  userEmail: "session@example.test",
  userKind: "simulated_human",
  sessionId: randomUUID(),
};
const otherUser = { ...auth, userId: randomUUID() };
const otherAccount = {
  ...auth,
  accountId: randomUUID(),
  userId: randomUUID(),
  accountSlug: `other-${randomUUID()}`,
};
const now = () => new Date().toISOString();
function block(body = "Choose option one or option two.") {
  return {
    id: randomUUID(),
    kind: "answer",
    title: "Options",
    body,
    status: "informational",
    citation_dependency_ids: [],
    requires_user_decision: false as const,
    allows_static_share: true,
  };
}
function payload(): AgentSessionPayload {
  return {
    id: randomUUID(),
    scopeKind: "unresolved_intent",
    personDisplayLabel: "New session",
    contextDisplayLabel: "Conversation",
    title: "Synthetic conversation",
    updatedAt: now(),
    isUnread: false,
    turns: [
      {
        id: randomUUID(),
        objective: "Give me two options",
        createdAt: now(),
        response: {
          contractVersion: CONTRACT_VERSION,
          taskID: randomUUID(),
          contextManifestID: "none-unbound-conversation",
          knowledgeSnapshotID: "none-unbound-conversation",
          disposition: "answered",
          createdAt: now(),
          savedBlocks: [block()],
        },
      },
    ],
  };
}
function mutation(
  value: AgentSessionPayload,
  revision = 0,
  key: string = randomUUID(),
) {
  return { expected_revision: revision, idempotency_key: key, payload: value };
}
async function create(value = payload()) {
  return mutateAgentSession(pool!, auth, value.id, mutation(value));
}
async function fixture() {
  const person = randomUUID(),
    context = randomUUID(),
    snapshot = randomUUID(),
    manifest = randomUUID(),
    task = randomUUID(),
    capture = randomUUID(),
    resource = randomUUID(),
    fragment = randomUUID();
  await pool!.query(
    "INSERT INTO subjects(id,account_id,external_ref,display_label) VALUES($1::uuid,$2,$1::text,'Synthetic Person')",
    [person, auth.accountId],
  );
  await pool!.query(
    "INSERT INTO assignments(id,account_id,subject_id,external_ref,display_label) VALUES($1::uuid,$2,$3,$1::text,'Synthetic Context')",
    [context, auth.accountId, person],
  );
  await pool!.query(
    `INSERT INTO captures(id,account_id,created_by_user_id,subject_id,assignment_id,source_kind,source_metadata,identity_status,identity_context,purpose)
    VALUES($1,$2,$3,$4,$5,'conversation_transcript','{}','bound','{}','Synthetic Session proof')`,
    [capture, auth.accountId, auth.userId, person, context],
  );
  await pool!.query(
    `INSERT INTO source_resources(id,account_id,capture_id,created_by_user_id,client_resource_id,resource_kind,input_channel,display_name,media_type,observed_at,retention_scope,processing_state)
    VALUES($1::uuid,$2,$3,$4,$1::text,'conversation_transcript','chat','Synthetic source','text/plain',now(),'reviewed_selected_text','ready')`,
    [resource, auth.accountId, capture, auth.userId],
  );
  await pool!.query(
    `INSERT INTO source_retention_receipts(receipt_id,account_id,capture_id,policy_version,requested_mode,effective_mode,source_scope,source_access_state,source_access_reason,created_at,updated_at)
    VALUES($1,$2,$3,'source-retention.v2','ephemeral','ephemeral','reviewed_selected_text','available','awaiting_review_completion',now(),now())`,
    [randomUUID(), auth.accountId, capture],
  );
  await pool!.query(
    `INSERT INTO evidence_fragments(id,account_id,capture_id,resource_id,fragment_kind,sequence,text_content,content_hash,locator,attributed_actor,attribution_status,parser_name,parser_version,review_status)
    VALUES($1,$2,$3,$4,'message',0,'Synthetic source text','synthetic','{}','recruiter','confirmed','fixture','1','reviewed')`,
    [fragment, auth.accountId, capture, resource],
  );
  await pool!.query(
    `INSERT INTO knowledge_snapshots(id,account_id,subject_id,assignment_id,source_state_cursor,compiler_name,compiler_version,policy_version,status,quality,compiled_at)
    VALUES($1,$2,$3,$4,0,'fixture','1','fixture','published','{}',now())`,
    [snapshot, auth.accountId, person, context],
  );
  await pool!.query(
    `INSERT INTO context_manifests(id,account_id,task_id,subject_id,assignment_id,knowledge_snapshot_id,objective,authorization_scope,policy_version)
    VALUES($1,$2,$3,$4,$5,$6,'Synthetic options','relationship','fixture')`,
    [manifest, auth.accountId, task, person, context, snapshot],
  );
  await pool!.query(
    "INSERT INTO context_manifest_evidence(account_id,manifest_id,evidence_fragment_id,inclusion_reason) VALUES($1,$2,$3,'Synthetic proof')",
    [auth.accountId, manifest, fragment],
  );
  const value = payload();
  value.scopeKind = "relationship";
  value.personID = person;
  value.relationshipContextID = context;
  Object.assign(value.turns[0]!.response, {
    taskID: task,
    contextManifestID: manifest,
    knowledgeSnapshotID: snapshot,
  });
  return {
    value,
    person,
    context,
    snapshot,
    manifest,
    task,
    capture,
    resource,
    fragment,
  };
}
async function canonicalAnswer(task: string, body: string, scoped = false) {
  await pool!.query(
    `INSERT INTO idempotency_records(id,account_id,actor_user_id,operation_scope,idempotency_key,request_hash,status,response_status,response_body,completed_at)
    VALUES($1::uuid,$2,$3,$4,$1::text,'synthetic','completed',201,$5::jsonb,now())`,
    [
      randomUUID(),
      auth.accountId,
      auth.userId,
      scoped ? "create_chat_task" : "create_unscoped_chat_task",
      JSON.stringify({
        task_id: task,
        blocks: [
          {
            ...block(body),
            citation_dependency_ids: scoped ? [randomUUID()] : [],
          },
        ],
      }),
    ],
  );
}

async function screenshotContextFixture(bound = false) {
  const source = bound ? await fixture() : null;
  if (source)
    await pool!.query(
      "UPDATE captures SET retention_until=now()+interval '30 days' WHERE id=$1",
      [source.capture],
    );
  const task = randomUUID();
  const value = source?.value ?? payload();
  value.screenshotTaskIDs = [task];
  Object.assign(value.turns[0]!.response, {
    taskID: task,
    contextManifestID: "none-screenshot",
    knowledgeSnapshotID: "none-screenshot",
    disposition: "screenshot_processing",
    savedBlocks: [block("Injected client summary must never enter the model")],
  });
  await pool!.query(
    `INSERT INTO screenshot_contact_tasks(id,account_id,created_by_user_id,idempotency_key,request_hash,input_manifest,state,status,capture_id,subject_id,assignment_id,source_resource_id)
    VALUES($1::uuid,$2,$3,$1::text,$4,'{}',$5::jsonb,'completed',$6,$7,$8,$9)`,
    [
      task,
      auth.accountId,
      auth.userId,
      "a".repeat(64),
      JSON.stringify({
        response: {
          summary:
            "The screenshot proposes reviewing a draft on Friday; its date and time zone remain unknown.",
          findings: [
            {
              text: "Friday needs a precise date before planning.",
              message_refs: ["original-message-1"],
              source_excerpt: "PRIVATE OCR EXCERPT",
            },
          ],
          extraction: {
            messages: [
              {
                message_id: "original-message-1",
                text: "PRIVATE FULL OCR BODY",
              },
            ],
          },
          limitations: [
            "Unreviewed screenshot interpretation; no action taken.",
          ],
        },
      }),
      source?.capture ?? null,
      source?.person ?? null,
      source?.context ?? null,
      source?.resource ?? null,
    ],
  );
  return { value, task, source };
}
function contextProvider(
  observe?: (request: RemoteChatAnswerRequest) => void,
  sessionTitle?: string,
): RemoteChatAnswerProviding {
  return {
    providerId: "zhipu-chat-completions",
    model: "synthetic-model",
    supportsImageInput: false,
    answer: async (request) => {
      observe?.(request);
      return {
        kind: "answer",
        title: "Friday",
        body: "Synthetic derived Friday reply: clarify the date before making a plan.",
        citation_ids: request.allowed_citation_ids.slice(0, 1),
        ...(sessionTitle ? { session_title: sessionTitle } : {}),
        provider_id: "zhipu-chat-completions",
        model: "synthetic-model",
        provider_request_id: null,
        input_tokens: 1,
        output_tokens: 1,
      };
    },
  };
}

beforeAll(async () => {
  if (!pool) return;
  for (const user of [auth, otherAccount])
    await pool.query(
      "INSERT INTO accounts(id,slug,name) VALUES($1,$2,'Synthetic Session proof')",
      [user.accountId, user.accountSlug],
    );
  for (const user of [auth, otherUser, otherAccount])
    await pool.query(
      "INSERT INTO users(id,account_id,email,display_name,kind) VALUES($1,$2,$3,'Synthetic user','simulated_human')",
      [user.userId, user.accountId, `${user.userId}@example.test`],
    );
});
afterAll(async () => {
  await pool?.end();
});

describe.skipIf(!pool)("Agent Session PostgreSQL authority", () => {
  it("commits sensitive scrubbing and mutations while isolated snapshot cleanup is blocked", async () => {
    const expired = await create();
    await pool!.query(
      "UPDATE agent_sessions SET expires_at=now()-interval '1 minute' WHERE account_id=$1 AND id=$2",
      [auth.accountId, expired.session_id],
    );
    const blocker = await pool!.connect();
    const cleanupPool = new Pool({ connectionString: database!, max: 1 });
    try {
      await blocker.query("BEGIN");
      await blocker.query(
        "LOCK TABLE agent_session_list_snapshots IN ACCESS EXCLUSIVE MODE",
      );
      await cleanupPool.query("SET lock_timeout='75ms'");
      await expect(
        cleanupExpiredAgentSessionListSnapshots(cleanupPool),
      ).rejects.toMatchObject({ code: "55P03" });

      const current = payload();
      const saved = await mutateAgentSession(
        pool!,
        auth,
        current.id,
        mutation(current),
      );
      expect(saved.revision).toBe(1);
      const scrubbed = (
        await pool!.query<{
          deleted_at: Date | null;
          payload: AgentSessionPayload | null;
        }>(
          "SELECT deleted_at,payload FROM agent_sessions WHERE account_id=$1 AND id=$2",
          [auth.accountId, expired.session_id],
        )
      ).rows[0];
      expect(scrubbed?.deleted_at).toBeInstanceOf(Date);
      expect(scrubbed?.payload).toBeNull();
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
      await cleanupPool.end();
    }
  });

  it("preserves stable turn identity and displays a second-device read as unconfirmed", async () => {
    const value = payload(),
      request = mutation(value),
      first = await mutateAgentSession(pool!, auth, value.id, request);
    expect(first.revision).toBe(1);
    expect(first.payload).toEqual(value);
    expect(first.display_authority).toBe("stale_unconfirmed");
    expect(
      await getAgentSession(
        pool!,
        { ...auth, sessionId: randomUUID() },
        value.id,
      ),
    ).toEqual(first);
    expect(await mutateAgentSession(pool!, auth, value.id, request)).toEqual(
      first,
    );
    await expect(
      mutateAgentSession(pool!, auth, value.id, {
        ...request,
        payload: { ...value, title: "Changed intent" },
      }),
    ).rejects.toMatchObject({ code: "AGENT_SESSION_IDEMPOTENCY_CONFLICT" });
  });
  it("accepts equivalent creation timestamps while retaining canonical strings and immutable messages", async () => {
    const value = payload();
    const original = new Date().toISOString().replace(/Z$/, "281Z");
    const native = new Date(original).toISOString();
    value.createdAt = original;
    value.turns[0]!.createdAt = original;
    const second = structuredClone(value.turns[0]!);
    second.id = randomUUID();
    second.objective = "Second retained message";
    second.response.taskID = randomUUID();
    value.turns.push(second);
    const first = await create(value);
    const equivalent = structuredClone(value);
    equivalent.createdAt = native;
    equivalent.turns.forEach(turn => { turn.createdAt = native; });
    equivalent.composerDraft = "Draft from another client";
    const saved = await mutateAgentSession(pool!, auth, value.id, mutation(equivalent, first.revision));
    expect(saved.payload?.createdAt).toBe(original);
    expect(saved.payload?.turns.map(turn => turn.createdAt)).toEqual([original, original]);
    expect(saved.payload?.composerDraft).toBe(equivalent.composerDraft);
    for (const change of [
      (p: AgentSessionPayload) => { p.createdAt = new Date(Date.parse(original) + 1).toISOString(); },
      (p: AgentSessionPayload) => { p.turns[0]!.createdAt = new Date(Date.parse(original) + 1).toISOString(); },
      (p: AgentSessionPayload) => { p.turns[0]!.id = randomUUID(); },
      (p: AgentSessionPayload) => { p.turns.reverse(); },
      (p: AgentSessionPayload) => { p.turns[0]!.objective = "Changed message"; },
      (p: AgentSessionPayload) => { p.turns[0]!.response.taskID = randomUUID(); },
      (p: AgentSessionPayload) => { p.turns[0]!.response.contextManifestID = randomUUID(); },
    ]) {
      const changed = structuredClone(saved.payload!);
      change(changed);
      await expect(mutateAgentSession(pool!, auth, value.id, mutation(changed, saved.revision)))
        .rejects.toMatchObject({ code: "AGENT_SESSION_INVALID" });
    }
    const readback = await getAgentSession(pool!, auth, value.id);
    expect(readback.revision).toBe(saved.revision);
    expect(readback.payload).toEqual(saved.payload);
  });
  it("isolates another account and another user on reads and writes", async () => {
    const first = await create();
    for (const actor of [otherUser, otherAccount]) {
      await expect(
        getAgentSession(pool!, actor, first.session_id),
      ).rejects.toMatchObject({ code: "AGENT_SESSION_NOT_FOUND" });
      expect((await listAgentSessions(pool!, actor)).sessions).toEqual([]);
    }
    await expect(
      mutateAgentSession(
        pool!,
        otherUser,
        first.session_id,
        mutation(first.payload!, 1),
      ),
    ).rejects.toMatchObject({ code: "AGENT_SESSION_NOT_FOUND" });
  });
  it("fences simultaneous CAS writers without dropping the winning turn", async () => {
    const first = await create();
    const a = structuredClone(first.payload!),
      b = structuredClone(first.payload!);
    a.title = "Device A";
    b.title = "Device B";
    const outcomes = await Promise.allSettled([
      mutateAgentSession(pool!, auth, a.id, mutation(a, 1)),
      mutateAgentSession(pool!, auth, b.id, mutation(b, 1)),
    ]);
    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    const failure = outcomes.find(
      (o) => o.status === "rejected",
    ) as PromiseRejectedResult;
    expect(failure.reason).toMatchObject({
      code: "AGENT_SESSION_REVISION_CONFLICT",
      details: { session: { revision: 2 } },
    });
    expect(
      (await getAgentSession(pool!, auth, a.id)).payload!.turns[0]!.id,
    ).toBe(a.turns[0]!.id);
  });
  it("allows feedback updates but rejects lost or rewritten history and altered fork provenance", async () => {
    const first = await create();
    const value = structuredClone(first.payload!);
    value.turns[0]!.feedback = "helpful";
    value.turns[0]!.feedbackUpdatedAt = now();
    const updated = await mutateAgentSession(
      pool!,
      auth,
      value.id,
      mutation(value, 1),
    );
    expect(updated.payload!.turns[0]!.feedback).toBe("helpful");
    await expect(
      mutateAgentSession(
        pool!,
        auth,
        value.id,
        mutation({ ...value, turns: [] }, 2),
      ),
    ).rejects.toMatchObject({ code: "AGENT_SESSION_INVALID" });
    const rewritten = structuredClone(value);
    rewritten.turns[0]!.objective = "Rewritten";
    await expect(
      mutateAgentSession(pool!, auth, value.id, mutation(rewritten, 2)),
    ).rejects.toMatchObject({ code: "AGENT_SESSION_INVALID" });
    const fork = {
      ...value,
      id: randomUUID(),
      originSessionID: value.id,
      originTurnID: value.turns[0]!.id,
    };
    const savedFork = await create(fork);
    expect(savedFork.payload!.originSessionID).toBe(value.id);
    await expect(
      mutateAgentSession(
        pool!,
        auth,
        fork.id,
        mutation({ ...fork, originTurnID: randomUUID() }, 1),
      ),
    ).rejects.toMatchObject({ code: "AGENT_SESSION_INVALID" });
  });
  it("keeps deletion tombstones, erases content, and prevents stale retries resurrecting a Session", async () => {
    const value = payload(),
      request = mutation(value);
    await mutateAgentSession(pool!, auth, value.id, request);
    const deletion = { expected_revision: 1, idempotency_key: randomUUID() };
    const removed = await mutateAgentSession(
      pool!,
      auth,
      value.id,
      deletion,
      true,
    );
    expect(removed.payload).toBeNull();
    expect(removed.revision).toBe(2);
    expect(removed.deleted_at).not.toBeNull();
    expect(
      await mutateAgentSession(pool!, auth, value.id, deletion, true),
    ).toEqual(removed);
    expect(await mutateAgentSession(pool!, auth, value.id, request)).toEqual(
      removed,
    );
    await expect(
      mutateAgentSession(pool!, auth, value.id, mutation(value, 2)),
    ).rejects.toMatchObject({ code: "AGENT_SESSION_DELETED" });
    expect(
      (
        await pool!.query("SELECT payload FROM agent_sessions WHERE id=$1", [
          value.id,
        ])
      ).rows[0].payload,
    ).toBeNull();
    const receipts = (
      await pool!.query(
        "SELECT * FROM agent_session_operations WHERE session_id=$1",
        [value.id],
      )
    ).rows;
    expect(JSON.stringify(receipts)).not.toContain(value.turns[0]!.objective);
    const neverUploaded = randomUUID();
    const tombstone = await mutateAgentSession(
      pool!,
      auth,
      neverUploaded,
      { expected_revision: 0, idempotency_key: randomUUID() },
      true,
    );
    await expect(
      create({ ...payload(), id: neverUploaded }),
    ).rejects.toMatchObject({ code: "AGENT_SESSION_DELETED" });
    expect(tombstone.payload).toBeNull();
  });
  it("expires at the original retention clock, scrubs physically, and cannot extend with a newer client date", async () => {
    const first = await create();
    await pool!.query(
      "UPDATE agent_sessions SET created_at=now()-interval '31 days',expires_at=now()-interval '1 day' WHERE id=$1",
      [first.session_id],
    );
    const expired = await getAgentSession(pool!, auth, first.session_id);
    expect(expired.payload).toBeNull();
    expect(expired.revision).toBe(2);
    await expect(
      create({ ...payload(), id: first.session_id }),
    ).rejects.toMatchObject({ code: "AGENT_SESSION_DELETED" });
    const old = payload();
    old.turns[0]!.createdAt = new Date(
      Date.now() - 31 * 86400000,
    ).toISOString();
    await expect(create(old)).rejects.toMatchObject({
      code: "AGENT_SESSION_EXPIRED",
    });
  });
  it("validates proposal source and expires seven-day drafts while retaining the conversation", async () => {
    const value = payload();
    value.contactProposal = {
      draft: {
        name: "Synthetic",
        relationshipContext: "",
        sourceNote: "Synthetic source",
      },
      idempotencyKey: randomUUID(),
      updatedAt: now(),
      sessionID: value.id,
      sourceMessageID: value.turns[0]!.id,
      sourceText: "Synthetic source",
      fieldEvidence: [{ field: "name", exactExcerpt: "Invented" }],
      status: "proposed",
    };
    await expect(create(value)).rejects.toMatchObject({
      code: "AGENT_SESSION_INVALID",
    });
    value.contactProposal.fieldEvidence = [
      { field: "name", exactExcerpt: "Synthetic" },
    ];
    value.contactProposal.updatedAt = new Date(
      Date.now() - 8 * 86400000,
    ).toISOString();
    const saved = await create(value);
    expect(saved.payload!.contactProposal).toBeUndefined();
    expect(saved.payload!.turns).toHaveLength(1);
  });
  it("redacts revoked-source saved bodies and proposal physically, increments revision, and refuses stale restoration", async () => {
    const f = await fixture();
    f.value.contactProposal = {
      draft: {
        name: "Synthetic",
        relationshipContext: "",
        sourceNote: "Synthetic source",
      },
      idempotencyKey: randomUUID(),
      updatedAt: now(),
      sessionID: f.value.id,
      sourceMessageID: f.value.turns[0]!.id,
      status: "proposed",
    };
    const first = await create(f.value);
    expect(first.payload!.turns[0]!.response.savedBlocks).toHaveLength(1);
    await pool!.query(
      "UPDATE source_retention_receipts SET authorization_state='revoked' WHERE capture_id=$1",
      [f.capture],
    );
    const physical = (
      await pool!.query(
        "SELECT payload,revision FROM agent_sessions WHERE id=$1",
        [f.value.id],
      )
    ).rows[0];
    expect(physical.revision).toBeGreaterThan(first.revision);
    expect(physical.payload.turns[0].response.savedBlocks).toBeUndefined();
    expect(physical.payload.contactProposal).toBeUndefined();
    const restoredAttempt = await mutateAgentSession(
      pool!,
      auth,
      f.value.id,
      mutation(f.value, physical.revision),
    );
    expect(
      restoredAttempt.payload!.turns[0]!.response.savedBlocks,
    ).toBeUndefined();
    const unavailableHistory = await readAgentSessionConversation(
      pool!,
      auth,
      f.value.id,
      { personId: f.person, relationshipContextId: f.context },
    );
    expect(unavailableHistory.hasRecordedTurns).toBe(true);
    expect(unavailableHistory.messages).toEqual([]);
  });
  it("keeps corrected or revoked tasks redacted after source restoration, but retains stale intact history", async () => {
    const f = await fixture();
    await create(f.value);
    await pool!.query(
      "UPDATE knowledge_snapshots SET status='superseded' WHERE id=$1",
      [f.snapshot],
    );
    expect(
      (await getAgentSession(pool!, auth, f.value.id)).payload!.turns[0]!
        .response.savedBlocks,
    ).toHaveLength(1);
    await pool!.query(
      "UPDATE evidence_fragments SET text_content='Corrected synthetic source' WHERE id=$1",
      [f.fragment],
    );
    const corrected = await getAgentSession(pool!, auth, f.value.id);
    expect(corrected.payload!.turns[0]!.response.savedBlocks).toBeUndefined();
    const reupload = await mutateAgentSession(
      pool!,
      auth,
      f.value.id,
      mutation(f.value, corrected.revision),
    );
    expect(reupload.payload!.turns[0]!.response.savedBlocks).toBeUndefined();
    const revoke = await fixture();
    await create(revoke.value);
    await pool!.query(
      "UPDATE source_retention_receipts SET authorization_state='revoked' WHERE capture_id=$1",
      [revoke.capture],
    );
    await pool!.query(
      "UPDATE source_retention_receipts SET authorization_state='authorized' WHERE capture_id=$1",
      [revoke.capture],
    );
    const read = await getAgentSession(pool!, auth, revoke.value.id);
    expect(
      (
        await mutateAgentSession(
          pool!,
          auth,
          revoke.value.id,
          mutation(revoke.value, read.revision),
        )
      ).payload!.turns[0]!.response.savedBlocks,
    ).toBeUndefined();
  });
  it("expires composer drafts independently of an otherwise current conversation", async () => {
    const value = payload();
    value.composerDraft = "Private unfinished draft";
    value.composerDraftUpdatedAt = new Date(
      Date.now() - 8 * 86400000,
    ).toISOString();
    const result = await create(value);
    expect(result.payload!.composerDraft).toBeUndefined();
    expect(result.payload!.turns).toHaveLength(1);
  });
  it("enforces source deadlines at read time even when lifecycle workers have not run", async () => {
    const f = await fixture();
    const first = await create(f.value);
    await pool!.query(
      "UPDATE source_retention_receipts SET authorization_expires_at=now()+interval '50 milliseconds' WHERE capture_id=$1",
      [f.capture],
    );
    await pool!.query("SELECT pg_sleep(0.06)");
    const expired = await getAgentSession(pool!, auth, f.value.id);
    expect(expired.revision).toBeGreaterThan(first.revision);
    expect(expired.payload!.turns[0]!.response.savedBlocks).toBeUndefined();
  });
  it("uses bounded canonical assistant text, preserves scoped options, and never trusts saved display as model history", async () => {
    const value = payload();
    value.turns[0]!.response.savedBlocks = [block("Forged local display")];
    await canonicalAnswer(
      value.turns[0]!.response.taskID,
      "Canonical second option",
    );
    await create(value);
    const history = await readAgentSessionConversation(pool!, auth, value.id, {
      personId: null,
      relationshipContextId: null,
    });
    expect(history.messages.map((m) => m.text)).toEqual([
      value.turns[0]!.objective,
      "Canonical second option",
    ]);
    await expect(
      readAgentSessionConversation(pool!, auth, value.id, {
        personId: randomUUID(),
        relationshipContextId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "AGENT_SESSION_SCOPE_CHANGED" });
    const f = await fixture();
    await canonicalAnswer(f.task, "Two evidence-grounded options", true);
    await create(f.value);
    expect(
      (
        await readAgentSessionConversation(pool!, auth, f.value.id, {
          personId: f.person,
          relationshipContextId: f.context,
        })
      ).messages.at(-1)!.text,
    ).toBe("Two evidence-grounded options");
  });
  it("names only the first scoped reply and preserves per-reply block titles", async () => {
    const f = await fixture();
    await compileRelationshipWiki(pool!, auth, f.person, f.context, {
      idempotency_key: randomUUID(),
      objective: "Prepare reviewed context",
    });
    const value: AgentSessionPayload = { ...f.value, turns: [] };
    const session = await create(value);
    const firstRequest = {
      objective: "Explain the reviewed source",
      person_id: f.person,
      relationship_context_id: f.context,
      session_id: value.id,
      idempotency_key: randomUUID(),
    };
    let firstObserved!: RemoteChatAnswerRequest;
    const first = await createChatTask(
      pool!,
      auth,
      firstRequest,
      contextProvider(
        (request) => {
          firstObserved = request;
        },
        "Reviewed source summary",
      ),
    );
    expect(firstObserved.session_title_requested).toBe(true);
    expect(first.body.session_title).toBe("Reviewed source summary");
    expect(first.body.blocks.find((item) => item.kind === "answer")?.title).toBe(
      "Friday",
    );

    const firstTurn: AgentSessionPayload["turns"][number] = {
      id: randomUUID(),
      objective: firstRequest.objective,
      createdAt: first.body.created_at,
      response: {
        contractVersion: first.body.contract_version,
        taskID: first.body.task_id,
        contextManifestID: first.body.context_manifest_id,
        knowledgeSnapshotID: first.body.knowledge_snapshot_id,
        disposition: first.body.disposition,
        createdAt: first.body.created_at,
      },
    };
    await mutateAgentSession(
      pool!,
      auth,
      value.id,
      mutation({ ...value, turns: [firstTurn] }, session.revision),
    );
    expect(
      (
        await readAgentSessionConversation(pool!, auth, value.id, {
          personId: f.person,
          relationshipContextId: f.context,
        })
      ).hasRecordedTurns,
    ).toBe(true);

    let laterObserved!: RemoteChatAnswerRequest;
    const later = await createChatTask(
      pool!,
      auth,
      {
        ...firstRequest,
        objective: "What should I do next?",
        idempotency_key: randomUUID(),
      },
      contextProvider(
        (request) => {
          laterObserved = request;
        },
        "Incorrect later rename",
      ),
    );
    expect(laterObserved.session_title_requested).toBe(false);
    expect(later.body.session_title).toBeUndefined();
    expect(later.body.blocks.find((item) => item.kind === "answer")?.title).toBe(
      "Friday",
    );
  });
  it("rejects client sentinel scope forgery and withholds legacy forged canonical history", async () => {
    const f = await fixture();
    await canonicalAnswer(f.task, "Private scoped canonical answer", true);
    const forged = payload();
    forged.turns[0]!.response.taskID = f.task;
    await expect(create(forged)).rejects.toMatchObject({
      code: "AGENT_SESSION_NOT_FOUND",
    });
    const legacy = await create();
    const altered = structuredClone(legacy.payload!);
    altered.turns[0]!.response.taskID = f.task;
    await pool!.query(
      "UPDATE agent_sessions SET payload=$2::jsonb WHERE id=$1",
      [legacy.session_id, JSON.stringify(altered)],
    );
    expect(
      (
        await readAgentSessionConversation(pool!, auth, legacy.session_id, {
          personId: null,
          relationshipContextId: null,
        })
      ).messages,
    ).toEqual([]);
    await pool!.query(
      "UPDATE source_retention_receipts SET authorization_state='revoked' WHERE capture_id=$1",
      [f.capture],
    );
    expect(
      (
        await readAgentSessionConversation(pool!, auth, legacy.session_id, {
          personId: null,
          relationshipContextId: null,
        })
      ).messages,
    ).toEqual([]);
    const lostManifest = payload();
    await canonicalAnswer(
      lostManifest.turns[0]!.response.taskID,
      "Missing manifest answer",
      true,
    );
    await expect(create(lostManifest)).rejects.toMatchObject({
      code: "AGENT_SESSION_NOT_FOUND",
    });
  });
  it("physically removes source-linked proposals without saved blocks and fences re-upload", async () => {
    const f = await fixture();
    delete f.value.turns[0]!.response.savedBlocks;
    f.value.contactProposal = {
      draft: {
        name: "Synthetic",
        relationshipContext: "",
        sourceNote: "Sensitive synthetic source note",
      },
      idempotencyKey: randomUUID(),
      updatedAt: now(),
      sessionID: f.value.id,
      sourceMessageID: f.value.turns[0]!.id,
      sourceText: "Sensitive synthetic source note",
    };
    const first = await create(f.value);
    await pool!.query(
      "UPDATE source_retention_receipts SET authorization_state='revoked' WHERE capture_id=$1",
      [f.capture],
    );
    const physical = (
      await pool!.query(
        "SELECT payload,revision FROM agent_sessions WHERE id=$1",
        [f.value.id],
      )
    ).rows[0];
    expect(physical.revision).toBeGreaterThan(first.revision);
    expect(physical.payload.contactProposal).toBeUndefined();
    expect(JSON.stringify(physical.payload)).not.toContain(
      "Sensitive synthetic source note",
    );
    expect(
      (
        await mutateAgentSession(
          pool!,
          auth,
          f.value.id,
          mutation(f.value, physical.revision),
        )
      ).payload!.contactProposal,
    ).toBeUndefined();
  });
  it("bounds composer clocks at admission and prevents unchanged offline content extending or restoring retention", async () => {
    const futureDraft = {
      ...payload(),
      composerDraft: "Synthetic draft",
      composerDraftUpdatedAt: "2099-01-01T00:00:00.000Z",
    };
    await expect(create(futureDraft)).rejects.toMatchObject({
      code: "AGENT_SESSION_INVALID",
    });
    const originalTime = new Date(Date.now() - 6 * 86400000).toISOString();
    const value = {
      ...payload(),
      composerDraft: "Synthetic unchanged draft",
      composerDraftUpdatedAt: originalTime,
    };
    const first = await create(value);
    const renewed = await mutateAgentSession(
      pool!,
      auth,
      value.id,
      mutation({ ...value, composerDraftUpdatedAt: now() }, first.revision),
    );
    expect(Date.parse(renewed.payload!.composerDraftUpdatedAt!)).toBe(
      Date.parse(originalTime),
    );
    const expiredTime = new Date(Date.now() - 8 * 86400000).toISOString();
    await pool!.query(
      "UPDATE agent_sessions SET composer_draft_started_at=$2 WHERE id=$1",
      [value.id, expiredTime],
    );
    await pool!.query(
      "UPDATE agent_sessions SET payload=jsonb_set(payload,'{composerDraftUpdatedAt}',to_jsonb($2::text)) WHERE id=$1",
      [value.id, expiredTime],
    );
    const expired = await getAgentSession(pool!, auth, value.id);
    expect(expired.payload!.composerDraft).toBeUndefined();
    const replay = await mutateAgentSession(
      pool!,
      auth,
      value.id,
      mutation({ ...value, composerDraftUpdatedAt: now() }, expired.revision),
    );
    expect(replay.payload!.composerDraft).toBeUndefined();
    const changed = await mutateAgentSession(
      pool!,
      auth,
      value.id,
      mutation(
        {
          ...value,
          composerDraft: "A newly edited draft",
          composerDraftUpdatedAt: now(),
        },
        replay.revision,
      ),
    );
    expect(changed.payload!.composerDraft).toBe("A newly edited draft");
  });
  it("uses original Session creation time for first-upload retention and never changes it", async () => {
    const value = {
      ...payload(),
      createdAt: new Date(Date.now() - 29 * 86400000).toISOString(),
      contextWasTrimmed: true,
    };
    const saved = await create(value);
    expect(Date.parse(saved.expires_at) - Date.now()).toBeLessThanOrEqual(
      86400000,
    );
    await expect(
      mutateAgentSession(
        pool!,
        auth,
        value.id,
        mutation({ ...value, createdAt: now() }, saved.revision),
      ),
    ).rejects.toMatchObject({ code: "AGENT_SESSION_INVALID" });
    await expect(
      create({
        ...payload(),
        createdAt: new Date(Date.now() - 31 * 86400000).toISOString(),
      }),
    ).rejects.toMatchObject({ code: "AGENT_SESSION_EXPIRED" });
  });
  it("remembers a draft already expired on first upload before removing its body", async () => {
    const value = {
      ...payload(),
      composerDraft: "Initially expired synthetic draft",
      composerDraftUpdatedAt: new Date(Date.now() - 8 * 86400000).toISOString(),
    };
    const first = await create(value);
    expect(first.payload!.composerDraft).toBeUndefined();
    const metadata = (
      await pool!.query(
        "SELECT composer_draft_hash,composer_draft_started_at FROM agent_sessions WHERE id=$1",
        [value.id],
      )
    ).rows[0];
    expect(metadata.composer_draft_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(metadata.composer_draft_started_at.toISOString()).toBe(
      value.composerDraftUpdatedAt,
    );
    const retried = await mutateAgentSession(
      pool!,
      auth,
      value.id,
      mutation({ ...value, composerDraftUpdatedAt: now() }, first.revision),
    );
    expect(retried.payload!.composerDraft).toBeUndefined();
    const edited = await mutateAgentSession(
      pool!,
      auth,
      value.id,
      mutation(
        {
          ...value,
          composerDraft: "Newly edited synthetic draft",
          composerDraftUpdatedAt: now(),
        },
        retried.revision,
      ),
    );
    expect(edited.payload!.composerDraft).toBe("Newly edited synthetic draft");
  });
  it("canonicalizes declared UUID identifiers while preserving opaque task references", async () => {
    const f = await fixture();
    await canonicalAnswer(f.task, "Canonical scoped UUID answer", true);
    const upper = structuredClone(f.value);
    upper.id = upper.id.toUpperCase();
    upper.personID = upper.personID!.toUpperCase();
    upper.relationshipContextID = upper.relationshipContextID!.toUpperCase();
    upper.turns[0]!.id = upper.turns[0]!.id.toUpperCase();
    for (const key of [
      "taskID",
      "contextManifestID",
      "knowledgeSnapshotID",
    ] as const)
      upper.turns[0]!.response[key] =
        upper.turns[0]!.response[key].toUpperCase();
    const saved = await create(upper);
    expect(saved.payload!.personID).toBe(f.person);
    expect(saved.payload!.turns[0]!.response.savedBlocks).toHaveLength(1);
    const retryKey = randomUUID();
    const retryValue = payload();
    await mutateAgentSession(
      pool!,
      auth,
      retryValue.id,
      mutation(retryValue, 0, retryKey),
    );
    await expect(
      mutateAgentSession(
        pool!,
        auth,
        retryValue.id.toUpperCase(),
        mutation(
          { ...retryValue, id: retryValue.id.toUpperCase() },
          0,
          retryKey.toUpperCase(),
        ),
      ),
    ).resolves.toMatchObject({ revision: 1 });
    await expect(
      mutateAgentSession(
        pool!,
        auth,
        f.value.id,
        mutation(f.value, saved.revision),
      ),
    ).resolves.toMatchObject({ revision: 2 });
    const history = await readAgentSessionConversation(pool!, auth, upper.id, {
      personId: upper.personID!,
      relationshipContextId: upper.relationshipContextID!,
    });
    expect(
      history.messages.some(
        (message) => message.text === "Canonical scoped UUID answer",
      ),
    ).toBe(true);
    const fork = {
      ...payload(),
      originSessionID: upper.id,
      originTurnID: upper.turns[0]!.id,
    };
    expect((await create(fork)).payload!.originSessionID).toBe(f.value.id);
    const opaque = payload();
    opaque.turns[0]!.response.taskID = "Local-Mixed-Case-Task";
    opaque.turns[0]!.response.contextManifestID = "None-Local-Manifest";
    expect((await create(opaque)).payload!.turns[0]!.response.taskID).toBe(
      "Local-Mixed-Case-Task",
    );
    await pool!.query(
      "UPDATE source_retention_receipts SET authorization_state='revoked' WHERE capture_id=$1",
      [f.capture],
    );
    expect(
      (await getAgentSession(pool!, auth, upper.id)).payload!.turns[0]!.response
        .savedBlocks,
    ).toBeUndefined();
  });
  it("admits bounded local forks without granting unknown lineage scope or restoring deleted origins", async () => {
    const unknown = {
      ...payload(),
      originKind: "local" as const,
      originSessionID: randomUUID(),
      originTurnID: randomUUID(),
      contextWasTrimmed: true,
    };
    const saved = await create(unknown);
    expect(saved.payload!.originSessionID).toBe(unknown.originSessionID);
    const { originKind: _kind, ...canonical } = unknown;
    await expect(
      create({ ...canonical, id: randomUUID() }),
    ).rejects.toMatchObject({ code: "AGENT_SESSION_NOT_FOUND" });
    await expect(
      mutateAgentSession(
        pool!,
        auth,
        unknown.id,
        mutation(canonical, saved.revision),
      ),
    ).rejects.toMatchObject({ code: "AGENT_SESSION_INVALID" });
    const original = await create();
    const unsyncedTurn = {
      ...payload(),
      originKind: "local" as const,
      originSessionID: original.session_id,
      originTurnID: randomUUID(),
    };
    await expect(create(unsyncedTurn)).resolves.toMatchObject({ revision: 1 });
    await mutateAgentSession(
      pool!,
      auth,
      original.session_id,
      { expected_revision: original.revision, idempotency_key: randomUUID() },
      true,
    );
    await expect(
      create({ ...unsyncedTurn, id: randomUUID() }),
    ).rejects.toMatchObject({ code: "AGENT_SESSION_NOT_FOUND" });
    const foreign = payload();
    await mutateAgentSession(
      pool!,
      otherAccount,
      foreign.id,
      mutation(foreign),
    );
    await expect(
      create({ ...unknown, id: randomUUID(), originSessionID: foreign.id }),
    ).rejects.toMatchObject({ code: "AGENT_SESSION_NOT_FOUND" });
    const f = await fixture();
    const forged = { ...unknown, id: randomUUID(), turns: f.value.turns };
    await expect(create(forged)).rejects.toMatchObject({
      code: "AGENT_SESSION_NOT_FOUND",
    });
  });
  it("rejects PostgreSQL jsonb expansion with a controlled 400 and no stored content or receipt", async () => {
    const value = payload();
    value.turns = [];
    for (let i = 0; i < 200; i++) {
      const turn = payload().turns[0]!;
      turn.response.savedBlocks = Array.from({ length: 6 }, () => block(""));
      value.turns.push(turn);
    }
    while (Buffer.byteLength(JSON.stringify(mutation(value))) > 240 * 1024) {
      const last = value.turns.at(-1)!;
      if (last.response.savedBlocks!.length) last.response.savedBlocks!.pop();
      else value.turns.pop();
    }
    const request = mutation(value);
    expect(Buffer.byteLength(JSON.stringify(request))).toBeLessThanOrEqual(
      240 * 1024,
    );
    expect(
      (
        await pool!.query("SELECT octet_length($1::jsonb::text) AS bytes", [
          JSON.stringify(value),
        ])
      ).rows[0].bytes,
    ).toBeGreaterThan(262144);
    await expect(
      mutateAgentSession(pool!, auth, value.id, request),
    ).rejects.toMatchObject({ statusCode: 400, code: "AGENT_SESSION_INVALID" });
    expect(
      (
        await pool!.query(
          "SELECT count(*)::int AS count FROM agent_sessions WHERE id=$1",
          [value.id],
        )
      ).rows[0].count,
    ).toBe(0);
    expect(
      (
        await pool!.query(
          "SELECT count(*)::int AS count FROM agent_session_operations WHERE idempotency_key=$1",
          [request.idempotency_key],
        )
      ).rows[0].count,
    ).toBe(0);
  });
  it("performs final CAS against a concurrent canonical update after validation", async () => {
    const first = await create();
    let reached!: () => void;
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const proceed = new Promise<void>((resolve) => {
      release = resolve;
    });
    const intercepted = {
      connect: async () => {
        const client = await pool!.connect();
        return {
          release: () => client.release(),
          query: async (sql: string, values?: unknown[]) => {
            if (sql.includes("INSERT INTO agent_sessions")) {
              reached();
              await proceed;
            }
            return client.query(sql, values);
          },
        };
      },
    } as unknown as Pool;
    const writing = mutateAgentSession(
      intercepted,
      auth,
      first.session_id,
      mutation(
        { ...first.payload!, title: "Concurrent device title" },
        first.revision,
      ),
    );
    await ready;
    await pool!.query(
      "UPDATE agent_sessions SET revision=revision+1,payload=jsonb_set(payload,'{title}','\"Canonical winner\"'::jsonb) WHERE id=$1",
      [first.session_id],
    );
    release();
    await expect(writing).rejects.toMatchObject({
      code: "AGENT_SESSION_REVISION_CONFLICT",
    });
    const actual = await getAgentSession(pool!, auth, first.session_id);
    expect(actual.revision).toBe(2);
    expect(actual.payload!.title).toBe("Canonical winner");
  });
  it("fences real concurrent source revocation through both first insert and later Session update", async () => {
    for (const initial of [true, false]) {
      const f = await fixture();
      const existing = initial ? null : await create(f.value);
      let reached!: () => void;
      let release!: () => void;
      const ready = new Promise<void>((resolve) => {
        reached = resolve;
      });
      const proceed = new Promise<void>((resolve) => {
        release = resolve;
      });
      const intercepted = {
        connect: async () => {
          const client = await pool!.connect();
          return {
            release: () => client.release(),
            query: async (sql: string, values?: unknown[]) => {
              if (sql.includes("INSERT INTO agent_sessions")) {
                reached();
                await proceed;
              }
              return client.query(sql, values);
            },
          };
        },
      } as unknown as Pool;
      const writing = mutateAgentSession(
        intercepted,
        auth,
        f.value.id,
        mutation(f.value, existing?.revision ?? 0),
      );
      await ready;
      const source = await pool!.connect();
      await source.query("BEGIN");
      const pid = (await source.query("SELECT pg_backend_pid() AS pid")).rows[0]
        .pid;
      const revoking = source.query(
        "UPDATE source_retention_receipts SET authorization_state='revoked' WHERE capture_id=$1",
        [f.capture],
      );
      try {
        let blocked = false;
        for (let i = 0; i < 30; i++) {
          blocked = (
            await pool!.query(
              "SELECT cardinality(pg_blocking_pids($1))>0 AS blocked",
              [pid],
            )
          ).rows[0].blocked;
          if (blocked) break;
          await pool!.query("SELECT pg_sleep(0.005)");
        }
        expect(blocked).toBe(true);
        release();
        await writing;
        await revoking;
        await source.query("COMMIT");
      } finally {
        release();
        await source.query("ROLLBACK");
        source.release();
      }
      const final = await getAgentSession(pool!, auth, f.value.id);
      expect(final.payload!.turns[0]!.response.savedBlocks).toBeUndefined();
      expect(final.revision).toBeGreaterThan(existing?.revision ?? 0);
    }
  });
  it("releases reverse-ordered screenshot locks so source revocation commits without a deadlock victim", async () => {
    const f = await fixture();
    const task = randomUUID();
    await pool!.query(
      `INSERT INTO screenshot_contact_tasks(id,account_id,created_by_user_id,idempotency_key,request_hash,input_manifest,state,status,capture_id)
      VALUES($1::uuid,$2,$3,$1::text,$4,'{}','{}','running',$5)`,
      [task, auth.accountId, auth.userId, "a".repeat(64), f.capture],
    );
    const value = payload();
    value.screenshotTaskIDs = [task];
    value.turns[0]!.response.taskID = task;
    value.turns[0]!.response.disposition = "screenshot_processing";
    let reached!: () => void, release!: () => void;
    const ready = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const proceed = new Promise<void>((resolve) => {
      release = resolve;
    });
    let interceptedOnce = false;
    let attempts = 0;
    const intercepted = {
      connect: async () => {
        attempts++;
        const client = await pool!.connect();
        return {
          release: () => client.release(),
          query: async (sql: string, values?: unknown[]) => {
            if (
              !interceptedOnce &&
              sql.includes("SELECT c.id FROM screenshot_contact_tasks t")
            ) {
              interceptedOnce = true;
              reached();
              await proceed;
            }
            return client.query(sql, values);
          },
        };
      },
    } as unknown as Pool;
    const writing = mutateAgentSession(
      intercepted,
      auth,
      value.id,
      mutation(value),
    );
    await ready;
    const source = await pool!.connect();
    await source.query("BEGIN");
    await source.query("SET LOCAL statement_timeout='5s'");
    const pid = (await source.query("SELECT pg_backend_pid() AS pid")).rows[0]
      .pid;
    const revoking = source
      .query(
        "UPDATE source_retention_receipts SET authorization_state='revoked' WHERE capture_id=$1",
        [f.capture],
      )
      .then(async () => {
        await source.query("COMMIT");
      });
    try {
      let blocked = false;
      for (let i = 0; i < 100; i++) {
        blocked = (
          await pool!.query(
            "SELECT cardinality(pg_blocking_pids($1))>0 AS blocked",
            [pid],
          )
        ).rows[0].blocked;
        if (blocked) break;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(blocked).toBe(true);
      release();
      await expect(revoking).resolves.toBeUndefined();
      const result = await writing;
      expect(attempts).toBeGreaterThan(1);
      expect(result.payload!.turns[0]!.response.savedBlocks).toBeUndefined();
      expect(
        (
          await pool!.query(
            "SELECT authorization_state FROM source_retention_receipts WHERE capture_id=$1",
            [f.capture],
          )
        ).rows[0].authorization_state,
      ).toBe("revoked");
    } finally {
      release();
      await source.query("ROLLBACK");
      source.release();
    }
  });
  it("preserves pre-task screenshot admission identity and original capture time without storing image bytes", async () => {
    const value = payload();
    value.pendingObjective = "Import the same ordered screenshots";
    value.pendingScreenshotIdempotencyKey = `ios:contact-agent:${randomUUID()}`;
    value.pendingScreenshotRequestIdentity = "a".repeat(64);
    value.pendingScreenshotCapturedAt = now();
    const first = await create(value);
    const otherDevice = await getAgentSession(
      pool!,
      { ...auth, sessionId: randomUUID() },
      value.id,
    );
    expect(otherDevice.payload!.pendingScreenshotIdempotencyKey).toBe(
      value.pendingScreenshotIdempotencyKey,
    );
    expect(otherDevice.payload!.pendingScreenshotRequestIdentity).toBe(
      value.pendingScreenshotRequestIdentity,
    );
    expect(otherDevice.payload!.pendingScreenshotCapturedAt).toBe(
      value.pendingScreenshotCapturedAt,
    );
    const updated = await mutateAgentSession(
      pool!,
      auth,
      value.id,
      mutation({ ...value, title: "Recovery still pending" }, first.revision),
    );
    const changedDate = {
      ...value,
      pendingScreenshotCapturedAt: new Date(
        Date.parse(value.pendingScreenshotCapturedAt) + 1000,
      ).toISOString(),
    };
    await expect(
      mutateAgentSession(
        pool!,
        auth,
        value.id,
        mutation(changedDate, updated.revision),
      ),
    ).rejects.toMatchObject({ code: "AGENT_SESSION_INVALID" });
    await expect(
      mutateAgentSession(
        pool!,
        auth,
        value.id,
        mutation(
          { ...value, pendingScreenshotRequestIdentity: "b".repeat(64) },
          updated.revision,
        ),
      ),
    ).rejects.toMatchObject({ code: "AGENT_SESSION_INVALID" });
    const partial = {
      ...payload(),
      pendingScreenshotIdempotencyKey: "only-key",
    };
    await expect(create(partial)).rejects.toMatchObject({
      code: "AGENT_SESSION_INVALID",
    });
    await expect(
      create({
        ...value,
        id: randomUUID(),
        pendingScreenshotRequestIdentity: "raw screenshot content",
      }),
    ).rejects.toMatchObject({ code: "AGENT_SESSION_INVALID" });
    const withRawBytes = {
      ...value,
      id: randomUUID(),
      image: { data_base64: "forbidden" },
    };
    await expect(create(withRawBytes)).rejects.toMatchObject({
      code: "AGENT_SESSION_INVALID",
    });
    const cleared = {
      ...value,
      pendingScreenshotIdempotencyKey: null,
      pendingScreenshotRequestIdentity: null,
      pendingScreenshotCapturedAt: null,
    };
    expect(
      (
        await mutateAgentSession(
          pool!,
          auth,
          value.id,
          mutation(cleared, updated.revision),
        )
      ).payload!.pendingScreenshotIdempotencyKey,
    ).toBeNull();
  });
  it("retires a screenshot admitted before an unknown receipt and rejects admissions after Session deletion", async () => {
    const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
    const requestFor = (key: string, capturedAt: string) => ({
      idempotency_key: key,
      objective: "Synthetic screenshot admission",
      allow_public_research: false,
      captured_at: capturedAt,
      image: {
        media_type: "image/png",
        byte_size: bytes.length,
        content_hash: createHash("sha256").update(bytes).digest("hex"),
        data_base64: bytes.toString("base64"),
      },
    });
    const pending = () => ({
      ...payload(),
      pendingObjective: "Synthetic screenshot admission",
      pendingScreenshotIdempotencyKey: `ios:contact-agent:${randomUUID()}`,
      pendingScreenshotRequestIdentity: "a".repeat(64),
      pendingScreenshotCapturedAt: now(),
    });
    const value = pending();
    const session = await create(value);
    const admitted = await createScreenshotContactTask(
      pool!,
      auth,
      requestFor(
        value.pendingScreenshotIdempotencyKey,
        value.pendingScreenshotCapturedAt,
      ),
    );
    await pool!.query(
      `INSERT INTO contact_task_images(account_id,task_id,image_index,object_key,storage_scope,media_type,byte_size,content_hash,status,expires_at)
      VALUES($1,$2,0,$3,'synthetic','image/png',9,$4,'stored',now()+interval '30 days')`,
      [
        auth.accountId,
        admitted.body.task_id,
        `synthetic-${randomUUID()}`,
        "a".repeat(64),
      ],
    );
    const removed = await mutateAgentSession(
      pool!,
      auth,
      value.id,
      { expected_revision: session.revision, idempotency_key: randomUUID() },
      true,
    );
    expect(removed.payload).toBeNull();
    const canonical = (
      await pool!.query(
        "SELECT state,input_manifest,status,lease_until FROM screenshot_contact_tasks WHERE id=$1",
        [admitted.body.task_id],
      )
    ).rows[0];
    expect(canonical).toEqual({
      state: {},
      input_manifest: {},
      status: "deleted",
      lease_until: null,
    });
    expect(
      (
        await pool!.query(
          "SELECT status FROM contact_task_images WHERE task_id=$1",
          [admitted.body.task_id],
        )
      ).rows[0].status,
    ).toBe("purge_pending");
    expect(
      (await loadScreenshotContactTask(pool!, auth, admitted.body.task_id))
        .status,
    ).toBe("deleted");
    await expect(
      createScreenshotContactTask(
        pool!,
        auth,
        requestFor(
          value.pendingScreenshotIdempotencyKey,
          value.pendingScreenshotCapturedAt,
        ),
      ),
    ).rejects.toMatchObject({ code: "CONTACT_TASK_SESSION_DELETED" });
    const late = pending();
    const lateSession = await create(late);
    await mutateAgentSession(
      pool!,
      auth,
      late.id,
      {
        expected_revision: lateSession.revision,
        idempotency_key: randomUUID(),
      },
      true,
    );
    await expect(
      createScreenshotContactTask(
        pool!,
        auth,
        requestFor(
          late.pendingScreenshotIdempotencyKey,
          late.pendingScreenshotCapturedAt,
        ),
      ),
    ).rejects.toMatchObject({ code: "CONTACT_TASK_SESSION_DELETED" });
    expect(
      (
        await pool!.query(
          "SELECT count(*)::int AS count FROM screenshot_contact_tasks WHERE account_id=$1 AND created_by_user_id=$2 AND idempotency_key=$3",
          [auth.accountId, auth.userId, late.pendingScreenshotIdempotencyKey],
        )
      ).rows[0].count,
    ).toBe(0);
    const concurrent = pending();
    const concurrentSession = await create(concurrent);
    const race = await Promise.allSettled([
      createScreenshotContactTask(
        pool!,
        auth,
        requestFor(
          concurrent.pendingScreenshotIdempotencyKey,
          concurrent.pendingScreenshotCapturedAt,
        ),
      ),
      mutateAgentSession(
        pool!,
        auth,
        concurrent.id,
        {
          expected_revision: concurrentSession.revision,
          idempotency_key: randomUUID(),
        },
        true,
      ),
    ]);
    expect(race[1]!.status).toBe("fulfilled");
    expect(
      (
        await pool!.query(
          "SELECT count(*)::int AS count FROM screenshot_contact_tasks WHERE account_id=$1 AND created_by_user_id=$2 AND idempotency_key=$3 AND status<>'deleted'",
          [
            auth.accountId,
            auth.userId,
            concurrent.pendingScreenshotIdempotencyKey,
          ],
        )
      ).rows[0].count,
    ).toBe(0);
    const shared = pending();
    const sourceSession = await create(shared);
    const sharedTask = await createScreenshotContactTask(
      pool!,
      auth,
      requestFor(
        shared.pendingScreenshotIdempotencyKey,
        shared.pendingScreenshotCapturedAt,
      ),
    );
    const otherSession = await create({
      ...payload(),
      screenshotTaskIDs: [sharedTask.body.task_id],
    });
    await mutateAgentSession(
      pool!,
      auth,
      shared.id,
      {
        expected_revision: sourceSession.revision,
        idempotency_key: randomUUID(),
      },
      true,
    );
    expect(
      (await loadScreenshotContactTask(pool!, auth, sharedTask.body.task_id))
        .status,
    ).toBe("running");
    expect(
      (
        await createScreenshotContactTask(
          pool!,
          auth,
          requestFor(
            shared.pendingScreenshotIdempotencyKey,
            shared.pendingScreenshotCapturedAt,
          ),
        )
      ).replayed,
    ).toBe(true);
    await mutateAgentSession(
      pool!,
      auth,
      otherSession.session_id,
      {
        expected_revision: otherSession.revision,
        idempotency_key: randomUUID(),
      },
      true,
    );
    expect(
      (await loadScreenshotContactTask(pool!, auth, sharedTask.body.task_id))
        .status,
    ).toBe("deleted");
    const tombstone = (
      await pool!.query(
        "SELECT payload,screenshot_admission_key_hash FROM agent_sessions WHERE id=$1",
        [late.id],
      )
    ).rows[0];
    expect(tombstone.payload).toBeNull();
    expect(tombstone.screenshot_admission_key_hash).toBe(
      createHash("sha256")
        .update(late.pendingScreenshotIdempotencyKey)
        .digest("hex"),
    );
  });
  it("uses bounded canonical screenshot interpretation for unbound follow-ups without client text, OCR, or image exposure", async () => {
    const f = await screenshotContextFixture();
    await create(f.value);
    let observed!: RemoteChatAnswerRequest;
    const request = {
      objective: "What does Friday mean?",
      session_id: f.value.id,
      idempotency_key: randomUUID(),
    };
    await createUnscopedChatTask(
      pool!,
      auth,
      request,
      contextProvider((input) => {
        observed = input;
      }),
    );
    const text = JSON.stringify(observed);
    expect(text).toContain("date and time zone remain unknown");
    expect(text).toContain(
      "unconfirmed_interpretation_not_reviewed_evidence_or_action_authorization",
    );
    expect(text).toContain(f.task);
    expect(text).toContain(f.value.turns[0]!.id);
    expect(text).toContain("original-message-1");
    expect(text).toContain(f.value.turns[0]!.objective);
    expect(text).not.toContain("Injected client summary");
    expect(text).not.toContain("PRIVATE OCR");
    expect(text).not.toContain("PRIVATE FULL OCR");
    expect(observed.images).toEqual([]);
    expect(observed.allowed_citation_ids).toEqual([]);
    expect(observed.context_blocks).toEqual([]);
    expect(
      observed.conversation_history!.map((item) => item.text).join("").length,
    ).toBeLessThanOrEqual(12000);
  });
  it("supplies screenshot prior context to an already bound relationship even when its published snapshot predates that result", async () => {
    const f = await screenshotContextFixture(true);
    await compileRelationshipWiki(
      pool!,
      auth,
      f.source!.person,
      f.source!.context,
      {
        idempotency_key: randomUUID(),
        objective: "Compile existing synthetic source only",
      },
    );
    await create(f.value);
    let observed!: RemoteChatAnswerRequest;
    const result = await createChatTask(
      pool!,
      auth,
      {
        objective: "What does Friday mean?",
        person_id: f.source!.person,
        relationship_context_id: f.source!.context,
        session_id: f.value.id,
        idempotency_key: randomUUID(),
      },
      contextProvider((input) => {
        observed = input;
      }),
    );
    expect(JSON.stringify(observed.context_blocks)).not.toContain("Friday");
    expect(JSON.stringify(observed.conversation_history)).toContain("Friday");
    expect(
      result.body.blocks.find((item) => item.kind === "answer"),
    ).toMatchObject({
      status: "proposed",
      title: expect.stringContaining("Unconfirmed screenshot interpretation"),
      citation_dependency_ids: observed.allowed_citation_ids.slice(0, 1),
    });
    expect(
      (
        await pool!.query(
          "SELECT count(*)::int AS count FROM agent_session_chat_sources WHERE task_id=$1",
          [result.body.task_id],
        )
      ).rows[0].count,
    ).toBe(1);
    await pool!.query(
      "UPDATE source_retention_receipts SET authorization_state='revoked' WHERE capture_id=$1",
      [f.source!.capture],
    );
    await expect(
      getChatTaskReadback(pool!, auth, result.body.task_id),
    ).rejects.toMatchObject({ code: "AGENT_SESSION_CONTEXT_UNAVAILABLE" });
    expect(
      JSON.stringify(
        (
          await pool!.query(
            "SELECT response_body FROM idempotency_records WHERE response_body->>'task_id'=$1",
            [result.body.task_id],
          )
        ).rows,
      ),
    ).not.toContain("Synthetic derived Friday");
  });
  it("answers the first bound screenshot follow-up without promoting proposed OCR into manifest citations", async () => {
    const f = await screenshotContextFixture(true);
    await pool!.query(
      "UPDATE evidence_fragments SET review_status='proposed',attribution_status='unknown' WHERE id=$1",
      [f.source!.fragment],
    );
    await compileRelationshipWiki(
      pool!,
      auth,
      f.source!.person,
      f.source!.context,
      {
        idempotency_key: randomUUID(),
        objective: "Compile unreviewed screenshot source",
      },
    );
    await create(f.value);
    const request = {
      objective: "What does Friday mean?",
      person_id: f.source!.person,
      relationship_context_id: f.source!.context,
      session_id: f.value.id,
      idempotency_key: randomUUID(),
    };
    let observed!: RemoteChatAnswerRequest;
    const result = await createChatTask(
      pool!,
      auth,
      request,
      contextProvider((input) => {
        observed = input;
      }),
    );
    expect(observed.permits_unconfirmed_session_context_answer).toBe(true);
    expect(observed.allowed_citation_ids).toEqual([]);
    expect(JSON.stringify(observed.context_blocks)).not.toContain(
      "Synthetic source text",
    );
    expect(
      result.body.blocks.find((item) => item.kind === "answer"),
    ).toMatchObject({
      status: "proposed",
      title: expect.stringContaining("Unconfirmed screenshot interpretation"),
      citation_dependency_ids: [],
      requires_user_decision: false,
    });
    expect(
      (await getChatTaskReadback(pool!, auth, result.body.task_id)).citations,
    ).toEqual([]);
    await pool!.query(
      "UPDATE screenshot_contact_tasks SET state=jsonb_set(state,'{response}','{}'::jsonb) WHERE id=$1",
      [f.task],
    );
    await expect(
      createChatTask(
        pool!,
        auth,
        { ...request, idempotency_key: randomUUID() },
        contextProvider(),
      ),
    ).rejects.toMatchObject({ code: "AGENT_SESSION_CONTEXT_UNAVAILABLE" });
    await expect(
      createChatTask(pool!, auth, request, contextProvider()),
    ).rejects.toMatchObject({ code: "AGENT_SESSION_CONTEXT_UNAVAILABLE" });
  });
  it("propagates exact screenshot dependencies through read-only forks and physically retracts derived replies and replay bodies", async () => {
    const f = await screenshotContextFixture();
    const firstSession = await create(f.value);
    const firstRequest = {
      objective: "What does Friday mean?",
      session_id: f.value.id,
      idempotency_key: randomUUID(),
    };
    const first = await createUnscopedChatTask(
      pool!,
      auth,
      firstRequest,
      contextProvider(),
    );
    const generatedTurn = {
      ...payload().turns[0]!,
      response: {
        ...payload().turns[0]!.response,
        taskID: first.body.task_id,
        savedBlocks: [block(first.body.blocks[0]!.body)],
      },
    };
    await mutateAgentSession(
      pool!,
      auth,
      f.value.id,
      mutation(
        { ...f.value, turns: [...f.value.turns, generatedTurn] },
        firstSession.revision,
      ),
    );
    const fork = {
      ...payload(),
      turns: [generatedTurn],
      screenshotTaskIDs: [f.task],
      inheritedScreenshotTaskIDs: [f.task],
      originSessionID: f.value.id,
      originTurnID: generatedTurn.id,
    };
    await create(fork);
    const secondRequest = {
      objective: "What should I do next?",
      session_id: fork.id,
      idempotency_key: randomUUID(),
    };
    let observed!: RemoteChatAnswerRequest;
    const second = await createUnscopedChatTask(
      pool!,
      auth,
      secondRequest,
      contextProvider((input) => {
        observed = input;
      }),
    );
    expect(JSON.stringify(observed.conversation_history)).toContain(
      "Synthetic derived Friday",
    );
    expect(
      (
        await pool!.query(
          "SELECT screenshot_task_id FROM agent_session_chat_sources WHERE task_id=$1",
          [second.body.task_id],
        )
      ).rows[0].screenshot_task_id,
    ).toBe(f.task);
    expect(second.body.external_effects).toEqual([]);
    await pool!.query(
      "UPDATE screenshot_contact_tasks SET status='deleted',state='{}' WHERE id=$1",
      [f.task],
    );
    await expect(
      createUnscopedChatTask(pool!, auth, firstRequest, contextProvider()),
    ).rejects.toMatchObject({ code: "AGENT_SESSION_CONTEXT_UNAVAILABLE" });
    await expect(
      createUnscopedChatTask(pool!, auth, secondRequest, contextProvider()),
    ).rejects.toMatchObject({ code: "AGENT_SESSION_CONTEXT_UNAVAILABLE" });
    expect(
      JSON.stringify(
        (
          await pool!.query(
            "SELECT response_body FROM idempotency_records WHERE response_body->>'task_id'=ANY($1::text[])",
            [[first.body.task_id, second.body.task_id]],
          )
        ).rows,
      ),
    ).not.toContain("Synthetic derived Friday");
    expect(
      (await getAgentSession(pool!, auth, fork.id)).payload!.turns[0]!.response
        .savedBlocks,
    ).toBeUndefined();
    expect(
      (
        await readAgentSessionConversation(pool!, auth, fork.id, {
          personId: null,
          relationshipContextId: null,
        })
      ).messages,
    ).toEqual([]);
  });
  it("excludes expired, revoked, mismatched-scope and other-user screenshot context", async () => {
    for (const mode of ["expired", "revoked", "foreign"]) {
      const f = await screenshotContextFixture(mode === "revoked");
      await create(f.value);
      if (mode === "expired")
        await pool!.query(
          "UPDATE screenshot_contact_tasks SET expires_at=now()-interval '1 second' WHERE id=$1",
          [f.task],
        );
      if (mode === "revoked")
        await pool!.query(
          "UPDATE source_retention_receipts SET authorization_state='revoked' WHERE capture_id=$1",
          [f.source!.capture],
        );
      if (mode === "foreign")
        await pool!.query(
          "UPDATE screenshot_contact_tasks SET created_by_user_id=$2 WHERE id=$1",
          [f.task, otherUser.userId],
        );
      const history = await readAgentSessionConversation(
        pool!,
        auth,
        f.value.id,
        {
          personId: f.source?.person ?? null,
          relationshipContextId: f.source?.context ?? null,
        },
      );
      expect(history.messages).toEqual([]);
    }
    const f = await screenshotContextFixture(true);
    const alternate = await fixture();
    f.value.personID = alternate.person;
    f.value.relationshipContextID = alternate.context;
    await create(f.value);
    expect(
      (
        await readAgentSessionConversation(pool!, auth, f.value.id, {
          personId: alternate.person,
          relationshipContextId: alternate.context,
        })
      ).messages,
    ).toEqual([]);
  });
  it("rejects a reply when its screenshot source is withdrawn after generation but before result persistence", async () => {
    const f = await screenshotContextFixture();
    await create(f.value);
    let reached!: () => void, release!: () => void;
    const ready = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const proceed = new Promise<void>((resolve) => {
      release = resolve;
    });
    const intercepted = {
      query: pool!.query.bind(pool),
      connect: async () => {
        const client = await pool!.connect();
        return {
          release: () => client.release(),
          query: async (sql: string, values?: unknown[]) => {
            if (
              sql.includes("SELECT id FROM screenshot_contact_tasks") &&
              sql.includes("FOR SHARE")
            ) {
              reached();
              await proceed;
            }
            return client.query(sql, values);
          },
        };
      },
    } as unknown as Pool;
    const request = {
      objective: "What does Friday mean?",
      session_id: f.value.id,
      idempotency_key: randomUUID(),
    };
    const writing = createUnscopedChatTask(
      intercepted,
      auth,
      request,
      contextProvider(),
    );
    await ready;
    await pool!.query(
      "UPDATE screenshot_contact_tasks SET status='deleted',state='{}' WHERE id=$1",
      [f.task],
    );
    release();
    await expect(writing).rejects.toMatchObject({
      code: "AGENT_SESSION_CONTEXT_UNAVAILABLE",
    });
    expect(
      (
        await pool!.query(
          "SELECT count(*)::int AS count FROM idempotency_records WHERE account_id=$1 AND idempotency_key=$2",
          [auth.accountId, request.idempotency_key],
        )
      ).rows[0].count,
    ).toBe(0);
  });
  it("caps a Session reply against the database clock when the application clock runs ahead", async () => {
    const actualNow = Date.now.bind(Date);
    const clock = vi
      .spyOn(Date, "now")
      .mockImplementation(() => actualNow() + 30_000);
    try {
      const value = payload();
      value.createdAt = new Date(Date.now()).toISOString();
      value.updatedAt = value.createdAt;
      value.turns = value.turns.map((turn) => ({
        ...turn,
        createdAt: value.createdAt!,
      }));
      const session = await create(value);
      const request = {
        objective: "Explain this option",
        session_id: value.id,
        idempotency_key: randomUUID(),
      };
      const reply = await createUnscopedChatTask(
        pool!,
        auth,
        request,
        contextProvider(),
      );
      const retained = (
        await pool!.query<{ capped: boolean; expires_at: Date }>(
          "SELECT expires_at=created_at+interval '30 days' AS capped,expires_at FROM agent_session_chat_tasks WHERE account_id=$1 AND task_id=$2",
          [auth.accountId, reply.body.task_id],
        )
      ).rows[0]!;
      expect(retained.capped).toBe(true);
      expect(retained.expires_at.valueOf()).toBeLessThan(
        Date.parse(session.expires_at),
      );
      expect(
        (await createUnscopedChatTask(pool!, auth, request, contextProvider()))
          .replayed,
      ).toBe(true);
    } finally {
      clock.mockRestore();
    }
  });
  it("prevents replay of a session-bound plain-text reply after canonical Session deletion and removes its body", async () => {
    const session = await create();
    const request = {
      objective: "Explain the previous choice",
      session_id: session.session_id,
      idempotency_key: randomUUID(),
    };
    const reply = await createUnscopedChatTask(
      pool!,
      auth,
      request,
      contextProvider(),
    );
    expect(reply.body.blocks[0]!.body).toContain(
      "Synthetic derived Friday reply",
    );
    await mutateAgentSession(
      pool!,
      auth,
      session.session_id,
      { expected_revision: session.revision, idempotency_key: randomUUID() },
      true,
    );
    await expect(
      createUnscopedChatTask(pool!, auth, request, contextProvider()),
    ).rejects.toMatchObject({ code: "AGENT_SESSION_DELETED" });
    const stored = (
      await pool!.query(
        "SELECT response_body FROM idempotency_records WHERE account_id=$1 AND idempotency_key=$2",
        [auth.accountId, request.idempotency_key],
      )
    ).rows[0].response_body;
    expect(JSON.stringify(stored)).not.toContain(
      "Synthetic derived Friday reply",
    );
  });
  it("expires Session-bound plain replies while leaving tasks without a Session under their existing policy", async () => {
    const session = await create();
    const request = {
      objective: "Explain an option",
      session_id: session.session_id,
      idempotency_key: randomUUID(),
    };
    const bound = await createUnscopedChatTask(
      pool!,
      auth,
      request,
      contextProvider(),
    );
    const legacyRequest = {
      objective: "A separate ordinary chat",
      idempotency_key: randomUUID(),
    };
    const legacy = await createUnscopedChatTask(
      pool!,
      auth,
      legacyRequest,
      contextProvider(),
    );
    await pool!.query(
      "UPDATE agent_sessions SET expires_at=now()-interval '1 second' WHERE id=$1",
      [session.session_id],
    );
    await expect(
      createUnscopedChatTask(pool!, auth, request, contextProvider()),
    ).rejects.toMatchObject({ code: "AGENT_SESSION_DELETED" });
    const body = (
      await pool!.query(
        "SELECT response_body FROM idempotency_records WHERE response_body->>'task_id'=$1",
        [bound.body.task_id],
      )
    ).rows[0].response_body;
    expect(JSON.stringify(body)).not.toContain(
      "Synthetic derived Friday reply",
    );
    expect(
      (
        await createUnscopedChatTask(
          pool!,
          auth,
          legacyRequest,
          contextProvider(),
        )
      ).body,
    ).toEqual(legacy.body);
    expect(
      (
        await pool!.query(
          "SELECT count(*)::int AS count FROM agent_session_chat_tasks WHERE task_id=$1",
          [legacy.body.task_id],
        )
      ).rows[0].count,
    ).toBe(0);
  });
  it("retains a legitimate fork reference without extending the original reply or follow-up retention clock", async () => {
    const value = {
      ...payload(),
      createdAt: new Date(Date.now() - 29 * 86400000).toISOString(),
    };
    const original = await create(value);
    const originalRequest = {
      objective: "Explain an option",
      session_id: value.id,
      idempotency_key: randomUUID(),
    };
    const reply = await createUnscopedChatTask(
      pool!,
      auth,
      originalRequest,
      contextProvider(),
    );
    const turn = {
      ...payload().turns[0]!,
      response: {
        ...payload().turns[0]!.response,
        taskID: reply.body.task_id,
        savedBlocks: [block(reply.body.blocks[0]!.body)],
      },
    };
    const updated = await mutateAgentSession(
      pool!,
      auth,
      value.id,
      mutation({ ...value, turns: [...value.turns, turn] }, original.revision),
    );
    const forkValue = {
      ...payload(),
      turns: [turn],
      originSessionID: value.id,
      originTurnID: turn.id,
    };
    const fork = await create(forkValue);
    let reached!: () => void, release!: () => void;
    const ready = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const proceed = new Promise<void>((resolve) => {
      release = resolve;
    });
    const replayPool = {
      query: pool!.query.bind(pool),
      connect: async () => {
        const client = await pool!.connect();
        return {
          release: () => client.release(),
          query: async (sql: string, values?: unknown[]) => {
            const result = await client.query(sql, values);
            if (
              sql.includes("SELECT expires_at,deleted_at") &&
              !sql.includes("FOR SHARE")
            ) {
              reached();
              await proceed;
            }
            return result;
          },
        };
      },
    } as unknown as Pool;
    const concurrentReplay = createUnscopedChatTask(
      replayPool,
      auth,
      originalRequest,
      contextProvider(),
    );
    await ready;
    await mutateAgentSession(
      pool!,
      auth,
      value.id,
      { expected_revision: updated.revision, idempotency_key: randomUUID() },
      true,
    );
    release();
    await expect(concurrentReplay).rejects.toMatchObject({
      code: "AGENT_SESSION_DELETED",
    });
    await expect(
      createUnscopedChatTask(pool!, auth, originalRequest, contextProvider()),
    ).rejects.toMatchObject({ code: "AGENT_SESSION_DELETED" });
    const kept = (
      await pool!.query(
        "SELECT response_body FROM idempotency_records WHERE response_body->>'task_id'=$1",
        [reply.body.task_id],
      )
    ).rows[0].response_body;
    expect(JSON.stringify(kept)).toContain("Synthetic derived Friday reply");
    expect(
      JSON.stringify(
        (
          await readAgentSessionConversation(pool!, auth, fork.session_id, {
            personId: null,
            relationshipContextId: null,
          })
        ).messages,
      ),
    ).toContain("Synthetic derived Friday reply");
    const next = await createUnscopedChatTask(
      pool!,
      auth,
      {
        objective: "Expand that choice",
        session_id: fork.session_id,
        idempotency_key: randomUUID(),
      },
      contextProvider(),
    );
    const clocks = (
      await pool!.query(
        "SELECT expires_at FROM agent_session_chat_tasks WHERE task_id=ANY($1::text[])",
        [[reply.body.task_id, next.body.task_id]],
      )
    ).rows;
    expect(clocks).toHaveLength(2);
    expect(
      clocks.every(
        (item) => item.expires_at.toISOString() === original.expires_at,
      ),
    ).toBe(true);
    expect(next.body.external_effects).toEqual([]);
    await pool!.query(
      "UPDATE agent_session_chat_tasks SET expires_at=now()-interval '1 second' WHERE task_id=ANY($1::text[])",
      [[reply.body.task_id, next.body.task_id]],
    );
    const expired = await getAgentSession(pool!, auth, fork.session_id);
    expect(expired.payload!.turns[0]!.response.savedBlocks).toBeUndefined();
    expect(
      JSON.stringify(
        (
          await pool!.query(
            "SELECT response_body FROM idempotency_records WHERE response_body->>'task_id'=ANY($1::text[])",
            [[reply.body.task_id, next.body.task_id]],
          )
        ).rows,
      ),
    ).not.toContain("Synthetic derived Friday reply");
  });
  it("cleans a scoped Session reply after deletion and rejects its original replay and readback", async () => {
    const f = await fixture();
    await compileRelationshipWiki(pool!, auth, f.person, f.context, {
      idempotency_key: randomUUID(),
      objective: "Prepare reviewed context",
    });
    const value = {
      ...payload(),
      scopeKind: "relationship" as const,
      personID: f.person,
      relationshipContextID: f.context,
    };
    const session = await create(value);
    const request = {
      objective: "Explain the reviewed source",
      person_id: f.person,
      relationship_context_id: f.context,
      session_id: value.id,
      idempotency_key: randomUUID(),
    };
    const reply = await createChatTask(pool!, auth, request, contextProvider());
    await mutateAgentSession(
      pool!,
      auth,
      value.id,
      { expected_revision: session.revision, idempotency_key: randomUUID() },
      true,
    );
    await expect(
      createChatTask(pool!, auth, request, contextProvider()),
    ).rejects.toMatchObject({ code: "AGENT_SESSION_DELETED" });
    await expect(
      getChatTaskReadback(pool!, auth, reply.body.task_id),
    ).rejects.toMatchObject({ code: "AGENT_SESSION_CONTEXT_UNAVAILABLE" });
    expect(
      JSON.stringify(
        (
          await pool!.query(
            "SELECT response_body FROM idempotency_records WHERE response_body->>'task_id'=$1",
            [reply.body.task_id],
          )
        ).rows,
      ),
    ).not.toContain("Synthetic derived Friday reply");
  });
  it("fences plain-text generation against a Session deleted before result persistence", async () => {
    const session = await create();
    let reached!: () => void, release!: () => void;
    const ready = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const proceed = new Promise<void>((resolve) => {
      release = resolve;
    });
    const intercepted = {
      query: pool!.query.bind(pool),
      connect: async () => {
        const client = await pool!.connect();
        return {
          release: () => client.release(),
          query: async (sql: string, values?: unknown[]) => {
            if (
              sql.includes("SELECT expires_at,deleted_at") &&
              sql.includes("FOR SHARE")
            ) {
              reached();
              await proceed;
            }
            return client.query(sql, values);
          },
        };
      },
    } as unknown as Pool;
    const request = {
      objective: "Explain an option",
      session_id: session.session_id,
      idempotency_key: randomUUID(),
    };
    const writing = createUnscopedChatTask(
      intercepted,
      auth,
      request,
      contextProvider(),
    );
    await ready;
    await mutateAgentSession(
      pool!,
      auth,
      session.session_id,
      { expected_revision: session.revision, idempotency_key: randomUUID() },
      true,
    );
    release();
    await expect(writing).rejects.toMatchObject({
      code: "AGENT_SESSION_DELETED",
    });
    expect(
      (
        await pool!.query(
          "SELECT count(*)::int AS count FROM idempotency_records WHERE account_id=$1 AND idempotency_key=$2",
          [auth.accountId, request.idempotency_key],
        )
      ).rows[0].count,
    ).toBe(0);
    expect(
      (
        await pool!.query(
          "SELECT count(*)::int AS count FROM agent_session_chat_tasks WHERE origin_session_id=$1",
          [session.session_id],
        )
      ).rows[0].count,
    ).toBe(0);
  });
  it("validates screenshot task ownership and erases screenshot derivatives on canonical deletion", async () => {
    const task = randomUUID();
    await pool!.query(
      `INSERT INTO screenshot_contact_tasks(id,account_id,created_by_user_id,idempotency_key,request_hash,input_manifest,state,status)
      VALUES($1::uuid,$2,$3,$1::text,$4,'{}','{}','running')`,
      [task, auth.accountId, auth.userId, "a".repeat(64)],
    );
    const value = payload();
    value.screenshotTaskIDs = [task];
    value.turns[0]!.response.taskID = task;
    value.turns[0]!.response.disposition = "screenshot_processing";
    await create(value);
    expect(
      (
        await readAgentSessionConversation(pool!, auth, value.id, {
          personId: null,
          relationshipContextId: null,
        })
      ).messages,
    ).toEqual([
      {
        message_id: value.turns[0]!.id,
        role: "user",
        text: value.turns[0]!.objective,
      },
    ]);
    await pool!.query(
      "UPDATE screenshot_contact_tasks SET status='deleted' WHERE id=$1",
      [task],
    );
    const saved = await getAgentSession(pool!, auth, value.id);
    expect(saved.payload!.turns[0]!.response.savedBlocks).toBeUndefined();
    const forged = payload();
    forged.screenshotTaskIDs = [randomUUID()];
    await expect(create(forged)).rejects.toMatchObject({
      code: "AGENT_SESSION_NOT_FOUND",
    });
  });
  it("retains inherited screenshot references as immutable read-only lineage", async () => {
    const tasks = [randomUUID(), randomUUID()];
    for (const task of tasks)
      await pool!.query(
        `INSERT INTO screenshot_contact_tasks(id,account_id,created_by_user_id,idempotency_key,request_hash,input_manifest,state,status)
      VALUES($1::uuid,$2,$3,$1::text,$4,'{}','{}','running')`,
        [task, auth.accountId, auth.userId, "a".repeat(64)],
      );
    const value = {
      ...payload(),
      screenshotTaskIDs: tasks,
      inheritedScreenshotTaskIDs: [tasks[0]!.toUpperCase()],
    };
    const first = await create(value);
    expect(first.payload!.inheritedScreenshotTaskIDs).toEqual([tasks[0]]);
    await expect(
      mutateAgentSession(
        pool!,
        auth,
        value.id,
        mutation({ ...value, inheritedScreenshotTaskIDs: [] }, first.revision),
      ),
    ).rejects.toMatchObject({ code: "AGENT_SESSION_INVALID" });
    const { inheritedScreenshotTaskIDs: _inherited, ...removed } = value;
    await expect(
      mutateAgentSession(
        pool!,
        auth,
        value.id,
        mutation(removed, first.revision),
      ),
    ).rejects.toMatchObject({ code: "AGENT_SESSION_INVALID" });
    await expect(
      create({
        ...value,
        id: randomUUID(),
        inheritedScreenshotTaskIDs: [randomUUID()],
      }),
    ).rejects.toMatchObject({ code: "AGENT_SESSION_INVALID" });
    const legacy = { ...payload(), screenshotTaskIDs: tasks };
    const saved = await create(legacy);
    await expect(
      mutateAgentSession(
        pool!,
        auth,
        legacy.id,
        mutation(
          { ...legacy, inheritedScreenshotTaskIDs: [tasks[0]!] },
          saved.revision,
        ),
      ),
    ).rejects.toMatchObject({ code: "AGENT_SESSION_INVALID" });
    await expect(
      mutateAgentSession(
        pool!,
        auth,
        legacy.id,
        mutation(
          { ...legacy, inheritedScreenshotTaskIDs: tasks },
          saved.revision,
        ),
      ),
    ).resolves.toMatchObject({ revision: 2 });
  });
  it("rejects executable blocks, invalid schemas, duplicate messages and unbounded payloads", async () => {
    const executable = payload();
    (
      executable.turns[0]!.response.savedBlocks![0] as {
        requires_user_decision: boolean;
      }
    ).requires_user_decision = true;
    await expect(create(executable)).rejects.toMatchObject({
      code: "AGENT_SESSION_INVALID",
    });
    const duplicate = payload();
    duplicate.turns.push(duplicate.turns[0]!);
    await expect(create(duplicate)).rejects.toMatchObject({
      code: "AGENT_SESSION_INVALID",
    });
    const huge = payload();
    huge.turns = Array.from({ length: 30 }, () => ({
      ...huge.turns[0]!,
      id: randomUUID(),
      objective: "x".repeat(12000),
    }));
    await expect(create(huge)).rejects.toMatchObject({
      code: "AGENT_SESSION_INVALID",
    });
  });
  it("paginates without truncating the canonical set or omitting tombstones", async () => {
    const seen: string[] = [];
    let after: string | undefined;
    do {
      const page = await listAgentSessions(pool!, auth, after, 3);
      expect(page.sessions.length).toBeLessThanOrEqual(3);
      seen.push(...page.sessions.map((s) => s.session_id));
      if (page.complete) break;
      after = page.next_cursor!;
    } while (after);
    const count = (
      await pool!.query(
        "SELECT count(*)::integer AS count FROM agent_sessions WHERE account_id=$1 AND created_by_user_id=$2",
        [auth.accountId, auth.userId],
      )
    ).rows[0].count;
    const expected = (
      await pool!.query<{ id: string }>(
        `SELECT id FROM agent_sessions
         WHERE account_id=$1 AND created_by_user_id=$2
         ORDER BY updated_at DESC,id DESC`,
        [auth.accountId, auth.userId],
      )
    ).rows.map((row) => row.id);
    expect(new Set(seen).size).toBe(count);
    expect(seen.length).toBe(count);
    expect(seen).toEqual(expected);
  });
  it("keeps the snapshot order when the cursor and an unseen Session mutate between pages", async () => {
    const first = await listAgentSessions(pool!, auth, undefined, 3);
    expect(first.complete).toBe(false);
    expect(first.next_cursor).toEqual(expect.any(String));
    const expected = (
      await pool!.query<{ session_id: string }>(
        `SELECT item.session_id
         FROM agent_session_list_snapshots snapshot
         JOIN agent_session_list_snapshot_items item
           ON item.account_id=snapshot.account_id
          AND item.snapshot_id=snapshot.id
         WHERE snapshot.account_id=$1 AND snapshot.created_by_user_id=$2
         ORDER BY item.sort_updated_at DESC,item.session_id DESC`,
        [auth.accountId, auth.userId],
      )
    ).rows.map((row) => row.session_id);
    expect(expected.length).toBeGreaterThan(3);
    const cursorSession = first.sessions.at(-1)!.session_id;
    const unseenSession = expected.find(
      (id) => !first.sessions.some((session) => session.session_id === id),
    )!;
    await pool!.query(
      `UPDATE agent_sessions
       SET updated_at=clock_timestamp()+interval '2 seconds'
       WHERE account_id=$1 AND id=ANY($2::uuid[])`,
      [auth.accountId, [cursorSession, unseenSession]],
    );

    const seen = first.sessions.map((session) => session.session_id);
    let after = first.next_cursor!;
    for (;;) {
      const page = await listAgentSessions(pool!, auth, after, 3);
      seen.push(...page.sessions.map((session) => session.session_id));
      if (page.complete) break;
      after = page.next_cursor!;
    }

    expect(seen).toEqual(expected);
    expect(new Set(seen).size).toBe(expected.length);
  });
  it("bounds concurrent owner snapshots while retaining a four-tab window", async () => {
    await create();
    await create();
    const cursors: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      const first = await listAgentSessions(pool!, auth, undefined, 1);
      expect(first.complete).toBe(false);
      cursors.push(first.next_cursor!);
    }
    const count = await pool!.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM agent_session_list_snapshots
       WHERE account_id=$1 AND created_by_user_id=$2`,
      [auth.accountId, auth.userId],
    );
    expect(Number(count.rows[0]?.count)).toBeLessThanOrEqual(4);
    await expect(
      listAgentSessions(pool!, auth, cursors[0], 1),
    ).rejects.toMatchObject({
      code: "AGENT_SESSION_CURSOR_EXPIRED",
      statusCode: 410,
    });
    await expect(
      listAgentSessions(pool!, auth, cursors.at(-1), 1),
    ).resolves.toMatchObject({ sessions: expect.any(Array) });
  });
  it("rejects malformed Session list cursors before querying a snapshot", async () => {
    await expect(listAgentSessions(pool!, auth, "not-json", 3)).rejects.toMatchObject({
      code: "AGENT_SESSION_CURSOR_INVALID",
      statusCode: 400,
    });
  });
  it("serves no-store HTTP readback and rejects authority-bearing client blocks at the route", async () => {
    const app = Fastify();
    await app.register(rateLimit, { global: false });
    app.decorateRequest("auth", null as unknown as AuthContext);
    registerAgentSessionRoutes(app, pool!, async (req) => {
      req.auth = auth;
    });
    app.setErrorHandler((error, _req, reply) => {
      const e = error as ApiError;
      reply.code(e.statusCode ?? 400).send({
        error: {
          code: e.code ?? "INVALID",
          message: e.message,
          request_id: "fixture",
        },
      });
    });
    try {
      const value = payload();
      const saved = await app.inject({
        method: "PUT",
        url: `/v1/agent-sessions/${value.id}`,
        payload: mutation(value),
      });
      expect(saved.statusCode, saved.body).toBe(200);
      expect(saved.headers["cache-control"]).toBe("no-store");
      const read = await app.inject({
        method: "GET",
        url: `/v1/agent-sessions/${value.id}`,
      });
      expect(read.json().session.payload.id).toBe(value.id);
      expect(
        read.json().session.payload.turns[0].response.savedBlocks[0]
          .allows_static_share,
      ).toBe(true);

      const oldClientUpdate = structuredClone(value);
      delete (
        oldClientUpdate.turns[0]!.response.savedBlocks![0] as {
          allows_static_share?: boolean;
        }
      ).allows_static_share;
      // Native clients may use an equivalent fractional-second representation.
      oldClientUpdate.turns[0]!.createdAt = value.turns[0]!.createdAt.replace(/Z$/, "000Z");
      oldClientUpdate.contextDisplayLabel = "Conversation renamed by old client";
      oldClientUpdate.updatedAt = now();
      const savedByOldClient = await app.inject({
        method: "PUT",
        url: `/v1/agent-sessions/${value.id}`,
        payload: mutation(oldClientUpdate, 1),
      });
      expect(savedByOldClient.statusCode, savedByOldClient.body).toBe(200);
      const readAfterOldClient = await app.inject({
        method: "GET",
        url: `/v1/agent-sessions/${value.id}`,
      });
      expect(
        readAfterOldClient.json().session.payload.turns[0].response
          .savedBlocks[0].allows_static_share,
      ).toBe(true);

      oldClientUpdate.turns[0]!.response.savedBlocks![0]!.body =
        "A changed answer from an old client.";
      oldClientUpdate.updatedAt = now();
      const changedByOldClient = await app.inject({
        method: "PUT",
        url: `/v1/agent-sessions/${value.id}`,
        payload: mutation(oldClientUpdate, 2),
      });
      expect(changedByOldClient.statusCode, changedByOldClient.body).toBe(200);
      const readAfterChangedBlock = await app.inject({
        method: "GET",
        url: `/v1/agent-sessions/${value.id}`,
      });
      expect(
        readAfterChangedBlock.json().session.payload.turns[0].response
          .savedBlocks[0].allows_static_share,
      ).toBeUndefined();

      const legacy = payload();
      delete (
        legacy.turns[0]!.response.savedBlocks![0] as {
          allows_static_share?: boolean;
        }
      ).allows_static_share;
      const savedLegacy = await app.inject({
        method: "PUT",
        url: `/v1/agent-sessions/${legacy.id}`,
        payload: mutation(legacy),
      });
      expect(savedLegacy.statusCode, savedLegacy.body).toBe(200);
      const readLegacy = await app.inject({
        method: "GET",
        url: `/v1/agent-sessions/${legacy.id}`,
      });
      expect(
        readLegacy.json().session.payload.turns[0].response.savedBlocks[0]
          .allows_static_share,
      ).toBeUndefined();
      (
        value.turns[0]!.response.savedBlocks![0] as {
          requires_user_decision: boolean;
        }
      ).requires_user_decision = true;
      const denied = await app.inject({
        method: "PUT",
        url: `/v1/agent-sessions/${value.id}`,
        payload: mutation(value, 1),
      });
      expect(denied.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });
  // These rate-limit tests verify authority across 31 serial PostgreSQL-backed
  // requests, not a five-second performance budget on shared CI runners.
  it("rate limits repeated first-page snapshot materialization by authenticated owner", async () => {
    const app = Fastify();
    await app.register(rateLimit, { global: false });
    app.decorateRequest("auth", null as unknown as AuthContext);
    registerAgentSessionRoutes(app, pool!, async (request) => {
      request.auth = auth;
    });
    app.setErrorHandler((error, request, reply) => {
      const apiError = error as ApiError;
      reply.code(apiError.statusCode ?? 500).send({
        error: {
          code: apiError.code ?? "INTERNAL_ERROR",
          message: apiError.message,
          request_id: request.id,
        },
      });
    });
    try {
      const responses = [];
      for (let index = 0; index < 31; index += 1) {
        responses.push(
          await app.inject({ method: "GET", url: "/v1/agent-sessions?limit=1" }),
        );
      }
      expect(
        [...new Set(responses.map((response) => response.statusCode))],
        responses.map((response) => response.body).join("\n"),
      ).toEqual([200, 429]);
      expect(responses.filter((response) => response.statusCode === 200)).toHaveLength(30);
      expect(responses.filter((response) => response.statusCode === 429)).toHaveLength(1);
    } finally {
      await app.close();
    }
  }, 15_000);
  it("does not charge cursor continuations against the first-page materialization limit", async () => {
    const records = Array.from({ length: 35 }, () => payload());
    await pool!.query(
      `INSERT INTO agent_sessions(
         account_id,id,created_by_user_id,revision,payload,created_at,updated_at,expires_at
       )
       SELECT $1,(entry.value->>'id')::uuid,$2,1,entry.value,
         statement_timestamp(),
         statement_timestamp()-(entry.ordinality * interval '1 millisecond'),
         statement_timestamp()+interval '7 days'
       FROM jsonb_array_elements($3::jsonb) WITH ORDINALITY AS entry(value,ordinality)`,
      [auth.accountId, auth.userId, JSON.stringify(records)],
    );
    const first = await listAgentSessions(pool!, auth, undefined, 1);
    expect(first.next_cursor).toEqual(expect.any(String));

    const app = Fastify();
    await app.register(rateLimit, { global: false });
    app.decorateRequest("auth", null as unknown as AuthContext);
    registerAgentSessionRoutes(app, pool!, async (request) => {
      request.auth = auth;
    });
    app.setErrorHandler((error, request, reply) => {
      const apiError = error as ApiError;
      reply.code(apiError.statusCode ?? 500).send({
        error: {
          code: apiError.code ?? "INTERNAL_ERROR",
          message: apiError.message,
          request_id: request.id,
        },
      });
    });
    try {
      let cursor = first.next_cursor!;
      for (let index = 0; index < 31; index += 1) {
        const response = await app.inject({
          method: "GET",
          url: `/v1/agent-sessions?limit=1&after=${encodeURIComponent(cursor)}`,
        });
        expect(response.statusCode, response.body).toBe(200);
        const page = response.json<{
          complete: boolean;
          next_cursor: string | null;
        }>();
        expect(page.complete).toBe(false);
        expect(page.next_cursor).toEqual(expect.any(String));
        cursor = page.next_cursor!;
      }
    } finally {
      await app.close();
    }
  }, 15_000);
});
