import { randomUUID } from "node:crypto";

import { CONTRACT_VERSION } from "@talent-signal/contracts";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { inTransaction } from "../database/pool.js";
import type { AuthContext } from "./auth.js";
import { admitConversationQueueEntry } from "./conversationQueueAdmission.js";
import { claimConversationQueueSteeringMembers, claimNextConversationQueueEntry } from "./conversationQueueState.js";
import { withdrawMemoryProposalForRun } from "./memoryProposalWithdrawal.js";
import {
  commitMemoryReview,
  openMemoryReview,
  resolveSessionSourceAuthority,
  stageMemoryProposal,
} from "./memoryReview.js";
import {
  proposeMcpChoice,
  proposeMcpConnection,
  proposeMcpToolCall,
  readMcpInteraction,
  resolveMcpInteraction,
  withdrawMcpProposalsForRun,
  type McpStagingAuthority,
} from "./mcpInteractions.js";

const url = process.env.CONTACT_AGENT_TEST_DATABASE_URL;
if (url && !["127.0.0.1", "localhost"].includes(new URL(url).hostname)) {
  throw new Error("Use an isolated local PostgreSQL database for proposal withdrawal tests.");
}
const pool = url ? new Pool({ connectionString: url, idleTimeoutMillis: 0, max: 4 }) : null;
const suite = url ? describe : describe.skip;
const objective = "以后请先给结论，再列依据。";

beforeAll(async () => {
  if (pool) await pool.query("SELECT 1 FROM conversation_queue_entries LIMIT 1");
});
afterAll(async () => { await pool?.end(); });

async function fixture(existingAuth?: AuthContext, sourceText = objective) {
  const auth: AuthContext = existingAuth ?? {
    accountId: randomUUID(), accountSlug: `withdraw-${randomUUID()}`,
    userId: randomUUID(), userEmail: `${randomUUID()}@synthetic.local`,
    userKind: "simulated_human", sessionId: randomUUID(),
  };
  if (!existingAuth) {
    await pool!.query("INSERT INTO accounts(id,slug,name) VALUES($1,$2,'Withdrawal proof')", [auth.accountId, auth.accountSlug]);
    await pool!.query("INSERT INTO users(id,account_id,email,display_name,kind) VALUES($1,$2,$3,'Synthetic owner','simulated_human')",
      [auth.userId, auth.accountId, auth.userEmail]);
    await pool!.query("INSERT INTO sessions(id,account_id,user_id,token_hash,client_label,expires_at) VALUES($1,$2,$3,$4,'synthetic',now()+interval '1 hour')",
      [auth.sessionId, auth.accountId, auth.userId, randomUUID()]);
  }
  const sessionID = randomUUID(), messageID = randomUUID(), now = new Date().toISOString();
  await pool!.query(`INSERT INTO agent_sessions(account_id,id,created_by_user_id,revision,payload,created_at,expires_at)
    VALUES($1,$2,$3,1,$4::jsonb,now(),now()+interval '7 days')`, [auth.accountId, sessionID, auth.userId, JSON.stringify({
    id: sessionID, scopeKind: "unresolved_intent", personDisplayLabel: "", contextDisplayLabel: "", title: "Withdrawal proof",
    updatedAt: now, isUnread: false, turns: [{ id: messageID, objective: sourceText, createdAt: now, response: {
      contractVersion: CONTRACT_VERSION, taskID: randomUUID(), contextManifestID: "", knowledgeSnapshotID: "", disposition: "answer", createdAt: now,
    } }],
  })]);
  await admitConversationQueueEntry(pool!, auth, { session_id: sessionID, message_id: messageID, objective: sourceText, idempotency_key: randomUUID() });
  const claim = await claimNextConversationQueueEntry(pool!, { accountId: auth.accountId, sessionId: sessionID, workerId: randomUUID(), acceptsSteering: true });
  if (!claim) throw new Error("The synthetic run was not claimed");
  const authority: McpStagingAuthority = { fence: claim, sessionId: sessionID, messageId: messageID };
  return { auth, sessionID, messageID, authority };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;
async function memory(f: Fixture, sourceMessageID = f.messageID) {
  const source = await resolveSessionSourceAuthority(pool!, f.auth, f.sessionID, sourceMessageID);
  const staged = await inTransaction(pool!, client => stageMemoryProposal(client, f.auth, {
    idempotency_key: randomUUID(), surface: "chat", session_id: f.sessionID,
    source_task_id: f.authority.fence.runId, source_message_id: sourceMessageID,
    person_id: null, relationship_context_id: null, contact_decision: "none", new_contact: null,
    proposer: { kind: "agent", name: "workspace-conversation", version: "1" },
    items: [{ scope: "self", operation: "add", statement_kind: "source_statement", display_text: "回复先给结论，再列依据",
      source_excerpt: objective, source_locator: { kind: "message", session_id: f.sessionID, message_id: sourceMessageID },
      speaker: "self", time_status: "known", sensitivity: "normal", reason: "Explicit future reply preference" }],
  }, source));
  if (!staged) throw new Error("The synthetic Memory was not staged");
  return staged.proposal;
}
async function choice(f: Fixture) {
  return (await proposeMcpChoice(pool!, f.auth, { session_id: f.sessionID, message_id: f.messageID,
    idempotency_key: randomUUID(), purpose: "Synthetic next-step choice", options: [{ id: "one", label: "One" }, { id: "two", label: "Two" }],
  }, {}, f.authority)).request;
}

suite("host withdrawal of this run's pending proposals", () => {
  it("dismisses this run's Memory durably and leaves another run's Memory reviewable", async () => {
    const f = await fixture(), other = await fixture(f.auth), proposed = await memory(f), untouched = await memory(other);
    const opened = await openMemoryReview(pool!, f.auth, proposed.proposal_id, { purpose: "chat", session_id: f.sessionID });
    expect(await withdrawMemoryProposalForRun(pool!, f.auth, { proposalID: proposed.proposal_id, expectedRevision: proposed.revision,
      sourceMessageID: f.messageID, authority: f.authority })).toMatchObject({ status: "withdrawn", proposalID: proposed.proposal_id });
    expect((await pool!.query("SELECT status FROM memory_proposals WHERE id=$1", [proposed.proposal_id])).rows[0]?.status).toBe("dismissed");
    expect((await pool!.query("SELECT status FROM memory_proposal_items WHERE proposal_id=$1", [proposed.proposal_id])).rows).toEqual([{ status: "skipped" }]);
    await expect(commitMemoryReview(pool!, f.auth, opened.review.review_scope_id, opened.review_credential!, {
      idempotency_key: randomUUID(), expected_proposal_revision: opened.review.proposal_revision,
      contact_decision: "none", selected_item_ids: opened.review.items.map(item => item.id), edited_text: {}, item_decisions: {},
      expected_item_versions: {}, new_contact: null, reason: "Must not commit a withdrawn proposal",
    })).rejects.toMatchObject({ statusCode: 409 });
    expect((await openMemoryReview(pool!, other.auth, untouched.proposal_id, { purpose: "chat" })).review.items).toHaveLength(1);
    expect((await pool!.query("SELECT metadata FROM audit_events WHERE account_id=$1 AND event_type='memory.proposal_withdrawn'", [f.auth.accountId])).rows)
      .toEqual([expect.objectContaining({ metadata: expect.objectContaining({ source_task_id: f.authority.fence.runId, external_effect_count: 0 }) })]);
    expect((await pool!.query("SELECT id FROM memory_items WHERE account_id=$1", [f.auth.accountId])).rowCount).toBe(0);
  });

  it("rejects a stale revision, foreign run or expired lease without altering Memory", async () => {
    const f = await fixture(), proposed = await memory(f), other = await fixture(f.auth);
    const request = { proposalID: proposed.proposal_id, expectedRevision: proposed.revision, sourceMessageID: f.messageID, authority: f.authority };
    await expect(withdrawMemoryProposalForRun(pool!, f.auth, { ...request, expectedRevision: proposed.revision + 1 })).rejects.toMatchObject({ statusCode: 409 });
    await expect(withdrawMemoryProposalForRun(pool!, f.auth, { ...request, authority: other.authority })).rejects.toMatchObject({ statusCode: 409 });
    await pool!.query("UPDATE conversation_queue_entries SET lease_expires_at=now()-interval '1 second' WHERE id=$1", [f.authority.fence.entryId]);
    await expect(withdrawMemoryProposalForRun(pool!, f.auth, request)).rejects.toBeDefined();
    expect((await pool!.query("SELECT status FROM memory_proposals WHERE id=$1", [proposed.proposal_id])).rows[0]?.status).toBe("open");
  });

  it("closes an open review after self Memory was saved without undoing that Memory", async () => {
    const f = await fixture(), proposed = await memory(f);
    const opened = await openMemoryReview(pool!, f.auth, proposed.proposal_id, { purpose: "chat" });
    await commitMemoryReview(pool!, f.auth, opened.review.review_scope_id, opened.review_credential!, {
      idempotency_key: randomUUID(), expected_proposal_revision: opened.review.proposal_revision,
      contact_decision: "none", selected_item_ids: opened.review.items.map(item => item.id), edited_text: {}, item_decisions: {},
      expected_item_versions: {}, new_contact: null, reason: "Explicit synthetic human approval",
    });
    expect(await withdrawMemoryProposalForRun(pool!, f.auth, { proposalID: proposed.proposal_id, expectedRevision: proposed.revision,
      sourceMessageID: f.messageID, authority: f.authority })).toMatchObject({ status: "withdrawn", hadCommittedItems: true });
    expect((await pool!.query("SELECT status FROM memory_items WHERE account_id=$1", [f.auth.accountId])).rows).toEqual([{ status: "active" }]);
  });

  it("closes the pending contact after a self-only save and preserves the exact saved items and commit", async () => {
    const f = await fixture(undefined, `${objective}请添加联系人阿禾。`);
    const source = await resolveSessionSourceAuthority(pool!, f.auth, f.sessionID, f.messageID);
    const staged = await inTransaction(pool!, client => stageMemoryProposal(client, f.auth, {
      idempotency_key: randomUUID(), surface: "chat", session_id: f.sessionID, source_message_id: f.messageID,
      source_task_id: f.authority.fence.runId, person_id: null, relationship_context_id: null,
      contact_decision: "new", new_contact: { display_label: "阿禾", relationship_context: "" },
      proposer: { kind: "agent", name: "workspace-conversation", version: "1" }, items: [{
        scope: "self", operation: "add", statement_kind: "source_statement", display_text: "回复先给结论，再列依据",
        source_excerpt: objective, source_locator: { kind: "message", session_id: f.sessionID, message_id: f.messageID },
        speaker: "self", time_status: "known", sensitivity: "normal", reason: "Explicit future reply preference",
      }],
    }, source));
    const proposal = staged!.proposal;
    const opened = await openMemoryReview(pool!, f.auth, proposal.proposal_id, { purpose: "chat" });
    await commitMemoryReview(pool!, f.auth, opened.review.review_scope_id, opened.review_credential!, {
      idempotency_key: randomUUID(), expected_proposal_revision: opened.review.proposal_revision,
      contact_decision: "none", selected_item_ids: opened.review.items.map(item => item.id), edited_text: {}, item_decisions: {},
      expected_item_versions: {}, new_contact: null, reason: "Save only the self preference; leave contact undecided",
    });
    expect((await pool!.query("SELECT status,revision,contact_decision FROM memory_proposals WHERE id=$1", [proposal.proposal_id])).rows)
      .toEqual([{ status: "open", revision: proposal.revision, contact_decision: "new" }]);
    const savedItems = (await pool!.query("SELECT * FROM memory_items WHERE account_id=$1 ORDER BY id", [f.auth.accountId])).rows;
    const savedCommits = (await pool!.query("SELECT * FROM memory_commits WHERE account_id=$1 ORDER BY id", [f.auth.accountId])).rows;
    expect(savedItems).toHaveLength(1);
    expect(savedCommits).toHaveLength(1);

    expect(await withdrawMemoryProposalForRun(pool!, f.auth, { proposalID: proposal.proposal_id,
      expectedRevision: proposal.revision, sourceMessageID: f.messageID, authority: f.authority }))
      .toMatchObject({ status: "withdrawn", hadCommittedItems: true });
    await expect(commitMemoryReview(pool!, f.auth, opened.review.review_scope_id, opened.review_credential!, {
      idempotency_key: randomUUID(), expected_proposal_revision: opened.review.proposal_revision,
      contact_decision: "new", selected_item_ids: [], edited_text: {}, item_decisions: {}, expected_item_versions: {},
      new_contact: { display_label: "阿禾", relationship_context: "" }, reason: "The old card must not create a contact",
    })).rejects.toMatchObject({ code: "MEMORY_PROPOSAL_CLOSED" });
    expect((await pool!.query("SELECT * FROM memory_items WHERE account_id=$1 ORDER BY id", [f.auth.accountId])).rows).toEqual(savedItems);
    expect((await pool!.query("SELECT * FROM memory_commits WHERE account_id=$1 ORDER BY id", [f.auth.accountId])).rows).toEqual(savedCommits);
    expect((await pool!.query("SELECT id FROM subjects WHERE account_id=$1 AND display_label='阿禾'", [f.auth.accountId])).rowCount).toBe(0);
  });

  it("closes a zero-item contact-only proposal without creating or deleting a person", async () => {
    const f = await fixture(undefined, "请添加联系人阿禾。");
    const source = await resolveSessionSourceAuthority(pool!, f.auth, f.sessionID, f.messageID);
    const staged = await inTransaction(pool!, client => stageMemoryProposal(client, f.auth, {
      idempotency_key: randomUUID(), surface: "chat", session_id: f.sessionID, source_message_id: f.messageID,
      source_task_id: f.authority.fence.runId, person_id: null, relationship_context_id: null,
      contact_decision: "new", new_contact: { display_label: "阿禾", relationship_context: "" },
      proposer: { kind: "agent", name: "workspace-conversation", version: "1" }, items: [],
    }, source));
    expect(staged?.proposal.item_count).toBe(0);
    const subjectsBefore = (await pool!.query("SELECT id FROM subjects WHERE account_id=$1", [f.auth.accountId])).rows;
    expect(await inTransaction(pool!, client => withdrawMemoryProposalForRun(client, f.auth, {
      proposalID: staged!.proposal.proposal_id, expectedRevision: staged!.proposal.revision,
      sourceMessageID: f.messageID, authority: f.authority,
    }))).toMatchObject({ status: "withdrawn" });
    await expect(openMemoryReview(pool!, f.auth, staged!.proposal.proposal_id, { purpose: "chat" })).rejects.toMatchObject({ code: "MEMORY_REVIEW_DISMISSED" });
    expect((await pool!.query("SELECT id FROM subjects WHERE account_id=$1", [f.auth.accountId])).rows).toEqual(subjectsBefore);
  });

  it("permits a consumed steering source but refuses an awaiting message as withdrawal authority", async () => {
    const f = await fixture(), sourceMessageID = randomUUID();
    const admission = await admitConversationQueueEntry(pool!, f.auth, { session_id: f.sessionID, message_id: sourceMessageID,
      objective, idempotency_key: randomUUID() });
    // Persist a source readback for the domain producer; the live queue still
    // independently decides whether this source was consumed by this Run.
    await pool!.query(`UPDATE agent_sessions SET payload=jsonb_set(payload,'{turns}',(payload->'turns') || $3::jsonb)
      WHERE account_id=$1 AND id=$2`, [f.auth.accountId, f.sessionID, JSON.stringify([{ id: sourceMessageID, objective,
      createdAt: new Date().toISOString(), response: { contractVersion: CONTRACT_VERSION, taskID: randomUUID(),
        contextManifestID: "", knowledgeSnapshotID: "", disposition: "answer", createdAt: new Date().toISOString() } }])]);
    const proposed = await memory(f, sourceMessageID);
    const request = { proposalID: proposed.proposal_id, expectedRevision: proposed.revision, sourceMessageID, authority: f.authority };
    await expect(withdrawMemoryProposalForRun(pool!, f.auth, request)).rejects.toMatchObject({ code: "PROPOSAL_WITHDRAWAL_SCOPE_MISMATCH" });
    const members = await claimConversationQueueSteeringMembers(pool!, f.authority.fence, [admission.response.queue_entry_id]);
    expect(members.map(member => member.messageId)).toEqual([sourceMessageID]);
    expect(await withdrawMemoryProposalForRun(pool!, f.auth, request)).toMatchObject({ status: "withdrawn" });
  });

  it("rejects two exact MCP cards without affecting another run or creating continuation work", async () => {
    const f = await fixture(), other = await fixture(f.auth), first = await choice(f), second = await choice(f), untouched = await choice(other);
    const response = await withdrawMcpProposalsForRun(pool!, f.auth, { authority: f.authority,
      requests: [first, second].map(request => ({ requestID: request.id, expectedRevision: request.revision })) });
    expect(response.requests.map(request => ({ requestID: request.requestID, state: request.state, status: request.status }))).toEqual([
      { requestID: first.id, state: "rejected", status: "withdrawn" }, { requestID: second.id, state: "rejected", status: "withdrawn" },
    ]);
    for (const request of [first, second]) {
      expect((await readMcpInteraction(pool!, f.auth, request.id)).request.state).toBe("rejected");
      await expect(resolveMcpInteraction(pool!, f.auth, request.id, { action: "submit", choice_id: "one",
        expected_revision: request.revision + 1, idempotency_key: randomUUID() }, {})).rejects.toMatchObject({ code: "MCP_INTERACTION_NOT_PENDING" });
    }
    expect((await readMcpInteraction(pool!, f.auth, untouched.id)).request.state).toBe("pending");
    expect((await pool!.query("SELECT request_id FROM mcp_continuation_outbox WHERE account_id=$1", [f.auth.accountId])).rowCount).toBe(0);
    expect((await pool!.query("SELECT id FROM audit_events WHERE account_id=$1 AND event_type='mcp_interaction.rejected'", [f.auth.accountId])).rowCount).toBe(2);
  });

  it("rolls the whole MCP withdrawal back when any requested card belongs to another run", async () => {
    const f = await fixture(), other = await fixture(f.auth), first = await choice(f), untouched = await choice(other);
    await expect(withdrawMcpProposalsForRun(pool!, f.auth, { authority: f.authority,
      requests: [first, untouched].map(request => ({ requestID: request.id, expectedRevision: request.revision })) })).rejects.toMatchObject({ statusCode: 409 });
    expect((await readMcpInteraction(pool!, f.auth, first.id)).request.state).toBe("pending");
    expect((await readMcpInteraction(pool!, f.auth, untouched.id)).request.state).toBe("pending");
  });

  it("does not change either MCP card when the second revision is stale", async () => {
    const f = await fixture(), first = await choice(f), second = await choice(f);
    await expect(withdrawMcpProposalsForRun(pool!, f.auth, { authority: f.authority, requests: [
      { requestID: first.id, expectedRevision: first.revision }, { requestID: second.id, expectedRevision: second.revision + 1 },
    ] })).rejects.toMatchObject({ code: "MCP_INTERACTION_CHANGED" });
    expect((await readMcpInteraction(pool!, f.auth, first.id)).request.state).toBe("pending");
    expect((await readMcpInteraction(pool!, f.auth, second.id)).request.state).toBe("pending");
  });

  it("honors the caller's PoolClient transaction and preserves submitted MCP decisions", async () => {
    const f = await fixture(), first = await choice(f), submitted = await choice(f);
    await resolveMcpInteraction(pool!, f.auth, submitted.id, { action: "submit", choice_id: "one", expected_revision: submitted.revision, idempotency_key: randomUUID() }, {});
    const client = await pool!.connect();
    try {
      await client.query("BEGIN");
      const response = await withdrawMcpProposalsForRun(client, f.auth, { authority: f.authority,
        requests: [{ requestID: first.id, expectedRevision: first.revision }, { requestID: submitted.id, expectedRevision: submitted.revision }] });
      expect(response.requests.map(request => request.status)).toEqual(["withdrawn", "already_submitted"]);
      await client.query("ROLLBACK");
    } finally { client.release(); }
    expect((await readMcpInteraction(pool!, f.auth, first.id)).request.state).toBe("pending");
    expect((await readMcpInteraction(pool!, f.auth, submitted.id)).request.state).toBe("submitted");
  });

  it("does not misreport an already dispatched MCP call as withdrawn", async () => {
    const f = await fixture(), connectionID = randomUUID();
    await pool!.query(`INSERT INTO mcp_connections(account_id,id,created_by_user_id,friendly_name,server_url,
      status,discovered_tools,tools_count,revision,auth_mode)
      VALUES($1,$2,$3,'Synthetic tool','https://tools.example.test/mcp','verified',$4,1,1,'anonymous')`,
    [f.auth.accountId, connectionID, f.auth.userId, JSON.stringify([{ name: "lookup", description: "Synthetic lookup", read_only: true,
      input_schema: JSON.stringify({ type: "object", properties: {}, additionalProperties: false }) }])]);
    let started!: () => void, release!: () => void;
    const dispatched = new Promise<void>(resolve => { started = resolve; });
    const complete = new Promise<void>(resolve => { release = resolve; });
    const dependencies = {
      resolver: async () => [{ address: "8.8.8.8", family: 4 as const }],
      performCall: async () => { started(); await complete; return { effectSent: true, errorCode: null, isError: false,
        jsonrpcError: false, protocolVersion: "2025-11-25", resultText: JSON.stringify({ content: [] }), status: "succeeded" as const }; },
    };
    const staged = (await proposeMcpToolCall(pool!, f.auth, { connection_id: connectionID, tool_name: "lookup", arguments: "{}",
      purpose: "Synthetic dispatched call", session_id: f.sessionID, message_id: f.messageID, idempotency_key: randomUUID(),
    }, dependencies, f.authority)).request;
    const resolution = resolveMcpInteraction(pool!, f.auth, staged.id, { action: "approve", expected_revision: staged.revision,
      idempotency_key: randomUUID() }, dependencies);
    let dispatchTimeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([dispatched, new Promise<never>((_resolve, reject) => {
        dispatchTimeout = setTimeout(() => reject(new Error("The synthetic approved call never dispatched")), 2_000);
      })]);
      const withdrawal = await withdrawMcpProposalsForRun(pool!, f.auth, { authority: f.authority,
        requests: [{ requestID: staged.id, expectedRevision: staged.revision }] });
      expect(withdrawal.requests).toEqual([expect.objectContaining({ requestID: staged.id, state: "submitting", status: "already_submitted" })]);
    } finally { clearTimeout(dispatchTimeout); release(); await resolution; }
    expect((await pool!.query("SELECT state FROM mcp_tool_calls WHERE account_id=$1 AND request_id=$2", [f.auth.accountId, staged.id])).rows)
      .toEqual([{ state: "succeeded" }]);
  });

  it("retains durable OAuth cleanup when a pending connect card is withdrawn", async () => {
    const f = await fixture();
    const staged = await proposeMcpConnection(pool!, f.auth, { auth_mode: "oauth", friendly_name: "Synthetic OAuth",
      idempotency_key: randomUUID(), purpose: "Test cancellation before grant", server_url: "https://oauth.example.test/mcp",
      session_id: f.sessionID, message_id: f.messageID }, {
      resolver: async () => [{ address: "8.8.8.8", family: 4 }],
      nangoConfig: { apiKey: "synthetic", baseUrl: "https://api.nango.dev", environment: "DEV", webhookSigningKey: "synthetic" },
      fetcher: async () => new Response(JSON.stringify({ data: { connect_link: "https://connect.example.test/ui",
        expires_at: new Date(Date.now() + 1_800_000).toISOString(), token: "synthetic" } }), { status: 201 }),
    }, f.authority);
    await withdrawMcpProposalsForRun(pool!, f.auth, { authority: f.authority,
      requests: [{ requestID: staged.request.id, expectedRevision: staged.request.revision }] });
    expect((await pool!.query("SELECT state FROM mcp_oauth_connect_requests WHERE account_id=$1 AND id=$2", [f.auth.accountId, staged.request.id])).rows)
      .toEqual([{ state: "failed" }]);
    expect((await pool!.query("SELECT provenance FROM mcp_oauth_cleanup WHERE account_id=$1", [f.auth.accountId])).rows)
      .toEqual([{ provenance: "withdrawn" }]);
    expect((await pool!.query("SELECT request_id FROM mcp_continuation_outbox WHERE account_id=$1", [f.auth.accountId])).rowCount).toBe(0);
  });
});
