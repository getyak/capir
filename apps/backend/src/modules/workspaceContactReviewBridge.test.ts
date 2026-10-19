import { describe, expect, it, vi } from "vitest";
import { ScriptedAgentProvider } from "@talent-signal/agent";
import { executeWorkspaceConversationAgentCore, type WorkspaceMemoryLookup } from "./workspaceConversationAgent.js";

const messageID = "77777777-7777-4777-8777-777777777777";
const sessionID = "77777777-7777-4777-8777-777777777778";
const proposalID = "77777777-7777-4777-8777-777777777779";
const objective = "Create Maya Chen with maya@example.com. Do not search the web.";
const draft = { operation: "propose_create", display_name: "Maya Chen", relationship_context: "",
  identity_clue: { type: "email", value: "maya@example.com" }, source_excerpts: ["Maya Chen", "maya@example.com"], reason: "Explicit contact request" };
const staged = { proposalID, proposalRevision: 1, itemCount: 2, defaultSelectedCount: 1,
  scopeCounts: { self: 0, person: 2, relationship: 0 }, contactStatus: "pending" as const,
  personID: null, personDisplayLabel: "Maya Chen" };
const provider = (fingerprint?: string) => new ScriptedAgentProvider([{ tool: "contact_workspace", input: draft }], results => ({
  outcome: "contact_change_proposal", candidate_fingerprint: fingerprint ?? results[0]?.candidateFingerprint,
}));
function fixture() {
  const stage = vi.fn<WorkspaceMemoryLookup["stage"]>(async () => staged);
  const withdraw = vi.fn(async () => ({ proposalID, revision: 2, status: "withdrawn" as const }));
  const memory = { recall: async () => ({ items: [] }), stage, withdraw };
  const input = { workspaceID: "synthetic", messageID, sessionID, objective,
    contacts: { search: vi.fn(async () => []), read: vi.fn() }, memory, provider: provider() };
  return { input, stage, withdraw };
}

describe("queue contact proposals use the existing durable review", () => {
  it("returns one review reference with tentative, source-bound name and sensitive clue", async () => {
    const { input, stage } = fixture();
    const result = await executeWorkspaceConversationAgentCore({ ...input, contactReviewSurface: "memory" });
    expect(result.memoryProposal).toEqual({ proposal_id: proposalID, revision: 1 });
    expect(result.event).toBeNull();
    expect(stage).toHaveBeenCalledOnce();
    expect(stage.mock.calls[0]![0]).toMatchObject({ contactDecision: "new", identityAuthority: "tentative",
      identityClue: null, sourceMessageID: messageID, sourceText: objective,
      newContact: { display_label: "Maya Chen", source_locator: { kind: "message", session_id: sessionID, message_id: messageID } },
      items: [expect.objectContaining({ statement_kind: "source_statement", sensitivity: "sensitive", source_excerpt: "maya@example.com",
        source_locator: { kind: "message", session_id: sessionID, message_id: messageID } })],
      nameCandidate: expect.objectContaining({ statement_kind: "source_statement", source_excerpt: "Maya Chen" }),
    });
  });

  it("binds repeated contact excerpts to the current message before matching history", async () => {
    const { input, stage } = fixture();
    const oldID = "77777777-7777-4777-8777-777777777780";
    const sources = new Map([[messageID, objective], [oldID, objective]]);
    await executeWorkspaceConversationAgentCore({ ...input, messageSources: sources, contactReviewSurface: "memory" });
    expect(stage).toHaveBeenCalledOnce();
    expect(stage.mock.calls[0]![0].sourceMessageID).toBe(messageID);
    expect(stage.mock.calls[0]![0].newContact?.source_locator).toMatchObject({ message_id: messageID });
  });

  it("keeps an authored relationship context as an unconfirmed source statement", async () => {
    const { input, stage } = fixture();
    await executeWorkspaceConversationAgentCore({ ...input, objective: objective + " We discussed Acme.", contactReviewSurface: "memory",
      provider: new ScriptedAgentProvider([{ tool: "contact_workspace", input: { ...draft, relationship_context: "Acme",
        source_excerpts: [...draft.source_excerpts, "Acme"] } }], results => ({ outcome: "contact_change_proposal", candidate_fingerprint: results[0]?.candidateFingerprint })),
    });
    expect(stage.mock.calls[0]![0].items).toEqual(expect.arrayContaining([expect.objectContaining({ scope: "relationship",
      statement_kind: "source_statement", source_excerpt: "Acme", source_locator: expect.objectContaining({ message_id: messageID }) })]));
  });

  it("preserves the synchronous native proposal without a second approval path", async () => {
    const { input, stage } = fixture();
    const result = await executeWorkspaceConversationAgentCore(input);
    expect(result.event?.kind).toBe("contact_change_proposal");
    expect(result.memoryProposal).toBeNull(); expect(stage).not.toHaveBeenCalled();
  });

  it("does not stage a forged terminal fingerprint", async () => {
    const { input, stage } = fixture();
    await expect(executeWorkspaceConversationAgentCore({ ...input, contactReviewSurface: "memory", provider: provider("0".repeat(64)) })).rejects.toThrow("same-Run Tool candidate");
    expect(stage).not.toHaveBeenCalled();
  });

  it.each(["empty", "throw"])("reports unavailable review honestly when staging is %s", async kind => {
    const { input, stage } = fixture();
    stage.mockImplementationOnce(async () => { if (kind === "throw") throw Error("synthetic staging outage"); return null; });
    const result = await executeWorkspaceConversationAgentCore({ ...input, contactReviewSurface: "memory" });
    expect(result.memoryProposal).toBeNull(); expect(result.event).toBeNull();
    expect(result.block.body).not.toContain("I prepared a review card");
    expect(result.block.body).toContain("unavailable");
  });

  it.each(["不要保存联系人", "请勿保存联系人", "No contact creation"])("withdraws the exact proposal when %s arrives during staging", async refusal => {
    const { input, stage, withdraw } = fixture(); const sources = new Map([[messageID, objective]]);
    stage.mockImplementationOnce(async () => { sources.set("77777777-7777-4777-8777-777777777780", refusal); return staged; });
    const result = await executeWorkspaceConversationAgentCore({ ...input, messageSources: sources, contactReviewSurface: "memory" });
    expect(withdraw).toHaveBeenCalledExactlyOnceWith({ proposalID, expectedRevision: 1, sourceMessageID: messageID });
    expect(result.memoryProposal).toBeNull(); expect(result.event).toBeNull();
  });

  it("does not replace an already staged review with a second contact card", async () => {
    const { input, stage } = fixture();
    const result = await executeWorkspaceConversationAgentCore({ ...input, contactReviewSurface: "memory",
      provider: new ScriptedAgentProvider([
        { tool: "memory_review", input: { operation: "propose", contact_decision: "new", person_display_label: "Maya Chen",
          new_contact_source_locator: { kind: "message", session_id: sessionID, message_id: messageID }, items: [] } },
        { tool: "contact_workspace", input: draft },
      ], results => ({ outcome: "contact_change_proposal", candidate_fingerprint: results[1]?.candidateFingerprint })),
    });
    expect(stage).toHaveBeenCalledOnce(); expect(result.memoryProposal).toEqual({ proposal_id: proposalID, revision: 1 });
    expect(result.event).toBeNull(); expect(result.block.body).toContain("已有一张待确认卡片");
  });

  it("does not stage after the original contact source was replaced", async () => {
    const { input, stage } = fixture(); const sources = new Map([[messageID, objective]]);
    const result = await executeWorkspaceConversationAgentCore({ ...input, messageSources: sources, contactReviewSurface: "memory",
      provider: new ScriptedAgentProvider([{ tool: "contact_workspace", input: draft }], results => {
        sources.set(messageID, "A different source");
        return { outcome: "contact_change_proposal", candidate_fingerprint: results[0]?.candidateFingerprint };
      }),
    });
    expect(stage).not.toHaveBeenCalled(); expect(result.memoryProposal).toBeNull(); expect(result.event).toBeNull();
  });

  it("dispatches cleanup before propagating a source-currentness guard failure", async () => {
    const { input, stage, withdraw } = fixture(); let lost = false;
    stage.mockImplementationOnce(async () => { lost = true; return staged; });
    await expect(executeWorkspaceConversationAgentCore({ ...input, contactReviewSurface: "memory",
      assertCurrent: async () => { if (lost) throw Error("SYNTHETIC_SOURCE_GUARD_FAILURE"); },
    })).rejects.toThrow("SYNTHETIC_SOURCE_GUARD_FAILURE");
    expect(withdraw).toHaveBeenCalledExactlyOnceWith({ proposalID, expectedRevision: 1, sourceMessageID: messageID });
  });

  it("propagates a failed withdrawal instead of returning a successful card", async () => {
    const { input, stage, withdraw } = fixture(); const sources = new Map([[messageID, objective]]);
    stage.mockImplementationOnce(async () => { sources.set(messageID, "A different source"); return staged; });
    withdraw.mockRejectedValueOnce(Error("synthetic withdrawal outage"));
    await expect(executeWorkspaceConversationAgentCore({ ...input, messageSources: sources, contactReviewSurface: "memory" }))
      .rejects.toThrow("synthetic withdrawal outage");
  });

  it("withdraws a card if the exact admitted source changes during staging", async () => {
    const { input, stage, withdraw } = fixture(); const sources = new Map([[messageID, objective]]);
    stage.mockImplementationOnce(async () => { sources.set(messageID, "A different source"); return staged; });
    const result = await executeWorkspaceConversationAgentCore({ ...input, messageSources: sources, contactReviewSurface: "memory" });
    expect(withdraw).toHaveBeenCalledExactlyOnceWith({ proposalID, expectedRevision: 1, sourceMessageID: messageID });
    expect(result.memoryProposal).toBeNull(); expect(result.event).toBeNull();
  });
});
