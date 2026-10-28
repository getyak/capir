import { ScriptedAgentProvider, type AgentToolResult } from "@talent-signal/agent";
import { describe, expect, it, vi } from "vitest";
import type { DatabaseClient } from "../database/pool.js";
import type { AuthContext } from "./auth.js";
import { authorizeMemoryDraftTarget, memoryDraftProposalViolation } from "./memoryDraftTarget.js";
import { executeWorkspaceConversationAgentCore, type WorkspaceMemoryLookup } from "./workspaceConversationAgent.js";

const personID = "11111111-1111-4111-8111-111111111111";
const messageID = "22222222-2222-4222-8222-222222222222";
const sessionID = "33333333-3333-4333-8333-333333333333";
const otherID = "44444444-4444-4444-8444-444444444444";
const auth: AuthContext = { accountId: "55555555-5555-4555-8555-555555555555", accountSlug: "draft-test",
  userId: "66666666-6666-4666-8666-666666666666", userEmail: "synthetic@example.test",
  userKind: "simulated_human", sessionId: "77777777-7777-4777-8777-777777777777" };
const target = { personID, messageID, sessionID, displayLabel: "Lin (synthetic)" };
const text = "Lin prefers written agendas before meetings. Prepare a reviewable Memory draft.";
const locator = { kind: "message" as const, session_id: sessionID, message_id: messageID };
const candidate = { scope: "person" as const, operation: "add" as const, statement_kind: "source_statement" as const,
  subject_id: personID, display_text: "Prefers written agendas before meetings", speaker: "Lin",
  source_excerpt: "Lin prefers written agendas before meetings", source_locator: locator,
  time_status: "unknown" as const, sensitivity: "normal" as const, reason: "Current authored text" };
const proposal = { proposalID: "88888888-8888-4888-8888-888888888888", proposalRevision: 1,
  itemCount: 1, defaultSelectedCount: 1, scopeCounts: { self: 0, person: 1, relationship: 0 },
  contactStatus: "resolved" as const, personID, personDisplayLabel: target.displayLabel };
const authority = { sessionId: sessionID, messageId: messageID,
  fence: { accountId: auth.accountId, sessionId: sessionID, entryId: otherID, runId: messageID,
    leaseOwner: "synthetic-worker", leaseGeneration: 1 } };

function admissionStore(options: { targetAvailable?: boolean; sourceText?: string; userID?: string;
  targetID?: string; cancelled?: boolean; revoked?: boolean; expired?: boolean; sourceRevoked?: boolean } = {}) {
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    if (sql.includes("FROM accounts")) return { rows: [{ retired_at: null }] };
    if (sql.includes("SELECT expires_at,deleted_at")) return { rows: [{ deleted_at: null,
      expires_at: new Date(Date.now() + (options.expired ? -60_000 : 60_000)) }] };
    if (sql.includes("SELECT cancel_requested")) return { rows: options.cancelled ? [] : [{ cancel_requested: false }] };
    if (sql.includes("FROM memory_source_revocations")) return { rows: [{ revoked: options.sourceRevoked ?? false }] };
    if (sql.includes("SELECT EXISTS")) return { rows: [{ unavailable: options.revoked ?? false }] };
    if (sql.includes("SELECT memory_draft_target_person_id")) return { rows: [{
      memory_draft_target_person_id: options.targetID ?? personID, message_id: messageID,
      objective: options.sourceText ?? text, created_by_user_id: options.userID ?? auth.userId, host_result: null,
    }] };
    if (sql.includes("FROM subjects")) {
      expect(values).toEqual([auth.accountId, personID]);
      return { rows: options.targetAvailable === false ? [] : [{ display_label: target.displayLabel }] };
    }
    throw new Error("Unexpected query in synthetic admission store");
  });
  return { query, client: { query } as unknown as DatabaseClient };
}

describe("per-message Memory draft target", () => {
  it("reconstructs the exact host admission without authorizing private reads", async () => {
    const { client, query } = admissionStore();
    await expect(authorizeMemoryDraftTarget(client, auth, { personID, messageID, sessionID, runID: messageID,
      sourceText: text, hostAuthority: authority })).resolves.toEqual(target);
    expect(query.mock.calls.every(([sql]) => sql.trim().startsWith("SELECT"))).toBe(true);
    expect(query.mock.calls.some(([sql]) => /memory_items|relationship_contexts/iu.test(sql))).toBe(false);
  });

  it.each([
    ["source changed", { sourceText: "Replacement text" }, "MEMORY_DRAFT_TARGET_ADMISSION_REQUIRED"],
    ["target changed", { targetID: otherID }, "MEMORY_DRAFT_TARGET_ADMISSION_REQUIRED"],
    ["actor changed", { userID: otherID }, "MEMORY_DRAFT_TARGET_ADMISSION_REQUIRED"],
    ["target deleted or outside account", { targetAvailable: false }, "MEMORY_DRAFT_TARGET_UNAVAILABLE"],
    ["source revoked", { revoked: true }, "CONVERSATION_QUEUE_CONTEXT_REVOKED"],
    ["source ledger revoked", { sourceRevoked: true }, "MEMORY_SOURCE_REVOKED"],
    ["session expired", { expired: true }, "AGENT_SESSION_DELETED"],
  ] as const)("rejects admission when %s", async (_name, options, code) => {
    await expect(authorizeMemoryDraftTarget(admissionStore(options).client, auth, { personID, messageID, sessionID,
      runID: messageID, sourceText: text, hostAuthority: authority })).rejects.toMatchObject({ code });
  });

  it("rejects cancelled ownership and an authority from another Run before staging", async () => {
    await expect(authorizeMemoryDraftTarget(admissionStore({ cancelled: true }).client, auth, { personID,
      messageID, sessionID, runID: messageID, sourceText: text, hostAuthority: authority })).rejects.toThrow("CONVERSATION_QUEUE_LEASE_LOST");
    const { client, query } = admissionStore();
    await expect(authorizeMemoryDraftTarget(client, auth, { personID, messageID, sessionID, runID: otherID,
      sourceText: text, hostAuthority: authority })).rejects.toMatchObject({ code: "MEMORY_DRAFT_TARGET_ADMISSION_REQUIRED" });
    expect(query).not.toHaveBeenCalled();
  });

  it("stages current text for the selected Person despite an incidental old image, without recall authority", async () => {
    const stage = vi.fn<WorkspaceMemoryLookup["stage"]>(async () => proposal);
    const recall = vi.fn<WorkspaceMemoryLookup["recall"]>(async () => ({ items: [] }));
    let results: readonly AgentToolResult[] = [];
    const scripted = new ScriptedAgentProvider([
      { tool: "memory_review", input: { operation: "recall", person_id: personID } },
      { tool: "memory_review", input: { operation: "propose", contact_decision: "existing", person_id: personID,
        relationship_context_id: null, items: [candidate] } },
    ], toolResults => { results = toolResults; return { outcome: "reply", title: "Review", body: "Draft ready for your review." }; });
    const run = vi.spyOn(scripted, "run");
    const output = await executeWorkspaceConversationAgentCore({ objective: text, sourceText: text, messageID, sessionID,
      workspaceID: auth.accountId, memoryDraftTarget: target, contacts: { search: vi.fn(), read: vi.fn() },
      conversationHistory: [{ message_id: otherID, role: "assistant", text: "Earlier private saved Memory" }],
      messageSources: new Map([[otherID, "Earlier private message"]]),
      memory: { stage, recall }, inputParts: [{ kind: "image", artifactID: `conversation-image-${otherID}-0-old`,
        mimeType: "image/png", byteSize: 3, contentHash: "a".repeat(64), dataBase64: "AAAA" }],
      provider: scripted,
    });
    expect(results[0]).toMatchObject({ ok: false, error: { code: "MEMORY_RECALL_NOT_AUTHORIZED" } });
    expect(results[1]).toMatchObject({ ok: true, data: { item_count: 1, contact_status: "resolved" } });
    expect(recall).not.toHaveBeenCalled();
    expect(run.mock.calls[0]?.[0]).toMatchObject({ conversationHistory: [], toolManifest: ["memory_review"], supplementalTools: [] });
    expect(run.mock.calls[0]?.[0]).not.toHaveProperty("selfMemoryContext");
    expect(run.mock.calls[0]?.[0]).not.toHaveProperty("inputParts");
    expect(stage).toHaveBeenCalledWith(expect.objectContaining({ personID, contextID: null,
      contactDecision: "existing", identityAuthority: "human_selection", newContact: null,
      sourceMessageID: messageID, sourceText: text, items: [candidate] }));
    expect(output.memoryProposal?.proposal_id).toBe(proposal.proposalID);
  });

  it("asks for current concrete text instead of recalling self Memory or opening private contact context", async () => {
    const recall = vi.fn<WorkspaceMemoryLookup["recall"]>(), stage = vi.fn<WorkspaceMemoryLookup["stage"]>();
    const search = vi.fn(), read = vi.fn(); let results: readonly AgentToolResult[] = [];
    const output = await executeWorkspaceConversationAgentCore({ objective: "记住刚才的事", messageID, sessionID,
      workspaceID: auth.accountId, memoryDraftTarget: target, contacts: { search, read }, memory: { recall, stage },
      provider: new ScriptedAgentProvider([
        { tool: "memory_review", input: { operation: "recall", scope: "self" } },
        { tool: "contact_workspace", input: { operation: "search", query: "Lin" } },
      ], toolResults => { results = toolResults; return { outcome: "clarification", title: "补充文字", body: "请在这条消息里写出要整理的具体内容。" }; }),
    });
    expect(results[0]).toMatchObject({ ok: false, error: { code: "MEMORY_RECALL_NOT_AUTHORIZED" } });
    expect(results[1]).toMatchObject({ ok: false, error: { code: "MEMORY_DRAFT_TARGET_TEXT_ONLY" } });
    expect(recall).not.toHaveBeenCalled(); expect(stage).not.toHaveBeenCalled();
    expect(search).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
    expect(output.memoryProposal).toBeNull();
    expect(output.block.body).toContain("具体内容");
  });

  it.each([
    ["new contact", { contact_decision: "new", person_id: null }, "MEMORY_DRAFT_TARGET_SCOPE_MISMATCH"],
    ["different person", { person_id: otherID }, "MEMORY_DRAFT_TARGET_SCOPE_MISMATCH"],
    ["relationship", { relationship_context_id: otherID }, "MEMORY_DRAFT_TARGET_SCOPE_MISMATCH"],
    ["empty contact card", { person_id: null, contact_decision: "new", person_display_label: "Lin",
      new_contact_source_locator: locator, items: [] }, "MEMORY_DRAFT_TARGET_SOURCE_MISMATCH"],
    ["self memory", { items: [{ ...candidate, scope: "self" }] }, "MEMORY_DRAFT_TARGET_SCOPE_MISMATCH"],
    ["other subject dependence", { items: [{ ...candidate, subject_id: otherID }] }, "MEMORY_DRAFT_TARGET_SCOPE_MISMATCH"],
    ["old message", { items: [{ ...candidate, source_locator: { ...locator, message_id: otherID } }] }, "MEMORY_DRAFT_TARGET_SOURCE_MISMATCH"],
    ["old image", { items: [{ ...candidate, source_locator: { kind: "image_region", artifact_id: `conversation-image-${otherID}-0-old` } }] }, "MEMORY_DRAFT_TARGET_SOURCE_MISMATCH"],
  ])("fails recoverably for %s instead of returning an unrelated draft", async (_name, replacement, code) => {
    const stage = vi.fn<WorkspaceMemoryLookup["stage"]>();
    let result: AgentToolResult | undefined;
    await expect(executeWorkspaceConversationAgentCore({ objective: text, messageID, sessionID, workspaceID: auth.accountId,
      memoryDraftTarget: target, contacts: { search: vi.fn(), read: vi.fn() }, memory: { stage, recall: async () => ({ items: [] }) },
      provider: new ScriptedAgentProvider([{ tool: "memory_review", input: { operation: "propose",
        person_id: personID, relationship_context_id: null, contact_decision: "existing", items: [candidate], ...replacement } }],
      results => { result = results[0]; return { outcome: "reply", title: "Done", body: "Pretended success" }; }),
    })).rejects.toMatchObject({ code: "MEMORY_DRAFT_TARGET_NOT_STAGED" });
    expect(result).toMatchObject({ ok: false, error: { code } });
    expect(stage).not.toHaveBeenCalled();
  });

  it("rejects an incorrect staging receipt and does not present it as success", async () => {
    await expect(executeWorkspaceConversationAgentCore({ objective: text, messageID, sessionID, workspaceID: auth.accountId,
      memoryDraftTarget: target, contacts: { search: vi.fn(), read: vi.fn() }, memory: {
        recall: async () => ({ items: [] }), stage: async () => ({ ...proposal, personID: otherID }),
      }, provider: new ScriptedAgentProvider([{ tool: "memory_review", input: { operation: "propose", person_id: personID,
        contact_decision: "existing", items: [candidate] } }], { outcome: "reply", title: "Draft", body: "Draft" }),
    })).rejects.toMatchObject({ code: "MEMORY_DRAFT_TARGET_NOT_STAGED" });
  });

  it("does not let relationship dependence borrow the selected person admission", () => {
    expect(memoryDraftProposalViolation(target, { personID, contextID: null, contactDecision: "existing",
      items: [{ ...candidate, dependence_kind: "relationship" }] })).toBe("MEMORY_DRAFT_TARGET_SCOPE_MISMATCH");
  });
});
